/**
 * The permanent independent address check (BDK upgrade, decided
 * 2026-10-15), over stand-in engines. The scure
 * derivation itself is held to both libraries' corpus in scureAddresses.test.ts. (The
 * per-vault preflight these tests stood beside went with the old engine,
 * decided 2026-11-04; the address check stays.)
 */
import {
  ADDRESS_CHECK_COUNT,
  addressDigest,
  blocksBuilding,
  blocksReceive,
  checkAddresses,
  isSendPaused,
  ownOutputProblems,
  RECEIVE_PAUSED_TITLE,
  SEND_PAUSED_TITLE,
  PINNED_SEARCH_LIMIT,
  shownCheckShows,
  verifyPinnedAddress,
  verifyShownAddress,
} from '../addressCheck';
import { EngineError } from '../engineError';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { encodeBase64 } from '../../psbt/export';
import { scureAddresses } from '../../descriptor/scureAddresses';
import { splitMultipathDescriptor } from '../../descriptor/multipath';
import { SPARROW_SINGLE_SIG, LIANA_MINISCRIPT } from '../../descriptor/__fixtures__/descriptors';

function engine(opts: {
  ext?: (i: number) => string;
  int?: (i: number) => string;
  fail?: boolean;
  /** The engine's reach per keychain (`addressReach`); absent = the engine cannot say. */
  reach?: Partial<Record<'external' | 'internal', number | null | 'throws'>>;
}) {
  let calls = 0;
  const reach = opts.reach;
  return {
    calls: () => calls,
    ...(reach
      ? {
          addressReach: async (k: 'external' | 'internal') => {
            const r = reach[k];
            if (r === 'throws') throw new Error('queue busy');
            return r === undefined ? null : r;
          },
        }
      : {}),
    getReceiveAddress: async (i: number) => {
      calls++;
      if (opts.fail) throw new Error('queue busy');
      return { address: (opts.ext ?? ((n: number) => `e${n}`))(i), index: i, uri: '' };
    },
    getInternalAddress: async (i: number) => {
      calls++;
      return { address: (opts.int ?? ((n: number) => `i${n}`))(i), index: i, uri: '' };
    },
  };
}

describe('the independent address check', () => {
  const pair = splitMultipathDescriptor(SPARROW_SINGLE_SIG);
  const truth = (d: string) => scureAddresses(d, 'testnet', Array.from({ length: ADDRESS_CHECK_COUNT }, (_, i) => i))!;
  const ext = truth(pair.external);
  const int = truth(pair.internal!);

  it('agrees when the engine gives scure\'s addresses on both keychains', async () => {
    const e = engine({ ext: (i) => ext[i].address, int: (i) => int[i].address });
    expect(await checkAddresses({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, e)).toEqual({
      kind: 'match',
      checked: 20,
      digest: addressDigest(ext.map((a) => `${a.index}:${a.address}`), int.map((a) => `${a.index}:${a.address}`)),
      derived: true,
    });
  });

  it('derives one address per pause, after the engine answered (decided 2026-10-17: never one long block)', async () => {
    const e = engine({ ext: (i) => ext[i].address, int: (i) => int[i].address });
    const order: string[] = [];
    const counting = {
      getReceiveAddress: async (i: number) => {
        order.push('engine');
        return e.getReceiveAddress(i);
      },
      getInternalAddress: async (i: number) => {
        order.push('engine');
        return e.getInternalAddress(i);
      },
    };
    const v = await checkAddresses({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, counting, {
      pause: async () => void order.push('pause'),
    });
    expect(v.kind).toBe('match');
    // Two derivers made, then 20 addresses derived: a piece each.
    expect(order.filter((x) => x === 'pause')).toHaveLength(22);
    expect(order.indexOf('pause')).toBe(20); // every engine answer first
  });

  it('the same answers as a sweep already proved need no derivation; other answers are derived again', async () => {
    const e = engine({ ext: (i) => ext[i].address, int: (i) => int[i].address });
    const proven = addressDigest(ext.map((a) => `${a.index}:${a.address}`), int.map((a) => `${a.index}:${a.address}`));
    let pauses = 0;
    const pause = async () => void (pauses += 1);
    const v = await checkAddresses({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, e, { provenDigest: proven, pause });
    expect(v).toMatchObject({ kind: 'match', derived: false });
    expect(pauses).toBe(0);
    const liar = engine({ ext: (i) => ext[i].address, int: (i) => (i === 3 ? ext[3].address : int[i].address) });
    const w = await checkAddresses({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, liar, { provenDigest: proven, pause });
    expect(w).toEqual({ kind: 'mismatch', keychain: 'internal', index: 3 });
  });

  it('a disagreement blocks Receive, and names where', async () => {
    const e = engine({ ext: (i) => ext[i].address, int: (i) => (i === 7 ? ext[7].address : int[i].address) });
    const v = await checkAddresses({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, e);
    expect(v).toEqual({ kind: 'mismatch', keychain: 'internal', index: 7 });
    expect(blocksReceive(v)).toBe(true);
  });

  it('a shape scure does not read, or an engine that cannot answer, blocks nothing', async () => {
    const liana = await checkAddresses({ descriptor: LIANA_MINISCRIPT, network: 'testnet' }, engine({}));
    const busy = await checkAddresses({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, engine({ fail: true }));
    expect(busy).toEqual({ kind: 'error' });
    expect(blocksReceive(busy)).toBe(false);
    expect(['not-covered', 'mismatch', 'match']).toContain(liana.kind);
    expect(blocksReceive(null)).toBe(false);
    expect(blocksReceive({ kind: 'not-covered' })).toBe(false);
  });

  it('a mismatch of either keychain blocks building too (decided 2026-10-17: the change goes to the other one)', () => {
    expect(blocksBuilding({ kind: 'mismatch', keychain: 'internal', index: 4 })).toBe(true);
    expect(blocksBuilding({ kind: 'mismatch', keychain: 'external', index: 0 })).toBe(true);
    expect(blocksBuilding({ kind: 'error' })).toBe(false);
    expect(blocksBuilding({ kind: 'not-covered' })).toBe(false);
    expect(blocksBuilding(null)).toBe(false);
  });

  it('the dialog is a title alone, plain words, no em dash', () => {
    for (const t of [RECEIVE_PAUSED_TITLE, SEND_PAUSED_TITLE]) {
      expect(t).not.toMatch(/—/);
      expect(t.length).toBeLessThan(50);
    }
  });

  it('the titles are exactly the words approved on 2026-10-17', () => {
    expect(SEND_PAUSED_TITLE).toBe('Sending is paused for this vault');
    expect(RECEIVE_PAUSED_TITLE).toBe('Receiving is paused for this vault');
  });

  it('a build the check refused reads as the pause; any other refusal does not', () => {
    expect(isSendPaused(new EngineError('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE))).toBe(true);
    expect(isSendPaused(new EngineError('INSUFFICIENT_FUNDS', 'Insufficient funds: 1 sat available of 2 sat needed'))).toBe(false);
    expect(isSendPaused(new Error('Sending is paused for this vault'))).toBe(false); // the code decides, never the words
    expect(isSendPaused(null)).toBe(false);
  });
});

describe('the exact address Receive shows (decided 2026-10-17)', () => {
  const pair = splitMultipathDescriptor(SPARROW_SINGLE_SIG);
  const at = (i: number) => scureAddresses(pair.external, 'testnet', [i])![0].address;

  it('is derived again at its own index, far past the sweep', () => {
    expect(verifyShownAddress({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, 'external', 37, at(37))).toEqual({ kind: 'match' });
    // A real disagreement, with where (Receive pauses the vault on it).
    expect(verifyShownAddress({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, 'external', 37, at(38))).toEqual({
      kind: 'mismatch',
      keychain: 'external',
      index: 37,
    });
    // A receive address asked for on the change keychain really does disagree,
    // which is why Receive names the keychain of the address it actually shows.
    expect(verifyShownAddress({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, 'internal', 37, at(37))).toEqual({
      kind: 'mismatch',
      keychain: 'internal',
      index: 37,
    });
    expect(verifyShownAddress({ descriptor: LIANA_MINISCRIPT, network: 'testnet' }, 'external', 0, at(0))).toEqual({ kind: 'not-covered' });
  });

  it('a derivation that cannot be made is an error, never a disagreement', () => {
    // A hardened index: no unhardened child to derive.
    expect(verifyShownAddress({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, 'external', 0x8000_0000, at(0))).toEqual({ kind: 'error' });
    expect(shownCheckShows({ kind: 'error' })).toBe(false);
    expect(shownCheckShows({ kind: 'not-found' })).toBe(false);
    expect(shownCheckShows({ kind: 'mismatch', keychain: 'external', index: 1 })).toBe(false);
    expect(shownCheckShows({ kind: 'match' })).toBe(true);
    expect(shownCheckShows({ kind: 'not-covered' })).toBe(true);
  });
});

describe('an address Receive is opened on with no index (decided 2026-10-17)', () => {
  const pair = splitMultipathDescriptor(SPARROW_SINGLE_SIG);
  const ext = (i: number) => scureAddresses(pair.external, 'testnet', [i])![0].address;
  const int = (i: number) => scureAddresses(pair.internal!, 'testnet', [i])![0].address;
  const vault = { descriptor: SPARROW_SINGLE_SIG, network: 'testnet' as const };

  it('is found among the vault\'s own addresses, then derived again there (a coin on the change keychain too)', async () => {
    const honest = engine({ ext, int });
    expect(await verifyPinnedAddress(vault, honest, ext(23))).toEqual({ kind: 'match' });
    expect(await verifyPinnedAddress(vault, honest, int(41), 'internal')).toEqual({ kind: 'match' });
    // The coin list's keychain is where it looks first; the other one is still searched.
    expect(await verifyPinnedAddress(vault, honest, int(5), 'external')).toEqual({ kind: 'match' });
  });

  it('the coin\'s keychain is searched first: a change coin costs no receive-side peeks', async () => {
    const honest = engine({ ext, int });
    await verifyPinnedAddress(vault, honest, int(3), 'internal');
    expect(honest.calls()).toBe(4);
  });

  it('an engine that names the address at an index scure derives differently: a disagreement, with where', async () => {
    // The engine says index 7 holds an address scure puts at index 8.
    const liar = engine({ ext: (i) => (i === 7 ? ext(8) : ext(i)), int });
    expect(await verifyPinnedAddress(vault, liar, ext(8))).toEqual({ kind: 'mismatch', keychain: 'external', index: 7 });
  });

  it('an address the search does not find is not-found, an engine that cannot answer an error: hidden, and never the vault\'s pause', async () => {
    expect(await verifyPinnedAddress(vault, engine({ ext, int }), 'tb1qnotthisvaultsaddressxxxxxxxxxxxxxxxxxx', undefined, { limit: 30 })).toEqual({ kind: 'not-found' });
    expect(await verifyPinnedAddress(vault, engine({ fail: true }), ext(0))).toEqual({ kind: 'error' });
  });

  it('each keychain is searched as far as the ENGINE reaches, not a fixed 1,000 (decided 2026-10-17)', async () => {
    // A busy vault: its change keychain reaches 1,040; the coin sits there.
    const busy = engine({ ext, int, reach: { external: 12, internal: 1040 } });
    expect(await verifyPinnedAddress(vault, busy, int(1040), 'internal')).toEqual({ kind: 'match' });
    expect(busy.calls()).toBe(1041);
    // Past the engine's reach no coin can sit: searched no further, not found.
    const short = engine({ ext, int, reach: { external: 12, internal: 30 } });
    expect(await verifyPinnedAddress(vault, short, int(40), 'internal')).toEqual({ kind: 'not-found' });
    expect(short.calls()).toBe(31 + 13);
    // A keychain with nothing revealed holds no coin: not one peek there.
    const fresh = engine({ ext, int, reach: { external: 5, internal: null } });
    expect(await verifyPinnedAddress(vault, fresh, ext(3), 'internal')).toEqual({ kind: 'match' });
    expect(fresh.calls()).toBe(4);
    // An engine that cannot say how far it reaches: the fixed bound.
    const unsure = engine({ ext, int, reach: { external: 'throws', internal: 'throws' } });
    expect(await verifyPinnedAddress(vault, unsure, ext(20), undefined, { limit: 25 })).toEqual({ kind: 'match' });
    expect(PINNED_SEARCH_LIMIT).toBe(1000);
  });

  it('stops when the screen goes: no more peeks after the signal', async () => {
    const signal = { aborted: false };
    let peeks = 0;
    const slow = {
      getReceiveAddress: async (i: number) => {
        peeks += 1;
        if (peeks === 5) signal.aborted = true;
        return { address: ext(i), index: i, uri: '' };
      },
      getInternalAddress: async (i: number) => {
        peeks += 1;
        return { address: int(i), index: i, uri: '' };
      },
    };
    expect(await verifyPinnedAddress(vault, slow, 'tb1qnotthisvaultsaddressxxxxxxxxxxxxxxxxxx', undefined, { signal })).toEqual({ kind: 'aborted' });
    expect(peeks).toBe(5);
  });

  it('a shape scure does not read is not covered, as for any address of that vault', async () => {
    expect(await verifyPinnedAddress({ descriptor: LIANA_MINISCRIPT, network: 'testnet' }, engine({}), 'x')).toEqual({ kind: 'not-covered' });
  });
});

describe('a build\'s own outputs against scure (decided 2026-10-17)', () => {
  const root = HDKey.fromMasterSeed(sha256(utf8ToBytes('own-output-check')));
  const fp = root.fingerprint;
  const fpHex = fp.toString(16).padStart(8, '0');
  const NET = btc.TEST_NETWORK;
  const H = 0x8000_0000;

  function wpkhVault() {
    const acct = root.derive("m/84'/1'/0'");
    return {
      descriptor: `wpkh([${fpHex}/84'/1'/0']${acct.publicExtendedKey}/<0;1>/*)`,
      key: (c: number, i: number) => acct.deriveChild(c).deriveChild(i).publicKey!,
      path: (c: number, i: number) => [84 + H, 1 + H, 0 + H, c, i],
    };
  }
  function trVault() {
    const acct = root.derive("m/86'/1'/0'");
    return {
      descriptor: `tr([${fpHex}/86'/1'/0']${acct.publicExtendedKey}/<0;1>/*)`,
      key: (c: number, i: number) => acct.deriveChild(c).deriveChild(i).publicKey!.slice(1),
      path: (c: number, i: number) => [86 + H, 1 + H, 0 + H, c, i],
    };
  }

  /** A payment to a stranger plus an output the build marks as the vault's own at (c, i), paying `script`. */
  function build(o: { tap?: boolean; c: number; i: number; script: Uint8Array; markKey: Uint8Array; path: number[] }) {
    const t = new btc.Transaction({ allowUnknownOutputs: true });
    t.addInput({ txid: new Uint8Array(32).fill(1), index: 0, witnessUtxo: { script: btc.p2wpkh(root.derive("m/0/1").publicKey!, NET).script, amount: 100_000n } });
    t.addOutput({ script: btc.p2wpkh(root.derive('m/9/9').publicKey!, NET).script, amount: 30_000n });
    t.addOutput({
      script: o.script,
      amount: 69_000n,
      ...(o.tap
        ? { tapBip32Derivation: [[o.markKey, { hashes: [], der: { fingerprint: fp, path: o.path } }]] }
        : { bip32Derivation: [[o.markKey, { fingerprint: fp, path: o.path }]] }),
    } as never);
    return encodeBase64(t.toPSBT());
  }

  it('a change output at the index its derivation names passes; another script there is refused', () => {
    const v = wpkhVault();
    const params = { descriptor: v.descriptor, network: 'testnet' as const };
    const good = build({ c: 1, i: 37, script: btc.p2wpkh(v.key(1, 37), NET).script, markKey: v.key(1, 37), path: v.path(1, 37) });
    expect(ownOutputProblems(good, params)).toBeNull();
    // The library derived a wrong change script (here: index 38's) but labelled it 37.
    const wrong = build({ c: 1, i: 37, script: btc.p2wpkh(v.key(1, 38), NET).script, markKey: v.key(1, 37), path: v.path(1, 37) });
    // A disagreement about the vault's address there: where, for the pause.
    expect(ownOutputProblems(wrong, params)).toEqual({
      kind: 'mismatch',
      output: 1,
      keychain: 'internal',
      index: 37,
      detail: "output 1 does not pay the vault's own address (internal 37)",
    });
    // The receive keychain's script under a change derivation is refused too.
    const swapped = build({ c: 1, i: 37, script: btc.p2wpkh(v.key(0, 37), NET).script, markKey: v.key(1, 37), path: v.path(1, 37) });
    expect(ownOutputProblems(swapped, params)).toMatchObject({ kind: 'mismatch', keychain: 'internal', index: 37 });
  });

  it('a taproot change output (PSBT_OUT_TAP_BIP32_DERIVATION) is read the same way', () => {
    const v = trVault();
    const params = { descriptor: v.descriptor, network: 'testnet' as const };
    const script = (c: number, i: number) => btc.p2tr(v.key(c, i), undefined, NET).script;
    expect(ownOutputProblems(build({ tap: true, c: 1, i: 151, script: script(1, 151), markKey: v.key(1, 151), path: v.path(1, 151) }), params)).toBeNull();
    expect(ownOutputProblems(build({ tap: true, c: 1, i: 151, script: script(1, 150), markKey: v.key(1, 151), path: v.path(1, 151) }), params)).toMatchObject({
      kind: 'mismatch',
      keychain: 'internal',
      index: 151,
    });
  });

  it('a vault with no wildcard has one script, whatever path its derivation names (tier C matrix)', () => {
    const acct = root.derive("m/84'/1'/0'");
    const descriptor = `wpkh([${fpHex}/84'/1'/0']${acct.publicExtendedKey}/0/7)`;
    const key = acct.deriveChild(0).deriveChild(7).publicKey!;
    const params = { descriptor, network: 'testnet' as const };
    const good = build({ c: 0, i: 7, script: btc.p2wpkh(key, NET).script, markKey: key, path: [84 + H, 1 + H, 0 + H, 0, 7] });
    expect(ownOutputProblems(good, params)).toBeNull();
    const other = acct.deriveChild(0).deriveChild(8).publicKey!;
    const wrong = build({ c: 0, i: 7, script: btc.p2wpkh(other, NET).script, markKey: key, path: [84 + H, 1 + H, 0 + H, 0, 7] });
    expect(ownOutputProblems(wrong, params)).toMatchObject({ kind: 'mismatch', keychain: 'external', index: 7 });
  });

  it('outputs not marked as the vault\'s own, and shapes scure does not read, are not judged here', () => {
    const v = wpkhVault();
    const t = new btc.Transaction({ allowUnknownOutputs: true });
    t.addInput({ txid: new Uint8Array(32).fill(1), index: 0, witnessUtxo: { script: btc.p2wpkh(v.key(0, 0), NET).script, amount: 100_000n } });
    t.addOutput({ script: btc.p2wpkh(root.derive('m/9/9').publicKey!, NET).script, amount: 30_000n });
    expect(ownOutputProblems(encodeBase64(t.toPSBT()), { descriptor: v.descriptor, network: 'testnet' })).toBeNull();
    const wrong = build({ c: 1, i: 2, script: btc.p2wpkh(v.key(1, 3), NET).script, markKey: v.key(1, 2), path: v.path(1, 2) });
    expect(ownOutputProblems(wrong, { descriptor: LIANA_MINISCRIPT, network: 'testnet' })).toBeNull();
    // Nothing concluded about the vault's addresses: refused, never a pause.
    expect(ownOutputProblems('not a psbt', { descriptor: v.descriptor, network: 'testnet' })).toEqual({
      kind: 'unchecked',
      detail: 'the payment could not be read',
    });
  });

  it('an own output with no index, or at a path the vault does not have, is unchecked (refused, no pause)', () => {
    const v = wpkhVault();
    const params = { descriptor: v.descriptor, network: 'testnet' as const };
    // Hardened last step: no address index to derive.
    const hardened = build({ c: 1, i: 5, script: btc.p2wpkh(v.key(1, 5), NET).script, markKey: v.key(1, 5), path: [84 + H, 1 + H, 0 + H, 1, 5 + H] });
    expect(ownOutputProblems(hardened, params)).toMatchObject({ kind: 'unchecked' });
    // Keychain 7: neither the receive (0) nor the change (1) keychain of this vault.
    const elsewhere = build({ c: 7, i: 5, script: btc.p2wpkh(v.key(1, 5), NET).script, markKey: v.key(1, 5), path: [84 + H, 1 + H, 0 + H, 7, 5] });
    expect(ownOutputProblems(elsewhere, params)).toEqual({
      kind: 'unchecked',
      detail: "output 1 is marked as the vault's own at a path this vault does not have",
    });
  });
});
