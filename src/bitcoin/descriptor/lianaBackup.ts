/**
 * Liana's wallet backup, the plain JSON file Liana saves as
 * `liana-backup-<date>.json` (decided 2026-11-05: an import from Liana should
 * bring the vault's name, its key names and its notes along, not only the
 * descriptor). Liana's encrypted backups (.bed, .bip138) hold the descriptor
 * alone, so this file is the only one that carries them.
 *
 * Shape, from `liana-gui/src/backup.rs` (the same at v15.0 and v16.0):
 *
 *   { name?, alias?, accounts: [Account], network, date?, proprietary?, version }
 *   Account = { name?, descriptor, keys?: { <fingerprint>: { key, alias?, ... } },
 *               labels?: [BIP-329 record], transactions?, psbts?, coins?, ... }
 *
 * The file is recognised by that shape: an `accounts` array and a `network`.
 *
 * - **The name.** Liana names every wallet "Liana-" plus its descriptor's
 *   checksum and keeps the name its owner typed as the ALIAS, so the alias
 *   is offered first, then that name, then the account's (the same machine
 *   name in practice). The import still asks, with this name filled in.
 * - **One wallet only.** A backup with no account or with several is
 *   refused: Liana's own import refuses both, and picking one of several
 *   would be a guess about which vault the owner meant.
 * - **The network.** The backup names its network and the descriptor's keys
 *   name theirs; a mainnet backup with test keys, or the reverse, is refused.
 *   Test keys cannot tell Testnet4 from signet or regtest, so any test
 *   network the file names agrees with them.
 * - **Key names** come from each key's `alias`, by lowercase fingerprint, for
 *   the keys the descriptor holds; **notes** from the BIP-329 labels
 *   (see `bip329.ts`: a coin's label becomes its transaction's note when
 *   that transaction has none, and address labels stay out).
 *
 * Private material is never read; the file has none (`importFile` still
 * warns if a file carries any). Pure, tested.
 */
import { txLabelsOf } from '../bip329';
import { parseKeyOrigins, stripChecksum } from './parse';

export interface LianaWalletBackup {
  descriptor: string;
  /** The vault name Liana knew, to offer at the name question. */
  name: string | null;
  /** Key names by lowercase fingerprint, ready for `WalletMeta.keyLabels`. */
  keyLabels: Record<string, string>;
  /** Transaction notes by lowercase transaction id. */
  txNotes: Record<string, string>;
}

/** The networks Liana writes (rust-bitcoin's names), by key family. */
const MAINNET = new Set(['bitcoin']);
const TEST_NETWORKS = new Set(['testnet', 'testnet4', 'signet', 'regtest']);

const MAINNET_KEY = /^[xyzYZ]pub/;
const TEST_KEY = /^[tuvUV]pub/;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Read a Liana wallet backup. Null when `content` is not one, so the next
 * reader can try; throws a sentence the person can act on when it IS one and
 * cannot be imported.
 */
export function parseLianaWalletBackup(content: string): LianaWalletBackup | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const backup = parsed as Record<string, unknown>;
  if (!Array.isArray(backup.accounts) || typeof backup.network !== 'string') return null;

  const accounts = backup.accounts;
  if (accounts.length === 0) {
    throw new Error('This Liana backup holds no wallet.');
  }
  if (accounts.length > 1) {
    throw new Error(
      `This Liana backup holds ${accounts.length} wallets. Back up each wallet on its own in Liana and add them one at a time.`,
    );
  }
  const account = accounts[0];
  const descriptor =
    account && typeof account === 'object' ? text((account as Record<string, unknown>).descriptor) : null;
  if (!descriptor) throw new Error('This Liana backup holds no descriptor.');
  const acc = account as Record<string, unknown>;

  const keys = parseKeyOrigins(stripChecksum(descriptor).body);
  const network = backup.network.trim().toLowerCase();
  const mainnetKeys = keys.some((k) => MAINNET_KEY.test(k.xpub));
  const testKeys = keys.some((k) => TEST_KEY.test(k.xpub));
  if (!MAINNET.has(network) && !TEST_NETWORKS.has(network)) {
    throw new Error(`This Liana backup is for a network Talia does not know ("${backup.network}").`);
  }
  if ((MAINNET.has(network) && testKeys) || (TEST_NETWORKS.has(network) && mainnetKeys)) {
    throw new Error(
      MAINNET.has(network)
        ? 'This Liana backup says Bitcoin, but its keys are test keys. Export the backup again from Liana.'
        : 'This Liana backup says it is a test wallet, but its keys are Bitcoin keys. Export the backup again from Liana.',
    );
  }

  const ownFingerprints = new Set(
    keys.map((k) => k.fingerprint).filter((fp): fp is string => fp != null),
  );
  const keyLabels: Record<string, string> = {};
  const keyMap = acc.keys;
  if (keyMap && typeof keyMap === 'object' && !Array.isArray(keyMap)) {
    for (const [fpRaw, entry] of Object.entries(keyMap as Record<string, unknown>)) {
      const fp = fpRaw.trim().toLowerCase();
      if (!ownFingerprints.has(fp) || !entry || typeof entry !== 'object') continue;
      const alias = text((entry as Record<string, unknown>).alias);
      if (alias) keyLabels[fp] = alias;
    }
  }

  return {
    descriptor,
    name: text(backup.alias) ?? text(backup.name) ?? text(acc.name),
    keyLabels,
    txNotes: Array.isArray(acc.labels) ? txLabelsOf(acc.labels) : {},
  };
}
