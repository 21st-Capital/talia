/**
 * What the Nova tells us about itself over Bluetooth, before anything else.
 *
 * The BitBox exposes a PRODUCT characteristic (9d1c9a77-...) carrying a small
 * JSON blob, `{"p": <product>, "v": <version>}`. It is the first thing readable
 * on a connection and it decides two questions that must be answered before a
 * single byte of the real protocol is exchanged:
 *
 *   1. Is this a NOVA? The older BitBox02 has no Bluetooth at all, so anything
 *      else answering on this service is not a device we can drive.
 *   2. Is the firmware new enough? Taproot wallet policies and miniscript on
 *      taproot arrived in 9.21.0, and EVERY 21st Capital vault is taproot
 *      (tr(multi_a), policy of 2026-07-23). The `bitbox-api` crate applies no
 *      gate of its own for this, so an old device would fail deep inside a
 *      signing ceremony rather than at the door.
 *
 * The same reasoning as the Ledger's >= 2.2.1 gate, and the same shape: this
 * module is pure, so the rule is testable without a device in the room.
 */

/** Oldest firmware with taproot wallet policies (BitBox firmware 9.21.0). */
export const MIN_NOVA_FIRMWARE = '9.21.0';

export interface NovaProduct {
  /** Vendor product string. A real device says "bb02p-btconly"
   *  (2026-08-31): the Nova's platform name is "bb02p", not "nova". */
  product: string;
  /** Firmware version as sent, e.g. "v9.26.5". The comparison strips the
   *  leading v; the display keeps whatever the device said. */
  version: string;
}

/** True when `version` >= `min`, comparing numeric dot-parts. A prerelease
 *  suffix is ignored ("9.21.0-rc1" counts as 9.21.0). Never substring-scan a
 *  version string: "9.9.0" would beat "9.21.0" alphabetically. */
export function versionAtLeast(version: string, min: string): boolean {
  // The device reports "v9.26.5" with a leading v (a real Nova, 2026-08-31).
  // parseInt('v9') is NaN, so without the strip a brand-new device reads as
  // version zero and fails the gate it should pass with years to spare.
  const a = version.replace(/^[vV]/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Parse the product characteristic. Returns null for anything that is not the
 * shape we expect, because a half-understood answer from an unknown device is
 * worse than no answer.
 */
export function parseProduct(json: string): NovaProduct | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const product = typeof rec.p === 'string' ? rec.p.trim() : '';
  const version = typeof rec.v === 'string' ? rec.v.trim() : '';
  if (!product || !version) return null;
  return { product, version };
}

/**
 * A Nova is the only BitBox with Bluetooth. The vendor never writes "nova"
 * into the product string: a real device answers "bb02p-btconly", the
 * platform name plus the edition ("bb02p-multi" for the multi-coin one). The
 * plain "bitbox02" platform has no radio, so it can never reach this code,
 * but the check still names the platforms we KNOW rather than accepting
 * anything that answered: a half-understood device gets refused, not driven.
 */
export function isNova(product: string): boolean {
  const p = product.toLowerCase();
  return p.startsWith('bb02p-') || p === 'bb02p' || p.includes('nova');
}

export type ProductVerdict =
  | { ok: true; product: NovaProduct }
  | { ok: false; reason: string };

/**
 * The whole door policy in one call. Messages are what the client reads, so
 * they say what to do rather than naming a constant.
 */
export function checkProduct(json: string): ProductVerdict {
  const parsed = parseProduct(json);
  if (!parsed) {
    return {
      ok: false,
      reason: 'This device answered in a way Talia did not understand. It may not be a BitBox.',
    };
  }
  if (!isNova(parsed.product)) {
    return {
      ok: false,
      reason:
        'Talia works with the BitBox02 Nova. Earlier BitBox02 models have no Bluetooth, so they cannot connect to a phone.',
    };
  }
  if (!versionAtLeast(parsed.version, MIN_NOVA_FIRMWARE)) {
    return {
      ok: false,
      reason: `This BitBox runs firmware ${parsed.version}. Talia vaults need ${MIN_NOVA_FIRMWARE} or newer, which is the firmware that added taproot support. Update it in the BitBoxApp and try again.`,
    };
  }
  return { ok: true, product: parsed };
}
