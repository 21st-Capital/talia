/**
 * What an heir reads about a sealed vault, in ONE place (decided 2026-09-22: an
 * heir whose key sits on the vault's first layer, with no timelock, was told
 * the vault stays sealed "until its waiting period ends". There is no waiting
 * period for them: the vault is sealed only until they open it with their
 * key). A waiting period is mentioned only for a countdown invite
 * (`mode: 'strict'`), which exists only for a timelocked key.
 *
 * Pure: the clock comes in as `now`.
 */
import { formatBlocksDuration } from './timelock';

export interface SealedInviteFacts {
  /** 'key' = opened with the heir's hardware key; 'code' = the code alone. */
  access: 'key' | 'code';
  /** 'strict' = sealed until the heir key's timelock opens; 'full' = no
   *  countdown, released at the claim. */
  mode: 'strict' | 'full';
  vaultLabel: string;
  releaseAt: string | null;
}

const MS_PER_BLOCK = 10 * 60 * 1000;

/** The dialog right after a claim. */
export function claimedMessage(f: SealedInviteFacts): string {
  const named = `You are named on "${f.vaultLabel}".`;
  if (f.mode === 'strict') {
    // The release comes at the vault's FIRST heir waiting period, which with
    // several heirs may be another heir's (decided 2026-09-22): the owner's
    // invite screen words it the same way.
    return f.access === 'key'
      ? `${named} The vault appears sealed on your home screen until the first waiting period for an heir ends; opening it then also needs your key.`
      : `${named} The vault appears sealed on your home screen and opens by itself when the first waiting period for an heir ends.`;
  }
  return f.access === 'key'
    ? `${named} The vault appears sealed on your home screen until you open it with your key.`
    : `${named} The vault appears on your home screen, ready to open.`;
}

/** The line under the vault's name on the home screen's sealed card. */
export function sealedCardLine(f: SealedInviteFacts, now: number): string {
  if (f.mode !== 'strict') return f.access === 'key' ? 'Heir · open it with your key' : 'Heir · ready to open';
  if (!f.releaseAt) return 'Heir · waiting for release';
  const ms = new Date(f.releaseAt).getTime() - now;
  if (Number.isNaN(ms)) return 'Heir · sealed';
  if (ms <= 0) return 'Heir · ready to open';
  return `Heir · opens in \u2248 ${formatBlocksDuration(Math.ceil(ms / MS_PER_BLOCK))}`;
}

/** The claim screen's line while the vault is not released to this phone. */
export function notReleasedLine(f: SealedInviteFacts, now: number): string {
  // No countdown: the release comes with the claim, so this is only ever
  // the moment before the next check brings it.
  if (f.mode !== 'strict') return 'Checking whether your vault is ready to open.';
  if (!f.releaseAt) return 'Waiting for the vault owner’s app to report the timelock.';
  const ms = new Date(f.releaseAt).getTime() - now;
  if (Number.isNaN(ms)) return '';
  // Open but not yet released to this device: the next check delivers it.
  // Words true for any vault shape (decided 2026-09-22), matching the home
  // card's "opens in"; they never say whose key it is, nor which heir's
  // waiting period it was (decided 2026-09-22).
  if (ms <= 0) return 'The first waiting period for an heir has ended. Checking for the release.';
  return `The vault opens to you in \u2248 ${formatBlocksDuration(Math.ceil(ms / MS_PER_BLOCK))}.`;
}
