/**
 * Asked 2026-07-28: "what if a user imports a vault whose second layer is NOT
 * single-sig — say a 2-of-2 that falls back to a 2-of-3?"
 *
 * We do not build that shape, but it is a reasonable thing to own, and the
 * desktop configurator will offer it. These pin that Talia reads it correctly:
 * it must NOT be flagged as a dead end, and BOTH layers must report their real
 * requirement so a partial signature set can never look complete.
 */
import { parsePolicy, pathRequirement, pathSatisfiedBy, deadEndShape } from '../policy';

const TPUB = [
  'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK',
  'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3',
  'tpubD6NzVbkrYhZ4XKTpDpd55aveE9jaKSRetSgKpxsQeVys9ePqDdtLsFteg7VrWuew2sRoK6ACau4GDaY3CHoytheBCpPH28qkTt49iHXtXVg',
  'tpubD6NzVbkrYhZ4Yjkmt31ALcdHtYjKnpAvAzVbPZEMYuDeZb1a5S9sMfeaSz7TjSGWBbstfeKSGCHc7SDe5hcsDdxmmeQUaGDBbVMCPicvsec',
];
/** BIP-341's NUMS point in a tpub: a provably unspendable internal key. */
const NUMS =
  'tpubD6NzVbkrYhZ4X6BRkDMxFyZxfUCQdjpK27dNgqwDqsQ2PUbMmjjPPFxfcTJiGEjeNz2zLbZ1PRmgCAzXn4pE6tEuQPScXyUbuAgdcec6pMN';
const key = (fp: string, i: number) => `[${fp}/48'/1'/0'/2']${TPUB[i]}/<0;1>/*`;
const A = 'aaaaaaa1';
const B = 'bbbbbbb2';
const C = 'ccccccc3';
const D = 'ddddddd4';

/** 2-of-2 primary (A+B), falling back after ~14 months to 2-of-3 (B,C,D). */
const IMPORTED =
  `tr(${NUMS}/<0;1>/*,{multi_a(2,${key(A, 1)},${key(B, 2)}),` +
  `and_v(v:multi_a(2,${key(B, 2)},${key(C, 3)},${key(D, 0)}),older(61362))})`;

test('both layers report their real requirement', () => {
  const policy = parsePolicy(IMPORTED);
  expect(policy.exact).toBe(true);
  const primary = policy.paths.find((p) => p.olderBlocks === undefined)!;
  const recovery = policy.paths.find((p) => p.olderBlocks !== undefined)!;
  expect(pathRequirement(primary)).toMatchObject({ needed: 2 });
  expect(pathRequirement(primary).keys).toHaveLength(2);
  expect(pathRequirement(recovery)).toMatchObject({ needed: 2 });
  expect(pathRequirement(recovery).keys).toHaveLength(3);
});

test('a partly-signed RECOVERY layer is never treated as complete', () => {
  const recovery = parsePolicy(IMPORTED).paths.find((p) => p.olderBlocks !== undefined)!;
  expect(pathSatisfiedBy(recovery, [C])).toBe(false); // one of three — not enough
  expect(pathSatisfiedBy(recovery, [C, D])).toBe(true);
});

test('a spend is complete when EITHER layer is satisfied', () => {
  const policy = parsePolicy(IMPORTED);
  const anySatisfied = (signed: string[]) =>
    policy.paths.some((p) => pathSatisfiedBy(p, signed));
  expect(anySatisfied([A])).toBe(false);
  expect(anySatisfied([A, B])).toBe(true); // primary
  expect(anySatisfied([C, D])).toBe(true); // recovery layer
});

test('it is NOT flagged as a dead end — the 2-of-2 has a way back in', () => {
  expect(deadEndShape(parsePolicy(IMPORTED))).toBeNull();
});
