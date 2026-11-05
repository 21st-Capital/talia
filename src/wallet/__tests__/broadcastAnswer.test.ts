/**
 * A broadcast whose answer never came (2026-10-19: a rescue went out
 * and the screen never showed a success message). The screen may say "sent" only on the network's word: a
 * broadcast that answered with its txid, or that txid found on the chain
 * afterwards. Here: which txid to look for, which failures may have sent
 * it anyway, and the look itself, which never waits for ever.
 */
import {
  answerMayBeLost,
  CHAIN_CHECK_MS,
  expectedTxidOf,
  findWalletTx,
  networkHasTx,
  networkTx,
  walletHasTx,
} from '../broadcastAnswer';
import {
  BROADCAST_WATCHDOG_MS,
  NO_BITCOIN_SERVER,
  NO_TESTNET4_SERVER_ANSWERED,
  SYNC_WATCHDOG_MS,
  TESTNET4_BROADCAST_ATTEMPT_MS,
  TESTNET4_SYNC_ATTEMPT_MS,
  __forgetGoodServersForTests,
  broadcastThroughChainServers,
  broadcastWithWatchdog,
} from '../chainServers';
import { BroadcastRefusedError } from '../../bitcoin/psbt/broadcastCheck';
import { TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';
import { signedRescueTx } from '../../testing/signedRescueTx';
import type { WalletTx } from '../../bitcoin/engine/types';

const tx = (txid: string): WalletTx => ({ txid, received: 0, sent: 1, netAmount: -1, confirmed: false });

describe('the txid to look for, read off the signed bytes', () => {
  it('a raw transaction names its own, the witness left out as the network does', () => {
    const s = signedRescueTx();
    expect(expectedTxidOf(s.raw, 'testnet')).toBe(s.txid);
  });

  it('a PSBT names the same txid as the raw transaction it becomes (segwit and taproot)', () => {
    const s = signedRescueTx(7);
    expect(expectedTxidOf(s.psbt, 'testnet')).toBe(s.txid);
    expect(expectedTxidOf(s.psbt, 'testnet')).toBe(expectedTxidOf(s.raw, 'testnet'));
  });

  it('bytes it cannot read name nothing, so nothing can be found and called sent', () => {
    expect(expectedTxidOf(Uint8Array.from([1, 2, 3]), 'testnet')).toBeNull();
    expect(expectedTxidOf(new Uint8Array(0), 'testnet')).toBeNull();
  });
});

describe('which failures may have sent it anyway', () => {
  const refusedConnection = () =>
    Object.assign(new Error('Electrum(message: "Made one or multiple attempts, all errored:\n\t- Connection refused (os error 61)\n")'), {
      code: 'BlockchainElectrum init error',
    });

  it('no answer in time, a connection that broke, no Testnet4 server answering', () => {
    expect(answerMayBeLost(new Error('Broadcast timed out after 90s. Check the server in Settings → Network'))).toBe(true);
    expect(answerMayBeLost(new Error('Electrum(message: "Made one or multiple attempts, all errored:\n")'))).toBe(true);
    expect(answerMayBeLost(new Error('IOError: Broken pipe (os error 32)'))).toBe(true);
    expect(answerMayBeLost(new Error(NO_TESTNET4_SERVER_ANSWERED))).toBe(true);
    expect(answerMayBeLost(refusedConnection())).toBe(true);
  });

  it('never a server that answered with a refusal, nor the app’s own checks (nothing was sent)', () => {
    expect(
      answerMayBeLost(new Error('Electrum(message: "Electrum server error: \\"min relay fee not met, 100 < 141\\"")')),
    ).toBe(false);
    expect(answerMayBeLost(new BroadcastRefusedError({ code: 'foreign-coins' }, 'Nothing was sent.'))).toBe(false);
    // Whatever its words: a refusal of the app's own was never sent.
    expect(answerMayBeLost(new BroadcastRefusedError({ code: 'unreadable' }, 'timed out, os error 61'))).toBe(false);
    expect(answerMayBeLost(new Error(NO_BITCOIN_SERVER))).toBe(false);
    expect(answerMayBeLost(new Error('The signed transaction from 21st Capital could not be read.'))).toBe(false);
  });
});

describe('the look on the chain', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('finds the txid among the vault’s transactions, waiting ones included, in any case', async () => {
    const s = signedRescueTx();
    const view = { listTransactions: async () => [tx('ab'.repeat(32)), tx(s.txid.toUpperCase())] };
    await expect(walletHasTx(view, s.txid)).resolves.toBe(true);
    await expect(networkHasTx(async () => view, s.txid)).resolves.toBe(true);
  });

  it('hands back the vault’s record of it and the view it came from, for the rescue rule', async () => {
    const s = signedRescueTx(3);
    const mine = { ...tx(s.txid), sent: 380_000, fee: 9_917 };
    const view = { listTransactions: async () => [tx('ab'.repeat(32)), mine] };
    await expect(findWalletTx(view, s.txid.toUpperCase())).resolves.toBe(mine);
    await expect(networkTx(async () => view, s.txid)).resolves.toEqual({ view, tx: mine });
    await expect(networkTx(async () => view, 'cd'.repeat(32))).resolves.toBe(false);
    await expect(networkTx(async () => Promise.reject(new Error('Sync timed out')), s.txid)).resolves.toBeNull();
  });

  it('says false when the chain answered without it', async () => {
    await expect(networkHasTx(async () => ({ listTransactions: async () => [tx('cd'.repeat(32))] }), 'ab'.repeat(32))).resolves.toBe(
      false,
    );
  });

  it('says null when the chain could not be asked: a failed sync, or one that never ends', async () => {
    await expect(networkHasTx(async () => Promise.reject(new Error('Sync timed out')), 'ab'.repeat(32))).resolves.toBeNull();

    const settled = jest.fn();
    const look = networkHasTx(() => new Promise(() => {}), 'ab'.repeat(32));
    look.then(settled);
    await jest.advanceTimersByTimeAsync(CHAIN_CHECK_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(null);
  });

  it('a list that never answers after the sync is bounded too', async () => {
    const look = networkHasTx(async () => ({ listTransactions: () => new Promise<WalletTx[]>(() => {}) }), 'ab'.repeat(32), 5_000);
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(look).resolves.toBeNull();
  });
});

describe('the rescue’s broadcast: an answer that never comes ends (the watchdog)', () => {
  beforeEach(() => {
    __forgetGoodServersForTests();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('is given exactly what a sync is given', () => {
    expect(BROADCAST_WATCHDOG_MS).toBe(SYNC_WATCHDOG_MS);
    expect(TESTNET4_BROADCAST_ATTEMPT_MS).toBe(TESTNET4_SYNC_ATTEMPT_MS);
  });

  it('a Bitcoin vault’s one server: an error after 90 seconds, which may have sent it, never another server', async () => {
    const asked: string[] = [];
    const done = broadcastWithWatchdog('bitcoin', { electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } }, (b) => {
      asked.push(b.url);
      return new Promise<string>(() => {});
    });
    const outcome = done.then(
      () => null,
      (e: Error) => e,
    );
    await jest.advanceTimersByTimeAsync(BROADCAST_WATCHDOG_MS - 1);
    expect(asked).toEqual(['ssl://10.0.0.20:50002']);
    await jest.advanceTimersByTimeAsync(1);
    const e = await outcome;
    expect(e?.message).toMatch(/^Broadcast timed out after 90s/);
    expect(answerMayBeLost(e)).toBe(true);
    expect(asked).toEqual(['ssl://10.0.0.20:50002']);
  });

  it('a Testnet4 server that never answers: the next one is asked after its share', async () => {
    const asked: string[] = [];
    const done = broadcastWithWatchdog('testnet', { electrumUrls: {} }, (b) => {
      asked.push(b.url);
      return asked.length === 1 ? new Promise<string>(() => {}) : Promise.resolve('ab'.repeat(32));
    });
    await jest.advanceTimersByTimeAsync(TESTNET4_BROADCAST_ATTEMPT_MS);
    await expect(done).resolves.toBe('ab'.repeat(32));
    expect(asked).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
  });

  it('no Testnet4 server answering at all ends in the 90 seconds, as a failure that may have sent it', async () => {
    const done = broadcastWithWatchdog('testnet', { electrumUrls: {} }, () => new Promise<string>(() => {}));
    const outcome = done.then(
      () => null,
      (e: Error) => e,
    );
    await jest.advanceTimersByTimeAsync(TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length);
    const e = await outcome;
    expect(e?.message).toBe(NO_TESTNET4_SERVER_ANSWERED);
    expect(answerMayBeLost(e)).toBe(true);
  });

  it('a refusal still comes back at once, and is not taken for a lost answer', async () => {
    const asked: string[] = [];
    const refusal = new Error('Electrum(message: "Electrum server error: \\"bad-txns-inputs-missingorspent\\"")');
    const done = broadcastWithWatchdog('testnet', { electrumUrls: {} }, async (b) => {
      asked.push(b.url);
      throw refusal;
    });
    await expect(done).rejects.toBe(refusal);
    expect(asked).toHaveLength(1);
    expect(answerMayBeLost(refusal)).toBe(false);
  });
});

describe('every other broadcast waits for the native answer, as before (decided 2026-10-19)', () => {
  // The watchdog gives up in JavaScript only; the native call goes on, on
  // the queue every sync uses, and the payment can still go out after it.
  // Send, Pending transactions and the refresh session would then say
  // "Could not send" for a payment that went out, and a client who built
  // it again could pay twice. So they keep no JavaScript time limit.
  beforeEach(() => {
    __forgetGoodServersForTests();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('a Bitcoin broadcast whose native answer comes after two minutes: the txid, through the one server', async () => {
    const asked: string[] = [];
    const settled = jest.fn();
    const done = broadcastThroughChainServers('bitcoin', { electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } }, (b) => {
      asked.push(b.url);
      return new Promise<string>((resolve) => setTimeout(() => resolve('ab'.repeat(32)), 120_000));
    });
    done.then(settled, settled);
    await jest.advanceTimersByTimeAsync(BROADCAST_WATCHDOG_MS + 1_000);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(120_000 - BROADCAST_WATCHDOG_MS);
    await expect(done).resolves.toBe('ab'.repeat(32));
    expect(asked).toEqual(['ssl://10.0.0.20:50002']);
  });

  it('a slow Testnet4 server is waited for, and no other is asked', async () => {
    const asked: string[] = [];
    const done = broadcastThroughChainServers('testnet', { electrumUrls: {} }, (b) => {
      asked.push(b.url);
      return new Promise<string>((resolve) => setTimeout(() => resolve('cd'.repeat(32)), 120_000));
    });
    await jest.advanceTimersByTimeAsync(120_000);
    await expect(done).resolves.toBe('cd'.repeat(32));
    expect(asked).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 1));
  });
});
