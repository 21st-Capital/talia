/**
 * Types for Keel's descriptor layer.
 *
 * Keel is descriptor-native: every wallet — single-sig, multisig, or Liana
 * miniscript/timelock — is described by a BIP-380 output descriptor. This
 * module classifies and previews descriptors in pure TypeScript for import
 * routing and UX. BDK remains the source of truth for the actual on-chain
 * wallet (derivation, coin selection, PSBT construction).
 */

/** The Bitcoin network a descriptor targets. 'testnet' is Testnet4. 'signet'
 *  is retired (decided 2026-10-18): it is only ever READ from old data and always
 *  becomes 'testnet' (bitcoin/network.ts `knownNetwork`, wallet/signetVaults.ts);
 *  no screen offers it. */
export type Network = 'bitcoin' | 'testnet' | 'signet' | 'regtest';

/**
 * The high-level "kind" of wallet a descriptor represents, used to drive
 * import UX and labelling. This is a Keel-level classification, not a BDK type.
 */
export type DescriptorKind =
  | 'single-sig'
  | 'multisig'
  | 'miniscript' // Liana-style: contains relative/absolute timelocks (recovery)
  | 'unknown';

/** Outermost script context of a descriptor. */
export type ScriptType =
  | 'wpkh' // native segwit single-sig
  | 'pkh' // legacy single-sig
  | 'sh-wpkh' // nested segwit single-sig
  | 'wsh' // native segwit script (multisig / miniscript)
  | 'sh-wsh' // nested segwit script
  | 'sh' // legacy script (bare multisig wrapped)
  | 'tr' // taproot
  | 'unknown';

/** A parsed key origin: `[fingerprint/derivation]xpub.../path`. */
export interface KeyOrigin {
  /** 8-hex-char master key fingerprint, if present (e.g. "d34db33f"). */
  fingerprint?: string;
  /** Origin derivation path, e.g. "48'/1'/0'/2'". */
  originPath?: string;
  /** The extended public key (xpub/tpub/…) or key placeholder. */
  xpub: string;
  /** Trailing derivation after the key, e.g. "<0;1>/*" or "0/*". */
  keyPath?: string;
}

/**
 * The result of classifying/parsing a descriptor string. Everything here is
 * best-effort metadata for UX and import validation — never used to sign.
 */
export interface ParsedDescriptor {
  /** The raw descriptor as supplied (checksum included, whitespace trimmed). */
  raw: string;
  /** Descriptor with any `#checksum` suffix removed. */
  body: string;
  /** Checksum after `#`, if the input included one. */
  checksum?: string;
  kind: DescriptorKind;
  scriptType: ScriptType;
  network?: Network;
  /** Parsed key origins (xpubs and their fingerprints/paths). */
  keys: KeyOrigin[];
  /** For multisig: required signatures (the `m` in `multi(m,...)`). */
  threshold?: number;
  /** For multisig: total keys (the `n`). */
  totalKeys?: number;
  /**
   * Timelocks found in miniscript fragments (Liana recovery paths).
   * `older(N)` → relative; `after(N)` → absolute.
   */
  timelocks: Timelock[];
  /**
   * True when the descriptor encodes both external and internal chains in one
   * string via a multipath `<0;1>` element (Liana/Sparrow export this way).
   */
  isMultipath: boolean;
  /** True if any private key material (xprv/tprv/WIF) is present. */
  containsPrivateKeys: boolean;
}

export interface Timelock {
  type: 'relative' | 'absolute';
  /** Raw value inside older()/after(). */
  value: number;
}

/** Where an imported descriptor came from — used for labelling and hints. */
export type ImportSource = 'liana' | 'sparrow' | 'generic';

/** Transport used to bring the descriptor in ('created' = built in-app). */
// 'nfc' stays only because vaults added before NFC was removed (2026-09-12) carry it.
export type ImportTransport = 'paste' | 'file' | 'qr' | 'nfc' | 'created';
