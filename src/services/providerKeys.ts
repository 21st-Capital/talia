/**
 * 21st Capital "known key fingerprints" (decided 2026-07-23).
 *
 * Used to detect that an imported descriptor involves us (a 21C co-signer /
 * rescue key), BEFORE the client logs in, so we can offer to connect their
 * account. Fetched from the public throttled endpoint and cached so an import
 * still works offline (falls back to the last snapshot).
 *
 * Fingerprints reveal nothing spendable — they already appear in any descriptor
 * the client holds — so this is a low-sensitivity lookup, not key material.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COMPANY_API } from './companyAuth';

const KNOWN_FP_URL = `${COMPANY_API}/api/vaults/known-fingerprints/`;
const CACHE_KEY = 'provider.knownFingerprints.v1';

/**
 * The current 21C fingerprint set (lowercase 8-hex). Refreshes from the
 * endpoint and caches; on any failure returns the last cached snapshot (or an
 * empty set), so a lookup never blocks or breaks an import.
 */
export async function fetchKnown21CFingerprints(): Promise<Set<string>> {
  try {
    const res = await fetch(KNOWN_FP_URL);
    if (res.ok) {
      const body = (await res.json()) as { fingerprints?: string[] };
      const fps = (body.fingerprints ?? [])
        .map((f) => (f || '').toLowerCase())
        .filter((f) => /^[0-9a-f]{8}$/.test(f));
      if (fps.length > 0) {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fps)).catch(() => {});
        return new Set(fps);
      }
    }
  } catch {
    // network down / offline — fall through to the cached snapshot
  }
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) return new Set((JSON.parse(cached) as string[]).map((f) => f.toLowerCase()));
  } catch {
    // no usable cache
  }
  return new Set();
}
