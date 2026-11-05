/**
 * The signing ceremony on a Bluetooth device, as a stage machine (design A
 * "The courier", decided 2026-10-03). Pure: no React Native, tested in
 * `__tests__/signingCeremony.test.ts`.
 *
 * Three screens and two endings:
 *
 *   send     the transaction travels to the device (a Ledger: ONE bar along
 *            the path, filling toward the device; a BitBox: a short beat)
 *   approve  the client's turn on the device: no bar, the device is the hero
 *   return   the signed transaction comes back (a Ledger: the bar fills back
 *            toward the phone, and holds near the end until the broadcast
 *            answers)
 *   declined the client said no on the device
 *   failed   anything else (a dropped connection, a signature that would not
 *            merge)
 *
 * WHAT THE PHONE CAN ACTUALLY SEE. The Ledger kit's own "your turn" note
 * fires at the very start of a signing, before the device has read anything,
 * so it is no signal (the screen has ignored it since 2026-08-31). What the
 * phone does see is the conversation: `watchLedgerActivity` counts every
 * message sent. So:
 *
 *   - screen 1 is messages flowing. The bar is messages against today's
 *     estimate from the coin count (`readEstimate`), capped at 97% until the
 *     device goes quiet;
 *   - screen 2 is the device gone quiet: no message for 1.5 s after at least
 *     20 (the device is showing its pages and waiting for a person);
 *   - screen 3 is messages flowing again (the device signing each coin),
 *     against `signEstimate`;
 *   - the decline is exact (status 6985, `DECLINED_ON_LEDGER`).
 *
 * Two Ledger cases bend that:
 *
 *   - Bitcoin app 2.2.1 to 2.4.1 ask for a REGISTERED vault's name before
 *     the transaction ("Spend from known wallet"), a few messages in, which
 *     the 20-message rule misses: the client would stare at "Sending" while
 *     the device waited for them. The app version is read before signing
 *     starts, so for those versions (`asksNameFirst`) the FIRST quiet after
 *     two messages, and before the first coin is read
 *     (`NAME_BEFORE_MESSAGES`), is that question: screen 2 shows the name,
 *     and the messages that follow take the client back to screen 1, whose
 *     bar picks up where it stopped. A name approved inside the quiet window
 *     is never seen; the later quiet is then the review, as on newer apps.
 *   - The policy-only quick form can fail, and the signer then sends the
 *     whole transaction again. The bar restarts from zero WITH a line that
 *     says so (`restarted`), never silently backward.
 *
 * The BitBox signs in one call, its pages interleaved with the transfer, so
 * it has no messages to count: sent (the call starts), a short beat, then
 * its turn until the call answers (signed), refuses ("aborted by the user"),
 * or fails (the link). No bar on it, anywhere.
 *
 * SEVERAL TRANSACTIONS IN ONE VISIT (the refresh session, decided 2026-10-05:
 * "build the courier for refresh session too"): each transaction runs its
 * own ceremony, started afresh on the same feed with its place in the batch
 * (`CeremonyConfig.batch`, carried in the state so one signal moves the leg
 * and the count together). The screens say "transaction 2 of 3" where they
 * said "the transaction", and the client's turn stays "3. Sign the
 * transaction" on every one (as decided: "keep 3"). The slide is keyed by the leg
 * AND that place (`legKey`, `legOrder`), so the next transaction's sending
 * screen slides in like a new page instead of sliding back from the way back
 * to the way there.
 */
import { DECLINED_ON_LEDGER } from '../../bitcoin/ledger/errors';
import { versionAtLeast } from '../../bitcoin/ledger/version';

export type SigningBrand = 'ledger' | 'bitbox';

export type CeremonyLeg = 'send' | 'approve' | 'return' | 'declined' | 'failed';

/** The order the legs slide in (a later one from the right). */
export const LEG_ORDER: readonly CeremonyLeg[] = ['send', 'approve', 'return', 'declined', 'failed'];

/** A transaction's place in a batch signed in one visit, counted from 1
 *  ("transaction 2 of 3"). Null for the one transaction of a payment. */
export interface BatchPosition {
  index: number;
  count: number;
}

/** The slide's key for the leg on show: the transaction's place in its
 *  batch, then the leg, so a new transaction's first leg is a new page. */
export function legKey(s: Pick<CeremonyState, 'leg' | 'batch'>): string {
  return `${s.batch?.index ?? 0}:${s.leg}`;
}

/** The legs of the transaction on show, in the order they slide in. A key
 *  from an earlier transaction is not among them, so the slide treats the
 *  next transaction's sending screen as a later page (from the right). */
export function legOrder(s: Pick<CeremonyState, 'batch'>): string[] {
  return LEG_ORDER.map((leg) => legKey({ leg, batch: s.batch }));
}

/** No message for this long, after enough of them: the device waits for a person. */
export const QUIET_MS = 1500;
/** Fewer messages than this and a pause is not yet the review (today's rule). */
export const REVIEW_AFTER_MESSAGES = 20;
/** The vault's name is asked a few messages in, on the apps that ask it first. */
export const NAME_AFTER_MESSAGES = 2;
/** ...and always before the first coin is read (the fixed part of
 *  `readEstimate`). A quiet this far in is the review, never the name: a
 *  name approved faster than `QUIET_MS` is never seen, and the review's quiet
 *  must not be mistaken for it. To confirm against a device log on an old app. */
export const NAME_BEFORE_MESSAGES = 50;
/** A message this recent ends the client's turn: the device is working again. */
export const RESUME_MS = 600;
/** A bar never claims to be done until it is. */
export const BAR_CAP = 0.97;
/** How often the phone looks at the quiet. */
export const TICK_MS = 400;
/** The BitBox's handover: the transfer is near instant, so a beat, then its turn. */
export const HANDOVER_MS = 1400;
/** The device's signed page stays on screen at least this long before the
 *  ceremony moves on, so the client sees the device answered. */
export const SIGNED_HOLD_MS = 900;

/** Bitcoin app versions that ask for a registered vault's name before the transaction. */
export const NAME_FIRST_FROM = '2.2.1';
/** The first version that no longer does. */
export const NAME_FIRST_UNTIL = '2.4.2';

/** Messages the read leg is expected to take: today's estimate, calibrated on
 *  the 7-coin spend of 2026-08-31 (560 messages). */
export function readEstimate(inputs: number, outputs: number): number {
  return 50 + 50 * Math.max(1, inputs) + 10 * Math.max(1, outputs);
}

/** Messages the signing leg is expected to take. */
export function signEstimate(inputs: number): number {
  return 10 + 15 * Math.max(1, inputs);
}

/** Does this Ledger app ask for the vault's name before the transaction? Only
 *  for a registered vault (a plain account has no name to ask about). */
export function asksNameFirst(appVersion: string | null | undefined, registered: boolean): boolean {
  if (!registered || !appVersion) return false;
  return versionAtLeast(appVersion, NAME_FIRST_FROM) && !versionAtLeast(appVersion, NAME_FIRST_UNTIL);
}

export interface CeremonyConfig {
  brand: SigningBrand;
  /** Ledger: messages expected on the way to the device. */
  readEstimate: number;
  /** Ledger: messages expected on the way back. */
  signEstimate: number;
  /** Ledger: this app asks for the vault's name first (`asksNameFirst`). */
  nameFirst: boolean;
  /** This transaction's place in a batch signed in one visit; unset for one. */
  batch?: BatchPosition | null;
}

export interface CeremonyState {
  leg: CeremonyLeg;
  /** The transaction's place in its batch, for the count on screen and the
   *  slide's key; null for the one transaction of a payment. */
  batch: BatchPosition | null;
  /** The bar's fill on the leg it belongs to, 0 to 1. Never backward within a leg. */
  fill: number;
  /** What the client's turn is about: the transaction, or (apps 2.2.1 to
   *  2.4.1) the vault's name first. */
  asks: 'review' | 'name';
  /** The send leg started over in the fuller form: screen 1 says so. */
  restarted: boolean;
  /** The signatures are back: the device drawing shows its signed page. */
  signed: boolean;
  /** The transaction is on its way to the network: the bar holds, and leaving
   *  can no longer stop it. */
  sending: boolean;
  /** How many times the client's turn has opened; the page tour starts again
   *  with each. */
  turn: number;
  /** The failure's own sentence, for `failed`. */
  failure: string | null;
  /** Bookkeeping of the signals (not drawn). */
  count: number;
  lastAt: number;
  baseline: number;
  signStart: number;
  nameAsked: boolean;
}

export type CeremonySignal =
  /** The Ledger exchanged another message; `count` is the running total. */
  | { type: 'messages'; count: number; at: number }
  /** The clock: time to look at the quiet. */
  | { type: 'tick'; at: number }
  /** The quick form failed; the whole transaction goes again. */
  | { type: 'restart' }
  /** The BitBox's beat is over: its turn. */
  | { type: 'handedOver' }
  /** The device's signatures are back. */
  | { type: 'signed' }
  /** The finished transaction is being broadcast. */
  | { type: 'sending' }
  /** The client said no on the device. */
  | { type: 'declined' }
  | { type: 'failed'; message: string };

export function startCeremony(at: number, batch: BatchPosition | null = null): CeremonyState {
  return {
    leg: 'send',
    batch,
    fill: 0,
    asks: 'review',
    restarted: false,
    signed: false,
    sending: false,
    turn: 0,
    failure: null,
    count: 0,
    lastAt: at,
    baseline: 0,
    signStart: 0,
    nameAsked: false,
  };
}

const ended = (s: CeremonyState): boolean => s.leg === 'declined' || s.leg === 'failed';

const capped = (done: number, expected: number): number =>
  Math.max(0, Math.min(expected > 0 ? done / expected : 0, BAR_CAP));

/** One signal in, the next state out. Unknown or late signals leave it be. */
export function advanceCeremony(s: CeremonyState, signal: CeremonySignal, cfg: CeremonyConfig): CeremonyState {
  if (ended(s)) return s;
  switch (signal.type) {
    case 'messages': {
      const next = { ...s, count: signal.count, lastAt: signal.at };
      if (s.leg === 'send') next.fill = Math.max(s.fill, capped(signal.count - s.baseline, cfg.readEstimate));
      else if (s.leg === 'return' && !s.signed)
        next.fill = Math.max(s.fill, capped(signal.count - s.signStart, cfg.signEstimate));
      return next;
    }
    case 'tick': {
      if (cfg.brand !== 'ledger') return s;
      const quiet = signal.at - s.lastAt > QUIET_MS;
      const sent = s.count - s.baseline;
      if (s.leg === 'send' && quiet) {
        if (cfg.nameFirst && !s.nameAsked && sent >= NAME_AFTER_MESSAGES && sent < NAME_BEFORE_MESSAGES) {
          return { ...s, leg: 'approve', asks: 'name', nameAsked: true, turn: s.turn + 1 };
        }
        // The review comes after the name: a name missed (approved inside the
        // quiet window) can never come back later.
        if (sent > REVIEW_AFTER_MESSAGES) return { ...s, leg: 'approve', asks: 'review', nameAsked: true, turn: s.turn + 1 };
        return s;
      }
      if (s.leg === 'approve' && signal.at - s.lastAt < RESUME_MS) {
        // The name was approved: the transaction itself is still on its way,
        // and the bar picks up where it stopped.
        if (s.asks === 'name') return { ...s, leg: 'send', asks: 'review' };
        return { ...s, leg: 'return', fill: 0, signStart: s.count };
      }
      return s;
    }
    case 'restart':
      // Said on screen (`restarted`), so the bar may start from nothing.
      return {
        ...s,
        leg: 'send',
        fill: 0,
        asks: 'review',
        restarted: true,
        signed: false,
        baseline: s.count,
        nameAsked: false,
      };
    case 'handedOver':
      return s.leg === 'send' ? { ...s, leg: 'approve', asks: 'review', turn: s.turn + 1 } : s;
    case 'signed':
      // Whatever the quiet said, the signatures are here: the way back, held
      // near its end until the network answers.
      return {
        ...s,
        leg: 'return',
        signed: true,
        fill: s.leg === 'return' ? Math.max(s.fill, BAR_CAP) : BAR_CAP,
        signStart: s.leg === 'return' ? s.signStart : s.count,
      };
    case 'sending':
      return { ...s, sending: true };
    case 'declined':
      return { ...s, leg: 'declined', sending: false };
    case 'failed':
      return { ...s, leg: 'failed', sending: false, failure: signal.message };
    default:
      return s;
  }
}

/**
 * Does the screen need drawing again? The clock ticks every 400 ms and the
 * Ledger sends a message every ~84 ms; only what the client can see counts,
 * and the bar only in whole percent.
 */
export function ceremonyViewChanged(a: CeremonyState | null, b: CeremonyState | null): boolean {
  if (a == null || b == null) return a !== b;
  return (
    a.leg !== b.leg ||
    a.batch?.index !== b.batch?.index ||
    a.batch?.count !== b.batch?.count ||
    a.asks !== b.asks ||
    a.restarted !== b.restarted ||
    a.signed !== b.signed ||
    a.sending !== b.sending ||
    a.turn !== b.turn ||
    a.failure !== b.failure ||
    Math.round(a.fill * 100) !== Math.round(b.fill * 100)
  );
}

/** Which signal a failure is: the decline is exact, everything else failed. */
export function failureSignal(e: unknown): CeremonySignal {
  const message = String((e as Error)?.message ?? e ?? '');
  // A Ledger "no" (6985/5501, mapped once in bitcoin/ledger/errors.ts), and
  // the BitBox's own UserAbort ("bitbox error: aborted by the user").
  if (message === DECLINED_ON_LEDGER || /aborted by the user/i.test(message)) return { type: 'declined' };
  return { type: 'failed', message };
}

/**
 * What runs along the path between the drawn phone and the device. A
 * Ledger's two legs are bars; the BitBox hands over in an instant, so its
 * legs are one pulse each way and it never shows a bar (decided 2026-10-03: "the
 * device sends and receives the TX instantly"). The client's turn is the
 * chevrons, never a bar, on every device.
 */
export type PathKind = 'bar' | 'pulse' | 'chevrons' | 'dead';

export function pathFor(brand: SigningBrand, leg: CeremonyLeg): { kind: PathKind; towardPhone: boolean } {
  switch (leg) {
    case 'send':
      return { kind: brand === 'ledger' ? 'bar' : 'pulse', towardPhone: false };
    case 'return':
      return { kind: brand === 'ledger' ? 'bar' : 'pulse', towardPhone: true };
    case 'approve':
      return { kind: 'chevrons', towardPhone: false };
    default:
      return { kind: 'dead', towardPhone: false };
  }
}

/** Is the ceremony on screen's foot Back usable? Not once the transaction is
 *  on its way: leaving could no longer stop it. Never on the client's turn,
 *  where the device is the only control (the design has no phone button). */
export function backShown(s: CeremonyState): 'live' | 'held' | 'none' {
  if (s.leg === 'approve' || s.leg === 'declined' || s.leg === 'failed') return 'none';
  return s.sending ? 'held' : 'live';
}

/**
 * The ceremony's feed: the one place the signals land while a device signs,
 * read by the drawn screens through `subscribe`. The signing screen holds it,
 * so a message every 84 ms redraws the courier alone, never the whole
 * ceremony screen, and it is told only when something visible changed.
 */
export interface CeremonyFeed {
  get(): CeremonyState | null;
  start(cfg: CeremonyConfig, at: number): void;
  push(signal: CeremonySignal): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function ceremonyFeed(): CeremonyFeed {
  let state: CeremonyState | null = null;
  let cfg: CeremonyConfig | null = null;
  const listeners = new Set<() => void>();
  const set = (next: CeremonyState | null) => {
    const changed = ceremonyViewChanged(state, next);
    state = next;
    if (changed) listeners.forEach((l) => l());
  };
  return {
    get: () => state,
    start(c, at) {
      cfg = c;
      // A fresh object even when the last run ended on the same leg, so the
      // screen redraws for the new attempt.
      state = null;
      set(startCeremony(at, c.batch ?? null));
    },
    push(signal) {
      if (state == null || cfg == null) return;
      set(advanceCeremony(state, signal, cfg));
    },
    reset() {
      cfg = null;
      set(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
