/**
 * Key names as an heir reads them (decided 2026-09-22). The vault builder
 * names unnamed keys from the OWNER's side ("Your key", "Your key 2", "Your
 * co-signer key"), and those names travelled with the invite, so on the
 * heir's phone the Spending policy said "Your key" for the owner's key. The
 * rule: a sentence must hold true in any scenario. On the heir's side they
 * become "Owner key", "Owner key 2", "Owner co-signer key"; any other name
 * (the owner's own words, "Heir 1", 21st Capital's keys) is kept.
 *
 * Pure: no native, no storage.
 */
export function heirSideKeyLabels(
  labels: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!labels) return labels;
  const out: Record<string, string> = {};
  for (const [fp, label] of Object.entries(labels)) {
    const trimmed = label.trim();
    const key = /^Your key( \d+)?$/.exec(trimmed);
    out[fp] = key ? `Owner key${key[1] ?? ''}` : trimmed === 'Your co-signer key' ? 'Owner co-signer key' : label;
  }
  return out;
}

/** True when an heir's copy still carries an owner-side name. */
export function hasOwnerSideLabels(labels: Readonly<Record<string, string>> | undefined): boolean {
  return Object.values(labels ?? {}).some((l) => /^Your (co-signer )?key( \d+)?$/.test(l.trim()));
}
