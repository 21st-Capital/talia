/**
 * Decided 2026-10-07: BDK finalizes a spend on a
 * timelocked path as soon as the signatures are there, whatever the age of
 * the coins, so a rescue assembled and the network refused it. Every
 * transaction here is one the shipped bdk-ffi fork built, signed (test keys)
 * and FINALIZED without complaint, with the chain tip at 70 000.
 */
import * as fs from 'fs';
import * as path from 'path';
import { cachedRescueReadiness, signedSpendReadiness } from '../rescueReadiness';
import { sendTooEarly, signedTxWaits, tooEarlyTitle } from '../sendTooEarly';
import { encodeBase64 } from '../../bitcoin/psbt/export';

interface Spend {
  shape: string;
  spend: 'heir' | 'rescue';
  coin: 'old' | 'recent';
  coinTxid: string;
  coinHeight: number;
  tip: number;
  hex: string;
}

const { spends } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../bitcoin/engine/__fixtures__/bdkTimelockedSpends.json'), 'utf8'),
) as { spends: Spend[] };

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const find = (shape: string, spend: string, coin: string) =>
  spends.find((s) => s.shape === shape && s.spend === spend && s.coin === coin)!;
type History = Array<{ txid: string; confirmed: boolean; blockHeight?: number }>;
const history = (s: Spend): History => [{ txid: s.coinTxid, confirmed: true, blockHeight: s.coinHeight }];
const verdict = (s: Spend, tip = s.tip, txs: History = history(s)) =>
  signedSpendReadiness(signedTxWaits(bytes(s.hex), 'testnet')!, txs, tip);

describe('a finalized spend whose coins have not waited long enough is refused before the network sees it', () => {
  it.each([
    // coin 10 blocks old: the path's wait less those 10
    ['wsh-layered-older', 'heir', 4383 - 10],
    ['wsh-layered-older', 'rescue', 65535 - 10],
    ['tr-nums-layered-older', 'heir', 4383 - 10],
    ['tr-nums-layered-older', 'rescue', 65535 - 10],
    ['tr-liana-keypath-older', 'rescue', 4032 - 10],
  ])('%s, %s on a coin of 10 blocks', (shape, spend, blocks) => {
    expect(verdict(find(shape, spend, 'recent'))).toEqual({ state: 'waiting', blocks });
  });

  it.each([
    ['wsh-layered-older', 'heir'],
    ['wsh-layered-older', 'rescue'],
    ['tr-nums-layered-older', 'heir'],
    ['tr-nums-layered-older', 'rescue'],
    ['tr-liana-keypath-older', 'rescue'],
    ['wsh-after', 'rescue'],
  ])('%s, %s on an old coin goes', (shape, spend) => {
    expect(verdict(find(shape, spend, 'old'))).toEqual({ state: 'ready' });
  });

  it('an after() wait reads the locktime: 75 000 with the tip at 70 000 is 5 000 blocks away', () => {
    for (const coin of ['old', 'recent']) {
      expect(verdict(find('wsh-after-future', 'rescue', coin))).toEqual({ state: 'waiting', blocks: 5000 });
    }
    // and goes once the chain is there
    expect(verdict(find('wsh-after-future', 'rescue', 'old'), 75_000)).toEqual({ state: 'ready' });
    // an after() already behind the tip never waits, however young the coin
    expect(verdict(find('wsh-after', 'rescue', 'recent'))).toEqual({ state: 'ready' });
  });

  it('agrees with the Rescue screen block for block: ready there means ready here', () => {
    const s = find('wsh-layered-older', 'rescue', 'recent');
    const utxo = [{ txid: s.coinTxid, vout: 0, valueSats: 1 }];
    const txs = [{ txid: s.coinTxid, blockHeight: s.coinHeight }];
    for (const tip of [s.tip, s.coinHeight + 65_534, s.coinHeight + 65_535, s.coinHeight + 70_000]) {
      const screen = cachedRescueReadiness(utxo, txs, tip, 65_535)!;
      const here = verdict(s, tip);
      expect([tip, here.state]).toEqual([tip, screen.state]);
      if (screen.state === 'waiting') expect(here).toEqual({ state: 'waiting', blocks: screen.blocks });
    }
  });

  it('a coin still waiting for its block has the whole wait ahead', () => {
    const s = find('wsh-layered-older', 'rescue', 'recent');
    expect(verdict(s, s.tip, [{ txid: s.coinTxid, confirmed: false }])).toEqual({ state: 'waiting', blocks: 65535 });
  });

  it('never stops a send on what it cannot know', () => {
    const s = find('wsh-layered-older', 'rescue', 'recent');
    const waits = signedTxWaits(bytes(s.hex), 'testnet')!;
    expect(signedSpendReadiness(waits, history(s), undefined)).toEqual({ state: 'unknown' }); // no tip
    expect(verdict(s, s.tip, [])).toEqual({ state: 'unknown' }); // coin not in the history
    expect(verdict(s, s.tip, [{ txid: s.coinTxid, confirmed: true }])).toEqual({ state: 'unknown' }); // no height
    // a relative wait counted in time (BIP-68 type flag) is the chain's clock, not a block count
    const timed = { version: 2, lockTime: 0, inputs: [{ txid: s.coinTxid, vout: 0, sequence: 0x00400000 | 100 }] };
    expect(signedSpendReadiness(timed, history(s), s.tip)).toEqual({ state: 'unknown' });
    // a locktime that is a moment, not a height
    const moment = { version: 2, lockTime: 1_900_000_000, inputs: [{ txid: s.coinTxid, vout: 0, sequence: 0xfffffffe }] };
    expect(signedSpendReadiness(moment, history(s), s.tip)).toEqual({ state: 'unknown' });
  });

  it('an everyday payment never waits: replaceable inputs carry no wait, and a version 1 transaction none at all', () => {
    const s = find('wsh-layered-older', 'rescue', 'recent');
    const everyday = { version: 2, lockTime: s.tip, inputs: [{ txid: s.coinTxid, vout: 0, sequence: 0xfffffffd }] };
    expect(signedSpendReadiness(everyday, history(s), s.tip)).toEqual({ state: 'ready' });
    const v1 = { version: 1, lockTime: 0, inputs: [{ txid: s.coinTxid, vout: 0, sequence: 65535 }] };
    expect(signedSpendReadiness(v1, history(s), s.tip)).toEqual({ state: 'ready' });
    // every input final: the locktime does not bind
    const final = { version: 2, lockTime: s.tip + 50, inputs: [{ txid: s.coinTxid, vout: 0, sequence: 0xffffffff }] };
    expect(signedSpendReadiness(final, history(s), s.tip)).toEqual({ state: 'ready' });
  });
});

describe('sendTooEarly, as the screens ask it', () => {
  const s = find('wsh-layered-older', 'rescue', 'recent');
  const view = (tip: number | undefined, txs = history(s)) => ({
    listTransactions: async () => txs.map((t) => ({ ...t, received: 0, sent: 0, netAmount: 0 })),
    getTipHeight: () => tip,
  });

  it('reads a raw transaction and a PSBT alike', async () => {
    expect(await sendTooEarly(view(s.tip), bytes(s.hex), 'testnet')).toBe(65525);
    expect(await sendTooEarly(view(s.coinHeight + 70_000), bytes(s.hex), 'testnet')).toBeNull();
    // the PSBT form: the same unsigned transaction inside (global key 0x00)
    const unsigned = unsignedOf(s.hex);
    const psbt = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x00, ...varint(unsigned.length), ...unsigned, 0x00, 0x00, 0x00]);
    expect(await sendTooEarly(view(s.tip), encodeBase64(psbt), 'testnet')).toBe(65525);
    expect(await sendTooEarly(view(s.tip), psbt, 'testnet')).toBe(65525);
  });

  it('asks the chain again before it says not yet', async () => {
    const stale = view(s.tip);
    expect(await sendTooEarly(stale, bytes(s.hex), 'testnet', async () => view(s.coinHeight + 65_535))).toBeNull();
    expect(await sendTooEarly(stale, bytes(s.hex), 'testnet', async () => view(s.tip + 5))).toBe(65520);
    // offline: judged on what the phone has
    expect(
      await sendTooEarly(stale, bytes(s.hex), 'testnet', async () => {
        throw new Error('offline');
      }),
    ).toBe(65525);
  });

  it('never stops what it cannot read', async () => {
    expect(await sendTooEarly(view(s.tip), Uint8Array.of(1, 2, 3), 'testnet')).toBeNull();
    expect(await sendTooEarly(view(undefined), bytes(s.hex), 'testnet')).toBeNull();
    const broken = { listTransactions: async () => Promise.reject(new Error('cold')), getTipHeight: () => s.tip };
    expect(await sendTooEarly(broken, bytes(s.hex), 'testnet')).toBeNull();
  });

  it('says it in one plain line', () => {
    expect(tooEarlyTitle(65525)).toBe('This can be sent in ≈ 1 year, 2 months, 28 days');
    expect(tooEarlyTitle(2)).toBe('This can be sent in ≈ 20 minutes');
    expect(tooEarlyTitle(65525)).not.toMatch(/—/);
  });
});

/** The transaction without its witness: what a PSBT carries. */
function unsignedOf(hex: string): Uint8Array {
  const b = bytes(hex);
  if (b[4] !== 0x00 || b[5] !== 0x01) return b;
  // version | inputs+outputs | locktime, dropping marker, flag and witness.
  // Our fixtures have one input and every scriptSig empty.
  let p = 6;
  const nIn = b[p++];
  p += nIn * (32 + 4 + 1 + 4);
  const nOut = b[p++];
  for (let i = 0; i < nOut; i++) p += 8 + 1 + b[p + 8];
  return Uint8Array.from([...b.slice(0, 4), ...b.slice(6, p), ...b.slice(b.length - 4)]);
}

function varint(n: number): number[] {
  return n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8];
}
