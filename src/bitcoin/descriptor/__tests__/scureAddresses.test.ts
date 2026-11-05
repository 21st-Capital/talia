/**
 * The independent address check's own derivation (scureAddresses.ts), held
 * to the addresses BOTH libraries derived for a corpus of vault shapes
 * (copied on 2026-10-17 into __fixtures__/scureCorpus.json),
 * indexes 0, 1, 99, 150 and 1000 of both keychains on mainnet and regtest.
 * Test keys only (the corpus's k0..k6 and [s;32] seeds).
 *
 * Every shape Talia composes must be covered (`c-*`), and every shape it
 * covers must agree with the corpus exactly: a wrong address here would block
 * Receive for a real vault.
 */
import * as fs from 'fs';
import * as path from 'path';
import { scureAddresses, scureDeriver } from '../scureAddresses';
import { splitMultipathDescriptor } from '../multipath';
import type { Network } from '../types';

interface Shape {
  label: string;
  stored?: string;
  external?: string;
  internal?: string | null;
  samples: Array<[Network, 'ext' | 'int', number, string]>;
}

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'scureCorpus.json'), 'utf8'),
) as Shape[];

const pairOf = (s: Shape): { external: string; internal: string | null } => {
  if (s.stored) {
    const split = splitMultipathDescriptor(s.stored);
    return { external: split.external, internal: split.internal ?? null };
  }
  return { external: s.external as string, internal: s.internal ?? null };
};

describe('scure addresses against both libraries\' corpus', () => {
  it('reads the whole corpus file', () => {
    expect(corpus.length).toBe(74);
    expect(corpus.every((s) => s.samples.length > 0)).toBe(true);
  });

  it('covers every shape Talia composes', () => {
    const composed = corpus.filter((s) => s.label.startsWith('c-'));
    expect(composed.length).toBeGreaterThan(30);
    const missing = composed.filter((s) => !scureDeriver(pairOf(s).external, 'bitcoin')).map((s) => s.label);
    expect(missing).toEqual([]);
  });

  it('agrees with both libraries on every sample of every shape it covers', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const s of corpus) {
      const { external, internal } = pairOf(s);
      for (const [net, kc, index, address] of s.samples) {
        const desc = kc === 'ext' ? external : internal ?? external;
        const got = scureAddresses(desc, net, [index]);
        if (!got) continue;
        checked++;
        if (got[0].address !== address) wrong.push(`${s.label} ${net} ${kc} ${index}: ${got[0].address} != ${address}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('says which imported shapes it leaves unchecked (the preflight\'s until 2026-11-04)', () => {
    const notCovered = corpus.filter((s) => !scureDeriver(pairOf(s).external, 'bitcoin')).map((s) => s.label);
    // Liana's thresh() recovery groups (and the a:/s: wrappers with them): 71 of 74 are covered,
    // after() shapes included.
    expect(notCovered.sort()).toEqual(['i-liana-wsh-one-device-two-paths', 'i-liana-wsh-thresh-reuse', 'wsh-layered']);
    for (const label of ['wsh-after', 'wsh-after-future', 'i-tr-after', 'tr-liana-keypath-older']) {
      expect(notCovered).not.toContain(label);
    }
  });

  it('answers null, never a guess, for what it cannot read', () => {
    expect(scureDeriver('wsh(thresh(2,pk(xpub/0/*),s:pk(xpub/1/*)))', 'bitcoin')).toBeNull();
    expect(scureDeriver('wpkh([73c5da0a/84h/0h/0h]xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/<0;1>/*)', 'bitcoin')).toBeNull();
    expect(scureDeriver('wpkh(xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/0h/*)', 'bitcoin')).toBeNull();
    expect(scureDeriver('combo(xpub/0/*)', 'bitcoin')).toBeNull();
  });

  it('gives BIP-84\'s published first address', () => {
    const d =
      "wpkh([73c5da0a/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/0/*)";
    expect(scureAddresses(d, 'bitcoin', [0])?.[0].address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  });
});
