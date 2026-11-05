/**
 * Pure display formatting helpers for amounts. Kept pure and unit-tested.
 */
import type { Sats } from '../bitcoin/engine/types';

/** Group digits with thin separators: 1234567 -> "1,234,567". */
export function groupDigits(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.trunc(n)).toString();
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/** Format a sat amount, e.g. `formatSats(150000)` -> "150,000 sats". */
export function formatSats(sats: Sats): string {
  const unit = Math.abs(sats) === 1 ? 'sat' : 'sats';
  return `${groupDigits(sats)} ${unit}`;
}

/** Format sats as BTC with 8 dp, trimming trailing zeros: 150000 -> "0.0015". */
export function formatBtc(sats: Sats): string {
  const neg = sats < 0;
  const abs = Math.abs(sats);
  const btc = Math.floor(abs / 1e8);
  const rem = (abs % 1e8).toString().padStart(8, '0').replace(/0+$/, '');
  const body = rem.length ? `${btc}.${rem}` : `${btc}`;
  return `${neg ? '-' : ''}${body} BTC`;
}

/** A signed amount with an explicit +/- prefix, for tx rows. */
export function formatSignedSats(sats: Sats): string {
  const sign = sats > 0 ? '+' : '';
  return `${sign}${formatSats(sats)}`;
}

/** Format an amount in the user's chosen unit. */
/** Auto unit switches to BTC at 0.1 BTC (decided 2026-07-19). */
export const AUTO_BTC_THRESHOLD: Sats = 10_000_000;

/** Resolve 'auto' per amount: >= 0.1 BTC reads as BTC, below as sats. */
export function resolveUnit(sats: Sats, unit: 'btc' | 'sats' | 'auto'): 'btc' | 'sats' {
  if (unit !== 'auto') return unit;
  return Math.abs(sats) >= AUTO_BTC_THRESHOLD ? 'btc' : 'sats';
}

export function formatAmount(sats: Sats, unit: 'btc' | 'sats' | 'auto'): string {
  return resolveUnit(sats, unit) === 'btc' ? formatBtc(sats) : formatSats(sats);
}

/** Signed variant of formatAmount, for tx rows. */
export function formatSignedAmount(sats: Sats, unit: 'btc' | 'sats' | 'auto'): string {
  if (resolveUnit(sats, unit) === 'sats') return formatSignedSats(sats);
  const sign = sats > 0 ? '+' : '';
  return `${sign}${formatBtc(sats)}`;
}

/**
 * Card-style amount without a unit suffix (the ticker lives elsewhere).
 * BTC uses full 8 decimals with satoshi digit grouping — 20734954 sats →
 * "0.20 734 954" — matching the ledger-style card design.
 */
export function formatCardAmount(sats: Sats, unit: 'btc' | 'sats' | 'auto'): string {
  if (resolveUnit(sats, unit) === 'sats') return groupDigits(sats);
  const neg = sats < 0 ? '-' : '';
  const abs = Math.abs(sats);
  const btcInt = groupDigits(Math.floor(abs / 1e8));
  const dec = (abs % 1e8).toString().padStart(8, '0');
    const thin = '\u2009'; // thin space — ledger-style digit grouping
  return `${neg}${btcInt}.${dec.slice(0, 2)}${thin}${dec.slice(2, 5)}${thin}${dec.slice(5, 8)}`;
}

/**
 * Split an address into fixed-size chunks for readable display
 * ("bc1q 3t3r 2qff …") — eases visual verification against a hardware wallet.
 */
export function chunkAddress(address: string, size = 4): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < address.length; i += size) {
    chunks.push(address.slice(i, i + size));
  }
  return chunks;
}

/**
 * Split an address into runs of digits / non-digits so the UI can highlight
 * the numbers (much easier to eyeball-verify, per the reference design).
 */
export function addressDigitRuns(address: string): Array<{ text: string; digit: boolean }> {
  const runs: Array<{ text: string; digit: boolean }> = [];
  for (const ch of address) {
    const digit = ch >= '0' && ch <= '9';
    const last = runs[runs.length - 1];
    if (last && last.digit === digit) last.text += ch;
    else runs.push({ text: ch, digit });
  }
  return runs;
}
