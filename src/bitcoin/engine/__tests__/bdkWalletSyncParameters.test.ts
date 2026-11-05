/**
 * The new bridge's sync parameters (TaliaBdkWalletModule.swift), held to the
 * BDK upgrade's rules and to the sync times the shadow week measured (decided
 * 2026-10-15 and 2026-10-25). The Swift runs only in the
 * simulator (tier C) and on a phone, so its constants and the shape of its
 * sync are read from the source here; what the sync FINDS is tier C's to
 * prove (the library fork's scenarios and the coverage steps, both engines).
 *
 *   - The stop gap and every wallet's least lookahead stay 150 (never
 *     below 130, and the batch size is the first thing tuned).
 *   - 200 scripts per round trip (it was 25): a keychain's scan to its last
 *     use plus the stop gap takes one round trip, or two past index 49.
 *     bdk_electrum stops reading a batch's answers where the stop gap ends,
 *     so the scan finds what it found before; the scratch wallet is NOT
 *     stretched past the previous sync's target to save the coverage pass
 *     (tried 2026-10-25: a scan revealed to 49 reached index 199 and found a
 *     first coin at 180 the stop gap of 150 does not reach, which changed
 *     what the engine finds; tier C's used_180_and_299 showed it).
 *   - The coverage rule (decided 2026-10-17) is unchanged, and a pass starts
 *     from the full scan's chain, not from genesis (one round trip less).
 *   - The fees of every transaction stay bdk_electrum's own
 *     (`fetchPrevTxouts: true` on every request).
 *   - A vault's connection is kept between its syncs (decided 2026-10-25,
 *     `KeptClient`): the library's client holds the transactions, headers
 *     and proofs it fetched, so a later sync asks the server again only for
 *     the script histories, as 0.28's in-memory database lets it. In memory
 *     only (decided 2026-10-15), one per vault, the same server and settings only, at most
 *     KEEP_CLIENT_S after the last good sync, dropped by any failure and by
 *     a panic's recreate; a kept one that fails before its timeout gives way
 *     to one new connection. Broadcasts and the connection test keep their
 *     own short-lived clients.
 *   - A sync on a kept connection is kept only when a block of the last
 *     sync's window (the top 8 blocks, which bdk_electrum fetches again at
 *     every sync) is still the server's at its height in the new sync's
 *     window (decided 2026-10-28): the client caches headers by height, so a
 *     block replaced deeper than that window gave a transaction a block no
 *     longer on the chain (tier C's reorg suite, 8 to 10 blocks deep).
 *     Otherwise the sync runs again on a new connection before anything of
 *     the vault changes.
 */
import fs from 'fs';
import path from 'path';

const swift = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'native', 'bdkwallet', 'bridge', 'TaliaBdkWalletModule.swift'),
  'utf8',
);
const code = swift.replace(/\/\/.*$/gm, '');

function constant(name: string): string {
  const m = new RegExp(`^private let ${name}(?:: [A-Za-z0-9]+)? = (.+)$`, 'm').exec(code);
  if (!m) throw new Error(`no constant ${name}`);
  return m[1].trim();
}

describe('the new bridge syncs with', () => {
  it('a stop gap and least lookahead of 150, never below 130', () => {
    expect(Number(constant('GAP'))).toBe(150);
    expect(Number(constant('GAP'))).toBeGreaterThanOrEqual(130);
  });

  it('200 scripts per round trip', () => {
    expect(Number(constant('BATCH'))).toBe(200);
    // Every request uses it: the full scan and each coverage pass.
    expect(code.match(/batchSize: BATCH/g)).toHaveLength(2);
    expect(code).not.toMatch(/batchSize: (?!BATCH)/);
  });

  it('the scan scratch wallet is stretched only to the previous sync\'s target, as before', () => {
    expect(code).toContain('scanReveal[k] = max(carried[k] ?? -1, target(k, state.lastUsed) - Int64(GAP))');
    expect(code).not.toContain('FIRST_BATCH_REVEAL');
    expect(code).toContain('let scan = try state.fresh(lookahead: GAP, reveal: scanReveal)');
    expect(code).toContain('finalReveal[k] = max(carried[k] ?? -1, used[k] ?? -1)');
    expect(code).toContain('covered[k] = min(MAX_INDEX, max(revealedNow, scanReveal[k] ?? -1) + Int64(GAP))');
  });

  it('the coverage rule\'s target is unchanged: max(99, the other keychain\'s last use + 150)', () => {
    expect(Number(constant('COVERAGE_FLOOR'))).toBe(99);
    expect(code).toContain('return min(MAX_INDEX, max(COVERAGE_FLOOR, (used[other(k)] ?? -1) + Int64(GAP)))');
    expect(code).toContain('let short = keychains.filter { target($0, used) > (covered[$0] ?? -1) }');
  });

  it('a coverage pass starts from the full scan\'s chain', () => {
    const pass = code.slice(code.indexOf('let extra = try state.fresh(lookahead: 1, reveal: reveal)'));
    expect(pass.indexOf('try extra.applyUpdate(update: fullScan)')).toBeGreaterThan(0);
    expect(pass.indexOf('try extra.applyUpdate(update: fullScan)')).toBeLessThan(pass.indexOf('client.sync('));
  });

  it('keeps bdk_electrum\'s own previous outputs for every fee', () => {
    expect(code.match(/fetchPrevTxouts: true/g)).toHaveLength(2);
    expect(code).not.toContain('fetchPrevTxouts: false');
  });
});

describe('the new bridge keeps a vault\'s connection between its syncs', () => {
  const sync = code.slice(code.indexOf('func sync('), code.indexOf('private func syncPasses('));

  it('for 120 seconds after its last good sync, to the same server and settings only', () => {
    expect(Number(constant('KEEP_CLIENT_S'))).toBe(120);
    expect(sync).toContain('let kept = state.kept');
    expect(sync).toContain('if let k = kept, k.key == settings.key, started.timeIntervalSince(k.lastUsed) < KEEP_CLIENT_S {');
    expect(code).toMatch(/var key: String \{ "\\\(url\) .*\\\(validate\)" \}/);
  });

  it('kept again only after a sync that succeeded; dropped by a panic\'s recreate and with the wallet', () => {
    const dropped = sync.indexOf('state.kept = nil');
    const passes = sync.indexOf('outcome = try self.syncPasses(state, client)');
    const keptAgain = sync.indexOf('state.kept = KeptClient(key: settings.key, client: client, lastUsed: Date(), window: window)');
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThan(passes);
    expect(keptAgain).toBeGreaterThan(passes);
    const recreate = code.slice(code.indexOf('func recreate()'), code.indexOf('func requireSynced()'));
    expect(recreate).toContain('kept = nil');
    // In memory only: the wallet's persister, and the client lives in WalletState, freed by closeWallet.
    expect(code).toContain('let persister = try Persister.newInMemory()');
    expect(code).toContain('return self.wallets.removeValue(forKey: id) != nil');
  });

  it('a kept connection that fails before its timeout gives way to ONE new one; a server\'s answer never does', () => {
    expect(sync).toMatch(
      /catch let e as ElectrumError\s+where reused && !serverAnswered\(e\) && Date\(\)\.timeIntervalSince\(started\) < Double\(settings\.timeout \?\? 30\)/,
    );
    // Once at first, once after a closed kept connection, once after the chain moved under it.
    expect(sync.match(/try self\.syncPasses\(state, client\)/g)).toHaveLength(3);
    expect(code).toMatch(/case \.Protocol, \.InvalidResponse: return true/);
  });

  it('broadcasts and the connection test keep their own short-lived clients', () => {
    const broadcast = code.slice(code.indexOf('func broadcast('), code.indexOf('func parseTransaction('));
    const probe = code.slice(code.indexOf('func probeServer('), code.indexOf('#if DEBUG', code.indexOf('func probeServer(')));
    for (const network of [broadcast, probe]) {
      expect(network.match(/let client = try self\.serverClient\(server\)/g)).toHaveLength(1);
      expect(network).not.toContain('kept');
    }
  });
});

describe('a kept connection and a reorganisation of the chain (decided 2026-10-28)', () => {
  const sync = code.slice(code.indexOf('func sync('), code.indexOf('private func syncPasses('));
  const outcome = code.slice(code.indexOf('private struct SyncOutcome'), code.indexOf('private func headerHash('));

  it('the window is the 8 blocks bdk_electrum fetches again at every sync, read from the new sync\'s own chain', () => {
    expect(Number(constant('FRESH_WINDOW'))).toBe(8);
    expect(outcome).toContain('let low = tip.height >= FRESH_WINDOW - 1 ? tip.height - (FRESH_WINDOW - 1) : 0');
    expect(outcome).toContain('for cp in try wallet.checkpoints() where cp.height >= low && cp.height <= tip.height {');
    // One block of the last window still there is enough: nothing at or below it changed.
    expect(outcome).toContain('return earlier.contains { height, hash in now[height] == hash }');
  });

  it('a sync on a kept connection whose window did not survive runs again on a new one, before the vault changes', () => {
    const check = sync.indexOf('if reused, let k = kept, !(try outcome.holds(k.window)) {');
    const again = sync.indexOf('outcome = try self.syncPasses(state, client)', check);
    const commit = sync.indexOf('self.commit(state, outcome)');
    expect(check).toBeGreaterThan(0);
    expect(sync.slice(check, again)).toContain('client = try self.client(settings)');
    expect(sync.slice(check, again)).toContain('reused = false');
    expect(again).toBeGreaterThan(check);
    expect(commit).toBeGreaterThan(again);
    // syncPasses changes nothing of the vault: only commit does.
    const passes = code.slice(code.indexOf('private func syncPasses('), code.indexOf('private func commit('));
    expect(passes).not.toMatch(/state\.(wallet|tip|lastUsed|needsSync|kept) =/);
    expect(sync).toContain('"chainMoved": chainMoved,');
    // The tip's block, for the shadow's check that the chain did not move after this sync.
    expect(sync).toContain('"tipHash": outcome.tip.hash.description,');
  });

  it('the server\'s blocks for the shadow come from the server itself, at most 20 heights', () => {
    const blocks = code.slice(code.indexOf('func serverBlocks('), code.indexOf('func probeServer('));
    expect(Number(constant('SERVER_BLOCKS_MAX'))).toBe(20);
    expect(blocks).toContain('guard heights.count <= SERVER_BLOCKS_MAX');
    expect(blocks).toContain('let header = try client.blockHeader(height: h)');
    expect(blocks).not.toMatch(/fullScan|\.sync\(|applyUpdate/);
  });
});
