/**
 * Where an entry's bitcoin was bought or sold (decided 2026-10-22): one list
 * of twenty exchanges in a set order, then Peer to peer, then Other with a
 * typed name. Exchange syncs name their exchange by themselves; a vault
 * snapshot names none.
 */
import {
  EXCHANGE_SOURCES,
  MAX_SOURCE_NAME_LENGTH,
  OTHER_SOURCE,
  P2P_SOURCE,
  NO_SOURCE_KEY,
  cleanSourceName,
  entrySourceFields,
  entrySourceName,
  sanitizeSourceFields,
  sourceFieldsFor,
  sourceFieldsToStore,
  sourcePickerRows,
} from '../entrySources';
import { krakenLedgerToEntries, krakenTradesToEntries } from '../../exchanges/kraken';
import type { KrakenLedgerRow, KrakenTrade } from '../../exchanges/kraken';
import { coinbaseFillsToEntries } from '../../exchanges/coinbase';
import { toManualEntries } from '../vaultToPortfolio';
import { isKrakenTradeEntry } from '../entryIds';

const NOW = 1_757_000_000_000;

describe('the list', () => {
  it('is the twenty exchanges, in the order they were asked for', () => {
    expect(EXCHANGE_SOURCES.map((o) => o.name)).toEqual([
      'Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitget', 'Upbit', 'KuCoin', 'Gate.io', 'HTX',
      'MEXC', 'Crypto.com', 'Bitfinex', 'Bitstamp', 'Gemini', 'Bithumb', 'bitFlyer', 'Bitvavo', 'Bitpanda', 'Robinhood',
    ]);
  });

  it('has one key per row, each of the stored shape, none taken by Peer to peer or Other', () => {
    const keys = [...EXCHANGE_SOURCES, P2P_SOURCE, OTHER_SOURCE].map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
  });

  it('the exchanges a sync can write are in it under their own keys', () => {
    expect(EXCHANGE_SOURCES.find((o) => o.key === 'kraken')?.name).toBe('Kraken');
    expect(EXCHANGE_SOURCES.find((o) => o.key === 'coinbase')?.name).toBe('Coinbase');
  });
});

describe('the picker rows', () => {
  it('show every exchange, then Peer to peer, then Other, with nothing typed', () => {
    const rows = sourcePickerRows('');
    expect(rows).toHaveLength(22);
    expect(rows.slice(-2)).toEqual([P2P_SOURCE, OTHER_SOURCE]);
    expect(rows.slice(0, 20)).toEqual([...EXCHANGE_SOURCES]);
  });

  it('search by name, whatever the case, spaces or dots', () => {
    const names = (q: string) => sourcePickerRows(q).map((o) => o.name);
    expect(names('gate io')).toEqual(['Gate.io', 'Peer to peer', 'Other']);
    expect(names('cryptocom')).toEqual(['Crypto.com', 'Peer to peer', 'Other']);
    expect(names('BITFLYER')).toEqual(['bitFlyer', 'Peer to peer', 'Other']);
    expect(names('bit')).toEqual(['Bybit', 'Bitget', 'Upbit', 'Bitfinex', 'Bitstamp', 'Bithumb', 'bitFlyer', 'Bitvavo', 'Bitpanda', 'Peer to peer', 'Other']);
  });

  it('keep Peer to peer and Other when nothing matches, so any source can be recorded', () => {
    expect(sourcePickerRows('Bisq')).toEqual([P2P_SOURCE, OTHER_SOURCE]);
  });
});

describe('a pick', () => {
  it('stores the key and the name it was shown under', () => {
    expect(sourceFieldsFor('bitvavo')).toEqual({ source: 'bitvavo', sourceName: 'Bitvavo' });
    expect(sourceFieldsFor('p2p')).toEqual({ source: 'p2p', sourceName: 'Peer to peer' });
  });

  it('Other stores the typed name, tidied and capped', () => {
    expect(sourceFieldsFor('other', '  Bitcoin   ATM  ')).toEqual({ source: 'other', sourceName: 'Bitcoin ATM' });
    const long = 'A local meetup in the old town square';
    const kept = sourceFieldsFor('other', long)?.sourceName ?? '';
    expect(Array.from(kept).length).toBeLessThanOrEqual(MAX_SOURCE_NAME_LENGTH);
    expect(long.startsWith(kept)).toBe(true);
  });

  it('Other with no name, or a key not in the list, stores nothing', () => {
    expect(sourceFieldsFor('other', '   ')).toBeNull();
    expect(sourceFieldsFor('other')).toBeNull();
    expect(sourceFieldsFor('not-an-exchange')).toBeNull();
  });

  it('counts a name in the characters a client sees', () => {
    const name = 'Café 🙂'.repeat(10);
    const kept = cleanSourceName(name);
    expect(Array.from(kept)).toHaveLength(MAX_SOURCE_NAME_LENGTH);
    // Never half a character.
    expect(kept).toBe(Array.from(name).slice(0, MAX_SOURCE_NAME_LENGTH).join(''));
  });
});

describe('the name an entry shows', () => {
  const base = { id: 'e1' };
  it('a known key reads the list, whatever name was stored beside it', () => {
    expect(entrySourceName({ ...base, source: 'gateio', sourceName: 'Gate' })).toBe('Gate.io');
    expect(entrySourceName({ ...base, source: 'p2p' })).toBe('Peer to peer');
  });

  it('Other, and a key from a newer list, read the stored name', () => {
    expect(entrySourceName({ ...base, source: 'other', sourceName: 'Bisq' })).toBe('Bisq');
    expect(entrySourceName({ ...base, source: 'bitmart', sourceName: 'BitMart' })).toBe('BitMart');
    expect(entrySourceName({ ...base, source: 'bitmart' })).toBeUndefined();
  });

  it('nothing for an entry without one, or with a damaged one', () => {
    expect(entrySourceName(base)).toBeUndefined();
    expect(entrySourceName({ ...base, source: 7, sourceName: 'x' })).toBeUndefined();
    expect(entrySourceName({ ...base, source: 'other', sourceName: 42 })).toBeUndefined();
  });

  it('an exchange-sync trade from before sources names its exchange', () => {
    expect(entrySourceName({ id: 'kraken-TX1' })).toBe('Kraken');
    expect(entrySourceName({ id: 'coinbase-f8b3' })).toBe('Coinbase');
    // A vault snapshot has no source.
    expect(entrySourceName({ id: 'vsnap-w_abcdef-0123456789abcdef' })).toBeUndefined();
  });

  it('a Kraken deposit or withdrawal from before sources names none: nothing was bought or sold there', () => {
    const note = (kind: 'Deposit to' | 'Withdrawal from') => `${kind} Kraken. Price estimated at that day’s market rate.`;
    expect(entrySourceName({ id: 'kraken-LQ2QSY-ABCDE-FGHIJK', note: note('Deposit to') })).toBeUndefined();
    expect(entrySourceName({ id: 'kraken-LQ2QSY-ABCDE-FGHIJK', note: 'My own words' })).toBeUndefined();
    // Either mark is enough: the note the sync wrote, or Kraken's ledger id.
    expect(entrySourceName({ id: 'kraken-TX1', note: note('Withdrawal from') })).toBeUndefined();
    // An id Kraken's naming does not explain is not taken for a trade.
    expect(entrySourceName({ id: 'kraken-QX1' })).toBeUndefined();
    expect(isKrakenTradeEntry({ id: 'kraken-TX1', note: 'Kraken trade.' })).toBe(true);
  });
});

describe('"No source" on an entry whose id names one', () => {
  const synced = { id: 'kraken-TX1' };

  it('is stored, so the id does not name the exchange again', () => {
    expect(sourceFieldsToStore(synced, {})).toEqual({ source: NO_SOURCE_KEY });
    expect(entrySourceName({ ...synced, source: NO_SOURCE_KEY })).toBeUndefined();
    expect(entrySourceFields({ ...synced, source: NO_SOURCE_KEY })).toEqual({});
    // The marker survives a backup file and a sync like any other key.
    expect(sanitizeSourceFields({ source: NO_SOURCE_KEY })).toEqual({ source: NO_SOURCE_KEY });
  });

  it('stores nothing where there is nothing to take away', () => {
    expect(sourceFieldsToStore({ id: 'mgx-1' }, {})).toEqual({});
    expect(sourceFieldsToStore({ id: 'kraken-LQ2QSY-ABCDE-FGHIJK', note: 'Deposit to Kraken. Price estimated.' }, {})).toEqual({});
    expect(sourceFieldsToStore({ id: 'vsnap-w_abcdef-0123456789abcdef' }, {})).toEqual({});
  });

  it('a pick is stored as picked', () => {
    expect(sourceFieldsToStore(synced, { source: 'binance', sourceName: 'Binance' })).toEqual({ source: 'binance', sourceName: 'Binance' });
  });

  it('the form opens on the source the page shows', () => {
    expect(entrySourceFields(synced)).toEqual(sourceFieldsFor('kraken'));
    expect(entrySourceFields({ id: 'mgx-1', source: 'other', sourceName: 'Bisq' })).toEqual({ source: 'other', sourceName: 'Bisq' });
    expect(entrySourceFields({ id: 'mgx-1', source: 'gateio', sourceName: 'Gate' })).toEqual({ source: 'gateio', sourceName: 'Gate.io' });
    expect(entrySourceFields({ id: 'mgx-1' })).toEqual({});
  });

  it('is never offered as a pick', () => {
    expect(sourcePickerRows('').map((r) => r.key)).not.toContain(NO_SOURCE_KEY);
    expect(sourceFieldsFor(NO_SOURCE_KEY)).toBeNull();
  });
});

describe('fields read from a file', () => {
  it('keep a well-formed pair', () => {
    expect(sanitizeSourceFields({ source: 'kraken', sourceName: 'Kraken' })).toEqual({ source: 'kraken', sourceName: 'Kraken' });
    expect(sanitizeSourceFields({ source: 'p2p' })).toEqual({ source: 'p2p' });
    expect(sanitizeSourceFields({ source: 'other', sourceName: ' Bisq ' })).toEqual({ source: 'other', sourceName: 'Bisq' });
  });

  it('drop a damaged one, and Other with no name', () => {
    expect(sanitizeSourceFields({ source: 'Kraken!' })).toEqual({});
    expect(sanitizeSourceFields({ source: 12 })).toEqual({});
    expect(sanitizeSourceFields({ source: 'other' })).toEqual({});
    expect(sanitizeSourceFields({ sourceName: 'Bisq' })).toEqual({});
  });

  it('cap a name that is too long', () => {
    const { sourceName } = sanitizeSourceFields({ source: 'other', sourceName: 'x'.repeat(200) });
    expect(sourceName).toHaveLength(MAX_SOURCE_NAME_LENGTH);
  });
});

describe('who sets a source by itself', () => {
  it('the Kraken sync, on trades only', () => {
    const trade: KrakenTrade = { txid: 'T1', pair: 'XXBTZUSD', type: 'buy', time: 1_700_000_000, price: '1', cost: '100', fee: '0', vol: '0.001' };
    const coinTrade: KrakenTrade = { ...trade, txid: 'T2', pair: 'XETHXXBT', cost: '0.01' };
    const trades = krakenTradesToEntries([trade, coinTrade], NOW).map((d) => d.entry);
    expect(trades).toHaveLength(2);
    for (const e of trades) expect({ source: e.source, sourceName: e.sourceName }).toEqual(sourceFieldsFor('kraken'));

    // Coins moved in or out of Kraken were not bought or sold there.
    const deposit: KrakenLedgerRow = { id: 'L1', refid: 'R', type: 'deposit', time: 1_700_000_000, asset: 'XXBT', amount: '0.1', fee: '0' };
    const withdrawal: KrakenLedgerRow = { ...deposit, id: 'L2', type: 'withdrawal', amount: '-0.05' };
    const moved = krakenLedgerToEntries([deposit, withdrawal], NOW).map((d) => d.entry);
    expect(moved).toHaveLength(2);
    for (const e of moved) {
      expect(e).not.toHaveProperty('source');
      expect(entrySourceName(e)).toBeUndefined();
    }
    expect(moved.map((e) => e.note?.split('.')[0])).toEqual(['Deposit to Kraken', 'Withdrawal from Kraken']);
  });

  it('the Coinbase sync', () => {
    const [d] = coinbaseFillsToEntries(
      [{ entry_id: 'f1', trade_id: 't', order_id: 'o', trade_time: '2024-06-27T20:32:06.568Z', trade_type: 'FILL', price: '70000', size: '0.001', commission: '0', product_id: 'BTC-USD', size_in_quote: false, side: 'BUY' }],
      NOW,
    );
    expect({ source: d.entry.source, sourceName: d.entry.sourceName }).toEqual(sourceFieldsFor('coinbase'));
  });

  it('never a vault snapshot', () => {
    const [e] = toManualEntries(
      [{ kind: 'buy', amountSats: 1000, date: NOW, tsSecs: NOW / 1000, txid: 'ab'.repeat(32) }],
      { fiatCurrency: 'USD', now: NOW, vaultId: 'w_abcdef_123' },
    );
    expect(e.source).toBeUndefined();
    expect(entrySourceName(e)).toBeUndefined();
  });
});
