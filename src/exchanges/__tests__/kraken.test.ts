import {
  freshKrakenDrafts,
  isKrakenEntry,
  krakenEntryId,
  krakenErrorMessage,
  krakenLedgerToEntries,
  describeReplyHeaders,
  krakenOddReplyMessage,
  krakenSignature,
  krakenTradesToEntries,
  looksLikeKrakenSecret,
  parseKrakenPair,
  parseKrakenQr,
} from '../kraken';
import type { KrakenLedgerRow, KrakenTrade } from '../kraken';

// Kraken's own worked example from its API documentation ("Authentication"),
// cross-checked against Python's hmac/hashlib on 2026-09-07.
const DOC_SECRET = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==';

describe('krakenSignature', () => {
  it("reproduces Kraken's published API-Sign vector", () => {
    expect(
      krakenSignature({
        path: '/0/private/AddOrder',
        nonce: '1616492376594',
        postData: 'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25',
        secretB64: DOC_SECRET,
      }),
    ).toBe('4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==');
  });

  it('changes with every input', () => {
    const base = { path: '/0/private/TradesHistory', nonce: '1', postData: 'nonce=1', secretB64: DOC_SECRET };
    const sig = krakenSignature(base);
    expect(krakenSignature({ ...base, nonce: '2', postData: 'nonce=2' })).not.toBe(sig);
    expect(krakenSignature({ ...base, path: '/0/private/Ledgers' })).not.toBe(sig);
  });

  it('recognises a private key by shape', () => {
    expect(looksLikeKrakenSecret(DOC_SECRET)).toBe(true);
    expect(looksLikeKrakenSecret(` ${DOC_SECRET}\n`)).toBe(true);
    expect(looksLikeKrakenSecret('not a key')).toBe(false);
    expect(looksLikeKrakenSecret('')).toBe(false);
    expect(looksLikeKrakenSecret('a'.repeat(50) + '!')).toBe(false);
  });
});

describe('parseKrakenPair', () => {
  it('reads the classic and the newer pair names', () => {
    expect(parseKrakenPair('XXBTZUSD')).toEqual({ btcSide: 'base', other: 'USD', fiat: 'USD', stablecoin: false });
    expect(parseKrakenPair('XXBTZEUR')).toEqual({ btcSide: 'base', other: 'EUR', fiat: 'EUR', stablecoin: false });
    expect(parseKrakenPair('XXBTZJPY')?.fiat).toBe('JPY');
    expect(parseKrakenPair('XBTCHF')).toEqual({ btcSide: 'base', other: 'CHF', fiat: 'CHF', stablecoin: false });
    expect(parseKrakenPair('XBTAUD')?.fiat).toBe('AUD');
    expect(parseKrakenPair('xbtusd')?.fiat).toBe('USD');
  });

  it('counts dollar stablecoins as US dollars and says so', () => {
    expect(parseKrakenPair('XBTUSDT')).toEqual({ btcSide: 'base', other: 'USDT', fiat: 'USD', stablecoin: true });
    expect(parseKrakenPair('XBTUSDC')?.stablecoin).toBe(true);
  });

  it('knows when bitcoin is the quote, and when it is absent', () => {
    expect(parseKrakenPair('XETHXXBT')).toEqual({ btcSide: 'quote', other: 'ETH', fiat: undefined, stablecoin: false });
    expect(parseKrakenPair('ETHXBT')?.btcSide).toBe('quote');
    expect(parseKrakenPair('XBTETH')).toEqual({ btcSide: 'base', other: 'ETH', fiat: undefined, stablecoin: false });
    expect(parseKrakenPair('XETHZUSD')).toBeNull();
    expect(parseKrakenPair('XBT')).toBeNull();
    expect(parseKrakenPair('')).toBeNull();
  });
});

const NOW = 1_757_000_000_000;

function trade(t: Partial<KrakenTrade> & Pick<KrakenTrade, 'txid' | 'pair' | 'type'>): KrakenTrade {
  return { time: 1_700_000_000, price: '0', cost: '0', fee: '0', vol: '0', ...t };
}

describe('krakenTradesToEntries', () => {
  it("a fiat buy: total paid is cost plus fee, the fee kept, 0.5 BTC for 50,000 + 200", () => {
    const [d] = krakenTradesToEntries(
      [trade({ txid: 'TAAAAA-BBBBB-CCCCCC', pair: 'XXBTZUSD', type: 'buy', time: 1_700_000_000.1234, price: '100000.0', cost: '50000.00000', fee: '200.00000', vol: '0.50000000' })],
      NOW,
    );
    expect(d.needsEstimate).toBe(false);
    expect(d.tsSecs).toBe(1_700_000_000.1234);
    expect(d.entry).toEqual({
      id: 'kraken-TAAAAA-BBBBB-CCCCCC',
      kind: 'buy',
      amountSats: 50_000_000,
      date: 1_700_000_000_123,
      fiatAmount: 50_200,
      fiatCurrency: 'USD',
      feeAmount: 200,
      note: 'Kraken trade.',
      createdAt: NOW,
      // Named as its source by itself (decided 2026-10-22).
      source: 'kraken',
      sourceName: 'Kraken',
    });
  });

  it("a fiat sell: total received is cost minus fee, 0.25 BTC at 79,500", () => {
    const [d] = krakenTradesToEntries(
      [trade({ txid: 'T1', pair: 'XXBTZEUR', type: 'sell', cost: '19875.00', fee: '50.00', vol: '0.25000000' })],
      NOW,
    );
    expect(d.entry.kind).toBe('sell');
    expect(d.entry.amountSats).toBe(25_000_000);
    expect(d.entry.fiatAmount).toBe(19_825);
    expect(d.entry.fiatCurrency).toBe('EUR');
    expect(d.entry.feeAmount).toBe(50);
  });

  it('a fee that swallows a sell holds the total at zero and keeps no fee', () => {
    const [d] = krakenTradesToEntries(
      [trade({ txid: 'T2', pair: 'XXBTZUSD', type: 'sell', cost: '3.00', fee: '5.00', vol: '0.00005000' })],
      NOW,
    );
    expect(d.entry.fiatAmount).toBe(0);
    expect(d.entry.feeAmount).toBeUndefined();
  });

  it('a stablecoin trade is counted in US dollars and the note says so', () => {
    const [d] = krakenTradesToEntries(
      [trade({ txid: 'T3', pair: 'XBTUSDT', type: 'buy', cost: '1000.5', fee: '2.6', vol: '0.01' })],
      NOW,
    );
    expect(d.entry.fiatCurrency).toBe('USD');
    expect(d.entry.fiatAmount).toBe(1_003.1);
    expect(d.entry.note).toBe('Kraken trade, paid in USDT, counted as US dollars.');
  });

  it('yen rounds to whole units', () => {
    const [d] = krakenTradesToEntries(
      [trade({ txid: 'T4', pair: 'XXBTZJPY', type: 'buy', cost: '1500000.4', fee: '1200.6', vol: '0.1' })],
      NOW,
    );
    expect(d.entry.fiatAmount).toBe(1_501_201);
    expect(d.entry.feeAmount).toBe(1_201);
  });

  it('a trade against another coin has no receipt price and is flagged for an estimate', () => {
    const [d] = krakenTradesToEntries(
      [trade({ txid: 'T5', pair: 'XBTETH', type: 'buy', cost: '20.5', fee: '0.05', vol: '1.00000000' })],
      NOW,
    );
    expect(d.needsEstimate).toBe(true);
    expect(d.entry.amountSats).toBe(100_000_000);
    expect(d.entry.fiatAmount).toBeUndefined();
    expect(d.entry.note).toBe('Kraken trade against ETH. Price estimated at that day’s market rate.');
  });

  it('bitcoin on the quote side: buying ether spends bitcoin plus the fee, selling ether brings bitcoin minus it', () => {
    const drafts = krakenTradesToEntries(
      [
        trade({ txid: 'T6', pair: 'XETHXXBT', type: 'buy', cost: '0.10000000', fee: '0.00026000', vol: '2.0' }),
        trade({ txid: 'T7', pair: 'XETHXXBT', type: 'sell', cost: '0.10000000', fee: '0.00026000', vol: '2.0', time: 1_700_000_100 }),
      ],
      NOW,
    );
    expect(drafts[0].entry.kind).toBe('sell');
    expect(drafts[0].entry.amountSats).toBe(10_026_000);
    expect(drafts[1].entry.kind).toBe('buy');
    expect(drafts[1].entry.amountSats).toBe(9_974_000);
    expect(drafts.every((d) => d.needsEstimate)).toBe(true);
  });

  it('skips trades without bitcoin, unusable rows, and sorts oldest first', () => {
    const drafts = krakenTradesToEntries(
      [
        trade({ txid: 'late', pair: 'XXBTZUSD', type: 'buy', cost: '1', vol: '0.001', time: 1_700_000_500 }),
        trade({ txid: 'eth', pair: 'XETHZUSD', type: 'buy', cost: '1', vol: '1' }),
        trade({ txid: 'zero', pair: 'XXBTZUSD', type: 'buy', cost: '1', vol: '0' }),
        trade({ txid: 'weird', pair: 'XXBTZUSD', type: 'settle' as 'buy', cost: '1', vol: '1' }),
        trade({ txid: 'early', pair: 'XXBTZUSD', type: 'sell', cost: '1', vol: '0.001', time: 1_700_000_100 }),
      ],
      NOW,
    );
    expect(drafts.map((d) => d.entry.id)).toEqual(['kraken-early', 'kraken-late']);
  });

  it('never loses a satoshi to floating point', () => {
    const [d] = krakenTradesToEntries([trade({ txid: 'T8', pair: 'XXBTZUSD', type: 'buy', cost: '1', vol: '0.1' })], NOW);
    expect(d.entry.amountSats).toBe(10_000_000);
  });
});

function ledger(r: Partial<KrakenLedgerRow> & Pick<KrakenLedgerRow, 'id' | 'type'>): KrakenLedgerRow {
  return { refid: 'R', time: 1_700_000_000, asset: 'XXBT', amount: '0', fee: '0', ...r };
}

describe('krakenLedgerToEntries', () => {
  it('a deposit is a buy of the amount less the fee, a withdrawal a sell of amount plus fee', () => {
    const drafts = krakenLedgerToEntries(
      [
        ledger({ id: 'L1', type: 'deposit', amount: '0.50000000', fee: '0.00000000' }),
        ledger({ id: 'L2', type: 'withdrawal', amount: '-0.20000000', fee: '0.00002000', time: 1_700_000_100 }),
      ],
      NOW,
    );
    expect(drafts[0].entry).toMatchObject({ id: 'kraken-L1', kind: 'buy', amountSats: 50_000_000 });
    expect(drafts[0].entry.note).toBe('Deposit to Kraken. Price estimated at that day’s market rate.');
    expect(drafts[1].entry).toMatchObject({ id: 'kraken-L2', kind: 'sell', amountSats: 20_002_000 });
    expect(drafts.every((d) => d.needsEstimate && d.entry.fiatAmount === undefined)).toBe(true);
  });

  it('ignores other assets and other ledger types', () => {
    const drafts = krakenLedgerToEntries(
      [
        ledger({ id: 'L3', type: 'deposit', asset: 'ZUSD', amount: '1000' }),
        ledger({ id: 'L4', type: 'trade', amount: '0.1' }),
        ledger({ id: 'L5', type: 'staking', amount: '0.001' }),
        ledger({ id: 'L6', type: 'transfer', amount: '0.001' }),
        ledger({ id: 'L7', type: 'deposit', asset: 'XBT', amount: '0.001' }),
      ],
      NOW,
    );
    expect(drafts.map((d) => d.entry.id)).toEqual(['kraken-L7']);
  });
});

describe('freshKrakenDrafts', () => {
  it('drops what is already there and what the owner deleted', () => {
    const drafts = krakenTradesToEntries(
      [
        trade({ txid: 'a', pair: 'XXBTZUSD', type: 'buy', cost: '1', vol: '0.001' }),
        trade({ txid: 'b', pair: 'XXBTZUSD', type: 'buy', cost: '1', vol: '0.001' }),
        trade({ txid: 'c', pair: 'XXBTZUSD', type: 'buy', cost: '1', vol: '0.001' }),
      ],
      NOW,
    );
    const fresh = freshKrakenDrafts(drafts, [{ id: 'kraken-a' }, { id: 'manual-1' }], new Set(['kraken-b']));
    expect(fresh.map((d) => d.entry.id)).toEqual(['kraken-c']);
  });

  it('ids are stable and recognisable', () => {
    expect(krakenEntryId('TX')).toBe('kraken-TX');
    expect(isKrakenEntry({ id: 'kraken-TX' })).toBe(true);
    expect(isKrakenEntry({ id: 'vsnap-abc' })).toBe(false);
  });
});

describe('krakenErrorMessage', () => {
  it('turns Kraken codes into plain sentences', () => {
    expect(krakenErrorMessage(['EAPI:Invalid key'])).toBe('Kraken did not accept this API key.');
    expect(krakenErrorMessage(['EAPI:Invalid signature'])).toBe('Kraken did not accept this private key.');
    expect(krakenErrorMessage(['EGeneral:Permission denied'])).toMatch(/Query Closed Orders & Trades/);
    expect(krakenErrorMessage(['EAPI:Rate limit exceeded'])).toMatch(/slow down/);
    expect(krakenErrorMessage(['EAPI:Invalid nonce'])).toMatch(/try again/i);
    expect(krakenErrorMessage(['EService:Unavailable'])).toMatch(/busy/);
    expect(krakenErrorMessage(['EGeneral:Temporary lockout'])).toMatch(/locked/);
    expect(krakenErrorMessage(['EFunding:Unknown'])).toBe('Kraken returned an error. Please try again later.');
  });
});

describe('krakenOddReplyMessage', () => {
  it('names the status and quotes the first words of a block page, tags stripped', () => {
    const html = '<!DOCTYPE html><html><head><title>Access denied</title><style>body{}</style><script>var x=1;</script></head><body><h1>Access denied</h1><p>Error code 1020</p></body></html>';
    expect(krakenOddReplyMessage(403, html)).toBe(
      'Something in front of Kraken answered with status 403 instead of data: "Access denied Access denied Error code 1020". Try again on another network, such as Wi-Fi.',
    );
    // An empty 400 is what a subtly wrong pasted private key gets (seen live).
    expect(krakenOddReplyMessage(400, '')).toBe(
      'Something in front of Kraken answered with status 400 instead of data. If the private key was pasted, scan it from Kraken’s QR code instead.',
    );
  });

  it('keeps the excerpt short and copes with an empty body', () => {
    expect(krakenOddReplyMessage(502, '')).toBe(
      'Kraken is having trouble with status 502 instead of data. Try again on another network, such as Wi-Fi.',
    );
    expect(krakenOddReplyMessage(403, 'x'.repeat(500)).length).toBeLessThan(240);
  });
});

describe('describeReplyHeaders', () => {
  it('quotes the headers that say who answered, and a redirect', () => {
    const h: Record<string, string> = { server: 'cloudflare', 'cf-ray': '8abc-DXB', 'content-length': '0' };
    expect(describeReplyHeaders((n) => h[n] ?? null)).toBe('server=cloudflare, cf-ray=8abc-DXB, content-length=0');
    expect(describeReplyHeaders(() => null, 'https://example.com/blocked')).toBe('redirected to https://example.com/blocked');
    expect(describeReplyHeaders(() => null)).toBe('no headers');
  });

  it('is appended to the odd-reply message in brackets', () => {
    expect(krakenOddReplyMessage(400, '', 'server=nginx')).toBe(
      'Something in front of Kraken answered with status 400 instead of data (server=nginx). If the private key was pasted, scan it from Kraken’s QR code instead.',
    );
  });
});

describe('parseKrakenQr', () => {
  const KEY = 'TESTKEY' + 'A'.repeat(49); // made up: 56 chars, the shape of a Kraken API key
  const SECRET = DOC_SECRET; // 88 chars ending in ==

  it('one code per value, told apart by shape', () => {
    expect(parseKrakenQr(KEY)).toEqual({ key: KEY });
    expect(parseKrakenQr(`${SECRET}\n`)).toEqual({ secret: SECRET });
  });

  it('one code with both, as lines or JSON or a URL', () => {
    expect(parseKrakenQr(`${KEY}\n${SECRET}`)).toEqual({ key: KEY, secret: SECRET });
    expect(parseKrakenQr(JSON.stringify({ key: KEY, secret: SECRET }))).toEqual({ key: KEY, secret: SECRET });
    expect(parseKrakenQr(JSON.stringify({ apiKey: KEY, privateKey: SECRET, name: 'Talia' }))).toEqual({ key: KEY, secret: SECRET });
    expect(parseKrakenQr(`kraken://apikey?key=${encodeURIComponent(KEY)}&secret=${encodeURIComponent(SECRET)}`)).toEqual({ key: KEY, secret: SECRET });
  });

  it('JSON with names nobody expected still works by shape', () => {
    expect(parseKrakenQr(JSON.stringify({ a: KEY, b: SECRET }))).toEqual({ key: KEY, secret: SECRET });
  });

  it('yields nothing for a code that is not a Kraken key', () => {
    expect(parseKrakenQr('https://www.kraken.com/u/security/api')).toEqual({});
    expect(parseKrakenQr('bitcoin:bc1qxyz')).toEqual({});
    expect(parseKrakenQr('')).toEqual({});
    expect(parseKrakenQr('{"broken": ')).toEqual({});
  });
});
