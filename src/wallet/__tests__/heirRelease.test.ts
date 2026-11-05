/**
 * The strict-mode release date is a security boundary: an over-early date
 * releases the descriptor blob before the heir's key can spend. These tests
 * pin the fail-closed rules and the earliest-coin arithmetic.
 */
import { earliestHeirUnlockIso, heirKeyCanSignNow, heirKeyTimelocked } from '../heirRelease';
import type { Utxo, WalletTx } from '../../bitcoin/engine/types';
import { TPUB_A, TPUB_B, TPUB_C } from '../../bitcoin/descriptor/__fixtures__/descriptors';

const MS_PER_BLOCK = 10 * 60 * 1000;
const NOW = 1_753_500_000_000;

// Primary key + heir path (older 4383 ≈ 1 month) + rescue path (older 65535).
// The rescue fp is NOT an heir — its earlier/later lock must never bleed in.
// The heir's fingerprint is made up.
const HEIR_FP = 'cc000003';
const LAYERED =
  `wsh(or_d(pk([73c5da0a/48']${TPUB_A}/<0;1>/*),` +
  `or_i(and_v(v:pk([${HEIR_FP}/48']${TPUB_B}/<0;1>/*),older(4383)),` +
  `and_v(v:pk([deadbeef/48']${TPUB_C}/<0;1>/*),older(65535)))))`;

const utxo = (txid: string, vout = 0): Utxo => ({
  txid,
  vout,
  valueSats: 1000,
  keychain: 'external',
});
const tx = (txid: string, blockHeight?: number): WalletTx =>
  ({ txid, received: 1000, sent: 0, netAmount: 1000, confirmed: blockHeight != null, blockHeight } as WalletTx);

const base = {
  descriptor: LAYERED,
  heirFingerprints: [HEIR_FP],
  tipHeight: 905_000,
  nowMs: NOW,
};

describe('earliestHeirUnlockIso', () => {
  it('uses the soonest-expiring coin and the HEIR path lock, not the rescue lock', () => {
    const iso = earliestHeirUnlockIso({
      ...base,
      utxos: [utxo('a'), utxo('b')],
      txs: [tx('a', 904_000), tx('b', 901_000)], // b confirmed earlier → expires first
    });
    // b: 901_000 + 4_383 - 905_000 = 383 blocks left
    expect(iso).toBe(new Date(NOW + 383 * MS_PER_BLOCK).toISOString());
  });

  it('an already-open timelock clamps to now, never the past', () => {
    const iso = earliestHeirUnlockIso({
      ...base,
      utxos: [utxo('a')],
      txs: [tx('a', 800_000)], // long past 4383 blocks
    });
    expect(iso).toBe(new Date(NOW).toISOString());
  });

  it('an unconfirmed coin counts the FULL lock (its clock has not started)', () => {
    const iso = earliestHeirUnlockIso({
      ...base,
      utxos: [utxo('a')],
      txs: [tx('a', undefined)],
    });
    expect(iso).toBe(new Date(NOW + 4383 * MS_PER_BLOCK).toISOString());
  });

  it('fails closed: no coins → null', () => {
    expect(earliestHeirUnlockIso({ ...base, utxos: [], txs: [] })).toBeNull();
  });

  it('fails closed: no keyed heirs → null', () => {
    expect(
      earliestHeirUnlockIso({ ...base, heirFingerprints: [], utxos: [utxo('a')], txs: [tx('a', 904_000)] }),
    ).toBeNull();
  });

  it('fails closed: heir fingerprint not on any timelocked path → null', () => {
    expect(
      earliestHeirUnlockIso({
        ...base,
        heirFingerprints: ['73c5da0a'], // the PRIMARY key, no older() path
        utxos: [utxo('a')],
        txs: [tx('a', 904_000)],
      }),
    ).toBeNull();
  });

  it('matches fingerprints case-insensitively', () => {
    const iso = earliestHeirUnlockIso({
      ...base,
      heirFingerprints: [HEIR_FP.toUpperCase()],
      utxos: [utxo('a')],
      txs: [tx('a', 904_000)],
    });
    expect(iso).not.toBeNull();
  });
});


describe('heirKeyTimelocked', () => {
  // The Estate Plan lets a client say an off-chain heir has access to ANY key,
  // including an active primary one (decided 2026-08-30). Sealing the invite to it
  // is fine; offering a countdown against it is not, because a primary key has
  // no `older(...)` and the strict release date would compute to null, leaving
  // the server withholding the descriptor forever.
  const PRIMARY_FP = '73c5da0a';
  const RESCUE_FP = 'deadbeef';

  it('is true for a key on a timelocked heir path', () => {
    expect(heirKeyTimelocked(LAYERED, HEIR_FP)).toBe(true);
  });

  it('is true for the rescue key, which also sits behind older()', () => {
    expect(heirKeyTimelocked(LAYERED, RESCUE_FP)).toBe(true);
  });

  it('is FALSE for an active primary key: nothing would ever release it', () => {
    expect(heirKeyTimelocked(LAYERED, PRIMARY_FP)).toBe(false);
    // The matching consequence, stated by the function this guards.
    expect(
      earliestHeirUnlockIso({
        ...base,
        heirFingerprints: [PRIMARY_FP],
        utxos: [utxo('a')],
        txs: [tx('a', 900_000)],
      }),
    ).toBeNull();
  });

  it('matches case-insensitively, since stored fingerprints vary', () => {
    expect(heirKeyTimelocked(LAYERED, HEIR_FP.toUpperCase())).toBe(true);
  });

  it('is false for a key the vault does not contain', () => {
    expect(heirKeyTimelocked(LAYERED, 'ffffffff')).toBe(false);
  });

  it('is false for no key at all', () => {
    expect(heirKeyTimelocked(LAYERED, undefined)).toBe(false);
    expect(heirKeyTimelocked(LAYERED, '')).toBe(false);
  });

  it('fails CLOSED on a descriptor it cannot flatten', () => {
    // The honest fallback is the invite that always opens, never one that
    // silently never does.
    expect(heirKeyTimelocked('not a descriptor', HEIR_FP)).toBe(false);
  });

  it('is false on a plain single-sig vault, which has no timelocks at all', () => {
    expect(heirKeyTimelocked(`wpkh([73c5da0a/84']${TPUB_A}/<0;1>/*)`, PRIMARY_FP)).toBe(false);
  });
});

describe('heirKeyCanSignNow (decided 2026-09-22)', () => {
  const PRIMARY_FP = '73c5da0a';
  // The tested case: the heir's key on the first layer of a 2-of-3, no timelock.
  const FIRST_LAYER =
    `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[${HEIR_FP}/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_C}/<0;1>/*))`;

  it('is true for a key on a path with no timelock', () => {
    expect(heirKeyCanSignNow(FIRST_LAYER, HEIR_FP)).toBe(true);
    expect(heirKeyCanSignNow(LAYERED, PRIMARY_FP)).toBe(true);
  });

  it('is false for a key that only sits behind a timelock', () => {
    expect(heirKeyCanSignNow(LAYERED, HEIR_FP)).toBe(false);
  });

  it('is false for a key the vault does not hold, and for nothing at all', () => {
    expect(heirKeyCanSignNow(FIRST_LAYER, 'ffffffff')).toBe(false);
    expect(heirKeyCanSignNow(FIRST_LAYER, undefined)).toBe(false);
  });
});
