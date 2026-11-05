import {
  buildReplacement,
  cancelFigures,
  cancelRequest,
  checkBuiltFee,
  customRateProblem,
  customReplacementRow,
  dustFor,
  effectiveRate,
  EVERYDAY_SEQUENCE,
  feeFloor,
  feeRateOf,
  loadReplacementContext,
  minimumRate,
  pendingChildNow,
  originalOf,
  replacementBroadcastFailure,
  replacementBuildFailure,
  replacementEligibility,
  ReplacementError,
  replacementProblems,
  replacementRecord,
  replacementRows,
  replacementVsize,
  roundRateUp,
  speedUpFigures,
  speedUpRequest,
  speedUpShape,
} from '../replacement';
import type { OriginalTx, ReplacementContext } from '../replacement';
import { parseRawTransaction } from '../../bitcoin/rawTx';
import { scriptToAddress } from '../../bitcoin/psbt/parse';
import { encodeBase64 } from '../../bitcoin/psbt/export';
import { EngineError } from '../../bitcoin/engine/engineError';
import { FakeWalletEngine } from '../../bitcoin/engine/fakeEngine';
import type { FakeEngineOptions } from '../../bitcoin/engine/fakeEngine';
import type { BuildPsbtRequest, PsbtBuildResult, Utxo, WalletTx } from '../../bitcoin/engine/types';

// ---------------------------------------------------------------- bytes

const NET = 'testnet' as const;
const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number): number[] => [...u32(n % 0x100000000), ...u32(Math.floor(n / 0x100000000))];
const varint = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, (n >> 8) & 0xff]);
const le = (txid: string): number[] => (txid.match(/../g) as string[]).map((h) => parseInt(h, 16)).reverse();

const wpkh = (fill: number) => [0x00, 0x14, ...new Array(20).fill(fill)];
const tr = (fill: number) => [0x51, 0x20, ...new Array(32).fill(fill)];
const addr = (script: number[]) => scriptToAddress(Uint8Array.from(script), NET) as string;

/** A taproot script-path spend of a 2-of-2 multi_a leaf: two signatures, the leaf, the control block. */
const WITNESS = [
  new Array(64).fill(0xaa),
  new Array(64).fill(0xbb),
  new Array(70).fill(0x20),
  [0xc0, ...new Array(32).fill(0x01)],
];
const WITNESS_WU = 1 + WITNESS.reduce((s, w) => s + 1 + w.length, 0);

interface In {
  txid: string;
  vout: number;
  sequence?: number;
}
interface Out {
  script: number[];
  value: number;
}

function unsignedTx(ins: In[], outs: Out[]): number[] {
  return [
    ...u32(2),
    ...varint(ins.length),
    ...ins.flatMap((i) => [...le(i.txid), ...u32(i.vout), 0x00, ...u32(i.sequence ?? EVERYDAY_SEQUENCE)]),
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

function psbtOf(ins: In[], outs: Out[]): string {
  const t = unsignedTx(ins, outs);
  return encodeBase64(
    Uint8Array.from([
      0x70, 0x73, 0x62, 0x74, 0xff,
      0x01, 0x00, ...varint(t.length), ...t, 0x00,
      ...ins.map(() => 0x00),
      ...outs.map(() => 0x00),
    ]),
  );
}

// ---------------------------------------------------------------- the vault

const RECV = tr(0x11); // the vault's receive address, holding both coins
const CHANGE = tr(0x33); // the original's change
const DRAIN = tr(0x44); // the fresh change address a cancel pays
const NEWCHANGE = tr(0x55); // where the stand-in BDK sends a speed-up's change
const PAYEE = wpkh(0x22);
const PAYEE_2 = wpkh(0x77);
const STRANGER = wpkh(0x66);
const NOT_OURS = wpkh(0x99);
const SCRIPTS: Record<string, number[]> = Object.fromEntries(
  [RECV, CHANGE, DRAIN, NEWCHANGE, PAYEE, PAYEE_2, STRANGER, NOT_OURS].map((s) => [addr(s), s]),
);

const F1 = '1'.repeat(64);
const F2 = '2'.repeat(64);
const ORIG = '0b'.repeat(32);
const CHILD = '0c'.repeat(32);
const TOTAL_IN = 150_000;
const OLD_RATE = 5;

/**
 * Stands in for BDK: builds a REAL unsigned PSBT from the request, at the
 * rate (sized a few vB over the true size, as BDK's worst-case estimate is)
 * or at the absolute fee, sending any change to NEWCHANGE.
 */
class BuildingEngine extends FakeWalletEngine {
  readonly requests: BuildPsbtRequest[] = [];
  private coinValues: Record<string, number>;
  private overshoot: number;
  private tweak?: (ins: In[], outs: Out[]) => void;
  private fail?: Error;

  constructor(
    options: FakeEngineOptions,
    coinValues: Record<string, number>,
    behaviour: { overshoot?: number; tweak?: (ins: In[], outs: Out[]) => void; fail?: Error } = {},
  ) {
    super(NET, options);
    this.coinValues = coinValues;
    this.overshoot = behaviour.overshoot ?? 3;
    this.tweak = behaviour.tweak;
    this.fail = behaviour.fail;
  }

  async buildPsbt(req: BuildPsbtRequest): Promise<PsbtBuildResult> {
    this.requests.push(req);
    if (this.fail) throw this.fail;
    const ins: In[] = (req.utxos ?? []).map((u) => ({ txid: u.txid, vout: u.vout }));
    const totalIn = ins.reduce((s, i) => s + this.coinValues[`${i.txid}:${i.vout}`], 0);
    const size = (outs: Out[]) =>
      Math.ceil((4 * unsignedTx(ins, outs).length + 2 + ins.length * WITNESS_WU) / 4) + this.overshoot;
    let outs: Out[];
    if (req.drain) {
      const target = { script: SCRIPTS[req.recipients[0].address], value: 0 };
      const fee = req.feeAbsolute ?? Math.ceil(req.feeRate * size([target]));
      target.value = totalIn - fee;
      if (target.value < 330) {
        throw new Error(`Insufficient funds: ${Math.max(0, target.value)} sat available of 330 sat needed`);
      }
      outs = [target];
    } else {
      outs = req.recipients.map((r) => ({ script: SCRIPTS[r.address], value: r.amountSats }));
      const change = { script: NEWCHANGE, value: 0 };
      const fee = req.feeAbsolute ?? Math.ceil(req.feeRate * size([...outs, change]));
      const left = totalIn - outs.reduce((s, o) => s + o.value, 0) - fee;
      if (left < 0) throw new Error(`Insufficient funds: ${totalIn} sat available of ${totalIn - left} sat needed`);
      if (left >= 330) outs.push({ ...change, value: left });
    }
    this.tweak?.(ins, outs);
    const out = outs.reduce((s, o) => s + o.value, 0);
    return { psbtBase64: psbtOf(ins, outs), txid: 'e'.repeat(64), feeSats: totalIn - out, sentSats: 0 };
  }
}

type Shape = 'change' | 'send-all' | 'batch' | 'self';

interface ScenarioOpts {
  shape?: Shape;
  sequence?: number;
  foreignCoin?: boolean;
  unknownCoin?: boolean;
  child?: boolean;
  /** Another waiting transaction of the vault whose bytes cannot be read. */
  unreadablePending?: boolean;
  confirmed?: boolean;
  incoming?: boolean;
  noRaw?: boolean;
  /** The payment went to one of the vault's own receive addresses. */
  ownPayee?: boolean;
  behaviour?: ConstructorParameters<typeof BuildingEngine>[2];
}

/** A waiting payment of 120,000 sats from two coins (100,000 + 50,000) at 5 sat/vB. */
function scenario(o: ScenarioOpts = {}) {
  const shape = o.shape ?? 'change';
  const f1 = rawTx([{ txid: '9'.repeat(64), vout: 0, sequence: 0xffffffff }], [{ script: RECV, value: 100_000 }]);
  const f2 = rawTx(
    [{ txid: '8'.repeat(64), vout: 0, sequence: 0xffffffff }],
    [{ script: STRANGER, value: 7_000 }, { script: o.foreignCoin ? NOT_OURS : RECV, value: 50_000 }],
  );
  const ins: In[] = [
    { txid: F1, vout: 0, sequence: o.sequence },
    { txid: F2, vout: 1, sequence: o.sequence },
  ];
  const outsWith = (x: number): Out[] =>
    shape === 'change'
      ? [{ script: PAYEE, value: 120_000 }, { script: CHANGE, value: x }]
      : shape === 'send-all'
        ? [{ script: PAYEE, value: x }]
        : shape === 'batch'
          ? [{ script: PAYEE, value: 60_000 }, { script: PAYEE_2, value: x }]
          : [{ script: CHANGE, value: x }];
  const vsize = parseRawTransaction(rawTx(ins, outsWith(0)), NET).vsize;
  const fee = Math.ceil(OLD_RATE * vsize);
  const fixed = outsWith(0).reduce((s, x) => s + x.value, 0);
  const last = TOTAL_IN - fixed - fee;
  const origBytes = rawTx(ins, outsWith(last));

  const ownVout = shape === 'change' ? 1 : shape === 'self' ? 0 : null;
  const utxos: Utxo[] =
    ownVout == null
      ? []
      : [{ txid: ORIG, vout: ownVout, valueSats: last, address: addr(CHANGE), keychain: 'internal' }];
  const received = o.incoming ? 120_000 : ownVout == null ? 0 : last;
  const sent = o.incoming ? 0 : o.foreignCoin ? 100_000 : TOTAL_IN;
  const tx: WalletTx = {
    txid: ORIG,
    received,
    sent,
    netAmount: received - sent,
    fee,
    confirmed: !!o.confirmed,
    ...(o.confirmed ? { blockHeight: 900_000 } : {}),
  };
  const transactions: WalletTx[] = [tx];
  const rawTxs: Record<string, Uint8Array> = { [F1]: f1 };
  if (!o.unknownCoin) rawTxs[F2] = f2;
  if (!o.noRaw) rawTxs[ORIG] = origBytes;
  if (o.child) {
    rawTxs[CHILD] = rawTx([{ txid: ORIG, vout: 1 }], [{ script: PAYEE, value: 20_000 }]);
    transactions.unshift({ txid: CHILD, received: 0, sent: last, netAmount: -last, fee: 200, confirmed: false });
  }
  if (o.unreadablePending) {
    transactions.unshift({ txid: 'd'.repeat(64), received: 0, sent: 9_000, netAmount: -9_000, fee: 200, confirmed: false });
  }
  const engine = new BuildingEngine(
    {
      transactions,
      rawTxs,
      utxos,
      addresses: [addr(DRAIN), addr(RECV), addr(CHANGE), addr(NEWCHANGE), ...(o.ownPayee ? [addr(PAYEE)] : [])],
    },
    { [`${F1}:0`]: 100_000, [`${F2}:1`]: 50_000 },
    o.behaviour,
  );
  return { engine, fee, vsize, last, raw: parseRawTransaction(origBytes, NET) };
}

async function load(o: ScenarioOpts = {}) {
  const s = scenario(o);
  const ctx = await loadReplacementContext(s.engine, ORIG);
  return { ...s, ctx, orig: originalOf(ctx) };
}

// ---------------------------------------------------------------- tests

describe('who can be sped up or cancelled', () => {
  it("a waiting payment of the vault's own coins on the everyday path: both", async () => {
    const { ctx } = await load();
    expect(ctx.changeVouts).toEqual([1]);
    expect(ctx.spent.every((c) => c?.mine)).toBe(true);
    expect(replacementEligibility(ctx)).toEqual({ cannot: null, speedUp: true, cancel: true });
  });

  it('money in, a confirmed payment, or one already replaced: neither', async () => {
    expect(replacementEligibility((await load({ incoming: true })).ctx).cannot).toBe('incoming');
    expect(replacementEligibility((await load({ confirmed: true })).ctx).cannot).toBe('confirmed');
    expect(replacementEligibility((await load()).ctx, { replacedBy: CHILD }).cannot).toBe('replaced');
  });

  it('does not read the coins of a transaction that cannot be replaced anyway', async () => {
    const { ctx } = await load({ confirmed: true });
    expect(ctx.raw).not.toBeNull();
    expect(ctx.spent).toEqual([]);
  });

  it('a transaction it cannot read: missing data', async () => {
    expect(replacementEligibility((await load({ noRaw: true })).ctx).cannot).toBe('missing-data');
  });

  it('sent without the option to replace it', async () => {
    const { ctx } = await load({ sequence: 0xfffffffe });
    expect(replacementEligibility(ctx).cannot).toBe('not-signalled');
  });

  it("a coin that is not the vault's says so; one of its own it cannot read says nothing", async () => {
    expect(replacementEligibility((await load({ foreignCoin: true })).ctx).cannot).toBe('foreign-coins');
    // BDK counts both coins as the vault's (sent = every coin in), but one
    // cannot be read: never blamed on someone else's coins.
    expect(replacementEligibility((await load({ unknownCoin: true })).ctx).cannot).toBe('missing-data');
    // A joint payment whose stranger's coin cannot be read: BDK's own
    // coins are all accounted for, so the other one is not the vault's.
    expect(
      replacementEligibility((await load({ foreignCoin: true, unknownCoin: true })).ctx).cannot,
    ).toBe('foreign-coins');
  });

  it('spent through a path with a wait (an heir or the rescue key; decided 2026-09-28)', async () => {
    // older(52560) rides in the nSequence, which also signals replaceability.
    const { ctx } = await load({ sequence: 52_560 });
    expect(replacementEligibility(ctx).cannot).toBe('recovery-path');
  });

  it('a waiting transaction spends from it', async () => {
    const { ctx } = await load({ child: true });
    expect(ctx.hasPendingChild).toBe(true);
    expect(replacementEligibility(ctx).cannot).toBe('has-child');
  });

  it('a waiting transaction it cannot read: no child is ruled out, so nothing is offered', async () => {
    const { ctx } = await load({ unreadablePending: true });
    expect(ctx.hasPendingChild).toBeNull();
    expect(replacementEligibility(ctx).cannot).toBe('missing-data');
    // A child it CAN read still wins, whatever else is unreadable.
    const both = await load({ unreadablePending: true, child: true });
    expect(both.ctx.hasPendingChild).toBe(true);
    expect(replacementEligibility(both.ctx).cannot).toBe('has-child');
    // And a vault with nothing else waiting has no child.
    expect((await load()).ctx.hasPendingChild).toBe(false);
  });

  it('asks again right before a replacement goes out: a child that appeared since, or one it cannot read', async () => {
    expect(await pendingChildNow(scenario().engine, ORIG)).toBe(false);
    expect(await pendingChildNow(scenario({ child: true }).engine, ORIG)).toBe(true);
    expect(await pendingChildNow(scenario({ child: true }).engine, ORIG.toUpperCase())).toBe(true);
    expect(await pendingChildNow(scenario({ unreadablePending: true }).engine, ORIG)).toBeNull();
    // Confirmed or gone: nothing waiting goes with it; the broadcast says what happened.
    expect(await pendingChildNow(scenario({ confirmed: true, child: true }).engine, ORIG)).toBe(false);
    expect(await pendingChildNow(scenario({ child: true }).engine, 'f'.repeat(64))).toBe(false);
    // An engine that has not synced this launch lists nothing: not "no
    // child", but cannot be told, so the send waits.
    const cold = scenario({ child: true }).engine;
    cold.getTipHeight = () => undefined;
    expect(await pendingChildNow(cold, ORIG)).toBeNull();
    // A vault it cannot list: cannot be told.
    const broken = scenario().engine;
    broken.listTransactions = () => Promise.reject(new Error('bridge'));
    expect(await pendingChildNow(broken, ORIG)).toBeNull();
  });

  it('several recipients and no change: cancel only', async () => {
    const e = replacementEligibility((await load({ shape: 'batch' })).ctx);
    expect(e).toEqual({ cannot: null, speedUp: false, noSpeedUp: 'batch-without-change', cancel: true });
  });

  it('a return is sped up, never cancelled', async () => {
    const { ctx } = await load({ shape: 'self' });
    expect(replacementEligibility(ctx, { isReturn: true })).toMatchObject({
      speedUp: true,
      cancel: false,
      noCancel: 'is-return',
    });
    // A refresh (every output the vault's own) has nothing to cancel either.
    expect(replacementEligibility(ctx)).toMatchObject({ speedUp: true, cancel: false, noCancel: 'self-transfer' });
  });

  it('refuses a payment to a script with no address', () => {
    const ctx: ReplacementContext = {
      txid: ORIG,
      tx: { txid: ORIG, received: 0, sent: 10, netAmount: -10, confirmed: false },
      raw: {
        txid: '',
        unsignedTxid: '',
        sizeBytes: 100,
        weight: 400,
        vsize: 100,
        hex: '',
        inputs: [{ txid: F1, vout: 0, address: null, sequence: EVERYDAY_SEQUENCE }],
        outputs: [{ address: null, valueSats: 0, scriptLength: 40, scriptHex: '' }],
        version: 2,
        lockTime: 0,
      },
      spent: [{ txid: F1, vout: 0, valueSats: 10, address: addr(RECV), scriptLength: 34, mine: true }],
      changeVouts: [],
      ownReceiveVouts: [],
      hasPendingChild: false,
    };
    expect(replacementEligibility(ctx).cannot).toBe('unreadable');
  });
});

describe('the original', () => {
  it('reads its fee, real size, rate, recipients and change from its own bytes', async () => {
    const { orig, fee, vsize, last, raw } = await load();
    expect(orig).not.toBeNull();
    const o = orig as OriginalTx;
    expect(o.totalInSats).toBe(TOTAL_IN);
    expect(o.feeSats).toBe(fee);
    expect(o.vsize).toBe(vsize);
    expect(o.weight).toBe(raw.weight);
    expect(o.feeRate).toBeCloseTo(OLD_RATE, 1);
    expect(o.recipients).toEqual([{ address: addr(PAYEE), amountSats: 120_000 }]);
    expect(o.paymentSats).toBe(120_000);
    expect(o.changeSats).toBe(last);
    expect(o.ownScriptLength).toBe(34);
    expect(o.coins).toEqual([
      { txid: F1, vout: 0, valueSats: 100_000 },
      { txid: F2, vout: 1, valueSats: 50_000 },
    ]);
  });

  it("is unknown without every coin, but its rate still reads from BDK's fee (for the ETA)", async () => {
    const { ctx, fee, vsize } = await load({ unknownCoin: true });
    expect(originalOf(ctx)).toBeNull();
    expect(feeRateOf(ctx)).toBeCloseTo(fee / vsize, 6);
  });
});

describe('the fee floor', () => {
  it('rounds the minimum up to the precision the app shows', () => {
    expect(roundRateUp(1.284)).toBe(1.3);
    expect(roundRateUp(1.3)).toBe(1.3);
    expect(roundRateUp(1.30004)).toBe(1.4);
    expect(roundRateUp(9.95)).toBe(10);
    expect(roundRateUp(12.3)).toBe(13);
    expect(minimumRate(0.284)).toBe(1.3);
    expect(minimumRate(5)).toBe(6);
    expect(minimumRate(11.2)).toBe(13);
    expect(effectiveRate(2, 6)).toBe(6);
    expect(effectiveRate(12, 6)).toBe(12);
  });

  it("measures the replacement on the original's real size with its outputs swapped", async () => {
    const o = (await load()).orig as OriginalTx;
    // Same outputs (the new change is the same kind of address): same size.
    expect(replacementVsize(o, [22, 34])).toBe(o.vsize);
    // A cancel pays one taproot output instead of a P2WPKH (31 bytes) and a taproot (43).
    expect(replacementVsize(o, [34])).toBe(Math.ceil((o.weight - 4 * 31) / 4));
  });

  it('asks for the old fee plus 1 sat/vB of the new size, with a vB of room per coin', () => {
    expect(feeFloor(1_000, 150)).toBe(1_150);
    expect(feeFloor(1_000, 150, 2)).toBe(1_152);
  });

  it('knows the dust of each output kind', () => {
    expect(dustFor(22)).toBe(294);
    expect(dustFor(34)).toBe(330);
    expect(dustFor(25)).toBe(546);
  });
});

describe('speed up', () => {
  it('pays the same recipients from the same coins; BDK adds the change', async () => {
    const o = (await load()).orig as OriginalTx;
    expect(speedUpShape(o)).toBe('change');
    expect(speedUpRequest(o, 6)).toEqual({
      utxos: [
        { txid: F1, vout: 0 },
        { txid: F2, vout: 1 },
      ],
      recipients: [{ address: addr(PAYEE), amountSats: 120_000 }],
      feeRate: 6,
      // The payment it replaces, for the new library.
      replacing: [o.txid],
    });
    expect(speedUpRequest(o, 6, 1_500).feeAbsolute).toBe(1_500);
  });

  it('costs the extra fee out of the change, the recipient unchanged', async () => {
    const o = (await load()).orig as OriginalTx;
    const f = speedUpFigures(o, 12)!;
    expect(f.vsize).toBe(o.vsize);
    expect(f.feeSats).toBe(Math.ceil(12 * o.vsize));
    expect(f.extraSats).toBe(f.feeSats - o.feeSats);
    expect(f.recipientSats).toBe(120_000);
    expect(f.affordable).toBe(true);
    // At the minimum the floor, not the rate, sets the fee (a vB of room per coin).
    const atMin = speedUpFigures(o, minimumRate(o.feeRate))!;
    expect(atMin.feeSats).toBe(feeFloor(o.feeSats, o.vsize, 2));
  });

  it('drops a change too small to keep, and says when the change cannot carry the fee', async () => {
    const base = (await load()).orig as OriginalTx;
    const small: OriginalTx = {
      ...base,
      outputs: base.outputs.map((x) => (x.change ? { ...x, valueSats: 600 } : x)),
      changeSats: 600,
      totalInSats: 120_000 + 600 + base.feeSats,
    };
    const f = speedUpFigures(small, 6)!;
    expect(f.vsize).toBe(replacementVsize(small, [22]));
    expect(f.feeSats).toBe(600 + base.feeSats);
    expect(f.affordable).toBe(true);
    expect(speedUpFigures(small, 40)!.affordable).toBe(false);
  });

  it('a send-all is rebuilt as a send-all: the recipient receives less (decided 2026-09-28)', async () => {
    const { orig, last } = await load({ shape: 'send-all' });
    const o = orig as OriginalTx;
    expect(speedUpShape(o)).toBe('send-all');
    expect(speedUpRequest(o, 8)).toMatchObject({
      recipients: [{ address: addr(PAYEE), amountSats: 0 }],
      drain: true,
    });
    const f = speedUpFigures(o, 8)!;
    expect(f.recipientSats).toBe(TOTAL_IN - f.feeSats);
    expect(f.recipientSats).toBe(last - f.extraSats);
  });

  it('a refresh or a return goes back to the same own address', async () => {
    const o = (await load({ shape: 'self' })).orig as OriginalTx;
    expect(speedUpShape(o)).toBe('self');
    expect(speedUpRequest(o, 8)).toMatchObject({ recipients: [{ address: addr(CHANGE), amountSats: 0 }], drain: true });
  });

  it('several recipients and no change cannot be sped up', async () => {
    const o = (await load({ shape: 'batch' })).orig as OriginalTx;
    expect(speedUpShape(o)).toBeNull();
    expect(speedUpFigures(o, 8)).toBeNull();
    expect(() => speedUpRequest(o, 8)).toThrow(ReplacementError);
  });
});

describe('cancel', () => {
  it('drains every coin to one fresh change address', async () => {
    const o = (await load()).orig as OriginalTx;
    expect(cancelRequest(o, addr(DRAIN), 6)).toEqual({
      utxos: [
        { txid: F1, vout: 0 },
        { txid: F2, vout: 1 },
      ],
      recipients: [{ address: addr(DRAIN), amountSats: 0 }],
      drain: true,
      feeRate: 6,
      replacing: [o.txid],
    });
  });

  it("leads with the payment's amount and shows the fee (decided 2026-09-28)", async () => {
    const o = (await load()).orig as OriginalTx;
    const f = cancelFigures(o, 20);
    expect(f.paymentSats).toBe(120_000);
    expect(f.vsize).toBe(replacementVsize(o, [34]));
    expect(f.feeSats).toBe(Math.ceil(20 * f.vsize));
    expect(f.returnedSats).toBe(TOTAL_IN - f.feeSats);
    expect(f.affordable).toBe(true);
  });

  it('is smaller than the payment it replaces, so at the minimum rate the floor sets its fee', async () => {
    const o = (await load()).orig as OriginalTx;
    const f = cancelFigures(o, minimumRate(o.feeRate));
    expect(Math.ceil(minimumRate(o.feeRate) * f.vsize)).toBeLessThan(feeFloor(o.feeSats, f.vsize, 2));
    expect(f.feeSats).toBe(feeFloor(o.feeSats, f.vsize, 2));
    expect(f.feeSats).toBeGreaterThan(o.feeSats);
  });
});

describe('the sheet rows', () => {
  const presets = { fast: 20, medium: 10, slow: 3 };

  it('speed up: High, Medium, Slow with the extra fee, a tier under the minimum muted', async () => {
    const o = (await load()).orig as OriginalTx;
    const rows = replacementRows(o, 'speedup', presets);
    expect(rows.map((r) => [r.label, r.eta])).toEqual([
      ['High', 'about 10 minutes'],
      ['Medium', 'about 30 minutes'],
      ['Slow', 'about an hour'],
    ]);
    expect(rows.map((r) => r.belowMinimum)).toEqual([false, false, true]);
    expect(rows[2].rate).toBe(3);
    expect(rows[2].buildRate).toBe(6);
    for (const r of rows) {
      expect(r.costSats).toBe(r.extraSats);
      expect(r.extraSats).toBe(r.feeSats - o.feeSats);
      expect(r.recipientSats).toBe(120_000);
    }
    expect(rows[0].costSats).toBeGreaterThan(rows[1].costSats);
  });

  it('cancel: the whole fee in the right column, and what comes back', async () => {
    const o = (await load()).orig as OriginalTx;
    const rows = replacementRows(o, 'cancel', presets);
    for (const r of rows) {
      expect(r.costSats).toBe(r.feeSats);
      expect(r.returnedSats).toBe(TOTAL_IN - r.feeSats);
      expect(r.recipientSats).toBe(120_000);
    }
  });

  it('mutes a tier AT the minimum too, as the design says', async () => {
    const o = (await load()).orig as OriginalTx;
    const rows = replacementRows(o, 'speedup', { fast: 20, medium: 6, slow: 3 });
    expect(rows[1].belowMinimum).toBe(true);
  });

  it('Custom: at least the minimum, at most MAX_FEE_RATE', async () => {
    const o = (await load()).orig as OriginalTx;
    expect(customReplacementRow(o, 'speedup', 5.9)).toBeNull();
    const row = customReplacementRow(o, 'speedup', 6)!;
    expect(row).toMatchObject({ key: 'custom', label: 'Custom', eta: null, belowMinimum: false, buildRate: 6 });
    expect(customRateProblem(NaN, 6)).toBe('invalid');
    expect(customRateProblem(5.9, 6)).toBe('below-minimum');
    expect(customRateProblem(2_001, 6)).toBe('too-high');
    expect(customRateProblem(6, 6)).toBeNull();
  });
});

describe('checking a built replacement', () => {
  it('asks for an absolute fee when the rate alone falls under the floor', async () => {
    const o = (await load()).orig as OriginalTx;
    const outs = [{ script: DRAIN, value: 0 }];
    const size = replacementVsize(o, [34]);
    const low = TOTAL_IN - (o.feeSats + 10);
    const built = { psbtBase64: psbtOf(o.coins, [{ ...outs[0], value: low }]), feeSats: o.feeSats + 10 };
    const check = checkBuiltFee(o, built, minimumRate(o.feeRate));
    expect(check).toEqual({ ok: false, newVsize: size, requiredFeeSats: feeFloor(o.feeSats, size, 2) });
    const enough = check.requiredFeeSats;
    const ok = checkBuiltFee(
      o,
      { psbtBase64: psbtOf(o.coins, [{ script: DRAIN, value: TOTAL_IN - enough }]), feeSats: enough },
      minimumRate(o.feeRate),
    );
    expect(ok.ok).toBe(true);
  });

  it('refuses anything but the replacement asked for', async () => {
    const o = (await load()).orig as OriginalTx;
    const good = psbtOf(o.coins, [
      { script: PAYEE, value: 120_000 },
      { script: NEWCHANGE, value: 1_000 },
    ]);
    expect(replacementProblems(o, 'speedup', good, NET)).toEqual([]);
    const extraCoin = psbtOf([...o.coins, { txid: '7'.repeat(64), vout: 0 }], [{ script: PAYEE, value: 120_000 }]);
    expect(replacementProblems(o, 'speedup', extraCoin, NET)).toHaveLength(1);
    const paysLess = psbtOf(o.coins, [{ script: PAYEE, value: 119_000 }]);
    expect(replacementProblems(o, 'speedup', paysLess, NET)[0]).toMatch(/same amount/);
    const twoBack = psbtOf(o.coins, [
      { script: DRAIN, value: 100 },
      { script: DRAIN, value: 100 },
    ]);
    expect(replacementProblems(o, 'cancel', twoBack, NET, addr(DRAIN))).toHaveLength(1);
    expect(replacementProblems(o, 'cancel', 'not a psbt', NET)).toEqual(['the rebuilt payment cannot be read']);
  });
});

describe('buildReplacement', () => {
  it('builds a speed-up once when the rate clears the floor', async () => {
    const { engine, orig } = await load();
    const o = orig as OriginalTx;
    const r = await buildReplacement(engine, o, 'speedup', 12);
    expect(engine.requests).toHaveLength(1);
    expect(r.usedAbsoluteFee).toBe(false);
    expect(r.rate).toBe(12);
    expect(r.recipientSats).toBe(120_000);
    expect(r.extraSats).toBe(r.feeSats - o.feeSats);
    expect(r.feeSats).toBeGreaterThanOrEqual(feeFloor(o.feeSats, o.vsize, 2));
    // What leaves the vault: the payment and the new fee (the page's stand-in).
    expect(r.sentSats).toBe(120_000 + r.feeSats);
  });

  it('never builds under the minimum, whatever was chosen', async () => {
    const { engine, orig } = await load();
    const r = await buildReplacement(engine, orig as OriginalTx, 'speedup', 1);
    expect(r.rate).toBe(6);
    expect(engine.requests[0].feeRate).toBe(6);
  });

  it('rebuilds a cancel with an absolute fee: at the higher rate it would still pay less in total', async () => {
    const { engine, orig } = await load();
    const o = orig as OriginalTx;
    const r = await buildReplacement(engine, o, 'cancel', minimumRate(o.feeRate));
    const size = replacementVsize(o, [34]);
    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[0].feeAbsolute).toBeUndefined();
    expect(engine.requests[1].feeAbsolute).toBe(feeFloor(o.feeSats, size, 2));
    expect(r.usedAbsoluteFee).toBe(true);
    expect(r.feeSats).toBe(feeFloor(o.feeSats, size, 2));
    expect(r.drainAddress).toBe(addr(DRAIN));
    expect(r.returnedSats).toBe(TOTAL_IN - r.feeSats);
    expect(r.recipientSats).toBe(120_000);
    // Every coin comes back: only the fee leaves the vault.
    expect(r.sentSats).toBe(r.feeSats);
  });

  it('a send-all speed-up tells what the recipient now receives', async () => {
    const { engine, orig, last } = await load({ shape: 'send-all' });
    const r = await buildReplacement(engine, orig as OriginalTx, 'speedup', 12);
    expect(r.recipientSats).toBe(TOTAL_IN - r.feeSats);
    expect(r.recipientSats).toBeLessThan(last);
    // Every coin still leaves: the fee now comes out of the payment.
    expect(r.sentSats).toBe(TOTAL_IN);
  });

  it('a payment to the vault’s own address never leaves it: only the fee does', async () => {
    const { engine, orig } = await load({ ownPayee: true });
    const r = await buildReplacement(engine, orig as OriginalTx, 'speedup', 12);
    expect(r.recipientSats).toBe(120_000);
    expect(r.sentSats).toBe(r.feeSats);
  });

  it('a sped-up refresh keeps every coin: only its fee leaves the vault', async () => {
    const { engine, orig } = await load({ shape: 'self' });
    const r = await buildReplacement(engine, orig as OriginalTx, 'speedup', 12);
    expect(r.sentSats).toBe(r.feeSats);
  });

  it('turns BDK running short into "Not enough left for a higher fee"', async () => {
    const { engine, orig } = await load({
      behaviour: { fail: new Error('Insufficient funds: 150000 sat available of 181752 sat needed') },
    });
    await expect(buildReplacement(engine, orig as OriginalTx, 'speedup', 12)).rejects.toMatchObject({
      code: 'insufficient-funds',
    });
  });

  it('never calls coins BDK did not count a lack of funds (an open risk since 2026-07-19)', async () => {
    const { engine, orig } = await load({
      behaviour: { fail: new Error('Insufficient funds: 0 sat available of 121752 sat needed') },
    });
    await expect(buildReplacement(engine, orig as OriginalTx, 'speedup', 12)).rejects.toMatchObject({
      code: 'coins-unavailable',
    });
    // A cancel that truly cannot pay its fee is still a lack of funds.
    const o = orig as OriginalTx;
    const broke = replacementBuildFailure(
      new Error('Insufficient funds: 0 sat available of 330 sat needed'),
      { ...o, totalInSats: o.feeSats + 200, coins: o.coins },
      'cancel',
      minimumRate(o.feeRate),
    );
    expect(broke).toMatchObject({ code: 'insufficient-funds' });
    // Anything else passes through untouched.
    const other = new Error('Electrum timeout');
    expect(replacementBuildFailure(other, o, 'speedup', 12)).toBe(other);
  });

  it('a coded engine refusing the coins (UNKNOWN_UTXO) is coins-unavailable; 0.28 text is unchanged', async () => {
    const { engine, orig } = await load({
      behaviour: { fail: new EngineError('UNKNOWN_UTXO', 'UTXO not found in the internal database') },
    });
    await expect(buildReplacement(engine, orig as OriginalTx, 'speedup', 12)).rejects.toMatchObject({
      code: 'coins-unavailable',
    });
    const o = orig as OriginalTx;
    for (const kind of ['speedup', 'cancel'] as const) {
      // The new bridge's rejection shape: a plain error carrying our code.
      const bridged = Object.assign(new Error('UTXO not found in the internal database'), { code: 'UNKNOWN_UTXO' });
      expect(replacementBuildFailure(bridged, o, kind, 12)).toMatchObject({ code: 'coins-unavailable' });
      // 0.28 says the same words with no code: it passes through as before.
      const old = new Error('UTXO not found in the internal database');
      expect(replacementBuildFailure(old, o, kind, 12)).toBe(old);
    }
  });

  it('refuses a build that pulls in another coin', async () => {
    const { engine, orig } = await load({
      behaviour: { tweak: (ins) => ins.push({ txid: '7'.repeat(64), vout: 0 }) },
    });
    await expect(buildReplacement(engine, orig as OriginalTx, 'speedup', 12)).rejects.toMatchObject({
      code: 'wrong-shape',
    });
  });

  it('refuses a build whose change does not come back to the vault', async () => {
    const { engine, orig } = await load({
      behaviour: {
        tweak: (_ins, outs) => {
          const change = outs.find((x) => x.script === NEWCHANGE);
          if (change) change.script = STRANGER;
        },
      },
    });
    await expect(buildReplacement(engine, orig as OriginalTx, 'speedup', 12)).rejects.toMatchObject({
      code: 'wrong-shape',
    });
  });

  it('refuses to speed up a payment with no change to pay from', async () => {
    const { engine, orig } = await load({ shape: 'batch' });
    await expect(buildReplacement(engine, orig as OriginalTx, 'speedup', 12)).rejects.toMatchObject({
      code: 'not-eligible',
    });
    expect(engine.requests).toHaveLength(0);
  });
});

describe('after the broadcast', () => {
  it("reads the server's refusal in the page's terms", () => {
    expect(
      replacementBroadcastFailure(new Error('the transaction was rejected by network rules.\n\nbad-txns-inputs-missingorspent')),
    ).toBe('already-confirmed');
    expect(replacementBroadcastFailure('Missing inputs')).toBe('already-confirmed');
    expect(
      replacementBroadcastFailure(
        new Error('insufficient fee, rejecting replacement abc; not enough additional fees to relay; 0.00000146 < 0.00000147'),
      ),
    ).toBe('fee-too-low');
    expect(replacementBroadcastFailure(new Error('connection reset'))).toBe('other');
  });

  it('makes the record Talia keeps', async () => {
    const o = (await load()).orig as OriginalTx;
    expect(replacementRecord('vault-1', o, 'cancel', 'e'.repeat(64), 2_000, ' Rent ')).toEqual({
      walletId: 'vault-1',
      oldTxid: ORIG,
      newTxid: 'e'.repeat(64),
      kind: 'cancel',
      recipient: addr(PAYEE),
      amount: 120_000,
      note: 'Rent',
      oldFeeSats: o.feeSats,
      newFeeSats: 2_000,
    });
    expect(replacementRecord('vault-1', o, 'speedup', 'e'.repeat(64), 2_000, undefined, 122_000)).toMatchObject({
      newSentSats: 122_000,
    });
    expect(replacementRecord('vault-1', o, 'speedup', 'e'.repeat(64), 2_000)).not.toHaveProperty('newSentSats');
  });
});
