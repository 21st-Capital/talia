/**
 * Co-signing limits, PER VAULT (decided 2026-09-23: "limits per vault must work
 * now even if a client has multiple vaults with different limits", and "why
 * do we actually have the limits on the estate plan? ... Limits are a
 * feature on their own for all elite and elite plus clients, with or without
 * an estate plan").
 *
 * One card per vault, listed from OUR records, so a vault that has never
 * been imported onto this phone is here too. Opened from a vault's own menu,
 * that vault's card alone (decided 2026-10-28). "Lower now, raise after 24
 * hours": a lowered limit applies at once; a raised one waits a day, the
 * client is emailed, and it can be cancelled until then. The backend decides
 * which is which and enforces them at every co-sign request.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AppDialog, Button, Card, CodeField, CodeStepHead, Screen } from '../components';
import { LimitField, limitStyles } from '../components/LimitFields';
import { theme, themedStyles } from '../theme';
import { loadSession } from '../../services/companyAuth';
import { useWallets, vaultNumberOf, withNetworkNote } from '../../wallet';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import type { CompanySession } from '../../services/companyAuth';
import {
  cancelCosignLimitsChange,
  changeCosignLimits,
  fetchCosignLimits,
  limitsOfVault,
  requestCosignLimitsOtp,
} from '../../services/cosignLimits';
import type { LimitSet, VaultLimits } from '../../services/cosignLimits';
import { LIMIT_UNIT, limitOrderProblem, limitText } from '../../services/limitPresets';
import { STORE_COPY } from './storeCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'CosignLimits'>;

/** "0.5 BTC", written the way the dropdown writes it, or "no limit". */
function limitWords(amount: string): string {
  return limitText(amount) || (amount.trim() ? `${amount} ${LIMIT_UNIT}` : 'no limit');
}

function whenWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function CosignLimitsScreen({ navigation, route }: Props): React.JSX.Element {
  const { wallets } = useWallets();
  // Opened from a vault's own menu, the page is about that vault alone
  // (decided 2026-10-28); from Elite Services it lists every vault.
  const scopedId = route.params?.walletId;
  const scopedWallet = scopedId ? wallets.find((w) => w.id === scopedId) : undefined;
  const { providerFps, settled } = useProviderFingerprints(scopedWallet);
  const [session, setSession] = useState<CompanySession | null | undefined>(undefined);
  const [vaults, setVaults] = useState<VaultLimits[] | null>(null);
  const [elite, setElite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VaultLimits | null>(null);
  const [draft, setDraft] = useState<LimitSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message?: string } | null>(null);
  /** Step-up before any change (decided 2026-09-19): the code we emailed, then
   *  the authenticator code, each on its own full screen like the sign-in's
   *  (decided 2026-09-22: "match them with the standard OTP screens we have for
   *  logins. Each OTP gets its own full screen"). */
  const [step, setStep] = useState<'list' | 'email' | 'totp'>('list');
  const [emailCode, setEmailCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  // Back walks the code steps in reverse instead of leaving the screen.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (step === 'list') return;
      const kind = e.data.action.type;
      if (kind !== 'GO_BACK' && kind !== 'POP') return;
      e.preventDefault();
      setCodeError(null);
      setStep(step === 'totp' ? 'email' : 'list');
    });
    return sub;
  }, [navigation, step]);

  const load = useCallback(async (s: CompanySession) => {
    try {
      const page = await fetchCosignLimits(s);
      setVaults(page.vaults);
      setElite(page.elite);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await loadSession();
      setSession(s);
      if (s) await load(s);
    })();
  }, [load]);

  const startEdit = (vault: VaultLimits) => {
    setEditing(vault);
    setDraft({ ...vault.limits });
  };

  /** Save: the email code goes out and its screen opens. */
  const save = async () => {
    if (!session || !editing || !draft) return;
    const problem = limitOrderProblem(draft.monthly, draft.yearly);
    if (problem) {
      setDialog({ title: problem });
      return;
    }
    setBusy(true);
    try {
      await requestCosignLimitsOtp(session);
      setEmailCode('');
      setTotpCode('');
      setCodeError(null);
      setStep('email');
    } catch (e) {
      setDialog({ title: 'Could not send the email code', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** A new email code, from the email step's own link. */
  const resend = async () => {
    if (!session) return;
    setCodeError(null);
    try {
      await requestCosignLimitsOtp(session);
      setEmailCode('');
    } catch (e) {
      setCodeError((e as Error).message);
    }
  };

  /** The sixth authenticator digit: both codes go to the server together. */
  const confirm = async (totp: string) => {
    if (!session || !editing || !draft) return;
    setBusy(true);
    setCodeError(null);
    try {
      const result = await changeCosignLimits(session, editing, draft, { emailOtp: emailCode, totp });
      setEditing(null);
      setDraft(null);
      setStep('list');
      await load(session);
      setDialog(
        result.status === 'applied'
          ? { title: 'Your limits are changed' }
          : {
              title: 'Your new limits take effect in 24 hours',
              message: result.effectiveAt
                ? `Until ${whenWords(result.effectiveAt)} the current limits apply. We emailed you; you can cancel the change here until then.`
                : undefined,
            },
      );
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'INVALID_EMAIL_OTP') {
        // The email code is the wrong one: back to its screen, cleared.
        setEmailCode('');
        setTotpCode('');
        setStep('email');
        setCodeError(err.message);
      } else if (err.code === 'INVALID_TOTP') {
        setTotpCode('');
        setCodeError(err.message);
      } else {
        setStep('list');
        setDialog({ title: 'Could not change the limits', message: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelPending = async (vault: VaultLimits) => {
    if (!session) return;
    setBusy(true);
    try {
      await cancelCosignLimitsChange(session, vault);
      await load(session);
      setDialog({ title: 'The change is cancelled' });
    } catch (e) {
      setDialog({ title: 'Could not cancel the change', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Each vault carries its own limit, so each card names its vault: the
   * client's OWN name for it when this phone holds it, else the number we
   * gave it, which is what the staff page and our emails say.
   *
   * The list comes from our records, not from this phone (decided 2026-09-23:
   * "does the app look at the existing vaults in the app only, or does it
   * look also at our backend"), so a vault that was never imported here is
   * on the page with its number and can still be capped.
   */
  const localName = (vault: VaultLimits): string | null =>
    wallets.find((w) => {
      if (!w.descriptor) return false;
      const mine = vaultNumberOf(w.descriptor, providerFps);
      // BOTH halves: the same number exists on both chains, and a testnet
      // rehearsal must never borrow the name of the real vault.
      return mine?.account === vault.account && mine?.network === vault.network;
    })?.label ?? null;

  /**
   * A vault of the test network says so. The same number exists on both
   * chains, so without it a client with a rehearsal vault sees "Vault 3"
   * twice and cannot tell which limit they are changing (decided 2026-09-23:
   * the two read as one vault shown twice on the limits screen).
   */
  const title = (vault: VaultLimits) =>
    withNetworkNote(localName(vault) ?? `Vault ${vault.vaultNumber}`, vault.network);

  /**
   * The vaults the page lists: all of them, or the one it was opened from.
   * Which one that is is read off our key in its descriptor, so the page
   * waits for our fingerprints before it decides (null = still loading).
   */
  const shownVaults = (): VaultLimits[] | null => {
    if (vaults == null) return null;
    if (!scopedId) return vaults;
    if (!settled) return null;
    const descriptor = scopedWallet?.descriptor;
    return limitsOfVault(vaults, descriptor ? vaultNumberOf(descriptor, providerFps) : null);
  };
  const shown = shownVaults();

  // The two codes, each on its own screen, the sign-in's own steps. Each
  // step's way back sits at the foot of the page (decided 2026-10-05).
  if (step === 'email') {
    return (
      <Screen
        scroll
        style={styles.codeStep}
        footer={<Button title="Cancel" variant="ghost" onPress={() => { setCodeError(null); setStep('list'); }} />}>
        <CodeStepHead kind="email" title="Check your email" />
        <Text style={styles.body}>
          {session?.email ? `We emailed a 6-digit code to ${session.email}.` : 'We emailed you a 6-digit code.'}
        </Text>
        <CodeField
          label="Enter the code we emailed you"
          value={emailCode}
          onChange={setEmailCode}
          onComplete={(c) => {
            setEmailCode(c);
            setCodeError(null);
            setTotpCode('');
            setStep('totp');
          }}
          onAlternative={() => void resend()}
          alternativeLabel="Send a new code"
          error={codeError ?? undefined}
        />
      </Screen>
    );
  }
  if (step === 'totp') {
    return (
      <Screen
        scroll
        style={styles.codeStep}
        footer={<Button title="Back" variant="ghost" disabled={busy} onPress={() => { setCodeError(null); setStep('email'); }} />}>
        <CodeStepHead kind="authenticator" title="Now a different code" />
        <Text style={styles.body}>
          Not the emailed one. Enter the 6-digit code your authenticator app shows right now.
        </Text>
        <CodeField
          label="Code from your authenticator app"
          value={totpCode}
          onChange={setTotpCode}
          onComplete={(c) => void confirm(c)}
          oneTimeCode={false}
          busy={busy}
          busyLabel="Saving…"
          error={codeError ?? undefined}
        />
      </Screen>
    );
  }

  // The list's actions at its foot (decided 2026-10-05): Save for the vault being
  // edited, Try again when the list could not load, and the editor's Cancel
  // last. "Change" and "Cancel this change" belong to their card and row.
  const editingOpen = editing != null && draft != null;
  const footed = error != null || editingOpen;

  return (
    <Screen
      scroll
      style={styles.content}
      footer={
        footed ? (
          <>
            {draft && editingOpen && (
              <Button
                title={busy ? 'Sending the code…' : 'Save'}
                onPress={() => void save()}
                disabled={busy || !!limitOrderProblem(draft.monthly, draft.yearly)}
              />
            )}
            {error && (
              <Button title="Try again" variant="ghost" onPress={() => session && void load(session)} />
            )}
            {editingOpen && (
              <Button
                title="Cancel"
                variant="ghost"
                disabled={busy}
                onPress={() => { setEditing(null); setDraft(null); }}
              />
            )}
          </>
        ) : undefined
      }>
      {/* Short (decided 2026-09-21): where they apply, the 24 hours, the email. */}
      <Text style={styles.intro}>
        {scopedId
          ? 'Raising this limit takes 24 hours, and we email you.'
          : 'Each vault has its own limit. Raising one takes 24 hours, and we email you.'}
      </Text>

      {session === null && (
        <Card style={styles.card}>
          <Text style={styles.body}>Sign in to 21st Capital in Settings to see your limits.</Text>
        </Card>
      )}

      {session && shown == null && !error && (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.gold} size="small" />
        </View>
      )}

      {error && (
        <Card style={styles.card}>
          <Text style={styles.body}>{error}</Text>
        </Card>
      )}

      {shown && !elite && (
        <Card style={styles.card}>
          <Text style={styles.body}>{STORE_COPY.limitsElite}</Text>
        </Card>
      )}

      {shown && elite && shown.length === 0 && (
        <Card style={styles.card}>
          <Text style={styles.body}>
            {scopedId
              ? 'We could not find a co-signing limit for this vault.'
              : 'You have no vault with us yet. A limit belongs to a vault, so one appears here for each vault you build.'}
          </Text>
        </Card>
      )}

      {shown &&
        elite &&
        shown.map((vault) => {
          const isEditing =
            editing?.account === vault.account && editing?.network === vault.network && draft != null;
          return (
            <Card key={`${vault.account}:${vault.network}`} style={styles.card}>
              <Text style={styles.cardTitle}>{title(vault)}</Text>
              {!isEditing && (
                <>
                  <Text style={styles.line}>Monthly {limitWords(vault.limits.monthly)}</Text>
                  <Text style={styles.line}>Yearly {limitWords(vault.limits.yearly)}</Text>
                  {vault.pending && (
                    <View style={styles.pending}>
                      <Text style={styles.pendingTitle}>
                        From {whenWords(vault.pending.effectiveAt)}
                      </Text>
                      <Text style={styles.line}>Monthly {limitWords(vault.pending.monthly)}</Text>
                      <Text style={styles.line}>Yearly {limitWords(vault.pending.yearly)}</Text>
                      <Button
                        title="Cancel this change"
                        variant="ghost"
                        disabled={busy}
                        onPress={() => void cancelPending(vault)}
                      />
                    </View>
                  )}
                  <Button title="Change" variant="ghost" disabled={busy} onPress={() => startEdit(vault)} />
                </>
              )}
              {isEditing && draft && (
                <View style={styles.editor}>
                  <LimitField label="Monthly co-signing limit" value={draft.monthly} onChangeText={(monthly) => setDraft({ ...draft, monthly })} />
                  <LimitField label="Yearly co-signing limit" value={draft.yearly} onChangeText={(yearly) => setDraft({ ...draft, yearly })} />
                  {limitOrderProblem(draft.monthly, draft.yearly) && (
                    <Text style={limitStyles.problem}>{limitOrderProblem(draft.monthly, draft.yearly)}</Text>
                  )}
                </View>
              )}
            </Card>
          );
        })}

      <AppDialog
        visible={dialog != null}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        actions={[{ label: 'OK', onPress: () => {} }]}
        onClose={() => setDialog(null)}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.lg },
    intro: { ...theme.typography.body, color: theme.colors.slate },
    // One container look: `Card` draws the surface and its Gloss; nothing is
    // layered on top of it here.
    card: { gap: theme.spacing.sm },
    cardTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    body: { ...theme.typography.body, color: theme.colors.slate },
    line: { ...theme.typography.body, color: theme.colors.offWhite },
    loading: { paddingVertical: theme.spacing.lg, alignItems: 'center' },
    pending: {
      gap: theme.spacing.xs,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
    },
    pendingTitle: { ...theme.typography.caption, color: theme.colors.gold },
    editor: { gap: theme.spacing.md },
    codeStep: { gap: theme.spacing.md },
  }),
);
