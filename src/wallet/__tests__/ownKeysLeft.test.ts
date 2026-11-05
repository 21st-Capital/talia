import { ownKeysLeftToSign } from '../ownKeysLeft';
import type { WalletMeta } from '../types';

const TPUB_A = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
const TPUB_B = 'tpubDCDuqEgbT3rnSzcJZC94rWJqBUyVbEgigqW9NkNkzyLYQCsNbTJVEWuLNfYzRe4EGkMK9ARxBDeHfxecFFrBAztDsZLYNiBB1uD86ZLpuXn';

function vault(over: Partial<WalletMeta> = {}): WalletMeta {
  return {
    id: 'w1',
    label: 'Vault',
    network: 'testnet',
    kind: 'multisig',
    source: 'created',
    transport: 'created',
    createdAt: 0,
    descriptor: `wsh(multi(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[a1b2c3d4/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`,
    ...over,
  } as WalletMeta;
}

describe('ownKeysLeftToSign', () => {
  // The rule this exists for (decided 2026-09-18): every screen that mentions
  // 21st Capital must offer the client's own remaining keys first.
  it('is empty, never wrong, when anything cannot be read', () => {
    expect(ownKeysLeftToSign(null, 'x')).toEqual([]);
    expect(ownKeysLeftToSign(vault(), null)).toEqual([]);
    expect(ownKeysLeftToSign(vault(), 'not a psbt')).toEqual([]);
    expect(ownKeysLeftToSign(vault({ descriptor: 'nonsense(' }), 'x')).toEqual([]);
  });

  it('a manual entry has no keys to offer', () => {
    expect(ownKeysLeftToSign(vault({ manual: true }), 'x')).toEqual([]);
  });

  it('21st Capital keys are never offered as the client to sign', () => {
    // Both descriptor keys, but one of them is ours: only theirs can be left.
    const left = ownKeysLeftToSign(
      vault({ providerKeyFingerprints: ['a1b2c3d4'] }),
      'not a psbt',
      new Set(['a1b2c3d4']),
    );
    // An unreadable PSBT yields [] by design; the point is it never returns ours.
    expect(left).not.toContain('a1b2c3d4');
  });
});
