/**
 * The NEW bridge's contract, call for call (BDK upgrade, decided
 * 2026-10-15): the replacement for bdkBridgeProtocol.test.ts once the
 * old bridge goes (decided 2026-11-04), and under the same rule from the day it is
 * approved: `fixtures/bdkWalletBridgeCalls.json` is RECORDED, never edited, and a
 * difference is looked into, never re-recorded.
 *
 * The recording is real: tier C ran harness/protocolScenario.ts in the iOS
 * simulator against the real TaliaBdkWalletModule (bdk-ffi 3.1.1, the fork's
 * talia-3 line) and regtest bitcoind + electrs, and kept every native call
 * the engine made with the library's real answer, and every answer the
 * engine gave the app (scripts/tier-c/run.py --record). Here the same
 * scenario runs over a native module that replays those answers in order,
 * and must make exactly the same calls, with the same arguments, and give
 * exactly the same answers. Test keys only.
 *
 * The mapping, each of the old engine's 39 calls (bdkBridgeCalls.json)
 * to the new bridge's, checked against both recordings:
 *   createDescriptor x2, memoryDBInit, walletInit       -> openWallet (closeWallet frees it)
 *   initElectrumBlockchain, sync, getBlockchainHeight   -> sync (the tip in its answer)
 *   getBalance -> balance; listTransactions(false) -> transactions
 *   listTransactions(true), serializeTransaction        -> rawTransaction
 *   listUnspent, addressFromScript, addressAsString     -> unspent (the address in each row)
 *   getAddress, getInternalAddress, addressAsString     -> address (keychain, new | lastUnused | index)
 *   initAddress, addressToScriptPubkeyHex, isMine       -> isMine
 *   policiesJson -> policies
 *   createTxBuilder, addUnspendable, addUtxos, manuallySelectedOnly, drainWallet, drainTo,
 *   addRecipient, feeRate, feeAbsolute, enableRbf, policyPath, finish, serialize, txid,
 *   feeAmount (15)                                     -> build (+ policies, read once)
 *   combine -> combine (original first, then the combine repair)
 *   sign (watch-only finalize) -> finalize; serialize, txid after it -> psbtInfo
 *   extractTx, broadcast -> extract, broadcast
 *   createTransaction, transactionTxid, broadcast       -> parseTransaction, broadcast
 *   the connection test's initElectrumBlockchain + getBlockchainHeight -> probeServer
 * BumpFeeTxBuilder and every other bdk-rn call were never the engine's and are not
 * rebuilt. derivationIndex is read only, for tier C and the shadow checks.
 * addressActivity (the address book's check, decided 2026-11-05) came after the
 * recording and had no call in the old engine: the scenario does not ask it, so the
 * recording holds none, and bdkWalletAddressActivity.test.ts reads its shape from
 * the Swift until the simulator harness records it.
 */
import * as fs from 'fs';
import * as path from 'path';

// The build flags decide the spend gate; this test is about the bridge.
jest.mock('../spendGate', () => ({ assertSigningEnabled: () => undefined }));

import { protocolScenario } from '../../../harness/protocolScenario';
import type { ProtocolEntry, ProtocolVaults } from '../../../harness/protocolScenario';
import type { BdkWalletNative } from '../bdkWalletNative';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'bdkWalletBridgeCalls.json'), 'utf8'),
) as { vaults: ProtocolVaults; log: ProtocolEntry[] };

type CallEntry = Extract<ProtocolEntry, { call: string }>;
type ExchangeEntry = Extract<ProtocolEntry, { exchange: string }>;

async function replay(): Promise<{ log: ProtocolEntry[]; problems: string[] }> {
  const calls = fixture.log.filter((e): e is CallEntry => 'call' in e);
  const exchanges = fixture.log.filter((e): e is ExchangeEntry => 'exchange' in e);
  const log: ProtocolEntry[] = [];
  const problems: string[] = [];
  const native = new Proxy({} as BdkWalletNative, {
    get: (_t, name) => {
      if (typeof name !== 'string' || name === 'then') return undefined;
      return async (...args: unknown[]) => {
        const want = calls.shift();
        const entry: CallEntry = { call: name, args: JSON.parse(JSON.stringify(args)) };
        log.push(entry);
        if (!want) {
          problems.push(`an extra call: ${name}`);
          throw new Error('not recorded');
        }
        if (want.call !== name) problems.push(`called ${name}, recorded ${want.call}`);
        if ('error' in want && want.error) {
          entry.error = want.error;
          throw Object.assign(new Error(want.error.message), want.error.code ? { code: want.error.code } : {});
        }
        entry.result = want.result;
        return want.result;
      };
    },
  });
  const exchange = async (name: string, sent: unknown) => {
    const want = exchanges.shift();
    if (!want || want.exchange !== name) problems.push(`exchange ${name} was not recorded here`);
    log.push({ exchange: name, sent, answer: want?.answer });
    return want?.answer;
  };
  await protocolScenario(native, fixture.vaults, exchange, log);
  if (calls.length) problems.push(`${calls.length} recorded calls never made (first: ${calls[0].call})`);
  return { log, problems };
}

describe('the new bridge, call for call', () => {
  it('makes exactly the native calls, and returns exactly the answers, the real library gave', async () => {
    const { log, problems } = await replay();
    expect(problems).toEqual([]);
    expect(log).toEqual(fixture.log);
  });

  it('the recording covers every call the new engine makes', () => {
    const called = new Set(fixture.log.flatMap((e) => ('call' in e ? [e.call] : [])));
    for (const name of [
      'openWallet', 'closeWallet', 'sync', 'balance', 'transactions', 'rawTransaction', 'unspent', 'address', 'isMine',
      'policies', 'build', 'psbtInfo', 'combine', 'finalize', 'extract', 'broadcast', 'parseTransaction', 'probeServer',
    ]) {
      expect(called).toContain(name);
    }
  });

  it('the answers carry the library\'s codes and 0.28\'s words where the app reads them', () => {
    const steps = fixture.log.filter((e): e is Extract<ProtocolEntry, { step: string }> => 'step' in e);
    const byName = (n: string) => steps.find((s) => s.step === n)!;
    expect(byName('a build the library refuses (too little)').error).toMatch(/^Insufficient funds: \d+ sat available of \d+ sat needed$/);
    expect(byName('a coin it does not hold').error).toBe('UTXO not found in the internal database');
    expect(byName('a wrong-network recipient').error).toBeDefined();
    expect(byName('broadcast raw bytes of another transaction').error).toBeDefined();
    expect(byName('rescue on a key the vault does not hold').error).toBe('This vault has no spending path for that key.');
    expect(byName('owns a mainnet address').result).toBe(false);
    expect(byName('complete with the original').result).toMatchObject({ finalized: true });
    // The layered vault's first try asks for a path, by its code; the engine retried.
    const codes = fixture.log.flatMap((e) => ('call' in e && e.error ? [e.error.code] : []));
    expect(codes).toContain('SPENDING_POLICY_REQUIRED');
  });
});
