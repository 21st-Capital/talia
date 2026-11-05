/**
 * The switches and pins set for the per-key proof (decided 2026-09-26).
 * These tests hold whatever values are chosen: they refuse only a
 * combination that would stop vaults being built, or trust a seed that must
 * never be trusted.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isPinAddress } from '../keyAttestation';
import { PINNED_21C_MAINNET } from '../issuedKeyPins';
import {
  KEY_ATTESTATION_PINS,
  KEY_PROOF_MODE,
  KEY_PROOF_REQUIRED,
} from '../keyAttestationPins';
import type { ProofNet, ProofPurpose } from '../keyAttestationPins';

const NETS: ProofNet[] = ['mainnet', 'testnet4'];
const PURPOSES: ProofPurpose[] = ['cosigner', 'rescue'];
const COIN = { mainnet: 0, testnet4: 1 } as const;
const ROLE = { cosigner: 'coSigner', rescue: 'rescue' } as const;

/**
 * Retired 21st Capital seeds, as the SHA-256 (hex) of each lowercase
 * fingerprint, one per line in private/retired-seed-sha256.txt. Only the
 * private repository has that file: the public copy leaves private/ out,
 * because a hash of a 32-bit value is reversed by trying them all. Without
 * the file the check below is skipped, and its title says so.
 */
const RETIRED_SEED_FILE = join(__dirname, '..', '..', '..', 'private', 'retired-seed-sha256.txt');
const RETIRED_SEED_SHA256 = new Set(
  existsSync(RETIRED_SEED_FILE)
    ? readFileSync(RETIRED_SEED_FILE, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line, i) => {
          if (!/^[0-9a-f]{64}$/.test(line)) throw new Error(`${RETIRED_SEED_FILE}: entry ${i + 1} is not one SHA-256 value`);
          return line;
        })
    : [],
);
const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex');
const privateIt = RETIRED_SEED_SHA256.size > 0 ? it : it.skip;
const PRIVATE_NOTE = RETIRED_SEED_SHA256.size > 0 ? '' : ' (skipped: private/retired-seed-sha256.txt is not in this copy)';

describe('KEY_ATTESTATION_PINS', () => {
  it('pins 8-hex seeds only, and never one seed in both roles', () => {
    for (const net of NETS) {
      const seen = new Set<string>();
      for (const purpose of PURPOSES) {
        for (const seed of Object.keys(KEY_ATTESTATION_PINS[net][purpose])) {
          expect(seed).toMatch(/^[0-9a-f]{8}$/);
          expect(seen.has(seed)).toBe(false);
          seen.add(seed);
        }
      }
    }
  });

  // Private check, skipped where the list is not in the copy.
  privateIt(`pins no retired seed, here or among the Bitcoin fingerprint pins${PRIVATE_NOTE}`, () => {
    const pinned = [
      ...NETS.flatMap((net) => PURPOSES.flatMap((purpose) => Object.keys(KEY_ATTESTATION_PINS[net][purpose]))),
      ...PINNED_21C_MAINNET.coSigner,
      ...PINNED_21C_MAINNET.rescue,
    ];
    // Never the value in a failure: the position in the list only.
    expect(pinned.map((seed, i) => (RETIRED_SEED_SHA256.has(sha256Hex(seed.toLowerCase())) ? i : -1)).filter((i) => i >= 0)).toEqual([]);
  });

  it('on Bitcoin, pins only the live seeds issuedKeyPins accepts for that role', () => {
    for (const purpose of PURPOSES) {
      for (const seed of Object.keys(KEY_ATTESTATION_PINS.mainnet[purpose])) {
        expect(PINNED_21C_MAINNET[ROLE[purpose]] as readonly string[]).toContain(seed);
      }
    }
  });

  it('every filled pin is a P2PKH address of its own network, and no address pins two seeds', () => {
    const addresses = new Set<string>();
    for (const net of NETS) {
      for (const purpose of PURPOSES) {
        for (const pin of Object.values(KEY_ATTESTATION_PINS[net][purpose])) {
          if (pin === '') continue; // a placeholder: not pinned
          expect(isPinAddress(pin, COIN[net])).toBe(true);
          expect(addresses.has(pin.trim())).toBe(false);
          addresses.add(pin.trim());
        }
      }
    }
  });
});

describe('the shipped pins', () => {
  // The four addresses read off the device screens (2026-10-07/08), the
  // same four as the backend's KEY_ATTESTATION_PIN_DEFAULTS. Pinned exactly,
  // so a blanked or mistyped pin fails here instead of proving nothing.
  it('are the four device addresses, each valid for its own network', () => {
    expect(KEY_ATTESTATION_PINS).toEqual({
      mainnet: {
        cosigner: { bb09d891: '15Gtwbpj23Ey4sMLscUbDAMAzV7YoGnoeF' },
        rescue: { fdcd357b: '1EK1qTm9nBTJjJA1saZ4xCpXZ9X2A1YPiq' },
      },
      testnet4: {
        cosigner: { '49578625': 'mfvPbW2wVp3SZ9cezoRFKb6TFoY3qHXU7P' },
        rescue: { '01d4b72e': 'mqFFvB2KKzWHTUkfFPM9CgEwp2nT5LqaGU' },
      },
    });
    for (const net of NETS) {
      for (const purpose of PURPOSES) {
        for (const pin of Object.values(KEY_ATTESTATION_PINS[net][purpose])) {
          expect(isPinAddress(pin, COIN[net])).toBe(true);
        }
      }
    }
  });
});

describe('KEY_PROOF_MODE and KEY_PROOF_REQUIRED', () => {
  it('every mode is one of the three', () => {
    for (const net of NETS) expect(['off', 'report', 'enforce']).toContain(KEY_PROOF_MODE[net]);
  });

  it('required is only ever set together with enforce', () => {
    for (const net of NETS) {
      for (const purpose of PURPOSES) {
        if (KEY_PROOF_REQUIRED[net][purpose]) expect(KEY_PROOF_MODE[net]).toBe('enforce');
      }
    }
  });

  it('Testnet4 enforces and requires the proof for every role: no fingerprint pin keeps an unpinned seed out there', () => {
    // On Bitcoin, issuedKeyPins.ts refuses any seed outside PINNED_21C_MAINNET
    // whatever these switches say. Testnet4 has no such pin, so relaxing its
    // proof would let a seed that is no longer pinned (a retired one) place a
    // key in a new vault again. Add a fingerprint pin there before relaxing it.
    expect(KEY_PROOF_MODE.testnet4).toBe('enforce');
    expect(KEY_PROOF_REQUIRED.testnet4).toEqual({ cosigner: true, rescue: true });
  });

  it('required implies a valid pin for EVERY seed that role accepts, or no vault could be built', () => {
    for (const net of NETS) {
      for (const purpose of PURPOSES) {
        if (!KEY_PROOF_REQUIRED[net][purpose]) continue;
        const table = KEY_ATTESTATION_PINS[net][purpose];
        const seeds =
          net === 'mainnet'
            ? [...(PINNED_21C_MAINNET[ROLE[purpose]] as readonly string[])]
            : Object.keys(table);
        expect(seeds.length).toBeGreaterThan(0);
        for (const seed of seeds) expect(isPinAddress(table[seed], COIN[net])).toBe(true);
      }
    }
  });
});
