/**
 * The key check on the testing call (decided 2026-09-07).
 *
 * Before 21st Capital marks a vault tested, the client and a staff member
 * confirm on a call that the 21C keys in the vault really are ours. The app
 * asks the backend about the keys it finds in the vault's own descriptor,
 * identified by their public key (unique per key, unlike the fingerprint the
 * whole seed shares), and records the client's tick per key. The staff tick
 * comes back on the next read, so the client sees both sides.
 *
 * A key the backend does not recognise as the client's is reported as
 * UNKNOWN and shown as a warning: a key claiming to be ours that is not is
 * exactly what the check exists to catch.
 */
import { COMPANY_API, authHeaders } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { KEY_PROOF_POLICY, checkKeyProof, proofModeFor } from './keyAttestation';
import type { KeyProofPolicy, KeyProofResult } from './keyAttestation';

export const KEY_VERIFICATION_URL = `${COMPANY_API}/api/vaults/key-verification/`;

export interface KeyVerificationVault {
  vaultId: string;
  vaultNumber: number;
  account: number;
  /** ISO time staff marked the vault tested; null until then. */
  testedAt: string | null;
}

export interface KeyVerificationEntry {
  xpub: string;
  fingerprint: string | null;
  originPath: string | null;
  purpose: 'cosigner' | 'rescue';
  network: string;
  isArchived: boolean;
  /** ISO time the client tapped Verified; null until then. */
  clientVerifiedAt: string | null;
  /** ISO time a staff member matched the key on the Ledger; null until then. */
  staffVerifiedAt: string | null;
  /** The vault this key serves, when the backend can place it. */
  vault: KeyVerificationVault | null;
  /** The device-signed proof of this key, RAW (null when none was sent):
   *  read only by keyAttestation.ts (decided 2026-09-26). */
  proof: unknown;
}

export interface KeyVerificationStatus {
  keys: KeyVerificationEntry[];
  /** Public keys the backend does not know as this client's. */
  unknown: string[];
}

/** Pure parser for one key entry; exported for tests. */
export function parseKeyVerificationEntry(raw: unknown): KeyVerificationEntry | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.xpub !== 'string') return null;
  const v = o.vault as Record<string, unknown> | null | undefined;
  const str = (x: unknown) => (typeof x === 'string' ? x : null);
  return {
    xpub: o.xpub,
    fingerprint: str(o.fingerprint)?.toLowerCase() ?? null,
    originPath: str(o.origin_path),
    purpose: o.purpose === 'rescue' ? 'rescue' : 'cosigner',
    network: str(o.network) ?? '',
    isArchived: o.is_archived === true,
    clientVerifiedAt: str(o.client_verified_at),
    staffVerifiedAt: str(o.staff_verified_at),
    vault:
      v && typeof v.vault_id === 'string' && typeof v.vault_number === 'number'
        ? {
            vaultId: v.vault_id,
            vaultNumber: v.vault_number,
            account: typeof v.account === 'number' ? v.account : -1,
            testedAt: str(v.tested_at),
          }
        : null,
    proof: o.proof ?? null,
  };
}

/**
 * The proof of a key the client already holds, for the "proven" mark on the
 * key check. Null unless the mode for `network` (the vault's own) is
 * enforce: the mark is switched on together with enforcement, and nothing
 * here ever withholds or blocks a key, it only says whether ours is proven.
 * The purpose is the server's word, which a proof can only confirm: a proof
 * for the other role is signed by the other seed, whose pin is not this one.
 */
export function keyVerificationProof(
  entry: KeyVerificationEntry,
  network: 'mainnet' | 'testnet4',
  policy: KeyProofPolicy = KEY_PROOF_POLICY,
): KeyProofResult | null {
  if (proofModeFor(policy, network) !== 'enforce') return null;
  return checkKeyProof({
    key: { fingerprint: entry.fingerprint ?? '', originPath: entry.originPath ?? '', xpub: entry.xpub },
    proof: entry.proof,
    network,
    purpose: entry.purpose,
    account: entry.vault && entry.vault.account >= 0 ? entry.vault.account : null,
    pins: policy.pins,
  });
}

/** The backend refused the session (401): reload it, or ask for a sign-in. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

async function readError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 401) return new SessionExpiredError();
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return new Error(body.message || body.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

/** The state of these keys: whose they are, both ticks, the vault they serve. */
export async function fetchKeyVerification(
  session: CompanySession,
  xpubs: string[],
): Promise<KeyVerificationStatus> {
  const qs = new URLSearchParams({ xpubs: xpubs.join(',') }).toString();
  const res = await fetch(`${KEY_VERIFICATION_URL}?${qs}`, { headers: authHeaders(session) });
  if (!res.ok) throw await readError(res, `Could not check the keys (${res.status}).`);
  const body = (await res.json()) as { keys?: unknown[]; unknown?: unknown[] };
  return {
    keys: (body.keys ?? [])
      .map(parseKeyVerificationEntry)
      .filter((k): k is KeyVerificationEntry => k !== null),
    unknown: (body.unknown ?? []).filter((x): x is string => typeof x === 'string'),
  };
}

/** The client's tick on one key. One-way: a tick given on a call stays. */
export async function confirmKeyVerified(
  session: CompanySession,
  xpub: string,
): Promise<KeyVerificationEntry> {
  const res = await fetch(KEY_VERIFICATION_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ xpub }),
  });
  if (!res.ok) throw await readError(res, `Could not record the tick (${res.status}).`);
  const entry = parseKeyVerificationEntry(await res.json());
  if (!entry) throw new Error('The server gave an answer the app could not read.');
  return entry;
}
