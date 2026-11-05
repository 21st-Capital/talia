/**
 * The records the removed engine features left on a phone, deleted at each
 * launch (the old engine's removal, decided 2026-11-04). Nothing reads
 * them since the old engine went, and one of them is not just counts: the
 * report-only check kept HASHES of the vaults it had checked
 * (`talia.reportOnly.checked.v1.<flavour>`, sealed, up to 500 a build), so
 * they are removed rather than left on the phone with no reader:
 *
 *   keel.engineOverride.v1           this phone's engine switches (phone tests)
 *   keel.shadowGuard.v1              the shadow checks' crash-loop marker
 *   keel.engineChecks.v1             the App Store app's unsent counts
 *   keel.reportOnlyGuard.v1.<f>      the report-only check's marker
 *   keel.reportOnlyOff.v1.<f>        and its off record, per flavour
 *   talia.reportOnly.checked.v1.<f>  the vaults it checked (hashes), per
 *                                    flavour, and any set-aside copy of it
 *                                    (`.unreadable[.N]`, sealedStore.ts)
 *
 * The App Store counts were never sendable by this build: a count goes out only
 * under the version and build that saw it. Removing a name nothing holds
 * changes nothing, so this runs every launch with no record of its own.
 * Never throws, never blocks the launch. Pure apart from the storage handed
 * in.
 */

/** The records removed by their exact name. */
export const RETIRED_ENGINE_RECORDS: readonly string[] = [
  'keel.engineOverride.v1',
  'keel.shadowGuard.v1',
  'keel.engineChecks.v1',
];

/** The records removed by their prefix (one per flavour, and set-aside copies). */
export const RETIRED_ENGINE_RECORD_PREFIXES: readonly string[] = [
  'keel.reportOnlyGuard.v1.',
  'keel.reportOnlyOff.v1.',
  'talia.reportOnly.checked.v1.',
];

/** Is this storage name one of the removed features' records? */
export function isRetiredEngineRecord(name: string): boolean {
  return RETIRED_ENGINE_RECORDS.includes(name) || RETIRED_ENGINE_RECORD_PREFIXES.some((p) => name.startsWith(p));
}

/** What the clean-up needs of AsyncStorage (tests hand in a map). */
export interface RecordStorage {
  getAllKeys(): Promise<readonly string[]>;
  removeItem(key: string): Promise<void>;
}

/** Delete every retired record on this phone; how many went (0 when the storage could not be read). */
export async function forgetRetiredEngineRecords(storage: RecordStorage): Promise<number> {
  let names: readonly string[];
  try {
    names = await storage.getAllKeys();
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names.filter(isRetiredEngineRecord)) {
    try {
      await storage.removeItem(name);
      removed += 1;
    } catch {
      // the next launch tries again
    }
  }
  return removed;
}
