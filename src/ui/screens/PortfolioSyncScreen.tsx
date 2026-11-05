/**
 * Sync portfolio (decided 2026-09-07): where a portfolio's SOURCES live. A source
 * is a vault within Talia (its real deposits and withdrawals arrive as
 * entries, first from the vault's history, then automatically) or an
 * exchange (Kraken first; the key stays on this phone). Several sources can
 * feed one portfolio; the cost was accepted, which is that two sources can
 * describe the same coins, and the InfoDot says so.
 *
 * Reached from the portfolio's ⋯ menu, the same way a vault's tools are.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import {
  AppDialog,
  ChevronRightIcon,
  ExchangeTile,
  Gloss,
  InfoHeading,
  Screen,
  VaultIcon,
  WalletIconTile,
  cardGlow,
  walletIconFor,
} from '../components';
import { useExchangeSync, EXCHANGE_NAME } from '../hooks/useExchangeSync';
import type { ExchangeSyncState } from '../hooks/useExchangeSync';
import {
  isSharedViewer,
  formatRelativeTime,
  snapshotOutcomeMessage,
  snapshotVaultIntoPortfolio,
  useWallets,
} from '../../wallet';
import type { ExchangeKind, WalletMeta } from '../../wallet';

type Props = NativeStackScreenProps<VirtualStackParamList, 'PortfolioSync'>;

export function PortfolioSyncScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId } = route.params;
  const { wallets, getWallet, settings, updateWallet, touchManualVault } = useWallets();
  const wallet = getWallet(walletId);
  const kraken = useExchangeSync(wallet, 'kraken');
  const coinbase = useExchangeSync(wallet, 'coinbase');
  const exchanges: Array<{ kind: ExchangeKind; state: ExchangeSyncState }> = [
    { kind: 'kraken', state: kraken },
    { kind: 'coinbase', state: coinbase },
  ];

  const linkedVaults = useMemo(
    () => wallets.filter((w) => !w.manual && w.linkedPortfolioId === walletId),
    [wallets, walletId],
  );
  // A portfolio shared WITH this phone is read here too: no vault feeds it
  // and no exchange connects to it, because only the owner's copy is pushed
  // (decided 2026-09-14).
  const viewer = isSharedViewer(wallet);
  const candidates = useMemo(
    () => (viewer ? [] : wallets.filter((w) => !w.manual && w.linkedPortfolioId !== walletId)),
    [viewer, wallets, walletId],
  );

  const [vaultPicker, setVaultPicker] = useState(false);
  const [busyVault, setBusyVault] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [exchangeMenu, setExchangeMenu] = useState<{ kind: ExchangeKind; step: 'menu' | 'disconnect' } | null>(null);
  const [unlinkFor, setUnlinkFor] = useState<WalletMeta | null>(null);

  const addVault = async (vault: WalletMeta): Promise<void> => {
    setVaultPicker(false);
    setBusyVault(vault.id);
    setNotice(undefined);
    try {
      // Link first, so activity that lands while the history is being
      // copied is not missed; the deterministic ids make any overlap safe.
      await updateWallet(vault.id, { linkedPortfolioId: walletId });
      const outcome = await snapshotVaultIntoPortfolio({
        vaultId: vault.id,
        portfolioId: walletId,
        fiat: settings.fiat,
        btcOnly: settings.btcOnly,
        onEstimated: () => touchManualVault(walletId),
      });
      if (outcome.ok) touchManualVault(walletId);
      setNotice(snapshotOutcomeMessage(outcome, vault.label));
    } catch {
      setNotice(`Could not add ${vault.label}. Please try again.`);
    } finally {
      setBusyVault(null);
    }
  };

  const unlinkVault = async (vault: WalletMeta): Promise<void> => {
    setUnlinkFor(null);
    await updateWallet(vault.id, { linkedPortfolioId: undefined });
    setNotice(`${vault.label} no longer feeds this portfolio. Its entries stay.`);
  };

  if (!wallet) {
    return (
      <Screen>
        <Text style={styles.muted}>Portfolio not found.</Text>
      </Screen>
    );
  }

  const statusOf = (x: ExchangeSyncState): string =>
    x.syncing
      ? 'Checking now'
      : x.note ??
        x.link?.lastError ??
        (x.link?.lastSyncAt ? `Synced ${formatRelativeTime(x.link.lastSyncAt / 1000)}` : 'Not synced yet');
  const connected = exchanges.filter((x) => x.state.link != null);
  const available = exchanges.filter((x) => x.state.link == null);
  const hasSources = linkedVaults.length > 0 || connected.length > 0;
  const menuState = exchangeMenu ? exchanges.find((x) => x.kind === exchangeMenu.kind)?.state : undefined;

  if (viewer) {
    // Nothing to connect on a portfolio this phone only reads.
    return (
      <Screen scroll>
        <View style={styles.body}>
          <InfoHeading
            title="Sources"
            style={styles.intro}
            text="The owner keeps this portfolio up to date from their vaults and exchanges. Your copy mirrors it and takes no sources of its own.">
            Shared with you. Only the owner adds sources.
          </InfoHeading>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.body}>
        <InfoHeading
          title="Sources"
          style={styles.intro}
          text="A vault in Talia adds its real deposits and withdrawals, first from its history and then as they happen. An exchange adds its trades, deposits and withdrawals. Several sources can feed one portfolio, but two of them can describe the same coins: a withdrawal from Kraken into one of your vaults appears from both sides. Remove the entry you do not want, or keep one source.">
          Keep this portfolio up to date from your vaults and exchanges.
        </InfoHeading>

        {hasSources && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connected</Text>
            <View style={styles.cardGroup}>
              {connected.map(({ kind, state }) => (
                <SourceRow
                  key={kind}
                  tile={<ExchangeTile exchange={kind} />}
                  title={state.link?.sandbox ? `${EXCHANGE_NAME[kind]} sandbox` : EXCHANGE_NAME[kind]}
                  subtitle={statusOf(state)}
                  tone={state.link?.lastError && !state.syncing ? 'warn' : 'ok'}
                  onPress={() => setExchangeMenu({ kind, step: 'menu' })}
                  disabled={state.syncing}
                />
              ))}
              {linkedVaults.map((v) => (
                <SourceRow
                  key={v.id}
                  tile={<WalletIconTile icon={walletIconFor(v)} size={44} />}
                  title={v.label}
                  subtitle={busyVault === v.id ? 'Adding its history' : 'New activity is added automatically'}
                  tone="ok"
                  onPress={() => setUnlinkFor(v)}
                  disabled={busyVault === v.id}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{hasSources ? 'Add another source' : 'Add a source'}</Text>
          <View style={styles.cardGroup}>
            <SourceRow
              tile={
                <View style={styles.vaultTile}>
                  <Gloss size={44} radius={theme.radius.md} />
                  <VaultIcon size={26} color={theme.colors.accent} />
                </View>
              }
              title="A vault in Talia"
              subtitle={
                candidates.length === 0
                  ? 'Every vault already feeds this portfolio'
                  : candidates.length === 1
                    ? '1 vault available'
                    : `${candidates.length} vaults available`
              }
              onPress={() => setVaultPicker(true)}
              disabled={candidates.length === 0 || busyVault != null}
            />
            {available.map(({ kind }) => (
              <SourceRow
                key={kind}
                tile={<ExchangeTile exchange={kind} />}
                title={EXCHANGE_NAME[kind]}
                subtitle={kind === 'kraken' ? 'Trades, deposits and withdrawals' : 'Trades'}
                onPress={() =>
                  navigation.navigate(kind === 'kraken' ? 'KrakenConnect' : 'CoinbaseConnect', { walletId })
                }
              />
            ))}
          </View>
          {hasSources && <Text style={styles.notice}>Tap a source for Sync now or Disconnect.</Text>}
        </View>

        {notice && <Text style={styles.notice}>{notice}</Text>}
      </View>

      <AppDialog
        visible={vaultPicker}
        title="Which vault?"
        actions={[
          ...candidates.map((v) => ({
            label:
              v.linkedPortfolioId != null
                ? `${v.label}  (feeds ${wallets.find((w) => w.id === v.linkedPortfolioId)?.label ?? 'another portfolio'})`
                : v.label,
            onPress: () => void addVault(v),
          })),
          { label: 'Cancel', variant: 'ghost' as const, onPress: () => setVaultPicker(false) },
        ]}
        onClose={() => setVaultPicker(false)}
      />
      <AppDialog
        visible={exchangeMenu?.step === 'menu'}
        title={exchangeMenu ? EXCHANGE_NAME[exchangeMenu.kind] : ''}
        actions={[
          {
            label: 'Sync now',
            onPress: () => {
              setExchangeMenu(null);
              void menuState?.runSync(false);
            },
          },
          {
            label: 'Disconnect',
            destructive: true,
            onPress: () => exchangeMenu && setExchangeMenu({ kind: exchangeMenu.kind, step: 'disconnect' }),
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setExchangeMenu(null) },
        ]}
        onClose={() => setExchangeMenu(null)}
      />
      <AppDialog
        visible={exchangeMenu?.step === 'disconnect'}
        title={exchangeMenu ? `Disconnect ${EXCHANGE_NAME[exchangeMenu.kind]}?` : ''}
        actions={[
          {
            label: 'Keep the entries',
            onPress: () => {
              setExchangeMenu(null);
              void menuState?.disconnect(false);
            },
          },
          {
            label: 'Remove the entries',
            destructive: true,
            onPress: () => {
              setExchangeMenu(null);
              void menuState?.disconnect(true);
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setExchangeMenu(null) },
        ]}
        onClose={() => setExchangeMenu(null)}
      />
      <AppDialog
        visible={unlinkFor != null}
        title={unlinkFor ? `Stop syncing from ${unlinkFor.label}?` : ''}
        actions={[
          { label: 'Stop syncing', destructive: true, onPress: () => unlinkFor && void unlinkVault(unlinkFor) },
          { label: 'Cancel', variant: 'ghost', onPress: () => setUnlinkFor(null) },
        ]}
        onClose={() => setUnlinkFor(null)}
      />
    </Screen>
  );
}

/** One source: a mark on the left, a name and a status line, a chevron. */
function SourceRow({
  tile,
  title,
  subtitle,
  tone,
  onPress,
  disabled,
}: {
  tile: React.ReactNode;
  title: string;
  subtitle: string;
  tone?: 'ok' | 'warn';
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      {tile}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, disabled && styles.rowTitleDisabled]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[styles.rowSubtitle, tone === 'ok' && styles.rowOk, tone === 'warn' && styles.rowWarn]}
          numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <ChevronRightIcon size={18} color={theme.colors.faint} />
    </TouchableOpacity>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // `lg` between sections, as on every page; the Screen pads the safe area.
    body: { gap: theme.spacing.lg },
    intro: { ...theme.typography.body, color: theme.colors.slate },
    muted: { ...theme.typography.body, color: theme.colors.slate },
    section: { gap: theme.spacing.sm },
    sectionTitle: { ...theme.typography.label, color: theme.colors.faint, letterSpacing: 1, textTransform: 'uppercase' },
    cardGroup: { gap: theme.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
    },
    // In colour, never `opacity` on the touchable itself (decided 2026-09-16).
    rowTitleDisabled: { color: theme.colors.faint },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    rowSubtitle: { ...theme.typography.caption, color: theme.colors.slate },
    rowOk: { color: theme.colors.positive },
    rowWarn: { color: theme.colors.warning },
    vaultTile: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceRaised,
    },
    notice: { ...theme.typography.caption, color: theme.colors.slate },
  }),
);
