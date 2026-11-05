/**
 * Which devices the search lists, and which it takes by itself (decided
 * 2026-10-04: "please automatically select the unused ledger that is seen",
 * and "during the bluetooth search, can TALIA distinguish which model of a
 * ledger it found? If yes, there is no point in listing anything other than
 * what the user pre-selected").
 *
 * The kit reports a Ledger's model at discovery and a BitBox over Bluetooth
 * is always a Nova, so a found device is matched against the device the
 * client picked (or the vault recorded for the key). Those are the list,
 * and nothing else (decided 2026-10-04: "Please filter based on what the user
 * selected and do not list anything else that is found!"). Nothing is
 * corrected by discovery, then: a client holding another device goes back
 * with "Choose another device" where a question was asked, and on to
 * Replace signing device where the vault's own record was followed and the
 * seed has moved to another box (Replace signing device, from the vault's menu). The one
 * matching device not already spent on this vault connects by itself, even
 * with spent ones in sight.
 *
 * Pure, no React Native: tested in __tests__/searchMatch.test.ts.
 */
import { modelFromKit } from '../../wallet/deviceKinds';
import type { DeviceKind, DeviceModel } from '../../wallet/deviceKinds';

/** What the search knows about a device it found. */
export interface FoundView {
  brand: DeviceKind;
  id: string;
  /** The kit's model id at discovery (a Ledger's); none for a BitBox. */
  kitModel?: string | null;
}

export interface SearchSplit<T> {
  /** The devices of the model expected, in the order found. */
  shown: T[];
  /** The one expected device not already spent on this vault, else null. */
  auto: T | null;
  /** What the screen lists: the matches, only when there are two or more to
   *  choose between (decided 2026-10-04: "only list anything if two devices of
   *  the SAME model that the user preselected is found. Otherwise, there is
   *  no point in listing anything"). */
  listed: T[];
  /** The ONE match, when it is already spent on this vault: not connected by
   *  itself, said in a line with a way to use it anyway (the same device
   *  unlocked with another passphrase is another key). */
  spentOnly: T | null;
}

/** The model a found device is, when its brand's kit says so. */
export function foundModel(f: FoundView): DeviceModel | null {
  return modelFromKit(f.brand, f.kitModel ?? null);
}

export function splitFound<T>(
  found: readonly T[],
  view: (t: T) => FoundView,
  expect: DeviceModel,
  used?: ReadonlySet<string>,
): SearchSplit<T> {
  const shown = found.filter((t) => foundModel(view(t)) === expect);
  const fresh = shown.filter((t) => !(used?.has(view(t).id) ?? false));
  return {
    shown,
    auto: fresh.length === 1 ? fresh[0] : null,
    listed: shown.length >= 2 ? shown : [],
    spentOnly: shown.length === 1 && fresh.length === 0 ? shown[0] : null,
  };
}
