import { accountIndexOf, providerKeysOf } from '../providerKeyRoles';
import { TPUB_A, TPUB_B, TPUB_C } from '../../bitcoin/descriptor/__fixtures__/descriptors';

const TPUB_D =
  'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';

const OURS = new Set(['49578625', 'fdcd357b']);

/** Client key A + our co-signer B on the primary path; our rescue key C
 *  behind a timelock; an origin-less NUMS internal key. */
const LAYERED =
  `tr(${TPUB_D}/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']${TPUB_A}/<0;1>/*,` +
  `[49578625/48'/1'/1122'/2']${TPUB_B}/<0;1>/*),` +
  `and_v(v:pk([fdcd357b/48'/1'/1122'/2']${TPUB_C}/<0;1>/*),older(52596))})`;

describe('providerKeysOf', () => {
  it('names the co-signer and the rescue key by the path each spends on', () => {
    const keys = providerKeysOf(LAYERED, OURS);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({
      fingerprint: '49578625',
      xpub: TPUB_B,
      role: 'cosigner',
      originPath: "48'/1'/1122'/2'",
      accountIndex: 1122,
    });
    expect(keys[1]).toMatchObject({
      fingerprint: 'fdcd357b',
      xpub: TPUB_C,
      role: 'rescue',
      olderBlocks: 52596,
      accountIndex: 1122,
    });
  });

  it('puts the co-signer first and the rescue key last, whatever the descriptor order', () => {
    // The same vault with the rescue key written BEFORE the co-signer: the
    // list still reads co-signer, then rescue (decided 2026-09-14, reading keys
    // aloud on a verification call).
    const rescueFirst =
      `tr(${TPUB_D}/<0;1>/*,{and_v(v:pk([fdcd357b/48'/1'/1122'/2']${TPUB_C}/<0;1>/*),older(52596)),` +
      `multi_a(2,[3442193e/48'/1'/0'/2']${TPUB_A}/<0;1>/*,` +
      `[49578625/48'/1'/1122'/2']${TPUB_B}/<0;1>/*)})`;
    expect(providerKeysOf(rescueFirst, OURS).map((k) => k.role)).toEqual(['cosigner', 'rescue']);
    expect(providerKeysOf(LAYERED, OURS).map((k) => k.role)).toEqual(['cosigner', 'rescue']);
  });

  it('lists nothing for a vault with none of our keys', () => {
    expect(providerKeysOf(LAYERED, new Set(['3442193e']))).toHaveLength(1);
    expect(providerKeysOf(LAYERED, new Set())).toEqual([]);
  });

  it('lists a key once even when the descriptor repeats it', () => {
    const twice = `wsh(or_d(pk([49578625/48'/1'/1122'/2']${TPUB_B}/<0;1>/*),and_v(v:pk([49578625/48'/1'/1122'/2']${TPUB_B}/<0;1>/*),older(10))))`;
    const keys = providerKeysOf(twice, OURS);
    expect(keys).toHaveLength(1);
    // Spends without waiting on one path: that makes it the co-signer.
    expect(keys[0].role).toBe('cosigner');
  });

  it('keeps the role unknown when the policy cannot be read', () => {
    const keys = providerKeysOf(`raw([49578625/48'/1'/5'/2']${TPUB_B}/0/*)`, OURS);
    expect(keys).toHaveLength(1);
    expect(keys[0].role).toBe('unknown');
    expect(keys[0].accountIndex).toBe(5);
  });
});

describe('accountIndexOf', () => {
  it('reads the account out of a BIP-48 origin path, with either hardening mark', () => {
    expect(accountIndexOf("48'/0'/1041'/2'")).toBe(1041);
    expect(accountIndexOf('48h/1h/7h/2h')).toBe(7);
    expect(accountIndexOf("84'/0'/0'")).toBeUndefined();
    expect(accountIndexOf(undefined)).toBeUndefined();
  });
});
