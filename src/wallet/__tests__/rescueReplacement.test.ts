/**
 * Speed up for a waiting rescue (decided 2026-10-31): the rules a replacement
 * must meet before anything goes to 21st Capital. The transactions are real
 * bytes, the stand-in for BDK builds a real unsigned PSBT from the request, and
 * every coin, address, fee and nSequence rule is read back off those bytes.
 */
import {
  buildRescueSpeedUp,
  rescueOnChain,
  waitingRescueOf,
} from '../rescueReplacement';
import {
  loadReplacementContext,
  minimumRate,
  replacementEligibility,
  ReplacementError,
  replacementRows,
  speedUpShape,
} from '../replacement';
import type { OriginalTx } from '../replacement';
import { rescueFeeAt, rescueSizeEstimate } from '../rescueFee';
import { scriptToAddress } from '../../bitcoin/psbt/parse';
import { encodeBase64 } from '../../bitcoin/psbt/export';
import { EngineError } from '../../bitcoin/engine/engineError';
import { FakeWalletEngine } from '../../bitcoin/engine/fakeEngine';
import type { FakeEngineOptions } from '../../bitcoin/engine/fakeEngine';
import type { BuildPsbtRequest, PsbtBuildResult, RescueBuildRequest, WalletTx } from '../../bitcoin/engine/types';

const NET = 'testnet' as const;
const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number): number[] => [...u32(n % 0x100000000), ...u32(Math.floor(n / 0x100000000))];
const varint = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, (n >> 8) & 0xff]);
const le = (txid: string): number[] => (txid.match(/../g) as string[]).map((h) => parseInt(h, 16)).reverse();
const tr = (fill: number) => [0x51, 0x20, ...new Array(32).fill(fill)];
const addr = (script: number[]) => scriptToAddress(Uint8Array.from(script), NET) as string;

/** A taproot script-path spend of the rescue leaf: signature, leaf, control block. */
const WITNESS = [new Array(64).fill(0xaa), new Array(38).fill(0x20), [0xc0, ...new Array(64).fill(0x01)]];

interface In {
  txid: string;
  vout: number;
  sequence: number;
}
interface Out {
  script: number[];
  value: number;
}

function unsignedTx(ins: In[], outs: Out[], version = 2): number[] {
  return [
    ...u32(version),
    ...varint(ins.length),
    ...ins.flatMap((i) => [...le(i.txid), ...u32(i.vout), 0x00, ...u32(i.sequence)]),
    ...varint(outs.length),
    ...outs.flatMap((o) => [...u64(o.value), ...varint(o.script.length), ...o.script]),
    ...u32(0),
  ];
}

function rawTx(ins: In[], outs: Out[]): Uint8Array {
  const t = unsignedTx(ins, outs);
  return Uint8Array.from([
    ...t.slice(0, 4),
    0x00,
    0x01,
    ...t.slice(4, t.length - 4),
    ...ins.flatMap(() => [...varint(WITNESS.length), ...WITNESS.flatMap((w) => [...varint(w.length), ...w])]),
    ...t.slice(t.length - 4),
  ]);
}

function psbtOf(ins: In[], outs: Out[], version = 2): string {
  const t = unsignedTx(ins, outs, version);
  return encodeBase64(
    Uint8Array.from([
      0x70, 0x73, 0x62, 0x74, 0xff,
      0x01, 0x00, ...varint(t.length), ...t, 0x00,
      ...ins.map(() => 0x00),
      ...outs.map(() => 0x00),
    ]),
  );
}

const OLDER = 3;
const VAULT = tr(0x11);
const DEST = tr(0x22);
const STRANGER = tr(0x66);
const COIN_1 = '1'.repeat(64);
const COIN_2 = '2'.repeat(64);
const ORIG = '0b'.repeat(32);
const FP = 'aabbccdd';
const PATH = { olderBlocks: OLDER, fingerprint: FP };
/** The figures of the testnet rescue of 2026-10-31: two coins, one output. */
const IN = [12_000, 8_061];
const TOTAL = 20_061;
const OLD_FEE = 2_881;
const INS: In[] = [
  { txid: COIN_1, vout: 0, sequence: OLDER },
  { txid: COIN_2, vout: 1, sequence: OLDER },
];

const funding = (value: number, vout: number) =>
  rawTx(
    [{ txid: 'f'.repeat(64), vout: 0, sequence: 0xfffffffd }],
    [...new Array(vout).fill({ script: VAULT, value: 1 }), { script: VAULT, value }],
  );

const walletTx = (over: Partial<WalletTx> = {}): WalletTx => ({
  txid: ORIG,
  received: 0,
  sent: TOTAL,
  netAmount: -TOTAL,
  fee: OLD_FEE,
  confirmed: false,
  ...over,
});

/** Stands in for BDK on the rescue path: a real PSBT at the rate, sized a little
 *  over the true size, or at the absolute fee. Spends what it is told to. */
class RescueEngine extends FakeWalletEngine {
  readonly requests: RescueBuildRequest[] = [];
  constructor(
    options: FakeEngineOptions,
    private readonly behaviour: {
      tweak?: (ins: In[], outs: Out[]) => void;
      version?: number;
      fail?: Error;
      size?: number;
    } = {},
  ) {
    super(NET, options);
  }
  async buildRescuePsbt(req: RescueBuildRequest): Promise<PsbtBuildResult> {
    this.requests.push(req);
    if (this.behaviour.fail) throw this.behaviour.fail;
    const size = this.behaviour.size ?? 288;
    const fee = req.feeAbsolute ?? Math.ceil(req.feeRate * size);
    if (fee >= TOTAL) throw new EngineError('INSUFFICIENT_FUNDS', `Insufficient funds: ${TOTAL} sat available of ${fee} sat needed`);
    const ins = req.utxos.map((u) => ({ ...u, sequence: OLDER }));
    const outs = [{ script: DEST, value: TOTAL - fee }];
    this.behaviour.tweak?.(ins, outs);
    return {
      psbtBase64: psbtOf(ins, outs, this.behaviour.version ?? 2),
      txid: 'e'.repeat(64),
      feeSats: TOTAL - outs.reduce((s, o) => s + o.value, 0),
      sentSats: 0,
    };
  }
  async buildPsbt(_: BuildPsbtRequest): Promise<PsbtBuildResult> {
    throw new Error('A rescue is never an ordinary build.');
  }
}

function engineOf(
  over: {
    ins?: In[];
    outs?: Out[];
    tx?: Partial<WalletTx> | null;
    owns?: string[];
    extraTxs?: WalletTx[];
    extraRaw?: Record<string, Uint8Array>;
  } = {},
  behaviour: ConstructorParameters<typeof RescueEngine>[1] = {},
): RescueEngine {
  const ins = over.ins ?? INS;
  const outs = over.outs ?? [{ script: DEST, value: TOTAL - OLD_FEE }];
  return new RescueEngine(
    {
      addresses: over.owns ?? [addr(VAULT)],
      utxos: [],
      transactions: [...(over.tx === null ? [] : [walletTx(over.tx)]), ...(over.extraTxs ?? [])],
      rawTxs: {
        [ORIG]: rawTx(ins, outs),
        [COIN_1]: funding(IN[0], 0),
        [COIN_2]: funding(IN[1], 1),
        ...over.extraRaw,
      },
    },
    behaviour,
  );
}

const RULE = { destination: addr(DEST), olderBlocks: OLDER };

async function origOf(engine: RescueEngine = engineOf()): Promise<OriginalTx> {
  const chain = await rescueOnChain(engine, ORIG, RULE);
  if (chain.state !== 'waiting' || !chain.orig) throw new Error('not waiting');
  return chain.orig;
}

describe('where a rescue that went out stands', () => {
  it('waits, and reads as a send-all to the same address', async () => {
    const orig = await origOf();
    expect(orig.coins.map((c) => [c.txid, c.vout, c.valueSats])).toEqual([
      [COIN_1, 0, IN[0]],
      [COIN_2, 1, IN[1]],
    ]);
    expect(orig.feeSats).toBe(OLD_FEE);
    expect(orig.recipients).toEqual([{ address: addr(DEST), amountSats: TOTAL - OLD_FEE }]);
    expect(speedUpShape(orig)).toBe('send-all');
  });

  it('in a block, there is nothing to speed up', async () => {
    expect((await rescueOnChain(engineOf({ tx: { confirmed: true, blockHeight: 9 } }), ORIG, RULE)).state).toBe('confirmed');
  });

  it('not listed by the vault', async () => {
    expect((await rescueOnChain(engineOf({ tx: null }), ORIG, RULE)).state).toBe('not-listed');
  });

  it('a phone that cannot read it offers nothing', async () => {
    const e = engineOf();
    jest.spyOn(e, 'getRawTx').mockResolvedValue(null);
    expect(await rescueOnChain(e, ORIG, RULE)).toEqual({ state: 'waiting', orig: null });
  });

  it('the rescue path stays refused as an everyday Speed up or Cancel', async () => {
    // The rule decided 2026-09-28 stands: this route is the rescue's own.
    const ctx = await loadReplacementContext(engineOf(), ORIG);
    expect(replacementEligibility(ctx).cannot).toBe('recovery-path');
  });
});

describe('what is not the rescue filed on this phone offers no speed-up', () => {
  const orig = async (over: Parameters<typeof engineOf>[0], rule = RULE) =>
    waitingRescueOf(await loadReplacementContext(engineOf(over), ORIG), rule);

  it('another address', async () => {
    expect(await orig({ outs: [{ script: STRANGER, value: TOTAL - OLD_FEE }] })).toBeNull();
  });

  it('a second output', async () => {
    expect(
      await orig({ outs: [{ script: DEST, value: 10_000 }, { script: VAULT, value: TOTAL - OLD_FEE - 10_000 }] }),
    ).toBeNull();
  });

  it('a coin that is not on the rescue path', async () => {
    expect(await orig({ ins: [INS[0], { ...INS[1], sequence: 0xfffffffd }] })).toBeNull();
  });

  it('a coin of another wait', async () => {
    expect(await orig({ ins: INS.map((i) => ({ ...i, sequence: OLDER + 1 })) })).toBeNull();
  });

  it('a coin that is not this vault’s', async () => {
    expect(await orig({ owns: [addr(STRANGER)] })).toBeNull();
  });

  it('something waiting that spends from it', async () => {
    const child = rawTx([{ txid: ORIG, vout: 0, sequence: 0xfffffffd }], [{ script: STRANGER, value: 500 }]);
    const kid = 'c'.repeat(64);
    expect(
      await orig({
        extraTxs: [{ txid: kid, received: 0, sent: 1000, netAmount: -1000, confirmed: false }],
        extraRaw: { [kid]: child },
      }),
    ).toBeNull();
  });

  it('a phone with no destination on record', async () => {
    expect(await orig({}, { ...RULE, destination: '' })).toBeNull();
  });

  it('a destination that is the vault’s own change address is still the one recipient', async () => {
    const e = engineOf({ owns: [addr(VAULT), addr(DEST)] });
    jest.spyOn(e, 'listUtxos').mockResolvedValue([
      { txid: ORIG, vout: 0, valueSats: TOTAL - OLD_FEE, keychain: 'internal' },
    ]);
    const orig2 = await origOf(e);
    expect(speedUpShape(orig2)).toBe('send-all');
  });
});

describe('the fee a speed-up may pay', () => {
  it('starts above what the rescue pays on the chain', async () => {
    const orig = await origOf();
    expect(minimumRate(orig.feeRate)).toBeGreaterThan(orig.feeRate);
    const rows = replacementRows(orig, 'speedup', { fast: 40, medium: 20, slow: 5 });
    expect(rows.map((r) => r.belowMinimum)).toEqual([false, false, true]);
    // The fee comes out of what arrives.
    expect(rows[0].recipientSats).toBe(TOTAL - rows[0].feeSats);
  });
});

describe('building it', () => {
  const build = (engine: RescueEngine, orig: OriginalTx, rate = 40) =>
    buildRescueSpeedUp(engine, orig, { destination: addr(DEST), path: PATH, chosenRate: rate });

  it('names the same coins, the same address, the rescue path and the rescue it replaces', async () => {
    const engine = engineOf();
    const orig = await origOf(engine);
    const result = await build(engine, orig);
    expect(engine.requests).toEqual([
      {
        utxos: [
          { txid: COIN_1, vout: 0 },
          { txid: COIN_2, vout: 1 },
        ],
        destination: addr(DEST),
        feeRate: 40,
        branchFingerprint: FP,
        replacing: [ORIG],
      },
    ]);
    expect(result.feeSats).toBe(Math.ceil(40 * 288));
    expect(result.extraSats).toBe(result.feeSats - OLD_FEE);
    expect(result.arrivesSats).toBe(TOTAL - result.feeSats);
  });

  it('pays exactly the fee the sheet showed, not what BDK’s worst-case size would make of the rate', async () => {
    const engine = engineOf();
    const orig = await origOf(engine);
    const [row] = replacementRows(orig, 'speedup', { fast: 40, medium: 20, slow: 5 });
    const result = await buildRescueSpeedUp(engine, orig, {
      destination: addr(DEST),
      path: PATH,
      chosenRate: row.buildRate,
      feeSats: row.feeSats,
    });
    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0].feeAbsolute).toBe(row.feeSats);
    expect(result.feeSats).toBe(row.feeSats);
    expect(result.feeSats).toBeLessThan(Math.ceil(40 * 288));
    expect(result.arrivesSats).toBe(row.recipientSats);
  });

  it('never builds under the minimum, whatever was chosen', async () => {
    const engine = engineOf();
    const orig = await origOf(engine);
    await build(engine, orig, 1);
    expect(engine.requests[0].feeRate).toBe(minimumRate(orig.feeRate));
  });

  it('builds again with an absolute fee when the rate alone falls short of the floor', async () => {
    const engine = engineOf({}, { size: 100 });
    const orig = await origOf(engine);
    const result = await build(engine, orig, minimumRate(orig.feeRate));
    expect(engine.requests.map((r) => r.feeAbsolute != null)).toEqual([false, true]);
    expect(result.feeSats).toBeGreaterThan(OLD_FEE);
    expect(engine.requests[1].replacing).toEqual([ORIG]);
  });

  it.each<[string, (ins: In[], outs: Out[]) => void]>([
    ['one coin more', (ins) => ins.push({ txid: '3'.repeat(64), vout: 0, sequence: OLDER })],
    ['one coin less', (ins) => void ins.pop()],
    ['another coin in its place', (ins) => void (ins[0].txid = '3'.repeat(64))],
    ['another address', (_, outs) => void (outs[0].script = STRANGER)],
    ['a second output', (_, outs) => void outs.push({ script: STRANGER, value: 600 })],
    ['a coin with the everyday nSequence', (ins) => void (ins[0].sequence = 0xfffffffd)],
    ['a coin with no wait at all', (ins) => void (ins[1].sequence = 0xffffffff)],
    ['a shorter wait', (ins) => void (ins[0].sequence = OLDER - 1)],
    ['a longer wait', (ins) => void (ins[0].sequence = OLDER + 1)],
  ])('refuses %s', async (_name, tweak) => {
    const engine = engineOf({}, { tweak });
    const orig = await origOf(engine);
    await expect(build(engine, orig)).rejects.toMatchObject({ code: 'wrong-shape' });
  });

  it('refuses version 1: a relative wait needs version 2', async () => {
    const engine = engineOf({}, { version: 1 });
    const orig = await origOf(engine);
    await expect(build(engine, orig)).rejects.toMatchObject({ code: 'wrong-shape' });
  });

  it('coins that cannot carry the fee say so', async () => {
    const engine = engineOf();
    const orig = await origOf(engine);
    await expect(build(engine, orig, 900)).rejects.toMatchObject({ code: 'insufficient-funds' });
  });

  it('an engine that will not take the spent coins is not called a lack of funds', async () => {
    const engine = engineOf({}, { fail: new EngineError('UNKNOWN_UTXO', 'A chosen coin is no longer available.') });
    const orig = await origOf(engine);
    const err = await build(engine, orig).catch((e) => e);
    expect(err).toBeInstanceOf(ReplacementError);
    expect(err.code).toBe('coins-unavailable');
  });

  it('any other engine error passes through', async () => {
    const engine = engineOf({}, { fail: new EngineError('ADDRESS_CHECK_FAILED', 'Sending is paused for this vault') });
    const orig = await origOf(engine);
    await expect(build(engine, orig)).rejects.toThrow('Sending is paused for this vault');
  });
});

describe('what a rate pays on a rescue, before and after a build', () => {
  it('counts the coins until a build has answered', () => {
    expect(rescueSizeEstimate(2)).toBe(274);
    expect(rescueFeeAt(10, null, 2)).toBe(2_740);
  });

  it('takes the build’s own size at any other rate', () => {
    // The testnet rescue of 2026-10-31: 2,881 sats at the setting of 10.
    expect(rescueFeeAt(3, { rate: 10, sats: 2_881, size: 288.1 }, 2)).toBe(865);
  });

  it('takes the build’s own figure at its rate, which its size can read a satoshi high', () => {
    const fee = 2_003;
    const rate = 7;
    expect(Math.ceil(rate * (fee / rate))).toBe(2_004);
    expect(rescueFeeAt(rate, { rate, sats: fee, size: fee / rate }, 2)).toBe(fee);
  });

  it('counts the coins after a build that did not answer', () => {
    expect(rescueFeeAt(10, { rate: 10, sats: null, size: null }, 2)).toBe(2_740);
  });
});
