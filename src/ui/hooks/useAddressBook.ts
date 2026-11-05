/**
 * The address book as a screen reads it (decided 2026-11-05): Send's card
 * and name row, and the Address book page. It reads the book once as the
 * screen mounts and then follows every change written on this phone
 * (`onAddressBookChange`), so a save on the Add address page shows on Send
 * and on the book at once.
 *
 * Until the first read answers, `entries` is the last book this launch read
 * (null before any), so a screen opened again paints at once. A book that
 * cannot be read is `unreadable` with no entries: the screen lists nothing
 * and claims nothing ("No saved addresses yet" would be untrue), and the
 * store itself refuses any write over it.
 */
import { useEffect, useState } from 'react';

import { loadAddressBook, onAddressBookChange } from '../../wallet/addressBook';
import type { AddressBookEntry } from '../../wallet/addressBook';

export interface AddressBookView {
  /** The saved entries, in the stored order; null until read, and when the book cannot be read. */
  entries: readonly AddressBookEntry[] | null;
  /** The book on this phone could not be read. */
  unreadable: boolean;
}

/** The book as last read or written this launch, for the first paint of a screen opened again. */
let lastBook: AddressBookEntry[] | null = null;

export function useAddressBook(): AddressBookView {
  const [view, setView] = useState<AddressBookView>(() => ({ entries: lastBook, unreadable: false }));
  useEffect(() => {
    let alive = true;
    // A change written while the first read is on its way is newer than that read.
    let heard = false;
    const stop = onAddressBookChange((entries) => {
      heard = true;
      lastBook = entries;
      if (alive) setView({ entries, unreadable: false });
    });
    loadAddressBook().then(
      (entries) => {
        if (heard) return;
        lastBook = entries;
        if (alive) setView({ entries, unreadable: false });
      },
      () => {
        if (heard) return;
        lastBook = null;
        if (alive) setView({ entries: null, unreadable: true });
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return view;
}

/** Tests only: a fresh launch. */
export function __forgetAddressBookViewForTests(): void {
  lastBook = null;
}
