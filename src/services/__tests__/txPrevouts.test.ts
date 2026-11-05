/**
 * Which block explorer may be asked for the addresses of a transaction's
 * spent coins (decided 2026-09-22, the Advanced section in BlueWallet's shape).
 */
import { explorerApiFor, fetchSpentCoinAddresses } from '../txPrevouts';

const base = { electrumUrls: {} };

describe('the explorer the transaction page may ask', () => {
  it('the public default when the client uses the default server', () => {
    expect(explorerApiFor('bitcoin', base)).toBe('https://blockstream.info/api');
    expect(explorerApiFor('testnet', base)).toBe('https://mempool.space/testnet4/api');
  });

  it('none at all behind the client\'s own Electrum server, or a public one they picked', () => {
    expect(explorerApiFor('bitcoin', { ...base, electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } })).toBeNull();
    expect(explorerApiFor('bitcoin', { ...base, electrumUrls: { bitcoin: 'ssl://electrum.acinq.co:50002' } })).toBeNull();
    // A retired server Talia once suggested is still the client's choice.
    expect(explorerApiFor('bitcoin', { ...base, electrumUrls: { bitcoin: 'ssl://bitcoin.lu.ke:50002' } })).toBeNull();
  });

  it('Testnet4 has no setting (decided 2026-10-18): its explorer is asked whatever an old install saved', () => {
    expect(explorerApiFor('testnet', { ...base, electrumUrls: { testnet: 'ssl://10.0.0.5:50002' } })).toBe(
      'https://mempool.space/testnet4/api',
    );
  });
});

describe('reading the explorer answer', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('gives each spent coin its address, in order, null where none is named', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        vin: [
          { prevout: { scriptpubkey_address: 'bc1qaaa' } },
          { prevout: null },
          { prevout: { scriptpubkey_address: 'bc1pbbb' } },
        ],
      }),
    }) as unknown as typeof fetch;
    await expect(fetchSpentCoinAddresses('https://x/api', 'ab')).resolves.toEqual(['bc1qaaa', null, 'bc1pbbb']);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://x/api/tx/ab');
  });

  it('throws on a refusal, so the page keeps the coin IDs', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(fetchSpentCoinAddresses('https://x/api', 'ab')).rejects.toThrow();
  });
});
