/**
 * File import/export, isolated behind a small wrapper.
 *
 * Import: pick a text/descriptor file and return its contents.
 * Export: write a PSBT to a `.psbt` file and open the share sheet so the user
 * can hand it to a signing device / desktop wallet.
 *
 * All native-module usage (document picker, fs, share) lives here.
 */
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import Share, { Social } from 'react-native-share';
import { EXPORT_DIR, exportFolderName, isLegacyExportLeftover, safeExportName } from './exportCleanup';

export interface PickedFile {
  name: string;
  content: string;
}

/**
 * THE way an export touches the disk (decided 2026-09-26): the
 * file is written into a folder of its own under Caches/EXPORT_DIR,
 * handed to `share`, and the folder is deleted once the share sheet has
 * closed, whatever happened in it. Descriptors, PSBTs and backups used to be
 * left behind in Caches after every export.
 */
async function withExportFile<T>(
  filename: string,
  content: string,
  encoding: 'utf8' | 'base64',
  share: (path: string, name: string) => Promise<T>,
): Promise<T> {
  const dir = `${RNFS.CachesDirectoryPath}/${EXPORT_DIR}/${exportFolderName(Date.now(), Math.random())}`;
  const name = safeExportName(filename);
  const path = `${dir}/${name}`;
  await RNFS.mkdir(dir);
  try {
    await RNFS.writeFile(path, content, encoding);
    return await share(path, name);
  } finally {
    await RNFS.unlink(dir).catch(() => {});
  }
}

/**
 * At launch: delete what an interrupted export left (the app was killed with
 * the sheet open), and the loose export files the helpers before 2026-09-26
 * left in Caches itself. Never throws; nothing here is anyone's only copy.
 */
export async function sweepExportLeftovers(): Promise<void> {
  const caches = RNFS.CachesDirectoryPath;
  await RNFS.unlink(`${caches}/${EXPORT_DIR}`).catch(() => {});
  try {
    const items = await RNFS.readDir(caches);
    for (const item of items) {
      if (isLegacyExportLeftover(item.name, item.isFile())) {
        await RNFS.unlink(item.path).catch(() => {});
      }
    }
  } catch {
    // nothing to sweep
  }
}

/**
 * Open the OS file picker and return the selected file's text contents.
 * Returns null if the user cancels. Throws on read errors.
 */
/**
 * The picker hands back a URL, not a path: spaces arrive as %20 and the
 * filesystem then looks for a file whose name literally contains "%20"
 * (decided 2026-08-29, opening "Liana Test for Talia.bed"). Decode it, and drop the
 * file:// scheme while we are here.
 *
 * Decoding is guarded: a name containing a stray % is not valid encoding, and
 * a throw here would turn "odd filename" into "cannot open any file".
 */
function readablePath(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

export async function pickTextFile(): Promise<PickedFile | null> {
  try {
    const [file] = await pick({
      // Descriptors are exported as .txt/.json or plain text; allow anything.
      type: [types.plainText, types.json, types.allFiles],
    });
    const content = await RNFS.readFile(readablePath(file.uri), 'utf8');
    return { name: file.name ?? 'descriptor.txt', content };
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw e;
  }
}

/**
 * Pick any file and return its raw contents base64-encoded — for signed
 * PSBT/transaction files, which the COLDCARD writes as BINARY.
 */
export async function pickBinaryFile(): Promise<{ name: string; base64: string } | null> {
  try {
    const [file] = await pick({ type: [types.allFiles] });
    const base64 = await RNFS.readFile(readablePath(file.uri), 'base64');
    return { name: file.name ?? 'signed.psbt', base64 };
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw e;
  }
}

/** Write BINARY content (base64) for the share sheet, the virtual-vault PDF
 *  report. The file is gone once the sheet closes. */
export async function exportBase64ToFile(filename: string, base64: string, mime: string): Promise<void> {
  await withExportFile(filename, base64, 'base64', (path, name) =>
    Share.open({ url: `file://${path}`, filename: name, type: mime, failOnCancel: false }),
  );
}

/** What the share sheet reported: did the user finish an activity, and
 *  which one (an iOS activity type such as com.apple.UIKit.activity.Mail, or
 *  a third-party extension id). Cancelling the sheet is completed=false. */
export interface ShareOutcome {
  completed: boolean;
  activity: string;
}

/**
 * Write BINARY content (base64) to the cache and open the share sheet with a
 * subject and an optional message beside the file, reporting whether the user
 * FINISHED an activity. For the encrypted vault backup (decided 2026-09-02): the
 * user's own mail app has to be the one that sends it, and iOS offers no way
 * to hand a third-party mail app an attachment except through this sheet.
 * `excludedActivityTypes` trims the sheet to apps that SEND, when asked.
 */
export async function shareBase64File(
  filename: string,
  base64: string,
  mime: string,
  opts: { subject?: string; message?: string; excludedActivityTypes?: string[] } = {},
): Promise<ShareOutcome> {
  return withExportFile(filename, base64, 'base64', async (path, name) => {
    const res = await Share.open({
      url: `file://${path}`,
      filename: name,
      type: mime,
      subject: opts.subject,
      message: opts.message,
      excludedActivityTypes: opts.excludedActivityTypes,
      failOnCancel: false,
    });
    return { completed: res.success === true, activity: res.message ?? '' };
  });
}

/** Write plain text for the share sheet (vault exports). The file is gone
 *  once the sheet closes. */
export async function exportTextToFile(filename: string, content: string): Promise<void> {
  await withExportFile(filename, content, 'utf8', (path, name) =>
    Share.open({ url: `file://${path}`, filename: name, type: 'text/plain', failOnCancel: false }),
  );
}

export async function exportPsbtToFile(filename: string, psbtBase64: string): Promise<void> {
  await withExportFile(filename, psbtBase64, 'utf8', (path, name) =>
    Share.open({
      url: `file://${path}`,
      filename: name,
      type: 'application/octet-stream',
      failOnCancel: false,
    }),
  );
}

/**
 * Download an authenticated binary (e.g. the inheritance-protocol PDF) to
 * the app's sandboxed cache and open the share sheet (AirDrop / Files /
 * print / …). The file is deleted right after the sheet closes — nothing
 * sensitive lingers on disk; fetching it again requires the Bearer session.
 */
export async function downloadAndShareFile(
  url: string,
  headers: Record<string, string>,
  filename: string,
  mime: string,
): Promise<void> {
  const path = `${RNFS.CachesDirectoryPath}/${filename}`;
  const res = await RNFS.downloadFile({ fromUrl: url, headers, toFile: path }).promise;
  if (res.statusCode !== 200) {
    await RNFS.unlink(path).catch(() => {});
    throw new Error(
      res.statusCode === 401
        ? 'Your session has expired. Please log in again.'
        : `Download failed (${res.statusCode}).`,
    );
  }
  try {
    await Share.open({ url: `file://${path}`, filename, type: mime, failOnCancel: false });
  } finally {
    await RNFS.unlink(path).catch(() => {});
  }
}

/**
 * Download an authenticated file into the sandboxed cache and hand back its
 * path — the caller decides what to do with it (attach to a mail draft) and
 * MUST call the returned cleanup when done. Use downloadAndShareFile when a
 * share sheet is all you need.
 */
export async function downloadToCache(
  url: string,
  headers: Record<string, string>,
  filename: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = `${RNFS.CachesDirectoryPath}/${filename}`;
  const res = await RNFS.downloadFile({ fromUrl: url, headers, toFile: path }).promise;
  if (res.statusCode !== 200) {
    await RNFS.unlink(path).catch(() => {});
    throw new Error(
      res.statusCode === 401
        ? 'Your session has expired. Please log in again.'
        : `Download failed (${res.statusCode}).`,
    );
  }
  return { path, cleanup: () => RNFS.unlink(path).catch(() => {}) };
}

/** Share arbitrary text (e.g. a PSBT base64 string) via the OS share sheet. */
export async function shareText(text: string, title?: string): Promise<void> {
  await Share.open({ message: text, title, failOnCancel: false });
}

/**
 * Share text to a specific app (falls back to the system sheet when the app
 * isn't installed or sharing fails).
 */
export async function shareVia(
  target: 'system' | 'telegram' | 'whatsapp',
  text: string,
): Promise<void> {
  try {
    if (target === 'telegram') {
      await Share.shareSingle({ social: Social.Telegram, message: text });
      return;
    }
    if (target === 'whatsapp') {
      await Share.shareSingle({ social: Social.Whatsapp, message: text });
      return;
    }
    await Share.open({ message: text, failOnCancel: false });
  } catch {
    try {
      await Share.open({ message: text, failOnCancel: false });
    } catch {
      // user cancelled — nothing to do
    }
  }
}
