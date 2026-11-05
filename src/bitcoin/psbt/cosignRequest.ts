/**
 * Co-sign request builder — turn a full spend PSBT into the MINIMAL request that
 * 21st Capital's air-gapped blind co-signer needs, and NOTHING that would reveal
 * the client's policy or wallet.
 *
 * The signer needs, per input: the amount (WITNESS_UTXO), the internal key, the
 * single tapscript leaf OUR key is in, and a derivation entry for EVERY key in
 * that leaf — the control block carries the rest of the tree only as hashes.
 *
 * ⚠️ Why every key in the leaf and not just ours (decided 2026-09-05, proven on a
 * Krux): a miniscript signer rebuilds the spending policy from the leaf script,
 * and a `multi_a(2, client, 21C)` leaf whose second key has no origin is not a
 * policy it can read. Krux refuses the whole PSBT with "Not a miniscript PSBT".
 * We therefore keep the entry, and keep the client's FINGERPRINT with it
 * (decided 2026-09-05): 21C already knows whose request this is (it arrives on an
 * authenticated session behind an email OTP and an authenticator code), so
 * hiding the fingerprint protected nothing, while carrying it lets the backend
 * check the key against the fingerprints the client declared in their Estate
 * Plan. The PATH is still zeroed: it is worth nothing for that check and would
 * leak the wallet's address index.
 *
 * So we KEEP exactly that and DROP:
 *   - the rescue / inheritance leaf scripts (they stay hashes in the control block),
 *   - the derivations of keys in those OTHER leaves (the rescue key never appears),
 *   - the derivation PATH of every key that is not ours,
 *   - PSBT_GLOBAL_XPUB (so 21C can never scan the wallet),
 *   - the change-output maps (so 21C can't tell which output is change),
 *   - TAP_MERKLE_ROOT (not needed for a script-path spend by our signer).
 *
 * Signatures already present (TAP_KEY_SIG 0x13 / TAP_SCRIPT_SIG 0x14) are kept, so
 * the request works whether the client signs before or after 21C.
 *
 * Pure BIP-174 surgery on the byte stream — no signing, no BDK. Verified against
 * the real air-gapped signer end-to-end (2026-07-22).
 */
import { Reader, readMap, parseTx } from './parse';
import { PSBT_MAGIC, decodeBase64, encodeBase64 } from './export';

type Entry = { keyType: number; keyData: Uint8Array; value: Uint8Array };

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const has = (hay: Uint8Array, needle: Uint8Array): boolean => toHex(hay).includes(toHex(needle));

function writeVarint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  if (n <= 0xffffffff) return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  throw new Error('varint too large');
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function serializeMap(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const key = concat(Uint8Array.of(e.keyType), e.keyData);
    parts.push(writeVarint(key.length), key, writeVarint(e.value.length), e.value);
  }
  parts.push(Uint8Array.of(0x00));
  return concat(...parts);
}

/** Master fingerprint (hex) from a TAP_BIP32_DERIVATION value: <varint n><32×n hashes><fp><path…>. */
function tapFingerprint(value: Uint8Array): string | null {
  try {
    const r = new Reader(value);
    const n = r.varint();
    r.bytes(32 * n);
    return toHex(r.bytes(4));
  } catch {
    return null;
  }
}

/**
 * Zero the PATH of a TAP_BIP32_DERIVATION, keeping the leaf hashes and the
 * master fingerprint.
 *
 * Layout: <varint n><32×n leaf hashes><4-byte fp><4-byte LE index>*
 *
 * KEPT: the fingerprint, so the backend can check this key against the ones the
 * client declared in their Estate Plan (`EstatePlan.key_fingerprints`).
 * ZEROED: the path. Precisely what that hides: the client's ACCOUNT number
 * (their `48'/coin'/N'/2'`). It does NOT hide the change/address index — our
 * own derivation on the same input is kept in full and ends in the same
 * `/0/i`, so 21C can read the index from that regardless. Zeroing costs
 * nothing and keeps the account private; do not describe it as more than that.
 *
 * A miniscript signer needs the entry to exist to read the policy; it cannot
 * verify a foreign origin, so a zeroed path costs nothing. Proven on a Krux
 * 2026-09-05, which signed with the path blanked.
 */
function blankPath(value: Uint8Array): Uint8Array {
  try {
    const r = new Reader(value);
    const n = r.varint();
    r.bytes(32 * n);
    const prefix = r.pos; // varint + leaf hashes
    if (value.length < prefix + 4) return value; // no fingerprint to keep
    const fp = value.slice(prefix, prefix + 4);
    const out = new Uint8Array(prefix + 4 + 8); // fp + two zeroed indices
    out.set(value.slice(0, prefix), 0);
    out.set(fp, prefix);
    return out;
  } catch {
    // A derivation this parser cannot follow is handed on untouched: the
    // signer's own parser gets to decide, rather than us corrupting it.
    return value;
  }
}

export interface CosignRequest {
  /** Base64 PSBT to hand (as a QR) to the air-gapped signer. */
  psbtBase64: string;
  /** Request size as a fraction of the source PSBT (for logging/UX). */
  ratio: number;
  /**
   * Indexes of the outputs whose map carries a BIP-32 or taproot derivation.
   * A HINT only, never proof: whoever wrote the PSBT writes those entries
   * (decided 2026-09-26). What goes to the server as `own_outputs`
   * is `wallet/ownOutputs.ownOutputIndices`, decided by BDK against the
   * vault's descriptor.
   */
  derivationHintOutputs: number[];
}

/**
 * Strip `fullPsbtBase64` down to the minimal co-sign request for the 21C key with
 * master fingerprint `cosignFingerprint` (8 hex chars). Throws if that key isn't
 * present (nothing for us to sign).
 */
export function buildCosignRequest(fullPsbtBase64: string, cosignFingerprint: string): CosignRequest {
  const bytes = decodeBase64(fullPsbtBase64);
  if (!bytes || bytes.length < PSBT_MAGIC.length || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error('Not a PSBT');
  }
  const fp = cosignFingerprint.toLowerCase();

  const r = new Reader(bytes, PSBT_MAGIC.length);
  const global = readMap(r);
  const txEntry = global.find((e) => e.keyType === 0x00);
  if (!txEntry) throw new Error('PSBT has no unsigned transaction');
  const { ins, outs } = parseTx(new Reader(txEntry.value));
  const inputs: Entry[][] = [];
  for (let i = 0; i < ins.length; i++) inputs.push(readMap(r));
  const outputs: Entry[][] = [];
  for (let i = 0; i < outs.length; i++) outputs.push(readMap(r));

  // Global: keep only the unsigned tx; drop GLOBAL_XPUB and everything else.
  const strippedGlobal = global.filter((e) => e.keyType === 0x00);

  let found = false;
  const strippedInputs = inputs.map((entries) => {
    const ourDeriv = entries.filter((e) => e.keyType === 0x16 && tapFingerprint(e.value) === fp);
    const ourPubkeys = ourDeriv.map((e) => e.keyData);
    if (ourDeriv.length > 0) found = true;

    // TAP_LEAF_SCRIPT: only the leaf(s) our key is in. Everything else in the
    // tree survives as a hash inside the control block.
    const keptLeaves = entries.filter(
      (e) =>
        e.keyType === 0x15 &&
        ourPubkeys.some((pk) => has(e.value.slice(0, e.value.length - 1), pk)),
    );
    // 32 bytes exactly: has() is a hex-substring test, so an empty or short
    // keyData would match EVERY leaf and smuggle a dropped leaf's key through.
    const inKeptLeaf = (pubkey: Uint8Array): boolean =>
      pubkey.length === 32 &&
      keptLeaves.some((l) => has(l.value.slice(0, l.value.length - 1), pubkey));

    return entries
      .filter(
        (e) =>
          e.keyType === 0x01 || // WITNESS_UTXO
          e.keyType === 0x17 || // TAP_INTERNAL_KEY
          e.keyType === 0x13 || // TAP_KEY_SIG
          e.keyType === 0x14 || // TAP_SCRIPT_SIG
          // Derivations for the keys of the leaf we send — ours in full, the
          // co-signers' blanked below. A key that is only in ANOTHER leaf
          // (rescue, inheritance) is dropped entirely.
          (e.keyType === 0x16 && (ourDeriv.includes(e) || inKeptLeaf(e.keyData))) ||
          keptLeaves.includes(e),
      )
      .map((e) =>
        e.keyType === 0x16 && !ourDeriv.includes(e)
          ? { ...e, value: blankPath(e.value) }
          : e,
      );
  });
  if (!found) throw new Error(`No co-sign key ${fp} found in this PSBT`);

  // Outputs: empty every map (drops change derivations; the scripts+amounts stay
  // in the unsigned tx, so the signer still sees where the money goes).
  const strippedOutputs = outputs.map(() => [] as Entry[]);

  const out = concat(
    Uint8Array.from(PSBT_MAGIC),
    serializeMap(strippedGlobal),
    ...strippedInputs.map(serializeMap),
    ...strippedOutputs.map(serializeMap),
  );
  const derivationHintOutputs = outputs.flatMap((m, i) =>
    m.some((e) => e.keyType === 0x02 || e.keyType === 0x07) ? [i] : [],
  );
  return { psbtBase64: encodeBase64(out), ratio: out.length / bytes.length, derivationHintOutputs };
}
