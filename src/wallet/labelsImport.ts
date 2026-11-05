/**
 * Labels for a vault that is already in Talia (decided 2026-11-05). A vault
 * added from Liana's encrypted backup or its descriptor arrived with no
 * notes; the labels Liana keeps reach it in either of two files:
 *
 * - Liana's labels export (`liana-labels-<date>.jsonl`, BIP-329, which
 *   Sparrow writes too), which names no vault: its labels are matched to
 *   this vault's transactions by their ids;
 * - Liana's wallet backup (`liana-backup-<date>.json`), which names its
 *   vault: one for another vault is refused rather than read.
 *
 * Only the notes are taken; the vault keeps its name and key names. A
 * transaction this vault does not hold gets no note, and one that already
 * shows a note keeps it (`txNoteLogic.addMissingNotes`). Pure, tested.
 */
import { parseBip329Jsonl, txLabelsOf } from '../bitcoin/bip329';
import { parseLianaWalletBackup } from '../bitcoin/descriptor/lianaBackup';
import { findDuplicateWallet } from './duplicates';
import type { WalletMeta } from './types';

export type LabelsFileReading =
  | { kind: 'notes'; notes: Record<string, string> }
  /** Not a labels file, or one with no transaction labels in it. */
  | { kind: 'none' }
  /** A Liana wallet backup of another vault. */
  | { kind: 'otherVault' }
  /** A Liana wallet backup Talia cannot read (no wallet, several, no
   *  descriptor, a network its keys do not match). Liana writes none of
   *  these; a damaged or hand-made file can be one. */
  | { kind: 'unreadable' };

/** What a picked file holds for `vault`. */
export function readLabelsFile(content: string, vault: WalletMeta): LabelsFileReading {
  let backup: ReturnType<typeof parseLianaWalletBackup> = null;
  try {
    backup = parseLianaWalletBackup(content);
  } catch {
    return { kind: 'unreadable' };
  }
  if (backup) {
    if (!findDuplicateWallet(backup.descriptor, [vault])) return { kind: 'otherVault' };
    return Object.keys(backup.txNotes).length > 0 ? { kind: 'notes', notes: backup.txNotes } : { kind: 'none' };
  }
  const records = parseBip329Jsonl(content);
  const notes = records ? txLabelsOf(records) : {};
  return Object.keys(notes).length > 0 ? { kind: 'notes', notes } : { kind: 'none' };
}

/** The notes for transactions the vault holds; null history = not read yet. */
export function notesForHistory(
  notes: Readonly<Record<string, string>>,
  txids: readonly string[] | null,
): Record<string, string> {
  if (!txids) return {};
  const held = new Set(txids.map((t) => t.toLowerCase()));
  return Object.fromEntries(Object.entries(notes).filter(([txid]) => held.has(txid)));
}

export type LabelsImportOutcome =
  | { kind: 'added'; count: number }
  /** Every matching transaction already showed a note. */
  | { kind: 'nothingNew' }
  /** The file's labels name none of this vault's transactions. */
  | { kind: 'noMatch' }
  /** This phone has not read the vault's transactions yet. */
  | { kind: 'historyNotRead' }
  | Exclude<LabelsFileReading, { kind: 'notes' }>;

/** The dialog's title, the whole of what it says (title and OK). */
export function labelsImportTitle(outcome: LabelsImportOutcome): string {
  switch (outcome.kind) {
    case 'added':
      return outcome.count === 1 ? '1 note added' : `${outcome.count} notes added`;
    case 'nothingNew':
      return 'These transactions already have notes';
    case 'noMatch':
      return 'None of these labels are for this vault';
    case 'historyNotRead':
      return "This vault's transactions are not loaded yet";
    case 'otherVault':
      return 'This backup is for another vault';
    case 'unreadable':
      return 'This backup cannot be read';
    case 'none':
      return 'No labels found in this file';
  }
}
