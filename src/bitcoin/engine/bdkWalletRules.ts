/**
 * The new engine's rules that never touch the library (BDK upgrade, decided
 * 2026-10-15), pure so Jest runs every one of them:
 *
 *   - the fee rate as sat/kwu, ceil(rate x 250), worked out exactly (6.5);
 *   - the network names the bridge takes ('testnet' is Testnet4, 6.1);
 *   - the server the bridge connects to, with the same retry and timeout
 *     defaults the old engine used, and NO stop gap: the bridge fixes it at
 *     150 and the saved 20 is never read (6.3);
 *   - the version a build asks for: 1 unless the chosen path carries an
 *     older() (decided 2026-10-15); the bridge picks nSequence from it;
 *   - a build request as the bridge's options.
 */
import type { Network } from '../descriptor/types';
import type { BackendConfig, BuildPsbtRequest } from './types';
import { chosenPathHasRelativeTimelock } from './policyPath';
import type { KeychainPaths, KeychainPolicies, PolicyPath } from './policyPath';
import type { NativeBuildOptions, NativeNetwork, NativeServer } from './bdkWalletNative';

/**
 * ceil(rate x 250) sat/kwu, with a decimal rate's binary noise taken out
 * first (1.1 x 250 is 275.00000000000006 as a float, which is 275, not 276).
 */
export function satPerKwu(rateSatPerVb: number): number {
  const exact = rateSatPerVb * 250;
  const cleaned = Math.round(exact * 1e6) / 1e6;
  return Math.ceil(cleaned);
}

export function nativeNetworkOf(network: Network): NativeNetwork {
  switch (network) {
    case 'bitcoin':
      return 'bitcoin';
    case 'testnet':
      // The bridge opens it as Testnet4.
      return 'testnet';
    // No vault reaches an engine on Signet any more: it moved to Testnet4 at
    // start (wallet/signetVaults.ts), as it did for the old engine. The case stays
    // because the new contract recording (bdkWalletBridgeCalls.json) opens a
    // Signet wallet, mirroring the old recording, and is never edited.
    case 'signet':
      return 'signet';
    case 'regtest':
      return 'regtest';
  }
}

/** A sync's server: the old engine's defaults (retry 5, timeout 30). */
export function syncServerOf(backend: BackendConfig): NativeServer {
  return {
    url: backend.url,
    retry: backend.retry ?? 5,
    timeout: backend.timeout ?? 30,
    validateDomain: backend.validateDomain ?? true,
  };
}

/** The connection test's server: the old probe's defaults (retry 2, timeout 15). */
export function probeServerOf(backend: BackendConfig): NativeServer {
  return {
    url: backend.url,
    retry: backend.retry ?? 2,
    timeout: backend.timeout ?? 15,
    validateDomain: backend.validateDomain ?? true,
  };
}

/**
 * How an address-book lookup asks a server (decided 2026-11-05): no second
 * try on the same server and 8 seconds for each answer, the settings
 * Testnet4's servers are asked with (wallet/chainServers.ts `TESTNET4_RETRY`,
 * `TESTNET4_TIMEOUT_S`), whatever the server. The lookup is a quick question
 * beside the payment, never a reason to hold a native call for a minute.
 */
export const ADDRESS_LOOKUP_RETRY = 0;
export const ADDRESS_LOOKUP_TIMEOUT_S = 8;

/** An address-book lookup's server: always `ADDRESS_LOOKUP_RETRY` and `ADDRESS_LOOKUP_TIMEOUT_S`. */
export function lookupServerOf(backend: BackendConfig): NativeServer {
  return {
    url: backend.url,
    retry: ADDRESS_LOOKUP_RETRY,
    timeout: ADDRESS_LOOKUP_TIMEOUT_S,
    validateDomain: backend.validateDomain ?? true,
  };
}

/** The bridge's name for an AddressRequest. */
export function whichOf(which: 'new' | 'lastUnused' | number): string {
  if (which === 'new' || which === 'lastUnused') return which;
  if (!Number.isInteger(which) || which < 0 || which > 0x7fffffff) {
    throw new Error('An address index is a whole number from 0.');
  }
  return String(which);
}

const outpoint = (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`;

/** The version and whether the chosen path carries an older(). */
export function versionFor(policies: KeychainPolicies, paths: KeychainPaths): { version: 1 | 2; csvPath: boolean } {
  const csvPath = chosenPathHasRelativeTimelock(policies, paths);
  return { version: csvPath ? 2 : 1, csvPath };
}

/**
 * A build request as the bridge's options, before the path is chosen. The
 * old engine's shape exactly: frozen coins never spendable, named coins
 * alone when any are named, a drain to the first recipient, the rate then a
 * whole-sat absolute fee (rounded up, as the old bridge truncated a
 * ceiling), RBF unless asked off, the tip of the last sync as the height
 * (0 for a wallet that never synced, as 0.28 had no sync time then).
 */
export function baseBuildOptions(request: BuildPsbtRequest, tipHeight: number | undefined): NativeBuildOptions {
  const drain = !!request.drain;
  return {
    recipients: drain ? [] : request.recipients.map((r) => ({ address: r.address.trim(), sats: r.amountSats })),
    drainTo: drain ? request.recipients[0].address.trim() : null,
    drainWallet: drain,
    utxos: (request.utxos ?? []).map(outpoint),
    manualOnly: (request.utxos ?? []).length > 0,
    unspendable: (request.excludeUtxos ?? []).map(outpoint),
    feeRateSatPerKwu: satPerKwu(request.feeRate),
    feeRateSatPerVb: request.feeRate,
    feeAbsoluteSats: request.feeAbsolute != null ? Math.ceil(request.feeAbsolute) : null,
    policyPaths: {},
    rbf: request.enableRbf !== false,
    csvPath: false,
    version: 1,
    currentHeight: tipHeight ?? 0,
    replacing: [...(request.replacing ?? [])],
  };
}

/** The options with a path chosen per keychain, and the version that path asks for. */
export function withPaths(
  base: NativeBuildOptions,
  policies: KeychainPolicies,
  paths: { external?: PolicyPath | null; internal?: PolicyPath | null } | null,
): NativeBuildOptions {
  const chosen: KeychainPaths = paths ?? {};
  const policyPaths: NativeBuildOptions['policyPaths'] = {};
  if (chosen.external) policyPaths.external = chosen.external;
  if (chosen.internal) policyPaths.internal = chosen.internal;
  return { ...base, policyPaths, ...versionFor(policies, chosen) };
}
