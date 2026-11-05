/**
 * Addresses — reference design: Used | Unused pill tabs, search, rows with a
 * TX/balance chip, and the address in mono with DIGITS highlighted in gold
 * (easy to eyeball-verify). Tapping a row opens that address's QR page.
 *
 * The saved used list paints at once, a paid address staying paid. The saved
 * unused list waits for the refresh (decided 2026-10-30 after a phone test: an
 * address on it may have been paid since), as Receive's address does, and
 * shows if the refresh fails or takes too long. The refresh, which queues
 * behind syncs on the serial native queue (the old 15-second stall), runs only
 * after a finished sync (decided 2026-10-30): an engine that has not synced
 * answers from index 0, and saving that would turn the used addresses unused.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { Button, Gloss, PageFooter, RefreshIcon, SearchIcon, SegmentedControl, cardGlow } from '../components';
import {
  useWallets,
  addressDigitRuns,
  ADDRESSES_NOT_CHECKED,
  ADDRESS_CHECK_PATIENCE_MS,
  loadAddrCache,
  saveAddrCache,
  loadUtxoCache,
} from '../../wallet';
import type { CachedAddress } from '../../wallet';
import { UNUSED_ADDRESS_COUNT } from '../../config';

type Props = NativeStackScreenProps<RootStackParamList, 'Addresses'>;
type Tab = 'used' | 'unused';

/** The search field's mark, the size of every 18pt row mark. */
const SEARCH_MARK = 18;
/** The empty state's circle and its mark. */
const EMPTY_DISC = 96;
const EMPTY_MARK = 30;
/** Where the empty state starts under the search, so it reads as the list's middle. */
const EMPTY_STATE_TOP = 120;

export function AddressesScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, syncWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);

  const [tab, setTab] = useState<Tab>('unused');
  const [search, setSearch] = useState('');
  const [unused, setUnused] = useState<CachedAddress[]>([]);
  const [used, setUsed] = useState<CachedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** The last refresh did not finish: the saved list stands, if there is one. */
  const [syncFailed, setSyncFailed] = useState(false);

  /** The unused list has come from a finished refresh, or from the saved one. */
  const unusedShown = useRef(false);

  const showSavedUnused = useCallback(async () => {
    if (!wallet) return;
    const saved = await loadAddrCache(wallet.id);
    if (unusedShown.current || !saved?.unused.length) return;
    unusedShown.current = true;
    setUnused(saved.unused);
    setLoading(false);
  }, [wallet]);

  // 1) The used list at once, and the unused one after a while if the refresh
  // has not answered by then.
  useEffect(() => {
    (async () => {
      if (!wallet) return;
      const cache = await loadAddrCache(wallet.id);
      if (cache) setUsed(cache.used);
    })();
    const patience = setTimeout(() => void showSavedUnused(), ADDRESS_CHECK_PATIENCE_MS);
    return () => clearTimeout(patience);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Background refresh once the screen has settled.
  const refresh = useCallback(async () => {
    if (!wallet) return;
    setRefreshing(true);
    setSyncFailed(false);
    try {
      // Boundary correctness needs a sync, but the freshness window makes
      // this free when anything synced in the last minute.
      const engine = await syncWallet(wallet);
      // Balance per address from the UTXO set. When the live set is missing
      // or implausibly empty (an empty set once stamped every funded address
      // "EMPTY" and even persisted the zeros, decided 2026-07-18), fall back to
      // the persisted UTXO cache; with no data at all, keep the previously
      // cached per-address balances instead of overwriting.
      let utxoData: Array<{ address?: string; valueSats: number }> | null = null;
      try {
        utxoData = await engine.listUtxos();
      } catch {
        utxoData = null;
      }
      if ((!utxoData || utxoData.length === 0) && (wallet.cachedBalanceSats ?? 0) > 0) {
        const cachedUtxos = await loadUtxoCache(wallet.id);
        if (cachedUtxos && cachedUtxos.utxos.length > 0) utxoData = cachedUtxos.utxos;
      }
      const haveUtxoData = utxoData != null && utxoData.length > 0;
      const balances = new Map<string, number>();
      for (const u of utxoData ?? []) {
        if (u.address) balances.set(u.address, (balances.get(u.address) ?? 0) + u.valueSats);
      }
      const priorCache = await loadAddrCache(wallet.id);
      const prior = new Map(
        (priorCache?.used ?? []).map((a) => [a.address, a.balanceSats ?? 0]),
      );
      const first = await engine.getReceiveAddress('lastUnused');
      const freshUnused: CachedAddress[] = [];
      for (let i = 0; i < UNUSED_ADDRESS_COUNT; i++) {
        const a = await engine.getReceiveAddress(first.index + i);
        freshUnused.push({ address: a.address, index: a.index });
      }
      const freshUsed: CachedAddress[] = [];
      for (let i = first.index - 1; i >= 0 && freshUsed.length < 50; i--) {
        const a = await engine.getReceiveAddress(i);
        freshUsed.push({
          address: a.address,
          index: a.index,
          balanceSats: haveUtxoData
            ? balances.get(a.address) ?? 0
            : prior.get(a.address) ?? 0,
        });
      }
      unusedShown.current = true;
      setUnused(freshUnused);
      setUsed(freshUsed);
      await saveAddrCache(wallet.id, {
        firstUnused: first.index,
        unused: freshUnused,
        used: freshUsed,
        updatedAt: Date.now(),
      });
    } catch {
      // Whichever step failed, the sync or the engine after it (the new
      // engine can run a sync of its own inside an address call), everything
      // stays as saved: nothing here may come from an engine that did not
      // finish, and the list is written whole or not at all.
      await showSavedUnused();
      setSyncFailed(true);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [wallet, syncWallet, showSavedUnused]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => refresh());
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = useMemo(() => {
    const list = tab === 'unused' ? unused : used;
    const q = search.trim().toLowerCase();
    return q ? list.filter((a) => a.address.toLowerCase().includes(q)) : list;
  }, [tab, unused, used, search]);

  if (!wallet) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Wallet not found.</Text>
      </View>
    );
  }

  // No unused address to show and the refresh failed: nothing can be shown as
  // checked, and "No Addresses Found" would not be true either. A saved used
  // list changes nothing: every saved unused address can sit below it.
  const notChecked = syncFailed && unused.length === 0;

  // Used addresses read dimmed (decided 2026-07-18): they shouldn't be handed
  // out again. In colour (faint text), never opacity on the row.
  const usedTab = tab === 'used';

  return (
    <View style={styles.root}>
      {/* Used | Unused pill tabs */}
      <View style={styles.tabs}>
        <SegmentedControl
          options={[
            { value: 'used', label: 'Used' },
            { value: 'unused', label: 'Unused' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        {/* Drawn, not a glyph: a glyph took the font's weight. */}
        <SearchIcon size={SEARCH_MARK} color={theme.colors.faint} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search…"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={data}
        keyExtractor={(a) => String(a.index)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.colors.gold} style={styles.spinner} />
          ) : notChecked ? (
            <View style={styles.empty}>
              <Text style={styles.emptySub}>{ADDRESSES_NOT_CHECKED}</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyDisc}>
                <Gloss size={EMPTY_DISC} radius={EMPTY_DISC / 2} />
                <RefreshIcon size={EMPTY_MARK} color={theme.colors.faint} />
              </View>
              <Text style={styles.emptyTitle}>No Addresses Found</Text>
              <Text style={styles.emptySub}>Your addresses will appear here.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate('Receive', {
                walletId: wallet.id,
                address: item.address,
                index: item.index,
              })
            }>
            <Gloss radius={theme.radius.md} strength={cardGlow()} />
            <View style={styles.chip}>
              <Text style={[styles.chipText, usedTab && styles.textUsed]}>
                {!usedTab
                  ? '0 TX'
                  : item.balanceSats && item.balanceSats > 0
                    ? shortSats(item.balanceSats)
                    : 'EMPTY'}
              </Text>
            </View>
            {/* No per-row copy button (decided 2026-08-24): copying straight from a
                list is how you hand out the wrong address. The whole row opens
                the address's own QR page, where it is shown in full and can be
                copied deliberately. */}
            <Text style={[styles.address, usedTab && styles.textUsed]}>
              {addressDigitRuns(item.address).map((run, i) => (
                <Text key={i} style={run.digit && !usedTab ? styles.addressDigit : undefined}>
                  {run.text}
                </Text>
              ))}
            </Text>
          </TouchableOpacity>
        )}
      />
      {notChecked && (
        <PageFooter>
          <Button
            title="Try again"
            variant="ghost"
            onPress={() => {
              setLoading(true);
              void refresh();
            }}
          />
        </PageFooter>
      )}
      {refreshing && !loading && (
        <View style={styles.refreshNote}>
          <Gloss radius={theme.radius.pill} strength={cardGlow()} />
          <Text style={styles.refreshText}>Updating…</Text>
        </View>
      )}
    </View>
  );
}

/** Compact sats chip: 12_345 → "12.3K". */
function shortSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return String(sats);
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muted: { ...theme.typography.body, color: theme.colors.slate },

  tabs: {
    marginTop: theme.spacing.lg,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
  },
  // The body token inside a TextInput: iOS crops a lineHeight on an input.
  searchInput: {
    ...theme.typography.body,
    lineHeight: undefined,
    flex: 1,
    paddingVertical: theme.spacing.md,
    color: theme.colors.offWhite,
  },

  list: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  spinner: { marginTop: theme.spacing.xxl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    minWidth: 48,
    alignItems: 'center',
  },
  chipText: { ...theme.typography.label, color: theme.colors.slate },
  address: {
    ...theme.typography.mono,
    flex: 1,
    color: theme.colors.offWhite,
  },
  addressDigit: { color: theme.colors.gold },
  // A used row's text, chip and digits alike.
  textUsed: { color: theme.colors.faint },

  empty: { alignItems: 'center', marginTop: EMPTY_STATE_TOP, gap: theme.spacing.sm },
  emptyDisc: {
    width: EMPTY_DISC,
    height: EMPTY_DISC,
    borderRadius: EMPTY_DISC / 2,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  emptyTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  emptySub: { ...theme.typography.body, color: theme.colors.slate },

  refreshNote: {
    position: 'absolute',
    bottom: theme.spacing.lg,
    alignSelf: 'center',
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
  },
  refreshText: { ...theme.typography.caption, color: theme.colors.slate },
}));
