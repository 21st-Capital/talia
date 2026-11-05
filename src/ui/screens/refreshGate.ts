/**
 * Where Talia offers a refresh, in ONE place: the coin list's button, the
 * vault page's Tools entry and the tap on the recovery-path notice ask the
 * same question (decided 2026-09-22: Tools listed "Refresh coins" on phones
 * whose coin list had no refresh button, a dead end).
 *
 * Never on an heir's phone: a refresh can restart the timelock their own
 * access waits on. Never on a vault with no timelock either: there is no
 * clock to restart, and the coin list shows no refresh button for it (decided
 * 2026-09-22: Tools still listed "Refresh coins" on a plain multisig or
 * single-sig vault). Otherwise exactly where Send is open, because a refresh
 * is a spend back into the vault.
 */
import { HWW_ENABLED, LEDGER_PREVIEW, SIGNING_ENABLED } from '../../config';
import { minOlderBlocks } from '../../bitcoin/descriptor';
import { sendAccess } from '../../wallet';
import type { WalletMeta } from '../../wallet/types';

export function refreshOffered(wallet: WalletMeta | null | undefined, providerFps?: ReadonlySet<string>): boolean {
  if (!wallet || wallet.heirVault) return false;
  if (minOlderBlocks(wallet.descriptor) == null) return false;
  return SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED && sendAccess(wallet, providerFps) === 'ready');
}
