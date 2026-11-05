/**
 * Per-transaction user notes, PER VAULT. Stored locally in AsyncStorage;
 * notes are display metadata, never sent anywhere.
 *
 * A payment between two Talia vaults carries one transaction id, so one note
 * per id used to mean one note for both vaults, and editing it in the vault
 * that received the money rewrote it in the vault that sent it (found
 * 2026-09-20). The vault now owns its note and borrows the other one until
 * it writes; txNoteLogic holds the rule.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { addMissingNotes, emptyNotes, noteFor, notesForWallet, readNotes, writeNote } from './txNoteLogic';
import type { TxNotes } from './txNoteLogic';
import { carryNote } from './txReplacementLogic';

const NOTES_KEY = 'keel.txnotes.v2';
/** The one-note-per-transaction store. Read, never written: an older build
 *  on the same phone keeps reading it. */
const LEGACY_KEY = 'keel.txnotes.v1';

async function loadAll(): Promise<TxNotes> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_KEY);
    if (raw) return readNotes(JSON.parse(raw));
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    return legacy ? readNotes(JSON.parse(legacy)) : emptyNotes();
  } catch {
    return emptyNotes();
  }
}

export async function getTxNote(walletId: string, txid: string): Promise<string | undefined> {
  return noteFor(await loadAll(), walletId, txid);
}

/** All of this vault's notes at once: the transaction LIST shows them inline. */
export async function getAllTxNotes(walletId: string): Promise<Record<string, string>> {
  return notesForWallet(await loadAll(), walletId);
}

export async function setTxNote(walletId: string, txid: string, note: string): Promise<void> {
  const next = writeNote(await loadAll(), walletId, txid, note);
  await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(next));
}

/**
 * Notes from another wallet's file, for this vault (decided 2026-11-05):
 * Liana's wallet backup or labels file. Only transactions the vault shows no
 * note for get one; txNoteLogic.addMissingNotes holds the rule. Returns how
 * many were added.
 */
export async function addTxNotes(walletId: string, incoming: Record<string, string>): Promise<number> {
  const { notes, added } = addMissingNotes(await loadAll(), walletId, incoming);
  if (added > 0) await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  return added;
}

/**
 * A Speed up or a Cancel: the replacement shows the original's note (the
 * original keeps it too, it may still be the one that confirms). A note the
 * replacement already has wins. See txReplacementLogic.carryNote.
 */
export async function carryTxNote(walletId: string, oldTxid: string, newTxid: string): Promise<void> {
  const all = await loadAll();
  const next = carryNote(all, walletId, oldTxid, newTxid);
  if (next !== all) await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(next));
}
