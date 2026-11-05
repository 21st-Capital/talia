/**
 * The wallet's spending policy, made SUPER readable (as asked for: Liana's
 * prose version is hard to parse): a timeline graphic showing when each
 * path opens, then one card per path with a plain-English requirement and
 * the keys as chips. Falls back to the raw descriptor for exotic scripts.
 * The picture itself lives in `PolicyOverview` (shared with the Estate
 * Plan wizard, decided 2026-09-01); this screen adds the intro, the key-label
 * editor and the raw-descriptor fallback.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AdvancedVaultDetails, AppDialog, Button, Card, PolicyOverview, Screen } from '../components';
import { WarningIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import { keyDisplayName, useWallets } from '../../wallet';
import { agedExpiryBlocks, pathExpiryBlocks } from '../../wallet/timelock';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { minOlderBlocks, parsePolicy } from '../../bitcoin/descriptor';
import { isProviderRescuePath, pathStillShut } from '../../wallet/policyPathState';
import { useCachedRescueReadiness } from '../hooks/useCachedRescueReadiness';
import { fetchKeyEntitlement, loadSession } from '../../services/companyAuth';
import { paidForByName } from '../../services/vaultHolders';

type Props = NativeStackScreenProps<RootStackParamList, 'Policy'>;

export function PolicyScreen({ navigation, route }: Props): React.JSX.Element {
  const { getWallet, updateWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);
  /** Fingerprint currently being labelled (key-label editor dialog). */
  const [labelFp, setLabelFp] = useState<string | null>(null);
  /** 21st Capital's issued keys: named by us, not renameable by the client
   *  (decided 2026-07-27). Uses the LIVE known-fingerprint set as well as the
   *  vault's tag, so legacy/archived keys in an imported vault count too. */
  const { isProviderKey } = useProviderFingerprints(wallet);

  const policy = useMemo(
    () => (wallet ? parsePolicy(wallet.descriptor) : null),
    [wallet],
  );

  // The full time left until each timelocked path opens lives HERE at all
  // times (decided 2026-09-12); the vault screen only shows it in the last three
  // months. Seeded from the persisted nearest-expiry cache, aged at one block
  // per ten minutes, and re-aged every minute while the screen is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);
  /**
   * Our own rescue path, and whether this vault can ACTUALLY be rescued
   * right now. A rescue moves every coin, so one coin still locked means no,
   * whatever the path's own clock says: `nextOpening` is the SOONEST coin
   * and the rescue needs the last one.
   *
   * Read from this phone's own cache, so it is known before the screen
   * paints (decided 2026-09-23: "the button should ONLY be clickable if the vault
   * is fully ready ... letting him click something and then wait makes no
   * sense"). Not ready, or not known, means no button.
   */
  const ourRescuePath = useMemo(
    () => policy?.paths.find((p) => isProviderRescuePath(p, isProviderKey)),
    [policy, isProviderKey],
  );
  const rescueReady = useCachedRescueReadiness(wallet?.id, ourRescuePath?.olderBlocks);

  const nextOpening = useMemo(() => {
    if (!wallet || !policy) return undefined;
    const minOlder = minOlderBlocks(wallet.descriptor);
    if (minOlder == null) return undefined;
    const nearest = agedExpiryBlocks(wallet.cachedExpiryBlocks, wallet.cachedExpiryAt, now);
    const out: Record<number, number | null> = {};
    for (const p of policy.paths) {
      if (p.olderBlocks === undefined) continue;
      out[p.olderBlocks] = pathExpiryBlocks(nearest, minOlder, p.olderBlocks);
    }
    return out;
  }, [wallet, policy, now]);

  // "Paid for by Toni" (decided 2026-09-20), in the folded Advanced card only. The
  // wallet recorded the payer's email when it was built; the name comes from
  // the entitlement when the phone is signed in and online, else the email.
  const heldOf = wallet?.heldOf;
  const heldNetwork = wallet?.network;
  const [paidForBy, setPaidForBy] = useState<string | null>(() => paidForByName(heldOf));
  useEffect(() => {
    setPaidForBy(paidForByName(heldOf));
    if (!heldOf) return;
    let live = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const ent = await fetchKeyEntitlement(session, heldNetwork === 'bitcoin' ? 'mainnet' : 'testnet4');
        if (live) setPaidForBy(paidForByName(heldOf, ent.holdings));
      } catch {
        // best effort: the email already stands in the row
      }
    })();
    return () => {
      live = false;
    };
  }, [heldOf, heldNetwork]);

  if (!wallet || !policy || policy.paths.length === 0) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.muted}>No policy information available.</Text>
      </View>
    );
  }

  // What the naming hint may promise: a chip is tappable only when it has a
  // fingerprint and is not ours (PolicyOverview's own `editable` rule), so a
  // bare-key vault with no origin has nothing to tap.
  const policyKeys = policy.paths.flatMap((p) => p.groups.flatMap((g) => g.keys));
  const holdsOurKey = policyKeys.some((k) => isProviderKey(k.fingerprint));
  const anyNameable = policyKeys.some((k) => !!k.fingerprint && !isProviderKey(k.fingerprint));

  // The page's one action, pinned at its foot (decided 2026-10-05): straight to
  // THIS vault's rescue, and only when every coin has reached our rescue path
  // (decided 2026-09-23). No button at all otherwise: a button that leads to a
  // wait is worse than no button. The path's own clock counts too, as it did
  // while the button sat in the path's card.
  const rescueOffered =
    rescueReady?.state === 'ready' && ourRescuePath != null && !pathStillShut(ourRescuePath, nextOpening);

  return (
    <Screen
      scroll
      underHeader
      style={styles.content}
      footer={
        rescueOffered ? (
          <Button
            title="Ask 21st Capital to rescue this vault"
            onPress={() => navigation.navigate('Rescue', { walletId: wallet.id })}
          />
        ) : undefined
      }>
      <Text style={styles.intro}>
        How money can leave <Text style={styles.introBold}>“{wallet.label}”</Text>
      </Text>

      <PolicyOverview
        wallet={wallet}
        isProviderKey={isProviderKey}
        onPressKey={setLabelFp}
        nextOpening={nextOpening}
        refreshAdvised={!wallet.heirVault}
      />

      {/* Never "your keys" (decided 2026-09-22): every key but ours can be
          named, and on an heir's phone that includes the owner's keys, on
          the owner's phone an heir's. The line about our keys only where the
          vault holds one. */}
      {anyNameable && (
        <Text style={styles.labelHint}>
          Tap a key to give it a name.
          {holdsOurKey ? " 21st Capital's own keys are named by us." : ''}
        </Text>
      )}

      <AppDialog
        visible={labelFp !== null}
        title="Name this key"
        message={labelFp ? `Key fingerprint ${labelFp}.` : undefined}
        input={{
          label: 'Key name',
          placeholder: 'e.g. My hardware wallet',
          autoCapitalize: 'sentences',
          // The name it carries, so a rename starts from what is on screen
          // rather than an empty field; emptying it goes back to Key 1, Key 2
          // (decided 2026-09-26), never to the fingerprint.
          defaultValue: labelFp ? keyDisplayName(wallet, labelFp, isProviderKey) ?? '' : '',
        }}
        actions={[
          {
            label: 'Save',
            onPress: (value) => {
              if (!labelFp) return;
              const next = { ...(wallet.keyLabels ?? {}) };
              if (value.trim()) next[labelFp] = value.trim();
              else delete next[labelFp];
              void updateWallet(wallet.id, { keyLabels: next });
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setLabelFp(null)}
      />

      {/* Folded away, and silent until opened: the screen above answers "how
          can money leave this vault", which is a different question from the
          script type and the descriptor (decided 2026-09-01). */}
      <AdvancedVaultDetails
        descriptor={wallet.descriptor}
        network={wallet.network}
        keyLabels={wallet.keyLabels}
        accountNumber={wallet.accountNumber}
        vaultNumber={wallet.vaultNumber}
        paidForBy={paidForBy}
        isProviderKey={isProviderKey}
      />

      {!policy.exact && (
        <Card style={styles.rawCard}>
          <View style={styles.rawNoteRow}>
            <WarningIcon size={16} color={theme.colors.gold} />
            <Text style={styles.rawNote}>
              This wallet's script is more intricate than the summary above.
              The keys are listed, but check the full descriptor:
            </Text>
          </View>
          <Text style={styles.raw} selectable>
            {wallet.descriptor}
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  content: { gap: theme.spacing.lg },

  intro: { ...theme.typography.body, color: theme.colors.slate },
  introBold: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },

  labelHint: { ...theme.typography.caption, color: theme.colors.faint },
  rawCard: { gap: theme.spacing.sm },
  rawNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  rawNote: { flex: 1, ...theme.typography.caption, color: theme.colors.gold },
  raw: { ...theme.typography.mono, color: theme.colors.slate },
}));
