/**
 * Registering a vault on a device, as the device shows it (decided 2026-10-04:
 * "do we have the process of registering a vault animated and built for
 * each device?", then three videos of ONE 2-of-3 testnet vault
 * registered on a Nano Gen5, a Nano X and a BitBox02 Nova). Pure: the
 * facts the pages are made from, the pages per device family in the
 * firmware's own words, and the device's word after the approval. Drawn by
 * `deviceTurns.ts` as the client's turn, round and round, in every flow that
 * registers (`connectedDevice.registerVault` hands the facts to the flows).
 *
 *   touchscreen Ledgers   "Review account to register" / "Swipe to review";
 *                         "Account name" and "Spending policy" on one page;
 *                         "Review co-signer public keys"; one page per key,
 *                         "External key@0" and the device's own "Internal
 *                         key@2", each "[fingerprint/path]tpub…"; "Register
 *                         account?" with a dark Approve button; "n of 7" and
 *                         Reject in the footer; then an outlined tick over
 *                         "Account registered"
 *   Nano X                the same, one item a page: "Review account to
 *                         register", "Account name", "Spending policy",
 *                         "Review co-signer public keys", each key over pages
 *                         of three lines broken where the device's own font
 *                         breaks them (`nanoFont.ts`; two test keys over 56, 56
 *                         and 22 characters, and 57, 50 and 27), "Their
 *                         key@0 (1/3)" and the device's own "Our
 *                         key@1 (2/3)", a tick over "Register account"; then
 *                         "Account registered"
 *   BitBox02 Nova         every page headed "Register" with × and >: "2-of-3
 *                         / BTC Testnet multisig", the name, "p2wsh at
 *                         m/48'/1'/0'/2'" (the device's own account),
 *                         "Cosigner 1/3 (this device): tpub…" to "Cosigner
 *                         3/3: tpub…" as one scrolling line each, the last
 *                         held (the down arrow, then the up arrow, both edges
 *                         held until they meet, as on Total); then "Multisig
 *                         account registered" with a tick
 *
 * Which key is the device's own: the three videos register the SAME vault,
 * and the key the Nano X calls "Our key@1" is the one the Gen5 calls
 * "External key@1", while the Gen5's "Internal key@2" is the Nano X's "Their
 * key@2": each device names the key whose origin fingerprint is its own. The
 * Ledgers mark every key of their seed; the BitBox's multisig config names
 * ONE position (the bridge's `our_xpub_index`, its first key at the account
 * sent), so "(this device)" goes on that cosigner alone (`novaOwnKey`).
 *
 * CONFIRMED by the videos: the classic 2-of-3, `wsh(sortedmulti)`, on all
 * three. NOT filmed, drawn from the firmwares' sources as remembered and
 * reported as unconfirmed (`unconfirmed`): a policy vault (taproot,
 * miniscript) on the BitBox ("BTC policy with N keys", "Name", "Policy",
 * "Key i/n" with "This device: " before its own, "Policy registered"), and
 * the Ledger's words for a policy that is not that plain k-of-n, where the
 * template the device checks is drawn in place of the sentence.
 */
import type { Network } from '../../bitcoin/descriptor/types';
import { descriptorToLedgerPolicy, isDefaultPolicy, ledgerPolicyBlocker } from '../../bitcoin/ledger/policy';
import type { LedgerPolicy } from '../../bitcoin/ledger/policy';
import { bitboxAccountKeypath, splitKeyString } from '../../bitcoin/bitbox/policy';
import { bitboxCoin, bitboxVaultKind, isTouchscreen } from './signingDevice';
import type { DeviceDrawing, ReviewPage } from './signingDevice';
import { nanoPages } from './nanoFont';

/** What every registration page is made from: the vault as the device is
 *  shown it, and which of its keys the device holds. */
export interface RegisterFacts {
  network: Network;
  /** The name as sent (at most 16 ASCII characters, `descriptorToLedgerPolicy`). */
  name: string;
  /** The BIP-388 template the device checks ("wsh(sortedmulti(2,@0/**,@1/**,@2/**))"). */
  template: string;
  /** The keys in the policy's order, "[fingerprint/path]xpub" (a NUMS key bare). */
  keys: string[];
  /** The indices of the device's own key(s): the origin fingerprint is the device's. */
  own: number[];
  /** A plain k-of-n of the classic kind (`wsh(sortedmulti)`), else null. */
  multisig: { threshold: number; keys: number } | null;
  /** The account keypath of the device's own key ("m/48'/1'/0'/2'"), the
   *  BitBox's own page; null when the device holds no key of the vault. */
  ownKeypath: string | null;
}

/**
 * The facts for a vault and the device in hand, or null where nothing is
 * registered: a vault the devices cannot take, or a plain one-key vault,
 * which they sign as a standard account with no ceremony.
 */
export function registerFacts(vault: { descriptor: string; label: string; network: Network }, fingerprint: string): RegisterFacts | null {
  if (ledgerPolicyBlocker(vault.descriptor)) return null;
  let policy: LedgerPolicy;
  try {
    policy = descriptorToLedgerPolicy(vault.descriptor, vault.label);
  } catch {
    return null;
  }
  if (isDefaultPolicy(policy)) return null;
  const fp = fingerprint.toLowerCase();
  const parts = policy.keys.map(splitKeyString);
  const own = parts.flatMap((k, i) => (k.rootFingerprintHex === fp ? [i] : []));
  const kind = bitboxVaultKind(vault.descriptor, vault.label);
  return {
    network: vault.network,
    name: policy.name,
    template: policy.descriptorTemplate,
    keys: policy.keys,
    own,
    multisig: kind?.kind === 'multisig' ? { threshold: kind.threshold, keys: kind.keys } : null,
    ownKeypath: bitboxAccountKeypath(parts, fp),
  };
}

/** Whether the pages for these facts go beyond what the videos showed: a
 *  policy vault on the BitBox, and the Ledgers' words for a policy that is
 *  not the plain k-of-n. */
export function unconfirmed(f: RegisterFacts): boolean {
  return f.multisig == null;
}

// ─── The Ledgers ─────────────────────────────────────────────────────────────

/**
 * "Spending policy" as the Ledgers print it: "Any 2 of @0, @1 and @2 must
 * sign" for the classic multisig (both videos); any other policy as the
 * template the device checks (unconfirmed: not filmed).
 */
export function ledgerPolicyWords(f: RegisterFacts): string {
  if (f.multisig == null) return f.template;
  const slots = Array.from({ length: f.multisig.keys }, (_, i) => `@${i}`);
  const list = slots.length > 1 ? `${slots.slice(0, -1).join(', ')} and ${slots[slots.length - 1]}` : slots[0];
  return `Any ${f.multisig.threshold} of ${list} must sign`;
}

/** The touchscreens' title over a key: the device's own is "Internal". */
export function touchKeyTitle(f: RegisterFacts, i: number): string {
  return `${f.own.includes(i) ? 'Internal' : 'External'} key@${i}`;
}

/** The Nano X shows a key over pages of this many lines under the title
 *  (NBGL's four lines a page less the title's), each line broken where the
 *  device's font breaks it (`nanoFont.ts`). The video: two of its keys over
 *  56, 56 and 22 characters, and 57, 50 and 27; a fixed count of
 *  characters matched the first key alone (decided 2026-10-04). */
export const NANO_KEY_LINES = 3;

export function nanoKeyPages(key: string): string[] {
  const pages = nanoPages(key, NANO_KEY_LINES);
  return pages.length > 0 ? pages : [''];
}

/** The Nano X's title over a key's page: the device's own is "Our key";
 *  the page count only past one page, as the device numbers them. */
export function nanoKeyTitle(f: RegisterFacts, i: number, page: number, pages: number): string {
  const who = `${f.own.includes(i) ? 'Our' : 'Their'} key@${i}`;
  return pages > 1 ? `${who} (${page}/${pages})` : who;
}

// ─── The BitBox ──────────────────────────────────────────────────────────────

/**
 * The one key the BitBox's multisig config names as the device's: its first
 * key at the account keypath sent with the registration (the bridge's
 * `our_xpub_index`, `bitboxAccountKeypath`), so the firmware prints "(this
 * device)" on that cosigner alone, whatever else of the seed the vault
 * holds (decided 2026-10-04). Null when the device holds no key of the vault.
 */
export function novaOwnKey(f: RegisterFacts): number | null {
  if (f.ownKeypath == null) return null;
  return f.own.find((i) => splitKeyString(f.keys[i]).keypath === f.ownKeypath) ?? null;
}

/** The BitBox's line for a key: "Cosigner 1/3 (this device): tpub…" on the
 *  classic multisig (the video; `novaOwnKey`); on a policy "This device:
 *  [fp/path]xpub" under its "Key 1/3" title (unconfirmed). */
export function novaKeyLine(f: RegisterFacts, i: number): string {
  if (f.multisig) return `Cosigner ${i + 1}/${f.keys.length}${novaOwnKey(f) === i ? ' (this device)' : ''}: ${splitKeyString(f.keys[i]).xpub}`;
  return `${f.own.includes(i) ? 'This device: ' : ''}${f.keys[i]}`;
}

// ─── The pages ───────────────────────────────────────────────────────────────

/** The pages a device walks the client through, in its own words and order. */
export function registerPages(d: DeviceDrawing, f: RegisterFacts): ReviewPage[] {
  if (isTouchscreen(d)) {
    return [
      { kind: 'touch-register-intro' },
      { kind: 'touch-register-account', name: f.name, policy: ledgerPolicyWords(f) },
      { kind: 'touch-register-keys' },
      ...f.keys.map((key, i): ReviewPage => ({ kind: 'touch-register-key', title: touchKeyTitle(f, i), key })),
      { kind: 'touch-register-approve' },
    ];
  }
  if (d === 'nanoX') {
    return [
      { kind: 'nano-register-intro' },
      { kind: 'nano-item', title: 'Account name', value: f.name },
      { kind: 'nano-item', title: 'Spending policy', value: ledgerPolicyWords(f), long: true },
      { kind: 'nano-register-keys' },
      ...f.keys.flatMap((key, i): ReviewPage[] => {
        const pages = nanoKeyPages(key);
        return pages.map((value, p) => ({ kind: 'nano-item', title: nanoKeyTitle(f, i, p + 1, pages.length), value, long: true }));
      }),
      { kind: 'nano-register-approve' },
    ];
  }
  if (d === 'nova') {
    const coin = bitboxCoin(f.network);
    const n = f.keys.length;
    const keys = (title: (i: number) => string): ReviewPage[] =>
      f.keys.map((_, i) => ({ kind: 'nova-scroll', title: title(i), body: novaKeyLine(f, i), hold: i === n - 1 }));
    if (f.multisig) {
      return [
        { kind: 'nova-item', title: 'Register', body: `${f.multisig.threshold}-of-${f.multisig.keys}\n${coin} multisig` },
        { kind: 'nova-item', title: 'Register', body: f.name },
        ...(f.ownKeypath ? [{ kind: 'nova-item', title: 'Register', body: `p2wsh\nat\n${f.ownKeypath}` } as const] : []),
        ...keys(() => 'Register'),
      ];
    }
    // A wallet policy (unconfirmed: drawn from the firmware's source as
    // remembered, never filmed).
    return [
      { kind: 'nova-item', title: 'Register', body: `${coin}\npolicy with\n${n} key${n === 1 ? '' : 's'}` },
      { kind: 'nova-item', title: 'Name', body: f.name },
      { kind: 'nova-scroll', title: 'Policy', body: f.template, hold: false },
      ...keys((i) => `Key ${i + 1}/${n}`),
    ];
  }
  return [{ kind: 'slab-register' }];
}

/** The device's own word once the vault is approved. */
export function registeredWords(d: DeviceDrawing, f: RegisterFacts): string {
  if (d === 'nova') return f.multisig ? 'Multisig account registered' : 'Policy registered';
  return 'Account registered';
}
