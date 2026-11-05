/**
 * The drawn devices' screens hold what they print (decided 2026-10-03, on a
 * phone with a real Nano X, a Gen5 and a BitBox Nova):
 *
 *   1. "One of the bitbox screens has been cut off": the Nova's "Locktime on
 *      block:" page is three lines, every line on the screen, never wrapped
 *      by the phone;
 *   2. "the ledger nano X screens are overlapping on the arrows": the arrows
 *      sit at the very edges, and no line of any page comes near them;
 *   3. "The loading of the large screen ledgers is not rendering correctly":
 *      the touchscreen Ledgers' working mark is ONE corner bracket jumping
 *      clockwise round a small box, one corner at a time.
 *
 * The Nova's face is Menlo, whose every glyph is the same width, so its
 * lines are measured here exactly. The Nano X sets the system face, which no
 * test in Node can measure: its widths below were measured with CoreText at
 * the sizes the drawing is set at on an iPhone 17 Pro (OLED 77.7 pt wide) and
 * an iPhone SE (69.2 pt), the larger of the two kept. Change a size or a box
 * and the table no longer applies: measure again.
 */
import {
  CORNER_MS,
  EINK_PAGE,
  EINK_WORKING,
  LONG_VALUE_CHARS,
  MENLO_ADVANCE,
  NANO_PIN,
  NANO_PIN_TICK,
  NANO_X_ARROW,
  NANO_X_ARROW_GAP,
  NANO_X_PLAIN_INSET,
  NANO_X_SCREEN,
  NANO_X_TEXT_INSET,
  NANO_X_TYPE,
  NOVA_BODY_INSET,
  NOVA_CONFIRM_MARK,
  NOVA_DONE_GLYPH,
  NOVA_HOLD_ARROW,
  NOVA_LINE_CHARS,
  NOVA_LOCK,
  NOVA_OUTPUT,
  NOVA_PASSWORD,
  NOVA_REGISTERED,
  NOVA_SCREEN,
  NOVA_SCROLL,
  NOVA_SCROLL_WINDOW,
  NOVA_SIDE,
  NOVA_SLOTS,
  NOVA_SLOT_HALF,
  NOVA_SPLASH,
  NOVA_TITLE_INSET,
  NOVA_TOP_BAR,
  NOVA_TYPE,
  WORKING_CORNERS,
  cornerPath,
  cornerShown,
  einkAddressRow,
  einkAnchors,
  einkPinBand,
  einkPinCells,
  einkUnit,
  menloWidth,
  nanoPinLayout,
  nanoXArrowColumns,
  nanoXLayout,
  novaEntry,
  novaFit,
  novaHoldArrows,
  novaRows,
  novaScrollTravel,
  novaScrollWidth,
  novaSlotRows,
  novaThumbTravel,
  novaTurnArrow,
  novaWrap,
} from '../deviceScreenLayout';
import type { NanoXPage, NovaPage, ScreenRow } from '../deviceScreenLayout';
import { reviewPages } from '../../hww/signingDevice';
import type { ReviewPage, TourFacts } from '../../hww/signingDevice';
import { registerFacts, registerPages } from '../../hww/vaultRegistration';
import { addressFacts, addressPages, nanoAddressPages } from '../../hww/addressCheck';
import { LIANA_TAPROOT, MULTISIG_2_OF_3 } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

/** The test 2-of-3 as the device holding its second key sees it; and a policy vault. */
const REG = registerFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, 'a1b2c3d4')!;
const REG_POLICY = registerFacts({ descriptor: LIANA_TAPROOT, label: 'Family vault', network: 'testnet' }, '73c5da0a')!;
/** Receive address 1 of a 2-of-3 test vault (62 characters), as the Nano X's font pages it (59 and 3). */
// A made-up test address: receive index 1 (testnet) of wsh(sortedmulti(2, ...)) over the
// filmed Nova key 4a290600, the filmed Nano X key abf931aa and the made-up key from
// BIP-32 test vector 1's seed (3442193e). Public test material, nobody's wallet.
const TEST_ADDRESS = 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5vy2';
const ADDR_CHUNKS = nanoAddressPages(TEST_ADDRESS);

const TO = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const TO_TEST = 'tb1qerzrlxcfu24davlur5sqmgzzgsal6wusda40er';
const TO_WSH = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
/** BIP-86's published first receive address ("abandon ... about", m/86'/0'/0'/0/0). */
const TO_TR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';

const BASE: TourFacts = {
  brand: 'bitbox',
  network: 'bitcoin',
  registeredName: 'Family vault',
  nameFirst: false,
  bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 },
  outputs: [{ address: TO, amountSats: 1_250_000 }],
  feeSats: 1200,
  lockTime: { lockTime: 921380, rbf: true },
};

/** Every combination a client can meet, at its worst: mainnet and testnet,
 *  the three BitBox vault kinds, six-digit block heights with and without
 *  RBF, a whole 21 BTC, an amount with every decimal, the largest amount
 *  there can be, a large fee, the longest name a BitBox stores. */
function worstFacts(brand: 'bitbox' | 'ledger'): TourFacts[] {
  const out: TourFacts[] = [];
  for (const network of ['bitcoin', 'testnet'] as const)
    for (const bitboxKind of [
      { kind: 'multisig', threshold: 2, keys: 3 },
      { kind: 'multisig', threshold: 11, keys: 15 },
      { kind: 'policy', keys: 3 },
      { kind: 'policy', keys: 1 },
      { kind: 'single' },
    ] as const)
      for (const lockTime of [
        { lockTime: 999999, rbf: true },
        { lockTime: 154916, rbf: false },
        { lockTime: 4_999_999, rbf: true },
      ])
        for (const amountSats of [2_100_000_000, 2_112_345_678, 1_179, 2_099_999_999_999_999])
          for (const registeredName of ['Family vault', 'A name of thirty characters ok', null])
            for (const address of [TO, TO_TEST, TO_WSH, TO_TR])
              out.push({
                ...BASE,
                brand,
                network,
                bitboxKind: brand === 'bitbox' ? bitboxKind : null,
                lockTime,
                registeredName,
                outputs: [{ address, amountSats }],
                feeSats: 1_234_567,
              });
  return out;
}

const novaPages = (): NovaPage[] => [
  ...worstFacts('bitbox').flatMap((f) => reviewPages('nova', f) as NovaPage[]),
  ...reviewPages('nova', { ...BASE, outputs: [], feeSats: 210 }).map((p) => p as NovaPage),
  { kind: 'done', ok: true },
  { kind: 'done', ok: false },
];

/** Rows that share the screen's height never overlap. */
function stacked(rows: ScreenRow[]): boolean {
  const sorted = [...rows].sort((a, b) => a.top - b.top);
  return sorted.every((r, i) => i === 0 || r.top >= sorted[i - 1].top + sorted[i - 1].lines * sorted[i - 1].lineHeight - 1e-9);
}

// ─── The Nova ────────────────────────────────────────────────────────────────

describe('the Nova: every line on its screen, as the device sets it', () => {
  it('Menlo is the same width for every glyph, so a line of twenty fits the body', () => {
    expect(MENLO_ADVANCE).toBeCloseTo(0.60205, 5);
    expect(NOVA_LINE_CHARS).toBe(20);
    expect(menloWidth('x'.repeat(NOVA_LINE_CHARS), NOVA_TYPE.size)).toBeLessThanOrEqual(NOVA_SCREEN.w - 2 * NOVA_BODY_INSET);
    expect(menloWidth('x'.repeat(NOVA_LINE_CHARS + 1), NOVA_TYPE.size)).toBeGreaterThan(NOVA_SCREEN.w - 2 * NOVA_BODY_INSET);
  });

  it('the device’s page: "Locktime on block:" on one line, three lines in all (photo nova-4)', () => {
    const page = reviewPages('nova', { ...BASE, lockTime: { lockTime: 154916, rbf: true } }).find((p) => p.kind === 'nova-text')!;
    const rows = novaRows(page as NovaPage);
    expect(rows.map((r) => r.text)).toEqual(['Locktime on block:', '154916', 'Transaction is RBF']);
    expect(rows.every((r) => r.size === NOVA_TYPE.size && r.lines === 1)).toBe(true);
    expect(rows[rows.length - 1].top + NOVA_TYPE.lineHeight).toBeLessThanOrEqual(NOVA_SCREEN.h);
  });

  it('a transaction that is not RBF breaks its longer line at a word, all four lines on the screen', () => {
    const rows = novaRows({ kind: 'nova-text', body: 'Locktime on block:\n999999\nTransaction is not RBF' });
    expect(rows.map((r) => r.text)).toEqual(['Locktime on block:', '999999', 'Transaction is not', 'RBF']);
    expect(rows[0].top).toBeGreaterThanOrEqual(NOVA_TOP_BAR);
    expect(rows[3].top + NOVA_TYPE.lineHeight).toBeLessThanOrEqual(NOVA_SCREEN.h);
  });

  it('wraps at the spaces, splits a word longer than a line, keeps every line break', () => {
    expect(novaWrap('BTC Testnet\npolicy with\n3 keys')).toEqual(['BTC Testnet', 'policy with', '3 keys']);
    expect(novaWrap('A name of thirty characters ok')).toEqual(['A name of thirty', 'characters ok']);
    expect(novaWrap('x'.repeat(25))).toEqual(['x'.repeat(20), 'x'.repeat(5)]);
    expect(novaWrap('2-of-3\nBTC Testnet multisig')).toEqual(['2-of-3', 'BTC Testnet multisig']);
  });

  it('an amount too long for a line is set smaller, never wrapped or cut', () => {
    expect(novaFit('21.12345678 BTC', 124)).toBe(NOVA_TYPE.size);
    const size = novaFit('20999999.99999999 TBTC', 124);
    expect(size).toBeLessThan(NOVA_TYPE.size);
    expect(menloWidth('20999999.99999999 TBTC', size)).toBeLessThanOrEqual(124);
  });

  it('every page, at its worst: each line fits its box, on the screen, clear of the × and the >', () => {
    const pages = novaPages();
    expect(pages.length).toBeGreaterThan(2000);
    for (const page of pages) {
      const rows = novaRows(page);
      for (const r of rows) {
        const box = NOVA_SCREEN.w - r.left - r.right;
        // An amount's address is the one row that may run off the screen,
        // from the left, never wrapped: the device scrolls it (decided 2026-10-05).
        if (r.clip) expect({ page, r, scroll: page.kind === 'nova-output' && r.align === 'left' && r.left === NOVA_SCROLL.left && r.top === NOVA_OUTPUT.address }).toEqual({ page, r, scroll: true });
        else expect({ page, r, fits: menloWidth(r.text, r.size) <= box + 1e-9 }).toEqual({ page, r, fits: true });
        expect({ page, r, onScreen: r.top >= 0 && r.top + r.lines * r.lineHeight <= NOVA_SCREEN.h }).toEqual({ page, r, onScreen: true });
        // Only a title sits in the top bar, between the × and the >.
        if (page.kind !== 'done' && r.top < NOVA_TOP_BAR) {
          expect({ page, r, clear: r.left >= NOVA_TITLE_INSET && r.right >= NOVA_TITLE_INSET }).toEqual({ page, r, clear: true });
        }
        expect(r.lines).toBe(1);
      }
      expect({ page, stacked: stacked(rows) }).toEqual({ page, stacked: true });
    }
  });

  it('the amount page (decided 2026-10-05): the amount centred and fitting, the WHOLE address as one scrolling line from the left under the arrow, the thumb under it, as the address check’s line', () => {
    const page = reviewPages('nova', BASE).find((p) => p.kind === 'nova-output') as NovaPage;
    const [amount, to] = novaRows(page);
    expect(amount).toMatchObject({ text: '0.0125 BTC', top: NOVA_OUTPUT.amount, align: 'center', lines: 1 });
    expect(menloWidth(amount.text, amount.size)).toBeLessThanOrEqual(NOVA_SCREEN.w - amount.left - amount.right);
    expect(to).toMatchObject({
      text: 'bc1q xy2k gdyg jrsq tzq2 n0yr f249 3p83 kkfj hx0w lh',
      top: NOVA_OUTPUT.address,
      left: NOVA_SCROLL.left,
      right: NOVA_BODY_INSET,
      align: 'left',
      clip: true,
      size: NOVA_TYPE.size,
      lines: 1,
    });
    // About seventeen characters before the edge, as on the address check; the rest runs off and is swiped into view.
    expect(Math.floor((NOVA_SCREEN.w - to.left - to.right) / (MENLO_ADVANCE * to.size))).toBe(17);
    expect(novaScrollTravel(to.text)).toBeGreaterThan(0);
    // The arrow between the two, the thumb under the line, all on the screen.
    const a = NOVA_OUTPUT.arrow;
    expect(amount.top + amount.lineHeight).toBeLessThanOrEqual(a.top);
    expect(a.top + a.h).toBeLessThanOrEqual(to.top);
    expect(to.top + to.lineHeight).toBeLessThanOrEqual(NOVA_SCROLL.thumb.top);
    expect(NOVA_SCROLL.thumb.top).toBeLessThan(NOVA_SCREEN.h);
  });

  it('the Total page: the two arrows at the right edge meet halfway, and every line keeps clear of their column', () => {
    const a = novaHoldArrows();
    // The down arrow at the top right (photo nova-5), the up arrow mirrored at the bottom right.
    expect(a.downTop).toBe(NOVA_HOLD_ARROW.inset);
    expect(a.upTop + NOVA_HOLD_ARROW.h).toBe(NOVA_SCREEN.h - NOVA_HOLD_ARROW.inset);
    // Sliding `travel` each, the down arrow's tip meets the up arrow's tip on the middle line.
    expect(a.downTop + NOVA_HOLD_ARROW.h + a.travel).toBe(NOVA_SCREEN.h / 2);
    expect(a.upTop - a.travel).toBe(NOVA_SCREEN.h / 2);
    expect(a.column).toEqual([NOVA_SCREEN.w - NOVA_HOLD_ARROW.right - NOVA_HOLD_ARROW.w, NOVA_SCREEN.w - NOVA_HOLD_ARROW.right]);
    // The column runs the whole height, so every Total page's lines, at their
    // worst, end two pixels before it (centred lines: the box is symmetric).
    const totals = novaPages().filter((p) => p.kind === 'nova-total');
    expect(totals.length).toBeGreaterThan(100);
    for (const page of totals) {
      for (const r of novaRows(page)) {
        const right = NOVA_SCREEN.w / 2 + menloWidth(r.text, r.size) / 2;
        expect({ page, r, clear: right <= a.column[0] - 2 }).toEqual({ page, r, clear: true });
        expect(r.left).toBe(r.right);
      }
    }
  });

  it('the last page’s words end before its tick or cross', () => {
    for (const ok of [true, false]) {
      for (const r of novaRows({ kind: 'done', ok })) {
        expect(r.left + menloWidth(r.text, r.size)).toBeLessThanOrEqual(NOVA_DONE_GLYPH.x);
      }
    }
  });
});

describe('the Nova registering a vault (the phone-test video, 2026-10-04)', () => {
  const fits = (r: ScreenRow) => menloWidth(r.text, r.size) <= NOVA_SCREEN.w - r.left - r.right + 1e-9;
  const onScreen = (r: ScreenRow) => r.top >= 0 && r.top + r.lineHeight <= NOVA_SCREEN.h;
  const pages = [...registerPages('nova', REG), ...registerPages('nova', REG_POLICY), ...registerPages('nova', { ...REG, network: 'bitcoin' })] as NovaPage[];

  it('every titled page fits as the review’s do; a scrolling line is the one row that may run off the screen, from the left, never wrapped', () => {
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      const rows = novaRows(page);
      for (const r of rows) {
        expect({ page, r, onScreen: onScreen(r) && r.lines === 1 }).toEqual({ page, r, onScreen: true });
        if (r.clip) {
          expect({ page, r, scroll: page.kind === 'nova-scroll' && r.align === 'left' && r.left === NOVA_SCROLL.left && r.top === NOVA_SCROLL.top }).toEqual({ page, r, scroll: true });
        } else {
          expect({ page, r, fits: fits(r) }).toEqual({ page, r, fits: true });
        }
        if (r.top < NOVA_TOP_BAR) expect({ page, r, clear: r.left >= NOVA_TITLE_INSET && r.right >= NOVA_TITLE_INSET }).toEqual({ page, r, clear: true });
      }
      expect({ page, stacked: stacked(rows) }).toEqual({ page, stacked: true });
    }
    // A key's line shows about eighteen characters before the edge ("Cosigner 2/3: tpub", the video).
    const key = pages.find((p) => p.kind === 'nova-scroll')!;
    const line = novaRows(key).find((r) => r.clip)!;
    expect(Math.floor((NOVA_SCREEN.w - line.left - line.right) / (MENLO_ADVANCE * line.size))).toBe(17);
    // The thumb along the bottom, inside the screen, under the line.
    expect(NOVA_SCROLL.thumb.top).toBeGreaterThan(NOVA_SCROLL.top + NOVA_TYPE.lineHeight);
    expect(NOVA_SCROLL.thumb.top).toBeLessThan(NOVA_SCREEN.h);
    expect(NOVA_SCROLL.thumb.x + NOVA_SCROLL.thumb.w).toBeLessThan(NOVA_SCREEN.w);
  });

  it('the first page and the name page read as the signing’s "Spend from" pages do, under "Register"', () => {
    const [kind, name, account] = registerPages('nova', REG);
    expect(novaRows(kind as NovaPage).map((r) => r.text)).toEqual(['Register', '2-of-3', 'BTC Testnet multisig']);
    expect(novaRows(name as NovaPage).map((r) => r.text)).toEqual(['Register', 'Test 2/3 Oct']);
    expect(novaRows(account as NovaPage).map((r) => r.text)).toEqual(['Register', 'p2wsh', 'at', "m/48'/1'/0'/2'"]);
  });

  it('the address check (the video): the kind and the name under "Receive to" as the registration’s pages, the address as a scrolling line, the tick inside the top bar', () => {
    const pages = addressPages('nova', addressFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, TEST_ADDRESS, 'Test 2/3 Oct', 'bitbox')) as NovaPage[];
    expect(novaRows(pages[0]).map((r) => r.text)).toEqual(['Receive to', '2-of-3', 'BTC Testnet multisig']);
    expect(novaRows(pages[1]).map((r) => r.text)).toEqual(['Receive to', 'Test 2/3 Oct']);
    const rows = novaRows(pages[2]);
    expect(rows.map((r) => r.text)).toEqual(['Receive to', 'tb1q 3hnu fu5v vjfz 6fkl vrft 0f3y 7ean 0x9w jzkz d3u0 ensg 96al zwss rk5v y2']);
    expect(rows[0]).toMatchObject({ top: 2, left: NOVA_TITLE_INSET, right: NOVA_TITLE_INSET, bold: true });
    expect(rows[1]).toMatchObject({ top: NOVA_SCROLL.top, left: NOVA_SCROLL.left, align: 'left', clip: true });
    for (const r of rows) expect(onScreen(r) && r.lines === 1).toBe(true);
    expect(fits(rows[0])).toBe(true);
    // The tick where the ">" sits on every other page: in the bar, clear of the title.
    const m = NOVA_CONFIRM_MARK;
    expect(m.top + m.size).toBeLessThanOrEqual(NOVA_TOP_BAR);
    expect(m.right + m.size).toBeLessThanOrEqual(NOVA_TITLE_INSET);
  });

  it('"Multisig account" over "registered" from the left, every line ending before the tick; "Policy registered" too', () => {
    for (const text of ['Multisig account registered', 'Policy registered']) {
      const rows = novaRows({ kind: 'registered', text });
      expect(rows.map((r) => r.text).join(' ')).toBe(text);
      for (const r of rows) {
        expect(r.left).toBe(NOVA_REGISTERED.left);
        expect(r.left + menloWidth(r.text, r.size)).toBeLessThan(NOVA_REGISTERED.glyph.x);
        expect(fits(r) && onScreen(r)).toBe(true);
      }
      expect(stacked(rows)).toBe(true);
    }
    expect(novaRows({ kind: 'registered', text: 'Multisig account registered' }).map((r) => r.text)).toEqual(['Multisig account', 'registered']);
    expect(NOVA_REGISTERED.glyph.x + NOVA_REGISTERED.glyph.size).toBeLessThanOrEqual(NOVA_SCREEN.w);
  });
});

describe('the Nova after it is plugged in (photos 56 to 62 and a recording, 2026-10-04)', () => {
  const fits = (r: ScreenRow) => menloWidth(r.text, r.size) <= NOVA_SCREEN.w - r.left - r.right + 1e-9;
  const onScreen = (r: ScreenRow) => r.top >= 0 && r.top + r.lineHeight <= NOVA_SCREEN.h;

  it('the slots are the thirds of the screen, and a four-character group fits its slot’s box with two pixels to spare', () => {
    expect(NOVA_SLOTS).toEqual([NOVA_SCREEN.w / 6, NOVA_SCREEN.w / 2, (NOVA_SCREEN.w * 5) / 6]);
    const rows = novaSlotRows(['012', '345', '6789']);
    expect(rows.map((r) => r.text)).toEqual(['012', '345', '6789']);
    rows.forEach((r, i) => {
      expect(r.top).toBe(NOVA_PASSWORD.slots);
      expect((r.left + NOVA_SCREEN.w - r.right) / 2).toBeCloseTo(NOVA_SLOTS[i], 9);
      expect(NOVA_SCREEN.w - r.left - r.right).toBe(2 * NOVA_SLOT_HALF);
      expect(fits(r) && onScreen(r)).toBe(true);
    });
    expect(menloWidth('6789', NOVA_TYPE.size)).toBeLessThanOrEqual(2 * NOVA_SLOT_HALF - 2);
    // The boxes do not touch, so the labels never run together.
    expect(rows[0].left + 2 * NOVA_SLOT_HALF).toBeLessThan(rows[1].left);
    expect(rows[1].left + 2 * NOVA_SLOT_HALF).toBeLessThan(rows[2].left);
    // An opened group keeps the three places (photo 61).
    expect(novaSlotRows(['6', '7', '89']).map((r) => r.left)).toEqual(rows.map((r) => r.left));
  });

  it('the entry as the device prints it: dots but the last character, the cursor while typing, none on the confirmation', () => {
    expect(novaEntry(0, null, true)).toBe('');
    expect(novaEntry(1, '6', true)).toBe('6_');
    expect(novaEntry(2, '3', true)).toBe('•3_');
    expect(novaEntry(2, '3', false)).toBe('•3');
    expect(novaEntry(4, '1', true)).toBe('•••1_');
  });

  it('the password page: "abc" between the slots in the bar, "Enter password" on the middle line until a character is in, then the entry at the left; "<" only with something to go back from', () => {
    const top = ['012', '345', '6789'];
    const empty = novaRows({ kind: 'nova-password', entered: 0, last: null, groups: top, depth: 0 });
    expect(empty.map((r) => r.text)).toEqual(['abc', 'Enter password', '012', '345', '6789']);
    const abc = empty[0];
    expect(abc.top).toBe(NOVA_PASSWORD.abc);
    expect(abc.left).toBe(NOVA_TITLE_INSET);
    expect(abc.right).toBe(NOVA_TITLE_INSET);
    expect(abc.bold).toBe(false);
    expect(empty[1]).toMatchObject({ top: NOVA_PASSWORD.entry.top, align: 'center' });
    const open = novaRows({ kind: 'nova-password', entered: 0, last: null, groups: ['6', '7', '89'], depth: 1 });
    expect(open.map((r) => r.text)).toEqual(['<', 'abc', 'Enter password', '6', '7', '89']);
    const typed = novaRows({ kind: 'nova-password', entered: 2, last: '3', groups: top, depth: 0 });
    expect(typed.map((r) => r.text)).toEqual(['<', 'abc', '•3_', '012', '345', '6789']);
    const back = typed[0];
    expect(back).toMatchObject({ top: NOVA_PASSWORD.abc, left: NOVA_PASSWORD.back, align: 'left' });
    // The "<" sits over the first slot, well left of "abc" itself (centred in its box).
    expect(back.left + menloWidth('<', back.size) / 2).toBeCloseTo(NOVA_SLOTS[0], -1);
    expect(back.left + menloWidth('<', back.size)).toBeLessThan((NOVA_SCREEN.w - menloWidth('abc', abc.size)) / 2 - 20);
    expect(typed[2]).toMatchObject({ top: NOVA_PASSWORD.entry.top, left: NOVA_PASSWORD.entry.left, align: 'left' });
    for (const rows of [empty, open, typed]) {
      for (const r of rows) expect({ r, ok: fits(r) && onScreen(r) && r.lines === 1 }).toEqual({ r, ok: true });
      // Nothing but the bar's words above the top bar; the groups' line clear of the middle line.
      for (const r of rows.filter((x) => x.top < NOVA_TOP_BAR)) expect(['<', 'abc']).toContain(r.text);
      expect(rows.find((x) => x.top === NOVA_PASSWORD.slots)!.top).toBeGreaterThanOrEqual(NOVA_PASSWORD.entry.top + NOVA_TYPE.lineHeight);
    }
    // The entry keeps clear of the top bar's arrow column and the slots' line.
    expect(NOVA_PASSWORD.entry.top).toBeGreaterThanOrEqual(NOVA_TOP_BAR);
  });

  it('the confirmation: the entry alone, at the left, no cursor, clear of the arrows’ column (photo 58)', () => {
    const rows = novaRows({ kind: 'nova-confirm', entered: 2, last: '3' });
    expect(rows.map((r) => r.text)).toEqual(['•3']);
    expect(rows[0]).toMatchObject({ top: NOVA_PASSWORD.entry.top, left: NOVA_PASSWORD.entry.left, align: 'left' });
    expect(rows[0].left + menloWidth(rows[0].text, rows[0].size)).toBeLessThan(novaHoldArrows().column[0]);
  });

  it('the side page: "Tap this side" turned round at the top and upright at the bottom, both centred, the arrow between them clear of both', () => {
    const rows = novaRows({ kind: 'nova-side' });
    expect(rows.map((r) => [r.text, r.top, r.upsideDown === true, r.align])).toEqual([
      ['Tap this side', NOVA_SIDE.top, true, 'center'],
      ['Tap this side', NOVA_SIDE.bottom, false, 'center'],
    ]);
    for (const r of rows) expect(fits(r) && onScreen(r)).toBe(true);
    const a = NOVA_SIDE.arrow;
    expect(a.cy - a.r - 2).toBeGreaterThanOrEqual(NOVA_SIDE.top + NOVA_TYPE.lineHeight);
    expect(a.cy + a.r + 2).toBeLessThanOrEqual(NOVA_SIDE.bottom);
    expect([a.cx, a.cy]).toEqual([NOVA_SCREEN.w / 2, NOVA_SCREEN.h / 2]);
  });

  it('the turning arrow: an arc of most of a circle round the centre, and a head at its end pointing on round', () => {
    const r = 6;
    const { arc, head } = novaTurnArrow(8, 8, r);
    const m = /^M([\d.]+) ([\d.]+) A6 6 0 1 1 ([\d.]+) ([\d.]+)$/.exec(arc)!;
    expect(m).not.toBeNull();
    const [x0, y0, x1, y1] = m.slice(1).map(Number);
    // Both ends on the circle; the start below right, the end above right (the gap at the right).
    for (const [x, y] of [[x0, y0], [x1, y1]]) expect(Math.hypot(x - 8, y - 8)).toBeCloseTo(r, 1);
    expect(x0).toBeGreaterThan(8);
    expect(y0).toBeGreaterThan(8);
    expect(x1).toBeGreaterThan(8);
    expect(y1).toBeLessThan(8);
    // The head: a closed triangle whose tip lies ahead of the end, further down the circle's clockwise way.
    const pts = head.match(/[\d.]+ [\d.]+/g)!.map((p) => p.split(' ').map(Number));
    expect(head.endsWith('Z')).toBe(true);
    expect(pts).toHaveLength(3);
    const tip = pts[0];
    expect(tip[1]).toBeGreaterThan(y1);
    expect(Math.hypot(tip[0] - x1, tip[1] - y1)).toBeCloseTo(r * 0.6, 1);
  });

  it('the lock sits centred on the screen under the middle line’s room; the splash fits', () => {
    const L = NOVA_LOCK;
    expect(L.cx).toBe(NOVA_SCREEN.w / 2);
    expect(L.body.top - L.shackle.r - L.shackle.stroke).toBeGreaterThan(NOVA_TOP_BAR);
    expect(L.body.top + L.body.h).toBeLessThan(NOVA_SCREEN.h - 4);
    expect(L.openTurn).toBeLessThan(0);
    const splash = novaRows({ kind: 'nova-splash' });
    expect(splash.map((r) => r.text)).toEqual(['BitBox02 Nova']);
    expect(splash[0]).toMatchObject({ bold: true, size: NOVA_SPLASH.size, lineHeight: NOVA_SPLASH.lineHeight, top: NOVA_SPLASH.top });
    expect(fits(splash[0]) && onScreen(splash[0])).toBe(true);
    expect(NOVA_SPLASH.size).toBeGreaterThan(NOVA_TYPE.size);
  });
});

// ─── The Nano X ──────────────────────────────────────────────────────────────

/**
 * CoreText widths at the drawing's size, in the OLED's own pixels (the larger
 * of the iPhone 17 Pro and the iPhone SE), regular unless marked bold.
 */
const MEASURED: Record<string, number> = {
  'bold:Sign transaction': 88.83,
  'bold:From account': 73.61,
  'bold:Amount': 41.91,
  'bold:Fees': 25.26,
  'bold:To': 12.67,
  'bold:Wallet name': 65.89,
  'bold:Transaction signed': 102.98,
  'bold:Transaction rejected': 111.64,
  'Review transaction': 96.45,
  'to send bitcoin': 76.01,
  'Loading transaction': 100.91,
  'Signing transaction': 98.68,
  '1234.12345678 TEST': 108.6,
  '0.00012345 TEST': 90.77,
  '0.0125 BTC': 58.23,
  '0.000012 BTC': 71.75,
  '21.00000001 TEST': 95.96,
  'Family vault': 60.39,
  'Enter PIN': 47.74,
  'bold:Open app': 51.23,
  'bold:Bitcoin Test': 63.94,
  'bold:Bitcoin': 37.91,
  // Registering a vault (the phone-test video, 2026-10-04), measured the same way on
  // this Mac (CoreText reproduces the table above to the hundredth).
  'Review account': 79.69,
  'to register': 52.89,
  'bold:Account name': 76.53,
  'bold:Spending policy': 86.53,
  'bold:Review co-signer': 93.23,
  'bold:public keys': 60.98,
  'bold:Register account': 91.69,
  'Account registered': 96.78,
  'bold:Their key@0 (1/3)': 95.34,
  'bold:Our key@1 (2/3)': 86.46,
  'bold:Their key@14 (3/3)': 102.45,
  'Test 2/3 Oct': 62.71,
  // The address check (the phone-test video, 2026-10-04), measured the same way.
  'Verify bitcoin': 67.69,
  address: 40.35,
  'bold:Address (1/2)': 72.78,
  'bold:Address (2/2)': 74.09,
  'bold:Address': 44.33,
  'bold:Confirm': 43.35,
  'Address verified': 82.86,
  'bold:Bitcoin Testnet': 81.55,
  'app is ready': 62.32,
};
/** A bold digit at the PIN row's size (11), the widest ("8"): it sits in its nine pixel cell. */
const MEASURED_DIGIT = 8.07;

/** The chunks of a key as a Nano X paged it (56, 56 and 22 characters). */
const KEY_CHUNKS = ["[4a290600/48'/1'/0'/2']tpubDErJdogEeCPaWqdEz5R6mxYew51Ao", 'QFaigWJgqdztLEZ3rjhJ3t7sL7j7kvGJY3jgmmjMJFSmWDSrur8fEnQL', 'CqH4ZtoN5ELcMGBP5ApFqw'];

/** CoreText's line breaks in the To page's box (110 pixels at size 10). */
const MEASURED_LINES: Record<string, number> = {
  [TO]: 3, // bc1qxy2kgdygjrsqtzq / 2n0yrf2493p83kkfjh / x0wlh
  [TO_TEST]: 3, // three lines, as on the test device (photo nanox-5); where each break falls can differ by a character between phones
  [TO_WSH]: 4,
  [TO_TR]: 4, // CoreText at size 10 in a 110-point box: bc1p5cyxnuxmeuwuvk / wfem96lqzszd02n6xd / cjrs20cac6yqjjwudpxq / kedrcr (2026-11-05)
  // A key's chunks (56 characters take four lines in this face, three on the device), the policy sentences, a template.
  [KEY_CHUNKS[0]]: 4,
  [KEY_CHUNKS[1]]: 4,
  [KEY_CHUNKS[2]]: 2,
  'Any 2 of @0, @1 and @2 must sign': 2,
  'Any 3 of @0, @1, @2, @3 and @4 must sign': 3,
  'tr(@0/**,multi_a(2,@1/**,@2/**))': 3,
  // The address check's pages (59 characters take four lines here, three on the device; 3 one), measured the same way on this Mac.
  [ADDR_CHUNKS[0]]: 4,
  [ADDR_CHUNKS[1]]: 1,
};

const nanoPages = (): NanoXPage[] => {
  const ledger: TourFacts = { ...BASE, brand: 'ledger', bitboxKind: null };
  const review = [TO, TO_TEST, TO_WSH, TO_TR].flatMap((address) =>
    reviewPages('nanoX', { ...ledger, outputs: [{ address, amountSats: 1_250_000 }] }),
  );
  const asPage = (p: ReviewPage): NanoXPage =>
    p.kind === 'nano-intro' ? { kind: 'intro' } : p.kind === 'nano-sign' ? { kind: 'sign' } : { ...(p as { title: string; value: string; long?: boolean }), kind: 'item' };
  return [
    ...review.map(asPage),
    { kind: 'working', text: 'Loading transaction' },
    { kind: 'working', text: 'Signing transaction' },
    { kind: 'done', ok: true },
    { kind: 'done', ok: false },
    { kind: 'item', title: 'Wallet name', value: 'Family vault' },
    { kind: 'item', title: 'Amount', value: '1234.12345678 TEST' },
    { kind: 'item', title: 'Fees', value: '0.00012345 TEST' },
    { kind: 'item', title: 'Amount', value: '21.00000001 TEST' },
    { kind: 'pin', entered: 0, cursor: 0 },
    { kind: 'pin', entered: 4, cursor: NANO_PIN_TICK },
    { kind: 'open-app', app: 'Bitcoin Test' },
    { kind: 'open-app', app: 'Bitcoin' },
    // Registering a vault (the video).
    { kind: 'register-intro' },
    { kind: 'register-keys' },
    { kind: 'register-approve' },
    { kind: 'notice', text: 'Account registered' },
    { kind: 'item', title: 'Account name', value: 'Test 2/3 Oct' },
    { kind: 'item', title: 'Spending policy', value: 'Any 2 of @0, @1 and @2 must sign', long: true },
    { kind: 'item', title: 'Spending policy', value: 'Any 3 of @0, @1, @2, @3 and @4 must sign', long: true },
    { kind: 'item', title: 'Spending policy', value: 'tr(@0/**,multi_a(2,@1/**,@2/**))', long: true },
    { kind: 'item', title: 'Their key@0 (1/3)', value: KEY_CHUNKS[0], long: true },
    { kind: 'item', title: 'Our key@1 (2/3)', value: KEY_CHUNKS[1], long: true },
    { kind: 'item', title: 'Their key@14 (3/3)', value: KEY_CHUNKS[2], long: true },
    // The address check (the video).
    { kind: 'address-intro' },
    { kind: 'confirm' },
    { kind: 'app-home', app: 'Bitcoin Testnet' },
    { kind: 'notice', text: 'Address verified' },
    { kind: 'item', title: 'Address (1/2)', value: ADDR_CHUNKS[0], long: true },
    { kind: 'item', title: 'Address (2/2)', value: ADDR_CHUNKS[1], long: true },
    { kind: 'item', title: 'Address', value: TO, long: true },
  ];
};

describe('the Nano X: the arrows at the very edges, every line clear of them', () => {
  it('the arrows are four by seven at two pixels in, centred on the screen’s height', () => {
    const cols = nanoXArrowColumns();
    expect(NANO_X_ARROW.inset).toBe(2);
    expect(cols.left[0]).toBeGreaterThanOrEqual(0);
    expect(cols.right[1]).toBeLessThanOrEqual(NANO_X_SCREEN.w);
    // Mirror images of each other.
    expect(cols.left[0] + cols.right[1]).toBeCloseTo(NANO_X_SCREEN.w, 9);
    expect(NANO_X_ARROW.h).toBeLessThan(NANO_X_SCREEN.h / 4);
  });

  it('a page with arrows keeps its words inside them, with room to spare', () => {
    const cols = nanoXArrowColumns();
    expect(NANO_X_TEXT_INSET - cols.left[1]).toBeGreaterThanOrEqual(NANO_X_ARROW_GAP);
    expect(cols.right[0] - (NANO_X_SCREEN.w - NANO_X_TEXT_INSET)).toBeGreaterThanOrEqual(NANO_X_ARROW_GAP);
  });

  it('every page: no line’s box reaches an arrow column, every line on the screen, nothing on top of anything', () => {
    const cols = nanoXArrowColumns();
    for (const page of nanoPages()) {
      const { rows, glyph, arrows } = nanoXLayout(page);
      for (const r of rows) {
        if (arrows.left) expect({ page, r, clear: r.left - cols.left[1] >= NANO_X_ARROW_GAP }).toEqual({ page, r, clear: true });
        if (arrows.right) expect({ page, r, clear: cols.right[0] - (NANO_X_SCREEN.w - r.right) >= NANO_X_ARROW_GAP }).toEqual({ page, r, clear: true });
        // A page with only the right arrow still centres its words on the screen.
        expect(r.left).toBe(r.right);
        expect({ page, r, onScreen: r.top >= 0 && r.top + r.lines * r.lineHeight <= NANO_X_SCREEN.h }).toEqual({ page, r, onScreen: true });
      }
      expect({ page, stacked: stacked(rows) }).toEqual({ page, stacked: true });
      if (glyph) {
        const first = Math.min(...rows.map((r) => r.top));
        expect({ page, glyphAbove: glyph.top + glyph.size <= first + 2 }).toEqual({ page, glyphAbove: true });
      }
    }
  });

  it('the words the device prints fit their boxes, at the size CoreText measured them', () => {
    // Every row is checked, a value of several lines too (decided 2026-10-03:
    // skipping those left five measured values unread): a row leaves room
    // for at least the lines its measured width needs in its box; an
    // address is held to the lines CoreText breaks it into.
    const used = new Set<string>();
    for (const page of nanoPages()) {
      for (const r of nanoXLayout(page).rows) {
        const box = NANO_X_SCREEN.w - r.left - r.right;
        expect(r.size).toBe(NANO_X_TYPE.size);
        const key = (r.bold ? 'bold:' : '') + r.text;
        const w = MEASURED[key];
        if (w == null) {
          expect({ text: r.text, address: MEASURED_LINES[r.text] != null }).toEqual({ text: r.text, address: true });
          expect({ text: r.text, lines: r.lines >= MEASURED_LINES[r.text] }).toEqual({ text: r.text, lines: true });
          continue;
        }
        used.add(key);
        expect({ text: r.text, lines: r.lines >= Math.ceil(w / box) }).toEqual({ text: r.text, lines: true });
        if (r.lines === 1) expect({ text: r.text, fits: w <= box }).toEqual({ text: r.text, fits: true });
      }
    }
    // Every measurement is read by some page.
    expect(Object.keys(MEASURED).filter((k) => !used.has(k))).toEqual([]);
  });

  it('an address keeps the lines CoreText breaks it into: three up to 42 characters, four beyond', () => {
    for (const [address, lines] of Object.entries(MEASURED_LINES)) {
      const { rows } = nanoXLayout({ kind: 'item', title: 'To', value: address, long: true });
      const value = rows.find((r) => r.text === address)!;
      // The measurement holds for this box and this size only.
      expect(NANO_X_SCREEN.w - value.left - value.right).toBe(110);
      expect(value.size).toBe(10);
      expect(value.lines).toBeGreaterThanOrEqual(lines);
      expect(value.lines).toBe(address.length > LONG_VALUE_CHARS ? 4 : 3);
    }
  });

  it('pages without arrows use the wider box', () => {
    for (const page of [{ kind: 'working', text: 'Loading transaction' }, { kind: 'done', ok: false }, { kind: 'pin', entered: 0, cursor: 0 }] as NanoXPage[]) {
      const { rows, arrows } = nanoXLayout(page);
      expect(arrows).toEqual({ left: false, right: false });
      expect(rows.every((r) => r.left === NANO_X_PLAIN_INSET)).toBe(true);
    }
  });

  it('the PIN page (photos 64 and 67): the slots and the keys on their pitches, centred, every one on the screen', () => {
    const P = NANO_PIN;
    for (const entered of [0, 1, 3, 4, 8]) {
      for (const cursor of [0, 5, 9, NANO_PIN_TICK]) {
        const pin = nanoPinLayout({ entered, cursor });
        // Eight slots, the first `entered` filled, centred on the screen.
        expect(pin.slots).toHaveLength(P.slots.count);
        expect(pin.slots.filter((x) => x.filled)).toHaveLength(entered);
        const slotsRight = pin.slots[P.slots.count - 1].x + P.slots.d;
        expect(pin.slots[0].x + slotsRight).toBeCloseTo(NANO_X_SCREEN.w, 9);
        pin.slots.forEach((x, i) => i > 0 && expect(x.x - pin.slots[i - 1].x).toBe(P.slots.pitch));
        // The ten digits on their pitch, centred; the backspace once a digit
        // is in, the tick once four are, each a pitch beyond the digits.
        const digits = pin.keys.filter((k) => !k.glyph);
        expect(digits.map((k) => k.text)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
        expect(digits[0].x + digits[9].x + P.keys.pitch).toBeCloseTo(NANO_X_SCREEN.w, 9);
        expect(pin.keys.some((k) => k.glyph === 'backspace')).toBe(entered > 0);
        expect(pin.keys.some((k) => k.glyph === 'tick')).toBe(entered >= P.min);
        for (const k of pin.keys) expect({ k, onScreen: k.x >= 0 && k.x + P.keys.pitch <= NANO_X_SCREEN.w }).toEqual({ k, onScreen: true });
        expect(MEASURED_DIGIT).toBeLessThanOrEqual(P.keys.pitch);
        // The cursor under its key: a digit, or the tick once it is shown.
        const under = cursor === NANO_PIN_TICK && entered >= P.min ? pin.keys.find((k) => k.glyph === 'tick')! : digits[Math.min(cursor, 9)];
        expect(pin.cursor.x).toBeCloseTo(under.x + (P.keys.pitch - P.cursor.w) / 2, 9);
        expect(pin.cursor.x + P.cursor.w).toBeLessThanOrEqual(NANO_X_SCREEN.w);
      }
    }
    // The rows stack: the title, the slots, the keys, the cursor, all on the screen.
    const title = nanoXLayout({ kind: 'pin', entered: 0, cursor: 0 }).rows[0];
    expect(title.top + title.lineHeight).toBeLessThanOrEqual(P.slots.top);
    expect(P.slots.top + P.slots.d).toBeLessThanOrEqual(P.keys.top);
    expect(P.keys.top + P.keys.lineHeight).toBeLessThanOrEqual(P.cursor.top);
    expect(P.cursor.top + P.cursor.h).toBeLessThanOrEqual(NANO_X_SCREEN.h);
  });

  it('the address check (the video): the intro as the review’s, the tick over "Confirm", the home with the title over "app is ready"', () => {
    const intro = nanoXLayout({ kind: 'address-intro' });
    expect(intro.rows.map((r) => [r.text, r.bold])).toEqual([
      ['Verify bitcoin', false],
      ['address', false],
    ]);
    expect(intro.glyph?.kind).toBe('bitcoin');
    expect(intro.arrows).toEqual({ left: false, right: true });
    const confirm = nanoXLayout({ kind: 'confirm' });
    expect(confirm.rows.map((r) => [r.text, r.bold])).toEqual([['Confirm', true]]);
    expect(confirm.glyph?.kind).toBe('tick');
    expect(confirm.arrows).toEqual({ left: true, right: true });
    const home = nanoXLayout({ kind: 'app-home', app: 'Bitcoin Testnet' });
    expect(home.rows.map((r) => [r.text, r.bold])).toEqual([
      ['Bitcoin Testnet', true],
      ['app is ready', false],
    ]);
    expect(home.glyph?.kind).toBe('bitcoin');
    expect(home.arrows).toEqual({ left: false, right: true });
    // The address pages are the review's long item page: the taller box for a chunk past 42 characters.
    const first = nanoXLayout({ kind: 'item', title: 'Address (1/2)', value: ADDR_CHUNKS[0], long: true });
    expect(first.rows[1]).toMatchObject({ lines: 4, top: 14 });
    expect(addressPages('nanoX', addressFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, TEST_ADDRESS, 'Test 2/3 Oct', 'ledger')).filter((p) => p.kind === 'nano-item' && p.long)).toHaveLength(2);
  });

  it('"Open app" (photo 70): the glyph above two bold lines, the right arrow alone', () => {
    const { rows, glyph, arrows } = nanoXLayout({ kind: 'open-app', app: 'Bitcoin Test' });
    expect(rows.map((r) => [r.text, r.bold])).toEqual([
      ['Open app', true],
      ['Bitcoin Test', true],
    ]);
    expect(glyph?.kind).toBe('bitcoin');
    expect(arrows).toEqual({ left: false, right: true });
  });

  it('registering a vault (the video): the intro as the review’s, the keys’ intro bold between both arrows, the tick over "Register account", the word alone', () => {
    const intro = nanoXLayout({ kind: 'register-intro' });
    expect(intro.rows.map((r) => [r.text, r.bold])).toEqual([
      ['Review account', false],
      ['to register', false],
    ]);
    expect(intro.glyph?.kind).toBe('bitcoin');
    expect(intro.arrows).toEqual({ left: false, right: true });
    const keys = nanoXLayout({ kind: 'register-keys' });
    expect(keys.rows.map((r) => [r.text, r.bold])).toEqual([
      ['Review co-signer', true],
      ['public keys', true],
    ]);
    expect(keys.glyph).toBeNull();
    expect(keys.arrows).toEqual({ left: true, right: true });
    const approve = nanoXLayout({ kind: 'register-approve' });
    expect(approve.rows.map((r) => [r.text, r.bold])).toEqual([['Register account', true]]);
    expect(approve.glyph?.kind).toBe('tick');
    expect(approve.arrows).toEqual({ left: true, right: true });
    const notice = nanoXLayout({ kind: 'notice', text: 'Account registered' });
    expect(notice.rows.map((r) => [r.text, r.bold])).toEqual([['Account registered', false]]);
    expect(notice.glyph).toBeNull();
    expect(notice.arrows).toEqual({ left: false, right: false });
    // A key's chunk of 56 takes four lines here (three on the device's narrower face): the long page's taller box.
    const chunk = nanoXLayout({ kind: 'item', title: 'Their key@0 (1/3)', value: KEY_CHUNKS[0], long: true });
    expect(chunk.rows[1]).toMatchObject({ lines: 4, top: 14 });
    expect(registerPages('nanoX', REG).filter((p) => p.kind === 'nano-item' && p.long).length).toBeGreaterThan(0);
  });
});

// ─── The touchscreen Ledgers' pages ──────────────────────────────────────────

describe('the touchscreens’ pages and the two controls the press hint lights', () => {
  it('the footer’s ">" sits in its slot at the right end of the counter part, centred in the footer', () => {
    for (const [W, H, ts] of [
      [143.264, 190.96, 1],
      [154.88, 193.6, 0.9],
      [151.36, 256.96, 0.95],
    ]) {
      const P = EINK_PAGE;
      const chev = einkUnit(P.type.chevron, W, ts);
      const { next, tile } = einkAnchors(W, H, ts);
      expect(next.x + chev / 2).toBeCloseTo(W - P.pad * W * P.footer.inset, 9);
      expect(next.y).toBeCloseTo(((P.footer.top + 1) / 2) * H, 9);
      // The tile at the right end of the last page's row, centred in it.
      const t = einkUnit(P.type.tile, W, ts);
      expect(tile.x + t / 2).toBeCloseTo(W - P.pad * W * P.sign.right, 9);
      expect(tile.y).toBeCloseTo((P.sign.rule + P.sign.row / 2) * H, 9);
      expect(tile.r).toBe(t / 2);
      // Both on the screen, the ">" inside the footer, the tile above it.
      expect(next.y - next.r).toBeGreaterThan(P.footer.top * H);
      expect(tile.y + tile.r).toBeLessThan(P.footer.top * H);
    }
  });

  it('the Open button spans the page less its insets; the twelve keys sit in their cells; the band lies between the dots and the keypad', () => {
    for (const [W, H, ts] of [
      [143.264, 190.96, 1],
      [154.88, 193.6, 0.9],
      [151.36, 256.96, 0.95],
    ]) {
      const P = EINK_PAGE;
      const { open, approve, pin } = einkAnchors(W, H, ts);
      expect(open.x).toBeCloseTo(W / 2, 9);
      expect(open.w).toBeCloseTo(W - 2 * P.open.button.x * W, 9);
      expect(open.h).toBeCloseTo(P.open.button.h * H, 9);
      expect(open.y).toBeCloseTo((P.open.button.top + P.open.button.h / 2) * H, 9);
      // The registration's Approve button: the same shape, above the footer (the video).
      const ab = P.register.approve.button;
      expect(approve).toMatchObject({ x: W / 2 });
      expect(approve.w).toBeCloseTo(W - 2 * ab.x * W, 9);
      expect(approve.h).toBeCloseTo(ab.h * H, 9);
      expect(approve.y).toBeCloseTo((ab.top + ab.h / 2) * H, 9);
      expect(approve.y + approve.h! / 2).toBeLessThan(P.footer.top * H);
      const cells = einkPinCells(W, H);
      expect(pin).toHaveLength(12);
      pin.forEach((c, i) => {
        expect(c.x).toBeCloseTo(((i % 3) + 0.5) * cells.w, 9);
        expect(c.y).toBeCloseTo(cells.top + (Math.floor(i / 3) + 0.5) * cells.h, 9);
        // The ring round a digit, inside its cell.
        expect(2 * c.r).toBeLessThan(cells.w);
      });
      expect(cells.top + 4 * cells.h).toBeCloseTo(H, 9);
      const band = einkPinBand(W, H);
      expect(band.top).toBeGreaterThan(P.pin.title * H);
      expect(band.bottom).toBe(cells.top);
      // Room for a pill of 20 with a little to spare on the smallest screen.
      expect(band.bottom - band.top).toBeGreaterThanOrEqual(24);
    }
  });

  it('the address page’s row (the Gen5 video): the QR button a square at the left margin, Confirm beside it to the right margin, above the footer', () => {
    for (const [W, H, ts] of [
      [143.264, 190.96, 1],
      [154.88, 193.6, 0.9],
      [151.36, 256.96, 0.95],
    ]) {
      const P = EINK_PAGE;
      const pad = P.pad * W;
      const row = einkAddressRow(W, H);
      expect(row.top).toBeCloseTo(P.address.row.top * H, 9);
      expect(row.h).toBeCloseTo(P.address.row.h * H, 9);
      expect(row.qr).toEqual({ left: pad, side: row.h });
      expect(row.confirm.left).toBeCloseTo(pad + row.h + pad * P.address.row.gap, 9);
      expect(row.confirm.left + row.confirm.w).toBeCloseTo(W - pad, 9);
      expect(row.confirm.w).toBeGreaterThan(2 * row.h);
      expect(row.top + row.h).toBeLessThan(P.footer.top * H);
      // The hint's Confirm spot is that button: wide, centred on it.
      const { confirm } = einkAnchors(W, H, ts);
      expect(confirm.x).toBeCloseTo(row.confirm.left + row.confirm.w / 2, 9);
      expect(confirm.y).toBeCloseTo(row.top + row.h / 2, 9);
      expect(confirm.w).toBeCloseTo(row.confirm.w, 9);
      expect(confirm.h).toBeCloseTo(row.h, 9);
      expect(confirm.r).toBeCloseTo(row.h / 2, 9);
      // The columns above it stack: the address (its label and four lines), then the name, then the row.
      const f = (k: number) => einkUnit(k, W, ts);
      const line = (t: readonly [number, number]) => f(t[1]);
      const addressBottom = P.address.top * H + line(P.type.small) + P.address.lines * line(P.type.address);
      expect(addressBottom).toBeLessThanOrEqual(P.address.name * H);
      const nameBottom = P.address.name * H + line(P.type.small) + line(P.type.value);
      expect(nameBottom).toBeLessThan(row.top);
    }
  });

  it('a type unit is the screen’s width scaled by the model, to a tenth', () => {
    expect(einkUnit(0.085, 143.264, 1)).toBe(12.2);
    expect(einkUnit(0.085, 154.88, 0.9)).toBe(11.8);
    expect(einkUnit(0.19, 151.36, 0.95)).toBe(27.3);
  });
});

// ─── The touchscreen Ledgers' working mark ───────────────────────────────────

/** Animated's interpolation with the ends clamped, as the mark uses it. */
function interp({ inputRange, outputRange }: { inputRange: number[]; outputRange: number[] }, t: number): number {
  if (t <= inputRange[0]) return outputRange[0];
  for (let i = 1; i < inputRange.length; i++) {
    if (t <= inputRange[i]) {
      const a = inputRange[i - 1];
      const b = inputRange[i];
      return outputRange[i - 1] + ((t - a) / (b - a)) * (outputRange[i] - outputRange[i - 1]);
    }
  }
  return outputRange[outputRange.length - 1];
}

describe('the touchscreen Ledgers’ working mark (a recording of a Gen5)', () => {
  it('visits the corners clockwise from the top left, about 0.6 s each', () => {
    expect(WORKING_CORNERS).toEqual(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
    expect(CORNER_MS).toBeGreaterThanOrEqual(500);
    expect(CORNER_MS).toBeLessThanOrEqual(700);
  });

  it('one corner at a time, and it jumps: never two, never none, never a glide', () => {
    for (let t = 0; t <= 4; t += 0.0005) {
      const shown = WORKING_CORNERS.map((_, i) => interp(cornerShown(i), t));
      const sum = shown.reduce((a, b) => a + b, 0);
      expect({ t, sum: Math.round(sum * 1e9) / 1e9 }).toEqual({ t, sum: 1 });
      const nearStep = Math.abs(t - Math.round(t)) < 0.0011 && t > 0.5 && t < 3.5;
      if (!nearStep) {
        const at = Math.min(3, Math.floor(t));
        expect({ t, shown: shown.map((v) => Math.round(v)) }).toEqual({ t, shown: shown.map((_, i) => (i === at ? 1 : 0)) });
      }
    }
  });

  it('each bracket is an L at its own corner, its arms along the box’s edges', () => {
    const [w, h, across, down, stroke] = [28, 24.5, 11, 7, 2];
    const pts = (c: (typeof WORKING_CORNERS)[number]) =>
      cornerPath(c, w, h, across, down, stroke)
        .replace(/[ML]/g, ' ')
        .trim()
        .split(/\s+/)
        .map(Number);
    // [arm end x, y, corner x, y, other arm end x, y]
    expect(pts('topLeft')).toEqual([1 + across, 1, 1, 1, 1, 1 + down]);
    expect(pts('topRight')).toEqual([w - 1 - across, 1, w - 1, 1, w - 1, 1 + down]);
    expect(pts('bottomRight')).toEqual([w - 1 - across, h - 1, w - 1, h - 1, w - 1, h - 1 - down]);
    expect(pts('bottomLeft')).toEqual([1 + across, h - 1, 1, h - 1, 1, h - 1 - down]);
  });

  it('the box is wider than tall, the arms short of meeting, as the recording reads', () => {
    const k = EINK_WORKING;
    expect(k.box.w).toBeGreaterThan(k.box.h);
    expect(k.arm.across).toBeGreaterThan(k.arm.down);
    expect(2 * k.arm.across).toBeLessThan(k.box.w);
    expect(2 * k.arm.down).toBeLessThan(k.box.h);
  });
});

describe('the Nova\u2019s address, swiped along its lower edge (decided 2026-10-04; the video\u2019s frame)', () => {
  const groups = (a: string) => (a.match(/.{1,4}/g) ?? []).join(' ');
  it('the window is the screen less its insets, 17 characters of the test address ("tb1q 3hnu fu5v vj"); the rest is the travel', () => {
    expect(NOVA_SCROLL_WINDOW).toBe(NOVA_SCREEN.w - NOVA_SCROLL.left - 2);
    const line = groups(TEST_ADDRESS);
    expect(Math.floor(NOVA_SCROLL_WINDOW / (menloWidth('x', NOVA_TYPE.size)))).toBe(17);
    expect(novaScrollWidth(line)).toBeCloseTo(menloWidth(line, NOVA_TYPE.size), 5);
    expect(novaScrollTravel(line)).toBeCloseTo(novaScrollWidth(line) - NOVA_SCROLL_WINDOW, 5);
    expect(novaScrollTravel(line)).toBeGreaterThan(3 * NOVA_SCROLL_WINDOW);
    // Every bech32 address runs past the window; a line that fits travels nowhere.
    expect(novaScrollTravel(groups('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'))).toBeGreaterThan(0);
    expect(novaScrollTravel('tb1q shor t')).toBe(0);
  });

  it('the thumb starts at its track\u2019s left end and travels the track less itself; its width is about the window\u2019s share of the test line', () => {
    expect(NOVA_SCROLL.thumb.x).toBe(NOVA_SCROLL.track.x);
    expect(novaThumbTravel()).toBe(NOVA_SCROLL.track.w - NOVA_SCROLL.thumb.w);
    expect(NOVA_SCROLL.track.x + NOVA_SCROLL.track.w / 2).toBe(NOVA_SCREEN.w / 2);
    const line = groups(TEST_ADDRESS);
    const share = NOVA_SCROLL_WINDOW / novaScrollWidth(line);
    expect(Math.abs(NOVA_SCROLL.thumb.w / NOVA_SCROLL.track.w - share)).toBeLessThan(0.03);
  });
});
