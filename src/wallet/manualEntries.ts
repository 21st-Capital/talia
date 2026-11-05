/**
 * Persistence for manual-wallet entries.
 *
 * UNLIKE the caches beside it (addrCache, txCache, utxoCache), this is NOT
 * best-effort. Those hold data re-derivable from the chain, so a failed write
 * costs a re-sync. These entries exist NOWHERE else — the user typed them and
 * no chain can give them back. So a failed save THROWS, and the screen tells
 * the user their entry was not recorded rather than pretending it was.
 *
 * Same store as the rest of the wallet metadata (AsyncStorage): amounts, not
 * secrets. If a manual wallet ever gains anything sensitive, this moves to the
 * Keychain along with the rest.
 *
 * An in-memory MIRROR sits in front of the store (decided 2026-09-12: an
 * exchange-fed portfolio opened at 0 and waited before its entries showed).
 * Every load and every successful save refresh it, so a screen can paint the
 * last known list synchronously through `peekManualEntries` and let the
 * storage read (and any exchange check) land behind. The store stays the
 * truth: the mirror is never written back on its own, and a load always
 * reads the store, never the mirror.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ManualEntry } from './manualLedger';

const PREFIX = 'keel.manualentries.v1:';

/** Last known entries per wallet: what the store held at the latest load or
 *  save. Display only. */
const mirror = new Map<string, ManualEntry[]>();
/** Per wallet, bumped by every save and clear. A read that started BEFORE a
 *  save and resolves after it would otherwise put the pre-save list back
 *  into the mirror. */
const writeGen = new Map<string, number>();

/**
 * The last known entries for a wallet WITHOUT touching storage, or undefined
 * when nothing has been loaded or saved for it since launch. For painting a
 * screen instantly; never the base of an edit (load, then save).
 */
export function peekManualEntries(walletId: string): ManualEntry[] | undefined {
  const known = mirror.get(walletId);
  return known ? [...known] : undefined;
}

/** Entries for one wallet, in stored order. Missing/corrupt reads as empty. */
export async function loadManualEntries(walletId: string): Promise<ManualEntry[]> {
  const gen = writeGen.get(walletId) ?? 0;
  let entries: ManualEntry[] = [];
  try {
    const raw = await AsyncStorage.getItem(PREFIX + walletId);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      // Drop anything that isn't a well-formed entry rather than letting a
      // half-written record poison every total downstream.
      if (Array.isArray(parsed)) entries = parsed.filter(isManualEntry);
    }
  } catch {
    entries = [];
  }
  // A save landed while this read was in flight: its list is newer than
  // what was just read, so leave the mirror to it.
  if ((writeGen.get(walletId) ?? 0) === gen) mirror.set(walletId, [...entries]);
  return entries;
}

/** Replace the wallet's entries. Throws if the write fails — see the header. */
export async function saveManualEntries(
  walletId: string,
  entries: readonly ManualEntry[],
): Promise<void> {
  const gen = (writeGen.get(walletId) ?? 0) + 1;
  writeGen.set(walletId, gen);
  await AsyncStorage.setItem(PREFIX + walletId, JSON.stringify(entries));
  // Only the LATEST save fills the mirror: two writes in flight resolve in
  // the order they were queued, but the newer list is the truth either way.
  if (writeGen.get(walletId) === gen) mirror.set(walletId, [...entries]);
}

export async function clearManualEntries(walletId: string): Promise<void> {
  writeGen.set(walletId, (writeGen.get(walletId) ?? 0) + 1);
  mirror.delete(walletId);
  try {
    await AsyncStorage.removeItem(PREFIX + walletId);
  } catch {
    // Deleting a wallet must not fail because its entries would not go away.
  }
}

/** Ids are only ever compared to each other, so a counter + time is enough. */
let counter = 0;
export function newManualEntryId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

function isManualEntry(v: unknown): v is ManualEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<ManualEntry>;
  return (
    typeof e.id === 'string' &&
    (e.kind === 'buy' || e.kind === 'sell') &&
    typeof e.amountSats === 'number' &&
    Number.isFinite(e.amountSats) &&
    typeof e.date === 'number' &&
    typeof e.createdAt === 'number'
  );
}
