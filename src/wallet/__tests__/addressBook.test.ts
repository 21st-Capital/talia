/**
 * The address book's store (decided 2026-11-05): sealed at rest, one entry
 * per address kept bare and normalised, a read that cannot be made or
 * parsed THROWS (never an empty book a save could write over; damaged bytes
 * are kept aside by the sealed store), one change at a time, and the
 * entries a vault can pay chosen by the address's own
 * network. The two categories are exactly "Private Address" and
 * "Exchange Address".
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

import {
  ADDRESS_BOOK_KEY,
  AddressBookUnreadableError,
  bookSections,
  categoryOf,
  isPrivateAddress,
  otherCategory,
  entriesForNetwork,
  findBookEntry,
  loadAddressBook,
  markAddressSpent,
  markEntryUsed,
  MAX_NAME_LENGTH,
  normaliseBookAddress,
  onAddressBookChange,
  removeEntry,
  saveAddress,
  sendListFor,
  SEND_LIST_LIMIT,
  updateEntry,
  shortBookAddress,
  showsSpentMark,
  __resetAddressBookForTests,
} from '../addressBook';
import type { AddressBookEntry } from '../addressBook';
import { ADDRESS_BOOK_WORDS, categoryName, emptyForNetwork, removeTitle } from '../addressBookWords';
import { SEALED_PREFIX, __resetSealedStoreForTests, sealedSetItem } from '../sealedStore';

const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
const disk = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;

const BTC_SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_TAPROOT = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
const BTC_LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const TEST_SEGWIT = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TEST_LEGACY = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const REGTEST = 'bcrt1q022amqf3jv7mg744rcjmst222dfazqvmurt943';

beforeEach(() => {
  mem.__reset();
  disk.clear();
  __resetSealedStoreForTests();
  __resetAddressBookForTests();
});

describe('the address as the book keeps it', () => {
  it('bare and normalised: no spaces, bech32 in lower case, a link down to its address', () => {
    expect(normaliseBookAddress(` ${BTC_SEGWIT}\n`)).toBe(BTC_SEGWIT);
    expect(normaliseBookAddress(BTC_SEGWIT.toUpperCase())).toBe(BTC_SEGWIT);
    expect(normaliseBookAddress(`bitcoin:${BTC_SEGWIT}?amount=0.01&label=Shop`)).toBe(BTC_SEGWIT);
    expect(normaliseBookAddress(`BITCOIN:${BTC_SEGWIT.toUpperCase()}`)).toBe(BTC_SEGWIT);
    expect(normaliseBookAddress(BTC_LEGACY)).toBe(BTC_LEGACY);
    expect(normaliseBookAddress(TEST_LEGACY)).toBe(TEST_LEGACY);
  });

  it('nothing for text that holds no address', () => {
    for (const raw of ['', 'hello', BTC_SEGWIT.slice(0, -1) + 'p', 'bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'lnbc1xyz']) {
      expect([raw, normaliseBookAddress(raw)]).toEqual([raw, null]);
    }
  });
});

describe('sealed at rest, one per phone', () => {
  it('what reaches the disk is sealed: no address, no name', async () => {
    await saveAddress({ address: BTC_SEGWIT, name: 'Kraken', category: 'exchange' }, 1);
    const raw = disk.get(ADDRESS_BOOK_KEY) ?? '';
    expect(raw.startsWith(SEALED_PREFIX)).toBe(true);
    expect(raw).not.toContain(BTC_SEGWIT);
    expect(raw).not.toContain('Kraken');
    expect(await loadAddressBook()).toEqual([
      { id: expect.stringMatching(/^ab_/), address: BTC_SEGWIT, name: 'Kraken', category: 'exchange', createdAt: 1 },
    ]);
  });

  it('nothing saved reads as an empty book', async () => {
    expect(await loadAddressBook()).toEqual([]);
  });
});

describe('a book that cannot be read THROWS, and nothing is written over it', () => {
  it('text that is not the book', async () => {
    for (const stored of ['not json', '{"a":1}', '[{"id":"x"}]', JSON.stringify([{ id: 'x', address: 'nope', name: 'A', category: 'private', createdAt: 1 }])]) {
      await sealedSetItem(ADDRESS_BOOK_KEY, stored);
      const before = disk.get(ADDRESS_BOOK_KEY);
      await expect(loadAddressBook()).rejects.toBeInstanceOf(AddressBookUnreadableError);
      await expect(saveAddress({ address: BTC_SEGWIT, name: 'Mum', category: 'private' })).rejects.toBeInstanceOf(
        AddressBookUnreadableError,
      );
      await expect(markEntryUsed(BTC_SEGWIT)).rejects.toBeInstanceOf(AddressBookUnreadableError);
      await expect(markAddressSpent(BTC_SEGWIT)).rejects.toBeInstanceOf(AddressBookUnreadableError);
      await expect(removeEntry('x')).rejects.toBeInstanceOf(AddressBookUnreadableError);
      expect(disk.get(ADDRESS_BOOK_KEY)).toBe(before);
    }
  });

  it('an entry of an unknown category is not read as a book either', async () => {
    await sealedSetItem(
      ADDRESS_BOOK_KEY,
      JSON.stringify([{ id: 'x', address: BTC_SEGWIT, name: 'A', category: 'friend', createdAt: 1 }]),
    );
    await expect(loadAddressBook()).rejects.toBeInstanceOf(AddressBookUnreadableError);
  });

  it('a value the right key cannot open is kept aside, never written over, and the book starts again', async () => {
    // The sealed store's rule for every sealed record: damaged bytes under
    // the key that opens the check are set aside and read as absent.
    await saveAddress({ address: BTC_SEGWIT, name: 'Mum', category: 'private' }, 1);
    const sealed = disk.get(ADDRESS_BOOK_KEY)!;
    const damaged = sealed.slice(0, -6) + (sealed.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
    disk.set(ADDRESS_BOOK_KEY, damaged);
    await expect(loadAddressBook()).resolves.toEqual([]);
    expect(disk.get(`${ADDRESS_BOOK_KEY}.unreadable`)).toBe(damaged);
    await saveAddress({ address: BTC_TAPROOT, name: 'Dad', category: 'private' }, 2);
    expect((await loadAddressBook()).map((e) => e.name)).toEqual(['Dad']);
    expect(disk.get(`${ADDRESS_BOOK_KEY}.unreadable`)).toBe(damaged);
  });

  it('a Keychain that cannot answer throws, and the book is untouched', async () => {
    await saveAddress({ address: BTC_SEGWIT, name: 'Mum', category: 'private' }, 1);
    const before = disk.get(ADDRESS_BOOK_KEY);
    __resetSealedStoreForTests();
    mem.__failNextRead();
    await expect(saveAddress({ address: BTC_TAPROOT, name: 'Dad', category: 'private' })).rejects.toThrow();
    expect(disk.get(ADDRESS_BOOK_KEY)).toBe(before);
    expect((await loadAddressBook()).map((e) => e.name)).toEqual(['Mum']);
  });
});

describe('the address on a card of the Address book page', () => {
  it('shows its first 10 and last 8 characters around an ellipsis, and a short one whole', () => {
    expect(shortBookAddress(BTC_TAPROOT)).toBe('bc1p0xlxvl…vqzk5jj0');
    expect(shortBookAddress(BTC_SEGWIT)).toBe('bc1qar0srr…zzwf5mdq');
    expect(shortBookAddress(BTC_LEGACY)).toBe('1BvBMSEYst…7xJaNVN2');
    expect(shortBookAddress('1234567890123456789')).toBe('1234567890123456789');
  });

  it('a book with entries for another network only says so, never "No saved addresses yet"', () => {
    expect(emptyForNetwork('testnet')).toBe('No saved addresses for Testnet4 yet');
    expect(emptyForNetwork('bitcoin')).toBe('No saved addresses for Bitcoin yet');
  });
});

describe('one entry per address', () => {
  it('the same address in another spelling is refused as already saved, and nothing changes', async () => {
    const first = await saveAddress({ address: BTC_SEGWIT, name: 'Kraken', category: 'exchange' }, 1);
    expect(first.kind).toBe('saved');
    for (const again of [BTC_SEGWIT, BTC_SEGWIT.toUpperCase(), `bitcoin:${BTC_SEGWIT}?amount=1`, ` ${BTC_SEGWIT} `]) {
      const r = await saveAddress({ address: again, name: 'Other', category: 'private' }, 2);
      expect(r).toEqual({ kind: 'alreadySaved', entry: first.entry });
    }
    expect(await loadAddressBook()).toHaveLength(1);
    expect(ADDRESS_BOOK_WORDS.alreadySaved).toBe('This address is already saved');
  });

  it('two saves at once both land (one change at a time)', async () => {
    await Promise.all([
      saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private' }, 1),
      saveAddress({ address: BTC_TAPROOT, name: 'B', category: 'exchange' }, 2),
      saveAddress({ address: BTC_LEGACY, name: 'C', category: 'private' }, 3),
    ]);
    expect((await loadAddressBook()).map((e) => e.name).sort()).toEqual(['A', 'B', 'C']);
  });

  it('finds an entry by any spelling of its address', async () => {
    await saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private' }, 1);
    const list = await loadAddressBook();
    expect(findBookEntry(list, BTC_SEGWIT.toUpperCase())?.name).toBe('A');
    expect(findBookEntry(list, `bitcoin:${BTC_SEGWIT}?amount=0.1`)?.name).toBe('A');
    expect(findBookEntry(list, BTC_TAPROOT)).toBeUndefined();
    expect(findBookEntry(list, 'nonsense')).toBeUndefined();
  });

  it('refuses text with no address, an empty name and an unknown category', async () => {
    await expect(saveAddress({ address: 'hello', name: 'A', category: 'private' })).rejects.toThrow();
    await expect(saveAddress({ address: BTC_SEGWIT, name: '   ', category: 'private' })).rejects.toThrow();
    await expect(saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'friend' as never })).rejects.toThrow();
    expect(await loadAddressBook()).toEqual([]);
  });

  it('names are trimmed and capped at MAX_NAME_LENGTH, on save and on edit', async () => {
    const long = 'A very long name for a friend';
    const { entry } = await saveAddress({ address: BTC_SEGWIT, name: `  ${long}  `, category: 'private' });
    expect(entry.name).toBe(long.slice(0, MAX_NAME_LENGTH).trim());
    expect((await updateEntry(entry.id, { name: ' Exchange account two ', category: 'private' }))?.name).toBe('Exchange accou');
    await expect(updateEntry(entry.id, { name: '  ', category: 'private' })).rejects.toThrow();
    await expect(updateEntry(entry.id, { name: 'A', category: 'friend' as never })).rejects.toThrow();
    expect(await updateEntry('missing', { name: 'X', category: 'private' })).toBeNull();
  });
});

describe('changes', () => {
  it('switching category keeps what the check found; the spent mark shows for a Private Address only', async () => {
    const { entry } = await saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private', spentSeenAt: 5 }, 1);
    expect(showsSpentMark(entry)).toBe(true);
    const exchange = await updateEntry(entry.id, { name: 'A', category: 'exchange' });
    expect(exchange).toMatchObject({ category: 'exchange', spentSeenAt: 5, address: entry.address });
    expect(showsSpentMark(exchange!)).toBe(false);
    const back = await updateEntry(entry.id, { name: 'B', category: 'private' });
    expect(back).toMatchObject({ name: 'B', category: 'private', address: entry.address });
    expect(showsSpentMark(back!)).toBe(true);
  });

  it('spent is remembered the first time only; an address not saved writes nothing', async () => {
    const { entry } = await saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private' }, 1);
    expect(showsSpentMark(entry)).toBe(false);
    expect((await markAddressSpent(BTC_SEGWIT.toUpperCase(), 10))?.spentSeenAt).toBe(10);
    expect((await markAddressSpent(BTC_SEGWIT, 20))?.spentSeenAt).toBe(10);
    const before = disk.get(ADDRESS_BOOK_KEY);
    expect(await markAddressSpent(BTC_TAPROOT, 30)).toBeNull();
    expect(disk.get(ADDRESS_BOOK_KEY)).toBe(before);
  });

  it('remove takes the entry out; a missing one changes nothing', async () => {
    const { entry } = await saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private' }, 1);
    expect(await removeEntry('missing')).toBe(false);
    expect(await removeEntry(entry.id)).toBe(true);
    expect(await loadAddressBook()).toEqual([]);
  });

  it('every written change is told to the listeners; a change that writes nothing is not', async () => {
    const heard: number[] = [];
    const off = onAddressBookChange((list) => heard.push(list.length));
    await saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private' }, 1);
    await saveAddress({ address: BTC_SEGWIT, name: 'A', category: 'private' }, 2);
    await markEntryUsed(BTC_TAPROOT, 3);
    await saveAddress({ address: BTC_TAPROOT, name: 'B', category: 'exchange' }, 4);
    off();
    await removeEntry((await loadAddressBook())[0].id);
    expect(heard).toEqual([1, 2]);
  });
});

describe('networks: an entry is its address\'s own', () => {
  const entry = (address: string, n: number, extra: Partial<AddressBookEntry> = {}): AddressBookEntry => ({
    id: `e${n}`,
    address,
    name: `N${n}`,
    category: 'private',
    createdAt: n,
    ...extra,
  });
  const book = [entry(BTC_SEGWIT, 1), entry(TEST_SEGWIT, 2), entry(BTC_LEGACY, 3), entry(TEST_LEGACY, 4), entry(REGTEST, 5)];

  it('a vault lists only what it can pay, nothing re-encoded', () => {
    expect(entriesForNetwork(book, 'bitcoin').map((e) => e.address)).toEqual([BTC_SEGWIT, BTC_LEGACY]);
    expect(entriesForNetwork(book, 'testnet').map((e) => e.address)).toEqual([TEST_SEGWIT, TEST_LEGACY]);
    expect(entriesForNetwork(book, 'regtest').map((e) => e.address)).toEqual([TEST_LEGACY, REGTEST]);
  });

  it("Send's card: at most five of the vault's network, most recently used first, then the newest", () => {
    const many = [
      entry(BTC_SEGWIT, 1),
      entry(BTC_TAPROOT, 2, { lastUsedAt: 50 }),
      entry(BTC_LEGACY, 3),
      entry('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 4, { lastUsedAt: 90 }),
      entry('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 5),
      entry('bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', 6),
      entry(TEST_SEGWIT, 7, { lastUsedAt: 99 }),
    ];
    expect(SEND_LIST_LIMIT).toBe(5);
    expect(sendListFor(many, 'bitcoin').map((e) => e.id)).toEqual(['e4', 'e2', 'e6', 'e5', 'e3']);
    expect(sendListFor(many, 'testnet').map((e) => e.id)).toEqual(['e7']);
    expect(sendListFor([], 'bitcoin')).toEqual([]);
  });

  it('markEntryUsed moves an entry to the top of Send\'s card', async () => {
    await saveAddress({ address: BTC_SEGWIT, name: 'Old', category: 'private' }, 1);
    await saveAddress({ address: BTC_TAPROOT, name: 'New', category: 'private' }, 2);
    expect(sendListFor(await loadAddressBook(), 'bitcoin').map((e) => e.name)).toEqual(['New', 'Old']);
    expect((await markEntryUsed(BTC_SEGWIT, 3))?.lastUsedAt).toBe(3);
    expect(sendListFor(await loadAddressBook(), 'bitcoin').map((e) => e.name)).toEqual(['Old', 'New']);
    expect(await markEntryUsed('nonsense')).toBeNull();
  });
});

describe('the words: exactly these', () => {
  it('the two categories', () => {
    expect(categoryName('private')).toBe('Private Address');
    expect(categoryName('exchange')).toBe('Exchange Address');
    expect(removeTitle('Kraken')).toBe('Remove Kraken?');
  });

  it("the book's sections: Private Address, then Exchange Address, an empty one left out", () => {
    const e = (n: number, category: 'private' | 'exchange', address: string): AddressBookEntry => ({
      id: `e${n}`,
      address,
      name: `N${n}`,
      category,
      createdAt: n,
    });
    const book = [e(1, 'exchange', BTC_SEGWIT), e(2, 'private', BTC_TAPROOT), e(3, 'exchange', TEST_SEGWIT)];
    expect(bookSections(book).map((s) => [s.title, s.entries.map((x) => x.id)])).toEqual([
      ['Private Address', ['e2']],
      ['Exchange Address', ['e3', 'e1']],
    ]);
    expect(bookSections(book, 'testnet').map((s) => [s.title, s.entries.map((x) => x.id)])).toEqual([
      ['Exchange Address', ['e3']],
    ]);
    expect(bookSections([])).toEqual([]);
    expect(bookSections(book).map((s) => s.group)).toEqual(['private', 'exchange']);
  });

  it('screens read the category through helpers, never as a field', () => {
    const entry = { category: 'exchange' as const };
    expect(categoryOf(entry)).toBe('exchange');
    expect(isPrivateAddress(entry)).toBe(false);
    expect(isPrivateAddress({ category: 'private' })).toBe(true);
    expect(otherCategory('private')).toBe('exchange');
    expect(otherCategory('exchange')).toBe('private');
  });

  it('every sentence a client reads', () => {
    expect(ADDRESS_BOOK_WORDS).toMatchObject({
      privateAddress: 'Private Address',
      exchangeAddress: 'Exchange Address',
      addressBook: 'Address book',
      addAddress: 'Add address',
      saveAddress: 'Save address',
      hasSpentCoins: 'Has spent coins before',
      spentReasonTitle: 'Has spent coins before',
      spentNotice: 'This address has spent coins before. Ask for a new one.',
      spentReason:
        'Paying an address that has already spent coins links your payment to everything it did before. Ask the receiver for a new address.',
      checking: 'Checking this address…',
      couldNotCheck: 'Could not check this address',
      tryAgain: 'Try again',
      empty: 'No saved addresses yet',
      alreadySaved: 'This address is already saved',
    });
  });
});
