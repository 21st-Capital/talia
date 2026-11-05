/**
 * Compose output descriptors for the vault CREATION flow (Phase 2): the
 * user collects public keys (export file / QR / paste, or a Bluetooth
 * device) and Talia assembles the descriptor string. This is string
 * assembly of PUBLIC material only — BDK parses the result authoritatively
 * at wallet creation and rejects anything malformed.
 *
 * TAPROOT is for LAYERED vaults and for anything holding a 21st Capital key;
 * PLAIN self-custodial shapes follow the industry standard so they open in the
 * wallets people actually use (decided 2026-07-27 for single-sig, 2026-07-28 for
 * multisig). Shapes:
 *   single      wpkh([fp/84'/0'/0']xpub/<0;1>/*)        — BlueWallet, Sparrow
 *   multi, ours tr(<unspendable>,multi_a(k,…))          — blind co-signable
 *   multi, self wsh(sortedmulti(k,[fp/48'/…/2']xpub…))  — Sparrow, Nunchuk, CC
 *   layered     tr(<unspendable>,{<primary>,{and_v(v:…,older(N)),…}})  (Liana)
 *
 * Why the multisig split: our co-signing signs taproot SCRIPT PATHS, so a
 * vault carrying our key has to be taproot. A purely self-custodial one has
 * no such constraint, and BIP-48's script_type 2' — the account these keys
 * already come from — means P2WSH, which is why Sparrow objected to seeing
 * those keys wrapped in tr(). `composeMultisig` therefore defaults to tr (the
 * safe direction) and takes `{ script: 'wsh' }` explicitly, refusing it if any
 * of our own fingerprints is in the vault.
 */
import type { KeyOrigin } from './types';
import { unspendableInternalKey } from './unspendable';

export interface ComposeOpts {
  /**
   * Script wrapper. A PLAIN multisig with none of our keys should be `wsh`
   * (the industry-standard `wsh(sortedmulti)` every wallet reads); anything
   * carrying a 21st Capital key must stay `tr`, because blind co-signing is
   * built on taproot script-path spends (decided 2026-07-28). Layered vaults are
   * always taproot. Defaults to `tr` — the safe direction, since a forgotten
   * option can only cost interop, never break co-signing.
   */
  script?: 'tr' | 'wsh';
  /**
   * 21st Capital's key fingerprints (lowercase). When given, `wsh` is
   * REFUSED if any of them is in the vault: we could not co-sign it, and the
   * client would discover that only when they tried to spend. Structural, so
   * every creation path is covered rather than each wizard remembering.
   */
  providerFingerprints?: Set<string> | string[];
}

/** BIP-68 relative locks are 16-bit in blocks — Liana's ceiling too. */
export const MAX_OLDER_BLOCKS = 65535;

/** Liana's calendar-average month (30.4375 days of blocks). */
export const BLOCKS_PER_MONTH = 4383;

/**
 * Format one key expression: [origin]xpub + multipath receive/change spine.
 *
 * Hardened markers are normalised to the apostrophe form. Recent COLDCARD
 * firmware exports `86h/1h/0h`, and while BIP-380 allows both, `'` is the
 * form every parser accepts — our single-key vaults are meant to open in
 * BlueWallet and Sparrow, not just in Talia (decided 2026-07-27).
 */
export function formatVaultKey(key: KeyOrigin): string {
  const path = key.originPath?.replace(/[hH]/g, "'");
  const origin = key.fingerprint && path ? `[${key.fingerprint}/${path}]` : '';
  return `${origin}${key.xpub}/<0;1>/*`;
}

/**
 * Tracks who has already been added to a vault, so nobody gets counted twice.
 *
 * Two keys can be duplicates in two different ways, and only one of them was
 * caught before (decided 2026-07-29 asked precisely this):
 *
 *   • THE SAME XPUB twice — obvious, and already refused.
 *   • THE SAME SEED at two different accounts. Export 48'/0'/0'/2' and
 *     48'/0'/1'/2' from ONE Coldcard and you get two DIFFERENT xpubs that share
 *     a master fingerprint. An xpub-only check waves that through, and the
 *     result looks like a 2-of-3 while a single seed backup controls two of the
 *     three keys — a 1-of-2 wearing a 2-of-3's clothes. That is a fund-loss
 *     shape, so it is refused, not warned about.
 *
 * The fingerprint is only compared when the key actually carries one: a bare
 * xpub with no origin has an empty fingerprint, and two of those are not
 * evidence of anything.
 *
 * A 4-byte fingerprint can collide between genuinely unrelated seeds (about one
 * pair in four billion). The message names that possibility so the one person
 * who ever hits it is not left guessing.
 */
class SignerSet {
  private xpubs = new Set<string>();
  private fingerprints = new Set<string>();

  constructor(private readonly repeatMessage = 'The same key was added twice.') {}

  add(k: KeyOrigin): void {
    if (this.xpubs.has(k.xpub)) {
      throw new Error(this.repeatMessage);
    }
    const fp = (k.fingerprint || '').toLowerCase();
    if (fp && this.fingerprints.has(fp)) {
      throw new Error(
        'Two of these keys come from the same wallet backup, so one backup ' +
          'would control both of them. The vault would be easier to spend ' +
          'from than it looks. Use a key from a different device or seed. ' +
          '(If these really are separate seeds, they share a fingerprint by ' +
          'coincidence. Contact 21st Capital.)',
      );
    }
    this.xpubs.add(k.xpub);
    if (fp) this.fingerprints.add(fp);
  }
}

function assertKeys(keys: KeyOrigin[], min: number, what: string): void {
  if (keys.length < min) {
    throw new Error(`${what} needs at least ${min} key${min === 1 ? '' : 's'}.`);
  }
  const seen = new SignerSet();
  for (const k of keys) seen.add(k);
}

function assertThreshold(threshold: number, total: number): void {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > total) {
    throw new Error(`Threshold must be between 1 and ${total}.`);
  }
}

/**
 * REFUSE a dead end (decided 2026-07-28, after a 3-of-3 turned up in a phone test).
 *
 * A primary path that needs EVERY key it holds has no margin: lose one key and
 * the coins are gone for good. Talia builds only these shapes —
 *
 *   1-of-1              (a single key, optionally with timelocked layers)
 *   2-of-3              (any two of three)
 *   2-of-2 + recovery   (both keys, with a timelocked way back in)
 *
 * — so k-of-k is allowed at k=2 ONLY, and only when a timelocked path stands
 * behind it. k-of-k for k>2 is never allowed at any threshold. This lives in
 * the composer rather than in a wizard so that EVERY creation path is covered,
 * including the free-form builder.
 */
function assertNotDeadEnd(
  threshold: number,
  total: number,
  opts?: { hasRecovery?: boolean },
): void {
  if (total < 2 || threshold < total) return; // not a k-of-k
  if (total === 2 && opts?.hasRecovery) return; // 2-of-2 + recovery is allowed
  if (total === 2) {
    throw new Error(
      'A 2-of-2 vault needs a recovery path: add an heir key on a timelocked ' +
        'layer, or include the 21st Capital rescue key. Without one, losing ' +
        'either key would lock the funds for good.',
    );
  }
  throw new Error(
    `A vault that needs all ${total} keys for every spend is not offered: ` +
      'losing any one key would lock the funds for good. Use 2 of ' +
      `${total} instead. Any two keys can then spend, and the third is your spare.`,
  );
}

/**
 * Single-sig: native segwit (BIP-84) — what Talia now collects for a plain
 * one-key vault — or taproot when the key was derived for BIP-86 (an
 * imported key, or one from before 2026-07-27). The origin path says what
 * the device intends the key for, and signing only works when script and
 * derivation agree, so this follows the key rather than imposing a shape.
 */
export function composeSinglesig(key: KeyOrigin): string {
  assertKeys([key], 1, 'A single-sig vault');
  const taproot = /^86['h]/.test(key.originPath ?? '');
  return taproot ? `tr(${formatVaultKey(key)})` : `wpkh(${formatVaultKey(key)})`;
}

/** k-of-n multisig (sorted keys — device order doesn't matter). */
export function composeMultisig(
  threshold: number,
  keys: KeyOrigin[],
  opts?: ComposeOpts,
): string {
  assertKeys(keys, 2, 'A multisig vault');
  assertThreshold(threshold, keys.length);
  // A plain multisig has NO timelocked path behind it by definition.
  assertNotDeadEnd(threshold, keys.length, { hasRecovery: false });
  if (opts?.script === 'wsh' && opts.providerFingerprints) {
    const ours =
      opts.providerFingerprints instanceof Set
        ? opts.providerFingerprints
        : new Set(opts.providerFingerprints.map((f) => f.toLowerCase()));
    const clash = keys.find((k) => k.fingerprint && ours.has(k.fingerprint.toLowerCase()));
    if (clash) {
      throw new Error(
        'A vault holding a 21st Capital key must use the taproot form. Our ' +
          'co-signing signs taproot script paths, so a wsh vault could not be ' +
          'co-signed.',
      );
    }
  }
  if (opts?.script === 'wsh') {
    // `sortedmulti` sorts pubkeys at derivation, so the ADDRESSES are the same
    // whatever order we write — sorting here just makes two builds of the same
    // vault produce byte-identical descriptors.
    const sorted = [...keys].sort((a, b) => (a.xpub < b.xpub ? -1 : 1));
    return `wsh(sortedmulti(${threshold},${sorted.map(formatVaultKey).join(',')}))`;
  }
  // BDK 0.28's miniscript predates sortedmulti_a — sort the keys ourselves
  // (by xpub) so device order still doesn't change the descriptor. The
  // unspendable key gets the SORTED list: its chain code commits to the
  // keys in tap-tree order (Liana verifies this on import).
  const sorted = [...keys].sort((a, b) => (a.xpub < b.xpub ? -1 : 1));
  const inner = `multi_a(${threshold},${sorted.map(formatVaultKey).join(',')})`;
  return `tr(${unspendableInternalKey(sorted)}/<0;1>/*,${inner})`;
}

export interface RecoveryPathSpec {
  threshold: number;
  keys: KeyOrigin[];
  /** Blocks of coin inactivity before this path opens. */
  olderBlocks: number;
}

export interface TimelockVaultSpec {
  primary: { threshold: number; keys: KeyOrigin[] };
  recovery: { threshold: number; keys: KeyOrigin[] };
  /** Blocks of coin inactivity before the recovery path opens. */
  olderBlocks: number;
}

/**
 * Liana-style layered vault: primary keys spend any time; recovery keys
 * unlock after each coin sits still for `olderBlocks`.
 */
export function composeTimelockVault(spec: TimelockVaultSpec, opts?: ComposeOpts): string {
  return composeLayeredVault(
    spec.primary,
    [{ threshold: spec.recovery.threshold, keys: spec.recovery.keys, olderBlocks: spec.olderBlocks }],
    opts,
  );
}

/**
 * The full 21st Capital vault shape: a primary layer plus ANY number of
 * timelocked paths (heirs at 8–15 months, the Rescue Key at 15 months) —
 * Liana's multi-recovery structure with nested `or_i`:
 *
 *   wsh(or_d(<primary>, or_i(and_v(v:<r1>,older(N1)), and_v(v:<r2>,older(N2)))))
 */
export function composeLayeredVault(
  primary: { threshold: number; keys: KeyOrigin[] },
  recoveries: RecoveryPathSpec[],
  opts?: ComposeOpts,
): string {
  assertKeys(primary.keys, 1, 'The primary path');
  assertThreshold(primary.threshold, primary.keys.length);
  if (recoveries.length === 0) {
    throw new Error('A layered vault needs at least one timelocked path.');
  }
  // The recovery layers ARE the way back in — so a 2-of-2 primary is fine
  // here, while a 3-of-3 primary is still refused.
  assertNotDeadEnd(primary.threshold, primary.keys.length, { hasRecovery: true });
  // One set across EVERY path: a key that guards the primary path must not
  // also be the one that unlocks a recovery path, and the same-seed rule
  // applies just as much across paths as within one. An heir whose key comes
  // off the owner's own device is not an heir.
  const seen = new SignerSet('Every path must use different keys.');
  for (const k of primary.keys) seen.add(k);
  for (const r of recoveries) {
    assertKeys(r.keys, 1, 'A timelocked path');
    assertThreshold(r.threshold, r.keys.length);
    if (!Number.isInteger(r.olderBlocks) || r.olderBlocks < 1 || r.olderBlocks > MAX_OLDER_BLOCKS) {
      throw new Error(`Timelocks must be between 1 and ${MAX_OLDER_BLOCKS} blocks.`);
    }
    for (const k of r.keys) seen.add(k);
  }

  // Soonest path first, like Liana orders its recovery paths.
  const sorted = [...recoveries].sort((a, b) => a.olderBlocks - b.olderBlocks);

  if (opts?.script === 'wsh') {
    const primaryFrag =
      primary.keys.length === 1
        ? `pk(${formatVaultKey(primary.keys[0])})`
        : `multi(${primary.threshold},${primary.keys.map(formatVaultKey).join(',')})`;
    const frags = sorted.map((r) => {
      const inner =
        r.keys.length === 1
          ? `v:pkh(${formatVaultKey(r.keys[0])})`
          : `v:multi(${r.threshold},${r.keys.map(formatVaultKey).join(',')})`;
      return `and_v(${inner},older(${r.olderBlocks}))`;
    });
    // Nest or_i right-associatively: or_i(f1, or_i(f2, f3)).
    const recoveryTree = frags.reduceRight((acc, f) => (acc ? `or_i(${f},${acc})` : f), '');
    return `wsh(or_d(${primaryFrag},${recoveryTree}))`;
  }

  // Taproot: one tapscript leaf per path — spending reveals ONLY the leaf
  // used, so recovery structure stays private on primary-path spends.
  // Tapscript has no ECDSA multi/pkh: leaves use pk / multi_a.
  const leafKeys = (threshold: number, keys: KeyOrigin[]) =>
    keys.length === 1
      ? `pk(${formatVaultKey(keys[0])})`
      : `multi_a(${threshold},${keys.map(formatVaultKey).join(',')})`;
  const leaves = [
    leafKeys(primary.threshold, primary.keys),
    ...sorted.map((r) => `and_v(v:${leafKeys(r.threshold, r.keys)},older(${r.olderBlocks}))`),
  ];
  // Nest the tree right-associatively: {L1,{L2,L3}}.
  const tree = leaves.reduceRight((acc, f) => (acc ? `{${f},${acc}}` : f), '');
  // Tap-tree order — the unspendable key's chain code commits to it
  // (Liana recomputes and verifies on import).
  const treeKeys = [...primary.keys, ...sorted.flatMap((r) => r.keys)];
  return `tr(${unspendableInternalKey(treeKeys)}/<0;1>/*,${tree})`;
}

/** Months → blocks on Liana's calendar-average scale, capped at BIP-68 max. */
export function monthsToBlocks(months: number): number {
  return Math.min(MAX_OLDER_BLOCKS, Math.round(months * BLOCKS_PER_MONTH));
}
