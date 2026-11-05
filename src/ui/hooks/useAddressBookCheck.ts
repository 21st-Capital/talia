/**
 * The address book's check for the address a screen shows (decided
 * 2026-11-05): Send, once a saved address is in its field, and the Add
 * address page, once an address is in. The rules are
 * wallet/addressBookLookup.ts; this runs them for the current address and
 * category and says what to draw:
 *
 *   'idle'      nothing (no address, an Exchange Address, or one not for this vault's network);
 *   'checking'  the quiet line "Checking this address…";
 *   'spent'     the gold notice, "This address has spent coins before. Ask for a new one.";
 *   'notFound'  nothing at all, never a "safe" claim;
 *   'unknown'   the quiet line "Could not check this address" with "Try again" (`retry`).
 *
 * It asks again when the address, the category (back to Private Address),
 * the network or the server settings change, and on `retry`. Nothing is
 * asked before the settings are read: until then the server the client chose
 * is not known, and the default one must not be asked in its place. The
 * check is pending then, so it says 'checking' (the quiet line, with nothing
 * asked yet) and runs by itself once they are read. The check never disables
 * or delays anything on the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Network } from '../../bitcoin/descriptor/types';
import { normaliseBookAddress } from '../../wallet/addressBook';
import type { AddressCategory } from '../../wallet/addressBook';
import { checkBookAddress, lookupNetworkOf } from '../../wallet/addressBookLookup';
import type { BookCheckState } from '../../wallet/addressBookLookup';
import { useWallets } from '../../wallet/WalletProvider';

export type { BookCheckState };

export interface AddressBookCheckInput {
  /** The address on the page (bare, as Send or the field read it), or null while there is none. */
  address: string | null | undefined;
  /** Its category: the saved entry's on Send, the picked one on Add address. Null when it is not saved. */
  category: AddressCategory | null | undefined;
  /** The sending vault's network (Send). Without one, the address's own network. */
  network?: Network;
  /** The saved entry's `spentSeenAt`, when the screen has the entry. */
  spentSeenAt?: number;
}

export interface AddressBookCheck {
  state: BookCheckState;
  /** When it was first found spent (ms), with 'spent': hand it to `saveAddress` on the Add address page. */
  spentSeenAt?: number;
  /** "Try again": ask once more (after 'unknown'). */
  retry: () => void;
}

export function useAddressBookCheck(input: AddressBookCheckInput): AddressBookCheck {
  const { settings, settingsLoaded } = useWallets();
  const settingsNow = useRef(settings);
  settingsNow.current = settings;
  const [attempt, setAttempt] = useState(0);

  const { address: shown, category: picked } = input;
  const address = shown ? normaliseBookAddress(shown) : null;
  const category = picked ?? null;
  // Nothing to ask about: no address, an Exchange Address, or one this vault cannot pay.
  const asks = address != null && category === 'private' && lookupNetworkOf(address, input.network) != null;
  // The servers depend on these alone; another setting changing asks nothing again.
  const servers = JSON.stringify([settings.electrumUrls ?? null, settings.bitcoinServerHold ?? null]);
  const key = [address, category, input.network ?? '', input.spentSeenAt ?? '', settingsLoaded, servers, attempt].join('\n');

  const [answer, setAnswer] = useState<{ key: string; state: BookCheckState; spentSeenAt?: number } | null>(null);

  useEffect(() => {
    if (!asks) {
      setAnswer({ key, state: 'idle' });
      return;
    }
    if (input.spentSeenAt != null) {
      setAnswer({ key, state: 'spent', spentSeenAt: input.spentSeenAt });
      return;
    }
    if (!settingsLoaded) {
      setAnswer({ key, state: 'checking' });
      return;
    }
    let alive = true;
    setAnswer({ key, state: 'checking' });
    checkBookAddress({
      address: address!,
      category: 'private',
      network: input.network,
      settings: settingsNow.current,
    }).then((a) => {
      if (alive) setAnswer({ key, state: a.state, spentSeenAt: a.spentSeenAt });
    });
    return () => {
      alive = false;
    };
    // `key` carries every input the check depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Until the effect has answered for THIS address, say what it is about to:
  // never an earlier address's answer.
  if (answer?.key === key) return { state: answer.state, spentSeenAt: answer.spentSeenAt, retry };
  if (!asks) return { state: 'idle', retry };
  if (input.spentSeenAt != null) return { state: 'spent', spentSeenAt: input.spentSeenAt, retry };
  return { state: 'checking', retry };
}
