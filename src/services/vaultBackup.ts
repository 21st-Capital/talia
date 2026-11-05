/**
 * Vault backup — public-descriptor recovery copies (decided 2026-07-21).
 *
 * The watch-only descriptor holds NO private keys, but it is what rebuilds the
 * vault for recovery: a compatible wallet re-derives the addresses, and
 * co-sign / rescue setups coordinate signing from it. WHICH wallet is
 * compatible depends on the shape — see readerApps() — because a plain
 * one-key vault and a taproot miniscript vault are read by different apps.
 *
 * PRIVACY (a hard rule): 21st Capital must NEVER receive a customer's
 * descriptor unless the customer explicitly chooses to share it (for co-signing
 * or rescue). Every helper here hands the descriptor ONLY to the user's own
 * apps — their mail client, the system share sheet, or their personal iCloud.
 * Nothing is uploaded to a 21st Capital server.
 */
import { Linking } from 'react-native';
import { isLayered } from '../bitcoin/descriptor';
import { base64 as b64codec } from '@scure/base';
import type { WalletMeta } from '../wallet/types';
import { shareBase64File, shareText } from '../platform/files';
import type { ShareOutcome } from '../platform/files';
import { loadSession } from './companyAuth';

type BackupWallet = Pick<WalletMeta, 'label' | 'descriptor' | 'changeDescriptor'> &
  Partial<Pick<WalletMeta, 'kind' | 'network'>>;

/**
 * Which wallets can actually READ this vault — never a generic list.
 * A plain one-key vault is BIP-84 native segwit: BlueWallet and Sparrow open
 * it, Liana cannot (Liana is for layered/multisig policies only). A layered
 * or multisig vault is taproot miniscript: Liana and Sparrow open it,
 * BlueWallet cannot (decided 2026-07-27 — the old copy named all three for
 * everything, which sent people to apps that reject the file).
 */
/**
 * The apps that open this vault, by SHAPE (decided 2026-07-28) — three of them
 * now, not two:
 *
 *   wpkh(…)            plain single key   → BlueWallet, Sparrow
 *   wsh(sortedmulti…)  standard multisig  → Sparrow, Nunchuk, the COLDCARD
 *   tr(…) + timelocks  layered vault      → Liana (and Talia Desktop, coming)
 *
 * Help text always speaks for MAINNET, where our clients are — a caveat that
 * only bites on a test network is noise to them (decided 2026-07-28).
 */
export function readerAppList(kind?: string, descriptor?: string): string[] {
  const d = descriptor?.trim() ?? '';
  // The timelock decides FIRST. Liana opens LAYERED vaults, meaning a
  // timelocked recovery path exists, whatever the script wrapper: Liana's
  // own legacy vaults are wsh(or_d(...older...)) and must route to Liana too,
  // not to Sparrow on the strength of their prefix (decided 2026-09-02).
  // Being taproot is not enough either: a co-signer vault with no rescue and
  // no heir layer is tr(NUMS,multi_a(...)) and Liana refuses it on import.
  if (isLayered(d)) return ['Liana'];
  if (d.startsWith('wsh(')) return ['Sparrow', 'Nunchuk', 'your hardware wallet'];
  if (d.startsWith('wpkh(') || kind === 'single-sig') return ['BlueWallet', 'Sparrow'];
  // Untimelocked taproot multisig: no third-party wallet is known to open the
  // descriptor (no third-party GUI is known to cross-check a plain
  // tr(NUMS,multi_a) vault), so the honest list is empty and the copy says
  // Talia alone.
  return [];
}

/**
 * Restore steps for the apps that can actually open THIS vault. Built from the
 * same list the rest of the copy uses, so an email never instructs a restore
 * in an app that would refuse the descriptor (decided 2026-09-02: Sparrow steps
 * were hard-coded under a sentence saying no other app opens it).
 */
function restoreSteps(kind?: string, descriptor?: string): string {
  const steps = ['In Talia: "Add a vault" → "Add an existing vault".'];
  for (const app of readerAppList(kind, descriptor)) {
    if (app === 'Sparrow') steps.push('In Sparrow: File → Import Wallet → Output descriptor.');
    else if (app === 'Liana') steps.push('In Liana: create a new wallet and choose to import a wallet descriptor.');
    else if (app === 'BlueWallet') steps.push('In BlueWallet: Add Wallet → Import wallet.');
    else if (app === 'Nunchuk') steps.push('In Nunchuk: import the descriptor as a new wallet.');
  }
  return steps.join(' ');
}

/** The same list as prose, e.g. "Sparrow, Nunchuk or your hardware wallet". */
export function readerApps(kind?: string, descriptor?: string, join = 'or'): string {
  const apps = readerAppList(kind, descriptor);
  return apps.length <= 1
    ? apps[0] ?? ''
    : `${apps.slice(0, -1).join(', ')} ${join} ${apps[apps.length - 1]}`;
}

/** Receive + change descriptor — the full watch-only recovery string. */
export function descriptorPayload(wallet: BackupWallet): string {
  return wallet.changeDescriptor
    ? `${wallet.descriptor}\n${wallet.changeDescriptor}`
    : wallet.descriptor;
}

/**
 * Which other wallets can open this vault — the honest answer, named per
 * shape (decided 2026-07-27, after a testnet single-sig silently failed to import
 * into BlueWallet).
 *
 * A ONE-KEY vault with no timelock is an ordinary BIP-84 native-segwit
 * wallet: BlueWallet and Sparrow both read it, and it shows up under normal
 * wallet discovery. Add any timelocked layer and it becomes a taproot
 * miniscript vault — Liana and Sparrow read those; BlueWallet cannot.
 *
 * The sharp edge worth naming: BlueWallet has NO testnet support at all (its
 * importer searches for the literal text "xpub"/"ypub"/"zpub", so a tpub is
 * invisible to it and the import fails with a generic "not a wallet").
 */
export function compatibilityNote(wallet: {
  kind?: string;
  network?: string;
  descriptor: string;
}): string {
  const layered = isLayered(wallet.descriptor);
  // "Standard multisig" only when there is no timelock: a timelocked wsh is a
  // Liana vault and must be described as one.
  const plainMultisig = !layered && wallet.descriptor.trim().startsWith('wsh(');
  const apps = readerApps(wallet.kind, wallet.descriptor, 'and');
  if (layered) return `This is a timelocked vault. ${apps} can open it.`;
  if (plainMultisig) return `This vault uses the standard multisig format. ${apps} can all open it.`;
  if (!apps) {
    return (
      'Talia rebuilds this vault from its descriptor. No other wallet app is ' +
      'known to open this exact shape yet, so keep the descriptor somewhere safe.'
    );
  }
  return `${apps} can both open this wallet.`;
}

/**
 * mailto bodies must use CRLF line breaks (RFC 6068): iOS Mail collapses lone
 * LF (`%0A`) so paragraphs run together — `%0D%0A` is honoured. Normalise right
 * before encodeURIComponent at every mailto call site.
 */
const crlf = (s: string): string => s.replace(/\r?\n/g, '\r\n');

const DIVIDER = '==========================================================';

function selfBackupBody(label: string, descriptor: string, kind?: string): string {
  return (
    `This is the backup of your Bitcoin vault “${label}”, held with ` +
    `21st Capital.\n\n` +
    `WHAT THIS IS\n` +
    `The vault's WATCH-ONLY descriptor. It contains no private keys and ` +
    `cannot move any funds. Talia uses it to watch the vault and to rebuild it ` +
    `for recovery.${readerApps(kind, descriptor) ? ` So can ${readerApps(kind, descriptor)}.` : ''}\n\n` +
    `YOUR VAULT DESCRIPTOR\n` +
    `Copy everything between the two lines. It is one long piece of text, ` +
    `even where your mail app wraps it:\n\n` +
    `${DIVIDER}\n${descriptor}\n${DIVIDER}\n\n` +
    `HOW TO RESTORE\n` +
    `1. Open Talia${readerApps(kind, descriptor) ? `, ${readerApps(kind, descriptor)}` : ''}.\n` +
    `2. ${restoreSteps(kind, descriptor)}\n` +
    `3. Paste the descriptor above.\n\n` +
    `Keep this email. Tip: searching your mailbox for "Bitcoin vault backup" ` +
    `will find it again years from now.\n\n` +
    `Sent from your own Talia app. 21st Capital never receives this email.\n`
  );
}

/** Open the user's mail app with a backup addressed to themselves (recipient
 *  pre-filled from the 21C account when we have a session). */
export async function emailDescriptorToSelf(wallet: BackupWallet): Promise<void> {
  let email = '';
  try {
    email = (await loadSession())?.email ?? '';
  } catch {
    // no session — leave the recipient blank, the user can fill it in
  }
  const subject = `My Bitcoin vault backup: ${wallet.label} (21st Capital)`;
  const body = selfBackupBody(wallet.label, descriptorPayload(wallet), wallet.kind);
  const url =
    `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(crlf(body))}`;
  await Linking.openURL(url);
}

/** System share sheet — WhatsApp, Telegram, AirDrop, Notes, Save to Files… */
export async function shareDescriptor(wallet: BackupWallet): Promise<void> {
  await shareText(descriptorPayload(wallet), `${wallet.label} vault descriptor`);
}

// ─── Encrypted backup file ───────────────────────────────────────────────────
//
// The file is the vault sealed by `wallet/encryptedBackup.ts`: only a holder
// of one of the vault's own keys can open it, and it is byte compatible with
// Liana's .bed backups, so a client recovers in either app. The share sheet
// is merely the carrier. (2026-09-02: the first cut of this attached Liana's
// PLAIN JSON backup instead, on the mistaken reading that Liana had no
// encrypted format at all. It reads .bed files, which this app has written
// since 2026-08-29.)

function safeFilename(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'vault';
}

/** The MIME type Info.plist declares for `.bed` (UTExportedTypeDeclarations).
 *  iOS types a shared file by its extension, and an extension nobody has
 *  declared gets a dynamic unknown type that Gmail's share extension refuses
 *  with "File can't be attached" (in a phone test, 2026-09-02). Declaring the type
 *  once, app-wide, is what makes the file attachable everywhere. */
const BED_MIME = 'application/x-bitcoin-encrypted-backup';

/** Activities that do not SEND anything: kept off the sheet when the point
 *  is an email to oneself, so the mail apps stand alone (Gmail, Outlook and
 *  the like appear as their own extensions and cannot be named here). */
const NON_SENDING_ACTIVITIES = [
  'com.apple.UIKit.activity.AirDrop',
  'com.apple.UIKit.activity.Message',
  'com.apple.UIKit.activity.CopyToPasteboard',
  'com.apple.UIKit.activity.Print',
  'com.apple.UIKit.activity.AssignToContact',
  'com.apple.UIKit.activity.SaveToCameraRoll',
  'com.apple.UIKit.activity.AddToReadingList',
  'com.apple.UIKit.activity.MarkupAsPDF',
  'com.apple.UIKit.activity.PostToFacebook',
  'com.apple.UIKit.activity.PostToTwitter',
  'com.apple.UIKit.activity.PostToWeibo',
  'com.apple.UIKit.activity.PostToTencentWeibo',
  'com.apple.UIKit.activity.PostToFlickr',
  'com.apple.UIKit.activity.PostToVimeo',
  'com.apple.UIKit.activity.OpenInIBooks',
  'com.apple.DocumentManagerUICore.SaveToFiles',
  'com.apple.mobilenotes.SharingExtension',
  'com.apple.reminders.RemindersEditorExtension',
];

/**
 * Hand the client their ENCRYPTED backup file through the share sheet.
 *
 * `forEmail` is the walk's and the export menu's "email a copy to myself":
 * the sheet is trimmed to apps that send, and the subject and restore
 * steps ride along (Mail honours them; extensions take the file). iOS offers
 * no other way to reach the user's OWN mail app with an attachment (seen
 * 2026-09-02: Apple's composer had opened instead of the default mail app;
 * a mailto: link cannot carry a file). Nothing here can pre-address the
 * mail; the chooser tells the client to send it to themselves.
 *
 * Resolves with whether the user FINISHED an activity. Only that counts as a
 * backup; dismissing the sheet does not.
 */
export async function shareEncryptedBackup(
  label: string,
  backup: Uint8Array,
  opts: { forEmail?: boolean } = {},
): Promise<ShareOutcome> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `talia-backup-${safeFilename(label)}-${stamp}.bed`;
  if (!opts.forEmail) {
    return shareBase64File(name, b64codec.encode(backup), BED_MIME);
  }
  // The bare .bed, with the subject and restore steps beside it (Mail and
  // most extensions put the message in the body). It was a zip for one
  // afternoon (2026-09-02): Gmail's share extension refused the .bed as an
  // unknown type, then crashed on the zip, then turned out to crash on ANY
  // zip from ANY app on the test phone. So the zip bought nothing and the .bed is
  // back: Liana and Talia open it directly. Info.plist still declares the
  // type (Files shows it; groundwork for "Open in Talia").
  const message =
    `Attached is the encrypted backup file for your Bitcoin vault “${label}”, ` +
    `held with 21st Capital. Send it to yourself and keep the email.\n\n` +
    `It holds the vault's WATCH-ONLY descriptor, encrypted to the vault's keys. ` +
    `21st Capital's keys cannot open it. It opens with a hardware wallet holding ` +
    `one of the other keys, or with that key's public account key, so anyone who ` +
    `knows one of those public keys can read it: keep it as private as the vault. ` +
    `It contains no private keys and cannot move any funds.\n\n` +
    `To restore in Talia: Vaults, then +, then "Add an existing vault", then ` +
    `"Open a file". Pick this file and unlock it with your hardware key, or ` +
    `paste its public account key.\n` +
    `To restore in Liana: create a new wallet, choose to import a backup, and ` +
    `open this file. Liana asks the hardware wallet holding one of the vault's ` +
    `keys to unlock it.\n\n` +
    `Searching your mailbox for "Bitcoin vault backup" will find this again ` +
    `years from now. Sent from your own Talia app. 21st Capital never receives ` +
    `this email.\n`;
  return shareBase64File(name, b64codec.encode(backup), BED_MIME, {
    subject: `My Bitcoin vault backup: ${label} (21st Capital)`,
    message,
    excludedActivityTypes: NON_SENDING_ACTIVITIES,
  });
}
