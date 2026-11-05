/**
 * The mark the new bridge puts on a connection it could not open (decided
 * 2026-10-30), held to the Swift and to the contract recording. The Swift runs
 * only in the simulator (tier C's network rules prove it there), so its shape
 * is read here, as bdkWalletSyncParameters.test.ts reads its constants.
 *
 * electrum-client opens the connection in its constructor: the TCP connection,
 * the TLS handshake and a `server.version` question, so the constructor is
 * where a server turns a connection away ("unexpected end of file" is rustls
 * meeting the end of the stream in that handshake) and also where a server can
 * ANSWER with an error of its own, which must never read as unreachable.
 *
 * The recording (fixtures/bdkWalletBridgeCalls.json) is never edited, and it
 * holds the connection test against a port nobody listens on, rejected OTHER
 * with the library's words. Nothing decides on that code, so the connection
 * test keeps answering it and the recording stays true of the bridge.
 */
import fs from 'fs';
import path from 'path';
import type { ProtocolEntry } from '../../../harness/protocolScenario';

const swift = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'native', 'bdkwallet', 'bridge', 'TaliaBdkWalletModule.swift'),
  'utf8',
);
const code = swift.replace(/\/\/.*$/gm, '');
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'bdkWalletBridgeCalls.json'), 'utf8'),
) as { log: ProtocolEntry[] };

/** The source of one Swift function, from its name to the next at its own depth. */
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

describe('the bridge marks a connection it could not open', () => {
  const marking = func('private func client(_ s: ServerSettings) throws -> ElectrumClient');

  it('where the connection is opened, with the words the app always read', () => {
    expect(marking).toMatch(/try ElectrumClient\(url:/);
    expect(marking).toMatch(/catch let e as ElectrumError where neverConnected\(e\)/);
    expect(marking).toMatch(/BridgeError\(code: "SERVER_UNREACHABLE", message: describe\(e\)\.message\)/);
  });

  it('only for what cannot be an answer: a server that answered keeps its own error', () => {
    const list = /case ([^:]+): return true/.exec(func('private func neverConnected(_ e: ElectrumError) -> Bool'))![1];
    expect(list.split(',').map((c) => c.trim()).sort()).toEqual([
      '.AllAttemptsErrored',
      '.CouldNotCreateConnection',
      '.InvalidDnsNameError',
      '.IoError',
      '.MissingDomain',
      '.SharedIoError',
    ]);
    for (const answered of ['.Protocol', '.InvalidResponse', '.Json', '.Bitcoin', '.Hex', '.Message']) {
      expect(list).not.toContain(answered);
    }
  });

  it('a sync, a broadcast, the server\'s blocks and the address book\'s check all open through it', () => {
    expect(func('private func serverClient(_ server: NSDictionary) throws -> ElectrumClient')).toMatch(/try client\(try serverSettings\(server\)\)/);
    expect(func('func broadcast(')).toMatch(/try self\.serverClient\(server\)/);
    expect(func('func addressActivity(')).toMatch(/try self\.serverClient\(server\)/);
    expect(func('func sync(')).toMatch(/try self\.client\(settings\)/);
    expect(func('func serverBlocks(')).toMatch(/try self\.client\(settings\)/);
    // There is no other way in.
    expect(code.match(/ElectrumClient\(url:/g)).toHaveLength(1);
  });

  it('a broadcast answers the id of what went out, not the one the server typed back', () => {
    const broadcast = func('func broadcast(');
    expect(broadcast).toMatch(/let txid = tx\.computeTxid\(\)\.description/);
    expect(broadcast).toMatch(/return txid/);
  });
});

describe('the connection test keeps the answer the recording holds', () => {
  const failed = fixture.log.filter(
    (e): e is Extract<ProtocolEntry, { call: string }> => 'call' in e && e.call === 'probeServer' && !!e.error,
  );

  it('the recording has it rejected OTHER, in the library\'s words', () => {
    expect(failed.map((e) => e.error)).toEqual([
      { code: 'OTHER', message: 'Electrum client error: Made one or multiple attempts, all errored' },
    ]);
  });

  it('so it hands the mark back as that code, its words untouched', () => {
    const probe = func('func probeServer(');
    expect(probe).toMatch(/reject\(d\.code == "SERVER_UNREACHABLE" \? "OTHER" : d\.code, d\.message, nil\)/);
  });

  it('no call the recording holds was marked or would be: only the connection test ever failed to connect', () => {
    const rejected = fixture.log.flatMap((e) => ('call' in e && e.error ? [e] : []));
    expect(rejected.map((e) => e.error?.code)).not.toContain('SERVER_UNREACHABLE');
    for (const e of rejected) {
      if (e.call === 'sync' || e.call === 'broadcast' || e.call === 'serverBlocks') expect(e.error?.message).not.toMatch(/Electrum client error/);
    }
  });
});
