/**
 * The slide between the device's steps (decided 2026-10-05: "swipe the screen to
 * another page and show the Open App prompt on the device"), mounted: a new
 * page slides in on the app's own slide (native driver), from the right for
 * a later one and from the left for an earlier one (the device asking for
 * its PIN again); the same page, or a page with no step of its own (a line
 * while the key is read, the pairing code), swaps in place and slides
 * nothing; a fresh mount is settled, so the unlock page carried from the
 * search into the connection never slides. The job is keyed by WHICH job, so
 * the address check after a registration on the same device slides in too,
 * although both are "3." (decided 2026-10-05).
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { resetStub, stub } from '../../__tests__/rnStub';
import { TurnSlide } from '../TurnSlide';
import { STEP_SLIDE_MS } from '../StepTransition';
import { turnStep } from '../../hww/deviceSteps';
import type { DeviceAsk } from '../../hww/deviceTurns';
import type { DeviceDrawing } from '../../hww/signingDevice';

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  // react-test-renderer says it is deprecated; everything else is shown.
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

/** The stub's window is 402 wide: a forward slide starts a page's width to the right. */
const WIDTH = 402;

type Renderer = TestRenderer.ReactTestRenderer;

/** A flow on one device: its pages are the asks, their steps the plan's, as the flows pass them. */
function flow(d: DeviceDrawing) {
  const page = (ask: DeviceAsk | null, name: string): React.JSX.Element => (
    <TurnSlide step={ask != null ? turnStep(d, ask) : null} ask={ask}>
      <Text>{name}</Text>
    </TurnSlide>
  );
  return {
    mount(ask: DeviceAsk | null, name: string): Renderer {
      let r!: Renderer;
      act(() => {
        r = TestRenderer.create(page(ask, name));
      });
      return r;
    },
    show(r: Renderer, ask: DeviceAsk | null, name: string): void {
      act(() => r.update(page(ask, name)));
    },
  };
}
const ledger = flow('gen5');
const bitbox = flow('nova');

/** The slides started so far: each is the two timings of one StepTransition slide. */
const started = () => stub.timings.filter((t) => t.started);
const shown = (r: Renderer) => r.root.findAllByType(Text).map((t) => t.props.children);

beforeEach(() => resetStub());

it('a fresh mount is settled: the page carried from the search into the connection never slides', () => {
  const r = ledger.mount('unlock', 'pin');
  expect(started()).toHaveLength(0);
  expect(stub.setValues).toEqual([]);
  expect(shown(r)).toEqual(['pin']);
});

it('the next step slides in from the right on the native driver, at the app’s own pace', () => {
  const r = ledger.mount('unlock', 'pin');
  ledger.show(r, 'open-app', 'open-app');
  const slides = started();
  expect(slides).toHaveLength(2);
  for (const t of slides) {
    expect(t.config).toMatchObject({ useNativeDriver: true, duration: STEP_SLIDE_MS });
  }
  // Off-screen to the right, invisible, before the first paint; then home.
  expect(stub.setValues).toEqual([WIDTH, 0]);
  expect(slides.map((t) => t.config.toValue)).toEqual([0, 1]);
  expect(shown(r)).toEqual(['open-app']);
});

it('the same step swaps in place; so does a page with no step of its own, which holds the step shown last', () => {
  const r = ledger.mount('unlock', 'pin');
  ledger.show(r, 'unlock', 'pin again');
  expect(started()).toHaveLength(0);
  // A line while the key is read, or the pairing code: no step, no slide.
  ledger.show(r, null, 'Reading which key this Ledger holds');
  expect(started()).toHaveLength(0);
  expect(shown(r)).toEqual(['Reading which key this Ledger holds']);
  // Back to the step shown last: still nothing to slide.
  ledger.show(r, 'unlock', 'pin');
  expect(started()).toHaveLength(0);
});

it('the job after a line slides in as step 3; a device asking for its PIN again slides back from the left', () => {
  const r = ledger.mount('unlock', 'pin');
  ledger.show(r, 'open-app', 'open-app');
  ledger.show(r, null, 'Reading which key this Ledger holds');
  expect(started()).toHaveLength(2);
  ledger.show(r, 'register', 'register');
  expect(started()).toHaveLength(4);
  expect(stub.setValues).toEqual([WIDTH, 0, WIDTH, 0]);
  // Locked again mid-way: an earlier step comes in from the left.
  ledger.show(r, 'unlock', 'pin');
  expect(started()).toHaveLength(6);
  expect(stub.setValues.slice(-2)).toEqual([-WIDTH, 0]);
  expect(shown(r)).toEqual(['pin']);
});

it('two jobs on one device: the address check after the registration slides in from the right, although both are "3." (the BitBox on a vault it has not registered)', () => {
  // The BitBox's plan: its side while the search runs, its password once found.
  const r = bitbox.mount('side', 'side');
  bitbox.show(r, 'unlock', 'password');
  expect(started()).toHaveLength(2);
  // registerVault: a line, then the vault shown for approval.
  bitbox.show(r, null, 'Checking the device');
  expect(started()).toHaveLength(2);
  bitbox.show(r, 'register', 'register');
  expect(started()).toHaveLength(4);
  // The address check right after the approval: a new page, not a title
  // swapped under the same number.
  bitbox.show(r, 'address', 'address');
  expect(started()).toHaveLength(6);
  expect(stub.setValues.slice(-2)).toEqual([WIDTH, 0]);
  expect(shown(r)).toEqual(['address']);
  // The same job asked again swaps in place, as every same page does.
  bitbox.show(r, 'address', 'address again');
  expect(started()).toHaveLength(6);
  // And the password asked again after it still comes back from the left.
  bitbox.show(r, 'unlock', 'password');
  expect(started()).toHaveLength(8);
  expect(stub.setValues.slice(-2)).toEqual([-WIDTH, 0]);
});

it('the same two jobs on a Ledger slide the same way: one slide, forward', () => {
  const r = ledger.mount('unlock', 'pin');
  ledger.show(r, 'open-app', 'open-app');
  ledger.show(r, 'register', 'register');
  expect(started()).toHaveLength(4);
  ledger.show(r, 'address', 'address');
  expect(started()).toHaveLength(6);
  expect(stub.setValues.slice(-2)).toEqual([WIDTH, 0]);
});

it('a page with no step before any step slides nothing and counts as the first', () => {
  const r = ledger.mount(null, 'Looking');
  expect(started()).toHaveLength(0);
  ledger.show(r, 'unlock', 'pin');
  expect(started()).toHaveLength(0);
  ledger.show(r, 'open-app', 'open-app');
  expect(started()).toHaveLength(2);
});
