/**
 * Whose note is whose (decided 2026-09-20).
 *
 * A payment from one Talia vault to another is ONE transaction with one id,
 * and it shows up in both vaults. The note written in the vault that sent it
 * should appear in the vault that received it, which is the part that was approved,
 * but the two must not be the same note: "let the user change it and have
 * two different notes for each vault".
 *
 * So a note belongs to a vault. A vault that has never written its own note
 * for a transaction BORROWS one: the note from the old store, which kept one
 * note per transaction for the whole app, else the note another vault holds
 * for the same transaction. The moment a vault writes, it owns its note and
 * nothing elsewhere can change it again. Clearing it stores a blank, which
 * is a deliberate "no note here" and borrows nothing.
 *
 * Plain logic, no storage and no React Native, so it can be tested.
 */

export interface TxNotes {
  /** Vault id, then transaction id. A blank is a deliberate "no note". */
  own: Record<string, Record<string, string>>;
  /** Notes from before notes belonged to a vault: transaction id to note. */
  shared: Record<string, string>;
}

export function emptyNotes(): TxNotes {
  return { own: {}, shared: {} };
}

/** Read whatever the phone has stored, in either shape. */
export function readNotes(raw: unknown): TxNotes {
  if (!raw || typeof raw !== 'object') return emptyNotes();
  const o = raw as Record<string, unknown>;
  if (o.own && typeof o.own === 'object') {
    const own: TxNotes['own'] = {};
    for (const [walletId, map] of Object.entries(o.own as Record<string, unknown>)) {
      if (map && typeof map === 'object') {
        own[walletId] = Object.fromEntries(
          Object.entries(map as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string')
            .map(([k, v]) => [k, v as string]),
        );
      }
    }
    const shared = Object.fromEntries(
      Object.entries((o.shared ?? {}) as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string]),
    );
    return { own, shared };
  }
  // The old shape: one note per transaction, shown in every vault. Keeping
  // them as borrowed notes leaves every existing note exactly where the
  // owner sees it today, until a vault writes its own.
  const shared = Object.fromEntries(
    Object.entries(o).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]),
  );
  return { own: {}, shared };
}

/** The note another vault holds for this transaction, if any. */
function borrowed(notes: TxNotes, walletId: string, txid: string): string | undefined {
  const lenders = Object.keys(notes.own).filter((id) => id !== walletId).sort();
  for (const id of lenders) {
    const note = notes.own[id]?.[txid];
    if (note) return note;
  }
  return undefined;
}

/** What this vault shows for this transaction: its own note, else a borrowed one. */
export function noteFor(notes: TxNotes, walletId: string, txid: string): string | undefined {
  const mine = notes.own[walletId]?.[txid];
  // A blank of this vault's own is an answer: it borrows nothing.
  if (mine !== undefined) return mine || undefined;
  return notes.shared[txid] || borrowed(notes, walletId, txid);
}

/** Every note this vault shows, for the transaction list and the statement. */
export function notesForWallet(notes: TxNotes, walletId: string): Record<string, string> {
  const txids = new Set<string>(Object.keys(notes.shared));
  for (const map of Object.values(notes.own)) {
    for (const txid of Object.keys(map)) txids.add(txid);
  }
  const out: Record<string, string> = {};
  for (const txid of txids) {
    const note = noteFor(notes, walletId, txid);
    if (note) out[txid] = note;
  }
  return out;
}

/** This vault writes its own note. No other vault is touched. */
export function writeNote(notes: TxNotes, walletId: string, txid: string, note: string): TxNotes {
  const own = { ...notes.own, [walletId]: { ...(notes.own[walletId] ?? {}) } };
  own[walletId][txid] = note.trim();
  return { own, shared: notes.shared };
}

/**
 * Notes another wallet kept for this vault's transactions (decided
 * 2026-11-05: an import from Liana brings the labels its owner wrote there).
 * Each becomes this vault's own note, but only where the vault shows no note
 * and has not cleared one: a note the person wrote, in this vault or one this
 * vault borrows, always wins, and so does a deliberate blank. Blank incoming
 * notes are skipped. Returns the same object when nothing was added.
 */
export function addMissingNotes(
  notes: TxNotes,
  walletId: string,
  incoming: Readonly<Record<string, string>>,
): { notes: TxNotes; added: number } {
  const additions: Record<string, string> = {};
  for (const [txid, raw] of Object.entries(incoming)) {
    const note = raw.trim();
    if (!note) continue;
    if (notes.own[walletId]?.[txid] !== undefined) continue;
    if (noteFor(notes, walletId, txid) !== undefined) continue;
    additions[txid] = note;
  }
  const added = Object.keys(additions).length;
  if (added === 0) return { notes, added };
  return {
    notes: {
      own: { ...notes.own, [walletId]: { ...(notes.own[walletId] ?? {}), ...additions } },
      shared: notes.shared,
    },
    added,
  };
}
