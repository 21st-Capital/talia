/**
 * Sample descriptors used across tests. These are structurally realistic
 * (script type, origins, multipath, timelocks) but the extended keys are
 * test material — the descriptor layer classifies strings, it does not verify
 * key material (BDK does that at wallet creation). The #checksums ARE real
 * BIP-380 checksums: an import refuses a checksum that does not match
 * (decided 2026-09-26).
 *
 * Which keys are which: TPUB_A is a valid key of the Speculos emulator's
 * published default seed (at m/44'/1'/0'), used here under other origins;
 * TPRV_A is BIP-32 test vector 1's master tprv; NUMS_TPUB is BIP-341's NUMS
 * point; TPUB_B, TPUB_C and XPUB_A are placeholders whose base58 checksums
 * do not verify, so they cannot be anyone's key.
 */

// Placeholder testnet-family extended public keys (tpub-family → testnet).
export const TPUB_A =
  'tpubDCwYjpDhUdPGP5rS3wgNg13mTrrjBuG8V9VpWbyptX6TRPbNoZVXsoVUSkCjmQ8jJycjuDKBb9eataSymXakTTaGifxR6kmVsfFehH1ZgJT';
export const TPUB_B =
  'tpubDDXFHr67RFGBBLcywTQeuLpsq3rp8fMBvdG3TDMZ2iRToDL8pFsbFdBLwvxa8c8k2mXV1WYkgtHVZ2hzz2y9DZfxr9NdLEgyM9Yft8pBqW';
export const TPUB_C =
  'tpubDCZ8UgAsxppRYudpr9qMHV3nR9C6X3kD4c2xw7mR2YS5MLc3aaRz1KTd4uZWpiFmnR1FE1Phbr9WbXHpTVXwr1qXWsY9DkZ4Qb3XdRq6dU7';

/**
 * A provably unspendable internal key: BIP-341's NUMS point H in a tpub
 * (Liana's published key; see unspendable.test.ts). An origin-less key that
 * is NOT this shape is a real signer (decided 2026-09-26).
 */
export const NUMS_TPUB =
  'tpubD6NzVbkrYhZ4X6BRkDMxFyZxfUCQdjpK27dNgqwDqsQ2PUbMmjjPPFxfcTJiGEjeNz2zLbZ1PRmgCAzXn4pE6tEuQPScXyUbuAgdcec6pMN';

// Mainnet xpub (xpub-family → bitcoin).
export const XPUB_A =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDU9SjX5rBHf7Qc1oQjw6QXjMU82VNsGrkH2QcyzXTGGB';

// tprv → private material (must be rejected for watch-only import).
export const TPRV_A =
  'tprv8ZgxMBicQKsPeDgjzdC36fs6bMjGApWDNLR9erAXMs5skhMv36j9MV5ecvfavji5khqjWaWSFhN3YcCUUdiKH6isR4Pwy3U5y5egddBr16m';

/** Sparrow single-sig, native segwit, multipath (external+change in one). */
export const SPARROW_SINGLE_SIG = `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)#v783ze88`;

/** Nested-segwit single-sig (older Sparrow/hardware default). */
export const NESTED_SINGLE_SIG = `sh(wpkh([12345678/49'/1'/0']${TPUB_A}/<0;1>/*))#v3mjt84m`;

/** Taproot single-sig. */
export const TAPROOT_SINGLE_SIG = `tr([9a8b7c6d/86'/1'/0']${TPUB_A}/<0;1>/*)#e3x0rwpv`;

/** 2-of-3 sorted multisig (Sparrow/Liana multisig export shape). */
export const MULTISIG_2_OF_3 =
  `wsh(sortedmulti(2,` +
  `[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,` +
  `[a1b2c3d4/48'/1'/0'/2']${TPUB_B}/<0;1>/*,` +
  `[deadbeef/48'/1'/0'/2']${TPUB_C}/<0;1>/*))#92k5en43`;

/**
 * Liana-style single-key primary + timelocked recovery key.
 * Primary spends immediately; recovery path unlocks after 65535 blocks.
 */
export const LIANA_MINISCRIPT =
  `wsh(or_d(` +
  `pk([73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*),` +
  `and_v(v:pkh([a1b2c3d4/48'/1'/0'/2']${TPUB_B}/<0;1>/*),older(65535))))#90jvh52c`;

/** Liana taproot with a timelocked recovery leaf. */
export const LIANA_TAPROOT =
  `tr([73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,` +
  `and_v(v:pk([a1b2c3d4/48'/1'/0'/2']${TPUB_B}/<0;1>/*),older(4032)))#dgue4cg7`;

/** Watch-only-unsafe: contains a private key. */
export const WITH_PRIVATE_KEY = `wpkh(${TPRV_A}/84'/1'/0'/0/*)`;

/** Mainnet single-sig. */
export const MAINNET_SINGLE_SIG = `wpkh([73c5da0a/84'/0'/0']${XPUB_A}/<0;1>/*)#4heg5xpw`;
