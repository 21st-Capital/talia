import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import { NESTED_SINGLE_SIG, TPUB_A, TPUB_B, TPUB_C } from '../../descriptor/__fixtures__/descriptors';
import { extractImportPayload } from '../../descriptor/importFile';
import { ledgerPolicyBlocker } from '../../ledger/policy';
import {
  bitboxAccountKeypath,
  bitboxPolicyBlocker,
  bitboxScriptBlocker,
  descriptorToBitboxPolicy,
  splitKeyString,
} from '../policy';

const MULTI = `tr([3442193e/48'/1'/0'/2']${TPUB_A}/<0;1>/*,{multi_a(2,[cc000007/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_C}/<0;1>/*)})`;

describe('splitKeyString', () => {
  it('separates fingerprint, path and xpub', () => {
    expect(splitKeyString(`[4a290600/48'/1'/0'/2']${TPUB_A}`)).toEqual({
      rootFingerprintHex: '4a290600',
      keypath: "m/48'/1'/0'/2'",
      xpub: TPUB_A,
    });
  });

  it('lowercases the fingerprint: stored ones vary', () => {
    expect(splitKeyString(`[4A290600/48'/1'/0'/2']${TPUB_A}`).rootFingerprintHex).toBe('4a290600');
  });

  it('passes a bare provider xpub through with no origin', () => {
    expect(splitKeyString(TPUB_B)).toEqual({
      rootFingerprintHex: null,
      keypath: null,
      xpub: TPUB_B,
    });
  });
});

describe('descriptorToBitboxPolicy', () => {
  it('keeps the Ledger template and splits every key', () => {
    const p = descriptorToBitboxPolicy(MULTI, 'A multisig test');
    expect(p.policy).toContain('@0/**');
    expect(p.policy).toContain('multi_a(2,@1/**,@2/**');
    expect(p.keys).toHaveLength(3);
    expect(p.keys[2].rootFingerprintHex).toBe('4a290600');
  });

  it('trims the device name exactly as the Ledger layer does', () => {
    const p = descriptorToBitboxPolicy(MULTI, 'A very long vault name indeed');
    expect(p.name.length).toBeLessThanOrEqual(16);
  });
});

describe('bitboxAccountKeypath', () => {
  const keys = descriptorToBitboxPolicy(MULTI, 'x').keys;

  it("finds the device's own account path", () => {
    // A real Nova fingerprint, from the proven session (2026-08-31).
    expect(bitboxAccountKeypath(keys, '4A290600')).toBe("m/48'/1'/0'/2'");
  });

  it('answers null for a device that is not in this vault', () => {
    // The caller must refuse, not guess: registering a policy under the
    // wrong account keypath fails on the device with an opaque error.
    expect(bitboxAccountKeypath(keys, 'deadbeef')).toBeNull();
  });
});

describe('bitboxPolicyBlocker', () => {
  const key = (fp: string, xpub: string) => `[${fp}/48'/1'/0'/1']${xpub}/<0;1>/*`;
  const KEYS = `${key('3442193e', TPUB_A)},${key('cc000007', TPUB_B)},${key('4a290600', TPUB_C)}`;
  // Legacy P2SH multisig, as the Electrum-style imports bring it (the
  // library corpus's i-sh-multi shape, on this file's test keys).
  const SH_MULTI = `sh(multi(2,${KEYS}))`;
  const SH_SORTEDMULTI = `sh(sortedmulti(2,${KEYS}))`;
  const NOT_ON_BITBOX = 'This vault type cannot be registered on a BitBox.';

  it('refuses a bare sh(multi) before the device is asked (decided 2026-10-17)', () => {
    // bitbox-api's PSBT conversion has no output type for it
    // (UnknownOutputType): the client used to meet that at signing time.
    for (const d of [SH_MULTI, SH_SORTEDMULTI, `${SH_MULTI}#abcd1234`]) {
      expect(bitboxPolicyBlocker(d)).toBe(NOT_ON_BITBOX);
      expect(() => descriptorToBitboxPolicy(d, 'Vault')).toThrow(NOT_ON_BITBOX);
    }
  });

  it('is the BitBox’s alone: the Ledger layer takes the same vault', () => {
    expect(ledgerPolicyBlocker(SH_MULTI)).toBeNull();
    expect(ledgerPolicyBlocker(SH_SORTEDMULTI)).toBeNull();
  });

  it('keeps P2SH around a single key and every other shape it took before', () => {
    expect(bitboxPolicyBlocker(NESTED_SINGLE_SIG)).toBeNull();
    expect(bitboxPolicyBlocker(`wsh(sortedmulti(2,${KEYS}))`)).toBeNull();
    expect(bitboxPolicyBlocker(`wsh(multi(2,${KEYS}))`)).toBeNull();
    expect(bitboxPolicyBlocker(MULTI)).toBeNull();
  });

  describe('a P2SH-wrapped wsh (BitBox02 simulator runs; decided 2026-10-17)', () => {
    // The library corpus's i-sh-wsh-sortedmulti shape (a synthetic vault: its keys
    // sit on the P2WSH account, 2'), and the same vault on the nested
    // account (1'), which is where Talia's Electrum import puts them.
    const key2 = (fp: string, xpub: string) => `[${fp}/48'/1'/0'/2']${xpub}/<0;1>/*`;
    const CORPUS = `sh(wsh(sortedmulti(2,${key2('f5d9e0c9', TPUB_A)},${key2('b04e5885', TPUB_B)},${key2('55ac6beb', TPUB_C)})))`;
    const SH_WSH_SORTEDMULTI = `sh(wsh(sortedmulti(2,${KEYS})))`;
    const SH_WSH_MULTI = `sh(wsh(multi(2,${KEYS})))`;
    const SH_WSH_MINISCRIPT = `sh(wsh(or_d(pk(${key('3442193e', TPUB_A)}),and_v(v:pkh(${key('cc000007', TPUB_B)}),older(52596)))))`;

    it('refuses it before the device is asked: the device refused every registration of it', () => {
      // bitbox-ffi's script_config sends the classic multisig config only for
      // a top-level wsh(sortedmulti), as P2WSH, and every other vault as a
      // BIP-388 policy; the firmware parses only wsh(...) and tr(...)
      // policies, so all seven sh(wsh(sortedmulti)) registrations of a
      // BitBox02 simulator run ended in "invalid input".
      for (const d of [CORPUS, SH_WSH_SORTEDMULTI, SH_WSH_MULTI, `${SH_WSH_SORTEDMULTI}#abcd1234`]) {
        expect({ d, blocker: bitboxPolicyBlocker(d) }).toEqual({ d, blocker: NOT_ON_BITBOX });
        expect(() => descriptorToBitboxPolicy(d, 'Vault')).toThrow(NOT_ON_BITBOX);
      }
    });

    it('the device registry’s blocker refuses it too, whatever the script inside', () => {
      for (const d of [CORPUS, SH_WSH_SORTEDMULTI, SH_WSH_MULTI, SH_WSH_MINISCRIPT]) {
        expect({ d, blocker: bitboxScriptBlocker(d) }).toEqual({ d, blocker: NOT_ON_BITBOX });
      }
      // A non-ranged one keeps the shared sentence (the non-ranged rule comes first).
      const fixed = `sh(wsh(sortedmulti(2,[3442193e/48'/1'/0'/1']${TPUB_A}/0/5,[cc000007/48'/1'/0'/1']${TPUB_B}/0/5)))`;
      expect(bitboxScriptBlocker(fixed)).toBe('This vault type cannot be registered on a signing device.');
    });

    it('is the BitBox’s alone: the Ledger layer takes the same vaults', () => {
      for (const d of [CORPUS, SH_WSH_SORTEDMULTI, SH_WSH_MULTI]) {
        expect({ d, blocker: ledgerPolicyBlocker(d) }).toEqual({ d, blocker: null });
      }
    });

    it('covers Talia’s own Electrum import of a nested multisig, the shape the BitBox’s multisig config could take once the bridge sends it', () => {
      // A Sparrow/Electrum p2wsh-p2sh export: every key on 48'/coin'/account'/1'.
      // electrumWallet.ts writes sh(wsh(sortedmulti(...))), which is the
      // firmware's own P2WSH-P2SH multisig: BIP-67 sorted keys, our key at
      // m/48'/c'/a'/1' (or m/48'/c'/a'), at most 15 keys (keypath.rs
      // validate_account_multisig, multisig.rs). bitbox-ffi's script_config
      // sends only a top-level wsh(sortedmulti) as that config (P2WSH), and
      // this vault as a policy the firmware refuses, so the app refuses it
      // first TODAY. When bitbox-ffi sends it as P2wshP2sh (new library, tier
      // E proof with keys on 1', a BitBox test on the phone), flip this test
      // and narrow bitboxScriptBlocker to the sh(wsh) vaults that are not this.
      const b58 = createBase58check(sha256);
      const decodable = (tweak: number): string => {
        const bytes = new Uint8Array(b58.decode(TPUB_A));
        bytes[77] = (bytes[77] + tweak) % 256;
        return b58.encode(bytes);
      };
      const keystore = (label: string, fp: string, xpub: string, hw: string) => ({
        label,
        derivation: "m/48'/1'/0'/1'",
        root_fingerprint: fp,
        xpub,
        type: 'hardware',
        hw_type: hw,
      });
      const file = JSON.stringify({
        'x1/': keystore('Ledger Nano Gen5', '73c5da0a', TPUB_A, 'ledger'),
        'x2/': keystore('BitBox 02', 'a1b2c3d4', decodable(1), 'bitbox02'),
        'x3/': keystore('Passport', 'deadbeef', decodable(2), 'passport'),
        wallet_type: '2of3',
      });
      const { descriptor } = extractImportPayload(file);
      expect(descriptor).toBe(
        `sh(wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/1']${TPUB_A}/<0;1>/*,` +
          `[a1b2c3d4/48'/1'/0'/1']${decodable(1)}/<0;1>/*,` +
          `[deadbeef/48'/1'/0'/1']${decodable(2)}/<0;1>/*)))`,
      );
      // The firmware's P2WSH-P2SH account form, on every key.
      const origins = [...descriptor.matchAll(/\[[0-9a-f]{8}\/([^\]]+)\]/g)].map((m) => m[1]);
      expect(origins).toHaveLength(3);
      for (const o of origins) expect(o).toMatch(/^48'\/\d+'\/\d+'\/1'$/);
      // Today: refused for the BitBox before any device is asked; the Ledgers take it.
      expect(bitboxScriptBlocker(descriptor)).toBe(NOT_ON_BITBOX);
      expect(bitboxPolicyBlocker(descriptor)).toBe(NOT_ON_BITBOX);
      expect(ledgerPolicyBlocker(descriptor)).toBeNull();
    });
  });

  it('the Ledger layer’s refusals come first, word for word (one translator)', () => {
    const nonRanged = `sh(multi(2,[3442193e/48'/1'/0'/1']${TPUB_A}/0/5,[cc000007/48'/1'/0'/1']${TPUB_B}/0/5))`;
    expect(bitboxPolicyBlocker(nonRanged)).toBe('This vault type cannot be registered on a signing device.');
    const twoLists = `wsh(sortedmulti(2,[3442193e/48'/1'/0'/2']${TPUB_A}/0/*,[cc000007/48'/1'/0'/2']${TPUB_B}/0/*))`;
    expect(bitboxPolicyBlocker(twoLists)).toBe(ledgerPolicyBlocker(twoLists));
    expect(() => descriptorToBitboxPolicy(twoLists, 'x')).toThrow('two separate lists');
  });

  it('says it in plain words, with no dash', () => {
    expect(bitboxPolicyBlocker(SH_MULTI)).not.toMatch(/[\u2013\u2014]/);
  });

  it('the device registry’s blocker refuses a non-ranged vault too (decided 2026-10-17)', () => {
    // `deviceSuitsVault` reads bitboxScriptBlocker, not the translator's
    // blocker, so the shared non-ranged rule has to be in it.
    const UNSUPPORTED = 'This vault type cannot be registered on a signing device.';
    const fixed = `wsh(multi(2,[3442193e/48'/1'/0'/2']${TPUB_A}/0/5,[cc000007/48'/1'/0'/2']${TPUB_B}/0/5))`;
    expect(bitboxScriptBlocker(fixed)).toBe(UNSUPPORTED);
    expect(bitboxScriptBlocker(`sh(multi(2,[3442193e/48'/1'/0'/1']${TPUB_A}/0/5,[cc000007/48'/1'/0'/1']${TPUB_B}/0/5))`)).toBe(UNSUPPORTED);
    expect(bitboxScriptBlocker(SH_MULTI)).toBe(NOT_ON_BITBOX);
    expect(bitboxScriptBlocker(`wsh(sortedmulti(2,${KEYS}))`)).toBeNull();
  });
});
