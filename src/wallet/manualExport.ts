/**
 * Export/import for virtual vaults (decided 2026-08-25).
 *
 * The entries in a virtual vault exist nowhere else — no chain, no backend —
 * so the export file doubles as their only backup, and the parser treats an
 * incoming file with the suspicion irreplaceable data deserves: versioned
 * envelope, per-entry validation, and a count of anything it had to drop
 * rather than a silent shrug.
 *
 * Format: human-readable JSON with a `type` tag, so a file found years later
 * in a drive identifies itself, and other tools can read it trivially.
 */
import type { ManualEntry } from './manualLedger';
import { usableFee, usablePrice } from './entryDetails';
import { sanitizeSourceFields } from './entrySources';

export const MANUAL_VAULT_EXPORT_TYPE = 'talia-virtual-vault';
/**
 * Stays 1 while every change is a new OPTIONAL entry field (decided
 * 2026-10-22, the price typed and the source): an app refuses a file whose
 * version is higher than its own, so a bump would lock every older app out
 * of a file it can read perfectly well. An older app keeps the fields it does
 * not know untouched; a newer one reads a file without them as before.
 */
export const MANUAL_VAULT_EXPORT_VERSION = 1;

export interface ManualVaultExport {
  name: string;
  /** The vault's chosen icon key, when one was set. */
  icon?: string;
  entries: ManualEntry[];
  /** Entries in the file that were malformed and dropped — surfaced so the
   *  user knows the import is partial instead of assuming it is whole. */
  droppedEntries: number;
}

/** Serialize a vault for export. Pretty-printed — people open these files. */
export function serializeManualVault(
  name: string,
  entries: readonly ManualEntry[],
  exportedAt: number,
  icon?: string,
): string {
  // EVERYTHING the vault holds goes in (decided 2026-08-25): the name, the icon,
  // and each entry whole: amount, date, buy/sell, the total paid or
  // received WITH its currency, the fee, the price per bitcoin when it was
  // typed, the source and the note.
  return JSON.stringify(
    {
      type: MANUAL_VAULT_EXPORT_TYPE,
      version: MANUAL_VAULT_EXPORT_VERSION,
      name,
      icon,
      exportedAt,
      entries,
    },
    null,
    2,
  );
}

/**
 * Parse an export file. Throws with a user-readable message when the file is
 * not a virtual-vault export at all; malformed individual entries are dropped
 * and counted rather than sinking the whole import.
 */
export function parseManualVault(content: string): ManualVaultExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    throw new Error('This file is not a portfolio export.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('This file is not a portfolio export.');
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.type !== MANUAL_VAULT_EXPORT_TYPE) {
    throw new Error(
      'This file is not a portfolio export. To add an on-chain vault, use "Add an existing vault" instead.',
    );
  }
  if (typeof doc.version !== 'number' || doc.version > MANUAL_VAULT_EXPORT_VERSION) {
    throw new Error(
      'This export was made by a newer version of Talia. Update the app to import it.',
    );
  }
  if (!Array.isArray(doc.entries)) {
    throw new Error('This export file is damaged. It has no entries list.');
  }
  const entries = doc.entries.filter(isExportedEntry).map(withUsableFee).map(withUsableExtras);
  return {
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : 'Virtual vault',
    icon: typeof doc.icon === 'string' ? doc.icon : undefined,
    entries,
    droppedEntries: doc.entries.length - entries.length,
  };
}

/**
 * A fee only means something beside a total it is inside of: a buy's fee
 * cannot exceed its total, and a fee with no total at all is noise. Such a
 * fee (a hand-edited file, another tool) is dropped and the entry kept —
 * the amount and total are still good, and the fee is only ever cosmetic.
 */
function withUsableFee(e: ManualEntry): ManualEntry {
  if (e.feeAmount == null || usableFee(e) != null) return e;
  const { feeAmount: _dropped, ...rest } = e;
  return rest;
}

/**
 * The newer optional fields, kept only when well formed (a price that is a
 * number, a source of the right shape); a bad one is dropped and the entry
 * kept, as with the fee. A price with no total is noise: the total is what
 * every figure reads, so a price alone would show a number nothing counts.
 */
function withUsableExtras(e: ManualEntry): ManualEntry {
  const { pricePerBtc, source, sourceName, ...rest } = e;
  const price = e.fiatAmount != null ? usablePrice(pricePerBtc) : undefined;
  return {
    ...rest,
    ...(price != null ? { pricePerBtc: price } : {}),
    ...sanitizeSourceFields({ source, sourceName }),
  };
}

/** Same shape guard as storage uses — an import is untrusted input. */
function isExportedEntry(v: unknown): v is ManualEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<ManualEntry>;
  return (
    typeof e.id === 'string' &&
    (e.kind === 'buy' || e.kind === 'sell') &&
    typeof e.amountSats === 'number' &&
    Number.isFinite(e.amountSats) &&
    e.amountSats > 0 &&
    Number.isInteger(e.amountSats) &&
    typeof e.date === 'number' &&
    Number.isFinite(e.date) &&
    typeof e.createdAt === 'number' &&
    (e.fiatAmount == null || (Number.isFinite(e.fiatAmount) && e.fiatAmount >= 0)) &&
    (e.feeAmount == null || (Number.isFinite(e.feeAmount) && e.feeAmount >= 0)) &&
    (e.note == null || typeof e.note === 'string')
  );
}
