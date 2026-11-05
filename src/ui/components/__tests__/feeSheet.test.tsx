/**
 * The fee sheet at any text size (decided 2026-10-31 after a phone test of the
 * cancel dialog's row): at the accessibility sizes the amounts took the whole
 * row beside the tier, so "Medium" went to nothing, the radio landed on the
 * text and the first tier sat past the top of the screen with no way to it.
 * Mounted with the real theme and FitText; the sheet's shell is a plain host.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockScreen = { fontScale: 1 };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => mockScreen,
}));
jest.mock('../AppModal', () => ({ AppModal: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../DraggableSheet', () => {
  const R = require('react');
  return {
    DraggableSheet: ({ children, style }: { children: React.ReactNode; style: unknown }) =>
      R.createElement('DraggableSheet', { style }, children),
  };
});
jest.mock('../RadioMark', () => ({ RadioMark: () => null }));
jest.mock('../../hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));

import { FeeSheet } from '../FeeSheet';
import { theme } from '../../theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const row = (key: string, label: string, main: string, sub: string) => ({
  key,
  label,
  meta: 'about 30 minutes · 8.1 sat/vB',
  main,
  sub,
  on: false,
  onPress: () => undefined,
});
const ROWS = [row('high', 'High', '+ 0.00001234 BTC', '+ 1,234 sats'), row('slow', 'Slow', '+ 12.45679001 BTC', '+ 1,245,679,001 sats')];
const custom = {
  value: '',
  onChangeText: () => undefined,
  placeholder: '2.4',
  unitMeta: 'sat/vB · at least 2.4',
  on: false,
  main: '+ 0.00000500 BTC',
  sub: '+ 500 sats',
  bad: 'Too low',
};

function mount() {
  let page!: TestRenderer.ReactTestRenderer;
  act(() => {
    page = TestRenderer.create(
      <FeeSheet visible onClose={() => undefined} title="Speed up" rows={ROWS} custom={custom}>
        <PrimaryButton />
      </FeeSheet>,
    );
  });
  return page;
}
const PrimaryButton = () => React.createElement('PrimaryButton');

const hosts = (root: TestRenderer.ReactTestInstance, type: string) => root.findAll((n) => (n.type as unknown) === type);
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean));
const textOf = (n: TestRenderer.ReactTestInstance): string => [n.props.children].flat().join('');
const line = (page: TestRenderer.ReactTestRenderer, words: string) => {
  const found = hosts(page.root, 'Text').filter((n) => textOf(n) === words);
  expect(found).toHaveLength(1);
  return found[0];
};
/** The block holding a tier's words and its amounts. */
const figures = (page: TestRenderer.ReactTestRenderer, words: string) => {
  let n = line(page, words);
  while (flat(n.props.style).minWidth !== 0 || flat(n.props.style).flexDirection == null) n = n.parent as TestRenderer.ReactTestInstance;
  return flat(n.props.style);
};

beforeEach(() => {
  mockScreen.fontScale = 1;
});

describe('the fee sheet', () => {
  it.each([[1], [1.35]])('keeps its words and amounts side by side at text size %s, as designed', (fontScale) => {
    mockScreen.fontScale = fontScale;
    const page = mount();
    expect(figures(page, 'Slow').flexDirection).toBe('row');
    expect(line(page, '+ 12.45679001 BTC').props.adjustsFontSizeToFit).toBeUndefined();
    expect(hosts(page.root, 'ScrollView')).toHaveLength(0);
  });

  describe.each([[1.64], [3.12]])('at the accessibility text size %s', (fontScale) => {
    beforeEach(() => {
      mockScreen.fontScale = fontScale;
    });

    it('stacks the words over the amounts, so the tier keeps its name', () => {
      const page = mount();
      expect(figures(page, 'Slow').flexDirection).toBe('column');
      // flex 1 is a height of nothing in a column of no set height.
      const words = line(page, 'Slow').parent as TestRenderer.ReactTestInstance;
      expect(flat(words.props.style).flex).toBe(0);
    });

    it('draws every amount as one whole fitted line', () => {
      const page = mount();
      for (const amount of ['+ 0.00001234 BTC', '+ 12.45679001 BTC', '+ 1,245,679,001 sats', '+ 0.00000500 BTC']) {
        const shown = line(page, amount);
        expect(shown.props.adjustsFontSizeToFit).toBe(true);
        expect(shown.props.numberOfLines).toBe(1);
        expect(flat(shown.props.style).lineHeight).toBeUndefined();
      }
    });

    it('lets the rows scroll, inside the screen, with the button in view under them', () => {
      const page = mount();
      const [scroll] = hosts(page.root, 'ScrollView');
      expect(hosts(scroll, 'Text').map(textOf)).toEqual(expect.arrayContaining(['Speed up', 'High', 'Slow', 'Custom']));
      expect(flat(scroll.props.style).flexShrink).toBe(1);
      expect(flat(hosts(page.root, 'DraggableSheet')[0].props.style).maxHeight).toBe('94%');
      expect(hosts(scroll, 'PrimaryButton')).toHaveLength(0);
      expect(hosts(page.root, 'PrimaryButton')).toHaveLength(1);
    });

    it('still says why a custom rate cannot be used', () => {
      expect(line(mount(), 'Too low').props.style).toBeTruthy();
    });
  });

  it('keeps the sheet\'s own type at every size', () => {
    mockScreen.fontScale = 1.64;
    expect(flat(line(mount(), '+ 12.45679001 BTC').props.style).fontSize).toBe(theme.typography.heading.fontSize);
  });
});
