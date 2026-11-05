/**
 * "Request 21st Capital co-signature" — the client-side step-up.
 *
 * Strips the spend to a blind request, gates it behind an email OTP AND an
 * authenticator code, submits it, and remembers the original PSBT locally so it
 * can be finalised when 21C's signature returns (see PendingCosignScreen).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Button, Card, CodeField, InfoHeading, MailIcon, DeviceMobileIcon } from '.';
import { AuthSheet } from './AuthSheet';
import { AuthenticatorStep } from './AuthenticatorStep';
import { FitText } from './FitText';
import { Gloss } from './Gloss';
import { fetchProfile } from '../../services/settingsApi';
import { useWallets } from '../../wallet';
import { StepTransition } from './StepTransition';
import { buildCosignRequest } from '../../bitcoin/psbt';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import {
  sendCosignOtp,
  submitCosignBatch,
  submitCosignRequest,
  savePendingCosign,
} from '../../services/cosign';
import { unsignedTxid } from '../../bitcoin/psbt';
import { ownOutputIndices } from '../../wallet/ownOutputs';

interface Props {
  walletId: string;
  /** Full working PSBT (already carries the client's own signature). */
  psbt: string;
  /** The 21st Capital co-signer key's master fingerprint (hex). */
  cosignFingerprint: string;
  amountSats: number | null;
  destination: string;
  /** A refresh/self-spend: the destination is the user's OWN fresh address. */
  isRefresh?: boolean;
  /** The destination row's own label (a cancel: "Back to this vault"). */
  destinationLabel?: string;
  /**
   * Refresh-session BATCH (decided 2026-08-27): submit every one of these under
   * the single OTP round instead of the lone `psbt`. Each PSBT already
   * carries the client's own signature; `psbt`/`amountSats` then describe
   * the session as a whole for the summary card.
   */
  batch?: Array<{ psbt: string; amountSats: number | null; destination: string }>;
  /** Fires whenever the panel starts/stops network work. A parent that owns
   *  navigation uses it to refuse leaving while a SUBMIT is in flight — a
   *  "nothing has been sent" farewell during one is a lie the moment the
   *  response lands (decided 2026-08-27). */
  onBusyChange?: (busy: boolean) => void;
  /** Called the moment the request submits successfully — the parent shows
   *  the confirmation. `warning` is set when the server HAS the request(s)
   *  but recording them on this phone partly failed — the parent must show
   *  it, because a silently missing local record means a co-signed reply
   *  that can never be finalized here (decided 2026-08-27). */
  onRequested: (warning?: string, rejectedReason?: string) => void;
  onBack: () => void;
  /**
   * The step's page actions, for the host's pinned footer (decided 2026-10-05:
   * every page's buttons at the bottom; the panel sits in the host's scroll
   * content, so it cannot pin them itself). Told as the step changes, null
   * when the step has none (the email step: its code submits itself) and on
   * unmount. The host renders them with `CosignRequestFooterButtons`.
   */
  onActions: (actions: CosignRequestActions | null) => void;
}

/** A step's actions in the footer's order: the primary, then Back. */
export interface CosignRequestActions {
  primary?: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean };
  back?: { onPress: () => void; disabled?: boolean };
}

/** The panel's actions as the host footer's buttons: the primary first, Back last. */
export function CosignRequestFooterButtons({ actions }: { actions: CosignRequestActions }): React.JSX.Element {
  return (
    <>
      {actions.primary && (
        <Button title={actions.primary.title} onPress={actions.primary.onPress} loading={actions.primary.loading} disabled={actions.primary.disabled} />
      )}
      {actions.back && <Button title="Back" variant="ghost" onPress={actions.back.onPress} disabled={actions.back.disabled} />}
    </>
  );
}

type Stage = 'intro' | 'codes';

/** The code steps' icon disc. */
const STEP_ICON = 48;

export function CosignRequestPanel({
  walletId,
  psbt,
  cosignFingerprint,
  amountSats,
  destination,
  isRefresh,
  destinationLabel,
  batch,
  onBusyChange,
  onRequested,
  onBack,
  onActions,
}: Props): React.JSX.Element {
  const [stage, setStage] = useState<Stage>('intro');
  // One code at a time (decided 2026-07-23): email code first, then authenticator.
  const [codeStep, setCodeStep] = useState<'email' | 'enable2fa' | 'totp'>('email');
  /** Whether this account has an authenticator, learned while the client is
   *  reading their email so that Next never waits on a round trip. */
  const has2fa = useRef<boolean | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  const [error, setError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const sessionRef = useRef<CompanySession | null>(null);
  /**
   * Is this spend on a vault that was never tested with us? Advisory only —
   * the request is co-signed either way (decided 2026-07-28) — but the request is
   * BLIND, so the server cannot work this out and the app has to say it.
   */
  const { getWallet, getEngine } = useWallets();
  const vaultUntested = (() => {
    const w = getWallet(walletId);
    return (
      !!w && (w.providerKeyFingerprints?.length ?? 0) > 0 && !w.vaultTestedAt && !w.heirVault
    );
  })();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const request = useMemo(() => {
    if (batch) return null;
    try {
      return buildCosignRequest(psbt, cosignFingerprint);
    } catch {
      return null;
    }
  }, [psbt, cosignFingerprint, batch]);

  /** Blind request per batch transaction — null if ANY cannot be built
   *  (the batch is all-or-nothing, like the server treats it). */
  const batchRequests = useMemo(() => {
    if (!batch) return null;
    try {
      return batch.map((b) => {
        const built = buildCosignRequest(b.psbt, cosignFingerprint);
        return {
          requestPsbt: built.psbtBase64,
          amountSats: b.amountSats,
          destination: b.destination,
          psbt: b.psbt,
        };
      });
    } catch {
      return null;
    }
  }, [batch, cosignFingerprint]);

  const ready = batch ? batchRequests != null : request != null;

  const ensureSession = async (): Promise<CompanySession | null> => {
    if (sessionRef.current) return sessionRef.current;
    const s = await loadSession();
    if (s) sessionRef.current = s;
    return s;
  };

  // Sent to 2FA setup mid-step-up? Resume the moment we're focused again
  // and two-factor is actually on — the panel never lost its state
  // (decided 2026-07-27: take them there AND bring them back).
  /**
   * Why we sent the client to the two-factor setup, which decides where they
   * come back to:
   *   'resume' — they already hold an email code (the new order), so they
   *              return straight to the authenticator step and it stays valid.
   *   'send'   — no code was ever issued (an older backend refused to send one
   *              before two-factor existed), so we start the codes over.
   */
  const resumeAfter2FA = useRef<null | 'resume' | 'send'>(null);
  /** True once this ceremony sent the client off to set two-factor up, so the
   *  last step can number itself honestly. */
  const twoFactorSetUpHere = useRef(false);
  const sendCodeRef = useRef<null | (() => Promise<void>)>(null);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (resumeAfter2FA.current == null) return;
      void (async () => {
        try {
          const session = await ensureSession();
          if (!session) return;
          const profile = await fetchProfile(session);
          if (!profile.twoFactorEnabled) {
            resumeAfter2FA.current = null; // backed out — the gate stands
            return;
          }
          const why = resumeAfter2FA.current;
          resumeAfter2FA.current = null;
          twoFactorSetUpHere.current = true;
          has2fa.current = true;
          setError(null);
          if (why === 'send') {
            // Nothing was ever emailed: start the codes cleanly.
            setEmailCode('');
            setTotpCode('');
            await sendCodeRef.current?.();
            return;
          }
          // The email code the client already entered is KEPT (decided 2026-08-28):
          // enabling two-factor does not retire it, and re-sending would
          // invalidate the one they are holding. Only the authenticator code
          // is cleared, because it was typed against an app that did not
          // exist yet.
          setTotpCode('');
          setCodeStep('totp');
        } catch {
          // offline — the user can tap again
        }
      })();
    });
    return unsub;
  }, [navigation]);

  /**
   * Leaving the email step. A client who has no authenticator yet is sent to
   * set one up HERE, after their email code is in hand, rather than being
   * turned away before the ceremony started (decided 2026-08-28).
   *
   * The email code they just typed is kept: setting up two-factor does not
   * retire it, and it is good for ten minutes.
   */
  const leaveEmailStep = async (): Promise<void> => {
    setError(null);
    if (has2fa.current != null) {
      setCodeStep(has2fa.current ? 'totp' : 'enable2fa');
      return;
    }
    try {
      const session = await ensureSession();
      if (!session) {
        setAuthOpen(true);
        return;
      }
      const profile = await fetchProfile(session);
      has2fa.current = profile.twoFactorEnabled;
      setCodeStep(profile.twoFactorEnabled ? 'totp' : 'enable2fa');
    } catch {
      // Offline, or the profile call failed: carry on to the authenticator
      // step. The submit is the boundary and says so if two-factor is missing.
      setCodeStep('totp');
    }
  };

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = await ensureSession();
      if (!session) {
        setBusy(false);
        setAuthOpen(true);
        return;
      }
      await sendCosignOtp(session);
      // Sending a new code invalidates the previous one server-side — a
      // stale typed code surviving in the field just fails the submit
      // (decided 2026-08-27).
      setEmailCode('');
      setTotpCode('');
      setCodeStep('email');
      setStage('codes');
      // Ask in the background, so the answer is in hand by the time they have
      // read the email and pressed Next.
      has2fa.current = null;
      void fetchProfile(session)
        .then((p) => {
          has2fa.current = p.twoFactorEnabled;
        })
        .catch(() => {
          has2fa.current = null;
        });
    } catch (e) {
      // No 2FA yet (imported-vault users bypass the vault-creation gate):
      // TAKE them to the setup instead of leaving a dead-end message —
      // finishing there lands them right back on this panel (decided 2026-07-24).
      if ((e as Error & { code?: string }).code === '2FA_REQUIRED') {
        setError('Two-factor is required for co-signing. Setting it up now.');
        resumeAfter2FA.current = 'send';
        navigation.navigate('TwoFactor');
        return;
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    sendCodeRef.current = sendCode;
  });

  // The step's page actions, published to the host's pinned footer as the
  // step, the busy state and the readiness change (decided 2026-10-05): the
  // primary and Back on the intro and the authenticator set-up, Back alone
  // under the authenticator code, nothing under the email code, which
  // submits itself. The handlers read the latest callbacks through refs, so a
  // published action never goes stale; a step with no action clears the foot.
  const onActionsRef = useRef(onActions);
  onActionsRef.current = onActions;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useLayoutEffect(() => {
    const toEmail = () => {
      setError(null);
      setCodeStep('email');
    };
    const actions: CosignRequestActions | null =
      stage === 'intro'
        ? {
            primary: {
              title: busy ? 'Sending…' : 'Email me the confirmation link',
              onPress: () => void sendCodeRef.current?.(),
              loading: busy,
              disabled: busy || !ready,
            },
            back: { onPress: () => onBackRef.current() },
          }
        : codeStep === 'enable2fa'
          ? {
              primary: {
                title: 'Set up the authenticator',
                onPress: () => {
                  resumeAfter2FA.current = 'resume';
                  navigation.navigate('TwoFactor');
                },
              },
              back: { onPress: toEmail },
            }
          : codeStep === 'totp'
            ? { back: { onPress: toEmail, disabled: busy } }
            : null;
    onActionsRef.current(actions);
  }, [stage, codeStep, busy, ready, navigation]);
  useEffect(() => () => onActionsRef.current(null), []);

  /** The vault's engine, for BDK's answer on which outputs are its own. */
  const verifiedEngine = async () => {
    const w = getWallet(walletId);
    if (!w) throw new Error('Could not prepare the request for this vault.');
    return getEngine(w);
  };

  const submit = async (totpArg?: string) => {
    if (!ready) {
      setError('Could not prepare the request for this vault.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const session = sessionRef.current ?? (await loadSession());
      if (!session) {
        setBusy(false);
        setAuthOpen(true);
        return;
      }
      if (batch && batchRequests) {
        // ONE OTP round for the whole refresh session (decided 2026-08-27).
        // Which outputs come back to the vault is BDK's answer against the
        // descriptor, never the PSBT's own derivation entries (decided
        // 2026-09-26).
        const engine = await verifiedEngine();
        const requests = [];
        for (const r of batchRequests) {
          requests.push({
            requestPsbt: r.requestPsbt,
            amountSats: r.amountSats,
            destination: r.destination,
            ownOutputs: await ownOutputIndices(engine, r.psbt),
          });
        }
        const { batchId, ids, rejectionReason: batchRejected } = await submitCosignBatch(session, {
          requests,
          emailOtp: emailCode,
          totp: totpArg ?? totpCode,
          vaultUntested,
        });
        // The server HAS the batch now — a hiccup saving one local record
        // must not surface as an ERROR, or the user resubmits the whole
        // session as a duplicate (decided 2026-08-27). But it can't be
        // silent either: the pending list is built FROM these records, so a
        // missing one is a co-signed reply this phone can never finalize —
        // retry once, then tell the user (decided 2026-08-27).
        let unsaved = 0;
        for (let i = 0; i < batch.length; i++) {
          const record = {
            id: ids[i] ?? `${batchId}-${i}`,
            walletId,
            originalPsbt: batch[i].psbt,
            txid: unsignedTxid(batch[i].psbt) ?? undefined,
            amountSats: batch[i].amountSats,
            destination: batch[i].destination,
            createdAt: Date.now(),
            batchId,
            batchTotal: batch.length,
            // Known at once: a batch over the limit is rejected on arrival,
            // and a rejected request holds no coins (found after the server-first cancel).
            serverStatus: batchRejected ? ('rejected' as const) : ('pending' as const),
          };
          try {
            await savePendingCosign(record);
          } catch {
            try {
              await savePendingCosign(record);
            } catch {
              unsaved += 1;
            }
          }
        }
        onRequested(
          unsaved > 0
            ? `${unsaved} of the ${batch.length} requests could not be recorded on this phone, though 21st Capital has all of them. Do NOT start this refresh again. Contact us and we will finish those coins with you.`
            : undefined,
          batchRejected ?? undefined,
        );
        return;
      }
      if (!request) throw new Error('Could not prepare the request for this vault.');
      const ownOutputs = await ownOutputIndices(await verifiedEngine(), psbt);
      const { id, rejectionReason } = await submitCosignRequest(session, {
        requestPsbt: request.psbtBase64,
        ownOutputs,
        amountSats,
        destination,
        emailOtp: emailCode,
        // Threaded from CodeField.onComplete so auto-submit uses the completed
        // value, not the not-yet-applied totpCode state.
        totp: totpArg ?? totpCode,
        vaultUntested,
      });
      // Same parity as the batch path (decided 2026-08-27): the server accepted
      // the request, so a local-save failure must warn, never error — an
      // error here reads as "try again" and creates a duplicate request.
      let saveWarning: string | undefined;
      const record = {
        id,
        walletId,
        originalPsbt: psbt,
        // Same spend the client may already have parked mid-ceremony — this
        // is what lets the two records become one row.
        txid: unsignedTxid(psbt) ?? undefined,
        amountSats,
        destination,
        createdAt: Date.now(),
        // Known at once: a request over the limit is rejected on arrival,
        // and a rejected request holds no coins (found after the server-first cancel).
        serverStatus: rejectionReason ? ('rejected' as const) : ('pending' as const),
      };
      try {
        await savePendingCosign(record);
      } catch {
        try {
          await savePendingCosign(record);
        } catch {
          saveWarning =
            'The request is with 21st Capital, but this phone could not record it. Do NOT submit it again. Contact us and we will finish this transaction with you.';
        }
      }
      // The parent owns the "request sent" confirmation (SignPsbtScreen's
      // 'requested' phase) so back/swipe can be redirected to the vault.
      // Saved even when rejected: the record keeps the client's signature,
      // so another key of theirs can still finish it (never forced through
      // us), and Pending shows the reason.
      onRequested(saveWarning, rejectionReason ?? undefined);
    } catch (e) {
      if ((e as Error & { code?: string }).code === '2FA_REQUIRED') {
        setError('Two-factor is required. Setting it up now.');
        // The refusal happens before the server looks at the email code, so
        // that code is untouched and still good: come back to this step
        // rather than starting the codes over.
        resumeAfter2FA.current = 'resume';
        navigation.navigate('TwoFactor');
        return;
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Request 21st Capital co-signature</Text>

      <Card style={styles.summary}>
        {batch ? (
          <View style={styles.row}>
            <Text style={styles.label}>Refresh session</Text>
            <Text style={styles.value}>
              {batch.length} transaction{batch.length === 1 ? '' : 's'} back to this vault
            </Text>
          </View>
        ) : (
          <View style={styles.row}>
            <Text style={styles.label}>{destinationLabel ?? (isRefresh ? 'Refresh to' : 'To')}</Text>
            <FitText style={styles.value}>
              {destination
                ? `${destination.slice(0, 12)}…${destination.slice(-6)}`
                : 'this transaction'}
            </FitText>
          </View>
        )}
        {amountSats != null && (
          <View style={styles.row}>
            <Text style={styles.label}>{batch ? 'Total' : 'Amount'}</Text>
            <Text style={styles.value}>{amountSats.toLocaleString()} sats</Text>
          </View>
        )}
      </Card>

      <StepTransition
        stepKey={stage === 'codes' ? `codes:${codeStep}` : stage}
        order={['intro', 'codes:email', 'codes:enable2fa', 'codes:totp']}
        style={styles.steps}
      >
        {stage === 'intro' && (
          <>
            <InfoHeading
              style={styles.body}
              title="What we send"
              text={
                // Numbered, because it is a sequence the client walks through
                // (decided 2026-08-28). One idea per line, no paragraph to unpick.
                'We send 21st Capital only what it needs to co-sign: the amount and the destination. It never sees your full wallet.\n\n' +
                '1. We email you a link.\n' +
                `2. The link asks you to confirm that you checked the receiving ${batch ? 'addresses' : 'address'} yourself.\n` +
                '3. The page then shows your first code.\n' +
                '4. Your authenticator app gives the second code.' +
                (batch ? '\n\nOne round of codes covers the whole refresh.' : '')
              }>
              {batch
                ? `Two codes confirm all ${batch.length} transactions.`
                : 'Two codes confirm this request.'}
            </InfoHeading>
            {!ready && (
              <Text style={styles.error}>
                {batch
                  ? 'The co-sign requests could not be prepared for this vault. Go back and sign the session again. Contact us if it keeps happening.'
                  : 'The co-sign request could not be prepared for this vault.'}
              </Text>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        {stage === 'codes' && codeStep === 'email' && (
          <>
            <View style={styles.stepHeader}>
              <View style={styles.stepIcon}>
                <Gloss size={STEP_ICON} radius={theme.radius.pill} />
                <MailIcon size={26} color={theme.colors.gold} />
              </View>
              <View style={styles.stepHeaderText}>
                <Text style={styles.stepTag}>STEP 1 OF 2 · EMAIL</Text>
                <Text style={styles.stepTitle}>The code from the confirmation page</Text>
              </View>
            </View>
            <Text style={styles.body}>
              Open the link we emailed you and confirm the address check. The page then
              shows your 6-digit code.
            </Text>
            <CodeField
              label="Code from your email"
              // The email carries a LINK; the code itself is shown on the
              // confirmation page after the address check, so the phone has
              // nothing to offer and the Paste button stays.
              oneTimeCode={false}
              value={emailCode}
              onChange={setEmailCode}
              onComplete={() => void leaveEmailStep()}
              onAlternative={() => void sendCode()}
              alternativeLabel="Resend the email"
              busy={busy}
              error={error ?? undefined}
            />
          </>
        )}

        {stage === 'codes' && codeStep === 'enable2fa' && (
          <>
            <View style={styles.stepHeader}>
              <View style={styles.stepIcon}>
                <Gloss size={STEP_ICON} radius={theme.radius.pill} />
                <DeviceMobileIcon size={26} color={theme.colors.gold} />
              </View>
              <View style={styles.stepHeaderText}>
                <Text style={styles.stepTag}>STEP 2 OF 3 · AUTHENTICATOR</Text>
                <Text style={styles.stepTitle}>Set up your authenticator</Text>
              </View>
            </View>
            <Text style={styles.body}>
              Co-signing needs a second code from an authenticator app, and this account
              does not have one yet. Setting it up takes a minute, and it protects every
              co-signature from here on.
            </Text>
            <Text style={styles.body}>
              Your email code stays where it is. We bring you back to finish.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        {stage === 'codes' && codeStep === 'totp' && (
          // The one authenticator step, shared with the rescue request;
          // its Back is the footer's (actions.back, decided 2026-10-05).
          <AuthenticatorStep
            tag={`${twoFactorSetUpHere.current ? 'STEP 3 OF 3' : 'STEP 2 OF 2'} · AUTHENTICATOR`}
            value={totpCode}
            onChange={setTotpCode}
            // Threaded from CodeField.onComplete so auto-submit uses the
            // completed value, not the not-yet-applied totpCode state.
            onComplete={(c) => void submit(c)}
            busy={busy}
            busyLabel="Submitting…"
            error={error ?? undefined}
          />
        )}
      </StepTransition>

      <AuthSheet
        visible={authOpen}
        defaultMode="signin"
        onClose={() => setAuthOpen(false)}
        onAuthed={(s) => {
          sessionRef.current = s;
          setAuthOpen(false);
          void sendCode();
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // One rhythm for the whole panel: `lg` between the big blocks, `md`
  // between the pieces of a single step, and nothing hand-tuned per element
  // (decided 2026-08-28 — the screen read as one dense block).
  panel: { gap: theme.spacing.lg },
  steps: { gap: theme.spacing.md },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  summary: { gap: theme.spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Top-aligned: a value that wraps to two lines used to drag its label
    // down to the middle of the row.
    alignItems: 'flex-start',
    gap: theme.spacing.lg,
  },
  label: { ...theme.typography.body, color: theme.colors.slate },
  value: {
    ...theme.typography.body,
    color: theme.colors.offWhite,
    flexShrink: 1,
    textAlign: 'right',
  },
  body: { ...theme.typography.body, color: theme.colors.slate },
  // The emphasised words in a line of body copy.
  strong: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
  error: { ...theme.typography.caption, color: theme.colors.negative },
  // Step-up headers: each code step gets its own icon + tag so the two codes
  // can't be mistaken for one another (decided 2026-07-24).
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  stepIcon: {
    width: STEP_ICON,
    height: STEP_ICON,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepHeaderText: { flex: 1, gap: 2 },
  stepTag: { ...theme.typography.label, color: theme.colors.gold, letterSpacing: 1 },
  stepTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
}));
