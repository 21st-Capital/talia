/**
 * Did a broadcast reach the network when its answer never came back?
 * (2026-10-19, after a testnet rescue: the broadcast went out and the
 * screen never showed a success message.)
 *
 * A broadcast's answer can be lost after the transaction went out: the
 * phone's connection drops or switches, or the server's reply never
 * arrives and the watchdog gives up (wallet/chainServers.ts
 * `BROADCAST_WATCHDOG_MS`). The coins have moved, and "Could not
 * broadcast" would be wrong. So the screen asks the chain: a fresh sync of
 * the vault through its OWN servers (a Bitcoin vault's one server, never
 * another; Testnet4's built-in list) and a look for the transaction's id
 * among the vault's transactions, waiting ones included (Electrum lists
 * the mempool). Found means sent. Not found, or the chain could not be
 * asked, means the client may try again: sending the same signed
 * transaction a second time is harmless, the network knows it by its txid.
 *
 * Never shows "sent" on a guess: only a broadcast that answered with its
 * txid, or that txid found on the chain servers afterwards.
 */
import type { Network } from '../bitcoin/descriptor/types';
import type { WalletEngine, WalletTx } from '../bitcoin/engine/types';
import { encodeBase64, looksLikePsbt } from '../bitcoin/psbt/export';
import { BroadcastRefusedError, psbtTxShape, rawTxShape } from '../bitcoin/psbt/broadcastCheck';
import { NO_TESTNET4_SERVER_ANSWERED, SYNC_WATCHDOG_MS, serverUnreachable } from './chainServers';
import { withTimeout } from './withTimeout';

/**
 * The txid the network will know this signed transaction by, read off the
 * bytes before it goes out; null when they cannot be read.
 *
 * A raw transaction carries its own. A PSBT names its unsigned
 * transaction, whose txid is the final one for every segwit and taproot
 * spend (witnesses are not part of a txid), which is every vault Talia
 * builds. A nested-segwit or legacy input carries its signature in the
 * scriptSig and changes the txid: the look on the chain then finds
 * nothing and the client is asked to try again, never told it went out.
 */
export function expectedTxidOf(signed: Uint8Array, network: Network): string | null {
  const shape = looksLikePsbt(signed) ? psbtTxShape(encodeBase64(signed)) : rawTxShape(signed, network);
  const txid = shape?.txid?.toLowerCase() ?? '';
  return /^[0-9a-f]{64}$/.test(txid) ? txid : null;
}

/**
 * May the transaction have gone out although the broadcast failed? When
 * no answer came (a timeout, the native one or the watchdog's), a server
 * could not be reached or the connection broke, or no Testnet4 server
 * answered. Not when a server ANSWERED with a refusal (the network's
 * word, "Electrum server error"), nor for the app's own checks, which
 * throw before anything is sent (BroadcastRefusedError, a missing server).
 */
export function answerMayBeLost(e: unknown): boolean {
  if (e instanceof BroadcastRefusedError) return false;
  const message = e instanceof Error ? e.message : String(e ?? '');
  return message === NO_TESTNET4_SERVER_ANSWERED || serverUnreachable(e);
}

/**
 * What the client reads for a broadcast that reached no server (decided
 * 2026-10-30): a title, or a coin's reason, in plain words on every network,
 * never the library's text. Null when a server answered or nothing was sent
 * to one: the caller's own words stand. The rescue looks on the chain
 * instead (`networkTx`).
 */
export const SERVER_NOT_REACHED = 'Could not reach the server';

export function notReachedWords(e: unknown): string | null {
  if (!answerMayBeLost(e)) return null;
  return e instanceof Error && e.message === NO_TESTNET4_SERVER_ANSWERED ? e.message : SERVER_NOT_REACHED;
}

/** The vault's own record of this txid, waiting ones included, or null. */
export async function findWalletTx(
  view: Pick<WalletEngine, 'listTransactions'>,
  txid: string,
): Promise<WalletTx | null> {
  const want = txid.toLowerCase();
  return (await view.listTransactions()).find((t) => t.txid.toLowerCase() === want) ?? null;
}

/** Is this txid among the vault's transactions, waiting ones included? */
export async function walletHasTx(view: Pick<WalletEngine, 'listTransactions'>, txid: string): Promise<boolean> {
  return (await findWalletTx(view, txid)) != null;
}

/** How long the look on the chain may take: one sync's watchdog. */
export const CHAIN_CHECK_MS = SYNC_WATCHDOG_MS;

/**
 * Does the network have this transaction? `look` syncs the vault through
 * its own servers and hands back its view. The view and the vault's record
 * of the transaction when the txid is there (what the rescue rule then
 * checks, `checkRescueOnChain`), false when the chain answered without it,
 * null when the chain could not be asked in time. Never throws, never
 * waits longer than `ms`.
 */
export async function networkTx<V extends Pick<WalletEngine, 'listTransactions'>>(
  look: () => Promise<V>,
  txid: string,
  ms: number = CHAIN_CHECK_MS,
): Promise<{ view: V; tx: WalletTx } | false | null> {
  try {
    return await withTimeout(
      (async () => {
        const view = await look();
        const tx = await findWalletTx(view, txid);
        return tx ? { view, tx } : (false as const);
      })(),
      ms,
      'Checking the network',
    );
  } catch {
    return null;
  }
}

/** `networkTx` as a yes, a no, or null when the chain could not be asked. */
export async function networkHasTx(
  look: () => Promise<Pick<WalletEngine, 'listTransactions'>>,
  txid: string,
  ms: number = CHAIN_CHECK_MS,
): Promise<boolean | null> {
  const found = await networkTx(look, txid, ms);
  return found === null ? null : found !== false;
}
