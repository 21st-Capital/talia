/**
 * The device's steps, numbered (decided 2026-10-05: "its not always clear that
 * the user needs to now press something again on the ledger ... I suggest to
 * also add steps at the header: 1. Insert your pin on your ledger (instead
 * of 'your turn on the ledger') 2. Open the bitcoin app 3. verify the address
 * or register the vault etc...", then "do the same to the bitbox screens").
 * Pure: the plan each brand's turn pages follow, and the one form a numbered
 * title takes, for the turn pages (`deviceTurns.ts`) and the courier's
 * signing screens (`signingDevice.ts`) alike. Tested in
 * `__tests__/deviceSteps.test.ts`.
 *
 * The plan is the brand's two steps before the job, then the job:
 *
 *   Ledger   1. the PIN      2. the Bitcoin app   3. the job
 *   BitBox   1. the side     2. the password      3. the job
 *
 * where the job is what the flow asks of the device: the vault to register,
 * the address to verify, the transaction to sign. A flow whose job asks
 * nothing on the device (reading a key) has the first two steps alone and
 * never shows a 3. A step's number is a property of the ASK, never of the
 * path taken to it: a device already unlocked, or with its app already open,
 * skips a step and the next keeps its number (the decided "2." is the app whether
 * or not a PIN was typed first), so nothing ever renumbers mid-way.
 *
 * The slide between the pages (`TurnSlide`) is keyed by `slideKey`: the
 * step's number, and for the job WHICH job, because two jobs can follow each
 * other on one device (the vault registered, then its address checked, both
 * "3."; decided 2026-10-05) and the second must slide in like any new page,
 * or the title would change in place right after an approval on the device,
 * the very moment a phone test found "not fully visible".
 */
import type { DeviceDrawing } from './signingDevice';
import type { DeviceAsk } from './deviceTurns';

/** A step of the plan: the two before the job, and the job. */
export type TurnStep = 1 | 2 | 3;

/** The job is always the third step, on every device and in every flow. */
export const JOB_STEP: TurnStep = 3;

/** The pages as the slide orders them (`slideKey`): a later one slides in
 *  from the right, an earlier one (the device asking for its PIN again) from
 *  the left. The job is two pages, the vault to register and then the address
 *  to verify, in the order the flows ask them. */
export const STEP_ORDER: readonly string[] = ['1', '2', `${JOB_STEP}:register`, `${JOB_STEP}:address`];

/** The slide's key for a page: its step, and for the job which job it is,
 *  so a second job on the same device slides in; never the path taken to it. */
export function slideKey(step: TurnStep, ask: DeviceAsk): string {
  return step === JOB_STEP ? `${JOB_STEP}:${ask}` : String(step);
}

/** The job's words, the same in the title of every flow that asks it. */
export const REGISTER_JOB = 'Register the vault';
export const ADDRESS_JOB = 'Verify the address';
export const SIGN_JOB = 'Sign the transaction';

/** Which step of the plan an ask is, on this drawing's brand. */
export function turnStep(d: DeviceDrawing, ask: DeviceAsk): TurnStep {
  if (ask === 'register' || ask === 'address') return JOB_STEP;
  // The BitBox: its side while the search runs, its password once found.
  if (d === 'nova') return ask === 'side' ? 1 : 2;
  // Every Ledger: its PIN, then the app to open.
  return ask === 'open-app' ? 2 : 1;
}

/** A numbered title, in the decided form: "1. Enter your PIN on the Ledger". */
export function stepTitle(step: TurnStep, text: string): string {
  return `${step}. ${text}`;
}
