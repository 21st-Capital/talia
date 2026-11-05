/**
 * The bridge's address-book lookup, `addressActivity` (decided 2026-11-05),
 * held to the Swift and to its React Native export. The Swift runs only in
 * the simulator and on a phone, so its shape is read from the source here, as
 * bdkWalletConnectionMark.test.ts and bdkWalletSyncParameters.test.ts read
 * theirs. What a server answers for a script is the library fork's own test
 * (bdk-ffi's src/tests/electrum_script.rs); the bridge's answers against a
 * real server are the simulator harness's (tier C) once the library is
 * rebuilt from the fork. The contract recording (fixtures/bdkWalletBridgeCalls.json)
 * is never edited by hand and holds no step for this call.
 *
 * The rules read here:
 *   - On chainQueue like the connection test, never on walletQueue: the
 *     lookup touches no wallet and never waits behind a vault's sync.
 *   - The one server handed in (wallet/chainServers.ts chose it), through a
 *     short-lived client that `client(_:)` opens, so a connection that could
 *     not be opened is marked SERVER_UNREACHABLE as a sync's or a
 *     broadcast's is; never a vault's kept connection.
 *   - The address is parsed for the network handed in before anything is
 *     asked.
 *   - The history first; at most 50 entries are fetched whole in ONE batch
 *     on the same client ('txs'), more are answered with the coins the address
 *     holds, asked after the history ('long'): three round trips at most.
 *   - The last question is asked only within ADDRESS_ACTIVITY_LAST_ASK_S, so
 *     its own 8 s timeout ends the call inside the 20 s the wallet layer gives
 *     each server (wallet/chainServers.ts ADDRESS_LOOKUP_ATTEMPT_MS).
 *   - Facts only, in the shape wallet/addressBookCheck.ts reads.
 */
import fs from 'fs';
import path from 'path';

import { ADDRESS_LOOKUP_ATTEMPT_MS } from '../../../wallet/chainServers';
import { ADDRESS_LOOKUP_TIMEOUT_S } from '../bdkWalletRules';

const bridge = path.join(__dirname, '..', '..', '..', '..', 'native', 'bdkwallet', 'bridge');
const stripComments = (text: string) => text.replace(/\/\/.*$/gm, '');
const code = stripComments(fs.readFileSync(path.join(bridge, 'TaliaBdkWalletModule.swift'), 'utf8'));
const objc = stripComments(fs.readFileSync(path.join(bridge, 'TaliaBdkWalletModule.m'), 'utf8'));
const nativeTs = fs.readFileSync(path.join(__dirname, '..', 'bdkWalletNative.ts'), 'utf8');

/** The source of one Swift function, from its name to the brace that closes it. */
function func(signature: string): string {
  const start = code.indexOf(signature);
  expect({ signature, found: start >= 0 }).toEqual({ signature, found: true });
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`${signature} never closes`);
}

function constant(name: string): string {
  const m = new RegExp(`^private let ${name}(?:: [A-Za-z0-9]+)? = (.+)$`, 'm').exec(code);
  if (!m) throw new Error(`no constant ${name}`);
  return m[1].trim();
}

/** Every selector the Swift exposes to Objective-C, the class's own name aside. */
function swiftSelectors(): string[] {
  return [...code.matchAll(/@objc\(([A-Za-z]+:[A-Za-z:]*)\)/g)].map((m) => m[1]).sort();
}

/** Every selector the .m exports: RCT_EXTERN_METHOD(first:(type)arg label:(type)arg ...). */
function exportedSelectors(): string[] {
  return [...objc.matchAll(/RCT_EXTERN_METHOD\(([\s\S]*?)\)\s*$/gm)]
    .map((m) => [...m[1].matchAll(/([A-Za-z]+):\(/g)].map((p) => `${p[1]}:`).join(''))
    .sort();
}

describe('the export', () => {
  it('every method the Swift exposes is exported by the .m, selector for selector', () => {
    // The .m's header: a selector that does not match is dropped without a word.
    const swift = swiftSelectors();
    expect(swift).toContain('addressActivity:network:address:resolver:rejecter:');
    expect(exportedSelectors()).toEqual(swift);
  });

  it('the engine hands the arguments over in the Swift\'s order: server, network, address', () => {
    expect(nativeTs).toMatch(
      /addressActivity\?\(server: NativeServer, network: NativeNetwork, address: string\): Promise<AddressActivity>;/,
    );
    expect(func('func addressActivity(')).toMatch(
      /func addressActivity\(\s*_ server: NSDictionary, network: String, address: String,\s*resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock\s*\)/,
    );
  });
});

describe('addressActivity', () => {
  const lookup = func('func addressActivity(');

  it('runs on chainQueue, never on the wallet queue, and touches no wallet', () => {
    expect(lookup).toMatch(/\)\s*\{\s*chainQueue\.async \{/);
    for (const wallet of ['walletQueue', 'withWallet(', 'run(resolve', 'self.wallets', 'state.', 'kept']) {
      expect(lookup).not.toContain(wallet);
    }
    // The queue's own note names both calls that run there.
    expect(fs.readFileSync(path.join(bridge, 'TaliaBdkWalletModule.swift'), 'utf8')).toContain(
      'only probeServer and addressActivity, which touch no\n//    wallet, run on chainQueue.',
    );
  });

  it('asks the one server handed in, through a short-lived client opened where the mark is put', () => {
    expect(lookup.match(/let client = try self\.serverClient\(server\)/g)).toHaveLength(1);
    expect(lookup).not.toMatch(/ElectrumClient\(|self\.client\(/);
    // Every call on the server goes through that one client.
    const asked = [...lookup.matchAll(/(\w+)\.(scriptGetHistory|scriptListUnspent|batchTransactionGet|fetchTx)\(/g)];
    expect(asked.length).toBeGreaterThanOrEqual(3);
    for (const a of asked) expect(a[1]).toBe('client');
  });

  it('parses the network and the address before it connects', () => {
    const network = lookup.indexOf('let net = try parseNetwork(network)');
    const address = lookup.indexOf('Address(address: address.trimmingCharacters(in: .whitespaces), network: net)');
    const connect = lookup.indexOf('try self.serverClient(server)');
    expect(network).toBeGreaterThan(0);
    expect(address).toBeGreaterThan(network);
    expect(connect).toBeGreaterThan(address);
    // An address of another network is refused as an argument, never asked about.
    expect(lookup.slice(address, connect)).toContain('throw bad(');
    expect(lookup).toContain('let script = a.scriptPubkey()');
  });

  it('asks the history first, then its transactions in one batch up to 50, or the coins after the history above', () => {
    expect(Number(constant('ADDRESS_ACTIVITY_WHOLE_MAX'))).toBe(50);
    const history = lookup.indexOf('let history = try client.scriptGetHistory(script: script)');
    const late = lookup.indexOf('ProcessInfo.processInfo.systemUptime - started > ADDRESS_ACTIVITY_LAST_ASK_S');
    const long = lookup.indexOf('if history.count > ADDRESS_ACTIVITY_WHOLE_MAX {');
    const unspent = lookup.indexOf('let unspent = try client.scriptListUnspent(script: script)');
    const whole = lookup.indexOf('let fetched = try client.batchTransactionGet(txids: history.map { $0.txid })');
    expect(history).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(history);
    expect(long).toBeGreaterThan(late);
    expect(unspent).toBeGreaterThan(long);
    expect(whole).toBeGreaterThan(unspent);
    expect(lookup.match(/scriptGetHistory\(/g)).toHaveLength(1);
    expect(lookup.match(/scriptListUnspent\(/g)).toHaveLength(1);
    // One batch for the whole history, never one request per transaction.
    expect(lookup.match(/batchTransactionGet\(/g)).toHaveLength(1);
    expect(lookup).not.toContain('fetchTx(');
    // The long answer returns before any transaction is fetched.
    expect(lookup.slice(long, whole)).toMatch(/resolve\([\s\S]*\n\s*return\n/);
    expect(lookup.slice(long, whole)).toContain('"kind": "long"');
    // Every transaction asked for, each the one asked for, in the history's order.
    expect(lookup).toContain('guard fetched.count == history.count else {');
    expect(lookup).toMatch(/for \(h, tx\) in zip\(history, fetched\) \{/);
    expect(lookup).toContain('guard tx.computeTxid() == h.txid else {');
  });

  it('asks its last question only while it can still end inside the wallet layer\'s 20 seconds', () => {
    // The clock starts as the call leaves the queue; the last question (the
    // transactions, or the coins) is refused after 11 s, so its 8 s timeout
    // (bdkWalletRules.ts ADDRESS_LOOKUP_TIMEOUT_S) ends the call by 19 s.
    expect(Number(constant('ADDRESS_ACTIVITY_LAST_ASK_S'))).toBe(11);
    expect((Number(constant('ADDRESS_ACTIVITY_LAST_ASK_S')) + ADDRESS_LOOKUP_TIMEOUT_S) * 1000).toBeLessThan(
      ADDRESS_LOOKUP_ATTEMPT_MS,
    );
    expect(lookup).toMatch(/chainQueue\.async \{\s*let started = ProcessInfo\.processInfo\.systemUptime/);
    // An empty history asks nothing more, so it is answered whenever it comes.
    expect(lookup).toContain(
      'if !history.isEmpty && ProcessInfo.processInfo.systemUptime - started > ADDRESS_ACTIVITY_LAST_ASK_S {',
    );
    expect(lookup).toContain('throw BridgeError(code: "OTHER", message: "The server took too long to answer about this address")');
  });

  it('answers facts only, in the shape the wallet layer reads', () => {
    const keys = new Set([...lookup.matchAll(/"(\w+)":/g)].map((m) => m[1]));
    expect([...keys].sort()).toEqual(['height', 'history', 'kind', 'pays', 'spends', 'txid', 'txs', 'unspent', 'vout']);
    expect(lookup).toContain('"history": history.map { h -> [String: Any] in ["txid": h.txid.description, "height": h.height] }');
    expect(lookup).toContain(
      '"unspent": unspent.map { u -> [String: Any] in ["txid": u.txid.description, "vout": u.vout, "height": u.height] }',
    );
    // Every coin a transaction spends as "<txid>:<vout>", and the outputs paying the address by their script.
    expect(lookup).toContain('"\\(i.previousOutput.txid.description):\\(i.previousOutput.vout)"');
    expect(lookup).toContain('for (vout, o) in tx.output().enumerated() where o.scriptPubkey.toBytes() == paid {');
    expect(lookup).toContain('let paid = script.toBytes()');
    expect(lookup).toContain('txs.append(["txid": h.txid.description, "height": h.height, "spends": spends, "pays": pays])');
    expect(lookup).toContain('resolve(["kind": "txs", "txs": txs] as [String: Any])');
    // No verdict is decided here.
    expect(lookup).not.toMatch(/"(spent|notFound|unknown|verdict)"/);
  });

  it('rejects with the codes of a sync or a broadcast: the connection test\'s exception is not copied', () => {
    expect(lookup).toMatch(/catch \{\s*let d = describe\(error\)\s*reject\(d\.code, d\.message, nil\)\s*\}/);
    expect(lookup).not.toContain('"SERVER_UNREACHABLE" ? "OTHER"');
  });
});
