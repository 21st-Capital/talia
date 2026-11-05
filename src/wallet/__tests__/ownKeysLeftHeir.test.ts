/**
 * On an heir's phone the only key held there is the heir's own (decided
 * 2026-09-22): Pending transactions must never offer "Sign with another key"
 * for the OWNER's key, which the heir does not hold.
 */
jest.mock('../../bitcoin/psbt', () => ({
  unsignedTxid: () => 'txid',
  psbtSignatureStatus: () => ({ signedFingerprints: [] }),
}));

import { ownKeysLeftToSign } from '../ownKeysLeft';
import type { WalletMeta } from '../types';

const TPUB_A = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
const TPUB_B = 'tpubDCDuqEgbT3rnSzcJZC94rWJqBUyVbEgigqW9NkNkzyLYQCsNbTJVEWuLNfYzRe4EGkMK9ARxBDeHfxecFFrBAztDsZLYNiBB1uD86ZLpuXn';
// Owner 73c5da0a, heir 4a290600 and 21st Capital deadbeef on one layer.
const TRIO = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_A}/<0;1>/*))`;

const trio = (over: Partial<WalletMeta>): WalletMeta =>
  ({
    id: 'w1',
    label: 'Vault',
    network: 'testnet',
    kind: 'multisig',
    source: 'imported',
    transport: 'qr',
    createdAt: 0,
    descriptor: TRIO,
    heirKeyFingerprint: '4a290600',
    providerKeyFingerprints: ['deadbeef'],
    ...over,
  }) as WalletMeta;

describe('keys left to sign, by whose phone it is', () => {
  it("the heir's phone offers the heir's key, never the owner's", () => {
    expect(ownKeysLeftToSign(trio({ heirVault: true }), 'psbt')).toEqual(['4a290600']);
  });

  it("the owner's phone offers the owner's key, never the heir's", () => {
    expect(ownKeysLeftToSign(trio({}), 'psbt')).toEqual(['73c5da0a']);
  });
});
