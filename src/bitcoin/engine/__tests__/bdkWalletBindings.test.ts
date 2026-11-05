/**
 * Every library call the Swift bridge makes on an Electrum client exists in
 * the generated bindings the app builds with (decided 2026-11-05). CI builds
 * no Swift, so a bridge that calls a method the bindings do not have yet (a
 * fork change not rebuilt into native/bdkwallet) stays green in jest and tsc
 * and fails only in Xcode, for every iOS build. This turns that into a red
 * test. The bridge, the bindings (`BitcoinDevKit.swift`, its C header) and
 * the library they were generated from move together, in one change: the
 * bindings check each method's checksum against the library at start-up.
 */
import fs from 'fs';
import path from 'path';

const native = path.join(__dirname, '..', '..', '..', '..', 'native', 'bdkwallet');
const stripComments = (text: string) => text.replace(/\/\/.*$/gm, '');
const bridge = stripComments(fs.readFileSync(path.join(native, 'bridge', 'TaliaBdkWalletModule.swift'), 'utf8'));
const bindings = fs.readFileSync(path.join(native, 'BitcoinDevKit.swift'), 'utf8');

/** The ElectrumClient class of the bindings, from its declaration to its converter. */
function electrumClientClass(): string {
  const start = bindings.indexOf('open class ElectrumClient:');
  const end = bindings.indexOf('public struct FfiConverterTypeElectrumClient', start);
  expect({ start: start >= 0, end: end > start }).toEqual({ start: true, end: true });
  return bindings.slice(start, end);
}

describe('the bridge and the bindings', () => {
  it('every ElectrumClient method the bridge calls is in BitcoinDevKit.swift', () => {
    // In the bridge `client` always holds an ElectrumClient.
    for (const m of bridge.matchAll(/\b(?:let|var) client(?:: (\w+))? =?/g)) {
      if (m[1]) expect(m[1]).toBe('ElectrumClient');
    }
    const called = [...new Set([...bridge.matchAll(/\bclient\.(\w+)\(/g)].map((m) => m[1]))].sort();
    // The calls a sync, a broadcast and the connection test make: the scan is reading the bridge.
    expect(called).toEqual(expect.arrayContaining(['blockHeader', 'blockHeadersSubscribe', 'fullScan', 'sync', 'transactionBroadcast']));
    const klass = electrumClientClass();
    const missing = called.filter((name) => !klass.includes(`open func ${name}(`));
    expect(missing).toEqual([]);
  });
});
