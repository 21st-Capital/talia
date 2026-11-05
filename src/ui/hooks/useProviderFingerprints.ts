/**
 * Which keys in this vault are 21st Capital's — from BOTH sources.
 *
 * The creation-time tag (`wallet.providerKeyFingerprints`) is missing or
 * incomplete on IMPORTED vaults, and legacy keys predate it entirely. The
 * live `known-fingerprints` endpoint covers every key we ever issued,
 * archived included (backend fix, 2026-07-27). Screens that decide "is
 * this OUR key?" must consult both, or a client holding a legacy 21C key is
 * told to register the vault on hardware they don't have — and could rename
 * our key.
 *
 * The signing ceremony already merged both; this hook is that logic made
 * shareable.
 */
import { useEffect, useMemo, useState } from 'react';

import { fetchKnown21CFingerprints } from '../../services/providerKeys';

export function useProviderFingerprints(wallet?: {
  providerKeyFingerprints?: string[];
}): {
  /** Lowercase 8-hex fingerprints of 21st Capital's keys. */
  providerFps: Set<string>;
  /** The known-fingerprints fetch has settled (success OR failure). Until
   *  then an empty set means "still loading", not "no 21C keys" — screens
   *  that fail closed on the set must wait for this, and must NOT issue
   *  their own duplicate fetch (racing two fetches reintroduced the flash
   *  this exists to prevent; decided 2026-08-27). */
  settled: boolean;
  isProviderKey: (fingerprint?: string) => boolean;
} {
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // Cached + offline-safe; never throws.
    void fetchKnown21CFingerprints()
      .then(setKnown)
      .catch(() => {})
      .finally(() => setSettled(true));
  }, []);

  const providerFps = useMemo(
    () =>
      new Set<string>([
        ...(wallet?.providerKeyFingerprints ?? []).map((f) => f.toLowerCase()),
        ...known,
      ]),
    [wallet?.providerKeyFingerprints, known],
  );

  return {
    providerFps,
    settled,
    isProviderKey: (fingerprint?: string) =>
      !!fingerprint && providerFps.has(fingerprint.toLowerCase()),
  };
}
