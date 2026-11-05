import {
  coinbaseErrorMessage,
  coinbaseFillsToEntries,
  coinbaseJwt,
  coinbaseJwtVerifies,
  coinbaseSigningKey,
  coinbaseTimeToMs,
  isCoinbaseEntry,
  parseCoinbaseKeyInput,
  parseCoinbaseProduct,
} from '../coinbase';
import type { CoinbaseFill } from '../coinbase';
import { freshDrafts } from '../drafts';
import { generateKeyPairSync } from 'crypto';

// A throwaway P-256 key, made afresh for every run, in both forms Coinbase
// and openssl write it (SEC1 and PKCS#8), and its scalar. No key is kept in
// the tree.
const TEST_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
const SEC1_PEM = String(TEST_KEY.export({ type: 'sec1', format: 'pem' })).trim();
const PKCS8_PEM = String(TEST_KEY.export({ type: 'pkcs8', format: 'pem' })).trim();
const SCALAR_HEX = Buffer.from(String(TEST_KEY.export({ format: 'jwk' }).d), 'base64url').toString('hex');
const KEY_NAME = 'organizations/2c1d9f36-0000-4000-8000-0123456789ab/apiKeys/9f8e7d6c-0000-4000-8000-ba9876543210';

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('the private key', () => {
  it('reads the SEC1 block Coinbase downloads, and a PKCS#8 one', () => {
    const a = coinbaseSigningKey(SEC1_PEM);
    const b = coinbaseSigningKey(PKCS8_PEM);
    expect('scalar' in a && hex(a.scalar)).toBe(SCALAR_HEX);
    expect('scalar' in b && hex(b.scalar)).toBe(SCALAR_HEX);
  });

  it('reads a bare base64 scalar too', () => {
    const raw = Buffer.from(SCALAR_HEX, 'hex').toString('base64');
    const k = coinbaseSigningKey(raw);
    expect('scalar' in k && hex(k.scalar)).toBe(SCALAR_HEX);
  });

  it('names an Ed25519 key, which this API refuses', () => {
    expect(coinbaseSigningKey(Buffer.alloc(64, 7).toString('base64'))).toEqual({ problem: 'ed25519' });
    // PKCS#8 Ed25519: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING seed } }
    const ed = Buffer.from('302e020100300506032b657004220420' + '11'.repeat(32), 'hex').toString('base64');
    expect(coinbaseSigningKey(`-----BEGIN PRIVATE KEY-----\n${ed}\n-----END PRIVATE KEY-----`)).toEqual({ problem: 'ed25519' });
  });

  it('refuses junk plainly', () => {
    expect(coinbaseSigningKey('')).toEqual({ problem: 'empty' });
    expect(coinbaseSigningKey('not a key')).toEqual({ problem: 'unreadable' });
    expect(coinbaseSigningKey('-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----')).toEqual({ problem: 'unreadable' });
    expect(coinbaseSigningKey(Buffer.alloc(32, 0).toString('base64'))).toEqual({ problem: 'invalid' });
  });
});

describe('what the client pasted', () => {
  it('the downloaded key file', () => {
    const file = JSON.stringify({ name: KEY_NAME, privateKey: SEC1_PEM });
    expect(parseCoinbaseKeyInput(file)).toEqual({ keyName: KEY_NAME, secret: SEC1_PEM });
  });

  it('the two values on their own, or together', () => {
    expect(parseCoinbaseKeyInput(KEY_NAME)).toEqual({ keyName: KEY_NAME });
    expect(parseCoinbaseKeyInput(SEC1_PEM)).toEqual({ secret: SEC1_PEM });
    expect(parseCoinbaseKeyInput(`${KEY_NAME}\n${SEC1_PEM}`)).toEqual({ keyName: KEY_NAME, secret: SEC1_PEM });
    const raw = Buffer.from(SCALAR_HEX, 'hex').toString('base64');
    expect(parseCoinbaseKeyInput(`${KEY_NAME} ${raw}`)).toEqual({ keyName: KEY_NAME, secret: raw });
  });

  it('nothing from nothing', () => {
    expect(parseCoinbaseKeyInput('')).toEqual({});
    expect(parseCoinbaseKeyInput('https://portal.cdp.coinbase.com/api-keys')).toEqual({});
  });
});

describe('the request token', () => {
  const key = coinbaseSigningKey(SEC1_PEM);
  const scalar = 'scalar' in key ? key.scalar : new Uint8Array();

  it('is header.payload.signature exactly as Coinbase specifies, and verifies', () => {
    const token = coinbaseJwt({
      keyName: KEY_NAME,
      scalar,
      method: 'GET',
      host: 'api.coinbase.com',
      path: '/api/v3/brokerage/orders/historical/fills',
      nowSecs: 1_757_000_000,
      nonceHex: '0123456789abcdef0123456789abcdef',
    });
    const [h, p] = token.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
      kid: KEY_NAME,
      nonce: '0123456789abcdef0123456789abcdef',
    });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({
      sub: KEY_NAME,
      iss: 'cdp',
      nbf: 1_757_000_000,
      exp: 1_757_000_120,
      uri: 'GET api.coinbase.com/api/v3/brokerage/orders/historical/fills',
    });
    expect(coinbaseJwtVerifies(token, scalar)).toBe(true);
    expect(coinbaseJwtVerifies(token.slice(0, -4) + 'AAAA', scalar)).toBe(false);
  });
});

// Coinbase's own sandbox answer on 2026-09-07 (api-sandbox.coinbase.com,
// static data), trimmed to the fields the mapping reads.
const SANDBOX_FILLS: CoinbaseFill[] = [
  { entry_id: 'f8b3aa2b', trade_id: 'd006d1e0', order_id: '37f17b89', trade_time: '2024-06-27T20:32:06.568973Z', trade_type: 'FILL', price: '70000.44', size: '0.00137199', commission: '0.3841596147024', product_id: 'BTC-USD', size_in_quote: false, side: 'SELL' },
  { entry_id: '49e5397c', trade_id: '0b639999', order_id: '439e8aa4', trade_time: '2024-06-18T19:59:10.102220957Z', trade_type: 'FILL', price: '60000.44', size: '1', commission: '480.00352', product_id: 'BTC-USD', size_in_quote: false, side: 'BUY' },
  { entry_id: 'dc91f6cd', trade_id: '2a013f5a', order_id: '48c3142a', trade_time: '2024-06-18T19:58:42.263681859Z', trade_type: 'FILL', price: '61000.44', size: '1', commission: '488.00352', product_id: 'BTC-USD', size_in_quote: false, side: 'BUY' },
];
const NOW = 1_757_000_000_000;

describe('fills to entries', () => {
  it('maps the sandbox fills: buy = coins + fee, sell = coins - fee, oldest first', () => {
    const drafts = coinbaseFillsToEntries(SANDBOX_FILLS, NOW);
    expect(drafts.map((d) => d.entry.id)).toEqual(['coinbase-dc91f6cd', 'coinbase-49e5397c', 'coinbase-f8b3aa2b']);
    const buy = drafts[1].entry;
    expect(buy).toMatchObject({ kind: 'buy', amountSats: 100_000_000, fiatAmount: 60480.44, fiatCurrency: 'USD', feeAmount: 480, note: 'Coinbase trade.' });
    expect(buy.date).toBe(Date.parse('2024-06-18T19:59:10.102Z'));
    const sell = drafts[2].entry;
    expect(sell).toMatchObject({ kind: 'sell', amountSats: 137_199, fiatAmount: 95.66, fiatCurrency: 'USD', feeAmount: 0.38 });
    expect(drafts.every((d) => !d.needsEstimate)).toBe(true);
  });

  it('a buy placed in dollars (size_in_quote) becomes bitcoin at the fill price', () => {
    const [d] = coinbaseFillsToEntries(
      [{ ...SANDBOX_FILLS[1], entry_id: 'q1', price: '50000', size: '100', commission: '1.5', size_in_quote: true }],
      NOW,
    );
    expect(d.entry.amountSats).toBe(200_000);
    expect(d.entry.fiatAmount).toBe(101.5);
    expect(d.entry.feeAmount).toBe(1.5);
  });

  it('stablecoin quotes count as dollars and say so; other coins are estimated', () => {
    const drafts = coinbaseFillsToEntries(
      [
        { ...SANDBOX_FILLS[1], entry_id: 's1', product_id: 'BTC-USDC' },
        { ...SANDBOX_FILLS[1], entry_id: 'e1', product_id: 'BTC-ETH', price: '20', size: '1', commission: '0.01' },
      ],
      NOW,
    );
    expect(drafts.find((d) => d.entry.id === 'coinbase-s1')?.entry.note).toBe('Coinbase trade, paid in USDC, counted as US dollars.');
    const eth = drafts.find((d) => d.entry.id === 'coinbase-e1')!;
    expect(eth.needsEstimate).toBe(true);
    expect(eth.entry.fiatAmount).toBeUndefined();
    expect(eth.entry.amountSats).toBe(100_000_000);
  });

  it('bitcoin on the quote side: buying ether spends bitcoin plus the fee', () => {
    const drafts = coinbaseFillsToEntries(
      [
        { ...SANDBOX_FILLS[1], entry_id: 'b1', product_id: 'ETH-BTC', price: '0.05', size: '2', commission: '0.0001', side: 'BUY' },
        { ...SANDBOX_FILLS[1], entry_id: 'b2', product_id: 'ETH-BTC', price: '0.05', size: '2', commission: '0.0001', side: 'SELL', trade_time: '2024-06-19T00:00:00Z' },
      ],
      NOW,
    );
    expect(drafts[0].entry).toMatchObject({ kind: 'sell', amountSats: 10_010_000 });
    expect(drafts[1].entry).toMatchObject({ kind: 'buy', amountSats: 9_990_000 });
  });

  it('skips adjustments, non-bitcoin products and unusable rows', () => {
    const drafts = coinbaseFillsToEntries(
      [
        { ...SANDBOX_FILLS[1], entry_id: 'r', trade_type: 'REVERSAL' },
        { ...SANDBOX_FILLS[1], entry_id: 'eth', product_id: 'ETH-USD' },
        { ...SANDBOX_FILLS[1], entry_id: 'zero', size: '0' },
        { ...SANDBOX_FILLS[1], entry_id: 'when', trade_time: 'yesterday' },
      ],
      NOW,
    );
    expect(drafts).toEqual([]);
  });

  it('products and times', () => {
    expect(parseCoinbaseProduct('BTC-EUR')).toEqual({ btcSide: 'base', other: 'EUR', fiat: 'EUR', stablecoin: false });
    expect(parseCoinbaseProduct('ETH-BTC')?.btcSide).toBe('quote');
    expect(parseCoinbaseProduct('ETH-USD')).toBeNull();
    expect(parseCoinbaseProduct('BTC')).toBeNull();
    expect(coinbaseTimeToMs('2024-06-18T19:59:10.102220957Z')).toBe(Date.parse('2024-06-18T19:59:10.102Z'));
    expect(coinbaseTimeToMs('2024-06-18T19:59:10Z')).toBe(Date.parse('2024-06-18T19:59:10Z'));
    expect(coinbaseTimeToMs('nope')).toBeNull();
  });

  it('ids and freshness work like Kraken\'s', () => {
    const drafts = coinbaseFillsToEntries(SANDBOX_FILLS, NOW);
    expect(isCoinbaseEntry(drafts[0].entry)).toBe(true);
    const fresh = freshDrafts(drafts, [{ id: 'coinbase-dc91f6cd' }], new Set(['coinbase-49e5397c']));
    expect(fresh.map((d) => d.entry.id)).toEqual(['coinbase-f8b3aa2b']);
  });
});

describe('errors', () => {
  it('speaks plainly', () => {
    expect(coinbaseErrorMessage(401, '{"error":"Unauthorized"}')).toMatch(/did not accept this key/);
    expect(coinbaseErrorMessage(403, '')).toMatch(/View permission/);
    expect(coinbaseErrorMessage(429, '')).toMatch(/slow down/);
    expect(coinbaseErrorMessage(503, '')).toMatch(/having trouble/);
    expect(coinbaseErrorMessage(400, '<html>Bad Request</html>')).toBe('Coinbase answered with status 400: "Bad Request".');
  });
});
