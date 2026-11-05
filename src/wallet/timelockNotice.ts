/**
 * The recovery-path notice, in ONE set of words for the home screen and the
 * vault page (decided 2026-09-22: "Why is the sentence different when I am inside
 * the vault compared to the home screen?", and "a sentence that holds true
 * in any scenario is always better").
 *
 * The vault page used to guess whose key the open path holds: on an heir's
 * phone it said "Your key can spend at least one coin now". That is wrong
 * whenever the heir's key sits on the everyday path and the path that opened
 * is 21st Capital's rescue key (seen on a 2-of-3 test vault). "A recovery
 * path is open" is true for every shape and every phone.
 *
 * "Refresh recommended" is added only where it is true: for the vault's
 * owner. On an heir's phone a refresh can restart the very lock their access
 * waits on, and Talia offers them none.
 *
 * Pure: no native, no storage.
 */
import { formatBlocksDuration } from './timelock';

export interface TimelockNoticeInput {
  /** Blocks until the first recovery path opens; 0 or less = open now. */
  blocks: number;
  /** The vault's name, on the home screen; left out inside the vault. */
  vaultLabel?: string;
  /** Add "Refresh recommended." to an open path (the owner's phone). */
  refreshAdvised: boolean;
}

export function timelockNotice({ blocks, vaultLabel, refreshAdvised }: TimelockNoticeInput): string {
  const where = vaultLabel ? ` in “${vaultLabel}”` : '';
  if (blocks <= 0) {
    return `A recovery path is open${where}.${refreshAdvised ? ' Refresh recommended.' : ''}`;
  }
  return `A recovery path${where} opens in ≈ ${formatBlocksDuration(blocks)}.`;
}

/**
 * A coin's chip on the coin list, in the notice's words: the same state
 * reads the same everywhere (decided 2026-09-22: the chip said "expires in"
 * where the notice says "opens in", and advised heirs to refresh).
 */
export function coinTimelockChip(blocks: number | null | undefined, refreshAdvised: boolean): string {
  if (blocks == null) return 'Clock starts after confirmation';
  if (blocks <= 0) return `Recovery path open${refreshAdvised ? ', refresh recommended' : ''}`;
  return `Recovery path opens in \u2248 ${formatBlocksDuration(blocks)}`;
}

/** What a refresh does, one ⓘ for Send and the signing screen; true for any
 *  vault shape (it never says whose keys the recovery paths hold). */
export const REFRESH_EXPLAINER =
  'The selected coins move to new addresses of this same vault. Only the network fee leaves it. Each coin\u2019s clock starts again once its transaction confirms.';
