/**
 * Registration payloads the COLDCARD actually accepts (decided 2026-07-18: a
 * BBQr-J JSON came back "Unhandled: json" on Edge — the device wants ITS
 * OWN import formats, both of which carry a wallet name):
 *
 *   - Classic multisig (wsh/sortedmulti): the Coldcard multisig setup TEXT
 *     file — `Name:` / `Policy: k of n` / `Format:` / per-key `Derivation:`
 *     + `XFP: xpub` lines. Universally handled, including top-level scan.
 *   - Miniscript (Edge): JSON `{name, desc}` imported from the Miniscript
 *     menu — sent as BBQr UNICODE text, never type J.
 *
 * String assembly only; the keys come from the already-validated descriptor.
 */
import { parsePolicy, pathRequirement } from './policy';
import { parseKeyOrigins } from './parse';

/**
 * Coldcard wallet names: printable ASCII, 2–20 chars. The firmware asserts
 * BOTH bounds (`auth.py` 2..40 on import, then `multisig.py` 1..20 when the
 * wallet is stored), so a one-character name is rejected outright — fall back
 * rather than let the device refuse the whole registration.
 */
export function coldcardWalletName(label: string): string {
  const ascii = label
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim();
  const name = ascii.slice(0, 20).trim();
  return name.length >= 2 ? name : 'Talia vault';
}

/**
 * Classic multisig setup file for wsh(sortedmulti(k,…)) vaults. Returns null
 * when the descriptor isn't that shape (miniscript vaults use JSON instead).
 */
export function coldcardMultisigConfig(label: string, descriptor: string): string | null {
  // Only classic P2WSH multisig uses this file format. Taproot multisig
  // parses to the same flat policy, but the COLDCARD registers it through
  // the miniscript import instead — emitting P2WSH here would be wrong.
  if (!descriptor.trim().startsWith('wsh(')) return null;
  let threshold: number;
  try {
    const policy = parsePolicy(descriptor);
    if (policy.paths.length !== 1 || policy.paths[0].groups.length !== 1) return null;
    if (policy.paths[0].olderBlocks !== undefined || policy.paths[0].afterHeight !== undefined) {
      return null;
    }
    // Every AND-ed group, not just the first: an and_v chain would have
    // registered a 3-of-3 as a 1-of-n (decided 2026-07-28).
    threshold = pathRequirement(policy.paths[0]).needed;
  } catch {
    return null;
  }
  const keys = parseKeyOrigins(descriptor);
  if (keys.length < 2 || keys.some((k) => !k.fingerprint || !k.originPath)) return null;

  const lines = [
    `Name: ${coldcardWalletName(label)}`,
    `Policy: ${threshold} of ${keys.length}`,
    'Format: P2WSH',
    '',
  ];
  for (const k of keys) {
    // A Derivation line applies to the keys that follow it.
    lines.push(`Derivation: m/${k.originPath}`);
    lines.push(`${k.fingerprint!.toUpperCase()}: ${k.xpub}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The named import JSON — `{name, desc}` on ONE line.
 *
 * This is what carries the vault's NAME onto the device, and the COLDCARD
 * accepts it on both the Multisig and the Miniscript menus (Coinkite's own
 * suite exercises it across usb/nfc/sd/vdisk/qr).
 *
 * It must stay single-line. The Q's scanner reads one LINE per scan — the
 * firmware appends CRLF as the frame terminator — so a multi-line payload in
 * a static QR is truncated at its first newline. That is why the classic
 * `Name:/Policy:` setup file, which works perfectly from microSD, was
 * rejected over QR back on 2026-07-19: the device only ever saw `Name: …`
 * and reported it had no xpubs. JSON sidesteps it entirely.
 */
export function coldcardNamedImport(label: string, descriptor: string): string {
  return JSON.stringify({ name: coldcardWalletName(label), desc: descriptor });
}

/** @deprecated name kept for the miniscript call site; same payload. */
export const coldcardMiniscriptImport = coldcardNamedImport;
