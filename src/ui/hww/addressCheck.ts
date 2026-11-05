/**
 * The address check as the devices show it (decided 2026-10-04: "The Address
 * verification screens are still missing ... show the address on a separate
 * page for the user to compare using the animated HWW address verification
 * screens"; three videos of ONE receive address of a 2-of-3 testnet
 * vault "Test 2/3 Oct" checked on a Nano Gen5, a Nano X and a BitBox02
 * Nova). Pure: the facts the pages are made from, the pages per device family
 * in the firmware's own words, and the device's word after the confirmation.
 * Drawn by `deviceTurns.ts` as the client's turn, round and round, on the
 * address check's own screen (`VerifyAddressScreen`).
 *
 *   touchscreen Ledgers   "Verify bitcoin address" / "Swipe to continue"
 *                         (the disc, "Cancel", "1 of 2", ">"); then "Address"
 *                         over the address wrapping over its lines, "Account
 *                         name" over the name, a QR button beside the dark
 *                         "Confirm" ("Cancel", "<", "2 of 2"); then the
 *                         outlined tick over "Address verified"; then the
 *                         app's home
 *   Nano X                "Verify bitcoin address" under the glyph with the
 *                         right arrow alone; "Address (1/2)" and "(2/2)" over
 *                         pages of three lines broken where the device's own
 *                         font breaks them (`nanoFont.ts`: the filmed 62-character
 *                         address over two pages); "Account name" over the
 *                         name; the tick over "Confirm"; then "Address
 *                         verified" alone; then "Bitcoin Testnet" over "app
 *                         is ready"
 *   BitBox02 Nova         every page headed "Receive to" with × and ">":
 *                         "2-of-3 / BTC Testnet multisig", the name, then
 *                         the address in groups of four as one scrolling line
 *                         with a tick in place of the ">" (the top right edge
 *                         confirms); then the "BitBox02 Nova" splash
 *
 * CONFIRMED by the videos: a registered classic 2-of-3 on all three. NOT
 * filmed, drawn from the firmwares as remembered and reported as unconfirmed
 * (`unconfirmedAddress`): a vault with no name on the device (a one-key
 * vault: no "Account name" page), and a policy vault on the BitBox ("BTC
 * policy with N keys", as the signing review's first page).
 */
import type { Network } from '../../bitcoin/descriptor/types';
import type { DeviceKind } from '../../wallet/deviceKinds';
import { bitboxCoin, bitboxVaultKind, isTouchscreen, novaAddressGroups } from './signingDevice';
import type { BitboxVaultKind, DeviceDrawing, ReviewPage } from './signingDevice';
import type { SigningBrand } from './signingCeremony';
import { nanoPages } from './nanoFont';
import { NANO_KEY_LINES } from './vaultRegistration';

/** What every address page is made from. */
export interface AddressFacts {
  network: Network;
  /** The address Receive shows, which the device must show too. */
  address: string;
  /** The account name the device prints: the name the vault was registered
   *  under on THIS device (a Ledger's registration, the name a BitBox stored);
   *  null for a one-key vault, which the device shows as a plain account, and
   *  for a vault registered elsewhere, whose name Talia never saw. */
  name: string | null;
  /** The BitBox's first page (null on a Ledger). */
  bitboxKind: BitboxVaultKind | null;
}

/**
 * The verdict the check hands back to Receive, pinned to the address it
 * judged: Receive shows it for THAT address only, and a new address clears it.
 */
export interface AddressVerdict {
  kind: 'match' | 'mismatch';
  address: string;
  device: DeviceKind;
}

/** The facts for a vault, the address on show and the device in hand. */
export function addressFacts(
  vault: { descriptor: string; label: string; network: Network },
  address: string,
  name: string | null,
  brand: SigningBrand,
): AddressFacts {
  return {
    network: vault.network,
    address,
    name,
    bitboxKind: brand === 'bitbox' ? bitboxVaultKind(vault.descriptor, vault.label) : null,
  };
}

/** Whether the pages for these facts go beyond what the videos showed. */
export function unconfirmedAddress(f: AddressFacts): boolean {
  return f.name == null || f.bitboxKind?.kind === 'policy';
}

// ─── The words ───────────────────────────────────────────────────────────────

/** The Nova's title on every page of the check (the video). */
export const NOVA_RECEIVE_TITLE = 'Receive to';

/** The Nova prints the whole address in groups of four, as one line it
 *  scrolls along its bottom edge (the video: its first 17 characters at
 *  the edge, the thumb under it): the same line the signing review prints under
 *  an amount, so it lives with the review's pages (`signingDevice.ts`). */
export { novaAddressGroups };

/** The Nano X shows the address over pages of three lines broken where its
 *  own font breaks them (`nanoFont.ts`): a 62-character test address over 59
 *  and 3 (the device's "Address (1/2)" and "(2/2)"), a 42-character one on a
 *  single page. Never a fixed count of characters. */
export function nanoAddressPages(address: string): string[] {
  const pages = nanoPages(address, NANO_KEY_LINES);
  return pages.length > 0 ? pages : [''];
}

/** The Nano X's title over an address page: the page count only past one
 *  page, as the device numbers them. */
export function nanoAddressTitle(page: number, pages: number): string {
  return pages > 1 ? `Address (${page}/${pages})` : 'Address';
}

/** The device's own word once the address is confirmed: every Ledger's; the
 *  BitBox shows none (its splash follows). */
export function verifiedWords(d: DeviceDrawing): string | null {
  return d === 'nova' ? null : 'Address verified';
}

// ─── The pages ───────────────────────────────────────────────────────────────

/** The pages a device walks the client through, in its own words and order. */
export function addressPages(d: DeviceDrawing, f: AddressFacts): ReviewPage[] {
  if (isTouchscreen(d)) {
    return [{ kind: 'touch-address-intro' }, { kind: 'touch-address', address: f.address, name: f.name }];
  }
  if (d === 'nanoX') {
    const chunks = nanoAddressPages(f.address);
    return [
      { kind: 'nano-address-intro' },
      ...chunks.map((value, i): ReviewPage => ({ kind: 'nano-item', title: nanoAddressTitle(i + 1, chunks.length), value, long: true })),
      ...(f.name != null ? [{ kind: 'nano-item', title: 'Account name', value: f.name } as const] : []),
      { kind: 'nano-address-confirm' },
    ];
  }
  if (d === 'nova') {
    const coin = bitboxCoin(f.network);
    const k = f.bitboxKind;
    // The kind's page as the signing review's first page reads, under this
    // check's title; a policy vault's words are unconfirmed (never filmed).
    const head: ReviewPage[] =
      k?.kind === 'multisig'
        ? [{ kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: `${k.threshold}-of-${k.keys}\n${coin} multisig` }]
        : k?.kind === 'policy'
          ? [{ kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: `${coin}\npolicy with\n${k.keys} key${k.keys === 1 ? '' : 's'}` }]
          : [];
    return [
      ...head,
      ...(f.name != null ? [{ kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: f.name } as const] : []),
      { kind: 'nova-address', title: NOVA_RECEIVE_TITLE, body: novaAddressGroups(f.address) },
    ];
  }
  return [{ kind: 'slab-address' }];
}
