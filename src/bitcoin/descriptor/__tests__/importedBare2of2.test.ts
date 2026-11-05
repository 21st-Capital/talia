/**
 * Asked 2026-07-28: "what if I import a fully self-custodial 2-of-2 with no
 * recovery layer at all — can I still send with Talia?"
 *
 * Talia must never BUILD that shape, but the coins already exist and the owner
 * has to be able to use them. Import must succeed, be warned about, and stay
 * fully spendable.
 */
import { validateForImport } from '../validate';
import { parsePolicy, pathRequirement, pathSatisfiedBy, deadEndShape } from '../policy';

const TPUB_A =
  'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK';
const TPUB_B =
  'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3';
const A = 'aaaaaaa1';
const B = 'bbbbbbb2';

/** What Sparrow/Electrum export for a self-custodial 2-of-2. */
const WSH = `wsh(sortedmulti(2,[${A}/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[${B}/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;

test('the import SUCCEEDS — the vault opens', () => {
  const r = validateForImport(WSH, { network: 'testnet' });
  expect(r.ok).toBe(true);
});

test('…and the owner is warned that every key is required', () => {
  const r = validateForImport(WSH, { network: 'testnet' });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.warnings.join(' ')).toMatch(/ALL 2 of its keys/i);
  expect(r.warnings.join(' ')).toMatch(/no timelocked recovery path/i);
});

test('it is recognised as the dead-end shape', () => {
  expect(deadEndShape(parsePolicy(WSH))).toEqual({ needed: 2, total: 2, hasRecovery: false });
});

test('spending still works: both keys satisfy the only path', () => {
  const primary = parsePolicy(WSH).paths[0];
  expect(pathRequirement(primary).needed).toBe(2);
  expect(pathSatisfiedBy(primary, [A])).toBe(false);
  expect(pathSatisfiedBy(primary, [A, B])).toBe(true); // ceremony completes
});

/**
 * Decided 2026-07-28: a plain SELF-CUSTODIAL multisig must be the industry-standard
 * wsh(sortedmulti) so it opens in Sparrow / Nunchuk / the COLDCARD, and the
 * COLDCARD must register it as a real multisig wallet — which is what makes
 * its own Settings > Multisig > Export produce a file Sparrow can read.
 */
import { composeMultisig } from '../compose';
import { coldcardMultisigConfig } from '../coldcardRegister';
import { parseDescriptor } from '../parse';

const K = (fp: string, xpub: string) => ({ fingerprint: fp, originPath: "48'/1'/0'/2'", xpub });
const TP = [
  'tpubD6NzVbkrYhZ4XKTpDpd55aveE9jaKSRetSgKpxsQeVys9ePqDdtLsFteg7VrWuew2sRoK6ACau4GDaY3CHoytheBCpPH28qkTt49iHXtXVg',
  'tpubD6NzVbkrYhZ4Yjkmt31ALcdHtYjKnpAvAzVbPZEMYuDeZb1a5S9sMfeaSz7TjSGWBbstfeKSGCHc7SDe5hcsDdxmmeQUaGDBbVMCPicvsec',
  'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK',
];

test('a self-custodial 2-of-3 is wsh(sortedmulti) on the P2WSH account', () => {
  const d = composeMultisig(2, [K('11111111', TP[0]), K('22222222', TP[1]), K('33333333', TP[2])], {
    script: 'wsh',
    providerFingerprints: ['ffffffff'],
  });
  expect(d.startsWith('wsh(sortedmulti(2,')).toBe(true);
  expect(d).toContain("48'/1'/0'/2'"); // BIP-48 script_type 2' IS P2WSH
  expect(parseDescriptor(d).kind).toBe('multisig');
});

test('…and the COLDCARD registers it as a real multisig wallet', () => {
  const d = composeMultisig(2, [K('11111111', TP[0]), K('22222222', TP[1]), K('33333333', TP[2])], {
    script: 'wsh',
    providerFingerprints: ['ffffffff'],
  });
  const cfg = coldcardMultisigConfig('Test vault', d);
  expect(cfg).not.toBeNull();
  expect(cfg).toContain('Format: P2WSH');
  // one Derivation/XFP pair per key — "No keystores specified" was Sparrow
  // reading an export that had none.
  expect((cfg!.match(/Derivation:/g) ?? []).length).toBe(3);
});
