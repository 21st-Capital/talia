/**
 * Decided 2026-09-26: a transaction handed back
 * by a signer (file, QR) or by 21st Capital's rescue was broadcast without
 * proving it was the one the client asked for.
 */
import { FakeWalletEngine } from '../../engine/fakeEngine';
import { rawTxMatchesPsbt, psbtTxShape, rawTxShape, feeLooksAbsurd, BroadcastRefusedError, checkRescueOnChain } from '../broadcastCheck';
import { assertRescueOnChain } from '../../engine/engineShared';
import { encodeBase64, PSBT_MAGIC } from '../export';
import { scriptToAddress } from '../parse';
import { addressToScriptHex } from '../../addressNetwork';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

const NET = 'testnet' as const;
const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number) => [...u32(n % 2 ** 32), ...u32(Math.floor(n / 2 ** 32))];

interface In { txid: string; vout: number }
interface Out { script: Uint8Array; value: number }

function unsignedTx(ins: In[], outs: Out[]): number[] {
  return [
    ...u32(2),
    ins.length,
    ...ins.flatMap((i) => [...bytes(i.txid).reverse(), ...u32(i.vout), 0, ...u32(0xfffffffd)]),
    outs.length,
    ...outs.flatMap((o) => [...u64(o.value), o.script.length, ...o.script]),
    ...u32(0),
  ];
}

/** Witness serialization with one dummy 64-byte signature per input. */
function signedTx(ins: In[], outs: Out[]): Uint8Array {
  const plain = unsignedTx(ins, outs);
  const body = plain.slice(4, plain.length - 4);
  const witness = ins.flatMap(() => [1, 64, ...new Array(64).fill(7)]);
  return Uint8Array.from([...u32(2), 0, 1, ...body, ...witness, ...u32(0)]);
}

function psbtOf(ins: In[], outs: Out[]): string {
  const tx = unsignedTx(ins, outs);
  const global = [1, 0x00, ...(tx.length < 0xfd ? [tx.length] : [0xfd, tx.length & 0xff, tx.length >> 8]), ...tx, 0];
  const maps = [...ins.map(() => 0), ...outs.map(() => 0)];
  return encodeBase64(Uint8Array.from([...PSBT_MAGIC, ...global, ...maps]));
}

const P2WPKH = (b: number) => bytes('0014' + b.toString(16).padStart(2, '0').repeat(20));
const COIN_A = { txid: 'aa'.repeat(32), vout: 0 };
const COIN_B = { txid: 'bb'.repeat(32), vout: 1 };
const DEST = P2WPKH(0x11);
const OWN = P2WPKH(0x22);
const THIEF = P2WPKH(0x33);
const addr = (s: Uint8Array) => scriptToAddress(s, NET)!;

describe('a returned transaction must be the one reviewed', () => {
  it('the same spend, signed, matches its PSBT', () => {
    const outs = [{ script: DEST, value: 90_000 }];
    expect(rawTxMatchesPsbt(signedTx([COIN_A], outs), psbtOf([COIN_A], outs), NET)).toBe(true);
    expect(rawTxShape(signedTx([COIN_A], outs), NET)!.txid).toBe(psbtTxShape(psbtOf([COIN_A], outs))!.txid);
  });

  it('an older signed payment of the same coin does not', () => {
    const reviewed = psbtOf([COIN_A], [{ script: DEST, value: 90_000 }]);
    const older = signedTx([COIN_A], [{ script: THIEF, value: 90_000 }]);
    expect(rawTxMatchesPsbt(older, reviewed, NET)).toBe(false);
  });

  it('the engine refuses to broadcast it at the choke point', async () => {
    const engine = new FakeWalletEngine(NET);
    const reviewed = psbtOf([COIN_A], [{ script: DEST, value: 90_000 }]);
    const other = signedTx([COIN_A], [{ script: THIEF, value: 90_000 }]);
    await expect(
      engine.broadcastRawTx(other, { type: 'electrum', url: 'x' } as never, psbtTxShape(reviewed)!.txid),
    ).rejects.toBeInstanceOf(BroadcastRefusedError);
    const same = signedTx([COIN_A], [{ script: DEST, value: 90_000 }]);
    await expect(
      engine.broadcastRawTx(same, { type: 'electrum', url: 'x' } as never, psbtTxShape(reviewed)!.txid),
    ).resolves.toBe(psbtTxShape(reviewed)!.txid);
  });
});

describe('a rescue pays only what the client filed', () => {
  const engine = () =>
    new FakeWalletEngine(NET, {
      addresses: [addr(OWN)],
      utxos: [
        { txid: COIN_A.txid, vout: 0, valueSats: 60_000, keychain: 'external' },
        { txid: COIN_B.txid, vout: 1, valueSats: 40_000, keychain: 'external' },
      ],
    });
  const backend = { type: 'electrum', url: 'x' } as never;
  const destHex = addressToScriptHex(addr(DEST))!;
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return (e as BroadcastRefusedError).refusal?.code ?? 'other';
    }
  };

  it('sweeping this vault to the filed destination goes out', async () => {
    const tx = signedTx([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
    expect(await refusal(engine().broadcastRescue(tx, { destinationScriptHex: destHex }, backend))).toBeNull();
  });

  it("another request's rescue, to someone else, is refused", async () => {
    const tx = signedTx([COIN_A, COIN_B], [{ script: THIEF, value: 99_000 }]);
    expect(await refusal(engine().broadcastRescue(tx, { destinationScriptHex: destHex }, backend))).toBe(
      'wrong-destination',
    );
  });

  it('change back to the vault itself is fine', async () => {
    const tx = signedTx([COIN_A, COIN_B], [{ script: DEST, value: 50_000 }, { script: OWN, value: 49_000 }]);
    expect(await refusal(engine().broadcastRescue(tx, { destinationScriptHex: destHex }, backend))).toBeNull();
  });

  it("coins that are not this vault's are refused", async () => {
    const tx = signedTx([COIN_A, { txid: 'cc'.repeat(32), vout: 0 }], [{ script: DEST, value: 99_000 }]);
    expect(await refusal(engine().broadcastRescue(tx, { destinationScriptHex: destHex }, backend))).toBe(
      'foreign-coins',
    );
  });

  it('with a request PSBT on record, only that very transaction goes', async () => {
    const requested = psbtOf([COIN_A, COIN_B], [{ script: DEST, value: 99_500 }]);
    const tx = signedTx([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
    const requestTxid = psbtTxShape(requested)!.txid;
    expect(await refusal(engine().broadcastRescue(tx, { destinationScriptHex: destHex, requestTxid }, backend))).toBe(
      'different-tx',
    );
  });

  it('a legacy record with no destination asks, then goes once confirmed', async () => {
    const tx = signedTx([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
    expect(await refusal(engine().broadcastRescue(tx, {}, backend))).toBe('unconfirmed-destination');
    expect(await refusal(engine().broadcastRescue(tx, { confirmedScripts: [destHex] }, backend))).toBeNull();
  });

  it('an absurd fee needs the client to say so', async () => {
    const big = () =>
      new FakeWalletEngine(NET, {
        addresses: [addr(OWN)],
        utxos: [{ txid: COIN_A.txid, vout: 0, valueSats: 1_000_000, keychain: 'external' }],
      });
    const tx = signedTx([COIN_A], [{ script: DEST, value: 600_000 }]);
    expect(await refusal(big().broadcastRescue(tx, { destinationScriptHex: destHex }, backend))).toBe('high-fee');
    expect(
      await refusal(big().broadcastRescue(tx, { destinationScriptHex: destHex, acceptHighFee: true }, backend)),
    ).toBeNull();
  });
});

describe('a speed-up: the coins its waiting rescue already spent (decided 2026-10-31)', () => {
  const backend = { kind: 'electrum', url: 'x' } as never;
  const destHex = addressToScriptHex(addr(DEST))!;
  /** The vault lists nothing: the waiting rescue spent both coins. */
  const spent = () =>
    new FakeWalletEngine(NET, { addresses: [addr(OWN)], utxos: [] });
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return (e as BroadcastRefusedError).refusal?.code ?? 'other';
    }
  };
  const tx = signedTx([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
  const requestTxid = rawTxShape(tx, NET)!.unsignedTxid;
  const replacedCoins = [
    { ...COIN_A, valueSats: 60_000 },
    { ...COIN_B, valueSats: 40_000 },
  ];

  it('without the phone’s record of them, spent coins are not this vault’s', async () => {
    expect(await refusal(spent().broadcastRescue(tx, { destinationScriptHex: destHex, requestTxid }, backend))).toBe('foreign-coins');
  });

  it('goes out as the very transaction this phone prepared, with its coins on record', async () => {
    expect(await refusal(spent().broadcastRescue(tx, { destinationScriptHex: destHex, requestTxid, replacedCoins }, backend))).toBeNull();
  });

  it('the coins on record count only for that transaction: with none requested they do not count', async () => {
    expect(await refusal(spent().broadcastRescue(tx, { destinationScriptHex: destHex, replacedCoins }, backend))).toBe('foreign-coins');
  });

  it('another transaction over the same coins is refused', async () => {
    const other = signedTx([COIN_A, COIN_B], [{ script: DEST, value: 90_000 }]);
    expect(await refusal(spent().broadcastRescue(other, { destinationScriptHex: destHex, requestTxid, replacedCoins }, backend))).toBe('different-tx');
  });

  it('another address is refused, as for any rescue', async () => {
    const thief = signedTx([COIN_A, COIN_B], [{ script: THIEF, value: 99_000 }]);
    const id = rawTxShape(thief, NET)!.unsignedTxid;
    expect(await refusal(spent().broadcastRescue(thief, { destinationScriptHex: destHex, requestTxid: id, replacedCoins }, backend))).toBe('wrong-destination');
  });

  it('a coin that is not on record is refused', async () => {
    const more = signedTx([COIN_A, COIN_B, { txid: 'cc'.repeat(32), vout: 0 }], [{ script: DEST, value: 99_000 }]);
    const id = rawTxShape(more, NET)!.unsignedTxid;
    expect(await refusal(spent().broadcastRescue(more, { destinationScriptHex: destHex, requestTxid: id, replacedCoins }, backend))).toBe('foreign-coins');
  });
});

describe('decided 2026-10-19: a rescue the chain already has meets the same rule before it is called sent', () => {
  // Its coins are spent, so they are no longer listed: the vault's record
  // of the transaction (BDK's `sent`, and its fee) stands in for them.
  const engine = () => new FakeWalletEngine(NET, { addresses: [addr(OWN)], utxos: [] });
  const destHex = addressToScriptHex(addr(DEST))!;
  /** The vault's record: it took `sent` from the vault, with this fee. */
  const record = (sent: number, fee?: number) => ({ sent, fee });
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return (e as BroadcastRefusedError).refusal?.code ?? 'other';
    }
  };
  const shapeOf = (ins: In[], outs: Out[]) => rawTxShape(signedTx(ins, outs), NET);

  it('the vault swept to the filed destination: may be called sent', async () => {
    const shape = shapeOf([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
    expect(await refusal(assertRescueOnChain(engine(), shape, record(100_000, 1_000), { destinationScriptHex: destHex }))).toBeNull();
  });

  it('paying someone else is refused, as it was before it went out', async () => {
    const shape = shapeOf([COIN_A, COIN_B], [{ script: THIEF, value: 99_000 }]);
    expect(await refusal(assertRescueOnChain(engine(), shape, record(100_000, 1_000), { destinationScriptHex: destHex }))).toBe(
      'wrong-destination',
    );
  });

  it('change back to the vault is fine', async () => {
    const shape = shapeOf([COIN_A, COIN_B], [{ script: DEST, value: 50_000 }, { script: OWN, value: 49_000 }]);
    expect(await refusal(assertRescueOnChain(engine(), shape, record(100_000, 1_000), { destinationScriptHex: destHex }))).toBeNull();
  });

  it('it took less from the vault than it pays and costs, or the fee is unknown: a coin may be someone else’s', async () => {
    const shape = shapeOf([COIN_A, { txid: 'cc'.repeat(32), vout: 0 }], [{ script: DEST, value: 99_000 }]);
    expect(await refusal(assertRescueOnChain(engine(), shape, record(60_000, 1_000), { destinationScriptHex: destHex }))).toBe(
      'foreign-coins',
    );
    expect(await refusal(assertRescueOnChain(engine(), shape, record(100_000), { destinationScriptHex: destHex }))).toBe(
      'foreign-coins',
    );
    // A transaction that only paid INTO the vault took nothing from it.
    expect(await refusal(assertRescueOnChain(engine(), shape, record(0, 1_000), { destinationScriptHex: destHex }))).toBe(
      'foreign-coins',
    );
  });

  it('with a request PSBT on record, only that very transaction', async () => {
    const requested = psbtOf([COIN_A, COIN_B], [{ script: DEST, value: 99_500 }]);
    const shape = shapeOf([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
    const requestTxid = psbtTxShape(requested)!.txid;
    expect(
      await refusal(assertRescueOnChain(engine(), shape, record(100_000, 1_000), { destinationScriptHex: destHex, requestTxid })),
    ).toBe('different-tx');
  });

  it('a legacy record with no destination asks, then passes once confirmed', async () => {
    const shape = shapeOf([COIN_A, COIN_B], [{ script: DEST, value: 99_000 }]);
    expect(await refusal(assertRescueOnChain(engine(), shape, record(100_000, 1_000), {}))).toBe('unconfirmed-destination');
    expect(
      await refusal(assertRescueOnChain(engine(), shape, record(100_000, 1_000), { confirmedScripts: [destHex] })),
    ).toBeNull();
  });

  it('an absurd fee needs the client to say so', async () => {
    const shape = shapeOf([COIN_A], [{ script: DEST, value: 600_000 }]);
    expect(await refusal(assertRescueOnChain(engine(), shape, record(1_000_000, 400_000), { destinationScriptHex: destHex }))).toBe(
      'high-fee',
    );
    expect(
      await refusal(
        assertRescueOnChain(engine(), shape, record(1_000_000, 400_000), { destinationScriptHex: destHex, acceptHighFee: true }),
      ),
    ).toBeNull();
  });

  it('a transaction it cannot read is refused', async () => {
    expect(await refusal(assertRescueOnChain(engine(), null, record(100_000, 1_000), {}))).toBe('unreadable');
    const empty = { txid: 'ab'.repeat(32), unsignedTxid: 'ab'.repeat(32), inputs: [], outputs: [] };
    expect(checkRescueOnChain(empty, { ownScripts: new Set(), spentSats: 1, feeSats: 1 }, {})).toEqual({ code: 'unreadable' });
  });
});

describe('feeLooksAbsurd', () => {
  it('leaves a normal busy-network fee alone', () => {
    expect(feeLooksAbsurd(30_000, 1_000_000, 200)).toBe(false);
    expect(feeLooksAbsurd(7_000, 10_000, 140)).toBe(false); // high share, small amount
  });
  it('flags a rate above the ceiling and a large fee eating the coins', () => {
    expect(feeLooksAbsurd(500_000, 100_000_000, 200)).toBe(true);
    expect(feeLooksAbsurd(200_000, 1_000_000)).toBe(true);
  });
});

describe('psbtAbsurdFee (every broadcast screen asks it)', () => {
  const { psbtAbsurdFee } = require('../broadcastCheck') as typeof import('../broadcastCheck');
  /** One input worth `inSats` (witness UTXO), one output worth `outSats`. */
  const psbtPaying = (inSats: number, outSats: number): string => {
    const tx = unsignedTx([COIN_A], [{ script: DEST, value: outSats }]);
    const wu = [...u64(inSats), OWN.length, ...OWN];
    const input = [1, 0x01, wu.length, ...wu, 0];
    return encodeBase64(Uint8Array.from([...PSBT_MAGIC, 1, 0x00, tx.length, ...tx, 0, ...input, 0]));
  };
  it('a normal fee passes', () => {
    expect(psbtAbsurdFee(psbtPaying(1_000_000, 995_000))).toBeNull();
  });
  it('a fee eating most of the coin is named', () => {
    expect(psbtAbsurdFee(psbtPaying(1_000_000, 200_000))).toBe(800_000);
  });
  it('an unreadable PSBT asks nothing', () => {
    expect(psbtAbsurdFee('nope')).toBeNull();
  });
});

describe('the returned-transaction check: nested-segwit and legacy vaults', () => {
  // Real signatures, so the scriptSig is filled exactly as a signer fills it.
  const TEST = btc.TEST_NETWORK;
  const priv = bytes('01'.repeat(32));
  const pub = secp256k1.getPublicKey(priv, true);

  function spend(payment: { script: Uint8Array; redeemScript?: Uint8Array }, witnessUtxo: boolean) {
    const tx = new btc.Transaction({ allowLegacyWitnessUtxo: true });
    const prev = new btc.Transaction({ allowUnknownOutputs: true });
    prev.addInput({ txid: bytes('cc'.repeat(32)), index: 0 });
    prev.addOutput({ script: payment.script, amount: 100_000n });
    const prevRaw = prev.toBytes(true, false);
    tx.addInput({
      txid: sha256(sha256(prevRaw)).reverse(),
      index: 0,
      ...(witnessUtxo
        ? { witnessUtxo: { script: payment.script, amount: 100_000n } }
        : { nonWitnessUtxo: prevRaw }),
      ...(payment.redeemScript ? { redeemScript: payment.redeemScript } : {}),
    });
    tx.addOutput({ script: DEST, amount: 90_000n });
    const unsignedPsbt = encodeBase64(tx.toPSBT());
    tx.sign(priv);
    tx.finalize();
    return { unsignedPsbt, raw: tx.extract() as Uint8Array };
  }

  it('a correctly signed sh(wpkh) spend matches its own PSBT', async () => {
    const { unsignedPsbt, raw } = spend(btc.p2sh(btc.p2wpkh(pub, TEST), TEST), true);
    const shape = rawTxShape(raw, NET)!;
    // The plain txid carries the scriptSig; the unsigned one does not.
    expect(shape.txid).not.toBe(psbtTxShape(unsignedPsbt)!.txid);
    expect(shape.unsignedTxid).toBe(psbtTxShape(unsignedPsbt)!.txid);
    expect(rawTxMatchesPsbt(raw, unsignedPsbt, NET)).toBe(true);
    const engine = new FakeWalletEngine(NET);
    await expect(
      engine.broadcastRawTx(raw, { type: 'electrum', url: 'x' } as never, psbtTxShape(unsignedPsbt)!.txid),
    ).resolves.toBeTruthy();
  });

  it('a correctly signed legacy pkh spend matches its own PSBT', () => {
    const { unsignedPsbt, raw } = spend(btc.p2pkh(pub, TEST), false);
    expect(rawTxMatchesPsbt(raw, unsignedPsbt, NET)).toBe(true);
  });

  it('native segwit: the unsigned txid is the txid', () => {
    const { unsignedPsbt, raw } = spend(btc.p2wpkh(pub, TEST), true);
    const shape = rawTxShape(raw, NET)!;
    expect(shape.unsignedTxid).toBe(shape.txid);
    expect(rawTxMatchesPsbt(raw, unsignedPsbt, NET)).toBe(true);
  });

  it('a different sh(wpkh) payment of the same coin still does not match', () => {
    const { raw } = spend(btc.p2sh(btc.p2wpkh(pub, TEST), TEST), true);
    const other = psbtOf([{ txid: rawTxShape(raw, NET)!.inputs[0].txid, vout: 0 }], [{ script: THIEF, value: 90_000 }]);
    expect(rawTxMatchesPsbt(raw, other, NET)).toBe(false);
  });
});
