/**
 * Decided 2026-09-26: signature status ignored the
 * TAP_SCRIPT_SIG leaf hash, so two keys that signed DIFFERENT leaves were
 * counted as completing one path. The network checks each leaf on its own,
 * so the fallback finaliser's witness was accepted and then rejected.
 */
import { encodeBase64, PSBT_MAGIC } from '../export';
import { mergeSignerGroups, psbtSignatureStatus } from '../parse';
import { fallbackWitnessAllowed, pathSatisfiedBy, pathSatisfiedOnEveryInput } from '../../descriptor/policy';
import type { PolicyPath, WalletPolicy } from '../../descriptor/policy';

const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const fill = (b: number, n = 32) => new Array(n).fill(b);

const FP_A = [0xaa, 0xaa, 0xaa, 0x01];
const FP_B = [0xbb, 0xbb, 0xbb, 0x02];
const X_A = fill(0x0a);
const X_B = fill(0x0b);
const L1 = fill(0x11);
const L2 = fill(0x22);

const entry = (keyType: number, keyData: number[], value: number[]) => [
  1 + keyData.length, keyType, ...keyData, value.length, ...value,
];
const tapDerivation = (x: number[], leaves: number[][], fp: number[]) =>
  entry(0x16, x, [leaves.length, ...leaves.flat(), ...fp, ...u32(0)]);
const tapScriptSig = (x: number[], leaf: number[]) => entry(0x14, [...x, ...leaf], fill(0x55, 64));

/** One-input PSBT whose input map holds `entries`. */
function psbtWith(entries: number[][]): string {
  const tx = [...u32(2), 1, ...fill(0xcc), ...u32(0), 0, ...u32(0xfffffffd), 1, ...fill(0, 8), 1, 0x51, ...u32(0)];
  return encodeBase64(
    Uint8Array.from([...PSBT_MAGIC, 1, 0x00, tx.length, ...tx, 0, ...entries.flat(), 0, 0]),
  );
}

const TWO_OF_TWO: PolicyPath = {
  groups: [{ threshold: 2, keys: [{ fingerprint: 'aaaaaa01' }, { fingerprint: 'bbbbbb02' }] }],
} as unknown as PolicyPath;

describe('signature status per (pubkey, leaf hash)', () => {
  it('two keys signing DIFFERENT leaves never complete one path', () => {
    const psbt = psbtWith([
      tapDerivation(X_A, [L1], FP_A),
      tapDerivation(X_B, [L1, L2], FP_B),
      tapScriptSig(X_A, L1),
      tapScriptSig(X_B, L2),
    ]);
    const s = psbtSignatureStatus(psbt);
    // The old, leaf-blind reading said both signed, and the path was met.
    expect(pathSatisfiedBy(TWO_OF_TWO, s.signedFingerprints)).toBe(true);
    // Per leaf it is not.
    expect(pathSatisfiedOnEveryInput(TWO_OF_TWO, s.signerGroups)).toBe(false);
  });

  it('the same two keys on the SAME leaf do', () => {
    const psbt = psbtWith([
      tapDerivation(X_A, [L1], FP_A),
      tapDerivation(X_B, [L1, L2], FP_B),
      tapScriptSig(X_A, L1),
      tapScriptSig(X_B, L1),
    ]);
    expect(pathSatisfiedOnEveryInput(TWO_OF_TWO, psbtSignatureStatus(psbt).signerGroups)).toBe(true);
  });

  it("a signature for a leaf the key's own derivation does not list is not counted", () => {
    const psbt = psbtWith([tapDerivation(X_A, [L1], FP_A), tapScriptSig(X_A, L2)]);
    expect(psbtSignatureStatus(psbt).signedFingerprints).toEqual([]);
  });

  it('copies of one transaction merge per leaf', () => {
    const a = psbtSignatureStatus(psbtWith([tapDerivation(X_A, [L1], FP_A), tapScriptSig(X_A, L1)])).signerGroups;
    const b = psbtSignatureStatus(psbtWith([tapDerivation(X_B, [L1], FP_B), tapScriptSig(X_B, L1)])).signerGroups;
    expect(pathSatisfiedOnEveryInput(TWO_OF_TWO, mergeSignerGroups(a, b))).toBe(true);
    const c = psbtSignatureStatus(psbtWith([tapDerivation(X_B, [L2], FP_B), tapScriptSig(X_B, L2)])).signerGroups;
    expect(pathSatisfiedOnEveryInput(TWO_OF_TWO, mergeSignerGroups(a, c))).toBe(false);
  });

  it('the fallback check refuses signatures spread over two leaves', () => {
    const policy = { exact: true, paths: [TWO_OF_TWO] } as unknown as WalletPolicy;
    const spread = psbtSignatureStatus(
      psbtWith([
        tapDerivation(X_A, [L1], FP_A),
        tapDerivation(X_B, [L1, L2], FP_B),
        tapScriptSig(X_A, L1),
        tapScriptSig(X_B, L2),
      ]),
    );
    expect(fallbackWitnessAllowed(policy, { signerGroups: spread.signerGroups }).allowed).toBe(false);
  });
});
