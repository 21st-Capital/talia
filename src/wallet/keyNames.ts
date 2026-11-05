/**
 * What a vault's keys are called before a device has said its own name
 * (decided 2026-09-26).
 *
 * "Remove the question about the key name after importing the vault and just
 * name the keys by default Key 1, Key 2 ... The reason is that 99% of people
 * do not know which fingerprint belongs to which device. However, at the
 * latest when the user registers the vault with his hardware wallet, we will
 * know the name of the device and will use that name as the template for the
 * key name."
 *
 * So an import names the keys itself, and a registration offers the device's
 * own name for the key it just proved. Without stored names several screens
 * fall back to the FINGERPRINT (the Sign screen, the Estate Plan's key list,
 * the vault registration page), which is the very thing nobody can place.
 *
 * The numbering covers the client's OWN keys, in the descriptor's order.
 * 21st Capital's co-signer and rescue keys are not numbered at all: they are
 * named by their role. A key that already carries a name (another Talia's
 * export, a Sparrow export with the device names, a name the owner typed)
 * keeps that name and keeps its POSITION, so naming one key never renumbers
 * the others.
 *
 * Pure, tested.
 */
import { parseKeyOrigins, stripChecksum } from '../bitcoin/descriptor';

/** Ways a caller can say which keys are 21st Capital's. */
export type ProviderKeys =
  | ReadonlySet<string>
  | readonly string[]
  /** The predicate the policy screens already hold. */
  | ((fingerprint: string) => boolean);

export interface KeyNameContext {
  /** 21st Capital's keys: ours are named by their role, never numbered. */
  providerFps?: ProviderKeys;
  /** Names already known for some keys, by lowercase fingerprint. */
  known?: Readonly<Record<string, string>>;
}

const isOurs = (provider: ProviderKeys | undefined): ((fp: string) => boolean) => {
  if (!provider) return () => false;
  if (typeof provider === 'function') return (fp) => provider(fp);
  const set = new Set([...provider].map((fp) => fp.toLowerCase()));
  return (fp) => set.has(fp);
};

/**
 * `{ fingerprint: "Key 1" }` for every key of the descriptor that nobody has
 * named yet, numbered in the order the descriptor lists them. Keys that are
 * already named keep their name and do not take a number, so the client's
 * first unnamed key is Key 1 whatever else the vault holds.
 */
export function defaultKeyNames(
  descriptor: string | undefined | null,
  context: KeyNameContext = {},
): Record<string, string> {
  if (!descriptor) return {};
  const ours = isOurs(context.providerFps);
  const known = context.known ?? {};
  let fingerprints: string[] = [];
  try {
    fingerprints = parseKeyOrigins(stripChecksum(descriptor).body).flatMap((k) =>
      k.fingerprint ? [k.fingerprint.toLowerCase()] : [],
    );
  } catch {
    return {};
  }
  const distinct = new Set(fingerprints);
  // A one-key vault needs no number: the vault's own name identifies its key,
  // which is what the Sign screen shows for it (decided 2026-07-19), and the
  // device names it at registration.
  if (distinct.size <= 1) return {};
  const out: Record<string, string> = {};
  let n = 0;
  for (const fp of distinct) {
    if (ours(fp)) continue;
    // The number is the key's POSITION among the client's keys, so a key that
    // already has a real name keeps its slot: naming one key must never
    // renumber the others under the owner (decided 2026-09-26).
    n += 1;
    if ((known[fp] ?? '').trim()) continue;
    out[fp] = `Key ${n}`;
  }
  return out;
}

/**
 * Is this the name Talia gave a key itself, rather than one a person chose?
 * A default name is replaced without asking wherever a better one turns up;
 * a name the owner typed is never overwritten.
 */
export function isDefaultKeyName(name: string | undefined | null): boolean {
  return /^key \d+$/i.test((name ?? '').trim());
}

/**
 * Whether a registration asks "Name this key" at all (decided 2026-10-15: "it
 * only makes sense to ask this question once and only if its unknown"). A
 * vault BUILT in Talia was named key by key in the builder, so it is never
 * asked again; an imported vault is asked only for a key that came with no
 * name of its own (none, or the import's "Key 2" stand-in), because only
 * the device can name it then; an import that carried names (another
 * Talia's export, a Sparrow file) keeps them and asks nothing.
 */
export function registrationAsksKeyName(
  vault: { transport?: string | null } | null | undefined,
  currentName: string | undefined | null,
): boolean {
  if (!vault || vault.transport === 'created') return false;
  const current = (currentName ?? '').trim();
  return !current || isDefaultKeyName(current);
}

/**
 * The name a registration offers for a key: the device's own name, unless the
 * key already carries a name its owner chose, which is kept as the template
 * instead. Never a fingerprint, and never an empty field.
 */
export function keyNameTemplate(
  currentName: string | undefined | null,
  deviceName: string | undefined | null,
): string {
  const current = (currentName ?? '').trim();
  const device = (deviceName ?? '').trim();
  if (current && !isDefaultKeyName(current)) return current;
  return device || current;
}

/**
 * The name to SHOW for a key of this vault: the one it carries, else the
 * number it would have been given, and never the fingerprint.
 *
 * Vaults imported before 2026-09-26 carry no names at all, and several
 * screens fell back to the fingerprint, which is the thing nobody can place
 * ("99% of people do not know which fingerprint belongs to which device").
 * The number comes from the DESCRIPTOR's order, so every screen says the same
 * one however it sorts its rows (our keys last, the signing rows by path).
 *
 * Returns null only for a key that is not in the descriptor, or one the
 * descriptor names with no fingerprint: the caller's own last resort then
 * applies.
 */
export function keyDisplayName(
  vault: { descriptor?: string | null; keyLabels?: Readonly<Record<string, string>> } | null | undefined,
  fingerprint: string | null | undefined,
  providerFps?: ProviderKeys,
): string | null {
  const fp = (fingerprint ?? '').toLowerCase();
  if (!vault || !fp) return null;
  const stored = vault.keyLabels?.[fp];
  if ((stored ?? '').trim()) return stored!.trim();
  return defaultKeyNames(vault.descriptor, { providerFps, known: vault.keyLabels })[fp] ?? null;
}
