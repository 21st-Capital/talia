/**
 * Found in a phone test (2026-07-28): "the name of the vault is not being transmitted to the
 * Coldcard — it shows a random wallet name instead."
 *
 * The QR carried a bare descriptor, which has nowhere to put a name, so the
 * firmware fell back to its "M-of-N" default. These pin the payload that DOES
 * carry it — and pin the two firmware limits that make it work:
 *   • ONE line (the Q's scanner reads a single line per scan)
 *   • a 2–20 char printable-ASCII name (the firmware asserts both bounds)
 */
import { coldcardNamedImport, coldcardWalletName, coldcardMultisigConfig } from '../coldcardRegister';

const DESC =
  "wsh(sortedmulti(2,[11111111/48'/1'/0'/2']tpubD6NzVbkrYhZ4XKTpDpd55aveE9jaKSRetSgKpxsQeVys9ePqDdtLsFteg7VrWuew2sRoK6ACau4GDaY3CHoytheBCpPH28qkTt49iHXtXVg/<0;1>/*,[22222222/48'/1'/0'/2']tpubD6NzVbkrYhZ4Yjkmt31ALcdHtYjKnpAvAzVbPZEMYuDeZb1a5S9sMfeaSz7TjSGWBbstfeKSGCHc7SDe5hcsDdxmmeQUaGDBbVMCPicvsec/<0;1>/*,[33333333/48'/1'/0'/2']tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK/<0;1>/*))";

test('the QR payload carries the vault name', () => {
  const payload = coldcardNamedImport('Family Savings', DESC);
  const parsed = JSON.parse(payload) as { name: string; desc: string };
  expect(parsed.name).toBe('Family Savings');
  expect(parsed.desc).toBe(DESC);
});

test('…on a SINGLE line — a static QR is truncated at the first newline', () => {
  expect(coldcardNamedImport('Family Savings', DESC)).not.toContain('\n');
});

test('names are clamped to what the firmware accepts (2–20, printable ASCII)', () => {
  expect(coldcardWalletName('A very long vault name indeed').length).toBeLessThanOrEqual(20);
  expect(coldcardWalletName('Küstenwächter 🏦')).toMatch(/^[\x20-\x7e]+$/);
  // a 1-char name is REJECTED by the firmware — fall back rather than fail
  expect(coldcardWalletName('A').length).toBeGreaterThanOrEqual(2);
  expect(coldcardWalletName('   ').length).toBeGreaterThanOrEqual(2);
});

test('the microSD file still carries the name its own way', () => {
  const cfg = coldcardMultisigConfig('Family Savings', DESC);
  expect(cfg).toContain('Name: Family Savings');
  expect(cfg).toContain('Policy: 2 of 3');
});
