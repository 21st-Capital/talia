/**
 * UR codec (Uniform Resources, BCR-2020-005) for air-gapped signers that
 * speak it. The Foundation Passport has no cable and no radio: it reads an
 * animated QR of the unsigned PSBT (`ur:crypto-psbt`, BCR-2020-006), signs,
 * and shows the signed PSBT as an animated `ur:crypto-psbt` the phone scans
 * back. Its wallet export is `ur:crypto-account` (BCR-2020-015) wrapping
 * `crypto-output` (BCR-2020-010) around a `crypto-hdkey` (BCR-2020-007).
 * Sparrow shows a wallet's descriptor (Settings, the QR beside "Output
 * Descriptor") as a bare `ur:crypto-output`: script expressions around one
 * hdkey or a multi/sortedmulti key set, every key carrying its origin
 * (master fingerprint + path) and no children keypath. That one decodes to
 * descriptor TEXT for the import screen.
 *
 * Multi-part URs are FOUNTAIN coded: after the plain fragments (seq 1..N)
 * the encoder keeps emitting XOR mixes of them, so a receiver that missed
 * fragment 3 can recover it from a later mix that includes it. A receiver
 * therefore needs about N parts plus a few extra fountain parts. The phone
 * loops the list `encodePsbtUrParts` returns (2 x N parts) so the Passport
 * reconstructs within roughly one lap wherever it joins the loop.
 *
 * Pure TS over @ngraveio/bc-ur (fountain codec + bytewords) and
 * @keystonehq/bc-ur-registry (CBOR registry types). Encoding-only work, no
 * derivation and no signing: the xpub string is the CBOR fields (key data,
 * chain code, parent fingerprint, depth, child index) re-encoded with the
 * STANDARD version bytes through the same audited base58check as
 * descriptor/bareKey.ts. Private key material is refused (watch-only rule).
 *
 * Two library traps this module exists to absorb:
 *  - Both libraries CBOR-encode through the GLOBAL `Buffer` (node's in Jest,
 *    the `buffer` polyfill in the app). Handing them the registry's own
 *    re-exported Buffer or a plain Uint8Array does not throw; it silently
 *    encodes an object or an array instead of a byte string. Every byte
 *    value crossing into the libraries is wrapped with the global Buffer.
 *  - bc-ur-registry 0.8 knows no taproot script tag (409). Unpatched, its
 *    CBOR layer DROPS unknown tags, so a Passport BIP-86 account would decode
 *    as a script-less key and an unknown wrapper around a descriptor would
 *    decode as the descriptor inside it; patched, `CryptoAccount.fromCBOR`
 *    throws on the tag. We register every tag of the registry's range (300
 *    to 499) at load, so unknown ones are refused, and walk the CBOR trees
 *    of accounts and outputs ourselves.
 */
import { UR, URDecoder, UREncoder } from '@ngraveio/bc-ur';
import {
  Bytes,
  CryptoCoinInfo,
  CryptoCoinInfoNetwork,
  CryptoHDKey,
  CryptoKeypath,
  CryptoPSBT,
  DataItem,
  decodeToDataItem,
  extend,
  PathComponent,
} from '@keystonehq/bc-ur-registry';
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check, hex } from '@scure/base';
import { urSequenceWithinLimit } from '../qrLimits';

const base58check = createBase58check(sha256);

/** CBOR tags of the registry types and script expressions we understand. */
const TAG_HDKEY = 303;
const TAG_KEYPATH = 304;
const TAG_ECKEY = 306;
const TAG_TAPROOT = 409;
const TAG_COSIGNER = 410;
const SCRIPT_TAGS = new Set([
  400,
  401,
  402,
  403,
  404,
  405,
  406,
  407,
  408,
  TAG_TAPROOT,
  TAG_COSIGNER,
]);

// Idempotent (the library keeps a "already patched" list). Without this a
// taproot account loses its script tag on decode, and any tag the library
// does not know vanishes silently. Registry types are 300 to 399, script
// expressions 400 to 499. See module doc.
extend.cbor.patchTags(Array.from({ length: 200 }, (_, i) => 300 + i));

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];
const XPUB_VERSION = [0x04, 0x88, 0xb2, 0x1e];
const TPUB_VERSION = [0x04, 0x35, 0x87, 0xcf];
const HARDENED = 0x80000000;

export type UrScriptType =
  | 'wpkh'
  | 'sh-wpkh'
  | 'pkh'
  | 'tr'
  | 'wsh'
  | 'unknown';
export type UrNetwork = 'bitcoin' | 'testnet';

/** One public key out of a crypto-account / crypto-hdkey, ready for a descriptor. */
export interface UrAccountKey {
  /** base58 xpub/tpub in STANDARD version bytes (never SLIP-132). */
  xpub: string;
  /** Master fingerprint, 8 lowercase hex; null when the export carries none. */
  fingerprint: string | null;
  /** Origin path such as "84'/0'/0'"; null when the export carries none. */
  originPath: string | null;
  /**
   * From the crypto-output's outer tags (404 wpkh, 400+404 sh-wpkh, 403 pkh,
   * 409 tr, 401 wsh). A bare crypto-hdkey has no tags, so its type is read
   * from the BIP purpose of the origin path (44'/49'/84'/86'), else unknown.
   */
  scriptType: UrScriptType;
  /** From crypto-coin-info when present, else from the path's coin type (1' = testnet). */
  network: UrNetwork;
}

export type UrPayload =
  | { kind: 'psbt'; psbt: Uint8Array }
  | { kind: 'account'; keys: UrAccountKey[] }
  | { kind: 'hdkey'; key: UrAccountKey }
  /** A crypto-output rendered as descriptor text, e.g. `wsh(sortedmulti(2,[fp/path]xpub/<0;1>/*,...))`. */
  | { kind: 'output'; descriptor: string }
  | { kind: 'bytes'; bytes: Uint8Array; text: string | null }
  | { kind: 'unknown'; type: string };

export interface UrJoinProgress {
  /** Distinct fragments recovered so far. */
  have: number;
  /** Fragments in the transfer (0 until the first part arrives). */
  total: number;
  done: boolean;
}

/** True if a scanned string is a UR part (`ur:` prefix, any case). */
export function isUrPart(text: string): boolean {
  return /^ur:/i.test(text.trim());
}

/**
 * Encode a PSBT as `ur:crypto-psbt` parts for an animated QR, UPPERCASED so
 * the QR encoder can use alphanumeric mode (a third smaller than byte mode).
 *
 * A payload that fits one fragment yields exactly one part. Otherwise the
 * list holds the N plain fragments followed by N fountain mixes; a receiver
 * needs roughly N parts plus a few extra, so looping this list lets it
 * finish within about one lap however it joins mid-loop.
 *
 * `maxFragmentLength` is bytes of PSBT per part: 200 bytes is about 400
 * bytewords characters, a QR the Passport's camera reads at phone brightness.
 */
export function encodePsbtUrParts(
  psbt: Uint8Array,
  maxFragmentLength = 200,
): string[] {
  if (!startsWith(psbt, PSBT_MAGIC)) throw new Error('Not a PSBT');
  if (maxFragmentLength < 10) throw new Error('UR fragment length too small');
  const ur = new CryptoPSBT(Buffer.from(psbt)).toUR();
  const encoder = new UREncoder(ur, maxFragmentLength);
  const seqLen = encoder.fragmentsLength;
  const count = seqLen === 1 ? 1 : seqLen * 2;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(encoder.nextPart().toUpperCase());
  return parts;
}

/**
 * Accumulates scanned UR parts (any case, any order, duplicates and fountain
 * mixes welcome) and decodes the payload once the transfer is complete.
 */
export class UrJoiner {
  private decoder = new URDecoder();
  private type: string | null = null;

  /**
   * Feed one scanned string. Throws on text that is not a UR, on a part of a
   * different UR type than the transfer in progress, and on a transfer whose
   * checksum fails; a part from another transfer of the same type is dropped.
   */
  addPart(text: string): UrJoinProgress {
    const part = text.trim();
    if (!isUrPart(part)) throw new Error('Not a UR code');
    let type: string;
    try {
      [type] = URDecoder.parse(part);
    } catch {
      throw new Error('Unreadable UR code');
    }
    // The part count comes from the code itself, and the decoder allocates
    // by it on the first part (decided 2026-09-26). Checked on the
    // same split the decoder uses; any count that is not plain digits is
    // refused here, before the decoder's Number() can read "3e7".
    if (!urSequenceWithinLimit(part)) throw new Error('This code is larger than Talia accepts');
    if (this.type == null) this.type = type;
    else if (type !== this.type)
      throw new Error('This code belongs to a different transfer');

    if (!this.decoder.isSuccess()) {
      try {
        this.decoder.receivePart(part);
      } catch {
        throw new Error('Unreadable UR code');
      }
      if (this.decoder.isError()) {
        throw new Error(
          'The scanned parts do not add up. Start the scan again.',
        );
      }
    }
    return this.progress();
  }

  progress(): UrJoinProgress {
    const total = this.decoder.expectedPartCount();
    if (this.decoder.isSuccess()) {
      // A single-part UR never touches the fountain decoder (count stays 0).
      const n = Math.max(1, total);
      return { have: n, total: n, done: true };
    }
    return {
      have: this.decoder.receivedPartIndexes().length,
      total,
      done: false,
    };
  }

  /** UR type of the transfer in progress (e.g. "crypto-psbt"), once a part arrived. */
  get urType(): string | null {
    return this.type;
  }

  /** Decode. Only valid once `progress().done`. */
  result(): UrPayload {
    if (!this.decoder.isSuccess()) throw new Error('UR transfer incomplete');
    return decodeUr(this.decoder.resultUR());
  }
}

/**
 * Descriptor for a single-sig vault from one exported key, receive and
 * change on the BIP-389 multipath spine the rest of the app expects.
 */
export function descriptorFromUrAccountKey(key: UrAccountKey): string {
  const origin = key.fingerprint
    ? `[${key.fingerprint}${key.originPath ? '/' + key.originPath : ''}]`
    : '';
  const inner = `${origin}${key.xpub}/<0;1>/*`;
  switch (key.scriptType) {
    case 'wpkh':
      return `wpkh(${inner})`;
    case 'sh-wpkh':
      return `sh(wpkh(${inner}))`;
    case 'pkh':
      return `pkh(${inner})`;
    case 'tr':
      return `tr(${inner})`;
    case 'wsh':
      throw new Error(
        'This key was exported for a multisig wallet, not for a single-key vault.',
      );
    default:
      throw new Error(
        'The code does not say which address type this key uses. Export a single-sig account from the device.',
      );
  }
}

// --- decoding ---------------------------------------------------------------

function decodeUr(ur: UR): UrPayload {
  switch (ur.type) {
    case 'crypto-psbt':
      return {
        kind: 'psbt',
        psbt: copyBytes(CryptoPSBT.fromCBOR(ur.cbor).getPSBT()),
      };
    case 'crypto-account':
      return { kind: 'account', keys: accountKeys(decodeToDataItem(ur.cbor)) };
    case 'crypto-output':
      return {
        kind: 'output',
        descriptor: outputDescriptor(decodeToDataItem(ur.cbor)),
      };
    case 'crypto-hdkey':
      return {
        kind: 'hdkey',
        key: accountKey(CryptoHDKey.fromCBOR(ur.cbor), null, null),
      };
    case 'bytes': {
      const bytes = copyBytes(Bytes.fromCBOR(ur.cbor).getData());
      return { kind: 'bytes', bytes, text: utf8OrNull(bytes) };
    }
    default:
      return { kind: 'unknown', type: ur.type };
  }
}

/** crypto-account map: {1: master fingerprint (uint32), 2: [crypto-output...]}. */
function accountKeys(item: DataItem): UrAccountKey[] {
  const map: unknown = item.getData();
  if (!map || typeof map !== 'object')
    throw new Error('Malformed crypto-account');
  const fp = (map as Record<number, unknown>)[1];
  const masterFp =
    typeof fp === 'number' && fp !== 0
      ? fp.toString(16).padStart(8, '0')
      : null;
  const outputs = (map as Record<number, unknown>)[2];
  if (!Array.isArray(outputs)) throw new Error('Malformed crypto-account');
  const keys: UrAccountKey[] = [];
  for (const output of outputs) {
    if (!(output instanceof DataItem)) continue;
    const found = walkOutput(output);
    if (found) keys.push(accountKey(found.hd, found.tags, masterFp));
  }
  return keys;
}

/**
 * Peel a crypto-output's script tags down to its crypto-hdkey. Outputs built
 * on a multi/sortedmulti key set or an EC key are not single-sig material
 * and yield null.
 */
function walkOutput(
  item: DataItem,
): { tags: number[]; hd: CryptoHDKey } | null {
  const tags: number[] = [];
  let cur: unknown = item;
  for (let depth = 0; depth < 8 && cur instanceof DataItem; depth++) {
    const tag: number | undefined = cur.getTag();
    if (tag === TAG_HDKEY) return { tags, hd: CryptoHDKey.fromDataItem(cur) };
    if (tag === undefined || !SCRIPT_TAGS.has(tag)) return null;
    tags.push(tag);
    cur = cur.getData();
  }
  return null;
}

function accountKey(
  hd: CryptoHDKey,
  tags: number[] | null,
  masterFp: string | null,
): UrAccountKey {
  if (hd.isMaster() || hd.isPrivateKey()) {
    throw new Error(
      'This code carries a private key. Talia only accepts public keys.',
    );
  }
  const key = copyBytes(hd.getKey());
  const chainCode = opt(hd.getChainCode());
  if (key.length !== 33 || (key[0] !== 0x02 && key[0] !== 0x03)) {
    throw new Error('This code does not hold a compressed public key');
  }
  if (!chainCode || chainCode.length !== 32) {
    throw new Error(
      'This key has no chain code, so no extended public key can be built from it',
    );
  }

  const origin = opt<CryptoKeypath>(hd.getOrigin());
  const components: PathComponent[] = origin ? origin.getComponents() : [];
  const originPath = origin ? opt(origin.getPath()) ?? null : null;
  const sourceFp = origin ? opt(origin.getSourceFingerprint()) : undefined;
  const fingerprint = sourceFp ? hex.encode(copyBytes(sourceFp)) : masterFp;
  const depth =
    (origin ? opt(origin.getDepth()) : undefined) ?? components.length;
  if (depth > 255) throw new Error('Derivation path too deep');
  const last = components[components.length - 1];
  const childIndex =
    last && !last.isWildcard()
      ? last.isHardened()
        ? last.getIndex() + HARDENED
        : last.getIndex()
      : 0;
  // BCR-2020-007: the source fingerprint belongs to the ancestor at the
  // start of `components`. One step below that ancestor, it is the parent.
  const parentFp =
    opt(hd.getParentFingerprint()) ??
    (components.length === 1 ? sourceFp : undefined);
  const network = networkOf(opt<CryptoCoinInfo>(hd.getUseInfo()), components);

  const raw = new Uint8Array(78);
  raw.set(network === 'testnet' ? TPUB_VERSION : XPUB_VERSION, 0);
  raw[4] = depth;
  if (parentFp && parentFp.length === 4) raw.set(copyBytes(parentFp), 5);
  raw[9] = (childIndex >>> 24) & 0xff;
  raw[10] = (childIndex >>> 16) & 0xff;
  raw[11] = (childIndex >>> 8) & 0xff;
  raw[12] = childIndex & 0xff;
  raw.set(copyBytes(chainCode), 13);
  raw.set(key, 45);

  return {
    xpub: base58check.encode(raw),
    fingerprint,
    originPath,
    scriptType: tags
      ? scriptTypeFromTags(tags)
      : scriptTypeFromPurpose(components),
    network,
  };
}

function scriptTypeFromTags(tags: number[]): UrScriptType {
  // `cosigner` (410) marks the key's role inside a multisig, not a script wrapper.
  const wrappers = tags.filter(t => t !== TAG_COSIGNER).join(',');
  switch (wrappers) {
    case '404':
      return 'wpkh';
    case '400,404':
      return 'sh-wpkh';
    case '403':
      return 'pkh';
    case '409':
      return 'tr';
    case '401':
      return 'wsh';
    default:
      return 'unknown';
  }
}

function scriptTypeFromPurpose(components: PathComponent[]): UrScriptType {
  const purpose = components[0];
  if (!purpose || !purpose.isHardened() || purpose.isWildcard())
    return 'unknown';
  switch (purpose.getIndex()) {
    case 44:
      return 'pkh';
    case 49:
      return 'sh-wpkh';
    case 84:
      return 'wpkh';
    case 86:
      return 'tr';
    default:
      return 'unknown';
  }
}

function networkOf(
  useInfo: CryptoCoinInfo | undefined,
  components: PathComponent[],
): UrNetwork {
  if (useInfo && useInfo.getNetwork() === CryptoCoinInfoNetwork.testnet)
    return 'testnet';
  const coinType = components[1];
  if (
    coinType &&
    coinType.isHardened() &&
    !coinType.isWildcard() &&
    coinType.getIndex() === 1
  ) {
    return 'testnet';
  }
  return 'bitcoin';
}

// --- crypto-output as descriptor text -------------------------------------------

type OutputExpression =
  | 'sh'
  | 'wsh'
  | 'pk'
  | 'pkh'
  | 'wpkh'
  | 'tr'
  | 'multi'
  | 'sortedmulti';

/** Script expressions (BCR-2020-010) Talia renders, by CBOR tag. */
const OUTPUT_EXPRESSIONS: Record<number, OutputExpression> = {
  400: 'sh',
  401: 'wsh',
  402: 'pk',
  403: 'pkh',
  404: 'wpkh',
  406: 'multi',
  407: 'sortedmulti',
  [TAG_TAPROOT]: 'tr',
};

/** Expressions with no place in a descriptor Talia can watch, refused by name. */
const REFUSED_EXPRESSIONS: Record<number, string> = {
  307: 'addr',
  405: 'combo',
  408: 'raw',
  [TAG_COSIGNER]: 'cosigner',
};

/**
 * What each wrapper may contain (BIP-380 to BIP-386). The terminal
 * expressions take a key and wrap nothing; `tr` takes a single key only, a
 * taproot script tree has no crypto-output form.
 */
const INNER_EXPRESSIONS: Record<OutputExpression, OutputExpression[]> = {
  sh: ['wpkh', 'wsh', 'pk', 'pkh', 'multi', 'sortedmulti'],
  wsh: ['pk', 'pkh', 'multi', 'sortedmulti'],
  pk: [],
  pkh: [],
  wpkh: [],
  tr: [],
  multi: [],
  sortedmulti: [],
};

/**
 * Render a crypto-output as descriptor text. The registry's own
 * `CryptoOutput.fromDataItem` is not used: it stops at the taproot tag
 * (409) it does not know, hands the rest to the EC-key parser, and its
 * keypath parser reads a receive/change pair as a wildcard. The CBOR tree
 * is walked here instead, the way `walkOutput` does for accounts. Anything
 * not understood throws rather than becoming a descriptor that is wrong.
 */
function outputDescriptor(item: DataItem): string {
  const exprs: OutputExpression[] = [];
  let keyText: string | null = null;
  let cur: unknown = item;
  for (let depth = 0; depth < 8; depth++) {
    if (!(cur instanceof DataItem)) throw malformedOutput();
    const tag: number | undefined = cur.getTag();
    if (tag === TAG_HDKEY) {
      keyText = hdKeyText(cur);
      break;
    }
    if (tag === TAG_ECKEY) {
      keyText = ecKeyText(cur);
      break;
    }
    const expr = tag === undefined ? undefined : OUTPUT_EXPRESSIONS[tag];
    if (!expr) throw unsupportedExpression(tag);
    exprs.push(expr);
    if (expr === 'multi' || expr === 'sortedmulti') {
      keyText = multiKeyText(cur.getData());
      break;
    }
    cur = cur.getData();
  }
  if (keyText === null) throw malformedOutput();
  if (exprs.length === 0)
    throw new Error('This code holds a key on its own, not a descriptor');
  checkNesting(exprs);
  return exprs.reduceRight((inner, expr) => `${expr}(${inner})`, keyText);
}

function checkNesting(exprs: OutputExpression[]): void {
  for (let i = 0; i < exprs.length; i++) {
    const expr = exprs[i];
    const next = exprs[i + 1];
    if (next === undefined) {
      if (expr === 'sh' || expr === 'wsh')
        throw new Error(
          'This code wraps a bare key where a script is needed, so it is not a descriptor Talia can read',
        );
      continue;
    }
    if (expr === 'tr')
      throw new Error(
        'Taproot descriptors with a script tree are not supported. Talia reads tr() around a single key only.',
      );
    if (!INNER_EXPRESSIONS[expr].includes(next))
      throw new Error(
        `This code nests ${next}() inside ${expr}(), which is not a descriptor Talia can read`,
      );
  }
}

/**
 * `[fingerprint/origin]xpub/children`. The xpub, origin and network come
 * through `accountKey`, the same serialisation crypto-account exports use;
 * the children keypath is read raw so a receive/change pair survives.
 */
function hdKeyText(item: DataItem): string {
  const fields: unknown = item.getData();
  if (!fields || typeof fields !== 'object') throw malformedOutput();
  const map = fields as Record<number, unknown>;
  const origin = keypathOf(map[6]);
  if (origin && origin.some(c => c.kind !== 'index'))
    throw new Error(
      'The key origin in this code is not a plain derivation path',
    );
  const children = keypathOf(map[7]);
  const key = accountKey(CryptoHDKey.fromDataItem(item), null, null);
  const originText = key.fingerprint
    ? `[${key.fingerprint}${key.originPath ? '/' + key.originPath : ''}]`
    : '';
  return `${originText}${key.xpub}${childrenText(children)}`;
}

/**
 * Sparrow sends the account key alone (no children keypath); receive and
 * change are then the app's BIP-389 multipath spine, as
 * `descriptorFromUrAccountKey` renders it. A children keypath is rendered as
 * sent: `1/*`, `<0;1>/*`. Hardened children are refused, a public key
 * cannot derive them.
 */
function childrenText(children: KeypathComponent[] | undefined): string {
  if (!children || children.length === 0) return '/<0;1>/*';
  const steps = children.map(c => {
    switch (c.kind) {
      case 'index':
        return unhardenedStep(c);
      case 'wildcard':
        if (c.hardened) throw hardenedChild();
        return '*';
      case 'pair':
        return `<${unhardenedStep(c.external)};${unhardenedStep(c.internal)}>`;
      case 'range':
        throw new Error(
          'This code asks for a range of child keys, which a descriptor cannot express',
        );
    }
  });
  return '/' + steps.join('/');
}

function unhardenedStep(step: KeypathStep): string {
  if (step.hardened) throw hardenedChild();
  return String(step.index);
}

function hardenedChild(): Error {
  return new Error(
    'This code asks for hardened child keys, which a public key cannot derive',
  );
}

/** Compressed secp256k1 public key as hex (`pkh(02c6...)`). Private material is refused. */
function ecKeyText(item: DataItem): string {
  const fields: unknown = item.getData();
  if (!fields || typeof fields !== 'object') throw malformedOutput();
  const map = fields as Record<number, unknown>;
  if (map[2] === true)
    throw new Error(
      'This code carries a private key. Talia only accepts public keys.',
    );
  if (map[1] !== undefined && map[1] !== 0)
    throw new Error('This code holds a key on a curve Bitcoin does not use');
  const data: unknown = map[3];
  if (!(data instanceof Uint8Array)) throw malformedOutput();
  const key = copyBytes(data);
  if (key.length !== 33 || (key[0] !== 0x02 && key[0] !== 0x03))
    throw new Error('This code does not hold a compressed public key');
  return hex.encode(key);
}

/** multi / sortedmulti body: `threshold,key,key,...` in the order sent. */
function multiKeyText(data: unknown): string {
  if (!data || typeof data !== 'object' || data instanceof DataItem)
    throw malformedOutput();
  const map = data as Record<number, unknown>;
  const threshold: unknown = map[1];
  const keys: unknown = map[2];
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > keys.length
  ) {
    throw new Error('The multisig in this code is malformed');
  }
  const texts = keys.map((k: unknown) => {
    if (!(k instanceof DataItem)) throw malformedOutput();
    const tag: number | undefined = k.getTag();
    if (tag === TAG_HDKEY) return hdKeyText(k);
    if (tag === TAG_ECKEY) return ecKeyText(k);
    throw unsupportedExpression(tag);
  });
  return `${threshold},${texts.join(',')}`;
}

interface KeypathStep {
  index: number;
  hardened: boolean;
}
type KeypathComponent =
  | ({ kind: 'index' } & KeypathStep)
  | { kind: 'wildcard'; hardened: boolean }
  | { kind: 'range'; low: number; high: number; hardened: boolean }
  | { kind: 'pair'; external: KeypathStep; internal: KeypathStep };

/**
 * crypto-keypath components (BCR-2020-007), read raw: the registry's
 * CryptoKeypath takes every non-number component for a wildcard, so a
 * receive/change pair `[0,false,1,false]` (BIP-389 `<0;1>`) would come out
 * as `*`. A pair is one array with no hardened flag after it; every other
 * component is followed by its flag.
 */
function keypathOf(value: unknown): KeypathComponent[] | undefined {
  if (value == null) return undefined;
  if (!(value instanceof DataItem) || value.getTag() !== TAG_KEYPATH)
    throw malformedOutput();
  const map: unknown = value.getData();
  if (!map || typeof map !== 'object') throw malformedOutput();
  const raw: unknown = (map as Record<number, unknown>)[1];
  if (!Array.isArray(raw)) throw malformedOutput();
  const components: KeypathComponent[] = [];
  for (let i = 0; i < raw.length; ) {
    const c: unknown = raw[i];
    if (Array.isArray(c) && c.length === 4) {
      components.push({
        kind: 'pair',
        external: keypathStep(c[0], c[1]),
        internal: keypathStep(c[2], c[3]),
      });
      i += 1;
      continue;
    }
    const hardened: unknown = raw[i + 1];
    if (typeof hardened !== 'boolean') throw malformedOutput();
    if (typeof c === 'number') {
      components.push({ kind: 'index', ...keypathStep(c, hardened) });
    } else if (Array.isArray(c) && c.length === 0) {
      components.push({ kind: 'wildcard', hardened });
    } else if (Array.isArray(c) && c.length === 2) {
      components.push({
        kind: 'range',
        low: childIndex(c[0]),
        high: childIndex(c[1]),
        hardened,
      });
    } else {
      throw malformedOutput();
    }
    i += 2;
  }
  return components;
}

function keypathStep(index: unknown, hardened: unknown): KeypathStep {
  if (typeof hardened !== 'boolean') throw malformedOutput();
  return { index: childIndex(index), hardened };
}

function childIndex(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= HARDENED
  ) {
    throw malformedOutput();
  }
  return value;
}

function unsupportedExpression(tag: number | undefined): Error {
  const name = tag === undefined ? undefined : REFUSED_EXPRESSIONS[tag];
  return new Error(
    name
      ? `This code uses ${name}(), which Talia cannot read`
      : 'This code uses a script Talia does not know',
  );
}

function malformedOutput(): Error {
  return new Error('Unreadable descriptor code');
}

// --- small helpers ------------------------------------------------------------

/** The registry types its getters as always-present; they are not. */
function opt<T>(value: T | undefined | null): T | undefined {
  return value == null ? undefined : value;
}

/** Plain Uint8Array copy (drops the Buffer subclass, detaches from library memory). */
function copyBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

/**
 * Strict UTF-8 (RFC 3629: no overlongs, no surrogates, nothing past
 * U+10FFFF, no truncation) or null. A NUL byte also means "not text". Hermes
 * has no TextDecoder, hence hand-rolled.
 */
function utf8OrNull(bytes: Uint8Array): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0) return null;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
      continue;
    }
    let need: number;
    let cp: number;
    let min: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    } else {
      return null;
    }
    if (i + need >= bytes.length) return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
      return null;
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
