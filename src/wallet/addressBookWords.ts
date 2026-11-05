/**
 * Every word a client reads in the address book, in one place (decided
 * 2026-11-05). Send's address book card and name row, the Address book
 * page, the Add address page and the spent-coins check all read their words
 * here; a screen never types one of its own.
 *
 * The two categories are exactly "Private Address" and "Exchange Address".
 * The spent mark has ONE wording everywhere, as a tag or a line: "Has spent
 * coins before". Plain words: coins, never inputs or outputs. No em or en
 * dash anywhere (addressBookGuard.test.ts).
 */
import type { Network } from '../bitcoin/descriptor/types';
import { NETWORK_LABELS } from '../bitcoin/network';
import type { AddressCategory } from './addressBook';
import { MAX_NAME_LENGTH } from './vaultNames';

export const ADDRESS_BOOK_WORDS = {
  /** The category a client picks for a saved address; the check runs for this one alone. */
  privateAddress: 'Private Address',
  exchangeAddress: 'Exchange Address',

  /** The Address book page's title, and the last row of Send's card. */
  addressBook: 'Address book',
  /** The eyebrow over Send's card, under the Note to Self. */
  addressBookEyebrow: 'ADDRESS BOOK',
  /** The Add address page's title. */
  addAddress: 'Add address',
  /** Send's link under an address that is not saved, and the Add address page's footer button. */
  saveAddress: 'Save address',
  /** The name field on the Add address page, and the Rename dialog's field. */
  nameLabel: 'Name',
  /** The quiet line under a name field once the cap bites (the app's naming fields say the same). */
  nameAtLimit: `Up to ${MAX_NAME_LENGTH} characters`,

  /** The spent mark: a tag on Send's rows, a gold line on the book's cards. */
  hasSpentCoins: 'Has spent coins before',
  /** The gold notice under VERIFY ADDRESS. */
  spentNotice: 'This address has spent coins before. Ask for a new one.',
  /** The notice's reason, behind its tap (the info pattern): title, then text. */
  spentReasonTitle: 'Has spent coins before',
  spentReason:
    'Paying an address that has already spent coins links your payment to everything it did before. Ask the receiver for a new address.',
  /** The quiet line while the server is asked. */
  checking: 'Checking this address…',
  /** The quiet line when the server could not be asked, with its Try again. */
  couldNotCheck: 'Could not check this address',
  tryAgain: 'Try again',

  /** The Address book page with nothing saved at all (with entries for another network only: `emptyForNetwork`). */
  empty: 'No saved addresses yet',
  /** The title-only dialog at Save for an address already in the book. */
  alreadySaved: 'This address is already saved',
  /** The quiet line on the Address book page when the book on this phone cannot be read (nothing is listed). */
  unreadable: 'The address book could not be read',
  /** The title-only dialog when a save, an edit or a removal could not be written. */
  notSaved: 'The address book could not be saved',
  ok: 'OK',
  cancel: 'Cancel',
  /** Edit address's own confirm. */
  save: 'Save',

  /** The two actions a card shows when swiped to the left (decided 2026-11-05): their spoken names. */
  edit: 'Edit',
  remove: 'Remove',
  /** The title of a saved address's own page, opened from Edit. */
  editAddress: 'Edit address',
} as const;

/** The name of a category, as its section header and its tag read it. */
export function categoryName(category: AddressCategory): string {
  return category === 'private' ? ADDRESS_BOOK_WORDS.privateAddress : ADDRESS_BOOK_WORDS.exchangeAddress;
}


/**
 * The Address book page opened from a vault whose network none of the saved
 * addresses is for: "No saved addresses for Testnet4 yet". Plain "No saved
 * addresses yet" would be untrue there.
 */
export function emptyForNetwork(network: Network): string {
  return `No saved addresses for ${NETWORK_LABELS[network]} yet`;
}

/** The confirm dialog's title before an entry is removed: "Remove <name>?". */
export function removeTitle(name: string): string {
  return `Remove ${name}?`;
}
