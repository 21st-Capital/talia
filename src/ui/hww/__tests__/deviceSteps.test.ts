/**
 * The device's steps, numbered in the turn pages' titles (decided 2026-10-05):
 * the plan per brand, the job always third, a skipped step never renumbering
 * the next, and the one title form the turn pages and the courier share.
 */
import { ADDRESS_JOB, JOB_STEP, REGISTER_JOB, SIGN_JOB, STEP_ORDER, slideKey, stepTitle, turnStep } from '../deviceSteps';
import type { TurnStep } from '../deviceSteps';
import { turnWords } from '../deviceTurns';
import type { DeviceAsk } from '../deviceTurns';
import { courierWords, DEVICE_DRAWINGS } from '../signingDevice';
import type { DeviceDrawing, TourFacts } from '../signingDevice';
import { startCeremony } from '../signingCeremony';

const LEDGERS: DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX', 'slab'];
const ASKS: DeviceAsk[] = ['unlock', 'open-app', 'side', 'register', 'address'];
const FACTS: TourFacts = {
  brand: 'ledger',
  network: 'bitcoin',
  registeredName: 'Family vault',
  nameFirst: false,
  bitboxKind: null,
  outputs: [{ address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', amountSats: 1_250_000 }],
  feeSats: 1200,
  lockTime: null,
};

describe('the plan: two steps before the job, the job third, on every device', () => {
  it('every Ledger: the PIN first, the app second, the job third', () => {
    for (const d of LEDGERS) {
      expect({ d, pin: turnStep(d, 'unlock') }).toEqual({ d, pin: 1 });
      expect({ d, app: turnStep(d, 'open-app') }).toEqual({ d, app: 2 });
      expect({ d, register: turnStep(d, 'register') }).toEqual({ d, register: 3 });
      expect({ d, address: turnStep(d, 'address') }).toEqual({ d, address: 3 });
    }
  });

  it('the BitBox: the side first, the password second, the job third', () => {
    expect(turnStep('nova', 'side')).toBe(1);
    expect(turnStep('nova', 'unlock')).toBe(2);
    expect(turnStep('nova', 'register')).toBe(3);
    expect(turnStep('nova', 'address')).toBe(3);
  });

  it('the job is the same number everywhere: the courier’s signing turn included', () => {
    expect(JOB_STEP).toBe(3);
    for (const d of DEVICE_DRAWINGS) {
      expect(turnStep(d, 'register')).toBe(JOB_STEP);
      expect(turnStep(d, 'address')).toBe(JOB_STEP);
      const f = { ...FACTS, brand: d === 'nova' ? ('bitbox' as const) : ('ledger' as const) };
      expect(courierWords(d, 'Key', { ...startCeremony(0), leg: 'approve' }, f).title).toBe(stepTitle(JOB_STEP, SIGN_JOB));
    }
  });

  it('a step the device skips keeps the plan’s numbers: a step is a property of the ask, never of the path', () => {
    // The same ask, the same number, whatever was asked before it: a device
    // already unlocked goes straight to "2.", one with its app open to "3.".
    for (const d of DEVICE_DRAWINGS) {
      for (const ask of ASKS) {
        const first = turnStep(d, ask);
        for (const before of ASKS) {
          turnStep(d, before);
          expect({ d, ask, before, step: turnStep(d, ask) }).toEqual({ d, ask, before, step: first });
        }
      }
    }
    // And the title carries that same number.
    for (const d of DEVICE_DRAWINGS) {
      for (const ask of ASKS) {
        const w = turnWords(d, ask, 'bitcoin');
        expect({ d, ask, step: w.step }).toEqual({ d, ask, step: turnStep(d, ask) });
        expect(w.title.startsWith(`${w.step}. `)).toBe(true);
      }
    }
  });

  it('the slide’s order is the plan’s, the job keyed by WHICH job, so a second job on the same device slides in', () => {
    expect(STEP_ORDER).toEqual(['1', '2', '3:register', '3:address']);
    // Every page of every device has a key, and it is in the order: the two
    // steps before the job by their number alone, the job by its name.
    for (const d of DEVICE_DRAWINGS) {
      for (const ask of ASKS) {
        const step = turnStep(d, ask);
        const key = slideKey(step, ask);
        expect({ d, ask, key }).toEqual({ d, ask, key: step === JOB_STEP ? `3:${ask}` : String(step) });
        expect({ d, ask, ordered: STEP_ORDER.includes(key) }).toEqual({ d, ask, ordered: true });
      }
    }
    // The same "3.", two keys: the address check after the registration
    // slides in from the right (decided 2026-10-05: the BitBox on a vault it
    // has not registered swapped its title in place).
    expect(slideKey(JOB_STEP, 'register')).not.toBe(slideKey(JOB_STEP, 'address'));
    expect(STEP_ORDER.indexOf(slideKey(JOB_STEP, 'register'))).toBeLessThan(STEP_ORDER.indexOf(slideKey(JOB_STEP, 'address')));
    // A later step is a later key, whichever device asks it; an earlier one
    // (the PIN again) comes back from the left.
    const steps: TurnStep[] = [1, 2];
    for (const s of steps) expect(STEP_ORDER.indexOf(String(s))).toBe(s - 1);
    expect(STEP_ORDER.indexOf(slideKey(1, 'unlock'))).toBeLessThan(STEP_ORDER.indexOf(slideKey(2, 'open-app')));
    expect(STEP_ORDER.indexOf(slideKey(2, 'unlock'))).toBeLessThan(STEP_ORDER.indexOf(slideKey(JOB_STEP, 'register')));
    // Before the job the key is the number: the BitBox's side and the
    // Ledger's PIN are the same first page, and no key carries a count.
    expect(slideKey(1, 'side')).toBe(slideKey(1, 'unlock'));
    expect(slideKey(2, 'unlock')).toBe(slideKey(2, 'open-app'));
  });
});

describe('the title form', () => {
  it('the form decided on: the number, a full stop, the step; no em dash; the job words are one set', () => {
    expect(stepTitle(1, 'Enter your PIN on the Ledger')).toBe('1. Enter your PIN on the Ledger');
    expect(stepTitle(2, 'Open the Bitcoin app')).toBe('2. Open the Bitcoin app');
    expect(stepTitle(3, ADDRESS_JOB)).toBe('3. Verify the address');
    expect(stepTitle(3, REGISTER_JOB)).toBe('3. Register the vault');
    expect(stepTitle(3, SIGN_JOB)).toBe('3. Sign the transaction');
    for (const s of [REGISTER_JOB, ADDRESS_JOB, SIGN_JOB]) {
      expect(s).not.toMatch(/[—–]/);
      // Short, and never a code word.
      expect(s.split(' ').length).toBeLessThanOrEqual(3);
      expect(s).not.toMatch(/\b(PSBT|descriptor|policy)\b/);
    }
  });
});
