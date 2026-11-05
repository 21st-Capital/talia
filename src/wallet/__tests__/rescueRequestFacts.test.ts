/**
 * A filed rescue request, opened to check it again (decided 2026-11-03): the
 * figures come from the phone's own transaction, never from the server's
 * word. The address is the phone's record, the outputs count only when the
 * server's transaction (the PSBT while the request waits, the signed
 * transaction once it is signed) is the very transaction the phone filed
 * (its unsigned txid), and the fee is worked out from coin values the phone
 * knows itself, because a PSBT's copies of them are outside the txid.
 *
 * Addresses are the BIP-173 / BIP-350 examples; the coins are test fixtures.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { decodeBase64, encodeBase64 } from '../../bitcoin/psbt/export';
import { unsignedTxid } from '../../bitcoin/psbt/parse';
import type { Network } from '../../bitcoin/descriptor/types';
import {
  factsNeedEngine,
  rescueFigureRows,
  rescueRequestFacts,
  rescueRequestLine,
  serverRequestTx,
} from '../rescueRequestFacts';
import type { KnownCoin, RescueRequestFacts } from '../rescueRequestFacts';

const MAIN = btc.NETWORK;
const TEST = btc.TEST_NETWORK;
/** The client's address on the main network, and a stranger's. */
const DEST_MAIN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const OTHER_MAIN = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
/** The same on Testnet4. */
const DEST_TEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const OTHER_TEST = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';

const vaultKey = HDKey.fromMasterSeed(sha256(utf8ToBytes('rescue-details-vault'))).derive("m/84'/1'/0'/0/0");

const COINS: KnownCoin[] = [
  { txid: 'a1b2' + '00'.repeat(28) + 'c3d4', vout: 0, valueSats: 60_000 },
  { txid: 'e5f6' + '11'.repeat(28) + '0718', vout: 1, valueSats: 41_000 },
];

/** An unsigned rescue: the coins in, the outputs given. `claimedValues`
 *  is what the PSBT itself says the coins are worth. */
function rescuePsbt(
  outputs: Array<{ address: string; sats: number }>,
  net = MAIN,
  claimedValues: number[] = COINS.map((c) => c.valueSats),
  coins: KnownCoin[] = COINS,
): string {
  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  const spk = btc.p2wpkh(vaultKey.publicKey!, net).script;
  coins.forEach((c, i) => {
    tx.addInput({ txid: c.txid, index: c.vout, witnessUtxo: { script: spk, amount: BigInt(claimedValues[i]) } });
  });
  for (const o of outputs) tx.addOutputAddress(o.address, BigInt(o.sats), net);
  return encodeBase64(tx.toPSBT(0));
}

const recordFor = (psbt: string, destination = DEST_MAIN) => ({
  destination,
  requestTxid: unsignedTxid(psbt) ?? undefined,
});

/** The request PSBT, as a waiting request's server answer carries it. */
const waiting = (psbt: string | null | undefined, network: Network = 'bitcoin') =>
  serverRequestTx({ status: 'pending', request_psbt: psbt, signed_tx: '' }, network);

/** The PSBT signed and finalized by the vault's key: the transaction 21st
 *  Capital hands back, as raw bytes in hex or as a finalized PSBT. */
function signed(psbt: string, as: 'hex' | 'psbt' = 'hex'): string {
  const tx = btc.Transaction.fromPSBT(decodeBase64(psbt)!, { allowUnknownOutputs: true });
  tx.sign(vaultKey.privateKey!);
  tx.finalize();
  return as === 'hex' ? tx.hex : encodeBase64(tx.toPSBT(0));
}

/** A signed request as the server answers it: the PSBT wiped in the same
 *  step that stored the signature. */
const signedAnswer = (signedTx: string, network: Network = 'bitcoin') =>
  serverRequestTx({ status: 'signed', request_psbt: '', signed_tx: signedTx }, network);

describe('rescueRequestFacts', () => {
  it('reads what arrives, the fee and what leaves the vault from the phone’s own transaction', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const f = rescueRequestFacts({ record: recordFor(psbt), tx: waiting(psbt), network: 'bitcoin', knownCoins: COINS });
    expect(f).toEqual({
      kind: 'figures',
      destination: DEST_MAIN,
      arrivesSats: 100_200,
      feeSats: 800,
      leavesSats: 101_000,
      coins: 2,
    });
    expect(rescueRequestLine(f)).toBeNull();
  });

  it('matches the txid whatever its case, and an address in capitals as scanned', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const record = { destination: DEST_MAIN.toUpperCase(), requestTxid: unsignedTxid(psbt)!.toUpperCase() };
    const f = rescueRequestFacts({ record, tx: waiting(psbt), network: 'bitcoin', knownCoins: COINS });
    expect(f.kind).toBe('figures');
    // The address shown is the record, exactly as the phone kept it.
    expect(f.destination).toBe(DEST_MAIN.toUpperCase());
  });

  it('works out the fee from the coins this phone knows, never the values the PSBT claims', () => {
    // The txid does not cover a coin's value: a server could write a smaller
    // one into the PSBT to make the fee look small.
    const honest = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const doctored = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }], MAIN, [59_500, 40_800]);
    expect(unsignedTxid(doctored)).toBe(unsignedTxid(honest));
    const f = rescueRequestFacts({ record: recordFor(honest), tx: waiting(doctored), network: 'bitcoin', knownCoins: COINS });
    expect(f).toMatchObject({ kind: 'figures', feeSats: 800, leavesSats: 101_000 });
  });

  it('leaves the fee out when the phone does not know every coin, and says so', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const f = rescueRequestFacts({ record: recordFor(psbt), tx: waiting(psbt), network: 'bitcoin', knownCoins: [COINS[0]] });
    expect(f).toMatchObject({ kind: 'figures', arrivesSats: 100_200, feeSats: null, leavesSats: null });
    expect(factsNeedEngine(f)).toEqual({ own: false, coins: true });
    expect(rescueRequestLine(f)).toEqual({ text: expect.stringMatching(/^Network fee not shown/), tone: 'quiet' });
    expect(rescueFigureRows(f, 'sats').map((r) => r.label)).toEqual(['Amount', 'Coins']);
  });

  it('never shows a fee below zero', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const low = COINS.map((c) => ({ ...c, valueSats: 1_000 }));
    const f = rescueRequestFacts({ record: recordFor(psbt), tx: waiting(psbt), network: 'bitcoin', knownCoins: low });
    expect(f).toMatchObject({ kind: 'figures', feeSats: null, leavesSats: null });
  });

  it('takes a speed-up’s coins from its own record: the vault no longer lists them', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 99_000 }]);
    const record = { ...recordFor(psbt), replaces: { coins: COINS } };
    const f = rescueRequestFacts({ record, tx: waiting(psbt), network: 'bitcoin', knownCoins: record.replaces.coins });
    expect(f).toMatchObject({ kind: 'figures', arrivesSats: 99_000, feeSats: 2_000, leavesSats: 101_000 });
  });

  it('shows no figures when the server holds a different transaction', () => {
    const filed = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const other = rescuePsbt([{ address: DEST_MAIN, sats: 100_100 }]);
    const f = rescueRequestFacts({ record: recordFor(filed), tx: waiting(other), network: 'bitcoin', knownCoins: COINS });
    expect(f).toEqual({ kind: 'unchecked', destination: DEST_MAIN, reason: 'other-transaction' });
    expect(rescueRequestLine(f)?.tone).toBe('warning');
    expect(rescueFigureRows(f, 'btc')).toEqual([]);
  });

  it('shows no figures when there is no transaction: wiped, or an older server', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    for (const serverPsbt of ['', '   ', undefined, null]) {
      const f = rescueRequestFacts({ record: recordFor(psbt), tx: waiting(serverPsbt), network: 'bitcoin', knownCoins: COINS });
      expect(f).toEqual({ kind: 'unchecked', destination: DEST_MAIN, reason: 'no-transaction' });
      expect(rescueRequestLine(f)?.text).toMatch(/^Amount and fee not shown/);
    }
  });

  it('shows no figures and no address when the phone kept no record', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    for (const record of [undefined, null, {}, { destination: '  ', requestTxid: unsignedTxid(psbt)! }]) {
      const f = rescueRequestFacts({ record, tx: waiting(psbt), network: 'bitcoin', knownCoins: COINS });
      expect(f).toEqual({ kind: 'unchecked', destination: null, reason: 'no-record' });
    }
  });

  it('shows the recorded address but no figures when the phone kept no txid (an older request)', () => {
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const f = rescueRequestFacts({ record: { destination: DEST_MAIN }, tx: waiting(psbt), network: 'bitcoin', knownCoins: COINS });
    expect(f).toEqual({ kind: 'unchecked', destination: DEST_MAIN, reason: 'no-record' });
  });

  it('shows no figures for a PSBT it cannot read', () => {
    const f = rescueRequestFacts({
      record: { destination: DEST_MAIN, requestTxid: 'ab'.repeat(32) },
      tx: waiting('not a psbt'),
      network: 'bitcoin',
    });
    expect(f).toEqual({ kind: 'unchecked', destination: DEST_MAIN, reason: 'unreadable' });
  });

  it('warns instead of showing figures when the transaction pays anyone else', () => {
    const psbt = rescuePsbt([
      { address: DEST_MAIN, sats: 90_000 },
      { address: OTHER_MAIN, sats: 10_200 },
    ]);
    const f = rescueRequestFacts({ record: recordFor(psbt), tx: waiting(psbt), network: 'bitcoin', knownCoins: COINS });
    expect(f).toEqual({ kind: 'pays-elsewhere', destination: DEST_MAIN, others: [1] });
    expect(factsNeedEngine(f)).toEqual({ own: true, coins: false });
    expect(rescueRequestLine(f)?.tone).toBe('alarm');
    expect(rescueFigureRows(f, 'btc')).toEqual([]);
  });

  it('counts an output BDK says is the vault’s own as staying in the vault', () => {
    const psbt = rescuePsbt([
      { address: DEST_MAIN, sats: 90_000 },
      { address: OTHER_MAIN, sats: 10_200 },
    ]);
    const f = rescueRequestFacts({
      record: recordFor(psbt),
      tx: waiting(psbt),
      network: 'bitcoin',
      knownCoins: COINS,
      ownOutputs: [1],
    });
    // In 101 000; 10 200 comes back; 800 fee; 90 800 leaves.
    expect(f).toEqual({
      kind: 'figures',
      destination: DEST_MAIN,
      arrivesSats: 90_000,
      feeSats: 800,
      leavesSats: 90_800,
      coins: 2,
    });
  });

  it('reads a Testnet4 vault’s outputs as Testnet4 addresses', () => {
    const psbt = rescuePsbt([{ address: DEST_TEST, sats: 100_200 }], TEST);
    const f = rescueRequestFacts({
      record: recordFor(psbt, DEST_TEST),
      tx: waiting(psbt, 'testnet'),
      network: 'testnet',
      knownCoins: COINS,
    });
    expect(f).toMatchObject({ kind: 'figures', destination: DEST_TEST, arrivesSats: 100_200, feeSats: 800 });

    const split = rescuePsbt(
      [
        { address: DEST_TEST, sats: 90_000 },
        { address: OTHER_TEST, sats: 10_200 },
      ],
      TEST,
    );
    expect(
      rescueRequestFacts({ record: recordFor(split, DEST_TEST), tx: waiting(split, 'testnet'), network: 'testnet', knownCoins: COINS }),
    ).toEqual({ kind: 'pays-elsewhere', destination: DEST_TEST, others: [1] });
  });

  it('never takes an address of the other network for the recorded one', () => {
    // The same program is a different address on each network: a main
    // network vault paying "tb1…" pays no address the client chose.
    const psbt = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);
    const f = rescueRequestFacts({
      record: recordFor(psbt, DEST_TEST),
      tx: waiting(psbt),
      network: 'bitcoin',
      knownCoins: COINS,
    });
    expect(f).toEqual({ kind: 'pays-elsewhere', destination: DEST_TEST, others: [0] });
    // And a main network transaction read as Testnet4 matches nothing either.
    expect(
      rescueRequestFacts({ record: recordFor(psbt), tx: waiting(psbt, 'testnet'), network: 'testnet', knownCoins: COINS }).kind,
    ).toBe('pays-elsewhere');
  });
});

describe('a signed request: read from its signed transaction', () => {
  // The server wipes the PSBT in the same step that stores the signature,
  // so a signed request carries only its signed transaction.
  const filed = rescuePsbt([{ address: DEST_MAIN, sats: 100_200 }]);

  it('shows the same figures as the PSBT it was signed from, raw in hex or as a finalized PSBT', () => {
    const want = {
      kind: 'figures',
      destination: DEST_MAIN,
      arrivesSats: 100_200,
      feeSats: 800,
      leavesSats: 101_000,
      coins: 2,
    };
    for (const as of ['hex', 'psbt'] as const) {
      const tx = signedAnswer(signed(filed, as));
      expect(rescueRequestFacts({ record: recordFor(filed), tx, network: 'bitcoin', knownCoins: COINS })).toEqual(want);
    }
    // And the txid in capitals as well as in lower case.
    const record = { destination: DEST_MAIN, requestTxid: unsignedTxid(filed)!.toUpperCase() };
    expect(
      rescueRequestFacts({ record, tx: signedAnswer(signed(filed)), network: 'bitcoin', knownCoins: COINS }).kind,
    ).toBe('figures');
  });

  it('reads the signed transaction, not a PSBT an older server still sends beside it', () => {
    const other = rescuePsbt([{ address: DEST_MAIN, sats: 100_100 }]);
    const tx = serverRequestTx({ status: 'signed', request_psbt: other, signed_tx: signed(filed) }, 'bitcoin');
    expect(rescueRequestFacts({ record: recordFor(filed), tx, network: 'bitcoin', knownCoins: COINS })).toMatchObject({
      kind: 'figures',
      arrivesSats: 100_200,
    });
  });

  it('reads a waiting request’s PSBT whatever signed_tx holds', () => {
    const tx = serverRequestTx({ status: 'pending', request_psbt: filed, signed_tx: 'not a transaction' }, 'bitcoin');
    expect(rescueRequestFacts({ record: recordFor(filed), tx, network: 'bitcoin', knownCoins: COINS }).kind).toBe(
      'figures',
    );
  });

  it('shows no figures when 21st Capital signed a different transaction', () => {
    const other = rescuePsbt([{ address: DEST_MAIN, sats: 100_100 }]);
    const f = rescueRequestFacts({
      record: recordFor(filed),
      tx: signedAnswer(signed(other)),
      network: 'bitcoin',
      knownCoins: COINS,
    });
    expect(f).toEqual({ kind: 'unchecked', destination: DEST_MAIN, reason: 'other-transaction' });
    expect(rescueRequestLine(f)?.tone).toBe('warning');
  });

  it('warns when the signed transaction pays anyone else, and counts the vault’s own output as staying', () => {
    const split = rescuePsbt([
      { address: DEST_MAIN, sats: 90_000 },
      { address: OTHER_MAIN, sats: 10_200 },
    ]);
    const tx = signedAnswer(signed(split));
    expect(rescueRequestFacts({ record: recordFor(split), tx, network: 'bitcoin', knownCoins: COINS })).toEqual({
      kind: 'pays-elsewhere',
      destination: DEST_MAIN,
      others: [1],
    });
    expect(
      rescueRequestFacts({ record: recordFor(split), tx, network: 'bitcoin', knownCoins: COINS, ownOutputs: [1] }),
    ).toMatchObject({ kind: 'figures', arrivesSats: 90_000, feeSats: 800, leavesSats: 90_800 });
  });

  it('reads a Testnet4 vault’s signed transaction on Testnet4', () => {
    const t = rescuePsbt([{ address: DEST_TEST, sats: 100_200 }], TEST);
    const f = rescueRequestFacts({
      record: recordFor(t, DEST_TEST),
      tx: signedAnswer(signed(t), 'testnet'),
      network: 'testnet',
      knownCoins: COINS,
    });
    expect(f).toMatchObject({ kind: 'figures', destination: DEST_TEST, arrivesSats: 100_200, feeSats: 800 });
  });

  it('shows no figures for a signed transaction it cannot read, or a signed request with none', () => {
    for (const bad of ['zz', 'not a transaction', '00'.repeat(12)]) {
      const f = rescueRequestFacts({ record: recordFor(filed), tx: signedAnswer(bad), network: 'bitcoin', knownCoins: COINS });
      expect(f).toEqual({ kind: 'unchecked', destination: DEST_MAIN, reason: 'unreadable' });
    }
    const none = serverRequestTx({ status: 'signed', request_psbt: '', signed_tx: '' }, 'bitcoin');
    expect(rescueRequestFacts({ record: recordFor(filed), tx: none, network: 'bitcoin', knownCoins: COINS })).toEqual({
      kind: 'unchecked',
      destination: DEST_MAIN,
      reason: 'no-transaction',
    });
  });
});

describe('rescueFigureRows', () => {
  const figures: RescueRequestFacts = {
    kind: 'figures',
    destination: DEST_MAIN,
    arrivesSats: 100_200,
    feeSats: 800,
    leavesSats: 101_000,
    coins: 2,
  };

  it('shows the owner’s unit with the exact satoshis under it', () => {
    expect(rescueFigureRows(figures, 'btc')).toEqual([
      { label: 'Amount', value: '0.001002 BTC', sub: '100,200 sats' },
      { label: 'Network fee', value: '800 sats' },
      { label: 'Leaves the vault', value: '0.00101 BTC', sub: '101,000 sats' },
      { label: 'Coins', value: '2' },
    ]);
  });

  it('adds no second line when the unit already is satoshis', () => {
    expect(rescueFigureRows(figures, 'sats')).toEqual([
      { label: 'Amount', value: '100,200 sats' },
      { label: 'Network fee', value: '800 sats' },
      { label: 'Leaves the vault', value: '101,000 sats' },
      { label: 'Coins', value: '2' },
    ]);
  });

  it('keeps every figure hidden while balances are hidden', () => {
    const rows = rescueFigureRows(figures, 'btc', '••••');
    expect(rows.filter((r) => r.label !== 'Coins').every((r) => r.value === '••••' && r.sub == null)).toBe(true);
  });
});

describe('the words', () => {
  const all: RescueRequestFacts[] = [
    { kind: 'figures', destination: DEST_MAIN, arrivesSats: 1, feeSats: null, leavesSats: null, coins: 1 },
    { kind: 'pays-elsewhere', destination: DEST_MAIN, others: [1] },
    ...(['no-record', 'no-transaction', 'other-transaction', 'unreadable'] as const).map(
      (reason): RescueRequestFacts => ({ kind: 'unchecked', destination: DEST_MAIN, reason }),
    ),
  ];

  it('has a line for every case without figures, and none in plain Bitcoin jargon or with an em dash', () => {
    for (const f of all) {
      const line = rescueRequestLine(f);
      expect(line).not.toBeNull();
      expect(line!.text).not.toMatch(/—|\binputs?\b|\boutputs?\b|outpoint|PSBT/i);
    }
  });
});
