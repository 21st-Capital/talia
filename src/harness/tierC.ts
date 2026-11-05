/**
 * Tier C, the simulator harness (BDK upgrade, decided 2026-10-15): a
 * TALIA_HARNESS build boots into this runner instead of the app, in the
 * iOS SIMULATOR only, and runs jobs the host driver (scripts/tier-c/run.py)
 * drops into the app container's Documents/tierc folder, against regtest
 * bitcoind and electrs on the host, through the REAL Swift bridge and the
 * REAL TypeScript engines. Results are written beside each job as JSON
 * (`<n>.out.json`), read on the host through `xcrun simctl
 * get_app_container`.
 *
 * For maintainers only: the host driver needs the library fork's private
 * equivalence harness (its tier D runner and corpus), which the public forks
 * do not carry, so tier C cannot run from a public clone. Nothing here is in
 * a phone or store build; the unit tests (npx jest) are what anyone can run.
 *
 * Jobs:
 *   - `tierd`: one session of the library fork's tier D protocol on the
 *     engine (sync, address, state, build, finalize, barrier), the same ops
 *     and the same answers as bdk-ffi/tests/talia_tier_d.rs, so tier D's own
 *     comparisons hold the app against bdk 0.28;
 *   - `special`: the known-answer test, the TLS cases, the panic recovery,
 *     the error codes, the network rules (`networkRules`), the rescue's
 *     signed PSBT through `broadcastRescue` (`rescueBroadcast`), a real
 *     speed-up of a waiting rescue (`rescueSpeedUp`), the address check's
 *     timing, and the contract recording (protocolScenario.ts).
 *
 * Until the old engine's removal (decided 2026-11-04) the app also linked
 * the old engine (bdk 0.28 behind the bdk-ffi 0.30 fork), and the `pair`,
 * `shadow` and `timing` jobs ran the same requests on both app engines and
 * compared them with the shadow week's comparator; they went with it.
 *
 * Test keys only. Never in a phone or store build: ios-device.sh and
 * ios-archive.sh refuse TALIA_HARNESS, and Metro drops this module when the
 * flag is off (index.js), which ios-archive.sh proves on the archived
 * JavaScript (the marker below must be absent).
 */
import RNFS from 'react-native-fs';
import { BdkWalletEngineV3, testBackendConnectionV3 } from '../bitcoin/engine/bdkWalletEngine';
import type { BdkWalletNative } from '../bitcoin/engine/bdkWalletNative';
import { bridged } from '../bitcoin/engine/bdkWalletNative';
import { classifyEngineError } from '../bitcoin/engine/engineError';
import { scureDeriver } from '../bitcoin/descriptor/scureAddresses';
import { canonicalPsbt, psbtMaps } from '../bitcoin/psbt/canonical';
import type { RawEntry } from '../bitcoin/psbt/canonical';
import { decodeBase64, encodeBase64, PSBT_MAGIC } from '../bitcoin/psbt/export';
import type { BackendConfig, BuildPsbtRequest } from '../bitcoin/engine/types';
import type { Network } from '../bitcoin/descriptor/types';
import { protocolScenario } from './protocolScenario';
import { serverFailed, serverUnreachable, silentServerGivesUpMs } from '../wallet/chainServers';
import { answerMayBeLost } from '../wallet/broadcastAnswer';
import { speedUpFigures } from '../wallet/replacement';
import { buildRescueSpeedUp, rescueOnChain } from '../wallet/rescueReplacement';
import { psbtTxShape } from '../bitcoin/psbt/broadcastCheck';
import { txLocksOf } from '../bitcoin/psbt/timelockCheck';
import type { ProtocolEntry, ProtocolVaults } from './protocolScenario';

/** The marker ios-archive.sh looks for: it must never be in a store bundle. */
export const TIER_C_MARKER = 'talia-tier-c-runner-7c1e';

export const TIER_C_DIR = `${RNFS.DocumentDirectoryPath}/tierc`;

type Json = Record<string, unknown>;
const message = (e: unknown) => String((e as Error)?.message ?? e);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForFile(path: string, timeoutMs = 900_000): Promise<string> {
  const t0 = Date.now();
  while (!(await RNFS.exists(path))) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${path}`);
    await sleep(150);
  }
  return RNFS.readFile(path, 'utf8');
}

/** A PSBT written back from its maps (the harness only: to strip entries from a real build). */
function writePsbt(m: { global: RawEntry[]; inputs: RawEntry[][]; outputs: RawEntry[][] }): string {
  const out: number[] = [...PSBT_MAGIC];
  const varint = (n: number) => {
    if (n < 0xfd) out.push(n);
    else if (n <= 0xffff) out.push(0xfd, n & 0xff, n >> 8);
    else out.push(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  };
  const bytes = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
  const map = (entries: RawEntry[]) => {
    for (const e of entries) {
      const k = bytes(e.key);
      const v = bytes(e.value);
      varint(k.length);
      out.push(...k);
      varint(v.length);
      out.push(...v);
    }
    out.push(0);
  };
  map(m.global);
  m.inputs.forEach(map);
  m.outputs.forEach(map);
  return encodeBase64(Uint8Array.from(out));
}

const blankBuild = (to: string, height: number) => ({
  recipients: [{ address: to, sats: 10_000 }],
  drainTo: null,
  drainWallet: false,
  utxos: [] as string[],
  manualOnly: false,
  unspendable: [] as string[],
  feeRateSatPerKwu: 500,
  feeRateSatPerVb: 2,
  feeAbsoluteSats: null,
  policyPaths: {},
  rbf: true,
  csvPath: false,
  version: 1 as 1 | 2,
  currentHeight: height,
  replacing: [] as string[],
});

// ---------------------------------------------------------------- tier D's protocol

interface TierDJob {
  kind: 'tierd';
  network: Network;
  backend: BackendConfig;
  ext: string;
  int: string | null;
  ops: Json[];
}

async function tierdState(engine: BdkWalletEngineV3, hasChange: boolean, probes: string[]): Promise<Json> {
  const { native, id } = engine.nativeHandle();
  const coins = (await bridged(native.unspent(id)))
    .map((c) => ({
      outpoint: `${c.txid}:${c.vout}`,
      value: c.value,
      keychain: c.keychain,
      index: c.index,
      height: c.height,
    }))
    .sort((a, b) => (a.outpoint < b.outpoint ? -1 : 1));
  const txs = (await bridged(native.transactions(id)))
    .map((t) => ({ txid: t.txid, sent: t.sent, received: t.received, fee: t.fee, height: t.height }))
    .sort((a, b) => (a.txid < b.txid ? -1 : 1));
  const b = await bridged(native.balance(id));
  const index: Json = { external: await bridged(native.derivationIndex(id, 'external')) };
  if (hasChange) index.internal = await bridged(native.derivationIndex(id, 'internal'));
  const isMine: boolean[] = [];
  for (const p of probes) isMine.push(await engine.ownsAddress(p));
  return {
    tip: engine.getTipHeight() ?? 0,
    coins,
    txs,
    balance: {
      immature: b.immature,
      trusted_pending: b.trustedPending,
      untrusted_pending: b.untrustedPending,
      confirmed: b.confirmed,
      spendable: b.spendable,
      total: b.total,
    },
    index,
    is_mine: isMine,
  };
}

async function runTierD(native: BdkWalletNative, job: TierDJob, outPath: string): Promise<Json[]> {
  const synced: { last: { passes: number; lookahead: number; reused?: boolean } | null } = { last: null };
  const engine = await BdkWalletEngineV3.create(
    { descriptor: job.ext, changeDescriptor: job.int ?? undefined, network: job.network },
    { native, onSync: (r) => (synced.last = { passes: r.passes, lookahead: r.lookahead, reused: r.reused }) },
  );
  const results: Json[] = [];
  try {
    for (const op of job.ops) {
      let r: Json;
      try {
        r = await tierdOp(engine, native, job, op, outPath);
        if (op.op === 'sync' && synced.last) r = { ...r, ...synced.last };
      } catch (e) {
        r = { error: message(e) };
      }
      results.push({ op: op.op, result: r });
    }
  } finally {
    await engine.close().catch(() => null);
  }
  return results;
}

async function tierdOp(engine: BdkWalletEngineV3, native: BdkWalletNative, job: TierDJob, op: Json, outPath: string): Promise<Json> {
  switch (op.op) {
    case 'sync': {
      const t0 = Date.now();
      await engine.sync(job.backend);
      return { ok: true, tip: engine.getTipHeight() ?? 0, ms: Date.now() - t0 };
    }
    case 'address': {
      const which = op.which as 'new' | 'lastUnused' | number;
      const internal = op.keychain === 'internal';
      const a = internal ? await engine.getInternalAddress(which) : await engine.getReceiveAddress(which);
      return { index: a.index, address: a.address, keychain: internal && job.int ? 'internal' : 'external' };
    }
    case 'state':
      return tierdState(engine, job.int != null, (op.probes as string[]) ?? []);
    case 'build': {
      const req: BuildPsbtRequest = {
        recipients: op.drain
          ? [{ address: op.drain as string, amountSats: 0 }]
          : ((op.recipients as Array<[string, number]>) ?? []).map(([address, amountSats]) => ({ address, amountSats })),
        drain: !!op.drain,
        utxos: ((op.utxos as string[]) ?? []).map((u) => ({ txid: u.split(':')[0], vout: Number(u.split(':')[1]) })),
        feeRate: op.rate as number,
        enableRbf: op.rbf !== false,
        replacing: (op.replacing as string[]) ?? undefined,
      };
      const r = await engine.buildPsbt(req);
      return { psbt: r.psbtBase64, fee: r.feeSats, txid: r.txid };
    }
    case 'finalize': {
      const r = await engine.completePsbt(op.signed as string, op.original as string);
      const tx = await bridged(native.extract(r.psbtBase64));
      return { finalized: r.finalized, error: r.finalized ? null : (r.finalizeNotes ?? []).join('; ') || 'not final', psbt: r.psbtBase64, tx };
    }
    case 'barrier': {
      await RNFS.writeFile(`${outPath}.${op.name}.reached`, '', 'utf8');
      await waitForFile(`${outPath}.${op.name}.go`);
      return { ok: true };
    }
    default:
      throw new Error(`unknown op ${String(op.op)}`);
  }
}

// ---------------------------------------------------------------- specials

async function runSpecial(native: BdkWalletNative, job: Json, outPath: string): Promise<Json> {
  switch (job.name) {
    case 'knownAnswer':
      try {
        return { result: await native.knownAnswer() };
      } catch (e) {
        return { error: message(e), code: (e as { code?: string }).code ?? null };
      }
    case 'tls': {
      // Each case through the engine's connection test.
      const out: Json[] = [];
      for (const c of job.cases as Array<{ label: string; url: string; validateDomain: boolean }>) {
        const backend: BackendConfig = { type: 'electrum', url: c.url, validateDomain: c.validateDomain, retry: 1, timeout: 5 };
        const row: Json = { label: c.label };
        try {
          row.v3 = { height: await testBackendConnectionV3(backend, native) };
        } catch (e) {
          row.v3 = { error: message(e) };
        }
        out.push(row);
      }
      return { cases: out };
    }
    case 'panic': {
      // A real Rust panic: two recipients whose amounts overflow the
      // library's sum ("Amount addition error"). The bridge must reject with
      // RUST_PANIC and recreate the wallet at once; the recreated wallet then
      // answers nothing that needs the chain until it synced again (decided
      // 2026-10-17), and the engine syncs again by itself.
      const v = job.vault as { ext: string; int: string | null; network: Network; backend: BackendConfig; to: string };
      const engine = await BdkWalletEngineV3.create({ descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network }, { native });
      const { id } = engine.nativeHandle();
      await engine.sync(v.backend);
      const before = await engine.getBalance();
      const r: Json = { before };
      const overflow = () =>
        engine.buildPsbt({
          recipients: [
            { address: v.to, amountSats: 9223372036854775808 },
            { address: v.to, amountSats: 9223372036854775808 },
          ],
          feeRate: 1,
        });
      // 1. Through the engine: it forgets its tip, and its next read syncs first.
      try {
        await overflow();
        r.panic = { error: null };
      } catch (e) {
        r.panic = { code: classifyEngineError(e), error: message(e) };
      }
      r.tipAfterPanic = engine.getTipHeight() ?? null;
      try {
        r.afterPanic = await engine.getBalance();
        r.tipAfterRead = engine.getTipHeight() ?? null;
      } catch (e) {
        r.afterPanic = { error: message(e) };
      }
      // 2. The bridge itself after a second panic: every call that needs the
      // chain is WALLET_RESYNCING, a peek still answers.
      try {
        await bridged(native.build(id, { ...blankBuild(v.to, 0), recipients: [
          { address: v.to, sats: 9223372036854775808 },
          { address: v.to, sats: 9223372036854775808 },
        ] }));
        r.panic2 = { error: null };
      } catch (e) {
        r.panic2 = { code: classifyEngineError(e) };
      }
      const bridge: Json = {};
      for (const [name, call] of [
        ['balance', () => native.balance(id)],
        ['unspent', () => native.unspent(id)],
        ['transactions', () => native.transactions(id)],
        ['lastUnused', () => native.address(id, 'external', 'lastUnused')],
        ['new', () => native.address(id, 'external', 'new')],
        ['build', () => native.build(id, blankBuild(v.to, 0))],
      ] as Array<[string, () => Promise<unknown>]>) {
        try {
          await bridged(call());
          bridge[name] = 'answered';
        } catch (e) {
          bridge[name] = classifyEngineError(e);
        }
      }
      r.bridgeAfterPanic = bridge;
      try {
        r.peekAfterPanic = (await bridged(native.address(id, 'external', '3'))).index;
      } catch (e) {
        r.peekAfterPanic = { error: message(e) };
      }
      // 3. That second panic went around the engine: its read meets
      // WALLET_RESYNCING, syncs and asks once more.
      try {
        r.afterBridgePanic = await engine.getBalance();
      } catch (e) {
        r.afterBridgePanic = { error: message(e) };
      }
      try {
        await engine.sync(v.backend);
        r.afterSync = await engine.getBalance();
      } catch (e) {
        r.afterSync = { error: message(e) };
      }
      await engine.close().catch(() => null);
      return r;
    }
    case 'finalizeRefused': {
      // Decided 2026-10-17: a copy the finalizer refuses
      // (a segwit v0 input without its non_witness_utxo, its derivations
      // gone) comes back exactly as it went in, as 0.28's sign() left it.
      const v = job.vault as { ext: string; int: string | null; network: Network; backend: BackendConfig; to: string };
      const engine = await BdkWalletEngineV3.create({ descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network }, { native });
      const { id } = engine.nativeHandle();
      try {
        await engine.sync(v.backend);
        const built = await engine.buildPsbt({ recipients: [{ address: v.to, amountSats: 20_000 }], feeRate: 2 });
        const m = psbtMaps(built.psbtBase64);
        if (!m) throw new Error('the build could not be read');
        const dropped = (e: RawEntry) => !['00', '06'].includes(e.key.slice(0, 2));
        const stripped = writePsbt({ global: m.global, inputs: m.inputs.map((i) => i.filter(dropped)), outputs: m.outputs });
        const r = await bridged(native.finalize(id, stripped));
        return {
          finalized: r.finalized,
          error: r.error,
          unchanged: canonicalPsbt(r.psbt) === canonicalPsbt(stripped),
          derivationsBack: (psbtMaps(r.psbt)?.inputs ?? []).some((i) => i.some((e) => e.key.startsWith('06'))),
        };
      } finally {
        await engine.close().catch(() => null);
      }
    }
    case 'rbfOffWithoutCsv': {
      // Decided 2026-10-17: the engine says the chosen path carries an
      // older() but the library finds none. RBF off must still come out as
      // 0.28's 0xFFFFFFFE (nLockTime set at a known tip), never 0xFFFFFFFD.
      const v = job.vault as { ext: string; int: string | null; network: Network; backend: BackendConfig; to: string };
      const engine = await BdkWalletEngineV3.create({ descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network }, { native });
      const { id } = engine.nativeHandle();
      try {
        await engine.sync(v.backend);
        const tip = engine.getTipHeight() ?? 0;
        const out: Json = {};
        for (const [label, opts] of [
          ['csv-claimed', { ...blankBuild(v.to, tip), rbf: false, csvPath: true, version: 2 as const }],
          ['plain', { ...blankBuild(v.to, tip), rbf: false }],
        ] as Array<[string, ReturnType<typeof blankBuild>]>) {
          try {
            const b = await bridged(native.build(id, opts));
            const m = psbtMaps(b.psbt);
            out[label] = { sequences: [...new Set((m?.tx.ins ?? []).map((i) => i.sequence))], lockTime: m?.tx.lockTime ?? null };
          } catch (e) {
            out[label] = { error: message(e), code: classifyEngineError(e) };
          }
        }
        return out;
      } finally {
        await engine.close().catch(() => null);
      }
    }
    case 'addressCheckTiming': {
      // Decided 2026-10-17, measured on Hermes: the old check derived 20
      // addresses in one block of the JavaScript thread; the new one derives
      // one per pause. The longest single piece is what a client could feel.
      const out: Json[] = [];
      for (const shape of job.shapes as Array<{ name: string; ext: string; int: string | null }>) {
        const t0 = Date.now();
        const pieces: number[] = [];
        // As checkAddresses runs it: each keychain's deriver made in a piece of its own.
        let c0 = Date.now();
        const ext = scureDeriver(shape.ext, 'testnet');
        pieces.push(Date.now() - c0);
        await sleep(0);
        c0 = Date.now();
        const int = shape.int ? scureDeriver(shape.int, 'testnet') : null;
        pieces.push(Date.now() - c0);
        await sleep(0);
        if (!ext || (shape.int && !int)) {
          out.push({ name: shape.name, covered: false });
          continue;
        }
        const makeMs = pieces.slice();
        for (const d of [ext, int]) {
          if (!d) continue;
          for (let i = 0; i < 10; i++) {
            const p0 = Date.now();
            d(i);
            pieces.push(Date.now() - p0);
            await sleep(0);
          }
        }
        // The old check's single block: both derivers made and 20 derived in one go.
        const b0 = Date.now();
        const e2 = scureDeriver(shape.ext, 'testnet')!;
        const i2 = shape.int ? scureDeriver(shape.int, 'testnet') : null;
        for (let i = 0; i < 10; i++) {
          e2(i);
          if (i2) i2(i);
        }
        const block = Date.now() - b0;
        out.push({ name: shape.name, covered: true, oneBlockMs: block, longestPieceMs: Math.max(...pieces), makeMs, totalMs: Date.now() - t0 - block, pieces: pieces.length });
      }
      return { shapes: out };
    }
    case 'networkRules': {
      // The network rules (decided 2026-10-18) and the rescue's reading of a
      // lost answer (2026-10-19), through the real bridge:
      //   - a transaction the server refuses: the network's answer, read as
      //     "the server answered" (never unreachable, never a lost answer);
      //   - a broadcast to a server nobody listens on, right after a sync with
      //     the live one: unreachable, so it never went through the last
      //     sync's connection;
      //   - a server that accepts and never answers, asked the Testnet4 way
      //     (no second try, 8 s): the native call gives up by itself, a sync
      //     and a broadcast alike, within `silentServerGivesUpMs`;
      //   - the new engine's own sync after a panic asks the vault's servers
      //     as they are then: none but a dead one, and the read fails rather
      //     than go back to the live server it last used.
      const v = job.vault as { ext: string; int: string | null; network: Network };
      const live = job.backend as BackendConfig;
      const testnet4Way = { type: 'electrum' as const, retry: 0, timeout: 8, validateDomain: false };
      const dead: BackendConfig = { ...testnet4Way, url: String(job.dead) };
      const silent: BackendConfig = { ...testnet4Way, url: String(job.silent) };
      const bytes = Uint8Array.from((String(job.rawHex).match(/../g) ?? []).map((h) => parseInt(h, 16)));
      const txid = String(job.txid);
      const read = (e: unknown, ms?: number): Json => ({
        error: message(e).slice(0, 300),
        code: classifyEngineError(e),
        unreachable: serverUnreachable(e),
        failed: serverFailed(e),
        mayBeLost: answerMayBeLost(e),
        ...(ms == null ? {} : { ms }),
      });
      const attempt = async (run: () => Promise<unknown>): Promise<Json> => {
        const t0 = Date.now();
        try {
          return { answered: await run(), ms: Date.now() - t0 };
        } catch (e) {
          return read(e, Date.now() - t0);
        }
      };
      const out: Json = { silentGivesUpMs: silentServerGivesUpMs(silent) };
      {
        const params = { descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network };
        const engine = await BdkWalletEngineV3.create(params, { native });
        const row: Json = {};
        await engine.sync(live);
        row.refused = await attempt(() => engine.broadcastRawTx(bytes, live, txid));
        row.deadAfterSync = await attempt(() => engine.broadcastRawTx(bytes, dead, txid));
        row.silentSync = await attempt(() => engine.sync(silent));
        row.silentBroadcast = await attempt(() => engine.broadcastRawTx(bytes, silent, txid));
        await engine.close().catch(() => null);
        out.v3 = row;
      }
      // The new engine's own sync after a panic, with the vault's servers given.
      const servers: { now: BackendConfig[] } = { now: [live] };
      const engine = await BdkWalletEngineV3.create(
        { descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network, chainServers: async () => servers.now },
        { native },
      );
      const { id } = engine.nativeHandle();
      await engine.sync(live);
      const panic = async () => {
        try {
          await bridged(native.build(id, { ...blankBuild(String(job.to), 0), recipients: [
            { address: String(job.to), sats: 9223372036854775808 },
            { address: String(job.to), sats: 9223372036854775808 },
          ] }));
          return 'no panic';
        } catch (e) {
          return classifyEngineError(e);
        }
      };
      const resync: Json = {};
      resync.panic1 = await panic();
      servers.now = [dead];
      resync.readWithOnlyADeadServer = await attempt(() => engine.getBalance());
      servers.now = [live];
      resync.readWithTheLiveServer = await attempt(() => engine.getBalance());
      resync.panic2 = await panic();
      servers.now = [];
      resync.readWithNoServer = await attempt(() => engine.getBalance());
      await engine.close().catch(() => null);
      out.resync = resync;
      return out;
    }
    case 'rescueBroadcast': {
      // The rescue's signed-PSBT path (decided 2026-10-20) through the real
      // library: 21st Capital's signer returns a signed PSBT for a
      // script-path spend and the engine finishes it (broadcastRescue:
      // complete(), the rescue rule on the finished shape, then the
      // broadcast). The engine builds a spend of its coin to the
      // destination, the host signs it (not finalized), and then:
      //   - a destination other than the filed one is refused, and the
      //     network has nothing (the host looks);
      //   - a dead server handed in right after a sync with the live one is
      //     unreachable: the finished rescue goes to the server handed in,
      //     never the last sync's;
      //   - the live server takes it, under the txid the engine answers.
      const v = job.vault as { ext: string; int: string | null; network: Network };
      const live = job.backend as BackendConfig;
      const dead: BackendConfig = { ...live, url: String(job.dead) };
      const to = String(job.to);
      const filed = { destinationScriptHex: String(job.toScript) };
      const elsewhere = { destinationScriptHex: '5120' + '44'.repeat(32) };
      const coinValues = job.coinValues as Record<'v3', number>;
      let n = 0;
      const exchange = async (name: string, payload: unknown): Promise<unknown> => {
        n += 1;
        const base = `${outPath}.x${n}-${name}`;
        await RNFS.writeFile(`${base}.ask`, JSON.stringify(payload), 'utf8');
        return JSON.parse(await waitForFile(`${base}.answer`));
      };
      const attempt = async (run: () => Promise<unknown>): Promise<Json> => {
        const t0 = Date.now();
        try {
          return { answered: await run(), ms: Date.now() - t0 };
        } catch (e) {
          return {
            error: message(e).slice(0, 300),
            refusal: (e as { refusal?: { code?: string } }).refusal?.code ?? null,
            unreachable: serverUnreachable(e),
            mayBeLost: answerMayBeLost(e),
            ms: Date.now() - t0,
          };
        }
      };
      const out: Json = {};
      for (const side of ['v3'] as const) {
        const params = { descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network };
        const engine = await BdkWalletEngineV3.create(params, { native });
        const row: Json = {};
        try {
          await engine.sync(live);
          const coin = (await engine.listUtxos()).find((u) => u.valueSats === coinValues[side]);
          if (!coin) throw new Error(`no coin of ${coinValues[side]} sats`);
          const built = await engine.buildPsbt({
            utxos: [{ txid: coin.txid, vout: coin.vout }],
            recipients: [{ address: to, amountSats: 30_000 }],
            feeRate: 2,
          });
          row.unsignedTxid = built.txid;
          const signedBase64 = String(await exchange('sign', { psbt: built.psbtBase64 }));
          const signed = decodeBase64(signedBase64);
          if (!signed) throw new Error('the host sent back no PSBT');
          row.hostSigned = signedBase64 !== built.psbtBase64;
          row.wrongDestination = await attempt(() => engine.broadcastRescue(signed, elsewhere, live));
          row.seenAfterRefusal = await exchange('seen', { txid: built.txid });
          row.deadServer = await attempt(() => engine.broadcastRescue(signed, filed, dead));
          row.seenAfterDead = await exchange('seen', { txid: built.txid });
          row.sent = await attempt(() => engine.broadcastRescue(signed, filed, live));
          row.seenAfterSend = await exchange('seen', { txid: built.txid });
        } catch (e) {
          row.error = message(e);
        } finally {
          await engine.close().catch(() => null);
        }
        out[side] = row;
      }
      return out;
    }
    case 'rescueSpeedUp': {
      // A real rescue, then its speed-up (decided 2026-10-31), through the
      // real library, with the rescue key alone signing. The engine builds a
      // rescue of two coins of its own on the path of older(12) and sends it;
      // the host keeps it waiting; then:
      //   - the vault no longer lists those coins, and lists the rescue as waiting;
      //   - the engine rebuilds over the spent coins (`rescueOnChain` and
      //     `buildRescueSpeedUp`, the app's own route): the same coins, one
      //     output, version 2, each nSequence the path's older() value;
      //   - it goes out through `broadcastRescue` on the phone's record of the
      //     coins, and the network takes it in the rescue's place;
      //   - a block confirms it.
      const v = job.vault as { ext: string; int: string | null; network: Network };
      const live = job.backend as BackendConfig;
      const to = String(job.to);
      const destinationScriptHex = String(job.toScript);
      const path = { olderBlocks: Number(job.older), fingerprint: String(job.rescueFp) };
      const coinValues = job.coinValues as Record<'v3', number[]>;
      let n = 0;
      const exchange = async (name: string, payload: unknown): Promise<unknown> => {
        n += 1;
        const base = `${outPath}.x${n}-${name}`;
        await RNFS.writeFile(`${base}.ask`, JSON.stringify(payload), 'utf8');
        return JSON.parse(await waitForFile(`${base}.answer`));
      };
      const refusedAs = async (run: () => Promise<unknown>): Promise<Json> => {
        try {
          await run();
          return { built: true };
        } catch (e) {
          return { code: classifyEngineError(e), message: message(e).slice(0, 200) };
        }
      };
      const out: Json = {};
      for (const side of ['v3'] as const) {
        const params = { descriptor: v.ext, changeDescriptor: v.int ?? undefined, network: v.network };
        const engine = await BdkWalletEngineV3.create(params, { native });
        const row: Json = {};
        try {
          await engine.sync(live);
          const named = (await engine.listUtxos()).filter((u) => coinValues[side].includes(u.valueSats));
          if (named.length !== coinValues[side].length) throw new Error('the coins are not there');
          const utxos = named.map(({ txid, vout }) => ({ txid, vout }));
          const first = await engine.buildRescuePsbt({
            utxos,
            destination: to,
            feeRate: 2,
            branchFingerprint: path.fingerprint,
          });
          row.firstFee = first.feeSats;
          row.firstLocks = txLocksOf(first.psbtBase64) as unknown as Json;
          const signed = decodeBase64(String(await exchange('sign', { psbt: first.psbtBase64 })));
          if (!signed) throw new Error('the host sent back no PSBT');
          const sent = await engine.broadcastRescue(signed, { destinationScriptHex, requestTxid: first.txid }, live);
          row.firstTxid = sent;
          await exchange('indexed', { txid: sent });
          await engine.sync(live);
          const left = await engine.listUtxos();
          row.coinsListedWhileWaiting = left.filter((u) => utxos.some((c) => c.txid === u.txid && c.vout === u.vout)).length;
          const chain = await rescueOnChain(engine, sent, { destination: to, olderBlocks: path.olderBlocks });
          row.state = chain.state;
          if (chain.state !== 'waiting' || !chain.orig) throw new Error(`the rescue reads ${chain.state}`);
          row.origFee = chain.orig.feeSats;
          row.withoutNamingIt = await refusedAs(() =>
            engine.buildRescuePsbt({ utxos, destination: to, feeRate: 8, branchFingerprint: path.fingerprint }),
          );
          const shown = speedUpFigures(chain.orig, 8);
          const speedUp = await buildRescueSpeedUp(engine, chain.orig, {
            destination: to,
            path,
            chosenRate: 8,
            feeSats: shown?.feeSats,
          });
          row.shownFee = shown?.feeSats;
          row.speedUpFee = speedUp.feeSats;
          row.speedUpTxid = speedUp.built.txid;
          row.speedUpLocks = txLocksOf(speedUp.built.psbtBase64) as unknown as Json;
          row.speedUpCoins = (psbtTxShape(speedUp.built.psbtBase64)?.inputs ?? []).map((i) => `${i.txid}:${i.vout}`).sort();
          row.firstCoins = utxos.map((c) => `${c.txid}:${c.vout}`).sort();
          const again = decodeBase64(String(await exchange('sign', { psbt: speedUp.built.psbtBase64 })));
          if (!again) throw new Error('the host sent back no PSBT');
          const expect = { destinationScriptHex, requestTxid: speedUp.built.txid };
          row.refusedWithoutTheCoins = await refusedAs(() => engine.broadcastRescue(again, expect, live));
          row.replacementTxid = await engine.broadcastRescue(again, { ...expect, replacedCoins: chain.orig.coins }, live);
          row.firstStillThere = await exchange('seen', { txid: sent });
          row.replacementThere = await exchange('seen', { txid: row.replacementTxid });
          await exchange('mine', {});
          await engine.sync(live);
          const done = await rescueOnChain(engine, String(row.replacementTxid), { destination: to, olderBlocks: path.olderBlocks });
          row.afterABlock = done.state;
        } catch (e) {
          row.error = message(e);
        } finally {
          await engine.close().catch(() => null);
        }
        out[side] = row;
      }
      return out;
    }
    case 'protocol': {
      const log: ProtocolEntry[] = [];
      const recording: BdkWalletNative = new Proxy(native, {
        get(target, name) {
          const f = (target as unknown as Record<string, unknown>)[name as string];
          if (typeof f !== 'function') return f;
          return async (...args: unknown[]) => {
            const entry: ProtocolEntry = { call: String(name), args: JSON.parse(JSON.stringify(args)) };
            log.push(entry);
            try {
              const result = await (f as (...a: unknown[]) => Promise<unknown>).apply(target, args);
              (entry as { result?: unknown }).result = result === undefined ? null : JSON.parse(JSON.stringify(result));
              return result;
            } catch (e) {
              (entry as { error?: unknown }).error = { code: (e as { code?: string }).code ?? null, message: message(e) };
              throw e;
            }
          };
        },
      });
      let n = 0;
      const exchange = async (name: string, payload: unknown) => {
        n += 1;
        const base = `${outPath}.x${n}-${name}`;
        await RNFS.writeFile(`${base}.ask`, JSON.stringify(payload), 'utf8');
        const answer = JSON.parse(await waitForFile(`${base}.answer`));
        log.push({ exchange: name, sent: payload, answer });
        return answer;
      };
      await protocolScenario(recording, job.vaults as ProtocolVaults, exchange, log);
      return { log };
    }
    default:
      throw new Error(`unknown special ${String(job.name)}`);
  }
}

// ---------------------------------------------------------------- the loop

export async function runJob(native: BdkWalletNative, job: Json, outPath: string): Promise<unknown> {
  switch (job.kind) {
    case 'tierd':
      return runTierD(native, job as unknown as TierDJob, outPath);
    case 'special':
      return runSpecial(native, job, outPath);
    default:
      throw new Error(`unknown job kind ${String(job.kind)}`);
  }
}

/** Process `<n>.job.json` files in order, forever; `status` is told what runs. */
export async function tierCLoop(native: BdkWalletNative | undefined, status: (s: string) => void): Promise<never> {
  await RNFS.mkdir(TIER_C_DIR);
  await RNFS.writeFile(
    `${TIER_C_DIR}/ready.json`,
    JSON.stringify({ marker: TIER_C_MARKER, native: !!native, at: new Date().toISOString() }),
    'utf8',
  );
  status(native ? 'Tier C runner: ready' : 'Tier C runner: the new library is not linked');
  for (;;) {
    let names: string[] = [];
    try {
      names = (await RNFS.readDir(TIER_C_DIR)).map((f) => f.name).filter((n) => /^\d+\.job\.json$/.test(n));
    } catch {
      names = [];
    }
    names.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    let ran = false;
    for (const name of names) {
      const n = name.split('.')[0];
      const outPath = `${TIER_C_DIR}/${n}.out.json`;
      if (await RNFS.exists(outPath)) continue;
      ran = true;
      status(`Tier C runner: job ${n}`);
      let out: unknown;
      const t0 = Date.now();
      try {
        if (!native) throw new Error('the new library is not linked');
        out = { ok: await runJob(native, JSON.parse(await RNFS.readFile(`${TIER_C_DIR}/${name}`, 'utf8')), outPath), ms: Date.now() - t0 };
      } catch (e) {
        out = { error: message(e), ms: Date.now() - t0 };
      }
      await RNFS.writeFile(`${outPath}.tmp`, JSON.stringify(out), 'utf8');
      await RNFS.moveFile(`${outPath}.tmp`, outPath);
      status(`Tier C runner: job ${n} done`);
      break;
    }
    if (!ran) await sleep(200);
  }
}
