/**
 * The device in the client's hand, as the signing ceremony draws it (design
 * A "The courier", decided 2026-10-03): the drawing per model, the pages per model
 * and vault kind, the gesture words, the compare card and every sentence.
 */
import {
  DEVICE_DRAWINGS,
  HOLD_PAGE_MS,
  LEDGER_MODEL_IDS,
  NOVA_SWIPE_MS,
  NOVA_TOTAL_MS,
  NOVA_TOTAL_PAGE_MS,
  TOUCH_ACCOUNT,
  TOUCH_SIGN_MS,
  TOUCH_SIGN_PAGE_MS,
  bitboxRegisteredName,
  bitboxVaultKind,
  compareRows,
  courierWords,
  deviceAmount,
  deviceUnit,
  drawingFor,
  drawingOfModel,
  gestureLine,
  nameRows,
  novaAddressGroups,
  novaSwipePageMs,
  novaSwipeStrokesFor,
  novaSwipesMs,
  reviewPages,
  screenFor,
  shownOutputs,
  stopLine,
  tourCycle,
  tourFactsFor,
  tourNextTurnIn,
  tourPageAt,
  tourStarts,
} from '../signingDevice';
import type { DeviceDrawing, ReviewPage, TourFacts, TourSource } from '../signingDevice';
import { startCeremony } from '../signingCeremony';
import type { CeremonyLeg, CeremonyState } from '../signingCeremony';
import { composeMultisig, composeSinglesig } from '../../../bitcoin/descriptor/compose';
import { TPUB_A, TPUB_B, TPUB_C } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

const TO = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const TO_2 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

/** A PSBT holding one unsigned transaction of one input and no output, for its lock time alone. */
function minimalPsbt(tx: { lockTime: number; sequence: number }): string {
  const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const unsigned = [
    ...u32(2), // version
    1, // one input
    ...new Array<number>(32).fill(0xab), // previous txid
    ...u32(0), // vout
    0, // empty scriptSig
    ...u32(tx.sequence),
    0, // no outputs
    ...u32(tx.lockTime),
  ];
  const bytes = [
    0x70, 0x73, 0x62, 0x74, 0xff, // "psbt" + 0xff
    1, 0x00, // key: type 0 (unsigned tx)
    unsigned.length, ...unsigned,
    0, // end of the global map
    0, // end of the one input's map
  ];
  return Buffer.from(bytes).toString('base64');
}

/** A classic 2-of-3, as the BitBox tests below build theirs. */
const MULTI_DESC = composeMultisig(
  2,
  [
    { fingerprint: '73c5da0a', originPath: "48'/0'/0'/2'", xpub: TPUB_A },
    { fingerprint: 'aabbccdd', originPath: "48'/0'/0'/2'", xpub: TPUB_B },
    { fingerprint: '11223344', originPath: "48'/0'/0'/2'", xpub: TPUB_C },
  ],
  { script: 'wsh' },
);

const LEDGER_SRC: TourSource = {
  brand: 'ledger',
  network: 'bitcoin',
  descriptor: MULTI_DESC,
  label: 'Family vault',
  registeredName: 'Family vault',
  nameFirst: false,
  parsed: null,
  psbt: '',
};

const LEDGER_MULTI: TourFacts = {
  brand: 'ledger',
  network: 'bitcoin',
  registeredName: 'Family vault',
  nameFirst: false,
  bitboxKind: null,
  outputs: [{ address: TO, amountSats: 1_250_000 }],
  feeSats: 1200,
  lockTime: { lockTime: 921380, rbf: true },
};
const LEDGER_SINGLE: TourFacts = { ...LEDGER_MULTI, registeredName: null };
const NOVA_MULTI: TourFacts = {
  ...LEDGER_MULTI,
  brand: 'bitbox',
  bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 },
};
const NOVA_POLICY: TourFacts = { ...NOVA_MULTI, bitboxKind: { kind: 'policy', keys: 3 } };
const NOVA_SINGLE: TourFacts = { ...NOVA_MULTI, registeredName: null, bitboxKind: { kind: 'single' } };

const kinds = (pages: ReviewPage[]) => pages.map((p) => p.kind);

describe('which drawing', () => {
  it('every model the Ledger kit can report maps to a drawing', () => {
    for (const id of LEDGER_MODEL_IDS) expect(DEVICE_DRAWINGS).toContain(drawingFor('ledger', id));
    expect(drawingFor('ledger', 'apexp')).toBe('gen5');
    expect(drawingFor('ledger', 'flex')).toBe('flex');
    expect(drawingFor('ledger', 'stax')).toBe('stax');
    expect(drawingFor('ledger', 'nanoX')).toBe('nanoX');
  });

  it('an unknown or missing model is the plain slab; a BitBox over Bluetooth is a Nova', () => {
    expect(drawingFor('ledger', 'nanoS')).toBe('slab');
    expect(drawingFor('ledger', 'nanoSP')).toBe('slab');
    expect(drawingFor('ledger', 'somethingNew')).toBe('slab');
    expect(drawingFor('ledger', undefined)).toBe('slab');
    expect(drawingFor('ledger', null)).toBe('slab');
    expect(drawingFor('bitbox', 'apexp')).toBe('nova');
    expect(drawingFor('bitbox')).toBe('nova');
  });

  it('every drawing is reachable', () => {
    const reached = new Set<DeviceDrawing>([...LEDGER_MODEL_IDS.map((id) => drawingFor('ledger', id)), drawingFor('bitbox')]);
    expect([...reached].sort()).toEqual([...DEVICE_DRAWINGS].sort());
  });
});

describe('the devices’ own print', () => {
  it('amounts with up to eight decimals and no trailing zeros', () => {
    expect(deviceAmount(1_250_000, 'BTC')).toBe('0.0125 BTC');
    expect(deviceAmount(1200, 'BTC')).toBe('0.000012 BTC');
    expect(deviceAmount(100_000_000, 'BTC')).toBe('1 BTC');
    expect(deviceAmount(123_456_789, 'TBTC')).toBe('1.23456789 TBTC');
    expect(deviceAmount(0, 'BTC')).toBe('0 BTC');
  });

  it('the unit off the main network: the Ledger’s test app says TEST, the BitBox TBTC', () => {
    expect(deviceUnit('ledger', 'bitcoin')).toBe('BTC');
    expect(deviceUnit('ledger', 'testnet')).toBe('TEST');
    expect(deviceUnit('bitbox', 'signet')).toBe('TBTC');
  });

  it('the Nova prints the WHOLE address in groups of four, one line it scrolls (decided 2026-10-05), never its first groups alone', () => {
    expect(novaAddressGroups(TO)).toBe('bc1q xy2k gdyg jrsq tzq2 n0yr f249 3p83 kkfj hx0w lh');
    expect(novaAddressGroups('')).toBe('');
  });
});

describe('the BitBox’s first page, decided from the descriptor', () => {
  const A = { fingerprint: '73c5da0a', originPath: "48'/0'/0'/2'", xpub: TPUB_A };
  const B = { fingerprint: 'aabbccdd', originPath: "48'/0'/0'/2'", xpub: TPUB_B };
  const C = { fingerprint: '11223344', originPath: "48'/0'/0'/2'", xpub: TPUB_C };

  it('a plain k-of-n is the classic multisig ("2-of-3 BTC multisig")', () => {
    expect(bitboxVaultKind(composeMultisig(2, [A, B, C], { script: 'wsh' }), 'Family')).toEqual({
      kind: 'multisig',
      threshold: 2,
      keys: 3,
    });
  });

  it('a one-key vault has no such page', () => {
    expect(bitboxVaultKind(composeSinglesig({ ...A, originPath: "84'/0'/0'" }), 'Savings')).toEqual({ kind: 'single' });
  });

  it('any other shape is a policy with its keys counted', () => {
    const tr = `tr([3442193e/48'/1'/0'/2']${TPUB_A}/<0;1>/*,{multi_a(2,[cc000007/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_C}/<0;1>/*)})`;
    expect(bitboxVaultKind(tr, 'Vault')).toEqual({ kind: 'policy', keys: 3 });
    const timelocked = `wsh(or_d(pk([73c5da0a/48'/0'/0'/2']${TPUB_A}/<0;1>/*),and_v(v:pkh([aabbccdd/48'/0'/0'/2']${TPUB_B}/<0;1>/*),older(52560))))`;
    expect(bitboxVaultKind(timelocked, 'Vault')).toEqual({ kind: 'policy', keys: 2 });
  });

  it('a descriptor the device cannot take is nothing at all', () => {
    expect(bitboxVaultKind('not a descriptor', 'x')).toBeNull();
  });
});

describe('the review pages', () => {
  it('a touchscreen: the four pages, the registered vault named on the second', () => {
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      const pages = reviewPages(d, LEDGER_MULTI);
      expect(kinds(pages)).toEqual(['touch-intro', 'touch-output', 'touch-fees', 'touch-sign']);
      expect(pages[1]).toEqual({ kind: 'touch-output', account: TOUCH_ACCOUNT, name: 'Family vault', amount: '0.0125 BTC', to: TO });
      expect(pages[2]).toEqual({ kind: 'touch-fees', account: null, name: null, fee: '0.000012 BTC' });
    }
  });

  it('a touchscreen, single-sig: no account line (the device names no plain account)', () => {
    const pages = reviewPages('gen5', LEDGER_SINGLE);
    expect(pages[1]).toMatchObject({ account: null, name: null });
  });

  it('the Nano X: one item per page, the account only for a registered vault', () => {
    const multi = reviewPages('nanoX', LEDGER_MULTI);
    expect(kinds(multi)).toEqual(['nano-intro', 'nano-item', 'nano-item', 'nano-item', 'nano-item', 'nano-sign']);
    expect(multi.filter((p) => p.kind === 'nano-item').map((p) => (p.kind === 'nano-item' ? p.title : ''))).toEqual([
      'From account',
      'Amount',
      'To',
      'Fees',
    ]);
    expect(reviewPages('nanoX', LEDGER_SINGLE)).toHaveLength(5);
  });

  it('two recipients: each gets its amount and its address', () => {
    const two = { ...LEDGER_MULTI, outputs: [...LEDGER_MULTI.outputs, { address: TO_2, amountSats: 5000 }] };
    expect(kinds(reviewPages('gen5', two))).toEqual(['touch-intro', 'touch-output', 'touch-output', 'touch-fees', 'touch-sign']);
    expect(reviewPages('gen5', two)[2]).toMatchObject({ account: null, amount: '0.00005 BTC', to: TO_2 });
  });

  it('the Nova, a plain multisig: as the photos read', () => {
    const pages = reviewPages('nova', NOVA_MULTI);
    expect(pages.slice(0, 2)).toEqual([
      { kind: 'nova-item', title: 'Spend from', body: '2-of-3\nBTC multisig' },
      { kind: 'nova-item', title: 'Spend from', body: 'Family vault' },
    ]);
    // The whole address as one scrolling line, never cut to its first groups (decided 2026-10-05).
    expect(pages[2]).toEqual({ kind: 'nova-output', amount: '0.0125 BTC', to: novaAddressGroups(TO) });
    expect(pages[3]).toEqual({ kind: 'nova-text', body: 'Locktime on block:\n921380\nTransaction is RBF' });
    // Total = what leaves plus the fee.
    expect(pages[4]).toEqual({ kind: 'nova-total', total: '0.012512 BTC', fee: '0.000012 BTC' });
  });

  it('the Nova, a policy vault: the policy pages', () => {
    const pages = reviewPages('nova', NOVA_POLICY);
    expect(pages.slice(0, 2)).toEqual([
      { kind: 'nova-item', title: 'Spend from', body: 'BTC\npolicy with\n3 keys' },
      { kind: 'nova-item', title: 'Name', body: 'Family vault' },
    ]);
  });

  it('the Nova, single-sig and off the main network', () => {
    const pages = reviewPages('nova', { ...NOVA_SINGLE, network: 'testnet', lockTime: { lockTime: 0, rbf: true } });
    // No vault page, and no lock time page for a lock time of zero.
    expect(kinds(pages)).toEqual(['nova-output', 'nova-total']);
    expect(pages[0]).toMatchObject({ amount: '0.0125 TBTC' });
    expect(reviewPages('nova', { ...NOVA_MULTI, network: 'testnet' })[0]).toMatchObject({ body: '2-of-3\nBTC Testnet multisig' });
  });

  it('a self-transfer (a refresh, a cancel): no recipient page, and the Nova’s Total is the fee alone', () => {
    const self = { ...LEDGER_MULTI, outputs: shownOutputs([{ address: 'bc1own', amountSats: 7_000, isOwn: true }]) };
    expect(kinds(reviewPages('gen5', self))).toEqual(['touch-intro', 'touch-fees', 'touch-sign']);
    expect(kinds(reviewPages('nanoX', self))).toEqual(['nano-intro', 'nano-item', 'nano-item', 'nano-sign']);
    const nova = reviewPages('nova', { ...NOVA_MULTI, outputs: self.outputs });
    expect(kinds(nova)).not.toContain('nova-output');
    expect(nova.at(-1)).toEqual({ kind: 'nova-total', total: '0.000012 BTC', fee: '0.000012 BTC' });
  });

  it('Bitcoin app 2.2.1 to 2.4.1 asked the name on its own page: the review names no account', () => {
    const old = { ...LEDGER_MULTI, nameFirst: true };
    expect(reviewPages('gen5', old)[1]).toMatchObject({ kind: 'touch-output', account: null, name: null });
    const nano = reviewPages('nanoX', old);
    expect(nano.map((p) => (p.kind === 'nano-item' ? p.title : p.kind))).toEqual([
      'nano-intro',
      'Amount',
      'To',
      'Fees',
      'nano-sign',
    ]);
    // The name was compared on its own page: the review's card does not ask
    // for it again, the name page's card does.
    expect(compareRows(old).map((r) => r.label)).toEqual(['Amount', 'Address']);
    expect(nameRows(old)).toEqual([{ label: 'Vault', value: 'Family vault' }]);
    // A self-transfer on such an app: no Vault row in the review's card, the fee alone.
    expect(compareRows({ ...old, outputs: [] })).toEqual([{ label: 'Fee', value: '0.000012 BTC' }]);
  });

  it('the Nova with no name Talia knows: the vault-kind page, and no empty name page', () => {
    for (const f of [NOVA_MULTI, NOVA_POLICY]) {
      const pages = reviewPages('nova', { ...f, registeredName: null });
      expect(pages[0]).toMatchObject({ kind: 'nova-item', title: 'Spend from' });
      expect(pages[1]).toMatchObject({ kind: 'nova-output' });
      expect(pages.filter((p) => p.kind === 'nova-item' && p.body === '')).toEqual([]);
    }
    expect(compareRows({ ...NOVA_MULTI, registeredName: null }).map((r) => r.label)).toEqual(['Amount', 'Address']);
  });

  it('an unknown Ledger: one page, in the words every model starts with', () => {
    expect(kinds(reviewPages('slab', LEDGER_MULTI))).toEqual(['slab-review']);
  });

  it('every device ends on its signing page', () => {
    expect(reviewPages('gen5', LEDGER_MULTI).at(-1)?.kind).toBe('touch-sign');
    expect(reviewPages('nanoX', LEDGER_MULTI).at(-1)?.kind).toBe('nano-sign');
    expect(reviewPages('nova', NOVA_MULTI).at(-1)?.kind).toBe('nova-total');
  });
});

describe('the page tour: at a reading pace, then round again from the first page', () => {
  it('keeps the design’s timings', () => {
    expect(tourStarts(reviewPages('gen5', LEDGER_MULTI))).toEqual([0, 1800, 4400, 6000]);
    expect(tourStarts(reviewPages('nanoX', LEDGER_MULTI))).toEqual([0, 1600, 3200, 4800, 6400, 8000]);
    // The Nova's amount page plays the address's swipe (decided 2026-10-05): 6.1 s, as the address check's address page.
    const swipe = novaSwipePageMs(NOVA_SWIPE_MS.strokes);
    expect(swipe).toBe(6100);
    expect(tourStarts(reviewPages('nova', NOVA_MULTI))).toEqual([0, 1800, 3600, 3600 + swipe, 5400 + swipe]);
  });

  it('the Nova’s amount page: the address read, two strokes along the lower edge, its end read, the page held for all of it; a line that fits is simply read (decided 2026-10-05)', () => {
    const sw = NOVA_SWIPE_MS;
    expect(novaSwipeStrokesFor(novaAddressGroups(TO))).toBe(sw.strokes);
    expect(novaSwipeStrokesFor(novaAddressGroups(TO_2))).toBe(sw.strokes);
    expect(novaSwipeStrokesFor('bc1q shor t')).toBe(0);
    expect(novaSwipesMs(sw.strokes)).toBe(2 * (sw.lead + sw.stroke) + sw.lift + sw.fade);
    expect(novaSwipesMs(0)).toBe(0);
    expect(novaSwipePageMs(sw.strokes)).toBe(sw.read + novaSwipesMs(sw.strokes) + sw.settle);
    // The finger is off the edge for longer than the light takes to go.
    expect(sw.lift).toBeGreaterThanOrEqual(sw.fade);
    // Each amount's page is held for its whole swipe; one that fits keeps the reading pace.
    const two = { ...NOVA_MULTI, outputs: [...NOVA_MULTI.outputs, { address: TO_2, amountSats: 5000 }] };
    const starts = tourStarts(reviewPages('nova', two));
    expect(starts[3] - starts[2]).toBe(novaSwipePageMs(sw.strokes));
    expect(starts[4] - starts[3]).toBe(novaSwipePageMs(sw.strokes));
    const fits = tourStarts(reviewPages('nova', { ...NOVA_MULTI, outputs: [{ address: 'bc1qshort', amountSats: 5000 }] }));
    expect(fits[3] - fits[2]).toBe(2200);
    // Every other Nova page keeps its pace.
    expect(starts.slice(0, 3)).toEqual([0, 1800, 3600]);
  });

  it('holds the last page as long as the longest page, and at least HOLD_PAGE_MS, then a pass is over', () => {
    expect(HOLD_PAGE_MS).toBe(2600);
    // Gen5: "Hold to sign" plays its own sequence (the press, the line filling
    // through the hold, the page ghosting into "Signing transaction": 3.25 s,
    // the recording), longer than the address page (2600).
    expect(TOUCH_SIGN_PAGE_MS).toBe(3250);
    expect(tourCycle(reviewPages('gen5', LEDGER_MULTI))).toBe(6000 + TOUCH_SIGN_PAGE_MS);
    // Nano X: every page is 1.6 s, too short to show a press of both
    // buttons: "Sign transaction" stays HOLD_PAGE_MS.
    expect(tourCycle(reviewPages('nanoX', LEDGER_MULTI))).toBe(8000 + HOLD_PAGE_MS);
    // Nova: Total plays its two-edge hold and the confirmation (5.05 s), and
    // is held as long as the longest page, the swiped amount page (6.1 s).
    const swipe = novaSwipePageMs(NOVA_SWIPE_MS.strokes);
    expect(swipe).toBeGreaterThan(NOVA_TOTAL_PAGE_MS);
    expect(tourCycle(reviewPages('nova', NOVA_MULTI))).toBe(5400 + 2 * swipe);
    // With nothing to swipe (a self-transfer) Total's own sequence is the longest page.
    expect(tourCycle(reviewPages('nova', { ...NOVA_MULTI, outputs: [] }))).toBe(5400 + NOVA_TOTAL_PAGE_MS);
    // One page (a Ledger of unknown model) has nothing to step through.
    expect(tourCycle(reviewPages('slab', LEDGER_MULTI))).toBe(0);
  });

  it('the last page stays at least HOLD_PAGE_MS on every device and every vault', () => {
    for (const d of DEVICE_DRAWINGS.filter((x) => x !== 'slab')) {
      for (const f of [LEDGER_MULTI, LEDGER_SINGLE, NOVA_MULTI, NOVA_POLICY, NOVA_SINGLE, { ...NOVA_SINGLE, outputs: [], lockTime: null }]) {
        const pages = reviewPages(d, f);
        const starts = tourStarts(pages);
        const cycle = tourCycle(pages);
        expect({ d, last: cycle - starts[starts.length - 1] >= HOLD_PAGE_MS }).toEqual({ d, last: true });
      }
    }
  });

  it('the Nova’s Total page plays the two-edge hold at a pace a grandfather can follow', () => {
    // About a second for each step, a little more for the arrows to meet.
    expect(NOVA_TOTAL_MS.top).toBeGreaterThanOrEqual(900);
    expect(NOVA_TOTAL_MS.both).toBeGreaterThanOrEqual(900);
    expect(NOVA_TOTAL_MS.meet).toBeGreaterThanOrEqual(1000);
    expect(NOVA_TOTAL_MS.confirmed).toBeGreaterThanOrEqual(900);
    expect(NOVA_TOTAL_PAGE_MS).toBe(Object.values(NOVA_TOTAL_MS).reduce((a, b) => a + b, 0));
    expect(NOVA_TOTAL_PAGE_MS).toBeGreaterThan(HOLD_PAGE_MS);
    // A one-key vault refreshing with no lock time: Total is the only page,
    // and it still goes round, so the hold is shown again and again.
    const only = reviewPages('nova', { ...NOVA_SINGLE, outputs: [], lockTime: null });
    expect(kinds(only)).toEqual(['nova-total']);
    expect(tourCycle(only)).toBe(NOVA_TOTAL_PAGE_MS);
    expect(tourNextTurnIn(tourStarts(only), 100, tourCycle(only))).toBe(NOVA_TOTAL_PAGE_MS - 100);
    expect(tourPageAt(tourStarts(only), NOVA_TOTAL_PAGE_MS + 5, tourCycle(only))).toBe(0);
  });

  it('the touchscreens’ last page plays the hold as the recording shows it, at a pace to follow', () => {
    // Read, pressed, held about a second and a half while the line fills,
    // then "Signing transaction" for most of a second before the tour starts again.
    expect(TOUCH_SIGN_MS.read).toBeGreaterThanOrEqual(400);
    expect(TOUCH_SIGN_MS.press).toBeGreaterThanOrEqual(300);
    expect(TOUCH_SIGN_MS.hold).toBeGreaterThanOrEqual(1200);
    expect(TOUCH_SIGN_MS.signing).toBeGreaterThanOrEqual(800);
    expect(TOUCH_SIGN_PAGE_MS).toBe(Object.values(TOUCH_SIGN_MS).reduce((a, b) => a + b, 0));
    expect(TOUCH_SIGN_PAGE_MS).toBeGreaterThan(HOLD_PAGE_MS);
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      for (const f of [LEDGER_MULTI, LEDGER_SINGLE, { ...LEDGER_MULTI, outputs: [] }]) {
        const pages = reviewPages(d, f);
        const starts = tourStarts(pages);
        expect(tourCycle(pages) - starts[starts.length - 1]).toBe(TOUCH_SIGN_PAGE_MS);
      }
    }
  });

  it('loops back to page 1 after the last, for as long as the turn lasts', () => {
    const pages = reviewPages('gen5', LEDGER_MULTI);
    const starts = tourStarts(pages);
    const cycle = tourCycle(pages);
    expect(tourPageAt(starts, 0, cycle)).toBe(0);
    expect(tourPageAt(starts, 1799, cycle)).toBe(0);
    expect(tourPageAt(starts, 1800, cycle)).toBe(1);
    expect(tourPageAt(starts, 6000, cycle)).toBe(3);
    // The last page plays its whole hold (9250 = 6000 + 3250)...
    expect(cycle).toBe(9250);
    expect(tourPageAt(starts, cycle - 1, cycle)).toBe(3);
    // ...then the first page again, and every page again in order.
    expect(tourPageAt(starts, cycle, cycle)).toBe(0);
    expect(tourPageAt(starts, cycle + 1800, cycle)).toBe(1);
    expect(tourPageAt(starts, cycle + 6000, cycle)).toBe(3);
    // Ten minutes in, still going round (600000 = 64 passes + 8000: page 3).
    expect(tourPageAt(starts, 600_000, cycle)).toBe(3);
    expect(tourPageAt(starts, 64 * cycle + 100, cycle)).toBe(0);
    // Every page is shown on every pass.
    const seen = new Set<number>();
    for (let t = 3 * cycle; t < 4 * cycle; t += 100) seen.add(tourPageAt(starts, t, cycle));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('the next turn of the page is timed on the turn’s own clock', () => {
    const pages = reviewPages('nova', NOVA_MULTI);
    const starts = tourStarts(pages);
    const cycle = tourCycle(pages);
    const L = starts[starts.length - 1];
    expect(tourNextTurnIn(starts, 0, cycle)).toBe(1800);
    expect(tourNextTurnIn(starts, 1900, cycle)).toBe(1700);
    // From the last page, the next turn is back to the first.
    expect(tourNextTurnIn(starts, L, cycle)).toBe(cycle - L);
    expect(tourPageAt(starts, L + tourNextTurnIn(starts, L, cycle)!, cycle)).toBe(0);
    // A late timer still lands on the right page.
    expect(tourNextTurnIn(starts, cycle + 50, cycle)).toBe(1750);
    // One page never turns.
    expect(tourNextTurnIn([0], 5000, 0)).toBeNull();
    expect(tourPageAt([0], 5000, 0)).toBe(0);
  });
});

describe('the drawn screen per leg', () => {
  const at = (leg: CeremonyLeg, extra: Partial<CeremonyState> = {}): CeremonyState => ({ ...startCeremony(0), leg, ...extra });

  it('loading, the tour or the name, signing then signed, rejected, and blank when the phone lost it', () => {
    expect(screenFor(at('send'), LEDGER_MULTI)).toEqual({ kind: 'loading' });
    expect(screenFor(at('approve'), LEDGER_MULTI)).toBe('tour');
    expect(screenFor(at('approve', { asks: 'name' }), LEDGER_MULTI)).toEqual({ kind: 'name', name: 'Family vault' });
    expect(screenFor(at('return'), LEDGER_MULTI)).toEqual({ kind: 'signing' });
    expect(screenFor(at('return', { signed: true }), LEDGER_MULTI)).toEqual({ kind: 'signed' });
    expect(screenFor(at('declined'), LEDGER_MULTI)).toEqual({ kind: 'rejected' });
    // A lost device: the phone cannot say what is on it.
    expect(screenFor(at('failed'), LEDGER_MULTI)).toEqual({ kind: 'blank' });
  });
});

describe('the card to compare against', () => {
  it('the amount in the device’s print, the address shortened, the registered name', () => {
    expect(compareRows(LEDGER_MULTI)).toEqual([
      { label: 'Amount', value: '0.0125 BTC' },
      { label: 'Address', value: 'bc1qxy2k…hx0wlh', mono: true },
      { label: 'Vault', value: 'Family vault' },
    ]);
  });

  it('no Vault row for a single-sig: the device names no plain account', () => {
    expect(compareRows(LEDGER_SINGLE).map((r) => r.label)).toEqual(['Amount', 'Address']);
    expect(compareRows(NOVA_SINGLE).map((r) => r.label)).toEqual(['Amount', 'Address']);
  });

  it('in the device’s unit off the main network, and numbered for two recipients', () => {
    expect(compareRows({ ...NOVA_MULTI, network: 'testnet' })[0].value).toBe('0.0125 TBTC');
    expect(compareRows({ ...LEDGER_MULTI, network: 'testnet' })[0].value).toBe('0.0125 TEST');
    const two = { ...LEDGER_SINGLE, outputs: [...LEDGER_SINGLE.outputs, { address: TO_2, amountSats: 5000 }] };
    expect(compareRows(two).map((r) => r.label)).toEqual(['Amount 1', 'Address 1', 'Amount 2', 'Address 2']);
  });

  it('while the device asks for the name first: the name alone', () => {
    expect(nameRows(LEDGER_MULTI)).toEqual([{ label: 'Vault', value: 'Family vault' }]);
  });

  it('lists what leaves the vault, and only that', () => {
    const own = { address: 'bc1own', amountSats: 7, isOwn: true };
    const away = { address: TO, amountSats: 9, isOwn: false };
    expect(shownOutputs([own, away])).toEqual([{ address: TO, amountSats: 9 }]);
    // A refresh or a cancel pays the vault's change branch: the device sees a
    // self-transfer and prints no recipient, so nothing is listed.
    expect(shownOutputs([own])).toEqual([]);
  });

  it('a self-transfer (a refresh, a cancel) compares the fee, the one figure the device prints, after the name; nothing at all when the fee is unknown', () => {
    // The refresh pays the vault's change branch, so the device prints no
    // amount and no address: "it shows only the network fee" (the refresh
    // session's own words), and that is what the client checks.
    expect(compareRows({ ...LEDGER_SINGLE, outputs: [] })).toEqual([{ label: 'Fee', value: '0.000012 BTC' }]);
    expect(compareRows({ ...LEDGER_MULTI, outputs: [] })).toEqual([
      { label: 'Vault', value: 'Family vault' },
      { label: 'Fee', value: '0.000012 BTC' },
    ]);
    // In the device's own unit off the main network, as the Nova prints its Total.
    expect(compareRows({ ...NOVA_SINGLE, network: 'testnet', outputs: [] })).toEqual([{ label: 'Fee', value: '0.000012 TBTC' }]);
    // A fee the phone could not read is not invented: no card then.
    expect(compareRows({ ...LEDGER_SINGLE, outputs: [], feeSats: null })).toEqual([]);
    // A payment is checked by its amount and address: no fee row joins them.
    expect(compareRows(LEDGER_MULTI).map((r) => r.label)).toEqual(['Amount', 'Address', 'Vault']);
  });

  it('tourFactsFor reads a transaction the one way for every screen: what leaves the vault, the fee, the lock time, the BitBox’s first page', () => {
    const desc = MULTI_DESC;
    const parsed = {
      outputs: [
        { address: 'bc1own', amountSats: 7_000, isOwn: true },
        { address: TO, amountSats: 9_000, isOwn: false },
      ],
      feeSats: 1_200,
    };
    const facts = tourFactsFor({ brand: 'bitbox', network: 'testnet', descriptor: desc, label: 'Family vault', registeredName: 'Stored name', nameFirst: false, parsed, psbt: 'not a psbt' });
    expect(facts).toEqual({
      brand: 'bitbox',
      network: 'testnet',
      registeredName: 'Stored name',
      nameFirst: false,
      bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 },
      outputs: [{ address: TO, amountSats: 9_000 }],
      feeSats: 1_200,
      lockTime: null,
    });
    // A Ledger has no BitBox page; a transaction that could not be read leaves nothing to compare, never a guess.
    const ledger = tourFactsFor({ brand: 'ledger', network: 'bitcoin', descriptor: desc, label: 'Family vault', registeredName: null, nameFirst: true, parsed: null, psbt: '' });
    expect(ledger).toMatchObject({ bitboxKind: null, outputs: [], feeSats: null, lockTime: null, nameFirst: true });
    // A refresh leg: every output the vault's own, so the card asks for the fee alone (and the name where the device prints one).
    const refresh = tourFactsFor({ brand: 'ledger', network: 'testnet', descriptor: desc, label: 'Family vault', registeredName: 'Family vault', nameFirst: false, parsed: { outputs: [parsed.outputs[0]], feeSats: 1_200 }, psbt: '' });
    expect(compareRows(refresh)).toEqual([
      { label: 'Vault', value: 'Family vault' },
      { label: 'Fee', value: '0.000012 TEST' },
    ]);
    // The lock time is the transaction's own (psbtLockTime), read from the PSBT handed over.
    const psbt = minimalPsbt({ lockTime: 921_380, sequence: 0xfffffffd });
    expect(tourFactsFor({ ...LEDGER_SRC, psbt }).lockTime).toEqual({ lockTime: 921_380, rbf: true });
    expect(tourFactsFor({ ...LEDGER_SRC, psbt: minimalPsbt({ lockTime: 0, sequence: 0xffffffff }) }).lockTime).toEqual({ lockTime: 0, rbf: false });
  });

  it('a self-transfer on a touchscreen still draws the name the card asks for, on the fee page', () => {
    const pages = reviewPages('gen5', { ...LEDGER_MULTI, outputs: [] });
    expect(pages.find((p) => p.kind === 'touch-fees')).toMatchObject({ account: 'From registered account', name: 'Family vault' });
    // With a recipient page the name rides there, never twice.
    const paying = reviewPages('gen5', LEDGER_MULTI);
    expect(paying.find((p) => p.kind === 'touch-fees')).toMatchObject({ account: null, name: null });
    // A one-key vault names no account anywhere.
    expect(reviewPages('gen5', { ...LEDGER_SINGLE, outputs: [] }).find((p) => p.kind === 'touch-fees')).toMatchObject({
      account: null,
      name: null,
    });
  });
});

describe('the name a BitBox stored', () => {
  it('is the one Talia kept at registration, never today’s label', () => {
    const regs = { '73c5da0a': { registeredAt: 1, name: 'Test 2/3 Oct' }, aabbccdd: { registeredAt: 2 } };
    expect(bitboxRegisteredName(regs, '73C5DA0A')).toBe('Test 2/3 Oct');
    // Registered elsewhere, or before the name was kept: none.
    expect(bitboxRegisteredName(regs, 'aabbccdd')).toBeNull();
    expect(bitboxRegisteredName(regs, '11223344')).toBeNull();
    expect(bitboxRegisteredName(undefined, '73c5da0a')).toBeNull();
    expect(bitboxRegisteredName({ '73c5da0a': { registeredAt: 1, name: '' } }, '73c5da0a')).toBeNull();
  });
});

describe('the words', () => {
  const LEGS: CeremonyLeg[] = ['send', 'approve', 'return', 'declined', 'failed'];

  it('the gesture per model, and the all-models sentence for an unknown one', () => {
    expect(gestureLine('nanoX', LEDGER_MULTI)).toBe('Press the right button to move through the pages. On “Sign transaction”, press both buttons.');
    // The press hint lights the footer's own ">" (design C, decided 2026-10-03).
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      expect(gestureLine(d, LEDGER_MULTI)).toBe('Tap the arrow at the bottom to move through the pages. On the last page, hold to sign.');
    }
    expect(gestureLine('slab', LEDGER_MULTI)).toBe('Move through the pages on the Ledger. Approve on the last page.');
    // Decided 2026-10-03: the bottom edge is held too, once the top is. Decided
    // 2026-10-05: the address is swiped along the lower edge to its end, in
    // a few words, said only where a page is swiped.
    expect(gestureLine('nova', NOVA_MULTI)).toBe(
      'Tap the top right edge to move through its pages. Swipe along the lower edge to see the whole address. On the Total page, hold the top right edge, then the bottom right edge too.',
    );
    expect(gestureLine('nova', { ...NOVA_MULTI, outputs: [...NOVA_MULTI.outputs, { address: TO_2, amountSats: 5000 }] })).toBe(
      'Tap the top right edge to move through its pages. Swipe along the lower edge to see each address in full. On the Total page, hold the top right edge, then the bottom right edge too.',
    );
    // A self-transfer shows no address, so nothing is swiped and the line says nothing of it.
    expect(gestureLine('nova', { ...NOVA_MULTI, outputs: [] })).toBe(
      'Tap the top right edge to move through its pages. On the Total page, hold the top right edge, then the bottom right edge too.',
    );
    expect(stopLine('ledger')).toBe('To stop, reject on the Ledger.');
    expect(stopLine('bitbox')).toBe('To stop, tap the × on the BitBox.');
  });

  it('a Nova whose only page is Total has nothing to move through, and its line says nothing of it (decided 2026-10-04)', () => {
    // A one-key BitBox vault refreshing with no lock time: Total alone, round and round.
    const totalOnly: TourFacts = { ...NOVA_SINGLE, outputs: [], lockTime: null };
    expect(kinds(reviewPages('nova', totalOnly))).toEqual(['nova-total']);
    const line = 'On the Total page, hold the top right edge, then the bottom right edge too.';
    expect(gestureLine('nova', totalOnly)).toBe(line);
    expect(courierWords('nova', 'K', { ...startCeremony(0), leg: 'approve' }, totalOnly).body).toBe(line);
    // Every device and vault shape: "move through" only where the drawing
    // has pages to move through. (The slab is one stand-in page for a
    // Ledger of unknown model; its line speaks of that device's own pages.)
    const shapes = [LEDGER_MULTI, LEDGER_SINGLE, { ...LEDGER_MULTI, outputs: [] }, NOVA_MULTI, NOVA_POLICY, NOVA_SINGLE, totalOnly];
    for (const d of DEVICE_DRAWINGS.filter((x) => x !== 'slab')) {
      for (const f of shapes) {
        const several = reviewPages(d, f).length > 1;
        expect({ d, f, moves: /move through/.test(gestureLine(d, f)) }).toEqual({ d, f, moves: several });
      }
    }
  });

  it('the three screens and the endings, as designed', () => {
    const s = startCeremony(0);
    expect(courierWords('gen5', 'Seed-B_Ledger', s, LEDGER_MULTI)).toMatchObject({
      title: 'Seed-B_Ledger',
      line: 'Sending the transaction to the Ledger.',
    });
    // The client's turn is step 3 of the device's plan (decided 2026-10-05: the
    // PIN, the app, then the job), numbered as every turn page is.
    expect(courierWords('gen5', 'K', { ...s, leg: 'approve' }, LEDGER_MULTI)).toEqual({
      title: '3. Sign the transaction',
      line: null,
      compareTitle: 'Compare on the Ledger',
      body: 'Tap the arrow at the bottom to move through the pages. On the last page, hold to sign.',
      caption: 'To stop, reject on the Ledger.',
    });
    expect(courierWords('gen5', 'K', { ...s, leg: 'return' }, LEDGER_MULTI).line).toBe('Receiving the signed transaction.');
    // Once the send starts, every device says the same thing.
    expect(courierWords('gen5', 'K', { ...s, leg: 'return', signed: true, sending: true }, LEDGER_MULTI).line).toBe(
      'Signed. Sending it to the network.',
    );
    expect(courierWords('gen5', 'K', { ...s, leg: 'declined' }, LEDGER_MULTI)).toMatchObject({
      title: 'Not signed',
      line: 'You declined on the Ledger. Nothing was sent.',
    });
    // A failure says what happened, in the connection flow's own words.
    const gone = 'The Ledger disconnected. Bring it close to the phone and reconnect.';
    expect(courierWords('gen5', 'K', { ...s, leg: 'failed', failure: 'x' }, LEDGER_MULTI, gone)).toMatchObject({ title: 'Not signed', line: gone });
    expect(courierWords('nova', 'K', { ...s, leg: 'approve' }, NOVA_MULTI).title).toBe('3. Sign the transaction');
    // The travelling screens keep the key's name: the number marks the client's own action.
    expect(courierWords('nova', 'K', s, NOVA_MULTI).title).toBe('K');
    expect(courierWords('nova', 'K', { ...s, leg: 'return' }, NOVA_MULTI).title).toBe('K');
    expect(courierWords('nova', 'K', s, NOVA_MULTI).line).toBe('Handing the transaction to the BitBox.');
  });

  it('a restarted way there says so', () => {
    expect(courierWords('gen5', 'K', { ...startCeremony(0), restarted: true }, LEDGER_MULTI).line).toBe(
      'The Ledger needs the full transaction. Sending it again.',
    );
  });

  it('a transaction of a batch is counted where the line names it, and the client’s turn keeps "3." (decided 2026-10-05: "keep 3")', () => {
    const second = startCeremony(0, { index: 2, count: 3 });
    // The way there.
    expect(courierWords('gen5', 'K', second, LEDGER_MULTI).line).toBe('Sending transaction 2 of 3 to the Ledger.');
    expect(courierWords('nova', 'K', second, NOVA_MULTI).line).toBe('Handing transaction 2 of 3 to the BitBox.');
    // The restart keeps its own sentence: the count was said as it went.
    expect(courierWords('gen5', 'K', { ...second, restarted: true }, LEDGER_MULTI).line).toBe('The Ledger needs the full transaction. Sending it again.');
    // The client's turn: the same title as every signing, the count opening
    // the line under the card, where the session's step line always had it.
    const turn = courierWords('gen5', 'K', { ...second, leg: 'approve' }, LEDGER_MULTI);
    expect(turn.title).toBe('3. Sign the transaction');
    expect(turn.body).toBe('Transaction 2 of 3. Tap the arrow at the bottom to move through the pages. On the last page, hold to sign.');
    expect(turn.compareTitle).toBe('Compare on the Ledger');
    expect(courierWords('nanoX', 'K', { ...second, leg: 'approve', asks: 'name' }, LEDGER_MULTI).body).toBe(
      'Transaction 2 of 3. The Ledger asks about this vault first. Check its name, then approve it there.',
    );
    expect(courierWords('nova', 'K', { ...second, leg: 'approve' }, NOVA_MULTI).title).toBe('3. Sign the transaction');
    // The way back.
    expect(courierWords('gen5', 'K', { ...second, leg: 'return' }, LEDGER_MULTI).line).toBe('Receiving signed transaction 2 of 3.');
    expect(courierWords('nova', 'K', { ...second, leg: 'return' }, NOVA_MULTI).line).toBe('Transaction 2 of 3 signed on the BitBox.');
    // The endings hold for a batch: the session sends nothing until every one is signed.
    expect(courierWords('gen5', 'K', { ...second, leg: 'declined' }, LEDGER_MULTI).line).toBe('You declined on the Ledger. Nothing was sent.');
    // The travelling screens keep the key's name; the count never becomes a title.
    for (const leg of ['send', 'return'] as const) expect(courierWords('gen5', 'K', { ...second, leg }, LEDGER_MULTI).title).toBe('K');
    // A payment of one is worded as before.
    expect(courierWords('gen5', 'K', startCeremony(0), LEDGER_MULTI).line).toBe('Sending the transaction to the Ledger.');
    expect(courierWords('gen5', 'K', { ...startCeremony(0), leg: 'approve' }, LEDGER_MULTI).body).toBe(gestureLine('gen5', LEDGER_MULTI));
  });

  it('the BitBox says it is sending only once it is: a spend that needs another key is not sent', () => {
    const back = { ...startCeremony(0), leg: 'return' as const, signed: true };
    expect(courierWords('nova', 'K', back, NOVA_MULTI).line).toBe('Signed on the BitBox.');
    expect(courierWords('nova', 'K', { ...back, sending: true }, NOVA_MULTI).line).toBe('Signed. Sending it to the network.');
  });

  it('the name asked first is its own turn, never the transaction’s gesture', () => {
    const w = courierWords('nanoX', 'K', { ...startCeremony(0), leg: 'approve', asks: 'name' }, LEDGER_MULTI);
    expect(w.body).toBe('The Ledger asks about this vault first. Check its name, then approve it there.');
  });

  it('never an em dash, and no claim that the drawing shows the device’s current page', () => {
    const all: string[] = [];
    for (const d of DEVICE_DRAWINGS) {
      for (const f of [LEDGER_MULTI, NOVA_MULTI, NOVA_SINGLE, { ...NOVA_SINGLE, outputs: [], lockTime: null }]) {
        all.push(gestureLine(d, f));
        for (const leg of LEGS) {
          for (const extra of [{}, { restarted: true }, { asks: 'name' as const }, { signed: true, sending: true }]) {
            const w = courierWords(d, 'Key', { ...startCeremony(0), leg, ...extra }, f);
            all.push(...[w.title, w.line, w.body, w.caption, w.compareTitle].filter((x): x is string => x != null));
          }
        }
      }
      for (const f of [LEDGER_MULTI, NOVA_MULTI, NOVA_POLICY]) {
        // What the page prints, never its kind (a code name).
        for (const p of reviewPages(d, f)) {
          all.push(...Object.entries(p).flatMap(([k, v]) => (k !== 'kind' && typeof v === 'string' ? [v] : [])));
        }
      }
    }
    all.push(stopLine('ledger'), stopLine('bitbox'));
    expect(all.filter((x) => /[—–]/.test(x))).toEqual([]);
    expect(all.filter((x) => /Your turn/.test(x))).toEqual([]);
    expect(all.filter((x) => /(shows|showing) (now|right now)|is on this page|current page/i.test(x))).toEqual([]);
    // Plain language: never inputs, outputs or outpoints.
    expect(all.filter((x) => /\b(inputs?|outputs?|outpoints?|PSBT)\b/.test(x))).toEqual([]);
  });
});

describe('which drawing a model is', () => {
  it('the registry names the models by the drawings; the Passport is drawn nowhere yet; an unlisted Ledger is the slab', () => {
    expect(drawingOfModel('gen5')).toBe('gen5');
    expect(drawingOfModel('nanoX')).toBe('nanoX');
    expect(drawingOfModel('nova')).toBe('nova');
    expect(drawingOfModel('passport')).toBeNull();
    expect(drawingOfModel(null)).toBeNull();
    expect(drawingFor('ledger', 'apexp')).toBe('gen5');
    expect(drawingFor('ledger', 'nanoSP')).toBe('slab');
    expect(drawingFor('bitbox', null)).toBe('nova');
  });
});
