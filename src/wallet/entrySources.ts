/**
 * Where a portfolio entry's bitcoin was bought or sold (decided 2026-10-22,
 * from a client's request: "let the user pick an exchange ... and give also a
 * Peer to Peer option and a custom option for a source we have not listed").
 *
 * ONE list, in the order the picker shows it. Add, remove or rename an
 * exchange here and nowhere else: the picker, the entry page, the CSV and
 * the account statement all read it through this module.
 *
 * An entry stores two optional fields (`ManualEntry.source`,
 * `ManualEntry.sourceName`): the KEY of what was picked and the NAME it was
 * shown under. The name travels with the key on purpose, so an app whose
 * list differs (an older one, or a newer one with more exchanges) still
 * shows the right words. A known key is always shown under the list's
 * current name.
 *
 * Entries an exchange sync wrote before the field existed carry no source;
 * their id says which exchange wrote them (`entryOrigin`), and that is the
 * source they show: every Coinbase fill, and a Kraken TRADE only, never a
 * deposit or a withdrawal (`isKrakenTradeEntry`). Taking that source away
 * stores `NO_SOURCE_KEY`, so the id is not read again; the id is read only
 * while the field was never written.
 *
 * Pure: no storage, no native, no clock.
 */
import { entryOrigin } from './entryDetails';
import { isKrakenTradeEntry } from './entryIds';
import type { ManualEntry } from './manualLedger';

export interface SourceOption {
  /** What an entry stores. Lowercase letters, digits and dashes. */
  key: string;
  /** What the client reads. */
  name: string;
}

/** The exchanges, in the order the picker lists them (decided 2026-10-22). */
export const EXCHANGE_SOURCES: readonly SourceOption[] = [
  { key: 'binance', name: 'Binance' },
  { key: 'coinbase', name: 'Coinbase' },
  { key: 'kraken', name: 'Kraken' },
  { key: 'okx', name: 'OKX' },
  { key: 'bybit', name: 'Bybit' },
  { key: 'bitget', name: 'Bitget' },
  { key: 'upbit', name: 'Upbit' },
  { key: 'kucoin', name: 'KuCoin' },
  { key: 'gateio', name: 'Gate.io' },
  { key: 'htx', name: 'HTX' },
  { key: 'mexc', name: 'MEXC' },
  { key: 'cryptocom', name: 'Crypto.com' },
  { key: 'bitfinex', name: 'Bitfinex' },
  { key: 'bitstamp', name: 'Bitstamp' },
  { key: 'gemini', name: 'Gemini' },
  { key: 'bithumb', name: 'Bithumb' },
  { key: 'bitflyer', name: 'bitFlyer' },
  { key: 'bitvavo', name: 'Bitvavo' },
  { key: 'bitpanda', name: 'Bitpanda' },
  { key: 'robinhood', name: 'Robinhood' },
];

/** Bought from or sold to a person directly. */
export const P2P_SOURCE: SourceOption = { key: 'p2p', name: 'Peer to peer' };

/** A source the list does not name: the client types its name. */
export const OTHER_SOURCE: SourceOption = { key: 'other', name: 'Other' };

/** What an entry stores when the client took away the source its id would
 *  otherwise name (decided 2026-10-22: "No source" on a synced entry must
 *  stick). Never offered in the picker; read as no source everywhere. */
export const NO_SOURCE_KEY = 'none';

/** The longest name a client can type for "Other" (the rule names follow:
 *  one constant, and a hint that reads it). */
export const MAX_SOURCE_NAME_LENGTH = 24;

/** The stored pair, as it goes onto an entry. */
export interface EntrySourceFields {
  source?: string;
  sourceName?: string;
}

const KEY_SHAPE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Letters and digits only, lowercase: "Gate io", "gate.io" and "GATEIO"
 *  all find Gate.io. */
function folded(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * A typed name made fit to keep: spaces trimmed and collapsed, at most
 * `MAX_SOURCE_NAME_LENGTH` characters (counted as the client sees them, so
 * an accented letter or an emoji is one). Empty when nothing is left.
 */
export function cleanSourceName(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, MAX_SOURCE_NAME_LENGTH).join('').trim();
}

function exchangeByKey(key: string): SourceOption | undefined {
  return EXCHANGE_SOURCES.find((o) => o.key === key);
}

/**
 * The picker's rows for what the client typed in its search field: the
 * exchanges whose name matches, in list order, then "Peer to peer" and
 * "Other" ALWAYS, so a source the list does not name can still be recorded.
 */
export function sourcePickerRows(query: string): SourceOption[] {
  const q = folded(query);
  const exchanges = q === '' ? EXCHANGE_SOURCES : EXCHANGE_SOURCES.filter((o) => folded(o.name).includes(q));
  return [...exchanges, P2P_SOURCE, OTHER_SOURCE];
}

/**
 * The fields an entry stores for a pick, or null when the pick cannot be
 * stored: an unknown key, or "Other" with no name typed.
 */
export function sourceFieldsFor(key: string, typedName?: string): Required<EntrySourceFields> | null {
  const exchange = exchangeByKey(key);
  if (exchange) return { source: exchange.key, sourceName: exchange.name };
  if (key === P2P_SOURCE.key) return { source: P2P_SOURCE.key, sourceName: P2P_SOURCE.name };
  if (key === OTHER_SOURCE.key) {
    const name = cleanSourceName(typedName ?? '');
    return name ? { source: OTHER_SOURCE.key, sourceName: name } : null;
  }
  return null;
}

/**
 * The name an entry's source is shown under, or undefined when it has none.
 *
 * A known key reads the list's current name; "Other" and a key this app does
 * not know read the name stored beside it. A trade an exchange sync wrote
 * before sources existed reads that exchange, unless the client took that
 * source away (`NO_SOURCE_KEY`). Anything malformed reads as no source,
 * never as garbage on screen.
 */
export function entrySourceName(
  entry: Pick<ManualEntry, 'id'> & { note?: string; source?: unknown; sourceName?: unknown },
): string | undefined {
  if (entry.source === NO_SOURCE_KEY) return undefined;
  if (typeof entry.source === 'string' && entry.source !== '') {
    const known = exchangeByKey(entry.source);
    if (known) return known.name;
    if (entry.source === P2P_SOURCE.key) return P2P_SOURCE.name;
    const stored = typeof entry.sourceName === 'string' ? cleanSourceName(entry.sourceName) : '';
    return stored || undefined;
  }
  const origin = entryOrigin(entry);
  if (origin.kind !== 'exchange') return undefined;
  if (origin.exchange === 'kraken' && !isKrakenTradeEntry(entry)) return undefined;
  return exchangeByKey(origin.exchange)?.name;
}

/**
 * The pair the entry form opens on: the source the entry's page shows, as a
 * pick (the stored key, or for a synced entry from before sources, its
 * exchange), or nothing.
 */
export function entrySourceFields(
  entry: Pick<ManualEntry, 'id'> & { note?: string; source?: unknown; sourceName?: unknown },
): EntrySourceFields {
  const name = entrySourceName(entry);
  if (!name) return {};
  if (typeof entry.source === 'string' && entry.source !== '') return { source: entry.source, sourceName: name };
  const origin = entryOrigin(entry);
  return origin.kind === 'exchange' ? (sourceFieldsFor(origin.exchange) ?? {}) : {};
}

/**
 * What an entry stores for the form's pick: the pick itself; for no pick,
 * nothing, or `NO_SOURCE_KEY` when the entry's id would otherwise name a
 * source, so "No source" on a synced entry sticks.
 */
export function sourceFieldsToStore(
  entry: Pick<ManualEntry, 'id'> & { note?: string },
  picked: EntrySourceFields,
): EntrySourceFields {
  if (picked.source) return { source: picked.source, sourceName: picked.sourceName };
  return entrySourceName({ id: entry.id, note: entry.note }) ? { source: NO_SOURCE_KEY } : {};
}

/**
 * The source fields of an entry read from somewhere Talia does not control
 * (a backup file, another tool), kept only when they are well formed: a key
 * of the right shape, and for "Other" a name. A bad pair is dropped and the
 * entry kept, as a bad fee is: the source is a detail, never the entry.
 */
export function sanitizeSourceFields(entry: { source?: unknown; sourceName?: unknown }): EntrySourceFields {
  if (typeof entry.source !== 'string' || !KEY_SHAPE.test(entry.source)) return {};
  const name = typeof entry.sourceName === 'string' ? cleanSourceName(entry.sourceName) : '';
  if (entry.source === OTHER_SOURCE.key && !name) return {};
  return name ? { source: entry.source, sourceName: name } : { source: entry.source };
}
