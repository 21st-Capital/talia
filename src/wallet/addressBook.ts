/**
 * The address book: addresses a client saved to pay again (decided
 * 2026-11-05). Opened from Send, it lists each address under one of two
 * categories, "Private Address" and "Exchange Address"; a saved Private
 * Address is checked for spent coins (./addressBookLookup.ts), an Exchange
 * Address never is, because an exchange reuses its deposit addresses by
 * design and a warning there would only teach the client to ignore it.
 *
 * Storage: one sealed value, `ADDRESS_BOOK_KEY`, through ./sealedStore.ts
 * (sealed at rest under the Keychain key, this device only). The book is
 * per phone: never synced, never in a vault's backup or export, and the
 * folder AsyncStorage keeps it in is out of phone backups. Every change
 * reads the whole list and writes it back, one change at a time
 * (services/storeTurns.ts). A read that cannot be made THROWS, so it is
 * never taken for an empty book that a save would write over: a Keychain
 * that cannot answer, or a key that did not seal the data (the sealed
 * store's own errors), and stored text that opens but is not a book
 * (`AddressBookUnreadableError`). One case reads as empty, as it does for
 * every sealed record: a value the right key cannot open is damaged, so the
 * sealed store keeps its bytes as `talia.addressBook.v1.unreadable`
 * (numbered, never deleted, never written over) and the book starts again
 * beside that copy. Reads need no turn.
 *
 * Entries: one per address. The address is kept bare and normalised
 * (`normaliseBookAddress`: no `bitcoin:` link, no amount, a bech32 address
 * in lower case), the name at most `MAX_NAME_LENGTH`. An entry's network is
 * its address's own (`addressFamily`); Send and the book opened from Send
 * list only entries whose address fits the sending vault's network
 * (`entriesForNetwork`), and nothing is ever re-encoded for another one.
 *
 * Screens read an entry's category through `categoryOf`, `isPrivateAddress`
 * and the words helpers, never as a field: src/ui may not read `.category`
 * (wallet/__tests__/categories.test.ts keeps a vault's section in one
 * place), and a book section names its category `group` for the same
 * reason.
 */
import { addressFamily, addressFitsNetwork } from '../bitcoin/addressNetwork';
import type { Network } from '../bitcoin/descriptor/types';
import { parseScannedAddress } from '../bitcoin/scanParse';
import { storeTurns } from '../services/storeTurns';
import { categoryName } from './addressBookWords';
import { sealedGetItem, sealedSetItem } from './sealedStore';
import { fitName, MAX_NAME_LENGTH } from './vaultNames';

/** The sealed value that holds the book. */
export const ADDRESS_BOOK_KEY = 'talia.addressBook.v1';

/** 'private': checked for spent coins. 'exchange': never looked up. */
export type AddressCategory = 'private' | 'exchange';

/** In the order the book's sections are drawn. */
export const ADDRESS_CATEGORIES: readonly AddressCategory[] = ['private', 'exchange'];

/** The most saved addresses Send's card lists. */
export const SEND_LIST_LIMIT = 5;

export { MAX_NAME_LENGTH };

export interface AddressBookEntry {
  id: string;
  /** Bare and normalised (`normaliseBookAddress`); one entry per address. */
  address: string;
  /** At most `MAX_NAME_LENGTH` characters, trimmed, never empty. */
  name: string;
  category: AddressCategory;
  /** ms since 1970. */
  createdAt: number;
  /** When it was last put on Send from the book (ms), if ever. */
  lastUsedAt?: number;
  /** When the check first found it had spent coins (ms). Kept: it is never asked about again. */
  spentSeenAt?: number;
}

/** The stored book could not be read: nothing may be written over it. */
export class AddressBookUnreadableError extends Error {
  constructor() {
    super('The address book on this phone could not be read.');
    this.name = 'AddressBookUnreadableError';
  }
}

// ─── pure ────────────────────────────────────────────────────────────────────

/**
 * The address as the book keeps it, or null when `raw` holds no Bitcoin
 * address: spaces and line breaks taken out, a `bitcoin:` link read down to
 * its address (its amount and the rest dropped), a bech32 address in lower
 * case (a mixed-case one is refused), and the whole address decoded. The
 * same reading Send gives a paste (bitcoin/scanParse.ts), so an address on
 * Send and its saved entry always compare equal.
 */
export function normaliseBookAddress(raw: string): string | null {
  const read = parseScannedAddress(raw.replace(/\s+/g, ''));
  if (!read || addressFamily(read.address) == null) return null;
  return read.address;
}

/** The entry saved for this address (any spelling of it), if any. */
export function findBookEntry(list: readonly AddressBookEntry[], address: string): AddressBookEntry | undefined {
  const wanted = normaliseBookAddress(address);
  return wanted == null ? undefined : list.find((e) => e.address === wanted);
}

/** The entries a vault on `network` can pay (its address's own network). */
export function entriesForNetwork(list: readonly AddressBookEntry[], network: Network): AddressBookEntry[] {
  return list.filter((e) => addressFitsNetwork(e.address, network));
}

/** Most recently used first, then the newest; the book's order everywhere. */
export function byRecentUse(a: AddressBookEntry, b: AddressBookEntry): number {
  const used = (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1);
  if (used !== 0) return used;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Send's card: at most `limit` entries the vault on `network` can pay, most recently used first, then the newest. */
export function sendListFor(
  list: readonly AddressBookEntry[],
  network: Network,
  limit: number = SEND_LIST_LIMIT,
): AddressBookEntry[] {
  return entriesForNetwork(list, network).sort(byRecentUse).slice(0, Math.max(0, limit));
}

/**
 * The address as a card on the Address book page shows it (decided
 * 2026-11-05, the look picked for that page): its first 10 and last 8
 * characters around an ellipsis, so the start and the end a client compares
 * are always whole; an address that short is shown whole.
 */
export function shortBookAddress(address: string): string {
  return address.length > 19 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

/** An entry's category (screens read it here, never as a field). */
export function categoryOf(entry: Pick<AddressBookEntry, 'category'>): AddressCategory {
  return entry.category;
}

/** Is this a Private Address, the category that is checked for spent coins? */
export function isPrivateAddress(entry: Pick<AddressBookEntry, 'category'>): boolean {
  return entry.category === 'private';
}

/** The category the long press dialog moves an entry to. */
export function otherCategory(category: AddressCategory): AddressCategory {
  return category === 'private' ? 'exchange' : 'private';
}

/** One section of the Address book page. */
export interface BookSection {
  /** Which category the section holds (not `category`: see the note at the top). */
  group: AddressCategory;
  /** "Private Address" or "Exchange Address". */
  title: string;
  entries: AddressBookEntry[];
}

/**
 * The Address book page's sections: Private Address, then Exchange Address,
 * each in the book's order, and a section with no entries left out. Pass a
 * `network` when the page was opened from Send: only entries that vault can
 * pay are listed.
 */
export function bookSections(list: readonly AddressBookEntry[], network?: Network): BookSection[] {
  const shown = network ? entriesForNetwork(list, network) : [...list];
  return ADDRESS_CATEGORIES.map((category) => ({
    group: category,
    title: categoryName(category),
    entries: shown.filter((e) => e.category === category).sort(byRecentUse),
  })).filter((s) => s.entries.length > 0);
}

/** Does this entry carry the spent mark ("Has spent coins before")? A Private Address found spent; an Exchange Address never. */
export function showsSpentMark(entry: Pick<AddressBookEntry, 'category' | 'spentSeenAt'>): boolean {
  return entry.category === 'private' && entry.spentSeenAt != null;
}

const isCategory = (v: unknown): v is AddressCategory => v === 'private' || v === 'exchange';
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isEntry(v: unknown): v is AddressBookEntry {
  const o = v as Partial<AddressBookEntry> | null;
  return (
    !!o &&
    typeof o === 'object' &&
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.address === 'string' &&
    normaliseBookAddress(o.address) === o.address &&
    typeof o.name === 'string' &&
    o.name.trim().length > 0 &&
    isCategory(o.category) &&
    isTime(o.createdAt) &&
    (o.lastUsedAt === undefined || isTime(o.lastUsedAt)) &&
    (o.spentSeenAt === undefined || isTime(o.spentSeenAt))
  );
}

/** The stored text as entries; THROWS on anything else, so nothing writes over it. */
export function parseAddressBook(raw: string | null): AddressBookEntry[] {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AddressBookUnreadableError();
  }
  if (!Array.isArray(parsed) || !parsed.every(isEntry)) throw new AddressBookUnreadableError();
  return parsed;
}

function newEntryId(): string {
  return `ab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The name as stored, or null when nothing is left of it. */
function storedName(name: string): string | null {
  const fitted = fitName(name);
  return fitted.length > 0 ? fitted : null;
}

// ─── the store ───────────────────────────────────────────────────────────────

const inTurn = storeTurns();
const listeners = new Set<(entries: AddressBookEntry[]) => void>();

async function readBook(): Promise<AddressBookEntry[]> {
  return parseAddressBook(await sealedGetItem(ADDRESS_BOOK_KEY));
}

async function writeBook(list: AddressBookEntry[]): Promise<void> {
  await sealedSetItem(ADDRESS_BOOK_KEY, JSON.stringify(list));
  const copy = list.map((e) => ({ ...e }));
  for (const l of listeners) {
    try {
      l(copy);
    } catch {
      // a listener never breaks a save
    }
  }
}

/**
 * One change in its turn: read the whole book, `edit` it, and write it back
 * only when `edit` returns a new list. Throws when the book cannot be read
 * or written.
 */
function change<T>(edit: (list: AddressBookEntry[]) => { list?: AddressBookEntry[]; result: T }): Promise<T> {
  return inTurn(async () => {
    const { list, result } = edit(await readBook());
    if (list) await writeBook(list);
    return result;
  });
}

/** Every saved entry, in the stored order. THROWS when the book cannot be read: never show that as an empty book. */
export function loadAddressBook(): Promise<AddressBookEntry[]> {
  return readBook();
}

/** Told the whole book after every change that was written. Returns the way to stop listening. */
export function onAddressBookChange(listener: (entries: AddressBookEntry[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface NewBookEntry {
  /** An address, or a `bitcoin:` link holding one (its amount is dropped). */
  address: string;
  name: string;
  category: AddressCategory;
  /** When a check on the Add address page already found it spent. */
  spentSeenAt?: number;
}

/** What Save did: the new entry, or the one already saved for that address (nothing written). */
export type SaveAddressResult =
  | { kind: 'saved'; entry: AddressBookEntry }
  | { kind: 'alreadySaved'; entry: AddressBookEntry };

/**
 * Save an address. One entry per address: an address already in the book
 * (in any spelling) is refused as 'alreadySaved' and nothing changes, so
 * the page shows "This address is already saved". THROWS for text that
 * holds no Bitcoin address, a name with nothing in it, an unknown category,
 * or a book that cannot be read or written. The name is trimmed and cut to
 * `MAX_NAME_LENGTH`.
 */
export function saveAddress(input: NewBookEntry, now: number = Date.now()): Promise<SaveAddressResult> {
  const address = normaliseBookAddress(input.address);
  if (address == null) return Promise.reject(new Error('This is not a Bitcoin address.'));
  const name = storedName(input.name);
  if (name == null) return Promise.reject(new Error('An address needs a name.'));
  if (!isCategory(input.category)) return Promise.reject(new Error('Unknown address category.'));
  return change<SaveAddressResult>((list) => {
    const known = list.find((e) => e.address === address);
    if (known) return { result: { kind: 'alreadySaved', entry: known } };
    const entry: AddressBookEntry = { id: newEntryId(), address, name, category: input.category, createdAt: now };
    if (input.spentSeenAt != null && isTime(input.spentSeenAt)) entry.spentSeenAt = input.spentSeenAt;
    return { list: [entry, ...list], result: { kind: 'saved', entry } };
  });
}

/** Apply `patch` to the entry `id`; the changed entry, or null when there is none (nothing written then). */
function patchEntry(
  id: string,
  patch: (e: AddressBookEntry) => AddressBookEntry | null,
): Promise<AddressBookEntry | null> {
  return change<AddressBookEntry | null>((list) => {
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return { result: null };
    const next = patch(list[i]);
    if (next == null) return { result: list[i] };
    const copy = [...list];
    copy[i] = next;
    return { list: copy, result: next };
  });
}

/**
 * Edit an entry's name and category in one write (decided 2026-11-05: Edit
 * on a swiped card opens the entry's own page). The name is trimmed and cut
 * to `MAX_NAME_LENGTH`; what the check found before stays with the entry
 * whichever category it moves to; the address itself never changes (a
 * different address is a new entry). THROWS for an empty name or an unknown
 * category. Null when the entry is gone.
 */
export function updateEntry(
  id: string,
  edit: { name: string; category: AddressCategory },
): Promise<AddressBookEntry | null> {
  const fitted = storedName(edit.name);
  if (fitted == null) return Promise.reject(new Error('An address needs a name.'));
  if (!isCategory(edit.category)) return Promise.reject(new Error('Unknown address category.'));
  const category = edit.category;
  return patchEntry(id, (e) => (e.name === fitted && e.category === category ? null : { ...e, name: fitted, category }));
}

/** Remove an entry. True when it was there. */
export function removeEntry(id: string): Promise<boolean> {
  return change<boolean>((list) => {
    const rest = list.filter((e) => e.id !== id);
    return rest.length === list.length ? { result: false } : { list: rest, result: true };
  });
}

/**
 * A saved address was put on Send (a row on Send's card or a card on the
 * Address book page): it moves to the top of Send's card. The entry, or
 * null when the address is not saved (nothing written then).
 */
export function markEntryUsed(address: string, now: number = Date.now()): Promise<AddressBookEntry | null> {
  const wanted = normaliseBookAddress(address);
  if (wanted == null) return Promise.resolve(null);
  return change<AddressBookEntry | null>((list) => {
    const i = list.findIndex((e) => e.address === wanted);
    if (i < 0) return { result: null };
    const copy = [...list];
    copy[i] = { ...list[i], lastUsedAt: now };
    return { list: copy, result: copy[i] };
  });
}

/**
 * The check found that this address has spent coins: remembered as
 * `spentSeenAt`, the first time only, and it is never asked about again.
 * The entry, or null when the address is not saved (nothing written then).
 * "Nothing found" is never stored.
 */
export function markAddressSpent(address: string, at: number = Date.now()): Promise<AddressBookEntry | null> {
  const wanted = normaliseBookAddress(address);
  if (wanted == null) return Promise.resolve(null);
  return change<AddressBookEntry | null>((list) => {
    const i = list.findIndex((e) => e.address === wanted);
    if (i < 0) return { result: null };
    if (list[i].spentSeenAt != null) return { result: list[i] };
    const copy = [...list];
    copy[i] = { ...list[i], spentSeenAt: at };
    return { list: copy, result: copy[i] };
  });
}

/** Tests only: forget every listener. */
export function __resetAddressBookForTests(): void {
  listeners.clear();
}
