/**
 * Strict-mode heir invites: the vault-wide `release_at` estimate.
 *
 * The server withholds the descriptor blob until this date, and it CANNOT
 * compute it — it has no descriptor, no UTXOs, no chain view. The owner's
 * app derives it here from its own per-UTXO countdown machinery and PATCHes
 * it on every sync (design settled 2026-07-24: the server sees ONE
 * date per vault, nothing per-UTXO, nothing per-heir).
 *
 * "Earliest heir unlock" = the smallest heir-path `older(N)` in the policy,
 * applied to the soonest-expiring coin. A stale date self-corrects: coins
 * that weren't refreshed genuinely unlock then, and new deposits always
 * unlock later than the stale minimum.
 *
 * Fail-closed rules (strict mode must never over-release):
 *   - no keyed heirs, no heir-timelocked path, or an inexactly-flattened
 *     policy → null (server never releases until a later sync knows better)
 *   - no coins → null (nothing to time-gate against)
 *   - unconfirmed coin → its clock hasn't started; count the full lock
 */
import { parsePolicy } from '../bitcoin/descriptor';
import type { Utxo, WalletTx } from '../bitcoin/engine/types';
import { utxoExpiries } from './timelock';

/** ~10 minutes per block — the same estimate the timelock UI uses. */
const MS_PER_BLOCK = 10 * 60 * 1000;

export function earliestHeirUnlockIso(input: {
  descriptor: string;
  /** Master fingerprints of the vault's KEYED heirs (any case). */
  heirFingerprints: string[];
  utxos: Utxo[];
  txs: WalletTx[];
  tipHeight: number | undefined;
  nowMs: number;
}): string | null {
  const fps = input.heirFingerprints.map((f) => f.toLowerCase()).filter(Boolean);
  if (fps.length === 0) return null;

  const policy = parsePolicy(input.descriptor);
  if (!policy.exact) return null; // can't trust a partial flattening

  let older: number | null = null;
  for (const path of policy.paths) {
    if (path.olderBlocks == null) continue;
    const hasHeir = path.groups.some((g) =>
      g.keys.some((k) => k.fingerprint && fps.includes(k.fingerprint.toLowerCase())),
    );
    if (hasHeir && (older == null || path.olderBlocks < older)) older = path.olderBlocks;
  }
  if (older == null) return null;

  if (input.utxos.length === 0) return null;
  const expiries = utxoExpiries(input.utxos, input.txs, input.tipHeight, older);
  let minLeft: number | null = null;
  for (const u of input.utxos) {
    const e = expiries.find((x) => x.txid === u.txid && x.vout === u.vout);
    const left = e?.blocksLeft ?? older;
    if (minLeft == null || left < minLeft) minLeft = left;
  }
  if (minLeft == null) return null;
  return new Date(input.nowMs + Math.max(0, minLeft) * MS_PER_BLOCK).toISOString();
}

/**
 * Does this key sit on a TIMELOCKED path of the vault?
 *
 * The Estate Plan lets a client say an off-chain heir has access to any key,
 * including an active PRIMARY one (decided 2026-08-30: "even an active primary
 * key"). Sealing an invite to such a key is perfectly sound, and it is what
 * makes the invite openable only by the person holding it.
 *
 * A countdown is a different matter. `earliestHeirUnlockIso` only looks at
 * paths carrying an `older(...)`, so a primary key yields no release date at
 * all, and a STRICT invite with no release date is one the server withholds
 * forever. The heir would hold a code that never opens anything and nothing
 * would say why. So the ceremony must only offer "nothing until it matters"
 * where there is something to wait for, which is what this answers.
 *
 * Fails CLOSED: an unparseable or partially flattened descriptor returns
 * false, because the honest fallback is the invite that always opens.
 */
export function heirKeyTimelocked(descriptor: string, fingerprint: string | undefined): boolean {
  const fp = (fingerprint ?? '').toLowerCase();
  if (!fp) return false;
  let policy;
  try {
    policy = parsePolicy(descriptor);
  } catch {
    return false;
  }
  if (!policy.exact) return false;
  return policy.paths.some(
    (path) =>
      path.olderBlocks != null &&
      path.groups.some((g) => g.keys.some((k) => k.fingerprint?.toLowerCase() === fp)),
  );
}

/**
 * Can this key sign on a path with NO timelock, today? Found 2026-09-22: an heir
 * whose key sits on the first layer of a 2-of-3 was told spending waits for
 * a timelock. The answer comes from the vault's own policy, never from how
 * the invite was sealed: an owner may send a timelocked heir an open invite.
 * Fails closed (false) on a policy the parser cannot flatten.
 */
export function heirKeyCanSignNow(descriptor: string, fingerprint: string | undefined): boolean {
  const fp = (fingerprint ?? '').toLowerCase();
  if (!fp) return false;
  let policy;
  try {
    policy = parsePolicy(descriptor);
  } catch {
    return false;
  }
  if (!policy.exact) return false;
  return policy.paths.some(
    (path) =>
      path.olderBlocks == null &&
      path.afterHeight == null &&
      path.groups.some((g) => g.keys.some((k) => k.fingerprint?.toLowerCase() === fp)),
  );
}
