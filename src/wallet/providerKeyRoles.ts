/**
 * Which 21st Capital keys a vault holds, and what each one is for.
 *
 * The rule the app has always used, in three separate places until now
 * (RescueScreen, ImportScreen, LayeredVaultScreen): a 21C key that spends on
 * a TIMELOCKED path is the rescue key; one that spends without waiting is the
 * co-signer. Shared here for the key check on the testing call (decided
 * 2026-09-07), which needs the role, the account number and the full public
 * key of every one of our keys in the vault.
 *
 * String classification only: the descriptor layer's parsers, never BDK.
 */
import { parseKeyOrigins, parsePolicy, stripChecksum } from '../bitcoin/descriptor';

export type ProviderKeyRole = 'cosigner' | 'rescue' | 'unknown';

export interface ProviderKeyEntry {
  /** Lowercase 8-hex master fingerprint. */
  fingerprint: string;
  /** Origin path, e.g. "48'/0'/1041'/2'". */
  originPath?: string;
  /** The full extended public key, exactly as it appears in the descriptor. */
  xpub: string;
  role: ProviderKeyRole;
  /** Blocks the rescue path waits; only on a rescue key. */
  olderBlocks?: number;
  /** The 21st Capital account number, read off the origin path
   *  (48'/coin'/ACCOUNT'/2'); absent when the path has another shape. */
  accountIndex?: number;
}

/** The account number in a BIP-48 origin path, or undefined. */
export function accountIndexOf(originPath?: string): number | undefined {
  if (!originPath) return undefined;
  const m = /^48'\/[01]'\/(\d+)'\/2'$/.exec(originPath.replace(/[hH]/g, "'"));
  return m ? Number(m[1]) : undefined;
}

/** A vault as 21st Capital numbers it: what the backend judges it by. */
export interface VaultNumber {
  account: number;
  /** Spelled as the backend spells its networks. */
  network: 'mainnet' | 'testnet4';
}

/**
 * Which vault this is, in 21st Capital's numbering, read off our own key.
 *
 * Both of our keys in a vault sit at the SAME account number on two separate
 * seeds, so either one answers. Talia asks this so the co-signing limits
 * screen can name the vault it wants the limits of: a client's vaults carry
 * their own limits, and answering for the client told them one thing while
 * the request was judged by another (decided 2026-09-23).
 *
 * null when our keys are absent, unreadable, or disagree. Never a guess: a
 * wrong number would show somebody another vault's limits.
 */
export function vaultNumberOf(
  descriptor: string,
  providerFps: ReadonlySet<string>,
): VaultNumber | null {
  const { body } = stripChecksum(descriptor);
  const seen = new Set<string>();
  const found = new Set<string>();
  let answer: VaultNumber | null = null;
  for (const k of parseKeyOrigins(body)) {
    const fp = k.fingerprint?.toLowerCase();
    if (!fp || !providerFps.has(fp) || seen.has(k.xpub)) continue;
    seen.add(k.xpub);
    const account = accountIndexOf(k.originPath);
    if (account === undefined) continue;
    // The coin type says which chain, exactly as the backend reads it.
    const coin = /^48'\/([01])'/.exec((k.originPath ?? '').replace(/[hH]/g, "'"))?.[1];
    if (coin === undefined) continue;
    const network: VaultNumber['network'] = coin === '0' ? 'mainnet' : 'testnet4';
    found.add(`${account}:${network}`);
    answer = { account, network };
  }
  return found.size === 1 ? answer : null;
}

/** A client's accounts start here; below it sit only the two old shared
 *  accounts (0 and 1) that every vault built before per-client numbering
 *  holds, which name no vault of anybody's. The backend's RANGE_PERSONAL. */
const FIRST_CLIENT_ACCOUNT = 1000;
/** A client owns a block of ten accounts (the backend's BLOCK). */
const ACCOUNT_BLOCK = 10;

/**
 * Which of a client's vaults an account number is, 1-based, exactly as the
 * backend's vault_of reads it: vault N sits at the block start + N, and
 * vault 10 at the block start itself (1041 is vault 1, 1040 is vault 10).
 * null for an account that is no client's.
 */
export function vaultOfAccount(account: number): number | null {
  if (!Number.isInteger(account) || account < FIRST_CLIENT_ACCOUNT) return null;
  const offset = account % ACCOUNT_BLOCK;
  return offset === 0 ? ACCOUNT_BLOCK : offset;
}

export function providerKeysOf(
  descriptor: string,
  providerFps: ReadonlySet<string>,
): ProviderKeyEntry[] {
  const { body } = stripChecksum(descriptor);
  const seen = new Set<string>();
  const ours: ProviderKeyEntry[] = [];
  for (const k of parseKeyOrigins(body)) {
    const fp = k.fingerprint?.toLowerCase();
    if (!fp || !providerFps.has(fp) || seen.has(k.xpub)) continue;
    seen.add(k.xpub);
    ours.push({
      fingerprint: fp,
      originPath: k.originPath,
      xpub: k.xpub,
      role: 'unknown',
      accountIndex: accountIndexOf(k.originPath),
    });
  }
  if (ours.length === 0) return ours;

  // The role comes from the spending paths. A shape the policy parser cannot
  // flatten faithfully (exact: false puts every key on one unlocked row)
  // leaves every role 'unknown' rather than calling a rescue key a
  // co-signer on the very screen meant to check it.
  let paths;
  try {
    const policy = parsePolicy(descriptor);
    if (!policy.exact) return ours;
    paths = policy.paths;
  } catch {
    return ours;
  }
  for (const entry of ours) {
    let immediate = false;
    let older: number | undefined;
    for (const path of paths) {
      const holds = path.groups.some((g) => g.keys.some((k) => k.xpub === entry.xpub));
      if (!holds) continue;
      if (path.olderBlocks == null && path.afterHeight == null) {
        immediate = true;
      } else if (path.olderBlocks != null && (older == null || path.olderBlocks < older)) {
        older = path.olderBlocks;
      }
    }
    if (immediate) entry.role = 'cosigner';
    else if (older != null) {
      entry.role = 'rescue';
      entry.olderBlocks = older;
    }
  }
  // The co-signer first, the rescue key last, whatever order the descriptor
  // happens to list them in (decided 2026-09-14, reading keys aloud on a
  // verification call). Stable inside each group.
  const RANK: Record<ProviderKeyRole, number> = { cosigner: 0, unknown: 1, rescue: 2 };
  return ours
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => RANK[a.entry.role] - RANK[b.entry.role] || a.i - b.i)
    .map((x) => x.entry);
}

/** Plain name for a role, as the screens say it. */
export function providerKeyRoleLabel(role: ProviderKeyRole): string {
  switch (role) {
    case 'cosigner':
      return 'Co-signer key';
    case 'rescue':
      return 'Rescue key';
    default:
      return '21st Capital key';
  }
}
