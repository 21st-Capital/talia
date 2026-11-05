/**
 * The leaf hazard ("d10" in this file's name), on the signing screens (decided 2026-10-17).
 * Structural, like sentPage.test: the repo has no component tests, and each
 * rule below is a line a later edit could quietly drop. The behaviour behind
 * them is tested on the recorded copies in wallet/__tests__/signingProgress.
 *
 *   - SignPsbt decides "enough signatures", the path it names and the entry
 *     jump with the path-in-play rule (the transaction must open the path,
 *     each signature counted for its own key), never by fingerprint alone;
 *   - a parked partial records the path's own count, and Pending reads the
 *     copy itself before any stored number.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const code = (rel: string) =>
  readFileSync(join(UI, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('SignPsbt', () => {
  const src = code('screens/SignPsbtScreen.tsx');

  it('never calls a path satisfied by fingerprint alone', () => {
    expect(src).not.toMatch(/pathSatisfiedOnEveryInput|pathSatisfiedBy/);
    expect(src).toMatch(/pathInPlay\(parsePolicy\(wallet\.descriptor\), sigStatus, txLocks\)/);
    expect(src).toMatch(/const thresholdMet = finalCopy \|\| satisfiedPath !== null;/);
  });

  it('jumps on entry only when the copy is complete under the same rule', () => {
    expect(src).toMatch(/signingProgress\(wallet\.descriptor, route\.params\.psbtBase64\)\?\.complete === true/);
  });

  it('parks the path\'s own count, never the raw number of signatures', () => {
    expect(src).toMatch(/signatures: progress\?\.signatures \?\? signatures,/);
    expect(src).toMatch(/progress\?\.needed \?\?/);
  });

  it('shows the path\'s own count, and never "0 signatures so far"', () => {
    expect(src).not.toMatch(/\$\{sigStatus\.signatureCount\} signature/);
    expect(src).toMatch(/shownSignatures > 0\s*\?/);
  });
});

describe('Pending transactions', () => {
  const src = code('screens/PendingCosignScreen.tsx');

  it('reads a parked partial off the copy before any stored count', () => {
    expect(src.match(/parkedProgress\(getWallet\(/g)?.length).toBe(2);
    expect(src).not.toMatch(/pending\.signatures\s*>=/);
  });
});
