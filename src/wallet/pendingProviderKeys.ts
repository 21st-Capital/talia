/**
 * Stand-ins for 21st Capital's keys, so the vault builder's summary can draw
 * the SAME picture before our keys are fetched as after (reported 2026-09-21: "in a
 * standard 2/3 without any timelocked keys, the graph takes a while to appear
 * and a description is shown first").
 *
 * Our keys arrive only when the vault is created, so the summary used to show
 * a sentence for a plain multisig and swap in the policy picture once the
 * keys came back. The shape of the vault is fully known before that; only
 * the key material is missing. These placeholders fill that gap FOR DISPLAY
 * ONLY: the descriptor they compose is drawn and thrown away, never saved,
 * never registered, never used to receive or sign. The real preview, composed
 * from the fetched keys, is the only one the builder ever creates a vault from.
 *
 * Their fingerprints spell "21c" so they can never be mistaken for a device,
 * and the keys come from public seeds nobody's hardware wallet holds.
 */
import type { KeyOrigin } from '../bitcoin/descriptor/types';

export type PendingProviderRole = 'cosigner' | 'rescue';

export const PENDING_COSIGNER_FP = '21c0c051';
export const PENDING_RESCUE_FP = '21c0e5c0';

/** Both stand-in fingerprints, lower case. */
export const PENDING_PROVIDER_FPS: ReadonlySet<string> = new Set([
  PENDING_COSIGNER_FP,
  PENDING_RESCUE_FP,
]);

// Checksum-valid account keys (the composer base58check-decodes every key),
// derived at m/48'/coin'/0'/2' from the master seed
//   sha256("Talia display-only stand-in for the 21st Capital <co-signer|rescue>
//           key (<mainnet|testnet>); never used to receive or sign")
// with @scure/bip32. Public seeds on purpose: nothing may ever be sent to them.
const MAINNET: Record<PendingProviderRole, string> = {
  cosigner:
    'xpub6DckRPb9yaKzPgiJgtdVyMvEJj3ceqDp59ond4NDsHxqLh3c6UXfC362jwTFWfsLiqHLRL1AiPrPgic5YmqQMQSkGzcDAeTHL9y8fjyKiRi',
  rescue:
    'xpub6FP3mDjEoh5bCBM1gfHmHYRQPpcUeJrt7bCyw4u7UziEkLV846JUVEw1AQvpv1Xp3zeMySjcZEmsG1BWnJ2L6qFk5ah4CiZmq6DrAnoHUyz',
};

const TESTNET: Record<PendingProviderRole, string> = {
  cosigner:
    'tpubDEj8bB6XKong5XsnqXQxnZ8NfZNQPf57RsaL4bbM2iR6LEfP3oh97fCHXr5jLKiVD8TNw9ZPMYezU2mHY2CpfYHT38ytdbuxpNmptZipTHa',
  rescue:
    'tpubDFMC6xb4RUc5mzRooeGoraETXWyyY3q7dWPPNMVwptFHamnMpagLUvhPV7vZQAtHtC2QnBrKzSHmQsmK1Dj41ATe2hY5L7nwyypvesRuuF8',
};

/**
 * The stand-in for one of our keys, on the same network as `likeKey` (a
 * testnet vault gets testnet stand-ins, or the composer would refuse the mix).
 */
export function pendingProviderKey(role: PendingProviderRole, likeKey: KeyOrigin | undefined): KeyOrigin {
  const testnet = !!likeKey && !likeKey.xpub.startsWith('xpub');
  return {
    fingerprint: role === 'cosigner' ? PENDING_COSIGNER_FP : PENDING_RESCUE_FP,
    originPath: testnet ? "48'/1'/0'/2'" : "48'/0'/0'/2'",
    xpub: (testnet ? TESTNET : MAINNET)[role],
    keyPath: likeKey?.keyPath,
  };
}

/** The names the summary gives the stand-ins, keyed like `keyLabels`. */
export const PENDING_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  [PENDING_COSIGNER_FP]: '21st Capital co-signer',
  [PENDING_RESCUE_FP]: '21st Capital rescue key',
};
