import { UR, UREncoder } from '@ngraveio/bc-ur';
import {
  Bytes,
  CryptoAccount,
  CryptoCoinInfo,
  CryptoCoinInfoNetwork,
  CryptoCoinInfoType,
  CryptoHDKey,
  CryptoKeypath,
  CryptoOutput,
  MultiKey,
  PathComponent,
  ScriptExpressions,
} from '@keystonehq/bc-ur-registry';
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';

import {
  descriptorFromUrAccountKey,
  encodePsbtUrParts,
  isUrPart,
  UrJoiner,
  type UrAccountKey,
} from '../ur';

// --- fixtures -------------------------------------------------------------------

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

/** Deterministic pseudo-PSBT: the magic followed by a byte pattern. */
function fakePsbt(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(PSBT_MAGIC, 0);
  for (let i = PSBT_MAGIC.length; i < size; i++) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

const hexBytes = (h: string): Buffer => Buffer.from(h, 'hex');
const path = (...steps: number[]): PathComponent[] =>
  steps.map(index => new PathComponent({ index, hardened: true }));

/** The crypto-output wpkh example from BCR-2020-015, with an explicit source fingerprint. */
const SPEC_KEY = hexBytes(
  '03fd433450b6924b4f7efdd5d1ed017d364be95ab2b592dc8bddb3b00c1c24f63f',
);
const SPEC_CHAIN = hexBytes(
  '637807030d55d01f9a0cb3a7839515d796bd07706386a6eddf06cc29a65a0e29',
);
const SPEC_FP = hexBytes('37b5eed4');
const SPEC_PARENT_FP = hexBytes('59b69b2a');

function specHdKey(
  extra: { useInfo?: CryptoCoinInfo; steps?: number[]; withFp?: boolean } = {},
) {
  return new CryptoHDKey({
    isMaster: false,
    key: SPEC_KEY,
    chainCode: SPEC_CHAIN,
    origin: new CryptoKeypath(
      path(...(extra.steps ?? [84, 0, 0])),
      extra.withFp === false ? undefined : SPEC_FP,
    ),
    parentFingerprint: SPEC_PARENT_FP,
    useInfo: extra.useInfo,
  });
}

function singlePart(ur: UR): string {
  return new UREncoder(ur, 10_000).nextPart();
}

/**
 * The crypto-account test vector published with BCR-2020-015 (also in the
 * bc-ur-registry README): master fingerprint 37b5eed4, six outputs whose
 * origins carry NO source fingerprint (the account level holds it).
 */
const SPEC_ACCOUNT_UR =
  'ur:crypto-account/oeadcyemrewytyaolntaadmutaaddloxaxhdclaxwmfmdeiamecsdsemgtvsjzcncygrkowtrontzschgezokstswkkscfmklrtauteyaahdcxiehfonurdppfyntapejpproypegrdawkgmaewejlsfdtsrfybdehcaflmtrlbdhpamtaaddyoyadlncsdwykaeykaeykaycynlytsnyltaadmhtaadmwtaaddloxaxhdclaostvelfemdyynwydwyaievosrgmambklovabdgypdglldvespsthysadamhpmjeinaahdcxntdllnaaeykoytdacygegwhgjsiyonpywmcmrpwphsvodsrerozsbyaxluzcoxdpamtaaddyoyadlncsehykaeykaeykaycypdbskeuytaadmwtaaddloxaxhdclaxzcfxeegdrpmogrgwkbzctlttweadkiengrwlhtprremouoluutqdpfbncedkynfhaahdcxjpwevdeogthttkmeswzcolcpsaahcfnshkhtehytclmnteatmoteadtlwynnftloamtaaddyoyadlncsghykaeykaeykaycybthlvytstaadmhtaaddloxaxhdclaxhhsnhdrpftdwuocntilydibehnecmovdfekpjkclcslasbhkpawsaddmcmmnahnyaahdcxlotedtndfymyltclhlmtpfsadscnhtztaolbnnkistaedegwfmmedreetnwmcycnamtaaddyoyadlfcsdpykaycyemrewytytaadmhtaadmetaaddloxaxhdclaxdwkswmztpytnswtsecnblfbayajkdldeclqzzolrsnhljedsgminetytbnahatbyaahdcxkkguwsvyimjkvwteytwztyswvendtpmncpasfrrylprnhtkblndrgrmkoyjtbkrpamtaaddyoyadlocsdyykaeykaeykadykaycyhkrpnddrtaadmetaaddloxaxhdclaohnhffmvsbndslrfgclpfjejyatbdpebacnzokotofxntaoemvskpaowmryfnotfgaahdcxdlnbvecentssfsssgylnhkrstoytecrdlyadrekirfaybglahltalsrfcaeerobwamtaaddyoyadlocsdyykaeykaeykaoykaycyhkrpnddrgdaogykb';

/** The crypto-hdkey vector from the bc-ur-registry README (a master-level key with only a fingerprint). */
const SPEC_HDKEY_UR =
  'ur:crypto-hdkey/otaxhdclaxpsfswtmnsknejlceuogoqdaelbmhwnptlrecwpeehhfnpsfzbauecatleotsheptaahdcxvsbbhlrpdivdmelovygscttbstjpnllpasmtcaecmyvswpwftssffxrkcabsmdcxamtaaddyoeadlaaocylpgrstlfiewtseje';

function joinAll(parts: string[]): UrJoiner {
  const j = new UrJoiner();
  for (const p of parts) j.addPart(p);
  return j;
}

// --- PSBT round trips ---------------------------------------------------------

describe('encodePsbtUrParts', () => {
  it('yields one uppercase single-part UR for a small PSBT', () => {
    const parts = encodePsbtUrParts(fakePsbt(100));
    expect(parts).toHaveLength(1);
    expect(parts[0].startsWith('UR:CRYPTO-PSBT/')).toBe(true);
    expect(parts[0]).not.toMatch(/-\d+-\d+\//); // no sequence component
  });

  it('CBOR-encodes the PSBT as a byte string (global Buffer, not the registry re-export)', () => {
    // Bytewords of a CBOR byte string of magic + 01 02 03. The wrong Buffer
    // flavour silently encodes {type:"Buffer",data:[...]} instead.
    const parts = encodePsbtUrParts(Uint8Array.from([...PSBT_MAGIC, 1, 2, 3]));
    expect(parts[0]).toBe('UR:CRYPTO-PSBT/FDJOJKIDJYZMADAOAXTKAHHKEM');
  });

  it('emits 2 x the fragment count for a multi-part PSBT, all QR-alphanumeric', () => {
    const parts = encodePsbtUrParts(fakePsbt(1500), 200);
    // 1503 CBOR bytes over 200-byte fragments = 8 fragments
    expect(parts).toHaveLength(16);
    for (const [i, p] of parts.entries()) {
      expect(p).toMatch(/^UR:CRYPTO-PSBT\/\d+-8\/[A-Z]+$/);
      expect(p.startsWith(`UR:CRYPTO-PSBT/${i + 1}-8/`)).toBe(true);
    }
  });

  it('refuses non-PSBT bytes', () => {
    expect(() => encodePsbtUrParts(Uint8Array.from([1, 2, 3]))).toThrow(
      'Not a PSBT',
    );
    expect(() => encodePsbtUrParts(new Uint8Array(0))).toThrow('Not a PSBT');
  });
});

describe('UrJoiner with crypto-psbt', () => {
  const psbt = fakePsbt(1500);
  const parts = encodePsbtUrParts(psbt, 200);
  const seqLen = 8;

  function expectPsbt(j: UrJoiner) {
    const payload = j.result();
    expect(payload.kind).toBe('psbt');
    if (payload.kind !== 'psbt') return;
    expect(payload.psbt).toBeInstanceOf(Uint8Array);
    expect(Array.from(payload.psbt)).toEqual(Array.from(psbt));
  }

  it('reports empty progress before any part', () => {
    expect(new UrJoiner().progress()).toEqual({
      have: 0,
      total: 0,
      done: false,
    });
    expect(() => new UrJoiner().result()).toThrow('incomplete');
  });

  it('single-part transfer completes on the first scan', () => {
    const small = fakePsbt(60);
    const j = new UrJoiner();
    expect(j.addPart(encodePsbtUrParts(small)[0])).toEqual({
      have: 1,
      total: 1,
      done: true,
    });
    expect(j.urType).toBe('crypto-psbt');
    const payload = j.result();
    expect(payload.kind === 'psbt' && Array.from(payload.psbt)).toEqual(
      Array.from(small),
    );
  });

  it('joins the plain fragments in order', () => {
    const j = new UrJoiner();
    for (let i = 0; i < seqLen; i++) {
      const p = j.addPart(parts[i]);
      expect(p.total).toBe(seqLen);
      expect(p.have).toBe(i + 1);
      expect(p.done).toBe(i === seqLen - 1);
    }
    expectPsbt(j);
  });

  it('joins the plain fragments out of order, with duplicates', () => {
    const order = [5, 2, 7, 0, 2, 6, 1, 4, 4, 3];
    const j = new UrJoiner();
    let last = j.progress();
    for (const i of order) last = j.addPart(parts[i]);
    expect(last.done).toBe(true);
    expectPsbt(j);
  });

  it('waits for a missing fragment, then completes when it arrives', () => {
    const j = new UrJoiner();
    for (let i = 0; i < seqLen; i++) if (i !== 3) j.addPart(parts[i]);
    expect(j.progress()).toEqual({
      have: seqLen - 1,
      total: seqLen,
      done: false,
    });
    expect(() => j.result()).toThrow('incomplete');
    expect(j.addPart(parts[3]).done).toBe(true);
    expectPsbt(j);
  });

  it('completes within one lap of the animated loop from any starting frame', () => {
    for (let start = 0; start < parts.length; start++) {
      const j = new UrJoiner();
      let feeds = 0;
      let i = start;
      while (!j.progress().done) {
        j.addPart(parts[i % parts.length]);
        i++;
        feeds++;
        if (feeds > parts.length)
          throw new Error(`no completion from frame ${start}`);
      }
      expectPsbt(j);
    }
  });

  it('accepts parts in any letter case', () => {
    const j = joinAll(parts.slice(0, seqLen).map(p => p.toLowerCase()));
    expect(j.progress().done).toBe(true);
    expectPsbt(j);
  });

  it('ignores extra parts after completion', () => {
    const j = joinAll(parts.slice(0, seqLen));
    expect(j.addPart(parts[seqLen])).toEqual({
      have: seqLen,
      total: seqLen,
      done: true,
    });
    expectPsbt(j);
  });

  it('drops a part from another transfer of the same type', () => {
    const other = encodePsbtUrParts(fakePsbt(1400), 200);
    const j = new UrJoiner();
    j.addPart(parts[0]);
    expect(j.addPart(other[0])).toEqual({
      have: 1,
      total: seqLen,
      done: false,
    });
  });

  it('rejects text that is not a UR and parts of a different UR type', () => {
    const j = new UrJoiner();
    expect(() => j.addPart('B$2P0100AAAA')).toThrow('Not a UR code');
    expect(() => j.addPart('ur:crypto-psbt')).toThrow('Unreadable');
    j.addPart(parts[0]);
    const bytesUr = singlePart(new Bytes(Buffer.from('hello')).toUR());
    expect(() => j.addPart(bytesUr)).toThrow('different transfer');
  });
});

// --- crypto-account / crypto-hdkey -------------------------------------------------

describe('UrJoiner with crypto-account', () => {
  it('decodes a wpkh account built with the registry classes', () => {
    const hd = specHdKey();
    const account = new CryptoAccount(SPEC_FP, [
      new CryptoOutput([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH], hd),
    ]);
    const j = joinAll([singlePart(account.toUR()).toUpperCase()]);
    const payload = j.result();
    expect(payload.kind).toBe('account');
    if (payload.kind !== 'account') return;
    expect(payload.keys).toHaveLength(1);
    const key = payload.keys[0];
    expect(key).toEqual({
      xpub: 'xpub6CK1oLFK2zjoV3kfgGPVAbMWUFFtZ9UaB28BzXxSYcmUpYkwVUJtxUxYpcEwkLjhRtzss2wWWLWgN7ECQE3bQkKsW7KPTZzkwVrJ3XUS5V5',
      fingerprint: '37b5eed4',
      originPath: "84'/0'/0'",
      scriptType: 'wpkh',
      network: 'bitcoin',
    });
    // Cross-check the xpub against the library's own encoder.
    expect(key.xpub).toBe(hd.getBip32Key());
    expect(descriptorFromUrAccountKey(key)).toBe(
      "wpkh([37b5eed4/84'/0'/0']xpub6CK1oLFK2zjoV3kfgGPVAbMWUFFtZ9UaB28BzXxSYcmUpYkwVUJtxUxYpcEwkLjhRtzss2wWWLWgN7ECQE3bQkKsW7KPTZzkwVrJ3XUS5V5/<0;1>/*)",
    );
  });

  it('decodes the BCR-2020-015 spec vector, taking the fingerprint from the account level', () => {
    const payload = joinAll([SPEC_ACCOUNT_UR.toUpperCase()]).result();
    expect(payload.kind).toBe('account');
    if (payload.kind !== 'account') return;
    expect(
      payload.keys.map(k => [
        k.scriptType,
        k.originPath,
        k.fingerprint,
        k.network,
      ]),
    ).toEqual([
      ['pkh', "44'/0'/0'", '37b5eed4', 'bitcoin'],
      ['sh-wpkh', "49'/0'/0'", '37b5eed4', 'bitcoin'],
      ['wpkh', "84'/0'/0'", '37b5eed4', 'bitcoin'],
      ['unknown', "45'", '37b5eed4', 'bitcoin'], // sh(cosigner)
      ['unknown', "48'/0'/0'/1'", '37b5eed4', 'bitcoin'], // sh(wsh(cosigner))
      ['wsh', "48'/0'/0'/2'", '37b5eed4', 'bitcoin'], // wsh(cosigner)
    ]);
    expect(payload.keys.map(k => k.xpub)).toEqual([
      'xpub6CnQkivUEH9bSbWVWfDLCtigKKgnSWGaVSRyCbN2QNBJzuvHT1vUQpgSpY1NiVvoeNEuVwk748Cn9G3NtbQB1aGGsEL7aYEnjVWgjj9tefu',
      'xpub6CtR1iF4dZPkEyXDwVf3HE74tSwXNMcHtBzX4gwz2UnPhJ54Jz5unHx2syYCCDkvVUmsmoYTmcaHXe1wJppvct4GMMaN5XAbRk7yGScRSte',
      'xpub6BkU445MSEBXbPjD3g2c2ch6mn8yy1SXXQUM7EwjgYiq6Wt1NDwDZ45npqWcV8uQC5oi2gHuVukoCoZZyT4HKq8EpotPMqGqxdZRuapCQ23',
      'xpub68JFLJTH96GUqC6SoVw5c2qyLSt776PGu5xde8ddVACuPYyarvSL827TbZGavuNbKQ8DG3VP9fCXPhQRBgPrS4MPG3zaZgwAGuPHYvVuY9X',
      'xpub6EC9f7mLFJQoPaqDJ72Zbv67JWzmpXvCYQSecER9GzkYy5eWLsVLbHnxoAZ8NnnsrjhMLduJo9dG6fNQkmMFL3Qedj2kf5bEy5tptHPApNf',
      'xpub6EC9f7mLFJQoRQ6qiTvWQeeYsgtki6fBzSUgWgUtAujEMtAfJSAn3AVS4KrLHRV2hNX77YwNkg4azUzuSwhNGtcq4r2J8bLGMDkrQYHvoed',
    ]);
    expect(descriptorFromUrAccountKey(payload.keys[1])).toBe(
      "sh(wpkh([37b5eed4/49'/0'/0']xpub6CtR1iF4dZPkEyXDwVf3HE74tSwXNMcHtBzX4gwz2UnPhJ54Jz5unHx2syYCCDkvVUmsmoYTmcaHXe1wJppvct4GMMaN5XAbRk7yGScRSte/<0;1>/*))",
    );
    expect(descriptorFromUrAccountKey(payload.keys[0])).toMatch(
      /^pkh\(\[37b5eed4\/44'\/0'\/0'\]xpub6CnQk.*\/<0;1>\/\*\)$/,
    );
  });

  it('keeps the taproot tag (409) the registry does not know', () => {
    // 311({1: 37b5eed4, 2: [409(303({3: key, 4: chain, 6: 304({1: 86'/0'/0', 2: 37b5eed4}), 8: 59b69b2a}))]})
    const cbor =
      'a2011a37b5eed40281d90199d9012fa4035821' +
      '02'.repeat(33) +
      '045820' +
      '03'.repeat(32) +
      '06d90130a2018618' +
      '56f500f500f5021a37b5eed4081a59b69b2a';
    const ur = new UR(hexBytes(cbor), 'crypto-account');
    const payload = joinAll([singlePart(ur)]).result();
    expect(payload.kind).toBe('account');
    if (payload.kind !== 'account') return;
    expect(payload.keys).toHaveLength(1);
    expect(payload.keys[0]).toMatchObject({
      fingerprint: '37b5eed4',
      originPath: "86'/0'/0'",
      scriptType: 'tr',
      network: 'bitcoin',
    });
    expect(descriptorFromUrAccountKey(payload.keys[0])).toMatch(
      /^tr\(\[37b5eed4\/86'\/0'\/0'\]xpub[1-9A-HJ-NP-Za-km-z]+\/<0;1>\/\*\)$/,
    );
  });

  it('skips multisig and EC-key outputs rather than inventing single-sig keys', () => {
    const hd = specHdKey();
    const account = new CryptoAccount(SPEC_FP, [
      new CryptoOutput([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH], hd),
      new CryptoOutput(
        [
          ScriptExpressions.WITNESS_SCRIPT_HASH,
          ScriptExpressions.SORTED_MULTISIG,
        ],
        new MultiKey(2, [hd, specHdKey({ steps: [48, 0, 0, 2] })]),
      ),
    ]);
    const payload = joinAll([singlePart(account.toUR())]).result();
    expect(
      payload.kind === 'account' && payload.keys.map(k => k.scriptType),
    ).toEqual(['wpkh']);
  });

  it('reads testnet from crypto-coin-info and falls back to the coin type', () => {
    const viaUseInfo = specHdKey({
      useInfo: new CryptoCoinInfo(
        CryptoCoinInfoType.bitcoin,
        CryptoCoinInfoNetwork.testnet,
      ),
    });
    const a = joinAll([singlePart(viaUseInfo.toUR())]).result();
    expect(a.kind === 'hdkey' && a.key.network).toBe('testnet');
    expect(a.kind === 'hdkey' && a.key.xpub.startsWith('tpub')).toBe(true);

    const viaPath = specHdKey({ steps: [84, 1, 0] });
    const b = joinAll([singlePart(viaPath.toUR())]).result();
    expect(b.kind === 'hdkey' && b.key.network).toBe('testnet');
    expect(b.kind === 'hdkey' && b.key.xpub.startsWith('tpub')).toBe(true);
  });

  it('refuses private key material', () => {
    const priv = new CryptoHDKey({
      isMaster: false,
      isPrivateKey: true,
      key: hexBytes('00' + 'ab'.repeat(32)),
      chainCode: SPEC_CHAIN,
      origin: new CryptoKeypath(path(84, 0, 0), SPEC_FP),
    });
    const j = joinAll([singlePart(priv.toUR())]);
    expect(() => j.result()).toThrow('private key');
  });
});

describe('UrJoiner with crypto-hdkey', () => {
  it('decodes the README vector (master-level key, fingerprint only)', () => {
    const payload = joinAll([SPEC_HDKEY_UR]).result();
    expect(payload).toEqual({
      kind: 'hdkey',
      key: {
        xpub: 'xpub661MyMwAqRbcGrSy23RC9y3S1QS1TUFmwj64mpx6k2vFwz1vcS7BcToj4NoTsu1pjZHJnHxTsrKu2UHaKhRqRbHHhbjAN2ytU8hUpYgkaYq',
        fingerprint: '854bc782',
        originPath: null,
        scriptType: 'unknown',
        network: 'bitcoin',
      },
    });
  });

  it('infers the script type from the BIP purpose of a bare key', () => {
    const cases: Array<[number[], UrAccountKey['scriptType']]> = [
      [[84, 0, 0], 'wpkh'],
      [[49, 0, 0], 'sh-wpkh'],
      [[44, 0, 0], 'pkh'],
      [[86, 0, 0], 'tr'],
      [[48, 0, 0, 2], 'unknown'],
    ];
    for (const [steps, expected] of cases) {
      const payload = joinAll([
        singlePart(specHdKey({ steps }).toUR()),
      ]).result();
      expect(payload.kind === 'hdkey' && payload.key.scriptType).toBe(expected);
      expect(payload.kind === 'hdkey' && payload.key.fingerprint).toBe(
        '37b5eed4',
      );
    }
  });

  it('leaves the fingerprint null when the key carries none', () => {
    const payload = joinAll([
      singlePart(specHdKey({ withFp: false }).toUR()),
    ]).result();
    expect(payload.kind === 'hdkey' && payload.key.fingerprint).toBeNull();
    expect(
      payload.kind === 'hdkey' && descriptorFromUrAccountKey(payload.key),
    ).toMatch(/^wpkh\(xpub/);
  });
});

// --- crypto-output ------------------------------------------------------------------

describe('UrJoiner with crypto-output', () => {
  /** BCR-2020-010 test vectors 1 to 5, UR strings as published. */
  const SPEC_OUTPUT_1 =
    'ur:crypto-output/taadmutaadeyoyaxhdclaoswaalbmwfpwekijndyfefzjtmdrtketphhktmngrlkwsfnospypsasrhhhjonnvwtsqzwljy';
  const SPEC_OUTPUT_2 =
    'ur:crypto-output/taadmhtaadmwtaadeyoyaxhdclaxzmytkgtlkphywyoxcxfeftbbecgmectelfynfldllpisoyludlahknbbhndtkphfhlehmust';
  const SPEC_OUTPUT_3 =
    'ur:crypto-output/taadmhtaadmtoeadaoaolftaadeyoyaxhdclaodladvwvyhhsgeccapewflrfhrlbsfndlbkcwutahvwpeloleioksglwfvybkdradtaadeyoyaxhdclaxpstylrvowtstynguaspmchlenegonyryvtmsmtmsgshgvdbbsrhebybtztdisfrnpfadremh';
  const SPEC_OUTPUT_4 =
    'ur:crypto-output/taadmutaaddlonaxhdclaotdqdinaeesjzmolfzsbbidlpiyhddlcximhltirfsptlvsmohscsamsgzoaxadwtaahdcxiaksataxbtgotictnybnqdoslsmdbztsmtryatjoialnolweuramsfdtolhtbadtamtaaddyotadlncsdwykaeykaeykaocytegtqdfhaxaaattaaddyoyadlradwklawkaycyksfpdmftkiiozsfd';
  const SPEC_OUTPUT_5 =
    'ur:crypto-output/taadmetaadmtoeadadaolftaaddloxaxhdclaxsbsgptsolkltkndsmskiaelfhhmdimcnmnlgutzotecpsfveylgrbdhptbpsveosaahdcxhnganelacwldjnlschnyfxjyplrllfdrplpswdnbuyctlpwyfmmhgsgtwsrymtldamtaaddyoeadlaaxaeattaaddyoyadlnadwkaewklawktaaddloxaxhdclaoztnnhtwtpslgndfnwpzedrlomnclchrdfsayntlplplojznslfjejecpptlgbgwdaahdcxwtmhnyzmpkkbvdpyvwutglbeahmktyuogusnjonththhdwpsfzvdfpdlcndlkensamtaaddyoeadlfaewkaocyrycmrnvwattaaddyoyadlnaewkaewklawktdbsfttn';

  /** xpub of SPEC_KEY/SPEC_CHAIN at [37b5eed4/84'/0'/0'] with parent 59b69b2a (pinned above). */
  const SPEC_XPUB =
    'xpub6CK1oLFK2zjoV3kfgGPVAbMWUFFtZ9UaB28BzXxSYcmUpYkwVUJtxUxYpcEwkLjhRtzss2wWWLWgN7ECQE3bQkKsW7KPTZzkwVrJ3XUS5V5';
  const XPUB_RE = '(xpub[1-9A-HJ-NP-Za-km-z]+)';

  /** crypto-hdkey map (tag 303): SPEC_KEY, SPEC_CHAIN, origin 37b5eed4/<steps>, parent 59b69b2a, plus `extra` map entries. */
  function hdkeyHex(steps: string, extra = ''): string {
    const n = steps.split('/').length;
    const components = steps
      .split('/')
      .map(s => {
        const hardened = s.endsWith("'");
        const i = parseInt(s, 10);
        return (i < 24 ? i.toString(16).padStart(2, '0') : '18' + i.toString(16)) + (hardened ? 'f5' : 'f4');
      })
      .join('');
    const entries = 4 + (extra ? 1 : 0);
    return (
      'd9012fa' + entries +
      '035821' + SPEC_KEY.toString('hex') +
      '045820' + SPEC_CHAIN.toString('hex') +
      '06d90130a201' + '8' + n * 2 + components + '021a37b5eed4' +
      extra +
      '081a59b69b2a'
    );
  }

  const b58check = createBase58check(sha256);
  const decodeXpub = (xpub: string): Uint8Array => b58check.decode(xpub);
  const hexOf = (b: Uint8Array): string => Buffer.from(b).toString('hex');

  function descriptorOf(ur: string): string {
    const j = joinAll([ur]);
    expect(j.urType).toBe('crypto-output');
    const payload = j.result();
    expect(payload.kind).toBe('output');
    if (payload.kind !== 'output') throw new Error('not an output');
    return payload.descriptor;
  }
  const descriptorOfCbor = (cborHex: string): string =>
    descriptorOf(singlePart(new UR(hexBytes(cborHex), 'crypto-output')));
  const failsWith = (cborHex: string, message: string | RegExp) =>
    expect(() => descriptorOfCbor(cborHex)).toThrow(message);

  it('decodes spec vectors 1 to 3 (EC keys) to the published descriptors', () => {
    expect(descriptorOf(SPEC_OUTPUT_1)).toBe(
      'pkh(02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5)',
    );
    expect(descriptorOf(SPEC_OUTPUT_2.toUpperCase())).toBe(
      'sh(wpkh(03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556))',
    );
    expect(descriptorOf(SPEC_OUTPUT_3)).toBe(
      'sh(multi(2,022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01,03acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe))',
    );
  });

  it('decodes spec vector 4 (pkh over an hdkey with origin, depth and children)', () => {
    // Published: pkh([d34db33f/44'/0'/0']xpub6ERApfZ...RcEL/1/*). That xpub
    // (Bitcoin Core's fabricated test key) carries child index 0xfffffffe,
    // which the CBOR has no way to say: its last origin component is 0'
    // (0x80000000). Every other field of the xpub round-trips, including the
    // explicit depth 4 over three origin components.
    const m = descriptorOf(SPEC_OUTPUT_4).match(
      new RegExp(`^pkh\\(\\[d34db33f/44'/0'/0'\\]${XPUB_RE}/1/\\*\\)$`),
    );
    expect(m).not.toBeNull();
    const ours = decodeXpub(m![1]);
    const spec = decodeXpub(
      'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL',
    );
    expect(hexOf(ours.slice(0, 9))).toBe(hexOf(spec.slice(0, 9))); // version, depth 4, parent 78412e3a
    expect(hexOf(ours.slice(13))).toBe(hexOf(spec.slice(13))); // chain code + key
    expect(hexOf(ours.slice(9, 13))).toBe('80000000');
    expect(hexOf(spec.slice(9, 13))).toBe('fffffffe');
  });

  it('decodes spec vector 5 (wsh(multi) over two hdkeys with children paths)', () => {
    // Published: wsh(multi(1,xpub661My...duB/1/0/*,xpub69H7F5...QTPH/0/0/*)).
    // Both xpubs round-trip: the second's parent fingerprint bd16bee5 is the
    // source fingerprint of its one-step origin. The CBOR carries that
    // origin, so the text keeps it as [bd16bee5/0]; the spec's descriptor
    // line, copied from Bitcoin Core's vector, leaves it out.
    expect(descriptorOf(SPEC_OUTPUT_5)).toBe(
      'wsh(multi(1,xpub661MyMwAqRbcFW31YEwpkMuc5THy2PSt5bDMsktWQcFF8syAmRUapSCGu8ED9W6oDMSgv6Zz8idoc4a6mr8BDzTJY47LJhkJ8UB7WEGuduB/1/0/*,[bd16bee5/0]xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH/0/0/*))',
    );
  });

  it('renders a Sparrow single-sig export (origin + coin info + label, no children) on the multipath spine', () => {
    const hd = new CryptoHDKey({
      isMaster: false,
      key: SPEC_KEY,
      chainCode: SPEC_CHAIN,
      origin: new CryptoKeypath(path(84, 0, 0), SPEC_FP, 3),
      parentFingerprint: SPEC_PARENT_FP,
      useInfo: new CryptoCoinInfo(
        CryptoCoinInfoType.bitcoin,
        CryptoCoinInfoNetwork.mainnet,
      ),
      name: 'Keystore 1',
    });
    const ur = (exprs: (typeof ScriptExpressions.SCRIPT_HASH)[]) =>
      singlePart(new CryptoOutput(exprs, hd).toUR()).toUpperCase();
    const inner = `[37b5eed4/84'/0'/0']${SPEC_XPUB}/<0;1>/*`;
    expect(descriptorOf(ur([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH]))).toBe(
      `wpkh(${inner})`,
    );
    expect(
      descriptorOf(
        ur([
          ScriptExpressions.SCRIPT_HASH,
          ScriptExpressions.WITNESS_PUBLIC_KEY_HASH,
        ]),
      ),
    ).toBe(`sh(wpkh(${inner}))`);
    expect(descriptorOf(ur([ScriptExpressions.PUBLIC_KEY_HASH]))).toBe(
      `pkh(${inner})`,
    );
    expect(descriptorOf(ur([ScriptExpressions.PUBLIC_KEY]))).toBe(
      `pk(${inner})`,
    );
  });

  it('renders a Sparrow multisig export as wsh(sortedmulti) with every key origin', () => {
    const a = new CryptoHDKey({
      isMaster: false,
      key: SPEC_KEY,
      chainCode: SPEC_CHAIN,
      origin: new CryptoKeypath(path(48, 0, 0, 2), SPEC_FP, 4),
      parentFingerprint: SPEC_PARENT_FP,
      name: 'Coldcard',
    });
    const b = new CryptoHDKey({
      isMaster: false,
      key: hexBytes(
        '02fc9e5af0ac8d9b3cecfe2a888e2117ba3d089d8585886c9c826b6b22a98d12ea',
      ),
      chainCode: hexBytes(
        'f0909affaa7ee7abe5dd4e100598d4dc53cd709d5a5c2cac40e7412f232f7c9c',
      ),
      origin: new CryptoKeypath(path(48, 0, 0, 2), hexBytes('bd16bee5'), 4),
      parentFingerprint: hexBytes('11223344'),
      name: 'Ledger',
    });
    // Sparrow sorts the keys by their first receive pubkey; the order sent is kept.
    const out = new CryptoOutput(
      [ScriptExpressions.WITNESS_SCRIPT_HASH, ScriptExpressions.SORTED_MULTISIG],
      new MultiKey(2, [b, a]),
    );
    const descriptor = descriptorOf(singlePart(out.toUR()));
    // The registry's own xpub encoder agrees whenever the parent fingerprint
    // is explicit and the depth equals the component count, as here.
    expect(descriptor).toBe(
      `wsh(sortedmulti(2,[bd16bee5/48'/0'/0'/2']${b.getBip32Key()}/<0;1>/*,[37b5eed4/48'/0'/0'/2']${a.getBip32Key()}/<0;1>/*))`,
    );
    expect(descriptor).toMatch(/^wsh\(sortedmulti\(2,\[bd16bee5\/48'\/0'\/0'\/2'\]xpub6[1-9A-HJ-NP-Za-km-z]+\/<0;1>\/\*,\[37b5eed4\/48'\/0'\/0'\/2'\]xpub6[1-9A-HJ-NP-Za-km-z]+\/<0;1>\/\*\)\)$/);

    const nested = new CryptoOutput(
      [
        ScriptExpressions.SCRIPT_HASH,
        ScriptExpressions.WITNESS_SCRIPT_HASH,
        ScriptExpressions.SORTED_MULTISIG,
      ],
      new MultiKey(1, [a, b]),
    );
    expect(descriptorOf(singlePart(nested.toUR()))).toBe(
      `sh(wsh(sortedmulti(1,[37b5eed4/48'/0'/0'/2']${a.getBip32Key()}/<0;1>/*,[bd16bee5/48'/0'/0'/2']${b.getBip32Key()}/<0;1>/*)))`,
    );
    const legacy = new CryptoOutput(
      [ScriptExpressions.SCRIPT_HASH, ScriptExpressions.MULTISIG],
      new MultiKey(2, [a, b]),
    );
    expect(descriptorOf(singlePart(legacy.toUR()))).toMatch(
      /^sh\(multi\(2,\[37b5eed4\/48'\/0'\/0'\/2'\]xpub6.+\/<0;1>\/\*,\[bd16bee5\/48'\/0'\/0'\/2'\]xpub6.+\/<0;1>\/\*\)\)$/,
    );
  });

  it('renders a Sparrow taproot export (tag 409, which the registry does not know)', () => {
    expect(descriptorOfCbor('d90199' + hdkeyHex("86'/0'/0'"))).toMatch(
      new RegExp(`^tr\\(\\[37b5eed4/86'/0'/0'\\]${XPUB_RE}/<0;1>/\\*\\)$`),
    );
  });

  it('renders the children keypath as sent: 0/*, 1/* and a receive/change pair', () => {
    const withChildren = (children: PathComponent[]) =>
      singlePart(
        new CryptoOutput(
          [ScriptExpressions.WITNESS_PUBLIC_KEY_HASH],
          new CryptoHDKey({
            isMaster: false,
            key: SPEC_KEY,
            chainCode: SPEC_CHAIN,
            origin: new CryptoKeypath(path(84, 0, 0), SPEC_FP),
            parentFingerprint: SPEC_PARENT_FP,
            children: new CryptoKeypath(children),
          }),
        ).toUR(),
      );
    const wildcard = new PathComponent({ hardened: false });
    const idx = (index: number) => new PathComponent({ index, hardened: false });
    expect(descriptorOf(withChildren([idx(0), wildcard]))).toBe(
      `wpkh([37b5eed4/84'/0'/0']${SPEC_XPUB}/0/*)`,
    );
    expect(descriptorOf(withChildren([idx(1), wildcard]))).toBe(
      `wpkh([37b5eed4/84'/0'/0']${SPEC_XPUB}/1/*)`,
    );
    expect(descriptorOf(withChildren([idx(5)]))).toBe(
      `wpkh([37b5eed4/84'/0'/0']${SPEC_XPUB}/5)`,
    );

    // BCR-2020-007 child-pair-component: one 4-element array, no hardened
    // flag after it. The registry cannot build one, so the CBOR is by hand:
    // children {1: [[0,false,1,false], [], false]}. (The registry's own
    // keypath parser reads that pair as a wildcard.)
    const pair = (ext: number, int: number) =>
      '07d90130a1018384' + `0${ext}f40${int}f4` + '80f4';
    expect(
      descriptorOfCbor('d90194' + hdkeyHex("84'/0'/0'", pair(0, 1))),
    ).toBe(`wpkh([37b5eed4/84'/0'/0']${SPEC_XPUB}/<0;1>/*)`);
    expect(
      descriptorOfCbor('d90194' + hdkeyHex("84'/0'/0'", pair(2, 3))),
    ).toBe(`wpkh([37b5eed4/84'/0'/0']${SPEC_XPUB}/<2;3>/*)`);
  });

  it('writes a tpub for a testnet export', () => {
    const hd = specHdKey({
      useInfo: new CryptoCoinInfo(
        CryptoCoinInfoType.bitcoin,
        CryptoCoinInfoNetwork.testnet,
      ),
    });
    const out = new CryptoOutput([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH], hd);
    expect(descriptorOf(singlePart(out.toUR()))).toMatch(
      /^wpkh\(\[37b5eed4\/84'\/0'\/0'\]tpub[1-9A-HJ-NP-Za-km-z]+\/<0;1>\/\*\)$/,
    );
  });

  it('leaves the origin out when the key carries no fingerprint', () => {
    const out = new CryptoOutput(
      [ScriptExpressions.WITNESS_PUBLIC_KEY_HASH],
      specHdKey({ withFp: false }),
    );
    expect(descriptorOf(singlePart(out.toUR()))).toMatch(
      /^wpkh\(xpub[1-9A-HJ-NP-Za-km-z]+\/<0;1>\/\*\)$/,
    );
  });

  it('refuses script expressions it cannot turn into a watchable descriptor', () => {
    const hd = hdkeyHex("84'/0'/0'");
    failsWith('d90190d9019843010203', 'raw()'); // sh(raw(010203))
    failsWith('d90190d9019a' + hd, 'cosigner()'); // sh(cosigner(hdkey))
    failsWith('d90195' + hd, 'combo()'); // combo(hdkey)
    failsWith('d90133' + hd, 'addr()'); // addr(...)
    // An unassigned tag in the registry's range (450). Tags the CBOR layer
    // was not told to keep vanish on decode, which is why ur.ts registers
    // the whole range: unpatched, 450(wpkh(key)) would read as wpkh(key).
    failsWith('d901c2' + hd, 'does not know');
    failsWith('d901c2d90194' + hd, 'does not know');
    // tr(sortedmulti(2, hdkey, hdkey)): a taproot script tree
    failsWith('d90199d90197a20102028' + '2' + hd + hd, 'script tree');
  });

  it('refuses nestings that are not descriptors', () => {
    const hd = hdkeyHex("84'/0'/0'");
    failsWith('d90191d90194' + hd, 'nests wpkh() inside wsh()');
    failsWith('d90193d90194' + hd, 'nests wpkh() inside pkh()');
    failsWith('d90190' + hd, 'bare key'); // sh(hdkey)
    failsWith('d90191' + hd, 'bare key'); // wsh(hdkey)
    failsWith(hd, 'not a descriptor'); // a lone hdkey under the wrong UR type
  });

  it('refuses keys and paths it cannot render honestly', () => {
    // private EC key: 403(306({2: true, 3: h'02..'}))
    failsWith('d90193d90132a202f5035821' + '02'.repeat(33), 'private key');
    // uncompressed / short EC key
    failsWith('d90193d90132a103582004' + '02'.repeat(31), 'compressed public key');
    // private hdkey inside wpkh
    failsWith(
      'd90194d9012fa302f5035821' + '00' + 'ab'.repeat(32) + '045820' + '03'.repeat(32),
      'private key',
    );
    // children with a range [0,10]
    failsWith(
      'd90194' + hdkeyHex("84'/0'/0'", '07d90130a1018282000af4'),
      'range of child keys',
    );
    // children with a hardened wildcard
    failsWith('d90194' + hdkeyHex("84'/0'/0'", '07d90130a1018280f5'), 'hardened child keys');
    // children with a hardened index: 0'/*
    failsWith('d90194' + hdkeyHex("84'/0'/0'", '07d90130a1018400f580f4'), 'hardened child keys');
    // origin with a wildcard component
    failsWith(
      'd90194d9012fa4035821' + '02'.repeat(33) + '045820' + '03'.repeat(32) +
        '06d90130a2018280f5021a37b5eed4081a59b69b2a',
      'plain derivation path',
    );
    // threshold above the key count
    const hd = hdkeyHex("48'/0'/0'/2'");
    failsWith('d90191d90196a201030282' + hd + hd, 'malformed');
    // a multisig with no keys
    failsWith('d90191d90196a201010280', 'malformed');
  });
});

// --- bytes / unknown ---------------------------------------------------------------

describe('UrJoiner with other types', () => {
  it('decodes a bytes UR holding JSON text', () => {
    const json = JSON.stringify({
      label: 'Passport',
      xfp: '37b5eed4',
      note: 'Grüße',
    });
    const payload = joinAll([
      singlePart(new Bytes(Buffer.from(json, 'utf8')).toUR()).toUpperCase(),
    ]).result();
    expect(payload.kind).toBe('bytes');
    if (payload.kind !== 'bytes') return;
    expect(payload.text).toBe(json);
    expect(JSON.parse(payload.text!)).toMatchObject({ label: 'Passport' });
    expect(Array.from(payload.bytes)).toEqual(
      Array.from(Buffer.from(json, 'utf8')),
    );
  });

  it('reports null text for bytes that are not UTF-8', () => {
    const payload = joinAll([
      singlePart(new Bytes(hexBytes('fffe0102')).toUR()),
    ]).result();
    expect(payload.kind === 'bytes' && payload.text).toBeNull();
    const truncated = joinAll([
      singlePart(new Bytes(hexBytes('41e282')).toUR()),
    ]).result();
    expect(truncated.kind === 'bytes' && truncated.text).toBeNull();
  });

  it('surfaces an unknown UR type by name', () => {
    const ur = new UR(hexBytes('a0'), 'crypto-seed');
    expect(joinAll([singlePart(ur)]).result()).toEqual({
      kind: 'unknown',
      type: 'crypto-seed',
    });
  });
});

// --- helpers ---------------------------------------------------------------------------

describe('isUrPart', () => {
  it('detects UR parts in any case', () => {
    expect(isUrPart('ur:crypto-psbt/hdcx')).toBe(true);
    expect(isUrPart('UR:CRYPTO-PSBT/1-8/HDCX')).toBe(true);
    expect(isUrPart('  Ur:bytes/abc')).toBe(true);
    expect(isUrPart('B$2P0100AAAA')).toBe(false);
    expect(isUrPart('cHNidP8BAAA=')).toBe(false);
    expect(isUrPart('bitcoin:bc1q...')).toBe(false);
    expect(isUrPart('')).toBe(false);
  });
});

describe('descriptorFromUrAccountKey', () => {
  const base: UrAccountKey = {
    xpub: 'xpub6CK1oLFK2zjoV3kfgGPVAbMWUFFtZ9UaB28BzXxSYcmUpYkwVUJtxUxYpcEwkLjhRtzss2wWWLWgN7ECQE3bQkKsW7KPTZzkwVrJ3XUS5V5',
    fingerprint: '37b5eed4',
    originPath: "84'/0'/0'",
    scriptType: 'wpkh',
    network: 'bitcoin',
  };
  const inner = `[37b5eed4/84'/0'/0']${base.xpub}/<0;1>/*`;

  it('builds every single-sig form', () => {
    expect(descriptorFromUrAccountKey(base)).toBe(`wpkh(${inner})`);
    expect(descriptorFromUrAccountKey({ ...base, scriptType: 'sh-wpkh' })).toBe(
      `sh(wpkh(${inner}))`,
    );
    expect(descriptorFromUrAccountKey({ ...base, scriptType: 'pkh' })).toBe(
      `pkh(${inner})`,
    );
    expect(descriptorFromUrAccountKey({ ...base, scriptType: 'tr' })).toBe(
      `tr(${inner})`,
    );
  });

  it('writes the origin only as far as it is known', () => {
    expect(descriptorFromUrAccountKey({ ...base, originPath: null })).toBe(
      `wpkh([37b5eed4]${base.xpub}/<0;1>/*)`,
    );
    expect(descriptorFromUrAccountKey({ ...base, fingerprint: null })).toBe(
      `wpkh(${base.xpub}/<0;1>/*)`,
    );
  });

  it('refuses keys that cannot make a single-key vault', () => {
    expect(() =>
      descriptorFromUrAccountKey({ ...base, scriptType: 'wsh' }),
    ).toThrow('multisig');
    expect(() =>
      descriptorFromUrAccountKey({ ...base, scriptType: 'unknown' }),
    ).toThrow('address type');
  });
});
