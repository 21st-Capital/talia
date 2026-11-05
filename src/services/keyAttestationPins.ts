/**
 * The switches and pins for the per-key proof of 21st Capital's keys
 * (decided 2026-09-26). The checker that uses
 * them is keyAttestation.ts; the one place it runs is issuedKeysProblem.
 *
 * Only 21st Capital changes this file, through a reviewed commit (decided
 * 2026-10-06). Since 2026-10-14 both networks ENFORCE and
 * every role is REQUIRED: the backend serves a verified proof for every 21C
 * pool key (all proven on 2026-10-13, and the backend itself blocks
 * since then), so a key without a valid proof never goes into a new vault.
 *
 * WHAT A PIN IS. Each 21st Capital seed signs its key pool with a key of its
 * own at m/44'/coin'/99'/0/0 (21st Capital's key tooling). The pin is
 * that key's ordinary P2PKH address, READ OFF THE DEVICE'S OWN SCREEN during
 * the export session (the key tooling shows it on the device), never
 * copied from a file or from the server. An address is public and spends
 * nothing. One address per (network, purpose, seed); the backend's
 * KEY_ATTESTATION_PINS setting has the same nesting and the same values.
 *
 * HOW TO CHECK A PIN. Anyone can check that a 21st Capital key the backend
 * serves is covered by its pin: take the `proof` served with the key, verify
 * its signature over its manifest against the pinned address with any
 * BIP-137 message verifier (for example `bitcoin-cli verifymessage <pin>
 * <signature> <manifest>`), and check that the key's leaf hashes up to the
 * manifest's root along the proof's path, as checkKeyProof in
 * keyAttestation.ts does step by step. A pin changes only in a reviewed
 * commit of this file.
 *
 * MODES, per network:
 *  - off:     today's fingerprint checks only; a proof is not looked at.
 *  - report:  every proof is checked; a failure is logged (console.warn and
 *             a report to our team, no xpub in it) and the build goes ahead.
 *  - enforce: a proof that is present and WRONG refuses the build. A missing
 *             or unpinned proof refuses only where KEY_PROOF_REQUIRED says so.
 * Any other value reads as `report`, which never refuses anything.
 *
 * KEY_PROOF_REQUIRED is the cutover: the rule that works without trusting the
 * server, because a server that strips a proof can no longer get a key past
 * it. Turn it on only in a later build, once the backend serves a proof for
 * every key, rescue first. A required role must have a valid pin for every
 * seed it accepts (jest refuses otherwise). Existing vaults are never checked
 * or blocked: this runs only when a vault is built.
 *
 * The order (decided 2026-10-14): pins filled first, then every pool
 * re-uploaded with its proof, then enforce + required on both networks, in
 * the backend and here at once, tested in a side-by-side build (TALIA_SIDE)
 * together with the BDK updates.
 */

export type ProofNet = 'mainnet' | 'testnet4';
export type ProofPurpose = 'cosigner' | 'rescue';
export type KeyProofMode = 'off' | 'report' | 'enforce';

/** (network, purpose) -> seed fingerprint -> P2PKH address ("" = not pinned). */
export type AttestationPins = Readonly<
  Record<ProofNet, Readonly<Record<ProofPurpose, Readonly<Record<string, string>>>>>
>;

/**
 * The addresses the device screens showed in the export sessions: testnet4 both
 * seeds and the mainnet co-signer on 2026-10-07, the mainnet rescue seed on
 * 2026-10-08. Every pool of each seed was then attested (v2) and verified
 * against its address. The same four as the backend's
 * KEY_ATTESTATION_PIN_DEFAULTS. A wrong-network, malformed or empty entry
 * counts as not pinned.
 */
export const KEY_ATTESTATION_PINS: AttestationPins = {
  mainnet: {
    cosigner: { bb09d891: '15Gtwbpj23Ey4sMLscUbDAMAzV7YoGnoeF' }, // live co-signing seed
    rescue: { fdcd357b: '1EK1qTm9nBTJjJA1saZ4xCpXZ9X2A1YPiq' }, // live rescue seed
  },
  testnet4: {
    cosigner: { '49578625': 'mfvPbW2wVp3SZ9cezoRFKb6TFoY3qHXU7P' },
    // A passphrase wallet: its address was read with the passphrase entered.
    rescue: { '01d4b72e': 'mqFFvB2KKzWHTUkfFPM9CgEwp2nT5LqaGU' },
  },
};

/** What the app does with a proof, per network: enforce since 2026-10-14. */
export const KEY_PROOF_MODE: Readonly<Record<ProofNet, KeyProofMode>> = {
  mainnet: 'enforce',
  testnet4: 'enforce',
};

/** The cutover: a missing or unpinned proof refuses the build (enforce
 *  only). On for every role since 2026-10-14. */
export const KEY_PROOF_REQUIRED: Readonly<Record<ProofNet, Readonly<Record<ProofPurpose, boolean>>>> = {
  mainnet: { cosigner: true, rescue: true },
  testnet4: { cosigner: true, rescue: true },
};
