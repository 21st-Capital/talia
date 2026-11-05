/**
 * The courier's slide between the legs of a batch (the refresh session, decided
 * 2026-10-05), mounted on the app's own StepTransition with the keys the
 * courier uses (`legKey`, `legOrder`): within one transaction the legs slide
 * forward (and the name approved sends the client back from the left, as
 * before); the next transaction's sending screen slides in from the RIGHT,
 * a new page, although 'send' comes before 'return' in the legs' order. A
 * payment of one is keyed as before.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { resetStub, stub } from '../../__tests__/rnStub';
import { StepTransition } from '../StepTransition';
import { legKey, legOrder, startCeremony } from '../../hww/signingCeremony';
import type { BatchPosition, CeremonyLeg, CeremonyState } from '../../hww/signingCeremony';

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

/** The stub's window is 402 wide: a forward slide starts a page's width to the right. */
const WIDTH = 402;

type Renderer = TestRenderer.ReactTestRenderer;

const at = (leg: CeremonyLeg, batch: BatchPosition | null = null): CeremonyState => ({ ...startCeremony(0, batch), leg });

/** The courier's wrapper, exactly as SigningCourier keys it. */
const page = (s: CeremonyState): React.JSX.Element => (
  <StepTransition stepKey={legKey(s)} order={legOrder(s)}>
    <Text>{legKey(s)}</Text>
  </StepTransition>
);
function mount(s: CeremonyState): Renderer {
  let r!: Renderer;
  act(() => {
    r = TestRenderer.create(page(s));
  });
  return r;
}
const show = (r: Renderer, s: CeremonyState): void => {
  act(() => r.update(page(s)));
};
const started = () => stub.timings.filter((t) => t.started);

beforeEach(() => resetStub());

it('one transaction: the legs slide forward; the name approved sends the client back from the left', () => {
  const b = { index: 1, count: 3 };
  const r = mount(at('send', b));
  expect(started()).toHaveLength(0);
  show(r, at('approve', b));
  expect(stub.setValues).toEqual([WIDTH, 0]);
  // Bitcoin app 2.2.1 to 2.4.1: the name approved, the transaction still on its way.
  show(r, at('send', b));
  expect(stub.setValues.slice(-2)).toEqual([-WIDTH, 0]);
  show(r, at('approve', b));
  show(r, at('return', b));
  expect(stub.setValues.slice(-2)).toEqual([WIDTH, 0]);
  expect(started()).toHaveLength(8);
});

it('the next transaction of the pass slides in from the right, a new page, although its first leg comes before the last one in the legs’ order', () => {
  const r = mount(at('return', { index: 1, count: 3 }));
  show(r, at('send', { index: 2, count: 3 }));
  expect(stub.setValues).toEqual([WIDTH, 0]);
  expect(started()).toHaveLength(2);
  for (const t of started()) expect(t.config).toMatchObject({ useNativeDriver: true });
  // And its own legs then slide forward as the first one's did.
  show(r, at('approve', { index: 2, count: 3 }));
  expect(stub.setValues.slice(-2)).toEqual([WIDTH, 0]);
  show(r, at('return', { index: 2, count: 3 }));
  show(r, at('send', { index: 3, count: 3 }));
  expect(stub.setValues.slice(-2)).toEqual([WIDTH, 0]);
  expect(r.root.findAllByType(Text).map((t) => t.props.children)).toEqual(['3:send']);
});

it('a payment of one keys as before: send, approve, return forward; the same leg swaps in place', () => {
  const r = mount(at('send'));
  show(r, at('approve'));
  expect(stub.setValues).toEqual([WIDTH, 0]);
  show(r, at('approve'));
  expect(started()).toHaveLength(2);
  show(r, at('return'));
  expect(stub.setValues.slice(-2)).toEqual([WIDTH, 0]);
  expect(legKey(at('return'))).toBe('0:return');
});
