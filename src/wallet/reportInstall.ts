/**
 * Which install of the app this is, for the engine report's split by build
 * (decided 2026-10-28, wallet/engineReport.ts). A phone build keeps the
 * version and build number of the last release, so they alone do not tell
 * two Talia Test builds apart; the app's bundle path does: iOS installs every
 * build of an app in a new bundle container. The path is kept on the phone
 * only (AsyncStorage), never in the report: the report gets the date this
 * install first ran, `since`.
 *
 * Pure apart from the storage handed in.
 */
export const REPORT_INSTALL_KEY = 'keel.engineReport.install.v1';

/** What `installSince` needs of AsyncStorage (tests hand in a map). */
export interface InstallStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * When this install first ran: the stored date while the bundle path is the
 * one stored with it, else `now`, stored with the new path. Undefined when
 * there is no bundle path (not iOS) or the storage cannot be read or written;
 * the report then tells builds apart by version and build number alone.
 */
export async function installSince(
  storage: InstallStorage,
  bundlePath: string | undefined | null,
  now: Date,
): Promise<string | undefined> {
  if (!bundlePath) return undefined;
  try {
    const raw = await storage.getItem(REPORT_INSTALL_KEY);
    let stored: unknown = null;
    try {
      stored = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      stored = null; // unreadable: this launch starts it over
    }
    if (
      stored &&
      typeof stored === 'object' &&
      (stored as { bundle?: unknown }).bundle === bundlePath &&
      typeof (stored as { since?: unknown }).since === 'string' &&
      ISO.test((stored as { since: string }).since)
    ) {
      return (stored as { since: string }).since;
    }
    const since = now.toISOString();
    await storage.setItem(REPORT_INSTALL_KEY, JSON.stringify({ bundle: bundlePath, since }));
    return since;
  } catch {
    return undefined;
  }
}
