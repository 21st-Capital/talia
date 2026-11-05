/**
 * What went wrong inside the wallet engine, as a CODE (BDK upgrade, decided
 * 2026-10-15).
 *
 * The app used to read BDK's error TEXT wherever it had to decide something:
 * the engine retried a build when the message held "Spending policy
 * required", Speed up and Cancel read "N sat available" out of an
 * insufficient-funds message, and Send's refresh list sorted its skipped
 * coins by the same words. Those words belong to bdk 0.28 behind bdk-ffi 0.30's
 * Swift bridge (`InsufficientFunds(message: "Insufficient funds: 10 sat
 * available of 20 sat needed")`). The new library says some of them
 * differently ("Not enough" where 0.28 printed "Not enought") and its bridge
 * rejects with a stable `code` instead. Every
 * decision now asks `classifyEngineError` (or `engineErrorFacts`), which reads
 * the code when the error carries one of ours and otherwise the 0.28 text by
 * EXACTLY the rules the call sites used before, so nothing changed for the
 * old engine while it shipped. Since its removal (decided 2026-11-04) every
 * build runs the coded engine.
 *
 * Pure, no native import: tested in Node with the real 0.28 messages the
 * fixtures recorded (`__fixtures__/bdkPolicies.json`, and the old bridge's
 * recording, whose refusals engineError.test.ts keeps word for word).
 *
 * The server-refusal regexes are NOT here on purpose: a broadcast refused by
 * the Electrum server is the network's answer, not the engine's
 * (`replacementBroadcastFailure`, SignPsbtScreen, RefreshSessionScreen).
 * Whether a server could be reached at all IS here (`serverUnreachable`): it
 * is about the connection, and the wallet layer's server rule
 * (wallet/chainServers.ts) asks it (the shadow's report did too until the
 * old engine's removal, decided 2026-11-04).
 */

export type EngineErrorCode =
  /** BDK will not choose between the branches of a multi-path vault on its
   *  own: build again with a policy path (the engine's retry). */
  | 'SPENDING_POLICY_REQUIRED'
  /** A policy path was given and a node on it got too few children
   *  ("Not enought items selected" in 0.28, "Not enough" in 3.x). */
  | 'POLICY_PATH_INVALID'
  /** Too little to pay the outputs and the fee ("N sat available of M sat
   *  needed"). */
  | 'INSUFFICIENT_FUNDS'
  /** An output, the change of a send-all included, would be dust. */
  | 'OUTPUT_BELOW_DUST'
  /** A named coin the engine does not hold as spendable (3.x refuses a coin
   *  a waiting transaction spends this way). */
  | 'UNKNOWN_UTXO'
  /** The library panicked; the new bridge recreates the wallet. */
  | 'RUST_PANIC'
  /** The new library refused a version 1 transaction on a CSV path: the
   *  engine builds it again as version 2. */
  | 'VERSION1_CSV'
  /** The new bridge's post-build checks refused the PSBT before any device
   *  saw it, or the engine's own check of the vault's outputs
   *  against the independent derivation did. */
  | 'POST_BUILD_CHECK'
  /** A panic recreated the new library's wallet, which answers nothing that
   *  needs the chain until it synced again: the engine syncs and asks once
   *  more. */
  | 'WALLET_RESYNCING'
  /** A sync of the new library stopped with a keychain not searched as far
   *  as the coverage rule asks (decided 2026-10-17): it refuses rather than miss a coin. */
  | 'COVERAGE_INCOMPLETE'
  /** The independent address check found this vault's addresses differ
   *  between the engine and @scure/btc-signer (decided 2026-10-15): nothing is
   *  built for the vault. Also what the new engine throws when a build's own
   *  output (its change, a refresh, a cancel) pays another script than scure
   *  derives at the index it names, with `mismatch` saying where. */
  | 'ADDRESS_CHECK_FAILED'
  /** The new bridge could not open a connection to the server, and the
   *  server said nothing of its own (decided 2026-10-30): marked where the
   *  connection is opened, so `serverUnreachable` need not read the library's
   *  words. */
  | 'SERVER_UNREACHABLE'
  /** Anything else: shown as it is. */
  | 'OTHER';

/**
 * What the client reads when a build is refused by the checks after it
 * (POST_BUILD_CHECK): one plain sentence. The checks' own words name inputs,
 * outputs and PSBT fields ("input 0 carries no witness_utxo"), which no
 * client text may (plain-language rule), so they go to the log alone.
 */
export const POST_BUILD_CHECK_MESSAGE = 'Talia could not build this payment safely.';

export const ENGINE_ERROR_CODES: readonly EngineErrorCode[] = [
  'SPENDING_POLICY_REQUIRED',
  'POLICY_PATH_INVALID',
  'INSUFFICIENT_FUNDS',
  'OUTPUT_BELOW_DUST',
  'UNKNOWN_UTXO',
  'RUST_PANIC',
  'VERSION1_CSV',
  'POST_BUILD_CHECK',
  'WALLET_RESYNCING',
  'COVERAGE_INCOMPLETE',
  'ADDRESS_CHECK_FAILED',
  'SERVER_UNREACHABLE',
  'OTHER',
];

/**
 * The error a coded engine throws (the bridge rejects with `code` and a
 * message in 0.28's wording). The engine every build runs since the old engine's removal
 * (decided 2026-11-04) is coded; the old engine's errors were read by their
 * text, and the text rules stay for anything that still arrives as text.
 */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** INSUFFICIENT_FUNDS: what the coins could pay, and what was needed. */
  readonly availableSats?: number;
  readonly neededSats?: number;
  /** ADDRESS_CHECK_FAILED from a build: where the build's own output and
   *  scure disagreed (wallet/addressCheckStore.ts pauses the vault on it). */
  readonly mismatch?: { keychain: 'external' | 'internal'; index: number };

  constructor(
    code: EngineErrorCode,
    message: string,
    facts?: {
      availableSats?: number;
      neededSats?: number;
      mismatch?: { keychain: 'external' | 'internal'; index: number };
    },
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    if (facts?.availableSats != null) this.availableSats = facts.availableSats;
    if (facts?.neededSats != null) this.neededSats = facts.neededSats;
    if (facts?.mismatch) this.mismatch = { keychain: facts.mismatch.keychain, index: facts.mismatch.index };
  }
}

/** Where a refused build's own output disagreed with scure, when the error says. */
export function buildMismatchOf(e: unknown): { keychain: 'external' | 'internal'; index: number } | null {
  if (!e || typeof e !== 'object') return null;
  const m = (e as { code?: unknown; mismatch?: unknown }).mismatch as
    | { keychain?: unknown; index?: unknown }
    | undefined;
  if ((e as { code?: unknown }).code !== 'ADDRESS_CHECK_FAILED' || !m) return null;
  if (m.keychain !== 'external' && m.keychain !== 'internal') return null;
  if (typeof m.index !== 'number' || !Number.isInteger(m.index) || m.index < 0) return null;
  return { keychain: m.keychain, index: m.index };
}

export interface EngineErrorFacts {
  code: EngineErrorCode;
  /** The message as the call sites always read it. */
  message: string;
  /** "N sat available", when the error says (an insufficient-funds one). */
  availableSats: number | null;
  /** "of M sat needed", when the error says. */
  neededSats: number | null;
}

/** The text every call site read: the message, else the thing itself. */
export function engineErrorMessage(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

const isCode = (v: unknown): v is EngineErrorCode =>
  typeof v === 'string' && (ENGINE_ERROR_CODES as readonly string[]).includes(v);

const satsOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * The error's own code, when it carries one of OURS. React Native's
 * rejections carry a `code` too ("Finish tx error"), which is not one, so
 * those are read by their text like everything else from bdk-ffi 0.30.
 */
function coded(e: unknown): EngineErrorFacts | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as { code?: unknown; availableSats?: unknown; neededSats?: unknown };
  if (!isCode(o.code)) return null;
  return {
    code: o.code,
    message: engineErrorMessage(e),
    availableSats: satsOf(o.availableSats),
    neededSats: satsOf(o.neededSats),
  };
}

/**
 * bdk 0.28's words, in the order the call sites asked them. Each rule is the
 * one a call site used before this file existed:
 *   - the old engine's retry (bdkEngine.ts, until the old engine's removal): `message.includes('Spending policy required')`;
 *   - replacement.ts `isInsufficientFunds`: `/insufficient/i` or `/dust/i`,
 *     and Send's refresh list `toLowerCase().includes('insufficient')`;
 *   - replacement.ts read the coins with `/(\d+)\s*sat available/i`.
 * A real message carries one of these phrases, never two.
 */
function fromText(message: string): EngineErrorFacts {
  // Read wherever the words stand, as replacement.ts read them.
  const available = /(\d+)\s*sat available/i.exec(message);
  const needed = /of\s*(\d+)\s*sat needed/i.exec(message);
  const facts = (code: EngineErrorCode): EngineErrorFacts => ({
    code,
    message,
    availableSats: available ? Number(available[1]) : null,
    neededSats: needed ? Number(needed[1]) : null,
  });
  if (message.includes('Spending policy required')) return facts('SPENDING_POLICY_REQUIRED');
  if (/insufficient/i.test(message)) return facts('INSUFFICIENT_FUNDS');
  if (/dust/i.test(message)) return facts('OUTPUT_BELOW_DUST');
  if (/Not enought? items selected/.test(message)) return facts('POLICY_PATH_INVALID');
  if (/UTXO not found in the internal database|\bUnknownUtxo\b/.test(message)) return facts('UNKNOWN_UTXO');
  if (/\brustPanic\(/.test(message)) return facts('RUST_PANIC');
  return facts('OTHER');
}

/** Everything a call site may decide on: the code, and the sats it names. */
export function engineErrorFacts(e: unknown): EngineErrorFacts {
  return coded(e) ?? fromText(engineErrorMessage(e));
}

/** The code alone. */
export function classifyEngineError(e: unknown): EngineErrorCode {
  return engineErrorFacts(e).code;
}

/**
 * Did a coded engine say this (the error carries one of OUR codes), rather
 * than 0.28's text? A decision that is new with the coded engine asks this
 * first, so the engine that ships today keeps exactly its behaviour.
 */
export function isCodedEngineError(e: unknown): boolean {
  return coded(e) != null;
}

/** A chosen coin the engine no longer has: spent, or replaced since the list was drawn. */
export const COIN_NOT_AVAILABLE = 'A chosen coin is no longer available.';

/**
 * The coded engine refuses a coin it no longer holds in the library's own
 * words. The refusal is right and the words are not for a client.
 * (The old engine, removed on 2026-11-04, kept its text.)
 */
export function coinNotAvailable(e: unknown): boolean {
  return isCodedEngineError(e) && classifyEngineError(e) === 'UNKNOWN_UTXO';
}

/**
 * Send's refresh list: was this coin left out because a waiting transaction
 * already spends it ("already part of a pending transaction")?
 *
 * A coded error says so plainly: the coin is unknown to the engine
 * (3.x) or none of it counted. For 0.28's TEXT the rule is the one Send
 * always used, kept byte for byte so this file changes nothing:
 * `message.includes('0 sat available')`. NOTE that it also matches "10 sat
 * available" and "150 sat available" (any figure ending in 0), so a coin
 * too small for its fee whose remainder ends in 0 reads as pending. Fixing
 * that is a behaviour change, left for its own phone-tested commit.
 */
export function coinsHeldByPendingTx(e: unknown): boolean {
  const c = coded(e);
  if (c) return c.code === 'UNKNOWN_UTXO' || (c.code === 'INSUFFICIENT_FUNDS' && c.availableSats === 0);
  return engineErrorMessage(e).includes('0 sat available');
}

/**
 * The server ANSWERED: electrum-client writes a refusal as "Electrum server
 * error: ...", and the bridges pass an answer that could not be read on as
 * "Error during the deserialization of a response from the server: ...", or
 * as the JSON reader's own words for a value it did not expect, which quote
 * that value ('invalid type: string "...", expected ...'). All of them can
 * carry the server's own words, so none of those may decide anything.
 */
export const SERVER_ANSWERED =
  /Electrum server error|deserialization of a response from the server|invalid (type|value): |unknown (variant|field) `/i;

/**
 * The library's words for a connection that failed, the fallback behind the
 * two fixed marks below, for an error raised after the connection was open:
 * an I/O error from the operating system, the TLS handshake meeting the end of
 * the stream ("unexpected end of file", a server that turned the connection
 * away, decided 2026-10-30), a refused certificate, a timeout.
 */
const UNREACHABLE_WORDS =
  /timed out|os error \d+|all errored|unexpected end of file|connection (refused|reset|closed|aborted)|broken pipe|unreachable|no route to host|failed to lookup|not matching SSL certificate|invalid peer certificate|certificate|handshake/i;

/**
 * Could the server not be reached at all? The fixed marks of the step that
 * opens the connection first: the bridge's `SERVER_UNREACHABLE`, and the old
 * bridge's rejection there, which no build makes since the old engine's removal (decided
 * 2026-11-04) and is read the same way. Then the library's words. An answer the text
 * shows to be one is not (`SERVER_ANSWERED`). ONE LIMIT: on an open connection
 * electrum-client reports a reply it could not read as "all errored", with
 * none of the reply in it at the settings Testnet4 uses, the same words as a
 * connection that dropped, so that reply still reads as unreachable. The cost
 * is a sentence: a real refusal is `SERVER_ANSWERED`, and a Testnet4 broadcast
 * that moves on takes the same bytes to the next server.
 */
export function serverUnreachable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'BlockchainElectrum init error') return true;
  const message = e instanceof Error ? e.message : String(e ?? '');
  if (SERVER_ANSWERED.test(message)) return false;
  return code === 'SERVER_UNREACHABLE' || UNREACHABLE_WORDS.test(message);
}
