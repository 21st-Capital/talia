/**
 * Where exported files live, and what to sweep (decided
 * 2026-09-26). Pure, tested; platform/files.ts does the file work.
 *
 * Exports (descriptors, PSBTs, .bed backups, statements) used to be written
 * straight into Library/Caches under their own names and left there after the
 * share sheet closed, so every vault ever exported piled up for a forensic
 * copy of the phone to read. Now each export is written into its own folder
 * under EXPORT_DIR and that folder is deleted as soon as the sheet closes; a
 * launch deletes whatever an interrupted export left, and the loose files the
 * old helpers left in Caches itself.
 */
export const EXPORT_DIR = 'talia-exports';

/** The extensions the old helpers wrote loose into Caches. Only these, and
 *  only at the top level of Caches, so nothing another library keeps there
 *  is touched. */
const LEGACY_EXPORT = /\.(bed|psbt|txt|csv|pdf|json)$/i;

export function isLegacyExportLeftover(name: string, isFile: boolean): boolean {
  return isFile && LEGACY_EXPORT.test(name);
}

/** A folder name for one export: unique enough that two exports at once never
 *  share (and so never delete) each other's file. Not a secret. */
export function exportFolderName(now: number, random: number): string {
  return `${now.toString(36)}-${Math.floor(random * 1e9).toString(36)}`;
}

/** A file name safe to create inside the export folder: no path parts. */
export function safeExportName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/^\.+/, '').trim();
  return cleaned || 'export';
}
