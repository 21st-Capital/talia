/**
 * A label and its value: the value is never cut (decided 2026-10-31 after a
 * phone test: the cancel dialog read "Comes back to this vault" beside
 * "0.00005 B…"). Mounted with the real theme and the real FitText. Whether iOS
 * lays it out so is its own to prove: this pins what is asked of it.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockScreen = { fontScale: 1 };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  useWindowDimensions: () => mockScreen,
}));

import { FactRow } from '../FactRow';
import { FACT_LABEL_SHARE } from '../ledgerRowLayout';
import { theme } from '../../theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

function mount(element: React.ReactElement) {
  let page!: TestRenderer.ReactTestRenderer;
  act(() => {
    page = TestRenderer.create(element);
  });
  const texts = page.root.findAll((n) => (n.type as unknown) === 'Text');
  const [label, value, sub] = texts;
  const row = page.root.findAll((n) => (n.type as unknown) === 'View')[0];
  const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean));
  return {
    label,
    value,
    sub,
    labelStyle: flat(label.props.style),
    valueStyle: flat(value.props.style),
    subStyle: flat(sub?.props.style),
    rowStyle: flat(row.props.style),
  };
}

beforeEach(() => {
  mockScreen.fontScale = 1;
});

describe('a fact', () => {
  const amount = <FactRow label="Comes back to this vault" value="0.00005 BTC" />;

  it('shows the whole value, shrinking it rather than cutting it', () => {
    const { value } = mount(amount);
    expect(value.props.children).toBe('0.00005 BTC');
    expect(value.props.adjustsFontSizeToFit).toBe(true);
    expect(value.props.numberOfLines).toBe(1);
    expect(value.props.ellipsizeMode).toBeUndefined();
  });

  it('moves the value under the label, still at the right, when both do not fit', () => {
    const { labelStyle, valueStyle, rowStyle } = mount(amount);
    expect(rowStyle.flexWrap).toBe('wrap');
    expect(labelStyle.maxWidth).toBe(FACT_LABEL_SHARE);
    expect(valueStyle.marginLeft).toBe('auto');
    expect(valueStyle.textAlign).toBe('right');
    expect(valueStyle.maxWidth).toBe('100%');
  });

  it('keeps a value too wide for the row inside the row', () => {
    expect(mount(amount).valueStyle.flexShrink).toBe(1);
  });

  it('never lets the line height a shrinking value cannot have reach it', () => {
    expect(mount(amount).valueStyle.lineHeight).toBeUndefined();
  });

  it.each([[1], [1.35]])('sits side by side at text size %s', (fontScale) => {
    mockScreen.fontScale = fontScale;
    expect(mount(amount).rowStyle.flexDirection).toBe('row');
  });

  it.each([[1.64], [3.12]])('stacks at the accessibility text size %s, each with the full width', (fontScale) => {
    mockScreen.fontScale = fontScale;
    const { labelStyle, valueStyle, rowStyle } = mount(amount);
    expect(rowStyle.flexDirection).toBe('column');
    expect(labelStyle.maxWidth).toBe('100%');
    expect(valueStyle.maxWidth).toBe('100%');
    expect(valueStyle.marginLeft).toBe(0);
    expect(valueStyle.textAlign).toBe('left');
  });

  it('draws an address in the mono face', () => {
    const { valueStyle } = mount(<FactRow label="To" value="bc1qxy2kgd…x0wlh" mono />);
    expect(valueStyle.fontFamily).toBe(theme.typography.mono.fontFamily);
    expect(valueStyle.fontSize).toBe(theme.typography.mono.fontSize);
  });

  it('draws a quiet line under the value, at its side of the row, that wraps', () => {
    const { sub, subStyle } = mount(<FactRow label="Network fee" value="$1.20 / 1,400 sats" sub="Medium priority · 3 sat/vB" />);
    expect(sub.props.children).toBe('Medium priority · 3 sat/vB');
    expect(sub.props.numberOfLines).toBeUndefined();
    expect(subStyle.width).toBe('100%');
    expect(subStyle.textAlign).toBe('right');
    expect(subStyle.color).toBe(theme.colors.slate);
  });

  it('keeps that line with the value when they stack', () => {
    mockScreen.fontScale = 3.12;
    expect(mount(<FactRow label="Sending" value="$50" sub="0.00050000 BTC" />).subStyle.textAlign).toBe('left');
  });

  it('draws no line under the value unless it is given one', () => {
    expect(mount(amount).sub).toBeUndefined();
  });

  it('takes the size a screen asks for, and stays fitted', () => {
    const { value, valueStyle } = mount(<FactRow label="Equivalent value" value="≈ 0.00005000 BTC" valueStyle={theme.typography.heading} />);
    expect(valueStyle.fontSize).toBe(theme.typography.heading.fontSize);
    expect(valueStyle.lineHeight).toBeUndefined();
    expect(value.props.adjustsFontSizeToFit).toBe(true);
  });
});
