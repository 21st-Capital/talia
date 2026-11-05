/**
 * One layout rule for both histories (decided 2026-10-22, from a client's
 * phone zoomed in: "Bought" broke into "Bough / t", the date wrapped, notes
 * were cut after a word). A vault's transactions and a portfolio's buys and
 * sells are drawn by `LedgerRowContent`, and neither screen lays out a row
 * of its own again: no fixed two-column row where the amount column takes
 * its width first and the title gets what is left.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
/** The file with its comments removed: the rule is about code. */
const code = (rel: string): string =>
  readFileSync(join(UI, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the history rows', () => {
  const portfolio = code('screens/ManualWalletScreen.tsx');
  const vault = code('screens/WalletDetailScreen.tsx');
  const row = code('components/LedgerRow.tsx');

  it('are drawn by the one shared layout on both pages', () => {
    expect(portfolio).toContain('<LedgerRowContent');
    expect(vault).toContain('<LedgerRowContent');
  });

  it('keep no layout of their own beside it', () => {
    for (const old of ['rowAmounts', 'rowMain', 'rowKind', 'rowDate', 'rowNote']) expect(portfolio).not.toContain(`styles.${old}`);
    for (const old of ['txAmounts', 'txBody', 'txLabel', 'txMeta', 'txNote']) expect(vault).not.toContain(`styles.${old}`);
  });

  it('let the figures move under the title rather than squeeze it', () => {
    expect(row).toMatch(/flexWrap: 'wrap'/);
    // Moved under or not, the amount and its money line stay at the right
    // edge (decided 2026-10-29: a waiting payment's amount started at the left).
    expect(row).toMatch(/right: \{ marginLeft: 'auto'/);
    expect(row).not.toMatch(/textAlign: 'left'|alignItems: 'flex-start' \}/);
    // The title pairs with the amount alone, so a long quiet line ("Waiting
    // for confirmation") never decides whether the amount fits beside it.
    expect(row).toMatch(/<Text style=\{\[styles\.left, styles\.title\]\}>\{title\}<\/Text>\s*<View style=\{styles\.right\}>\s*<FitText/);
    // The amount is one line that only shrinks when it is wider than the row.
    expect(row).toContain('<FitText');
    // The note gets a full line of its own, and two before it is cut.
    expect(row).toMatch(/numberOfLines=\{2\}/);
  });

  it("keep each history's own colours: a vault's note bright, a portfolio's date faint", () => {
    expect(vault).toMatch(/lineColor=\{theme\.colors\.slate\}\s+noteColor=\{theme\.colors\.offWhite\}/);
    expect(portfolio).toMatch(/lineColor=\{theme\.colors\.faint\}\s+noteColor=\{theme\.colors\.slate\}/);
  });
});

describe('the docked "as of" caption above both histories', () => {
  it('grows with the text size only as far as the fixed band under the buttons holds', () => {
    for (const page of [code('screens/ManualWalletScreen.tsx'), code('screens/WalletDetailScreen.tsx')]) {
      const caption = page.slice(page.indexOf('styles.morphCaption,'));
      expect(caption.slice(0, caption.indexOf('</Animated.Text>'))).toContain('maxFontSizeMultiplier={MORPH_CAPTION_MAX_SCALE}');
    }
  });
});
