/**
 * Verify external keys (decided 2026-09-07): the key check on the testing call.
 *
 * Before 21st Capital marks a vault tested, the client and a staff member
 * confirm, key by key, that the 21C keys inside the vault really are ours.
 * This screen shows every one of our keys in the vault IN FULL, in coloured
 * groups like an address, so the client can read it out while the staff
 * member shows the same key on a Ledger holding our seed. The client ticks
 * each key once it matches; the tick is recorded with 21st Capital, and the
 * staff member's own tick comes back here, so both sides see both.
 *
 * Reached from the vault's menu, only in the full app, only while signed in,
 * and only until staff mark the vault tested. The keys come from the vault's
 * OWN descriptor; the backend says whose they are. A key it does not know as
 * the client's is shown as a warning, because a key that claims to be ours
 * and is not is exactly what this check exists to catch.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AddressChunks, Button, Card, Gloss, InfoHeading, Screen, cardGlow } from '../components';
import { CircleCheckIcon, WarningIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import { providerKeyRoleLabel, providerKeysOf, useWallets } from '../../wallet';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { SessionExpiredError, fetchKeyVerification } from '../../services/keyVerification';
import type { KeyVerificationEntry, KeyVerificationStatus } from '../../services/keyVerification';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyExternalKeys'>;

/** How often the state is re-read while the screen is open during the call. */
const POLL_MS = 4000;

/**
 * A read never takes away a client tick the phone already holds. The backend
 * never clears that tick, so a read that lacks it is simply OLDER than the
 * tap that set it: a poll sent before the tap and answered after it would
 * otherwise blank the tick for a few seconds (decided 2026-09-07). The staff
 * tick is the read's to give and take, since staff can take theirs back.
 */
function mergeStatus(
  prev: Map<string, KeyVerificationEntry>,
  status: KeyVerificationStatus,
): Map<string, KeyVerificationEntry> {
  return new Map(
    status.keys.map((k) => [
      k.xpub,
      { ...k, clientVerifiedAt: k.clientVerifiedAt ?? prev.get(k.xpub)?.clientVerifiedAt ?? null },
    ]),
  );
}

export function VerifyExternalKeysScreen({ route }: Props): React.JSX.Element {
  const { getWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);
  const { providerFps, settled } = useProviderFingerprints(wallet);
  const ours = useMemo(
    () => (wallet && !wallet.manual ? providerKeysOf(wallet.descriptor, providerFps) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet?.descriptor, wallet?.manual, providerFps],
  );

  /** undefined = not looked yet; null = not signed in. */
  const [session, setSession] = useState<CompanySession | null | undefined>(undefined);
  const [state, setState] = useState<Map<string, KeyVerificationEntry>>(new Map());
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The key whose tick is being confirmed in the dialog. */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await loadSession();
      setSession(s);
      if (!s || ours.length === 0) return;
      const status = await fetchKeyVerification(s, ours.map((k) => k.xpub));
      setState((prev) => mergeStatus(prev, status));
      setUnknown(new Set(status.unknown));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the keys.');
    } finally {
      setLoading(false);
    }
  }, [ours]);

  useEffect(() => {
    // The fingerprint set decides which keys are ours; ask once it is in.
    if (!settled) return;
    void load();
  }, [settled, load]);

  // LIVE during the call (reported 2026-09-07: "the tick did not update in real
  // time"): the staff member's tick lands on the backend while both people
  // are looking at their screens, so this screen re-reads the state every
  // few seconds while it is open and focused, and once more when the app
  // returns to the foreground. Stops once every key carries both ticks.
  const focused = useIsFocused();
  const allDone =
    ours.length > 0 &&
    ours.every((k) => {
      return !!state.get(k.xpub)?.staffVerifiedAt;
    });
  useEffect(() => {
    if (!settled || !session || !focused || allDone || ours.length === 0) return;
    let live = true;
    let inFlight = false;
    const refresh = async () => {
      if (!live || inFlight) return;
      inFlight = true;
      try {
        const status = await fetchKeyVerification(session, ours.map((k) => k.xpub));
        if (!live) return;
        setState((prev) => mergeStatus(prev, status));
        setUnknown(new Set(status.unknown));
      } catch (e) {
        // A missed poll is nothing: the next one, or a tap, reads again. A
        // refused session is not nothing: reload it (loadSession refreshes
        // an expired token), and a fresh one restarts this effect with the
        // new bearer; none left means the sign-in card, not a silent loop.
        if (live && e instanceof SessionExpiredError) {
          const next = await loadSession();
          if (!live) return;
          setSession(next && next.accessToken !== session.accessToken ? next : null);
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void refresh(), POLL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      live = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [settled, session, focused, allDone, ours]);

  if (!wallet) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.muted}>This vault is no longer on this phone.</Text>
      </View>
    );
  }

  const testedAt = [...state.values()].find((e) => e.vault?.testedAt)?.vault?.testedAt ?? null;

  // A read that failed offers Try again in the page's pinned footer (decided
  // 2026-10-05); with nothing to retry there is no footer.
  return (
    <Screen
      scroll
      underHeader
      style={styles.content}
      footer={error ? <Button title="Try again" variant="ghost" onPress={() => void load()} /> : undefined}>
      <InfoHeading
        style={styles.heading}
        title="Why this check"
        text="Your vault holds one or more keys from 21st Capital. On your testing call, read each key out while we show the same key on our own device. When they match, tap Verified. Your tick and ours are both recorded, and once every key is confirmed we mark the vault as tested.">
        Read each key to us on the call
      </InfoHeading>

      {session === null && !loading && (
        <Card style={styles.card}>
          <Text style={styles.muted}>Sign in to your 21st Capital account first.</Text>
        </Card>
      )}

      {ours.length === 0 && settled && !loading && (
        <Card style={styles.card}>
          <Text style={styles.muted}>This vault holds no 21st Capital keys.</Text>
        </Card>
      )}

      {ours.map((key) => {
        const entry = state.get(key.xpub);
        const isUnknown = unknown.has(key.xpub);
        const theirs = !!entry?.staffVerifiedAt;
        return (
          <Card key={key.xpub} style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={styles.keyTitle}>{providerKeyRoleLabel(key.role)}</Text>
              {key.accountIndex != null && (
                <Text style={styles.account}>Account {key.accountIndex}</Text>
              )}
            </View>
            <Text style={styles.origin}>
              [{key.fingerprint}
              {key.originPath ? `/${key.originPath}` : ''}]
            </Text>
            {/* The key in groups of four, as Receive draws an address: the
                one component, so the two cannot drift apart. */}
            <AddressChunks address={key.xpub} />

            {isUnknown ? (
              <View style={styles.warnRow}>
                <WarningIcon size={18} color={theme.colors.gold} />
                <Text style={styles.warnText}>Not registered to your account</Text>
              </View>
            ) : (
              <View style={styles.rows}>
                {/* One way only (decided 2026-09-18): "technically, only we can
                    verify the key and not the client". The client used to
                    have to tick each key here and send it to us, which asked
                    them to attest to something only we can check. They read
                    the key out on the call; we match it on the Ledger and
                    tick it, and this row is where they see that happen. */}
                <View style={styles.row}>
                  <Gloss radius={theme.radius.md} strength={cardGlow()} />
                  <Text style={styles.rowLabel}>Verified by 21st Capital</Text>
                  {theirs ? (
                    <CircleCheckIcon size={22} color={theme.colors.positive} />
                  ) : (
                    <Text style={styles.pending}>{entry ? 'Pending' : ''}</Text>
                  )}
                </View>
              </View>
            )}
          </Card>
        );
      })}

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.slate} />
        </View>
      )}

      {!!error && (
        <Card style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      )}

      {!!testedAt && (
        <Text style={styles.footnote}>This vault is marked as tested.</Text>
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    root: { flex: 1 },
    centered: { alignItems: 'center', justifyContent: 'center' },
    content: { gap: theme.spacing.lg },
    // The page's title, the one title scale.
    heading: { ...theme.typography.title, color: theme.colors.offWhite },
    muted: { ...theme.typography.body, color: theme.colors.slate },
    card: { gap: theme.spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    keyTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    account: { ...theme.typography.label, color: theme.colors.slate },
    origin: { ...theme.typography.mono, color: theme.colors.slate },
    rows: { gap: theme.spacing.sm },
    row: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    rowLabel: { ...theme.typography.bodyStrong, flex: 1, color: theme.colors.offWhite },
    pending: { ...theme.typography.caption, color: theme.colors.slate },
    warnRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    warnText: { ...theme.typography.bodyStrong, color: theme.colors.gold, flex: 1 },
    loading: { paddingVertical: theme.spacing.lg, alignItems: 'center' },
    errorText: { ...theme.typography.body, color: theme.colors.negative },
    footnote: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },
  }),
);
