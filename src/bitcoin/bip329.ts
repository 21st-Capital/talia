/**
 * BIP-329 wallet labels, the format Liana and Sparrow export their labels in
 * (decided 2026-11-05: a vault imported from Liana keeps the notes its owner
 * wrote there).
 *
 * A record is one JSON object, `{ type, ref, label?, ... }`. A labels file is
 * JSONL: one record per line. Liana's wallet backup carries the same records
 * as a JSON array in its account's `labels`.
 *
 * Talia keeps transaction notes and no store of address or coin labels, so
 * a label lands as a transaction's note:
 *  - a `tx` record is the note of its transaction;
 *  - an `output` record (`<txid>:<vout>`) is a coin's label, and becomes the
 *    note of the transaction that made the coin when that transaction has no
 *    `tx` label of its own (decided 2026-11-05 after a phone test: Liana keeps
 *    a payment's label on its coin, so a backup can hold coin labels
 *    and no transaction label). Several labelled coins of one transaction
 *    read in output order, each label once, joined with ", ".
 * `addr` and `input` records are passed over, as BIP-329 asks of a wallet
 * that does not know a record (an input's `ref` names the coin it spends,
 * not the transaction spending it). A record with no label, a blank label
 * or a `ref` of the wrong shape is passed over too. Pure, no storage.
 */

const TXID_RE = /^[0-9a-f]{64}$/i;
const OUTPOINT_RE = /^([0-9a-f]{64}):(\d{1,10})$/i;

/** Transaction notes by lowercase transaction id, from `tx` labels and, for
 *  a transaction without one, its coins' `output` labels. When one
 *  transaction (or one coin) is labelled twice, the later record wins, as
 *  the BIP-329 reader Liana uses keeps the later one. */
export function txLabelsOf(records: readonly unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  const coins = new Map<string, Map<number, string>>();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const r = record as Record<string, unknown>;
    if (typeof r.ref !== 'string' || typeof r.label !== 'string') continue;
    const ref = r.ref.trim();
    const label = r.label.trim();
    if (!label) continue;
    if (r.type === 'tx') {
      if (TXID_RE.test(ref)) out[ref.toLowerCase()] = label;
    } else if (r.type === 'output') {
      const m = OUTPOINT_RE.exec(ref);
      if (!m) continue;
      const txid = m[1].toLowerCase();
      const byVout = coins.get(txid) ?? new Map<number, string>();
      byVout.set(Number(m[2]), label);
      coins.set(txid, byVout);
    }
  }
  for (const [txid, byVout] of coins) {
    if (out[txid] !== undefined) continue;
    const inOrder = [...byVout.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
    out[txid] = [...new Set(inOrder)].join(', ');
  }
  return out;
}

/**
 * The records of a BIP-329 JSONL file, or null when the text is not one: a
 * file is taken as labels only when every line that holds anything is a JSON
 * object with a `type` and a `ref`, so a descriptor export or any other
 * file is never read as labels.
 */
export function parseBip329Jsonl(text: string): Record<string, unknown>[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r.type !== 'string' || typeof r.ref !== 'string') return null;
    records.push(r);
  }
  return records;
}
