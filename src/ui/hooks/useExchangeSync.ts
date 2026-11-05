/**
 * One place for "sync this portfolio with <exchange>" so the portfolio
 * screen (automatic check on opening) and the Sync portfolio screen (Sync
 * now, Disconnect) cannot drift. One instance per exchange; state is per
 * screen. The links live on the wallet, the keys in the Keychain.
 */
import { useCallback, useState } from 'react';
import { isSharedViewer, useWallets, exchangeLinkOf, withExchangeLink, withoutExchangeLink } from '../../wallet';
import type { ExchangeKind, ExchangeLink, WalletMeta } from '../../wallet';
import { clearKrakenCredentials, removeKrakenEntries, syncKrakenPortfolio } from '../../services/krakenSync';
import { clearCoinbaseCredentials, removeCoinbaseEntries, syncCoinbasePortfolio } from '../../services/coinbaseSync';

export interface ExchangeSyncState {
  link: ExchangeLink | undefined;
  syncing: boolean;
  /** Last outcome in plain words, or nothing when a quiet check found nothing. */
  note?: string;
  runSync: (quiet: boolean) => Promise<boolean>;
  disconnect: (removeEntries: boolean) => Promise<void>;
}

export const EXCHANGE_NAME: Record<ExchangeKind, string> = { kraken: 'Kraken', coinbase: 'Coinbase' };

const SERVICES = {
  kraken: { sync: syncKrakenPortfolio, clear: clearKrakenCredentials, remove: removeKrakenEntries },
  coinbase: { sync: syncCoinbasePortfolio, clear: clearCoinbaseCredentials, remove: removeCoinbaseEntries },
} as const;

export function useExchangeSync(
  wallet: WalletMeta | undefined,
  exchange: ExchangeKind,
  onChanged?: () => void,
): ExchangeSyncState {
  const { settings, updateWallet, touchManualVault } = useWallets();
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const link = wallet ? exchangeLinkOf(wallet, exchange) : undefined;
  const name = EXCHANGE_NAME[exchange];

  const runSync = useCallback(
    async (quiet: boolean): Promise<boolean> => {
      // A portfolio shared WITH this phone mirrors its owner; an exchange
      // feeding it would write entries that can never be pushed.
      if (!wallet || !link || syncing || isSharedViewer(wallet)) return false;
      const current = link;
      setSyncing(true);
      if (!quiet) setNote(undefined);
      try {
        const r = await SERVICES[exchange].sync(wallet.id, {
          fiat: settings.fiat,
          btcOnly: settings.btcOnly,
          sinceSecs: current.syncedThroughSecs,
        });
        await updateWallet(wallet.id, {
          exchangeLinks: withExchangeLink(wallet, {
            ...current,
            lastSyncAt: Date.now(),
            syncedThroughSecs: r.syncedThroughSecs,
            lastError: undefined,
          }),
          exchangeLink: undefined,
        });
        if (r.added > 0) touchManualVault(wallet.id);
        onChanged?.();
        setNote(r.added === 0 ? (quiet ? undefined : `Nothing new on ${name}.`) : `${r.added} new from ${name}.`);
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : `Could not sync with ${name}.`;
        setNote(message);
        await updateWallet(wallet.id, {
          exchangeLinks: withExchangeLink(wallet, { ...current, lastError: message }),
          exchangeLink: undefined,
        });
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [wallet, link, exchange, name, syncing, settings.fiat, settings.btcOnly, updateWallet, touchManualVault, onChanged],
  );

  const disconnect = useCallback(
    async (removeEntries: boolean): Promise<void> => {
      if (!wallet) return;
      // Nothing in a member's copy is theirs to remove (decided 2026-09-14).
      if (isSharedViewer(wallet)) return;
      await SERVICES[exchange].clear(wallet.id);
      if (removeEntries) await SERVICES[exchange].remove(wallet.id);
      await updateWallet(wallet.id, { exchangeLinks: withoutExchangeLink(wallet, exchange), exchangeLink: undefined });
      touchManualVault(wallet.id);
      setNote(undefined);
      onChanged?.();
    },
    [wallet, exchange, updateWallet, touchManualVault, onChanged],
  );

  return { link, syncing, note, runSync, disconnect };
}
