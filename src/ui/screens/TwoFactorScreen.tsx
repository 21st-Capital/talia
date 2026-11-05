/**
 * Two-factor authentication — native setup + management (decided 2026-07-21).
 * Enabling requires the authenticator code (twice, server-side); disabling
 * needs a current authenticator code or a recovery code (backend decided
 * 2026-09-26). Backup codes are shown ONCE.
 *
 * The app now supports TOTP at LOGIN (AuthSheet mfa step), so enabling 2FA
 * here no longer locks the user out of Talia.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SettingsStackParamList } from '../navigation/types';
import { AppDialog, AuthSheet, BrandedQr, Button, Card, ChoiceSheet, CodeField, FOOTER_ROOM, Gloss, PageFooter, StepTransition, cardGlow } from '../components';
import { CircleCheckIcon, CopyIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import { copySecret } from '../../platform/clipboard';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { fetchProfile, generate2faSecret, enable2fa, disable2fa } from '../../services/settingsApi';
import { twoFactorProof } from '../../services/twoFactorProof';
import {
  APPLE_PASSWORDS,
  AUTHENTICATOR_APPS,
  GET_GOOGLE_AUTHENTICATOR,
  GOOGLE_AUTHENTICATOR_STORE_URL,
  AUTHENTICATOR_LABEL,
  applePasswordsLink,
  relabelTotpLink,
  authenticatorChoices,
  authenticatorStep,
} from '../../services/authenticatorApps';
import type { AuthenticatorApp } from '../../services/authenticatorApps';
import { googleAuthenticatorLink } from '../../services/googleAuthenticatorLink';

type Props = NativeStackScreenProps<SettingsStackParamList, 'TwoFactor'>;
type Stage = 'loading' | 'status' | 'setup' | 'codes';

export function TwoFactorScreen({ navigation, route }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<CompanySession | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [stage, setStage] = useState<Stage>('loading');
  const [secret, setSecret] = useState('');
  /** The otpauth:// URI inside the QR, verbatim from the backend. */
  const [otpauthUrl, setOtpauthUrl] = useState('');
  /** Several code apps on the phone: the list to pick one from. */
  const [appChoices, setAppChoices] = useState<AuthenticatorApp[] | null>(null);
  /** No code app on the phone: offer Google Authenticator's download. */
  const [offerStore, setOfferStore] = useState(false);
  /** An app with no import link: the key is copied, this app opens next. */
  const [pasteIn, setPasteIn] = useState<AuthenticatorApp | null>(null);
  /** Duo Mobile claims totp:// as well, so with Duo on the phone the Google
   *  link could land in Duo; the setup key is copied instead. */
  const duoOnPhone = useRef(false);
  /** Which thing was just copied, so the tap is answered (decided 2026-09-02:
   *  "it just silently copies the key"). */
  const [copied, setCopied] = useState<'secret' | 'codes' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const [otp, setOtp] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  /** Two-factor is mandatory on this account (a staff account), so the
   *  turn-off button is withdrawn rather than left there to fail. */
  const [lockedOn, setLockedOn] = useState(false);
  /** No session: sign in right here rather than bouncing the user out. */
  const [needsLogin, setNeedsLogin] = useState(false);
  const startSetupRef = useRef<null | ((s?: CompanySession) => Promise<void>)>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await loadSession();
        if (!s) {
          // Do NOT pop: the screen used to vanish the instant the session had
          // expired, which read as "two-factor can't be turned off any more"
          // (decided 2026-07-27). Offer the login instead.
          setNeedsLogin(true);
          return;
        }
        setSession(s);
        const p = await fetchProfile(s);
        setEnabled(p.twoFactorEnabled);
        // Sent here by a MUST-gate: open the setup immediately instead of a
        // status page that needs another tap (decided 2026-07-27).
        if (route.params?.gate && !p.twoFactorEnabled) {
          setStage('status');
          void startSetupRef.current?.(s);
          return;
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setStage('status');
      }
    })();
  }, [navigation]);

  const startSetup = async (sessionArg?: CompanySession) => {
    const sess = sessionArg ?? session;
    if (!sess) return;
    setError(null);
    setBusy(true);
    try {
      const { secret: sec, otpauthUrl: uri } = await generate2faSecret(sess);
      setSecret(sec);
      setOtpauthUrl(uri);
      setStage('setup');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    startSetupRef.current = startSetup;
  });

  const copy = (what: 'secret' | 'codes', text: string) => {
    copySecret(text, 'accountSecret');
    setCopied(what);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1500);
  };
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  // On THIS screen the keyboard must stay down until the client asks for it:
  // the QR has to be scanned first, and an open keyboard hid the digit boxes
  // it was meant to fill (decided 2026-09-02). When it does open, the shared
  // scroller lifts the boxes, their Paste and the error above the footer and
  // the keys, never past the top: a blind scroll to the end was what took the
  // co-signing codes off the screen (decided 2026-10-18). Every action of this page
  // is in its footer; the setup's code is its only field (a dialog's keyboard
  // elsewhere leaves the page where it is).
  const offsetY = useRef(0);
  const { reveal } = useRevealFocusedField(scrollRef, offsetY, stage === 'setup', { confirmPinned: true });

  // The button stays whatever happens (decided 2026-09-21: it used to vanish after
  // one tap). Each tap looks again for the code apps Talia supports, so an
  // app installed in the meantime is found (services/authenticatorApps).
  const openAuthenticator = async () => {
    const has = (url: string) => Linking.canOpenURL(url).catch(() => false);
    const found = await Promise.all(AUTHENTICATOR_APPS.map(async (a) => ((await has(a.url)) ? a.key : null)));
    const installed = new Set(found.filter((k): k is string => k !== null));
    duoOnPhone.current = installed.has('duo');
    const hasPasswords = !!otpauthUrl && (await has(APPLE_PASSWORDS.url));
    const step = authenticatorStep(authenticatorChoices(installed, hasPasswords));
    if (step.kind === 'store') setOfferStore(true);
    else if (step.kind === 'open') void handTo(step.app);
    else setAppChoices(step.apps);
  };

  /** Passwords and Google Authenticator each take a link that carries the
   *  account, labelled TALIA (decided 2026-09-21: "test 3 is the right choice",
   *  services/googleAuthenticatorLink). Every other app gets the setup key
   *  copied and a one-line dialog before it opens. */
  const handTo = async (app: AuthenticatorApp) => {
    setAppChoices(null);
    if (app.key === GET_GOOGLE_AUTHENTICATOR.key) {
      Linking.openURL(app.url).catch(() => undefined);
      return;
    }
    const direct =
      app.key === APPLE_PASSWORDS.key
        ? applePasswordsLink(otpauthUrl)
        : app.key === 'google' && !duoOnPhone.current
          ? googleAuthenticatorLink(otpauthUrl, AUTHENTICATOR_LABEL)
          : null;
    if (direct) {
      try {
        await Linking.openURL(direct);
        return;
      } catch {
        // No app took the link: fall through to the setup key.
      }
    }
    copy('secret', secret);
    setPasteIn(app);
  };

  const finishEnable = async (codeArg?: string) => {
    if (!session) return;
    const code = (codeArg ?? otp).trim();
    if (code.length < 6) return;
    setError(null);
    setBusy(true);
    try {
      const backup = await enable2fa(session, secret, code);
      setCodes(backup);
      setEnabled(true);
      setStage('codes');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDisable = async (typed: string) => {
    if (!session) return;
    const proof = twoFactorProof(typed);
    if (!proof) return;
    setError(null);
    setBusy(true);
    try {
      // The SERVER's answer decides — a retried toggle can leave it on.
      const stillEnabled = await disable2fa(session, proof);
      setEnabled(stillEnabled);
      setStage('status');
      if (stillEnabled) {
        setError(
          'Two-factor is still on. Tap "Turn off two-factor" once more.',
        );
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(err.message);
      // A staff account may never switch two-factor off. That is a rule, not
      // a failure, so stop offering the button that cannot work
      // (decided 2026-08-28).
      if (err.code === 'STAFF_2FA_REQUIRED') setLockedOn(true);
    } finally {
      setBusy(false);
      setConfirmDisable(false);
    }
  };

  // The page's actions sit in the pinned footer (decided 2026-10-05), chosen per
  // stage OUTSIDE the step transition so they never slide with the step:
  // the primary first, Cancel last. Loading, and an account that may never
  // switch two-factor off, have nothing to tap, so no footer at all. The
  // codes card keeps its own Copy.
  const footer =
    stage === 'status' && !(enabled && lockedOn) ? (
      <PageFooter>
        {!enabled ? (
          <Button title={busy ? 'Starting…' : 'Set up two-factor'} onPress={() => void startSetup()} loading={busy} />
        ) : (
          <Button title="Turn off two-factor" variant="ghost" onPress={() => setConfirmDisable(true)} />
        )}
      </PageFooter>
    ) : stage === 'setup' ? (
      <PageFooter>
        {/* On a phone the QR is on the very screen you would need to scan
            it with, so this is the route that actually works there. */}
        <Button title="Add to my authenticator app" onPress={() => void openAuthenticator()} />
        <Button title="Cancel" variant="ghost" onPress={() => setStage('status')} />
      </PageFooter>
    ) : stage === 'codes' ? (
      <PageFooter>
        <Button title="I've saved them" onPress={() => navigation.goBack()} />
      </PageFooter>
    ) : null;

  return (
    <View style={styles.frame}>
    <ScrollView
      ref={scrollRef}
      onScroll={(e) => {
        offsetY.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      onContentSizeChange={reveal}
      style={styles.root}
      // Above a footer the content ends at the footer's fade; without one it
      // ends at the safe area. The footer rises with the keyboard, so the
      // scroll view takes no keyboard inset of its own.
      contentContainerStyle={[
        styles.content,
        footer ? styles.contentFooted : { paddingBottom: insets.bottom + theme.spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <StepTransition
        stepKey={stage}
        order={['loading', 'status', 'setup', 'codes']}
        style={styles.stepWrap}>
      {stage === 'loading' && <Text style={styles.muted}>Loading…</Text>}

      {stage === 'status' && (
        <>
          <Text style={styles.body}>
            Two-factor adds a second step at sign-in: a 6-digit code from an
            authenticator app.
          </Text>
          <Card style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>
                Two-factor authentication
              </Text>
              <Text style={[styles.statusValue, enabled ? styles.on : styles.off]}>
                {enabled ? 'On' : 'Off'}
              </Text>
            </View>
          </Card>
          {error && <Text style={styles.error}>{error}</Text>}
          {enabled && lockedOn && (
            <Text style={styles.body}>
              Two-factor stays on for this account. It carries staff access to 21st
              Capital, and that access is only ever granted with a second factor.
            </Text>
          )}
        </>
      )}

      {stage === 'setup' && (
        <>
          <Text style={styles.body}>
            Add this account to your authenticator app with the button, or
            scan the QR from another device. Then type the 6-digit code it
            shows.
          </Text>
          {/* The Receive screen's QR (decided 2026-09-21: "match the design of
              the QR code with the BTC addresses QR design"), drawn here from
              the same account the button hands over, labelled TALIA, rather
              than the backend's picture of it. */}
          {!!otpauthUrl && <BrandedQr value={relabelTotpLink(otpauthUrl)} />}
          <Text style={styles.fieldLabel}>Setup key</Text>
          <TouchableOpacity
            style={styles.secretBox}
            onPress={() => copy('secret', secret)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Copy setup key">
            <Gloss radius={theme.radius.md} strength={cardGlow()} />
            <Text style={styles.secretText} selectable>{secret}</Text>
            {/* An icon, not a caption (decided 2026-09-02); it turns into a tick
                for a moment so the tap is visibly answered. */}
            <View style={styles.copyIconWrap}>
              {copied === 'secret' ? (
                <>
                  <CircleCheckIcon size={20} color={theme.colors.positive} />
                  <Text style={styles.copiedHint}>Copied</Text>
                </>
              ) : (
                <CopyIcon size={20} color={theme.colors.accentText} />
              )}
            </View>
          </TouchableOpacity>
          <CodeField
            label="6-digit code from the app"
            value={otp}
            onChange={setOtp}
            onComplete={(c) => void finishEnable(c)}
            oneTimeCode={false}
            // Keyboard down until asked: the QR has to be readable first.
            autoFocus={false}
            busy={busy}
            busyLabel="Verifying…"
            error={error ?? undefined}
          />
        </>
      )}

      {stage === 'codes' && (
        <>
          <Text style={styles.body}>
            Two-factor is on. Save these recovery codes somewhere safe. Each one
            signs you in once if you lose your authenticator, and this is the
            only time we can show them.
          </Text>
          {codes.length > 0 ? (
            <>
              <Card style={styles.codesCard}>
                {codes.map((c) => (
                  <Text key={c} style={styles.codeItem} selectable>{c}</Text>
                ))}
              </Card>
              <Button
                title={copied === 'codes' ? 'Copied' : 'Copy all codes'}
                variant="ghost"
                onPress={() => copy('codes', codes.join('\n'))}
              />
            </>
          ) : (
            // Never render an empty box under "this is the only time" copy
            // (decided 2026-08-27) — say what happened and how to get a set.
            <Card style={styles.codesCard}>
              <Text style={styles.body}>
                Two-factor is on, but no recovery codes came back. Turn it off
                and on once more to get a set.
              </Text>
            </Card>
          )}
        </>
      )}
      </StepTransition>

      <AuthSheet
        visible={needsLogin}
        onClose={() => {
          setNeedsLogin(false);
          navigation.goBack();
        }}
        onAuthed={(s) => {
          setNeedsLogin(false);
          setSession(s);
          void (async () => {
            try {
              const p = await fetchProfile(s);
              setEnabled(p.twoFactorEnabled);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setStage('status');
            }
          })();
        }}
      />

      <ChoiceSheet
        visible={appChoices !== null}
        title="Choose your app"
        options={(appChoices ?? []).map((a) => ({ value: a.key, label: a.name }))}
        onPick={(key) => {
          const app = appChoices?.find((a) => a.key === key);
          if (app) void handTo(app);
        }}
        onClose={() => setAppChoices(null)}
      />

      {pasteIn && (
        <AppDialog
          visible
          title={`Setup key copied. Paste it in ${pasteIn.name} and name it ${AUTHENTICATOR_LABEL}.`}
          actions={[
            {
              label: `Open ${pasteIn.name}`,
              onPress: () => {
                const url = pasteIn.url;
                setPasteIn(null);
                Linking.openURL(url).catch(() => undefined);
              },
            },
            { label: 'Cancel', variant: 'ghost', onPress: () => setPasteIn(null) },
          ]}
          onClose={() => setPasteIn(null)}
        />
      )}

      {offerStore && (
        <AppDialog
          visible
          title="Get Google Authenticator"
          actions={[
            {
              label: 'App Store',
              onPress: () => {
                setOfferStore(false);
                Linking.openURL(GOOGLE_AUTHENTICATOR_STORE_URL).catch(() => undefined);
              },
            },
            { label: 'Cancel', variant: 'ghost', onPress: () => setOfferStore(false) },
          ]}
          onClose={() => setOfferStore(false)}
        />
      )}

      {confirmDisable && (
        <AppDialog
          visible
          title="Turn off two-factor?"
          message="Your account will be protected only by the emailed sign-in code. You can turn it back on anytime."
          input={{
            label: 'Code from your authenticator app, or a recovery code',
            autoCapitalize: 'characters',
            maxLength: 20,
          }}
          actions={[
            {
              label: 'Turn off',
              destructive: true,
              requiresInput: true,
              onPress: (typed) => void doDisable(typed),
            },
            { label: 'Keep it on', variant: 'ghost', onPress: () => setConfirmDisable(false) },
          ]}
          onClose={() => setConfirmDisable(false)}
        />
      )}
    </ScrollView>
    {footer}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  frame: { flex: 1 },
  root: { flex: 1 },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  contentFooted: { paddingBottom: FOOTER_ROOM },
  stepWrap: { gap: theme.spacing.md },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  body: { ...theme.typography.body, color: theme.colors.slate },
  statusCard: {},
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { ...theme.typography.body, color: theme.colors.offWhite },
  statusValue: { ...theme.typography.heading },
  on: { color: theme.colors.positive },
  off: { color: theme.colors.slate },
  fieldLabel: { ...theme.typography.label, color: theme.colors.slate },
  secretBox: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  // A key and the recovery codes are codes: the mono token, like every key
  // and descriptor in the app.
  secretText: { ...theme.typography.mono, color: theme.colors.offWhite, letterSpacing: 1 },
  copyIconWrap: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, alignSelf: 'flex-end' },
  copiedHint: { ...theme.typography.caption, color: theme.colors.positive },
  codesCard: { gap: theme.spacing.sm },
  codeItem: { ...theme.typography.mono, color: theme.colors.offWhite, letterSpacing: 1 },
  error: { ...theme.typography.caption, color: theme.colors.negative },
}));
