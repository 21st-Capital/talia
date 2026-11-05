import { findDuplicateWallet, duplicateVaultMessage } from '../duplicates';
import type { WalletMeta } from '../types';
import {
  TPUB_A,
  TPUB_B,
  XPUB_A,
} from '../../bitcoin/descriptor/__fixtures__/descriptors';

const wallet = (descriptor: string, label = 'Existing'): WalletMeta =>
  ({
    id: 'w1',
    label,
    descriptor,
    network: 'testnet',
    kind: 'single-sig',
    source: 'sparrow',
    transport: 'paste',
    createdAt: 0,
  }) as WalletMeta;

const SINGLE = `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)`;
const MULTI = `wsh(sortedmulti(2,[aaaa0001/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[bbbb0002/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;

describe('findDuplicateWallet', () => {
  it('matches the exact descriptor, ignoring checksum and whitespace', () => {
    const w = wallet(SINGLE);
    expect(findDuplicateWallet(`${SINGLE}#abcd1234`, [w])).toBe(w);
    expect(findDuplicateWallet(`  ${SINGLE}  `, [w])).toBe(w);
  });

  it('matches the same key set in different clothes (split vs multipath)', () => {
    const w = wallet(SINGLE);
    const split = `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/0/*)`;
    expect(findDuplicateWallet(split, [w])).toBe(w);
  });

  it('matches multisig regardless of key order', () => {
    const w = wallet(MULTI);
    const reordered = `wsh(sortedmulti(2,[bbbb0002/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[aaaa0001/48'/1'/0'/2']${TPUB_A}/<0;1>/*))`;
    expect(findDuplicateWallet(reordered, [w])).toBe(w);
  });

  it('does NOT match different keys or different wrappers', () => {
    const w = wallet(SINGLE);
    expect(findDuplicateWallet(`wpkh(${XPUB_A}/0/*)`, [w])).toBeNull();
    // same key, different script wrapper = different wallet on-chain
    expect(
      findDuplicateWallet(`sh(wpkh([73c5da0a/84'/1'/0']${TPUB_A}/0/*))`, [w]),
    ).toBeNull();
  });

  it('does NOT match the same keys under a DIFFERENT policy (a reported regression)', () => {
    const layered = (older: number, thresh: number) =>
      `wsh(or_d(multi(${thresh},[aaaa0001/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[bbbb0002/48'/1'/0'/2']${TPUB_B}/<0;1>/*),and_v(v:pkh([73c5da0a/84'/1'/0']${TPUB_A}/2/*),older(${older}))))`;
    const w = wallet(layered(52596, 2));
    // Different timelock or threshold = different wallet on-chain → allowed.
    expect(findDuplicateWallet(layered(26298, 2), [w])).toBeNull();
    expect(findDuplicateWallet(layered(52596, 1), [w])).toBeNull();
    // Identical structure = still refused.
    expect(findDuplicateWallet(layered(52596, 2), [w])).toBe(w);
  });

  it('message explains that renaming does not help', () => {
    const msg = duplicateVaultMessage(wallet(SINGLE, 'Family savings'));
    expect(msg).toContain('Family savings');
    expect(msg).toContain('not its name');
    // Client-visible, so never an em dash (the house rule; one was here until 2026-09-12).
    expect(msg).not.toMatch(/\u2014/);
  });
});
