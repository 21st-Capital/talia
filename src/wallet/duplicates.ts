/**
 * Duplicate-vault detection (decided 2026-07-18): the same vault must not be
 * added twice. Two wallets are the same vault when either
 *   (a) their descriptors match after normalization (checksum/whitespace
 *       stripped), or
 *   (b) their CANONICAL POLICY SIGNATURES match: same script wrapper, same
 *       spending paths (timelocks, thresholds) and same key sets per group —
 *       catching the same vault in different clothes (multipath vs split,
 *       checksum or not, reordered multisig keys).
 *
 * Crucially, the same KEYS under a different policy (another timelock,
 * another threshold, another wrapper) is a DIFFERENT wallet on-chain and is
 * allowed — a v1 of this rule over-matched on the bare key set (found while
 * rebuilding a test vault with new parameters).
 */
import { parsePolicy } from '../bitcoin/descriptor';
import type { WalletMeta } from './types';

const canon = (d: string): string =>
  d.replace(/#[a-z0-9]{8}\s*$/i, '').replace(/\s+/g, '');

const wrapperOf = (d: string): string => {
  const m = /^([a-z]+(?:\([a-z]+)?)\(/.exec(canon(d));
  return m?.[1] ?? '';
};

/** Structure-complete signature: wrapper + paths + thresholds + key sets. */
const policySig = (d: string): string | null => {
  try {
    const p = parsePolicy(d);
    if (!p.exact) return null; // never dedupe on an approximate flattening
    return (
      wrapperOf(d) +
      '|' +
      JSON.stringify(
        p.paths.map((path) => ({
          o: path.olderBlocks ?? null,
          a: path.afterHeight ?? null,
          g: path.groups.map((g) => ({
            t: g.threshold,
            k: [...new Set(g.keys.map((k) => k.xpub))].sort(),
          })),
        })),
      )
    );
  } catch {
    return null;
  }
};

/** The existing wallet this descriptor duplicates, or null. */
export function findDuplicateWallet(
  descriptor: string,
  wallets: WalletMeta[],
): WalletMeta | null {
  const target = canon(descriptor);
  const targetSig = policySig(descriptor);
  for (const w of wallets) {
    if (canon(w.descriptor) === target) return w;
    if (targetSig != null && policySig(w.descriptor) === targetSig) return w;
  }
  return null;
}

/** The user-facing refusal, phrased once so every entry point agrees. */
export function duplicateVaultMessage(existing: WalletMeta): string {
  return (
    `This vault already exists in Talia as \u201C${existing.label}\u201D. ` +
    'A vault is defined by its keys and policy, not its name, so renaming it ' +
    'here does not create a new one. Open the existing vault from the home ' +
    'screen, or change the keys, threshold, or timelock to build a genuinely ' +
    'different vault.'
  );
}
