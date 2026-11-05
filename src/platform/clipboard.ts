/**
 * Clipboard access, isolated behind a tiny wrapper so screens don't import the
 * native module directly.
 *
 * Two doors (decided 2026-09-26), and every copy picks
 * one:
 *   - `copyToClipboard` for PUBLIC things: an address, a transaction id, a
 *     transaction's hex. Plain copy, as before.
 *   - `copySecret` for anything that opens something: the two-factor key,
 *     recovery codes, an invite code, a vault's descriptor or account key.
 *     iOS is asked to keep it off Universal Clipboard (the Mac, the iPad)
 *     where the kind allows, and to remove it after a short while, even while
 *     Talia is suspended. That needs the small native module
 *     native/taliapasteboard (a pod install and a native build); a build
 *     without it falls back to the plain copy, never to no copy.
 */
import Clipboard from '@react-native-clipboard/clipboard';
import { NativeModules, Platform } from 'react-native';
import { SECRET_COPY_POLICY } from './secretCopy';
import type { SecretKind } from './secretCopy';

export type { SecretKind } from './secretCopy';

interface TaliaPasteboardNative {
  setSecretString(text: string, localOnly: boolean, expiresInSeconds: number): void;
  presentPasteMenu?(x: number, y: number): Promise<string | null>;
}

// NativeModules answers undefined for a module the binary lacks: no throw.
const secure: TaliaPasteboardNative | undefined =
  Platform.OS === 'ios' ? (NativeModules.TaliaPasteboard as TaliaPasteboardNative | undefined) : undefined;

export function copyToClipboard(text: string): void {
  Clipboard.setString(text);
}

/** Copy something secret: local only where the kind allows, and it expires. */
export function copySecret(text: string, kind: SecretKind): void {
  const policy = SECRET_COPY_POLICY[kind];
  if (secure?.setSecretString) {
    try {
      secure.setSecretString(text, policy.localOnly, policy.expiresInSeconds);
      return;
    } catch {
      // fall through to the plain copy: a copy that works beats none
    }
  }
  Clipboard.setString(text);
}

/** True when this build can make a copy local-only and expiring. */
export function secretCopySupported(): boolean {
  return !!secure?.setSecretString;
}

export async function readClipboard(): Promise<string> {
  return Clipboard.getString();
}

/**
 * iOS's own Paste bubble at a point of the window, the one a text field shows.
 * Answers what was pasted, or null when no bubble showed (nothing to paste, or
 * a build without this native method) or it closed with no paste. Being iOS's
 * own, it pastes without the "Allow Paste?" that `readClipboard` can raise.
 */
export async function pasteBubble(x: number, y: number): Promise<string | null> {
  if (!secure?.presentPasteMenu) return null;
  try {
    return await secure.presentPasteMenu(x, y);
  } catch {
    return null;
  }
}
