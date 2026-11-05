/**
 * The address check as the devices show it (three phone-test videos of ONE receive
 * address of a 2-of-3 testnet vault "Test 2/3 Oct", 2026-10-04): the facts
 * from a vault, the address and the device in hand; the pages per family in
 * the firmware's own words and order; the Nano X's pages broken where its
 * font breaks them; the Nova's groups of four; the device's word after the
 * confirmation; what is drawn beyond the videos marked so; and the turn
 * drawn from them (the frames, the pace, the hint's cues, the words).
 */
import {
  NOVA_RECEIVE_TITLE,
  addressFacts,
  addressPages,
  nanoAddressPages,
  nanoAddressTitle,
  novaAddressGroups,
  unconfirmedAddress,
  verifiedWords,
} from '../addressCheck';
import type { AddressFacts } from '../addressCheck';
import { ADDRESS_MS, NOVA_UNLOCK_MS, TURN_MS, addressConfirmMs, addressDwell, deviceTurn, hasTurnPage, ledgerAppHome, novaSwipeStrokes, turnWords } from '../deviceTurns';
import { NOVA_SCROLL_WINDOW, novaScrollTravel, novaScrollWidth } from '../../components/deviceScreenLayout';
import { DEVICE_DRAWINGS, NOVA_SWIPE_MS, isAddressPage, isRegistrationPage, novaSwipePageMs, reviewPages, tourStarts } from '../signingDevice';
import type { TourFacts } from '../signingDevice';
import type { DeviceDrawing, ReviewPage } from '../signingDevice';
import { registerFacts, registerPages } from '../vaultRegistration';
import { nanoLines } from '../nanoFont';
import { HINT_MS, HINT_WORDS, deviceHint, planFromCues, valueAt } from '../../components/pressHintScript';
import { LIANA_TAPROOT, MULTISIG_2_OF_3, SPARROW_SINGLE_SIG } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

const VAULT = { descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' as const };
/** Receive address 1 of a 2-of-3 test vault (62 characters, a P2WSH). */
// A made-up test address: receive index 1 (testnet) of wsh(sortedmulti(2, ...)) over the
// filmed Nova key 4a290600, the filmed Nano X key abf931aa and the made-up key from
// BIP-32 test vector 1's seed (3442193e). Public test material, nobody's wallet.
const TEST_ADDRESS = 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5vy2';
const SHORT = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
/** BIP-86's published first receive address ("abandon ... about", m/86'/0'/0'/0/0). */
const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const LEDGER = addressFacts(VAULT, TEST_ADDRESS, 'Test 2/3 Oct', 'ledger');
const NOVA = addressFacts(VAULT, TEST_ADDRESS, 'Test 2/3 Oct', 'bitbox');
const POLICY = addressFacts({ descriptor: LIANA_TAPROOT, label: 'Family vault', network: 'testnet' }, TEST_ADDRESS, 'Family vault', 'bitbox');
/** A one-key vault: the device shows it as a plain account, with no name. */
const SINGLE = addressFacts({ descriptor: SPARROW_SINGLE_SIG, label: 'Mine', network: 'bitcoin' }, SHORT, null, 'ledger');

const TOUCH: DeviceDrawing[] = ['gen5', 'flex', 'stax'];
const HINTED: DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX', 'nova'];
const kinds = (pages: ReviewPage[]) => pages.map((p) => p.kind);
const factsFor = (d: DeviceDrawing): AddressFacts => (d === 'nova' ? NOVA : LEDGER);
const turnOf = (d: DeviceDrawing, f = factsFor(d)) => deviceTurn(d, 'address', f.network, null, f)!;

describe('the facts', () => {
  it('the vault, the address and the name as given; the BitBox’s kind from the descriptor, none on a Ledger', () => {
    expect(LEDGER).toEqual({ network: 'testnet', address: TEST_ADDRESS, name: 'Test 2/3 Oct', bitboxKind: null });
    expect(NOVA.bitboxKind).toEqual({ kind: 'multisig', threshold: 2, keys: 3 });
    expect(POLICY.bitboxKind).toEqual({ kind: 'policy', keys: 2 });
    expect(SINGLE).toEqual({ network: 'bitcoin', address: SHORT, name: null, bitboxKind: null });
  });

  it('confirmed by the videos: a registered classic 2-of-3; unconfirmed: a vault with no name on the device, a policy vault on the BitBox', () => {
    expect(unconfirmedAddress(LEDGER)).toBe(false);
    expect(unconfirmedAddress(NOVA)).toBe(false);
    expect(unconfirmedAddress(POLICY)).toBe(true);
    expect(unconfirmedAddress(SINGLE)).toBe(true);
    expect(unconfirmedAddress({ ...NOVA, name: null })).toBe(true);
  });
});

describe('the Nano X pages the address where its font breaks it (59 and 3)', () => {
  it('the 62-character address over two pages of three lines, 19 or 20 a line; 42 characters on one page; a taproot address over 58 and 4', () => {
    const pages = nanoAddressPages(TEST_ADDRESS);
    expect(pages).toEqual(['tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5', 'vy2']);
    expect(pages.join('')).toBe(TEST_ADDRESS);
    // The lines NBGL's rule breaks it into, worked out apart from this code.
    expect(nanoLines(TEST_ADDRESS)).toEqual(['tb1q3hnufu5vvjfz6fkl', 'vrft0f3y7ean0x9wjzkz', 'd3u0ensg96alzwssrk5', 'vy2']);
    expect(nanoAddressPages(SHORT)).toHaveLength(1);
    expect(nanoAddressPages(SHORT)[0]).toBe(SHORT);
    // Worked out apart from this code: bc1p5cyxnuxmeuwuv / kwfem96lqzszd02n6x / dcjrs20cac6yqjjwudpx / qkedrcr.
    expect(nanoAddressPages(TAPROOT).map((p) => p.length)).toEqual([55, 7]);
    expect(nanoAddressPages('')).toEqual(['']);
  });

  it('the title counts the pages only past one, as the device numbers them', () => {
    expect(nanoAddressTitle(1, 2)).toBe('Address (1/2)');
    expect(nanoAddressTitle(2, 2)).toBe('Address (2/2)');
    expect(nanoAddressTitle(1, 1)).toBe('Address');
  });
});

describe('the Nova prints the whole address in groups of four, as one line it scrolls', () => {
  it('groups of four from the start: "tb1q 3hnu fu5v vjfz 6fkl"', () => {
    const line = novaAddressGroups(TEST_ADDRESS);
    expect(line.startsWith('tb1q 3hnu fu5v vjfz 6fkl')).toBe(true);
    expect(line.replace(/ /g, '')).toBe(TEST_ADDRESS);
    expect(line.split(' ').every((g, i, all) => g.length === 4 || i === all.length - 1)).toBe(true);
    expect(novaAddressGroups(SHORT).split(' ')).toHaveLength(11);
  });
});

describe('the touchscreens’ pages (the Gen5 video; the Flex and the Stax share them)', () => {
  it('"Verify bitcoin address", then the one page with the address and the account name', () => {
    for (const d of TOUCH) {
      const pages = addressPages(d, LEDGER);
      expect(pages).toEqual([{ kind: 'touch-address-intro' }, { kind: 'touch-address', address: TEST_ADDRESS, name: 'Test 2/3 Oct' }]);
      expect(pages.every(isAddressPage)).toBe(true);
      // A vault the device shows as a plain account: no name on the page.
      expect(addressPages(d, SINGLE)[1]).toEqual({ kind: 'touch-address', address: SHORT, name: null });
    }
    expect(addressPages('gen5', LEDGER)).toEqual(addressPages('flex', LEDGER));
    expect(addressPages('gen5', LEDGER)).toEqual(addressPages('stax', LEDGER));
  });
});

describe('the Nano X’s pages (the video)', () => {
  it('the intro, "Address (1/2)" and "(2/2)" over the font’s pages, "Account name", the tick over "Confirm"', () => {
    const pages = addressPages('nanoX', LEDGER);
    expect(pages).toEqual([
      { kind: 'nano-address-intro' },
      { kind: 'nano-item', title: 'Address (1/2)', value: 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5', long: true },
      { kind: 'nano-item', title: 'Address (2/2)', value: 'vy2', long: true },
      { kind: 'nano-item', title: 'Account name', value: 'Test 2/3 Oct' },
      { kind: 'nano-address-confirm' },
    ]);
    // Its address and name pages are the review's own item page; the rest its own.
    expect(pages.filter((p) => !isAddressPage(p)).every((p) => p.kind === 'nano-item')).toBe(true);
    // A short address on one page, titled "Address"; no name page for a plain account.
    expect(kinds(addressPages('nanoX', SINGLE))).toEqual(['nano-address-intro', 'nano-item', 'nano-address-confirm']);
    expect(addressPages('nanoX', SINGLE)[1]).toEqual({ kind: 'nano-item', title: 'Address', value: SHORT, long: true });
  });
});

describe('the BitBox’s pages (the video for the classic multisig; a policy from the signing review’s words, unconfirmed)', () => {
  it('"Receive to" on every page: the kind, the name, then the address as one scrolling line with the tick', () => {
    expect(addressPages('nova', NOVA)).toEqual([
      { kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: '2-of-3\nBTC Testnet multisig' },
      { kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: 'Test 2/3 Oct' },
      { kind: 'nova-address', title: NOVA_RECEIVE_TITLE, body: novaAddressGroups(TEST_ADDRESS) },
    ]);
    expect(NOVA_RECEIVE_TITLE).toBe('Receive to');
    // On the main network the coin reads "BTC"; without a stored name, no name page.
    expect(addressPages('nova', { ...NOVA, network: 'bitcoin' })[0]).toMatchObject({ body: '2-of-3\nBTC multisig' });
    expect(kinds(addressPages('nova', { ...NOVA, name: null }))).toEqual(['nova-item', 'nova-address']);
    // The address page is the check's own; the titled pages the review's item page.
    const pages = addressPages('nova', NOVA);
    expect(pages.map(isAddressPage)).toEqual([false, false, true]);
  });

  it('a policy: "policy with N keys" as the signing review says it, the name, the address', () => {
    expect(addressPages('nova', POLICY)).toEqual([
      { kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: 'BTC Testnet\npolicy with\n2 keys' },
      { kind: 'nova-item', title: NOVA_RECEIVE_TITLE, body: 'Family vault' },
      { kind: 'nova-address', title: NOVA_RECEIVE_TITLE, body: novaAddressGroups(TEST_ADDRESS) },
    ]);
    expect(addressPages('nova', { ...POLICY, bitboxKind: { kind: 'policy', keys: 1 } })[0]).toMatchObject({ body: 'BTC Testnet\npolicy with\n1 key' });
  });
});

describe('after the confirmation, the slab, and every page’s words', () => {
  it('"Address verified" on every Ledger; the BitBox shows its splash and no word', () => {
    for (const d of [...TOUCH, 'nanoX', 'slab'] as DeviceDrawing[]) expect(verifiedWords(d)).toBe('Address verified');
    expect(verifiedWords('nova')).toBeNull();
  });

  it('a Ledger of unknown model gets one page in the words every model starts with', () => {
    expect(addressPages('slab', LEDGER)).toEqual([{ kind: 'slab-address' }]);
    expect(isAddressPage({ kind: 'slab-address' })).toBe(true);
  });

  it('an address page is never a registration page nor a review page, and no word carries an em dash', () => {
    const reg = registerFacts(VAULT, 'a1b2c3d4')!;
    for (const d of DEVICE_DRAWINGS) {
      for (const p of registerPages(d, reg)) expect({ d, p: p.kind, address: isAddressPage(p) }).toEqual({ d, p: p.kind, address: false });
      for (const f of [LEDGER, NOVA, POLICY, SINGLE]) {
        for (const p of addressPages(d, f)) {
          expect({ d, p, registration: isRegistrationPage(p) }).toEqual({ d, p, registration: false });
          for (const v of Object.values(p)) if (typeof v === 'string') expect(v).not.toMatch(/[—–]/);
        }
      }
    }
  });

  it('the facts are plain data a flow can keep', () => {
    const copy: AddressFacts = JSON.parse(JSON.stringify(NOVA));
    expect(addressPages('nova', copy)).toEqual(addressPages('nova', NOVA));
  });
});

describe('the turn (the address check’s screen): the pages, the confirmation, the device’s word, round again', () => {
  it('a page is drawn only from the facts; without them every drawing keeps its line', () => {
    for (const d of DEVICE_DRAWINGS) {
      expect({ d, bare: deviceTurn(d, 'address', 'bitcoin') }).toEqual({ d, bare: null });
      expect({ d, page: hasTurnPage(d, 'address') }).toEqual({ d, page: false });
      expect({ d, page: hasTurnPage(d, 'address', null, factsFor(d)) }).toEqual({ d, page: true });
    }
  });

  it('the frames: every page, then "Address verified" and the app’s home on a Ledger, the splash on the BitBox, then gone; the same every pass', () => {
    for (const d of HINTED) {
      const f = factsFor(d);
      const turn = turnOf(d);
      const pages = addressPages(d, f);
      const { screens } = turn.pass(0);
      pages.forEach((page, index) => expect(screens[index]).toEqual({ kind: 'review', page, index, total: pages.length }));
      const after = screens.slice(pages.length);
      if (d === 'nova') expect(after).toEqual([{ kind: 'nova-splash' }, { kind: 'blank' }]);
      else expect(after).toEqual([{ kind: 'registered', text: 'Address verified' }, { kind: 'app-home', ...ledgerAppHome('testnet') }, { kind: 'blank' }]);
      expect(turn.starts).toHaveLength(screens.length);
      expect(turn.pass(3)).toEqual(turn.pass(0));
      expect(turn.stillFrom).toBe(pages.length - 1);
      // The device's own motion: none on a Ledger; the Nova's address, its last page, carried along as it is swiped.
      expect({ d, progress: turn.pass(0).progress }).toEqual({ d, progress: null });
      expect({ d, scrolled: turn.pass(0).scrolls?.map((s) => s.page) ?? [] }).toEqual({ d, scrolled: d === 'nova' ? [pages.length - 1] : [] });
    }
  });

  it('the pace: each page its reading time, the last its device’s own confirmation, the word and the home, then gone', () => {
    for (const d of HINTED) {
      const turn = turnOf(d);
      const pages = addressPages(d, factsFor(d));
      let t = 0;
      pages.forEach((p, i) => {
        expect({ d, i, at: turn.starts[i] }).toEqual({ d, i, at: t });
        t += i === pages.length - 1 ? addressConfirmMs(d) : addressDwell(p);
      });
      const n = pages.length;
      if (d === 'nova') {
        expect(turn.starts.slice(n)).toEqual([t, t + NOVA_UNLOCK_MS.splash]);
        expect(turn.cycle).toBe(t + NOVA_UNLOCK_MS.splash + TURN_MS.gone);
      } else {
        expect(turn.starts.slice(n)).toEqual([t, t + ADDRESS_MS.verified, t + ADDRESS_MS.verified + TURN_MS.home]);
        expect(turn.cycle).toBe(t + ADDRESS_MS.verified + TURN_MS.home + TURN_MS.gone);
      }
    }
    // The last page: the address read then Confirm tapped; both buttons; the
    // Nova's address read, swiped along twice (the light lit before each
    // stroke, the finger off between, the light gone after), its end read
    // with the edge lighting inside that pause, then the edge tapped.
    expect(addressConfirmMs('gen5')).toBe(ADDRESS_MS.touch.read + HINT_MS.tap.lead);
    expect(addressConfirmMs('nanoX')).toBe(HINT_MS.both.wait + HINT_MS.both.press + HINT_MS.both.held);
    const sw = NOVA_SWIPE_MS;
    expect(addressConfirmMs('nova')).toBe(sw.read + 2 * (sw.lead + sw.stroke) + sw.lift + sw.fade + sw.settle);
    expect(addressConfirmMs('nova', 0)).toBe(sw.read + HINT_MS.tap.lead);
    // The end is still for most of a second before the top right edge lights, `HINT_MS.tap.lead` before the turn.
    expect(sw.settle - HINT_MS.tap.lead).toBeGreaterThanOrEqual(500);
    // The very page the signing review plays for an amount's address (decided 2026-10-05: "the same swipe"): one length, one builder.
    const review: TourFacts = { brand: 'bitbox', network: 'testnet', registeredName: 'Test 2/3 Oct', nameFirst: false, bitboxKind: NOVA.bitboxKind, outputs: [{ address: TEST_ADDRESS, amountSats: 5000 }], feeSats: 100, lockTime: null };
    const starts = tourStarts(reviewPages('nova', review));
    expect(starts[3] - starts[2]).toBe(addressConfirmMs('nova'));
    expect(addressConfirmMs('nova')).toBe(novaSwipePageMs(sw.strokes));
    // An address page gets longer than a name's; the address is read longer than the intro.
    expect(addressDwell({ kind: 'nano-item', title: 'Address (1/2)', value: 'x', long: true })).toBeGreaterThan(addressDwell({ kind: 'nano-item', title: 'Account name', value: 'x' }));
    expect(ADDRESS_MS.touch.read).toBeGreaterThan(ADDRESS_MS.touch.intro);
    expect(addressConfirmMs('nova')).toBeGreaterThan(ADDRESS_MS.nova.item);
    // The finger is off the edge for longer than the light takes to go, so one stroke's light never meets the next.
    expect(sw.lift).toBeGreaterThanOrEqual(sw.fade);
  });

  it('the touchscreens: "Tap" on the footer’s ">" (gone with the turn onto the address page, which draws none), then "Tap" on Confirm, gone with the page', () => {
    for (const d of TOUCH) {
      const turn = turnOf(d);
      const { cues, words } = turn.pass(0);
      const T = turn.starts[1];
      const at = turn.starts[2];
      expect(cues).toEqual([
        { controls: ['next'], in: T - HINT_MS.tap.lead, presses: [{ down: T - HINT_MS.tap.press, at: T }], out: T, withPage: true, still: 0 },
        { controls: ['confirm'], in: at - HINT_MS.tap.lead, presses: [{ down: at - HINT_MS.tap.press, at }], out: at, withPage: true, still: 1 },
      ]);
      expect(words).toEqual([
        { text: HINT_WORDS.tap, at: 'next', both: false, in: cues[0].in, out: T, withPage: true, still: 0 },
        { text: HINT_WORDS.tap, at: 'confirm', both: false, in: cues[1].in, out: at, withPage: true, still: 1 },
      ]);
    }
  });

  it('the Nano X: "Press" on the right button for every turn, then "Press both" on "Confirm"', () => {
    const turn = turnOf('nanoX');
    const n = addressPages('nanoX', LEDGER).length;
    const { cues, words } = turn.pass(0);
    expect(cues).toHaveLength(n);
    cues.slice(0, n - 1).forEach((c, i) => expect(c).toMatchObject({ controls: ['right'], presses: [{ at: turn.starts[i + 1] }], still: 0, out: turn.starts[i + 1] + HINT_MS.tap.fade }));
    const L = turn.starts[n - 1];
    const at = turn.starts[n];
    const m = HINT_MS.both;
    expect(cues[n - 1]).toEqual({ controls: ['right', 'left'], in: L + m.wait, presses: [{ down: L + m.wait + m.press, at }], out: at + m.fade, still: 1 });
    expect(words.map((w) => [w.text, w.at, w.both])).toEqual([...Array.from({ length: n - 1 }, () => [HINT_WORDS.press, 'right', false]), [HINT_WORDS.pressBoth, 'between', true]]);
  });

  it('the BitBox: "Tap" on the top right edge for every turn; on the address "Swipe" along the lower edge from right to left, twice, the line carried along; then "Tap" where the tick is', () => {
    const turn = turnOf('nova');
    const n = addressPages('nova', NOVA).length;
    const { cues, words, progress, scrolls } = turn.pass(0);
    const sw = NOVA_SWIPE_MS;
    expect(cues).toHaveLength(n - 1 + sw.strokes + 1);
    cues.slice(0, n - 1).forEach((c, i) => expect(c).toMatchObject({ controls: ['edgeTop'], presses: [{ at: turn.starts[i + 1] }], still: 0, out: turn.starts[i + 1] + HINT_MS.tap.fade }));
    // The swipes (decided 2026-10-04: "swiping from the right to the left on the
    // lower edge"): the light at the edge's right end, the finger down, one
    // stroke to the left end, off again; the second after a lift.
    const L = turn.starts[n - 1];
    const swipes = cues.slice(n - 1, n - 1 + sw.strokes);
    let t = L + sw.read;
    swipes.forEach((c, k) => {
      const down = t + sw.lead;
      const at = down + sw.stroke;
      expect({ k, cue: c }).toEqual({ k, cue: { controls: ['edgeAlong'], in: t, presses: [{ down, at }], out: at + sw.fade, swipe: { from: down, to: at } } });
      t = at + sw.lift;
    });
    // Then the tap on the top right edge, the page going with it.
    const at = turn.starts[n];
    expect(cues[cues.length - 1]).toEqual({ controls: ['edgeTop'], in: at - HINT_MS.tap.lead, presses: [{ down: at - HINT_MS.tap.press, at }], out: at, withPage: true, still: 1 });
    expect(words.map((w) => [w.text, w.at])).toEqual([...Array.from({ length: n - 1 }, () => [HINT_WORDS.tap, 'edgeTop']), ...swipes.map(() => [HINT_WORDS.swipe, 'edgeAlong']), [HINT_WORDS.tap, 'edgeTop']]);
    // Never a word about the swipe in Reduce Motion's stills: the stills show what moves on and what confirms.
    expect(words.filter((w) => w.text === HINT_WORDS.swipe).every((w) => w.still == null)).toBe(true);
    expect(words.some((w) => w.text === HINT_WORDS.hold || w.text === HINT_WORDS.holdBoth)).toBe(false);
    // One control, one cue at a time: each light has gone before the next on that control comes.
    for (let i = 1; i < cues.length; i++) {
      for (const o of cues.slice(0, i).filter((x) => x.controls[0] === cues[i].controls[0])) expect(o.out).toBeLessThanOrEqual(cues[i].in);
    }
    // The line is carried along as the finger moves: still at the page's start, half way after the first stroke, at its end after the second, there until the page goes, back at the start for the next pass.
    expect(progress).toBeNull();
    expect(scrolls).toHaveLength(1);
    const [sc] = scrolls!;
    expect(sc.page).toBe(n - 1);
    const line = novaAddressGroups(TEST_ADDRESS);
    expect(sc.travel).toBeCloseTo(novaScrollTravel(line), 5);
    expect(sc.travel).toBeCloseTo(novaScrollWidth(line) - NOVA_SCROLL_WINDOW, 5);
    expect(sc.travel).toBeGreaterThan(NOVA_SCROLL_WINDOW);
    const [s0, s1] = swipes;
    expect(valueAt(sc.scroll, L)).toBe(0);
    expect(valueAt(sc.scroll, s0.presses[0].down)).toBe(0);
    expect(valueAt(sc.scroll, (s0.presses[0].down + s0.presses[0].at) / 2)).toBeCloseTo(0.25, 5);
    expect(valueAt(sc.scroll, s0.presses[0].at)).toBeCloseTo(0.5, 5);
    expect(valueAt(sc.scroll, s1.presses[0].down)).toBeCloseTo(0.5, 5);
    expect(valueAt(sc.scroll, s1.presses[0].at)).toBe(1);
    expect(valueAt(sc.scroll, at - 1)).toBe(1);
    expect(valueAt(sc.scroll, turn.cycle)).toBe(0);
    expect(sc.scroll.still).toEqual([0, 0]);
  });

  it('a line that fits the Nova\u2019s screen is never swiped: no stroke, no motion, the page read then the edge tapped', () => {
    const fits = addressFacts(VAULT, 'tb1qshort', 'Test 2/3 Oct', 'bitbox');
    expect(novaSwipeStrokes(NOVA)).toBe(NOVA_SWIPE_MS.strokes);
    expect(novaSwipeStrokes(fits)).toBe(0);
    const turn = deviceTurn('nova', 'address', 'testnet', null, fits)!;
    const n = addressPages('nova', fits).length;
    const { cues, words, progress, scrolls } = turn.pass(0);
    expect(progress).toBeNull();
    expect(scrolls ?? []).toEqual([]);
    expect(cues).toHaveLength(n);
    expect(cues.every((c) => c.controls[0] === 'edgeTop' && c.swipe == null)).toBe(true);
    expect(words.every((w) => w.text === HINT_WORDS.tap)).toBe(true);
    expect(turn.starts[n] - turn.starts[n - 1]).toBe(addressConfirmMs('nova', 0));
  });

  it('the slab: its one page, still, no hint', () => {
    const turn = turnOf('slab');
    expect(turn.cycle).toBe(0);
    expect(turn.starts).toEqual([0]);
    expect(turn.pass(0)).toMatchObject({ cues: [], words: [], progress: null });
    expect(turn.pass(0).screens).toEqual([{ kind: 'review', page: { kind: 'slab-address' }, index: 0, total: 1 }]);
  });

  it('every pass on one clock: nothing lit at either end; Reduce Motion shows what moves on, then what confirms', () => {
    for (const d of HINTED) {
      const turn = turnOf(d);
      const p = turn.pass(0);
      const plan = planFromCues(deviceHint(d)!, p.cues, p.words, p.progress, turn.cycle);
      for (const c of [...plan.lit.flatMap((l) => [l.ring, l.fill]), ...plan.words.map((w) => w.opacity)]) {
        expect({ d, start: valueAt(c, 0), end: valueAt(c, turn.cycle) }).toEqual({ d, start: 0, end: 0 });
      }
      const shown = (side: 0 | 1) => plan.lit.filter((l) => l.ring.still[side] === 1).map((l) => l.control);
      const said = (side: 0 | 1) => plan.words.filter((w) => w.opacity.still[side] === 1).map((w) => w.text);
      if (d === 'nova') {
        expect(shown(0)).toEqual(['edgeTop']);
        expect(shown(1)).toEqual(['edgeTop']);
        expect(said(0)).toEqual([HINT_WORDS.tap]);
        expect(said(1)).toEqual([HINT_WORDS.tap]);
      } else if (d === 'nanoX') {
        expect(shown(0)).toEqual(['right']);
        expect(shown(1).sort()).toEqual(['left', 'right']);
        expect(said(0)).toEqual([HINT_WORDS.press]);
        expect(said(1)).toEqual([HINT_WORDS.pressBoth]);
      } else {
        expect(shown(0)).toEqual(['next']);
        expect(shown(1)).toEqual(['confirm']);
        expect(said(0)).toEqual([HINT_WORDS.tap]);
        expect(said(1)).toEqual([HINT_WORDS.tap]);
      }
    }
  });
});

describe('the words', () => {
  it('step 3 of the plan, "Verify the address", on every device; what confirms on each model’s last page; the address sits above the device on the check’s screen; the slab’s line for every model', () => {
    for (const d of TOUCH) {
      expect(turnWords(d, 'address', 'bitcoin')).toEqual({ step: 3, title: '3. Verify the address', line: 'Check the address on the Ledger against the one above, then tap Confirm.' });
    }
    expect(turnWords('nanoX', 'address', 'bitcoin')).toEqual({ step: 3, title: '3. Verify the address', line: 'Check the address on the Ledger against the one above, then press both buttons on “Confirm”.' });
    expect(turnWords('slab', 'address', 'bitcoin')).toEqual({ step: 3, title: '3. Verify the address', line: 'Check the address on the Ledger against the one above and confirm it there.' });
    expect(turnWords('nova', 'address', 'bitcoin')).toEqual({
      step: 3,
      title: '3. Verify the address',
      line: 'Check the address on the BitBox against the one above, swiping along its lower edge to see the rest, then tap the top right edge.',
    });
    for (const d of DEVICE_DRAWINGS) {
      for (const network of ['bitcoin', 'testnet'] as const) {
        const w = turnWords(d, 'address', network);
        // The same words on every network: the address check names no app.
        expect(w).toEqual(turnWords(d, 'address', 'bitcoin'));
        expect(w.line).not.toBeNull();
        expect(w.line).not.toMatch(/[—–]/);
        expect(w.line!.endsWith('.')).toBe(true);
        // Never a claim about which page the device is on, nor whose key it holds.
        expect(w.line).not.toMatch(/\b(is showing|now showing|your key|our key)\b/i);
        expect(w.title).not.toMatch(/Your turn/);
      }
    }
  });
});
