/**
 * Talia descriptor → Ledger WALLET POLICY (decided 2026-08-27, Gen5 over BLE).
 *
 * The Ledger Bitcoin app (≥2.1) doesn't take descriptors — it takes a
 * "wallet policy": a descriptor TEMPLATE whose key expressions are replaced
 * by placeholders (`@0/**`, `@1/**`, …) plus a separate ordered key list
 * (`[fingerprint/path]xpub`). Registration puts the policy on the device
 * (user verifies on screen) and returns an HMAC; signing later presents the
 * policy + HMAC. Documented in app-bitcoin-new/doc/wallet.md.
 *
 * This module is a TOKEN-level transform, not a miniscript compiler: it
 * finds every key expression in one of our composed descriptors (wpkh,
 * wsh(sortedmulti), tr(NUMS,multi_a), layered tr tap-trees), lifts it into
 * the key list, and leaves every operator exactly as written. The device is
 * the authority on whether it ACCEPTS the resulting policy — we translate
 * faithfully and let it judge (same division of labour as with BDK).
 *
 * Key facts encoded here:
 *  - `/<0;1>/*` (our multipath receive+change) is spelled `/**` in policies.
 *  - Other multipath pairs stay explicit (`/<2;3>/*` is valid policy syntax).
 *  - The SAME key appearing twice gets the SAME placeholder (dedup by
 *    origin+xpub) — policies require it.
 *  - The NUMS unspendable internal key has no origin info; it is lifted as a
 *    bare xpub key entry (what Liana registers on Ledger too).
 *
 * Pure: no device, no native. Fully unit-tested against compose fixtures.
 */

/** One `[origin]xpub/<a;b>/*` (origin optional) key expression. */
const KEY_EXPR = /(\[[0-9a-fA-F]{8}(?:\/[0-9]+[h']?)*\])?([xt]pub[1-9A-HJ-NP-Za-km-z]{80,120})(\/(?:<\d+;\d+>|\d+)\/\*|\/\*)?/g;

export interface LedgerPolicy {
  /** ≤16 ascii chars — shown on the device during registration. */
  name: string;
  /** The template with `@i` placeholders, ready for WalletPolicy. */
  descriptorTemplate: string;
  /** Ordered `[fingerprint/path]xpub` (or bare xpub) key strings. */
  keys: string[];
}

/** The refusal for a vault no signing device can be shown at all. */
const UNSUPPORTED_VAULT = 'This vault type cannot be registered on a signing device.';

/** Why a descriptor can't become a policy, or null when it can. */
export function ledgerPolicyBlocker(descriptor: string): string | null {
  const body = descriptor.split('#')[0].trim();
  if (!/^(wpkh|wsh|tr|sh)\(/.test(body)) {
    return UNSUPPORTED_VAULT;
  }
  if (!KEY_EXPR.test(body)) {
    return 'No keys found in this vault.';
  }
  KEY_EXPR.lastIndex = 0;
  // BIP-388 templates allow only /** or /<M;N>/* after a key. A SINGLE
  // branch (/0/*) appears when a vault was imported as separate
  // receive/change strings — translating it would produce a template the
  // device rejects as a mysterious error, so refuse with the real reason.
  if (/[xt]pub[1-9A-HJ-NP-Za-km-z]{80,120}\/\d+\/\*/.test(body)) {
    return 'This vault keeps its receiving and change addresses as two separate lists, which a signing device cannot take. Import it again as one combined list to register it.';
  }
  return nonRangedBlocker(body);
}

/**
 * The refusal for a NON-RANGED vault (see `everyKeyRanged`), or null.
 *
 * Its own export because the device registry reads it too
 * (`deviceSuitsVault`, through each brand's `scriptBlocker`): a vault no
 * Ledger or BitBox can be shown must not list those devices, link a key to
 * them, or let a key recorded on one open Send. Refusing only at connect
 * time let the owner build a spend first and meet the refusal after
 * unlocking the device (decided 2026-10-17).
 */
export function nonRangedBlocker(descriptor: string): string | null {
  return everyKeyRanged(descriptor.split('#')[0].trim()) ? null : UNSUPPORTED_VAULT;
}

/**
 * Does every key of the vault RANGE over addresses the way a wallet policy
 * can write it?
 *
 * A wallet policy has no way to write a key that stays put: every
 * placeholder is `@i/**` or `@i/<a;b>/*`. A NON-RANGED vault (one fixed
 * address: `xpub/0/7`, a bare `xpub`, a raw public key) therefore has no
 * template at all, and the token transform below used to make one anyway:
 * the library's shape tests (decided 2026-10-17) caught `wpkh(@0/**\/0/7)`
 * and `wsh(multi(2,@0/**\/0/5,@1/**\/0/5))` being handed to the device.
 * A bare `xpub` came out as `@0/**`, a valid template of a DIFFERENT wallet.
 * The vault is refused before any device is asked, like every other shape
 * the translator cannot carry faithfully.
 *
 * A key ending in a single `/*` ranges, but over ONE list straight under the
 * key (`m/84'/1'/0'/i`), and a policy has no placeholder for that either:
 * `@i/**` means `/<0;1>/*`, so it too came out as the template of another
 * wallet (decided 2026-10-17; a pasted `[fp/84'/1'/0']tpub…/*` stores it, and
 * the device took it as its standard account, deriving `m/84'/1'/0'/0/i`).
 */
function everyKeyRanged(body: string): boolean {
  const re = new RegExp(KEY_EXPR.source, 'g');
  let rest = '';
  let from = 0;
  for (let m = re.exec(body); m != null; m = re.exec(body)) {
    // No wildcard after the key: it names one key, not a range.
    if (m[3] == null) return false;
    // One list straight under the key: no placeholder writes it.
    if (m[3] === '/*') return false;
    // Anything but the end of the key after the wildcard (more path, a
    // hardened mark) is not a placeholder either.
    const end = m.index + m[0].length;
    const next = body.charAt(end);
    if (next !== '' && !',)}'.includes(next)) return false;
    rest += body.slice(from, m.index);
    from = end;
  }
  rest += body.slice(from);
  // What is left holds no extended key. A raw public key (66 hex digits, 64
  // for an x-only key, 130 uncompressed) is a fixed key too; a hash under
  // sha256() or hash256() is 64 hex digits and is not a key.
  const hex = /[0-9a-fA-F]{64,}/g;
  for (let m = hex.exec(rest); m != null; m = hex.exec(rest)) {
    const hash = m[0].length === 64 && /(?:sha256|hash256)\($/.test(rest.slice(0, m.index));
    if (!hash) return false;
  }
  return true;
}

/**
 * Translate one of our descriptors into a Ledger wallet policy.
 * Throws with a user-readable message on anything untranslatable.
 */
export function descriptorToLedgerPolicy(descriptor: string, name: string): LedgerPolicy {
  const blocker = ledgerPolicyBlocker(descriptor);
  if (blocker) throw new Error(blocker);
  const body = descriptor.split('#')[0].trim();

  const keys: string[] = [];
  const indexByKey = new Map<string, number>();

  const template = body.replace(KEY_EXPR, (_m, origin: string | undefined, xpub: string, suffix: string | undefined) => {
    const keyString = `${origin ?? ''}${xpub}`;
    let idx = indexByKey.get(keyString);
    if (idx == null) {
      idx = keys.length;
      keys.push(keyString);
      indexByKey.set(keyString, idx);
    }
    // Path suffix → placeholder derivation. The blocker above lets through
    // only `/<0;1>/*` and other `/<a;b>/*` pairs; nothing else is ever
    // widened into `/**`, the template of a different wallet.
    if (suffix === '/<0;1>/*') return `@${idx}/**`;
    return `@${idx}${suffix ?? ''}`; // e.g. an explicit /<2;3>/* stays as written
  });

  // The device shows the name during registration — keep it legible.
  const deviceName = name
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 16)
    .trim() || 'Talia vault';

  return { name: deviceName, descriptorTemplate: template, keys };
}

/**
 * True when the policy is one the device accepts WITHOUT registration
 * (single-key standard shapes) — signing can skip the registration ceremony.
 */
export function isDefaultPolicy(policy: LedgerPolicy): boolean {
  return (
    policy.keys.length === 1 &&
    ['pkh(@0/**)', 'sh(wpkh(@0/**))', 'wpkh(@0/**)', 'tr(@0/**)'].includes(
      policy.descriptorTemplate,
    )
  );
}
