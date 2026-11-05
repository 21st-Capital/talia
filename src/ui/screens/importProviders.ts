/**
 * Where an existing vault comes from, and how to get it out of there.
 *
 * Decided 2026-09-08: "right now a lot of things can go wrong during the import
 * and its hard for users to know what works and what doesnt." So the import
 * asks first: single-sig or multisig, then which product holds it. Each
 * product gets its own exact steps and only the ways in it actually has.
 * The multisig side got the same wizard (decided 2026-09-09), "more
 * scalable as we add more import formats", with a short how-to per product.
 *
 * A product's answer differs by vault shape, so the steps and the ways in
 * are per shape, not per product: Sparrow shows a multisig descriptor the
 * same way it shows a single-key one, Liana only ever holds the shared
 * kind and has no QR at all, and a hardware wallet can hand over its own
 * key but never a whole shared vault, which lives in the coordinator that
 * built it.
 *
 * Two facts this catalogue also encodes:
 *  - A vault imported FROM a hardware wallet is already connected: the
 *    device proved the key, so Send is ready and nobody is asked to connect
 *    it again. A vault from a wallet app is asked which device signs for
 *    it afterwards (decided 2026-09-08).
 *  - BlueWallet and Electrum hand over a bare account key (zpub). Talia
 *    treats it as native segwit; the key carries no fingerprint, which the
 *    connect step fills in later.
 *
 * Order is the order on screen, and Talia comes first everywhere (decided
 * 2026-09-09), then Liana, Sparrow, and the catch-all last.
 *
 * Pure data, tested; the screen renders it.
 */

import { modelsFor } from '../../wallet/deviceKinds';
import type { DeviceModel } from '../../wallet/deviceKinds';

export type ImportVaultKind = 'single' | 'multi';

export type ImportProvider =
  | 'ledger'
  | 'bitbox'
  | 'passport'
  | 'talia'
  | 'liana'
  | 'sparrow'
  | 'bluewallet'
  | 'electrum'
  | 'other';

/** A way the vault can arrive, in the order offered. */
export type ImportMethod = 'ble' | 'qr' | 'file' | 'paste';

/** What one product offers for ONE vault shape. */
export interface ImportVariant {
  /** Exact steps in that product, for this vault shape. A device reached
   *  over Bluetooth has none: its turns are DRAWN by the search (decided
   *  2026-10-04), so a line here would say the same thing twice. */
  steps: string[];
  methods: ImportMethod[];
  /** The scanner's one-line hint. */
  qrHint?: string;
  /** Label and placeholder of the paste field. */
  pasteLabel?: string;
  placeholder?: string;
  /** The product exports a bare account key rather than a descriptor. */
  bareKey?: boolean;
}

export interface ImportProviderInfo {
  id: ImportProvider;
  name: string;
  /** One line under the name, on the product page. */
  tagline: string;
  family: 'hardware' | 'software';
  /** Only the shapes this product can actually hand over. */
  variants: Partial<Record<ImportVaultKind, ImportVariant>>;
}

/** The paste field for anything that carries every key of a shared vault. */
const MULTI_PASTE = {
  pasteLabel: 'Vault descriptor',
  placeholder: 'wsh(…) or tr(…)',
} as const;

export const IMPORT_PROVIDERS: ImportProviderInfo[] = [
  {
    id: 'ledger',
    name: 'Ledger',
    tagline: 'Over Bluetooth',
    family: 'hardware',
    // A device holds a KEY, never the shared vault it belongs to: that
    // lives in the software that built it, so there is no multi variant.
    variants: {
      single: {
        steps: [],
        methods: ['ble'],
      },
    },
  },
  {
    id: 'bitbox',
    name: 'BitBox',
    tagline: 'Over Bluetooth',
    family: 'hardware',
    variants: {
      single: {
        steps: [],
        methods: ['ble'],
      },
    },
  },
  {
    id: 'passport',
    name: 'Passport',
    tagline: 'Foundation, by QR code',
    family: 'hardware',
    variants: {
      single: {
        steps: [
          'On the Passport, open Manage Account, then Connect Wallet, and choose Sparrow.',
          'Choose Single-sig, then QR Code. The Passport shows a moving code.',
          'Scan it here and hold the phone to the Passport until every frame is read.',
        ],
        methods: ['qr'],
        qrHint: 'On the Passport: Manage Account, Connect Wallet, Sparrow, Single-sig, QR Code',
      },
    },
  },
  {
    id: 'talia',
    name: 'Talia',
    tagline: 'From another phone',
    family: 'software',
    variants: {
      single: {
        steps: [
          'On the other phone, open the vault, tap the three dots, then Export, then Export to Talia.',
          'Scan the code it shows, or paste the text it shared.',
        ],
        // No file (decided 2026-09-21): Export to Talia gives a code and text,
        // never a file. A saved backup file opens under Liana or Other.
        methods: ['qr', 'paste'],
        qrHint: 'On the other phone: the vault, three dots, Export, Export to Talia',
        pasteLabel: 'Talia export',
        placeholder: 'The text the other phone shared',
      },
      multi: {
        steps: [
          'On the other phone, open the vault, tap the three dots, then Export, then Export to Talia.',
          'Scan the code it shows, or paste the text it shared.',
        ],
        // No file (decided 2026-09-21): Export to Talia gives a code and text,
        // never a file. A saved backup file opens under Liana or Other.
        methods: ['qr', 'paste'],
        qrHint: 'On the other phone: the vault, three dots, Export, Export to Talia',
        pasteLabel: 'Talia export',
        placeholder: 'The text the other phone shared',
      },
    },
  },
  {
    id: 'liana',
    name: 'Liana',
    tagline: 'Desktop wallet',
    family: 'software',
    // Every Liana wallet carries a recovery path behind a timelock, so it
    // is always the shared kind in Talia's terms, and Liana shows no QR
    // code anywhere: the descriptor is copied or exported as a file. The
    // wallet backup file comes first, because it carries the names and
    // labels as well (decided 2026-11-05).
    variants: {
      multi: {
        steps: [
          'In Liana, open Settings, then the wallet section.',
          'Export the wallet backup file, which brings its names and labels too, or copy the wallet descriptor.',
          'Paste it here, or open the file. Liana has no QR code to scan.',
        ],
        methods: ['paste', 'file'],
        pasteLabel: 'Wallet descriptor',
        placeholder: 'wsh(or_d(…)) or tr(…)',
      },
    },
  },
  {
    id: 'sparrow',
    name: 'Sparrow',
    tagline: 'Desktop wallet',
    family: 'software',
    variants: {
      single: {
        // The path walked on Sparrow 2.5 in a test (2026-09-09): the Export dialog
        // lists the targets, and Output Descriptor's camera icon shows the
        // code. The Settings page's own QR button is not the one used.
        steps: [
          'In Sparrow, open the wallet and go to Settings.',
          'Click Export at the bottom, then find Output Descriptor in the list.',
          'Click the camera icon beside it for a code to scan, or Export File to save it.',
          'To bring your key names along, use Export File beside Electrum instead. That file has no code to scan.',
        ],
        methods: ['qr', 'paste', 'file'],
        qrHint: 'Sparrow: Settings, Export, the camera icon beside Output Descriptor',
        pasteLabel: 'Output descriptor',
        placeholder: "wpkh([fingerprint/84'/0'/0']xpub…/<0;1>/*)",
      },
      multi: {
        steps: [
          'In Sparrow, open the multisig wallet and go to Settings.',
          'Click Export at the bottom, then find Output Descriptor in the list.',
          'Click the camera icon beside it for a code to scan, or Export File to save it. It carries every cosigner key, which is what Talia needs.',
          'To bring your key names along, use Export File beside Electrum instead. That file has no code to scan.',
        ],
        methods: ['qr', 'paste', 'file'],
        qrHint: 'Sparrow: Settings, Export, the camera icon beside Output Descriptor',
        ...MULTI_PASTE,
      },
    },
  },
  {
    id: 'bluewallet',
    name: 'BlueWallet',
    tagline: 'Phone wallet',
    family: 'software',
    variants: {
      single: {
        steps: [
          'In BlueWallet, open the wallet and tap the three dots at the top right.',
          'Tap Show wallet XPUB. Never use Export or Backup: that screen shows your seed words.',
          'Scan the code here, or copy the key and paste it.',
        ],
        methods: ['qr', 'paste'],
        qrHint: 'BlueWallet: the wallet, three dots, Show wallet XPUB',
        pasteLabel: 'Wallet key',
        placeholder: 'zpub… or xpub…',
        bareKey: true,
      },
    },
  },
  {
    id: 'electrum',
    name: 'Electrum',
    tagline: 'Desktop wallet',
    family: 'software',
    variants: {
      single: {
        steps: [
          'In Electrum, open the Wallet menu and choose Information.',
          'Beside Master Public Key, click the QR button, or copy the key.',
          'Scan the code here, or paste the key.',
        ],
        methods: ['qr', 'paste'],
        qrHint: 'Electrum: Wallet, Information, the QR beside Master Public Key',
        pasteLabel: 'Master public key',
        placeholder: 'zpub… or xpub…',
        bareKey: true,
      },
    },
  },
  {
    id: 'other',
    name: 'Other',
    tagline: 'Nunchuk, Bitcoin Core, Keystone',
    family: 'software',
    // The catch-all, so a coordinator Talia has no page for is never a
    // dead end (decided 2026-09-09: the wizard has to scale as formats are
    // added). Every one of them can produce a descriptor.
    variants: {
      multi: {
        steps: [
          'Open the vault in the software that built it.',
          'Find its output descriptor, sometimes called the wallet policy or the wallet configuration.',
          'Scan it here, paste it, or open the file it exported.',
        ],
        methods: ['qr', 'paste', 'file'],
        qrHint: 'Scan the vault descriptor',
        ...MULTI_PASTE,
      },
    },
  },
];

export function importProvider(id: ImportProvider): ImportProviderInfo {
  const found = IMPORT_PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown import provider: ${id}`);
  return found;
}

/** What this product offers for this vault shape, or null when it has none. */
export function providerVariant(
  provider: ImportProviderInfo,
  kind: ImportVaultKind,
): ImportVariant | null {
  return provider.variants[kind] ?? null;
}

/**
 * The products offered for a vault shape, split into the two groups the
 * screen shows: the hardware as the registry's MODELS (decided 2026-10-04, device
 * first: the list offers Nano Gen5, Flex, Stax, Nano X, BitBox02 Nova and
 * Passport, and a device added to the registry appears here at once), and
 * the software catalogued above. Bluetooth devices need the hardware surface
 * (the App Store build has no Bluetooth pairing); the Passport is a QR scan
 * and works everywhere. A shared vault has no hardware group at all: a device
 * holds a key, not the vault.
 */
export function providersFor(
  kind: ImportVaultKind,
  hardwareSurface: boolean,
): { hardware: DeviceModel[]; software: ImportProviderInfo[] } {
  const offers = (p: ImportProviderInfo) => providerVariant(p, kind) != null;
  const hardware = kind === 'single' ? modelsFor('single', 'key', { hardwareSurface }) : [];
  const software = IMPORT_PROVIDERS.filter((p) => p.family === 'software' && offers(p));
  return { hardware, software };
}

/**
 * Why a validated descriptor does not fit the kind the user chose, or null
 * when it does. A multisig vault is one with several keys; a single-sig
 * vault has exactly one. Said with the way back, never as a dead end.
 *
 * The words are the vault creation screen's, "Single-sig" and "Multisig"
 * (decided 2026-09-08: "why not single-sig and multisig?"), so one product uses
 * one name for one thing.
 */
export function importKindMismatch(expected: ImportVaultKind | undefined, keyCount: number): string | null {
  if (!expected) return null;
  if (expected === 'multi' && keyCount < 2) {
    return 'This is a single key, not a multisig vault. Export the full vault descriptor with every key, or go back and choose Single-sig.';
  }
  if (expected === 'single' && keyCount !== 1) {
    return 'This vault has several keys. Go back and choose Multisig.';
  }
  return null;
}
