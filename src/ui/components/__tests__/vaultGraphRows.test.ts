/**
 * The builder's draft as the Estate Plan's graph, one step at a time.
 *
 * What these pin: an empty slot is drawn empty and never guessed; our keys
 * are stand-ins until creation and say so, and are called "21st Capital",
 * no more; an unanswered question is an outline that goes away on "no";
 * the client's slots come first and ours last; waits sit on the PDF's own
 * scale; each step draws its own lanes and the axis exists only while a
 * drawn lane waits; the glyph column and the key card are laid out from one
 * arithmetic; and no string a client reads carries an em dash or the real
 * network's name.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import type { KeyOrigin } from '../../../bitcoin/descriptor';
import {
  ADD_KEY_LABEL,
  COSIGNER_LABEL,
  LANE_METRICS,
  OWN_OPTION_LABEL,
  MILESTONES,
  NOT_CHOSEN,
  RESCUE_LABEL,
  TEST_LOCK_LABEL,
  HEIR_TEST_LOCK_LABEL,
  HEIR_TEST_LOCK_PERCENT,
  TEST_LOCK_PERCENT,
  dashedPercent,
  focusedRows,
  keyBlockLines,
  laneLayout,
  timelineShown,
  vaultGraphRows,
} from '../vaultGraphRows';
import type { GraphKey, VaultDraft } from '../vaultGraphRows';

const XPUB =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDU9SjX5rBHf7Qc1oQjw6QXjMU82VNsGrkH2QcyzXTGGB';
const key = (fingerprint: string): KeyOrigin => ({ fingerprint, originPath: "48'/0'/0'/2'", xpub: XPUB });

const A = key('73c5da0a');
const B = key('a1b2c3d4');
const OURS = key('21c0ffee');
const HEIR = key('deadbeef');

/** A 2-of-3 with our co-signer, nothing placed, nothing answered: step 2. */
const fresh = (over: Partial<VaultDraft> = {}): VaultDraft => ({
  ownKeys: 2,
  threshold: 2,
  userKeys: [],
  coSignerMode: '21c',
  coSignerKey: null,
  inheritance: null,
  heirs: [{ method: 'key', months: 12 }],
  rescue: null,
  rescueKey: null,
  rescueMonths: 15,
  testLockMonths: 0,
  keyLabels: {},
  ...over,
});

const labels = (rows: ReturnType<typeof vaultGraphRows>['rows']) =>
  rows.map((r) => r.keys.map((k) => `${k.label}:${k.state}`));

describe('the outline, before any key is added', () => {
  it('shows every slot of a 2-of-3 empty, our co-signer pending, and both questions open', () => {
    const g = vaultGraphRows(fresh());
    expect(g.rows.map((r) => r.id)).toEqual(['primary', 'heirs', 'rescue']);
    expect(g.rows.map((r) => r.lane)).toEqual(['primary', 'heir', 'rescue']);
    expect(g.rows[0].title).toBe('Primary Keys 2/3:');
    expect(g.rows[0].numIcons).toBe(3);
    expect(g.rows[0].dashedPercent).toBe(0);
    expect(g.rows[0].state).toBe('open');
    expect(labels(g.rows)[0]).toEqual(['Your key 1:empty', 'Your key 2:empty', `${COSIGNER_LABEL}:pending`]);
    expect(g.rows[1]).toMatchObject({ title: 'Heirs', state: 'undecided', hint: NOT_CHOSEN, keys: [] });
    expect(g.rows[2]).toMatchObject({ title: RESCUE_LABEL, state: 'undecided', hint: NOT_CHOSEN, keys: [] });
    expect(g.complete).toBe(false);
    expect(g.emptySlots).toBe(2);
  });

  it('an empty slot carries no fingerprint, so nothing can be read into it', () => {
    const g = vaultGraphRows(fresh());
    for (const k of g.rows[0].keys) {
      if (k.state === 'empty') expect(k.fingerprint).toBeUndefined();
    }
  });

  it('a 2-of-2 has one slot of the client’s plus the second key', () => {
    const g = vaultGraphRows(fresh({ ownKeys: 1, threshold: 2 }));
    expect(g.rows[0].title).toBe('Primary Keys 2/2:');
    expect(labels(g.rows)[0]).toEqual(['Your key:empty', `${COSIGNER_LABEL}:pending`]);
  });

  it('a one-key vault has one slot and no co-signer, whatever the mode says', () => {
    const g = vaultGraphRows(fresh({ ownKeys: 1, threshold: 1, coSignerMode: '21c' }));
    expect(g.rows[0].title).toBe('Primary Key 1/1:');
    expect(g.rows[0].numIcons).toBe(1);
    expect(labels(g.rows)[0]).toEqual(['Your key:empty']);
  });
});

describe('filling the primary path', () => {
  it('a placed key takes the client’s own label and its fingerprint in upper case', () => {
    const g = vaultGraphRows(fresh({ userKeys: [A], keyLabels: { '73c5da0a': 'Office Ledger' } }));
    expect(g.rows[0].keys[0]).toEqual({
      label: 'Office Ledger',
      fingerprint: '73C5DA0A',
      state: 'placed',
      slot: { kind: 'user', index: 0 },
    });
    expect(g.rows[0].keys[1]).toEqual({ label: 'Your key 2', state: 'empty', slot: { kind: 'user', index: 1 } });
    expect(g.emptySlots).toBe(1);
  });

  it('a placed key without a label keeps the slot’s name', () => {
    const g = vaultGraphRows(fresh({ userKeys: [A, B] }));
    expect(g.rows[0].keys.map((k) => k.label)).toEqual(['Your key 1', 'Your key 2', COSIGNER_LABEL]);
  });

  it('"I hold it myself" turns our pending key into an empty slot of the client’s', () => {
    const g = vaultGraphRows(fresh({ coSignerMode: 'self' }));
    expect(labels(g.rows)[0]).toEqual(['Your key 1:empty', 'Your key 2:empty', 'Your extra key:empty']);
    expect(g.emptySlots).toBe(3);
    const placed = vaultGraphRows(
      fresh({ coSignerMode: 'self', userKeys: [A, B], coSignerKey: HEIR, keyLabels: { deadbeef: 'Safe box' } }),
    );
    expect(placed.rows[0].keys[2]).toEqual({
      label: 'Safe box',
      fingerprint: 'DEADBEEF',
      state: 'placed',
      slot: { kind: 'coSigner' },
    });
    expect(placed.rows[0].keys[2].ours).toBeUndefined();
  });

  it('our fetched co-signer becomes a placed key with its fingerprint, still last, still "21st Capital"', () => {
    // The screen's label map calls it "21st Capital co-signer"; the graph
    // says the short name whatever the map holds (the full one takes too much space).
    const g = vaultGraphRows(
      fresh({ userKeys: [A, B], coSignerKey: OURS, keyLabels: { '21c0ffee': '21st Capital co-signer' } }),
    );
    expect(g.rows[0].keys[2]).toEqual({
      label: '21st Capital',
      fingerprint: '21C0FFEE',
      state: 'placed',
      ours: true,
      slot: { kind: 'coSigner' },
    });
    expect(COSIGNER_LABEL).toBe('21st Capital');
  });

  it('the client’s keys come first and ours last, whatever the input order', () => {
    const g = vaultGraphRows(fresh({ userKeys: [B, A], coSignerKey: OURS }));
    expect(g.rows[0].keys.map((k) => k.fingerprint)).toEqual(['A1B2C3D4', '73C5DA0A', '21C0FFEE']);
  });
});

describe('heirs', () => {
  it('"No, skip inheritance" removes the outline and adds nothing', () => {
    const g = vaultGraphRows(fresh({ inheritance: false }));
    expect(g.rows.map((r) => r.id)).toEqual(['primary', 'rescue']);
  });

  it('an heir holding a key is a lane with an empty slot until the key is added', () => {
    const g = vaultGraphRows(fresh({ inheritance: true }));
    const heir = g.rows.find((r) => r.id === 'heir-0');
    expect(heir).toMatchObject({
      lane: 'heir',
      title: 'Recovery Key 1/1:',
      numIcons: 1,
      state: 'waiting',
      dashedPercent: 50,
      months: 12,
      keys: [{ label: 'Heir 1 key', state: 'empty' }],
    });
    expect(heir?.waitLabel).toBeUndefined();
  });

  it('the heir’s key, once added, shows the name given to it', () => {
    const g = vaultGraphRows(
      fresh({ inheritance: true, heirs: [{ method: 'key', months: 8, key: HEIR }], keyLabels: { deadbeef: 'Toni' } }),
    );
    expect(g.rows.find((r) => r.id === 'heir-0')?.keys).toEqual([
      { label: 'Toni', fingerprint: 'DEADBEEF', state: 'placed' },
    ]);
    // An heir's key is added on its own step, never from the graph.
    expect(g.rows.find((r) => r.id === 'heir-0')?.keys[0].slot).toBeUndefined();
  });

  it('an assisted heir holds no key and has no lane', () => {
    const g = vaultGraphRows(fresh({ inheritance: true, heirs: [{ method: 'assisted', months: 12 }] }));
    expect(g.rows.map((r) => r.id)).toEqual(['primary', 'rescue']);
  });

  it('lanes are ordered by their wait, the rescue key after an heir at the same wait', () => {
    const g = vaultGraphRows(
      fresh({
        inheritance: true,
        heirs: [
          { method: 'key', months: 15 },
          { method: 'key', months: 8 },
          { method: 'assisted', months: 12 },
          { method: 'key', months: 10 },
        ],
        rescue: true,
      }),
    );
    expect(g.rows.map((r) => r.id)).toEqual(['primary', 'heir-1', 'heir-3', 'heir-0', 'rescue']);
    expect(g.rows.map((r) => r.dashedPercent)).toEqual([0, 25, 37.5, 75, 75]);
    expect(g.rows[1].keys[0].label).toBe('Heir 2 key');
    expect(g.rows[2].keys[0].label).toBe('Heir 4 key');
  });

  it('a wait in MONTHS is never written on the card, on or off a gridline', () => {
    // Decided 2026-09-25: "no need to mention the number of months as text on
    // the left even if its not the matching number from the top." The line
    // says when the lane opens and the axis names the months; the Estate
    // Plan PDF never printed it either.
    for (const months of [8, 9, 10, 11, 12, 13, 14, 15]) {
      const g = vaultGraphRows(fresh({ inheritance: true, heirs: [{ method: 'key', months }] }));
      expect(g.rows[1].waitLabel).toBeUndefined();
      expect(g.rows[1].months).toBe(months);
    }
    for (const m of MILESTONES) {
      const at = vaultGraphRows(fresh({ inheritance: true, heirs: [{ method: 'key', months: m.months }] }));
      expect(at.rows[1].dashedPercent).toBe(m.percent);
    }
  });

  it('an heir\'s test lock is a short, visible wait, never "open now"', () => {
    const g = vaultGraphRows(fresh({ inheritance: true, heirs: [{ method: 'key', months: 0 }] }));
    expect(g.rows[1]).toMatchObject({
      dashedPercent: HEIR_TEST_LOCK_PERCENT,
      months: null,
      waitLabel: HEIR_TEST_LOCK_LABEL,
      state: 'waiting',
    });
    expect(g.rows[1].dashedPercent).toBeGreaterThan(0);
  });

  it('an heir\'s test lock (2 blocks) is drawn before the rescue\'s (3 blocks), as 12 months before 15', () => {
    const g = vaultGraphRows(
      fresh({ inheritance: true, heirs: [{ method: 'key', months: 0 }], rescue: true, rescueTestLock: true }),
    );
    const heir = g.rows.find((r) => r.waitLabel === HEIR_TEST_LOCK_LABEL);
    const rescue = g.rows.find((r) => r.waitLabel === TEST_LOCK_LABEL);
    expect(heir).toBeDefined();
    expect(rescue).toBeDefined();
    expect(heir!.dashedPercent).toBeLessThan(rescue!.dashedPercent);
  });
});

describe('the rescue key', () => {
  it('"No, skip" leaves no lane', () => {
    const g = vaultGraphRows(fresh({ inheritance: false, rescue: false }));
    expect(g.rows.map((r) => r.id)).toEqual(['primary']);
  });

  it('"Yes" is a pending lane of ours at 15 months until the key arrives', () => {
    const g = vaultGraphRows(fresh({ inheritance: false, rescue: true }));
    expect(g.rows[1]).toMatchObject({
      id: 'rescue',
      lane: 'rescue',
      title: '21st Capital',
      state: 'waiting',
      dashedPercent: 75,
      months: 15,
      numIcons: 1,
      keys: [{ label: RESCUE_LABEL, state: 'pending' }],
    });
    expect(g.rows[1].keys[0].fingerprint).toBeUndefined();
  });

  it('the fetched rescue key shows its fingerprint and keeps the document’s name', () => {
    const g = vaultGraphRows(fresh({ inheritance: false, rescue: true, rescueKey: OURS }));
    expect(g.rows[1].keys).toEqual([{ label: RESCUE_LABEL, fingerprint: '21C0FFEE', state: 'placed', ours: true }]);
  });

  it('the rehearsal lock on the rescue key is drawn as the short wait', () => {
    const g = vaultGraphRows(fresh({ inheritance: false, rescue: true, rescueTestLock: true }));
    expect(g.rows[1]).toMatchObject({ dashedPercent: TEST_LOCK_PERCENT, waitLabel: TEST_LOCK_LABEL });
  });
});

describe('the final form', () => {
  it('is complete only once every slot is filled or pending and every question answered', () => {
    const steps: VaultDraft[] = [
      fresh(),
      fresh({ userKeys: [A, B] }),
      fresh({ userKeys: [A, B], inheritance: false }),
      fresh({ userKeys: [A, B], inheritance: true, rescue: true }),
    ];
    for (const s of steps) expect(vaultGraphRows(s).complete).toBe(false);
    const done = vaultGraphRows(
      fresh({ userKeys: [A, B], inheritance: true, heirs: [{ method: 'key', months: 12, key: HEIR }], rescue: true }),
    );
    expect(done.complete).toBe(true);
    expect(done.emptySlots).toBe(0);
    expect(done.rows.map((r) => r.state)).toEqual(['open', 'waiting', 'waiting']);
  });

  it('a fully self-custodial vault is complete with no pending key anywhere', () => {
    const g = vaultGraphRows(
      fresh({ coSignerMode: 'self', userKeys: [A, B], coSignerKey: HEIR, inheritance: false, rescue: false }),
    );
    expect(g.complete).toBe(true);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].keys.every((k) => k.state === 'placed')).toBe(true);
  });
});

describe('the slots the key step works in', () => {
  it('every primary key names its slot, ours flagged as ours, and nothing else does', () => {
    const g = vaultGraphRows(fresh({ inheritance: true, rescue: true }));
    expect(g.rows[0].keys.map((k) => k.slot)).toEqual([
      { kind: 'user', index: 0 },
      { kind: 'user', index: 1 },
      { kind: 'coSigner' },
    ]);
    expect(g.rows[0].keys.map((k) => k.ours ?? false)).toEqual([false, false, true]);
    for (const r of g.rows.slice(1)) for (const k of r.keys) expect(k.slot).toBeUndefined();
  });

  it('"I hold it myself" keeps the co-signer slot, now the client’s own', () => {
    const g = vaultGraphRows(fresh({ coSignerMode: 'self' }));
    expect(g.rows[0].keys[2]).toEqual({ label: 'Your extra key', state: 'empty', slot: { kind: 'coSigner' } });
  });
});

describe('who holds the extra key', () => {
  it('a 2-of-3 asks about the third key, ours active by default; a 2-of-2 about the second', () => {
    expect(vaultGraphRows(fresh()).rows[0].holder).toEqual({ active: 'ours', question: 'Who holds the third key?' });
    expect(vaultGraphRows(fresh({ ownKeys: 1, threshold: 2 })).rows[0].holder).toEqual({
      active: 'ours',
      question: 'Who holds the second key?',
    });
  });

  it('"I hold it myself" makes the client’s option the active one, and the vault holds only that', () => {
    const g = vaultGraphRows(fresh({ coSignerMode: 'self' }));
    expect(g.rows[0].holder).toEqual({ active: 'own', question: 'Who holds the third key?' });
    // The inactive option is not in the vault: the row lists one extra key.
    expect(g.rows[0].keys.map((k) => k.label)).toEqual(['Your key 1', 'Your key 2', 'Your extra key']);
    expect(g.rows[0].keys.filter((k) => k.slot?.kind === 'coSigner')).toHaveLength(1);
  });

  it('a one-key vault asks nothing', () => {
    expect(vaultGraphRows(fresh({ ownKeys: 1, threshold: 1 })).rows[0].holder).toBeUndefined();
  });
});

describe('one step, one path', () => {
  const full = vaultGraphRows(
    fresh({
      userKeys: [A, B],
      inheritance: true,
      heirs: [{ method: 'key', months: 12, key: HEIR }, { method: 'key', months: 15 }],
      rescue: true,
    }),
  ).rows;

  it('the key step draws the primary path alone', () => {
    expect(focusedRows(full, 'primary').map((r) => r.id)).toEqual(['primary']);
    expect(focusedRows(vaultGraphRows(fresh()).rows, 'primary').map((r) => r.id)).toEqual(['primary']);
  });

  it('the heirs step draws the heir lanes alone, the outline while the question is open', () => {
    expect(focusedRows(full, 'heirs').map((r) => r.id)).toEqual(['heir-0', 'heir-1']);
    expect(focusedRows(vaultGraphRows(fresh()).rows, 'heirs').map((r) => r.id)).toEqual(['heirs']);
    expect(focusedRows(vaultGraphRows(fresh({ inheritance: false })).rows, 'heirs')).toEqual([]);
    expect(
      focusedRows(vaultGraphRows(fresh({ inheritance: true, heirs: [{ method: 'assisted', months: 12 }] })).rows, 'heirs'),
    ).toEqual([]);
  });

  it('the rescue step draws the rescue lane alone, the outline while the question is open', () => {
    expect(focusedRows(full, 'rescue').map((r) => r.id)).toEqual(['rescue']);
    expect(focusedRows(vaultGraphRows(fresh()).rows, 'rescue').map((r) => r.state)).toEqual(['undecided']);
    expect(focusedRows(vaultGraphRows(fresh({ rescue: false })).rows, 'rescue')).toEqual([]);
  });

  it('the summary draws everything, in the order the lanes open', () => {
    expect(focusedRows(full, 'all').map((r) => r.id)).toEqual(['primary', 'heir-0', 'heir-1', 'rescue']);
    expect(focusedRows(full, 'all')).not.toBe(full);
  });
});

describe('the timeline: the axis, its gridlines and the arrowheads', () => {
  it('is not drawn while nothing on screen waits', () => {
    const rows = vaultGraphRows(fresh()).rows;
    expect(timelineShown(focusedRows(rows, 'primary'))).toBe(false);
    // Outlines have no wait yet.
    expect(timelineShown(focusedRows(rows, 'heirs'))).toBe(false);
    expect(timelineShown(focusedRows(rows, 'rescue'))).toBe(false);
    // A plain multisig with nothing timelocked never shows one, summary included.
    const plain = vaultGraphRows(fresh({ userKeys: [A, B], inheritance: false, rescue: false })).rows;
    expect(timelineShown(focusedRows(plain, 'all'))).toBe(false);
  });

  it('appears the moment a drawn lane waits', () => {
    const rows = vaultGraphRows(fresh({ inheritance: true, rescue: true })).rows;
    expect(timelineShown(focusedRows(rows, 'primary'))).toBe(false);
    expect(timelineShown(focusedRows(rows, 'heirs'))).toBe(true);
    expect(timelineShown(focusedRows(rows, 'rescue'))).toBe(true);
    expect(timelineShown(focusedRows(rows, 'all'))).toBe(true);
  });

  it('the drawing reads that one rule for the arrowheads too, and has no ACTIVE pill', () => {
    // Decided 2026-09-25: "on the primary layer, do not use any arrows at all",
    // "Drop the 'active' piller from all screens", "Only add the arrows as
    // soon as additional layers are added". A second rule could drift from
    // the axis's; the source is pinned to the one function.
    const src = readFileSync(join(__dirname, '..', 'VaultGraph.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/timelineShown\(rows\)/);
    expect(src).not.toMatch(/axisShown/);
    // The pill's own words and its styles: `holder.active`, `activeOpacity`
    // and the design system's `radius.pill` corner are not it.
    expect(src).not.toMatch(/\bACTIVE\b|\bAKTIV\b|styles\.pill\b|pillText|PILL_/);
  });
});

describe('the glyph sits on its key’s name, by arithmetic', () => {
  const placedKey: GraphKey = { label: 'Office Ledger', fingerprint: '73C5DA0A', state: 'placed' };
  const emptyKey: GraphKey = { label: 'Your key 2', state: 'empty' };
  const pendingKey: GraphKey = { label: '21st Capital', state: 'pending' };

  it('an empty slot is one line, a placed or pending key two', () => {
    expect(keyBlockLines(emptyKey)).toBe(1);
    expect(keyBlockLines(placedKey)).toBe(2);
    expect(keyBlockLines(pendingKey)).toBe(2);
    expect(keyBlockLines({ label: 'x', state: 'placed' })).toBe(1);
  });

  it('every block starts where the previous one ended plus the space, whatever the mix of heights', () => {
    const mixes: GraphKey[][] = [
      [emptyKey, emptyKey, pendingKey],
      [placedKey, emptyKey, pendingKey],
      [placedKey, placedKey, placedKey],
      [emptyKey],
      [placedKey, emptyKey, emptyKey, placedKey, pendingKey],
    ];
    // The metrics are a parameter, so a second rhythm can never drift from
    // the arithmetic; a doubled set proves it.
    const doubled = { padV: 14, titleH: 34, labelLh: 26, noteLh: 22, keySpace: 12 };
    for (const m of [LANE_METRICS, doubled]) {
      for (const keys of mixes) {
        const lay = laneLayout(keys, true, m);
        expect(lay.title).toEqual({ top: m.padV, height: m.titleH });
        let expectedTop = m.padV + m.titleH;
        lay.keys.forEach((b, i) => {
          if (i > 0) expectedTop += m.keySpace;
          expect(b.top).toBe(expectedTop);
          expect(b.height).toBe(m.labelLh + (keyBlockLines(keys[i]) === 2 ? m.noteLh : 0));
          // The glyph's centre is the name line's centre, never the block's.
          expect(b.nameCentre).toBe(b.top + m.labelLh / 2);
          expectedTop += b.height;
        });
        expect(lay.height).toBe(expectedTop + m.padV);
      }
    }
  });

  it('a lane without a title starts its first block right under the padding', () => {
    for (const m of [LANE_METRICS, { padV: 14, titleH: 34, labelLh: 26, noteLh: 22, keySpace: 12 }]) {
      const lay = laneLayout([placedKey], false, m);
      expect(lay.title.height).toBe(0);
      expect(lay.keys[0].top).toBe(m.padV);
      expect(lay.height).toBe(m.padV * 2 + m.labelLh + m.noteLh);
    }
    // The default is the picture's rhythm.
    expect(laneLayout([placedKey], false)).toEqual(laneLayout([placedKey], false, LANE_METRICS));
  });

  it('the key step’s words are a button and an option', () => {
    expect(ADD_KEY_LABEL).toBe('Add key');
    expect(OWN_OPTION_LABEL).toBe('Your own key');
  });
});

describe('the scale', () => {
  it('is the PDF’s own: 8 months at 25%, 12 at 50%, 15 at 75%', () => {
    expect(dashedPercent(8)).toBe(25);
    expect(dashedPercent(12)).toBe(50);
    expect(dashedPercent(15)).toBe(75);
    expect(dashedPercent(4)).toBe(12.5);
    expect(dashedPercent(10)).toBe(37.5);
    expect(dashedPercent(13.5)).toBe(62.5);
    expect(dashedPercent(0)).toBe(0);
    expect(dashedPercent(-3)).toBe(0);
    expect(dashedPercent(20)).toBe(95);
    expect(dashedPercent(40)).toBe(95);
  });
});

describe('what a client reads', () => {
  const shapes: VaultDraft[] = [
    fresh(),
    fresh({ ownKeys: 1, threshold: 2 }),
    fresh({ ownKeys: 1, threshold: 1, rescue: true }),
    fresh({ coSignerMode: 'self', inheritance: true, heirs: [{ method: 'key', months: 9 }, { method: 'key', months: 0 }], rescue: true, rescueTestLock: true }),
    fresh({ userKeys: [A, B], coSignerKey: OURS, inheritance: true, heirs: [{ method: 'key', months: 12, key: HEIR }], rescue: true, rescueKey: key('21c0e5c0') }),
  ];

  it('never carries an em dash or the real network’s name', () => {
    for (const s of shapes) {
      const text = JSON.stringify(vaultGraphRows(s));
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/mainnet/i);
    }
  });

  it('never calls one of our keys, or an heir’s, the client’s own, and never spells out "No key yet"', () => {
    for (const s of shapes) {
      for (const r of vaultGraphRows(s).rows) {
        for (const k of r.keys) {
          if (k.state === 'pending' || r.id === 'rescue' || r.id.startsWith('heir')) {
            expect(k.label.toLowerCase()).not.toContain('your');
          }
          expect(k.label).not.toMatch(/no key yet/i);
        }
      }
    }
  });

  it('the module’s own strings hold to the same rules', () => {
    const src = readFileSync(join(__dirname, '..', 'vaultGraphRows.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/—/);
    expect(src).not.toMatch(/['"`]Mainnet['"`]/);
  });
});
