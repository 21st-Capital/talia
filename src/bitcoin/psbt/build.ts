/**
 * PSBT build orchestration.
 *
 * Validates a spend request in pure TypeScript, then delegates the actual
 * (unsigned) PSBT construction to the wallet engine — which in production is
 * BDK. Keeping validation here and separate from bdkWalletEngine makes it unit
 * testable against a fake engine and independent of any native module.
 *
 * Phase 1 is watch-only: the output is always an *unsigned* PSBT.
 */
import type {
  BuildPsbtRequest,
  PsbtBuildResult,
  Recipient,
  WalletEngine,
} from '../engine/types';
import type { Network } from '../descriptor/types';
import { addressFitsNetwork, wrongNetworkMessage } from '../addressNetwork';

/**
 * The highest fee rate Talia builds at (sat/vB), whoever proposed it: the
 * custom field, the mempool.space tiers and a Speed up all stop here
 * (decided 2026-09-26). Lives in the bitcoin layer so the engine
 * can enforce it; wallet/feeEstimates re-exports it for the screens.
 */
export const MAX_FEE_RATE = 2000;

/** Standard dust threshold (sats). Below this, outputs are non-standard. */
export const DUST_LIMIT = 546;

/** A single validation problem with a request. */
export interface BuildValidationIssue {
  field: 'recipients' | 'amount' | 'address' | 'feeRate' | 'drain';
  message: string;
}

/**
 * Validate a build request without touching the chain. Returns all issues found
 * (empty array = valid). With `network`, an address of another network is an
 * issue too: bdk-rn, the old engine's bridge, resolved the script with no
 * network check at all (decided 2026-09-26), so this and the
 * engine's own check are the guards.
 */
export function validateBuildRequest(
  request: BuildPsbtRequest,
  network?: Network,
): BuildValidationIssue[] {
  const issues: BuildValidationIssue[] = [];

  if (!request.recipients || request.recipients.length === 0) {
    issues.push({ field: 'recipients', message: 'Add at least one recipient.' });
  }

  if (request.drain && request.recipients && request.recipients.length !== 1) {
    issues.push({
      field: 'drain',
      message: 'Draining the wallet requires exactly one recipient.',
    });
  }

  (request.recipients ?? []).forEach((r, i) => {
    if (!looksLikeAddress(r.address)) {
      issues.push({ field: 'address', message: `Recipient ${i + 1}: invalid address.` });
    } else if (network && !addressFitsNetwork(r.address, network)) {
      issues.push({ field: 'address', message: wrongNetworkMessage(network) });
    }
    // Amount is ignored when draining (engine sends the whole balance).
    if (!request.drain) {
      if (!Number.isFinite(r.amountSats) || r.amountSats <= 0) {
        issues.push({ field: 'amount', message: `Recipient ${i + 1}: enter an amount.` });
      } else if (r.amountSats < DUST_LIMIT) {
        issues.push({
          field: 'amount',
          message: `Recipient ${i + 1}: amount below dust limit (${DUST_LIMIT} sats).`,
        });
      }
    }
  });

  if (!Number.isFinite(request.feeRate) || request.feeRate <= 0) {
    issues.push({ field: 'feeRate', message: 'Fee rate must be greater than 0 sat/vB.' });
  } else if (request.feeRate > MAX_FEE_RATE) {
    // The one ceiling for every rate: typed, from mempool.space, or a bump
    // (decided 2026-09-26).
    issues.push({ field: 'feeRate', message: `The fee rate is above ${MAX_FEE_RATE} sat/vB.` });
  }

  if (
    request.feeAbsolute != null &&
    (!Number.isFinite(request.feeAbsolute) || request.feeAbsolute <= 0)
  ) {
    issues.push({ field: 'feeRate', message: 'The network fee must be greater than 0 sats.' });
  }

  return issues;
}

/**
 * Build an unsigned PSBT via the engine after validating the request.
 * Throws with the first validation message if the request is invalid, or
 * propagates the engine's error (e.g. "insufficient funds") otherwise.
 */
export async function buildUnsignedPsbt(
  engine: WalletEngine,
  request: BuildPsbtRequest,
): Promise<PsbtBuildResult> {
  const issues = validateBuildRequest(request, engine.network);
  if (issues.length > 0) {
    throw new BuildValidationError(issues);
  }
  return engine.buildPsbt(request);
}

/** Error carrying all validation issues for a failed build request. */
export class BuildValidationError extends Error {
  readonly issues: BuildValidationIssue[];
  constructor(issues: BuildValidationIssue[]) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'BuildValidationError';
    this.issues = issues;
  }
}

/** Sum recipient amounts (sats). */
export function totalRecipientAmount(recipients: Recipient[]): number {
  return recipients.reduce((sum, r) => sum + (r.amountSats || 0), 0);
}

/**
 * Very light structural address check — non-empty, no whitespace, plausible
 * bech32/base58 charset and length. Authoritative validation is BDK's.
 */
export function looksLikeAddress(address: string, network?: Network): boolean {
  if (!address || /\s/.test(address)) return false;
  const a = address.trim();
  if (a.length < 14 || a.length > 100) return false;
  // bech32 / bech32m (bc1, tb1, bcrt1) or base58 (1, 3, m, n, 2).
  const shaped = /^(bc1|tb1|bcrt1)[0-9a-z]+$/i.test(a) || /^[123mn][1-9A-HJ-NP-Za-km-z]+$/.test(a);
  // With a network, the address must also decode and belong to it.
  return shaped && (network == null || addressFitsNetwork(a, network));
}
