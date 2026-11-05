/**
 * An amount is always fully readable (decided 2026-10-31 after a phone test:
 * the cancel dialog read "Comes back to this vault" beside "0.00005 B…"). A
 * row holding a label and a figure is `FactRow`, no screen limits a figure to
 * a number of lines on a plain Text, where iOS cuts it at the tail, and none
 * holds one in a right-hand column that cannot shrink, which a card then clips
 * with no ellipsis at all. A short address counts as a figure: its last
 * characters are the ones a client compares.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sources(path);
    return entry.endsWith('.tsx') ? [path] : [];
  });
}

/** The file with its comments removed: the rule is about code. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const screen = (rel: string): string => code(join(UI, rel));

/** What a figure looks like inside a Text, as the screens write one. */
const FIGURE =
  /format(Amount|Sats|Btc|Fiat|Usd|SignedAmount|SignedSats|CardAmount|Money|FiatValue)\(|amountText|money\(|moneySub|\bamount\(|\bfmtFiat\(|\bshortBtc\(|\bmain\b|\.value\b|\{value\}|\.toFixed\(|\bBTC\b|\bsats\b|\.slice\(0, \d+\)\}…/;

/** A figure in a space it cannot outgrow, each with the reason it cannot. */
const ALLOWED: ReadonlyArray<[file: string, figure: string]> = [
  // The chart's price, alone across a landscape screen.
  ['components/ExpandedChart.tsx', 'formatFiatValue(shownValue, currency)'],
  // The money line under the balance, narrower than the balance above it, and
  // in the layout at larger text.
  ['screens/VirtualVaultsListScreen.tsx', 'formatFiat(sats, rate, settings.fiat)'],
];

/** A right-hand column that cannot shrink, beside one that gives way for it. */
const GIVES_WAY: ReadonlyArray<[file: string, column: string]> = [
  ['components/FeeSheet.tsx', 'amounts'],
  ['screens/SubscriptionsScreen.tsx', 'cardRight'],
  ['screens/WalletListScreen.tsx', 'cardRight'],
];

/** The styles in a file that set a column at the right and let nothing shrink it. */
function fixedColumns(source: string): string[] {
  return [...source.matchAll(/(\w+): \{([^{}]*alignItems: 'flex-end'[^{}]*)\}/g)]
    .filter((m) => !/flexShrink|flex:|maxWidth/.test(m[2]))
    .map((m) => m[1]);
}

describe('an amount', () => {
  it('is never held to a number of lines on a plain Text', () => {
    const offenders = sources(UI).flatMap((path) => {
      const rel = path.slice(UI.length + 1);
      return [...code(path).matchAll(/<Text\b[^>]*numberOfLines=\{\d\}[^>]*>([\s\S]*?)<\/Text>/g)]
        .map((m) => m[1].replace(/\s+/g, ' ').trim())
        .filter((inner) => FIGURE.test(inner))
        .filter((inner) => !ALLOWED.some(([file, figure]) => file === rel && inner.includes(figure)))
        .map((inner) => `${rel}: ${inner}`);
    });
    expect(offenders).toEqual([]);
  });

  it('never sits in a right-hand column that cannot shrink', () => {
    const offenders = sources(UI).flatMap((path) => {
      const rel = path.slice(UI.length + 1);
      const source = code(path);
      return fixedColumns(source)
        .filter((column) => !GIVES_WAY.some(([file, name]) => file === rel && name === column))
        .filter((column) =>
          [...source.matchAll(new RegExp(`<View style=\\{\\[?styles\\.${column}\\b[^>]*>([\\s\\S]*?)</View>`, 'g'))].some((m) => FIGURE.test(m[1])),
        )
        .map((column) => `${rel}: ${column}`);
    });
    expect(offenders).toEqual([]);
  });

  it('on Send\'s Confirm card is a FactRow, the address with it', () => {
    const page = screen('screens/SendScreen.tsx');
    const step = page.slice(page.indexOf('{step === 3 && ('));
    const card = step.slice(0, step.indexOf('<PageFooter>'));
    expect(card).toMatch(/<FactRow label=\{isRefresh \? 'Refreshing' : 'Sending'\} \{\.\.\.sendingFact\(\)\}/);
    expect(card).toMatch(/<FactRow\s+label="To"\s+value=\{`\$\{address\.slice\(0, 12\)\}…\$\{address\.slice\(-6\)\}`\}/);
    expect(card).toMatch(/<FactRow\s+label="Network fee"/);
    expect(card).toMatch(/<FactRow\s+label=\{row\.label\}/);
    // What is left beside a label there is words: the refresh's own "To", and
    // the note.
    expect(card.match(/styles\.infoRow/g)).toHaveLength(2);
    expect(card.match(/styles\.infoFact/g)).toHaveLength(4);
  });

  it('in the cancel dialog is a FactRow', () => {
    const page = screen('screens/TxDetailScreen.tsx');
    const dialog = page.slice(page.indexOf('title="Cancel this payment?"'));
    expect(dialog.slice(0, dialog.indexOf('</AppDialog>'))).toMatch(/<FactRow key=\{f\.label\} label=\{f\.label\} value=\{f\.value\} \/>/);
  });

  it('on the transaction page is a FactRow, with no row of its own beside it', () => {
    const page = screen('screens/TxDetailScreen.tsx');
    expect(page).toMatch(/<FactRow label="Network fee"/);
    expect(page).toMatch(/function AdvRow[\s\S]*?<FactRow label=\{label\} value=\{value\} \/>/);
    for (const old of ['DetailRow', 'styles.row,', 'styles.rowValue', 'styles.rowMono']) expect(page).not.toContain(old);
  });

  it('on every receipt, failed coin and device comparison is a FactRow', () => {
    const page = screen('components/SentPage.tsx');
    expect(page).toMatch(/<FactRow label=\{r\.label\} value=\{r\.value\} mono=\{r\.mono\} \/>/);
    expect(page).not.toContain('styles.rowValue');
  });

  it('beside "Equivalent value" on Send is a FactRow', () => {
    expect(screen('screens/SendScreen.tsx')).toMatch(/<FactRow\s+label="Equivalent value"/);
  });

  it('on the Rescue review step is a FactRow', () => {
    const page = screen('screens/RescueScreen.tsx');
    expect(page).toMatch(/<FactRow\s+label="Network fee"/);
    expect(page).toMatch(/<FactRow label="Arrives"/);
  });

  it('being signed stays on the row with its address', () => {
    expect(screen('screens/SignPsbtScreen.tsx')).toMatch(/<FactRow\s+key=\{i\}\s+label="To"\s+mono\s+value=\{[^\n]*formatAmount\(o\.amountSats, settings\.unit\)/);
  });
});

describe('the Speed up and fee sheet', () => {
  it('holds no amount to a number of lines', () => {
    expect(screen('components/FeeSheet.tsx')).not.toMatch(/numberOfLines/);
  });
});
