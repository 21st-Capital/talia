/**
 * The exchanges feeding a portfolio, as a list. The first Kraken build kept
 * ONE link in `exchangeLink`; a phone that still carries it reads the same
 * through here, and the first write moves it into the list.
 */
import type { ExchangeKind, ExchangeLink, WalletMeta } from './types';

export function exchangeLinksOf(wallet: Pick<WalletMeta, 'exchangeLink' | 'exchangeLinks'>): ExchangeLink[] {
  if (wallet.exchangeLinks && wallet.exchangeLinks.length > 0) return wallet.exchangeLinks;
  return wallet.exchangeLink ? [wallet.exchangeLink] : [];
}

export function exchangeLinkOf(
  wallet: Pick<WalletMeta, 'exchangeLink' | 'exchangeLinks'>,
  exchange: ExchangeKind,
): ExchangeLink | undefined {
  return exchangeLinksOf(wallet).find((l) => l.exchange === exchange);
}

/** The list with `link` in place of any link to the same exchange. */
export function withExchangeLink(
  wallet: Pick<WalletMeta, 'exchangeLink' | 'exchangeLinks'>,
  link: ExchangeLink,
): ExchangeLink[] {
  return [...exchangeLinksOf(wallet).filter((l) => l.exchange !== link.exchange), link];
}

/** The list without that exchange. */
export function withoutExchangeLink(
  wallet: Pick<WalletMeta, 'exchangeLink' | 'exchangeLinks'>,
  exchange: ExchangeKind,
): ExchangeLink[] {
  return exchangeLinksOf(wallet).filter((l) => l.exchange !== exchange);
}
