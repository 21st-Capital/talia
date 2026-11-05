/**
 * Filling a vault's missing key origin in (decided 2026-09-08).
 *
 * A vault imported from a bare xpub knows its key but not the master
 * fingerprint and path behind it. A transaction built for such a vault
 * carries the xpub's own fingerprint, and every hardware signer refuses it
 * by name ("need 0A1B2C3D, found 4E5F6A7B"). Connecting a device is the
 * moment that information exists: the device says which master key and
 * path the xpub came from, and the descriptor is completed with it. The
 * keys do not change, so addresses and history do not either.
 *
 * String work only: the descriptor layer's parsers, never BDK.
 */
import { parseKeyOrigins, stripChecksum } from '../bitcoin/descriptor';

/**
 * The descriptor with `[fingerprint/path]` in front of a bare xpub.
 * Unchanged when that key already carries an origin. Throws when the key
 * is not in the descriptor at all. Returned without a checksum (BDK
 * accepts checksum-less descriptors and validates them itself).
 */
export function withKeyOrigin(
  descriptor: string,
  xpub: string,
  fingerprint: string,
  originPath: string,
): string {
  const { body } = stripChecksum(descriptor);
  const key = parseKeyOrigins(body).find((k) => k.xpub === xpub);
  if (!key) throw new Error('That key is not in this vault.');
  if (key.fingerprint) return body;
  const fp = fingerprint.toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(fp)) throw new Error('That is not a key fingerprint.');
  const path = originPath.replace(/^m\//, '').replace(/[hH]/g, "'");
  const origin = `[${fp}/${path}]`;
  // Only a bare occurrence: one not already preceded by a closing bracket.
  return body.replace(new RegExp(`(^|[^\\]])${xpub}`, 'g'), (_m, pre: string) => `${pre}${origin}${xpub}`);
}

/**
 * The standard account path a single-key descriptor's key would sit at on
 * a device, for account N: BIP-84 for wpkh, 86 for tr, 49 for sh(wpkh),
 * 44 for pkh. Null for any other shape.
 */
export function standardOriginPath(descriptor: string, network: string, account = 0): string | null {
  const body = stripChecksum(descriptor).body.trim();
  const coin = network === 'bitcoin' ? "0'" : "1'";
  if (body.startsWith('tr(')) return `86'/${coin}/${account}'`;
  if (body.startsWith('sh(wpkh(')) return `49'/${coin}/${account}'`;
  if (body.startsWith('wpkh(')) return `84'/${coin}/${account}'`;
  if (body.startsWith('pkh(')) return `44'/${coin}/${account}'`;
  return null;
}
