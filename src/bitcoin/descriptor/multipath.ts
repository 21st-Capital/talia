/**
 * Multipath descriptor splitting.
 *
 * Liana and Sparrow export multipath descriptors (BIP-389): a single string
 * with `<0;1>` marking the external/internal (receive/change) branches. The
 * bdk-rn 0.30 native parser, the engine's until the old engine's removal
 * (decided 2026-11-04), rejected these ("Error while parsing key derivation
 * path"), so before handing a descriptor to BDK we split it into two plain
 * descriptors — one per branch. bdk-ffi 3.1.1 reads them itself, but the
 * engine is still handed the same two descriptors (engineShared.ts
 * `descriptorPair`), so a vault opens exactly as it always did. The original multipath string remains what
 * Keel stores and displays; splitting is purely a BDK-boundary concern.
 */
import { stripChecksum } from './parse';

const MULTIPATH_RE = /<(\d+);(\d+)>/g;

export interface SplitDescriptors {
  /** Descriptor for the external (receive) chain. */
  external: string;
  /** Descriptor for the internal (change) chain, when the input is multipath. */
  internal?: string;
}

/**
 * Split a (possibly) multipath descriptor into external/internal descriptors.
 *
 * - Non-multipath input is returned unchanged (checksum kept — still valid).
 * - Multipath input has every `<a;b>` replaced by `a` (external) and `b`
 *   (internal); the original checksum is dropped because the body changed.
 */
export function splitMultipathDescriptor(raw: string): SplitDescriptors {
  const trimmed = raw.trim();
  const { body } = stripChecksum(trimmed);
  MULTIPATH_RE.lastIndex = 0;
  if (!MULTIPATH_RE.test(body)) {
    return { external: trimmed };
  }
  return {
    external: body.replace(MULTIPATH_RE, '$1'),
    internal: body.replace(MULTIPATH_RE, '$2'),
  };
}
