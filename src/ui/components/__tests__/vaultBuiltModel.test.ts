/**
 * The "Vault built" page's timeline, lock and words (decided 2026-10-02, design B
 * "Keys into the lock", pace B2). Every vault shape the two builders make.
 */
import {
  composeLayeredVault,
  composeMultisig,
  composeSinglesig,
  monthsToBlocks,
} from '../../../bitcoin/descriptor/compose';
import type { KeyOrigin } from '../../../bitcoin/descriptor';
import { isInstant, progressAt } from '../sentPageModel';
import {
  easedTable,
  GLASS_IN,
  GLASS_SCALE_FROM,
  KEY_GAP_X,
  KEY_ICON,
  KEY_LABEL_SPACE,
  KEY_LABEL_TOP,
  KEY_LABEL_W,
  KEY_NAME_MIN_SCALE,
  KEY_START_Y,
  keyFlightWindow,
  keyRow,
  KEYS_FROM,
  LOCK_BOX,
  LOCK_R,
  lockGlass,
  lockPenPath,
  lockTurnTable,
  MIN_LOCK_BOX,
  NOTCH_DEG,
  ringDash,
  ringRadii,
  VAULT_BUILT_PACE,
  VAULT_BUILT_TITLE,
  VAULT_BUILT_TRACK_KEYS,
  vaultBuiltAnnouncement,
  vaultBuiltBox,
  vaultBuiltFacts,
  vaultBuiltLine,
  vaultBuiltPace,
  vaultBuiltPlan,
  vaultBuiltRows,
  vaultBuiltTimeline,
  vaultBuiltWords,
} from '../vaultBuiltModel';
import type { BuiltVault } from '../vaultBuiltModel';

// Checksum-valid test keys (the taproot composer decodes every key). Ours
// sorts FIRST by its xpub, so a descriptor lists it first: the page must
// still show it last.
const xpub = {
  ours: 'tpubD6NzVbkrYhZ4XJDrzRvuxHEyQaPd1mwwdDofEJwekX18tAdsqeKfxss79AJzg1431FybXg5rfpTrJF4iAhyR7RubberdzEQXiRmXGADH2eA',
  a: 'tpubD6NzVbkrYhZ4XKTpDpd55aveE9jaKSRetSgKpxsQeVys9ePqDdtLsFteg7VrWuew2sRoK6ACau4GDaY3CHoytheBCpPH28qkTt49iHXtXVg',
  b: 'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3',
  c: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
  heir1: 'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp',
  heir2: 'tpubD6NzVbkrYhZ4Yjkmt31ALcdHtYjKnpAvAzVbPZEMYuDeZb1a5S9sMfeaSz7TjSGWBbstfeKSGCHc7SDe5hcsDdxmmeQUaGDBbVMCPicvsec',
  rescue: 'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK',
};
const key = (fingerprint: string, k: string, path = "48'/1'/0'/2'"): KeyOrigin => ({
  fingerprint,
  originPath: path,
  xpub: k,
});
const A = key('a1b2c3d4', xpub.a);
const B = key('5e6f7a8b', xpub.b);
const C = key('0c0ffee0', xpub.c);
const OURS = key('21c0c051', xpub.ours);
const H1 = key('9c0d1e2f', xpub.heir1);
const H2 = key('3a4b5c6d', xpub.heir2);
const RESCUE = key('21c0e5c0', xpub.rescue);

/** The labels the wizard writes (LayeredVaultScreen's keyLabelByFp). */
const WIZARD_LABELS = {
  a1b2c3d4: 'Ledger Flex',
  '5e6f7a8b': 'BitBox02',
  '21c0c051': '21st Capital co-signer',
  // A device name the heir's key arrived with: never what the heir is called.
  '9c0d1e2f': 'test bitbox',
  '3a4b5c6d': 'Heir 2',
  '21c0e5c0': '21st Capital rescue key',
};

const single: BuiltVault = {
  label: 'Savings',
  descriptor: composeSinglesig(key('a1b2c3d4', xpub.a, "84'/1'/0'")),
  keyLabels: { a1b2c3d4: 'Ledger Flex' },
};
const selfCustody: BuiltVault = {
  label: 'Cold storage',
  descriptor: composeMultisig(2, [A, B, C], { script: 'wsh' }),
  keyLabels: { a1b2c3d4: 'Ledger Flex', '5e6f7a8b': 'BitBox02', '0c0ffee0': 'Jade' },
};
const coSigned: BuiltVault = {
  label: 'Company treasury',
  descriptor: composeMultisig(2, [A, B, OURS], { providerFingerprints: ['21c0c051'] }),
  keyLabels: WIZARD_LABELS,
  providerKeyFingerprints: ['21c0c051'],
};
const layered: BuiltVault = {
  label: 'Family vault',
  descriptor: composeLayeredVault({ threshold: 2, keys: [OURS, A, B] }, [
    { threshold: 1, keys: [RESCUE], olderBlocks: monthsToBlocks(15) },
    { threshold: 1, keys: [H2], olderBlocks: monthsToBlocks(12) },
    { threshold: 1, keys: [H1], olderBlocks: monthsToBlocks(8) },
  ]),
  keyLabels: WIZARD_LABELS,
  heirs: [
    { id: 'h1', fingerprint: '9c0d1e2f', months: 8 },
    { id: 'h2', fingerprint: '3a4b5c6d', months: 12 },
    // An assisted heir holds no key and has no path.
    { id: 'h3', months: 12 },
  ],
  providerKeyFingerprints: ['21c0c051', '21c0e5c0'],
};

describe('what the page says, for every vault the builders make', () => {
  it('a single key: "1 key", the key by its name, open the vault', () => {
    const f = vaultBuiltFacts(single);
    expect(f.name).toBe('Savings');
    expect(vaultBuiltLine(f)).toBe('1 key');
    expect(f.everyday.map((k) => k.name)).toEqual(['Ledger Flex']);
    expect(f.recoveryPaths).toBe(0);
    expect(vaultBuiltRows(f)).toEqual([{ label: 'Ledger Flex', value: 'A1B2C3D4', mono: true }]);
  });

  it('a self-custodial 2 of 3: the three keys by their names, no rings', () => {
    const f = vaultBuiltFacts(selfCustody);
    expect(vaultBuiltLine(f)).toBe('2 of 3 keys');
    expect(f.needed).toBe(2);
    expect(f.everyday.map((k) => k.name).sort()).toEqual(['BitBox02', 'Jade', 'Ledger Flex']);
    expect(f.everyday.every((k) => !k.ours)).toBe(true);
    expect(f.recoveryPaths).toBe(0);
  });

  it('a 2 of 3 with our co-signer: ours last, as the summary named it, even when the descriptor lists it first', () => {
    // The composer sorts by xpub, and ours sorts first.
    expect(coSigned.descriptor.indexOf(xpub.ours)).toBeLessThan(coSigned.descriptor.indexOf(xpub.a));
    const f = vaultBuiltFacts(coSigned);
    expect(vaultBuiltLine(f)).toBe('2 of 3 keys');
    expect(f.everyday.map((k) => k.name)).toEqual(['Ledger Flex', 'BitBox02', '21st Capital']);
    expect(f.everyday.map((k) => k.ours)).toEqual([false, false, true]);
  });

  it('layered with heirs and the rescue key: the paths by their wait, heirs as people, ours last', () => {
    const f = vaultBuiltFacts(layered);
    expect(vaultBuiltLine(f)).toBe('2 of 3 keys · 3 recovery paths');
    expect(f.everyday.map((k) => k.name)).toEqual(['Ledger Flex', 'BitBox02', '21st Capital']);
    expect(vaultBuiltRows(f)).toEqual([
      { label: 'Ledger Flex', value: 'A1B2C3D4', mono: true },
      { label: 'BitBox02', value: '5E6F7A8B', mono: true },
      { label: '21st Capital', value: '21C0C051', mono: true },
      // The heir's key arrived named "test bitbox": the row names the PERSON.
      { label: 'Heir 1 · after 8 months', value: '9C0D1E2F', mono: true },
      { label: 'Heir 2 · after 12 months', value: '3A4B5C6D', mono: true },
      { label: 'Rescue Key · after 15 months', value: '21C0E5C0', mono: true },
    ]);
    expect(vaultBuiltRows(f).some((r) => /test bitbox/.test(r.label))).toBe(false);
  });

  it('an heir the Estate Plan has named is called by their name', () => {
    const f = vaultBuiltFacts({
      ...layered,
      heirs: [{ id: 'h1', fingerprint: '9c0d1e2f', name: 'Toni Example', months: 8 }, ...(layered.heirs ?? []).slice(1)],
    });
    expect(vaultBuiltRows(f)[3].label).toBe('Toni Example · after 8 months');
  });

  it('one key with heirs and the rescue key: "1 key · 2 recovery paths"', () => {
    const f = vaultBuiltFacts({
      label: 'Legacy',
      descriptor: composeLayeredVault({ threshold: 1, keys: [A] }, [
        { threshold: 1, keys: [H1], olderBlocks: monthsToBlocks(8) },
        { threshold: 1, keys: [RESCUE], olderBlocks: monthsToBlocks(15) },
      ]),
      keyLabels: { a1b2c3d4: 'Your key' },
      heirs: [{ id: 'h1', fingerprint: '9c0d1e2f', months: 8 }],
      providerKeyFingerprints: ['21c0e5c0'],
    });
    expect(vaultBuiltLine(f)).toBe('1 key · 2 recovery paths');
    expect(f.everyday.map((k) => k.name)).toEqual(['Your key']);
    expect(vaultBuiltRows(f).map((r) => r.label)).toEqual([
      'Your key',
      'Heir 1 · after 8 months',
      'Rescue Key · after 15 months',
    ]);
  });

  it('a 2 of 2 with our co-signer: "2 of 2 keys"', () => {
    const f = vaultBuiltFacts({
      label: 'Joint',
      descriptor: composeLayeredVault({ threshold: 2, keys: [OURS, A] }, [
        { threshold: 1, keys: [RESCUE], olderBlocks: monthsToBlocks(15) },
      ]),
      keyLabels: WIZARD_LABELS,
      providerKeyFingerprints: ['21c0c051', '21c0e5c0'],
    });
    expect(vaultBuiltLine(f)).toBe('2 of 2 keys · 1 recovery path');
    expect(f.everyday.map((k) => k.name)).toEqual(['Ledger Flex', '21st Capital']);
  });

  it('the custom builder’s own recovery layer: its key by the name it was given, and when it opens', () => {
    const f = vaultBuiltFacts({
      label: 'Layers',
      descriptor: composeLayeredVault({ threshold: 1, keys: [A] }, [
        { threshold: 1, keys: [B], olderBlocks: monthsToBlocks(12) },
      ]),
      keyLabels: { a1b2c3d4: 'Ledger Flex', '5e6f7a8b': 'Backup Trezor' },
    });
    expect(vaultBuiltLine(f)).toBe('1 key · 1 recovery path');
    // Not ours, not an heir: never "Rescue Key".
    expect(vaultBuiltRows(f).map((r) => r.label)).toEqual(['Ledger Flex', 'Backup Trezor · after 12 months']);
  });

  it('the rehearsal lock says its real wait, never "0 months"', () => {
    const f = vaultBuiltFacts({
      ...layered,
      descriptor: composeLayeredVault({ threshold: 2, keys: [OURS, A, B] }, [
        { threshold: 1, keys: [RESCUE], olderBlocks: 3 },
      ]),
    });
    expect(vaultBuiltRows(f).at(-1)!.label).toBe('Rescue Key · after 30 minutes');
  });

  it('a lone key no builder named is "Your key", never its fingerprint', () => {
    const f = vaultBuiltFacts({ ...single, keyLabels: {} });
    expect(f.everyday.map((k) => k.name)).toEqual(['Your key']);
  });

  it('a policy it cannot read exactly claims no threshold and no paths', () => {
    const f = vaultBuiltFacts({
      label: 'Odd',
      descriptor: `wsh(thresh(2,pk([a1b2c3d4/48'/1'/0'/2']${xpub.a}/<0;1>/*),s:pk([5e6f7a8b/48'/1'/0'/2']${xpub.b}/<0;1>/*),sln:after(840000)))`,
      keyLabels: { a1b2c3d4: 'Ledger Flex', '5e6f7a8b': 'BitBox02' },
    });
    expect(f.needed).toBeNull();
    expect(f.recoveryPaths).toBe(0);
    expect(vaultBuiltLine(f)).toBe('2 keys');
  });

  it('the words: register when a device must learn the vault, else open it', () => {
    expect(vaultBuiltWords('register')).toEqual({
      title: 'Vault built',
      sub: 'Next, register it on your hardware so it can sign.',
      action: 'Register on hardware',
    });
    expect(vaultBuiltWords('open')).toEqual({
      title: 'Vault built',
      sub: 'Your vault is ready to receive.',
      action: 'Open the vault',
    });
    expect(VAULT_BUILT_TITLE).toBe('Vault built');
    expect(vaultBuiltAnnouncement(vaultBuiltFacts(layered))).toBe('Vault built. Family vault');
  });

  it('never writes an em or en dash', () => {
    const texts = [
      ...[single, selfCustody, coSigned, layered].flatMap((v) => {
        const f = vaultBuiltFacts(v);
        return [vaultBuiltLine(f), vaultBuiltAnnouncement(f), ...vaultBuiltRows(f).map((r) => r.label)];
      }),
      ...Object.values(vaultBuiltWords('register')),
      ...Object.values(vaultBuiltWords('open')),
    ];
    expect(texts.filter((t) => /[—–]/.test(t))).toEqual([]);
  });
});

describe('the clock (design B at pace B2)', () => {
  it('is one pace constant: flight 640, notch 360, beat 500', () => {
    expect(VAULT_BUILT_PACE).toEqual({ travel: 640, notch: 360, beat: 500 });
    const plan = vaultBuiltPlan(3);
    plan.keys.forEach((k, i) => {
      expect(k.start).toBe(KEYS_FROM + 500 * i);
      expect(k.arrive - k.start).toBe(640);
      expect(k.turnTo - k.turnFrom).toBe(360);
      // The notch begins as the key enters the keyhole: its last fifth.
      expect(k.arrive - k.turnFrom).toBe(128);
    });
  });

  it('three keys: the final click at 2692, the haptic with it, the button live at 3142', () => {
    const t = vaultBuiltTimeline(false, 3);
    expect(t.tickAt).toBe(2692);
    expect(t.doneAt).toBe(3142);
    // The green ring inks over the last 300 ms and completes WITH the click.
    expect(t.tracks.green).toMatchObject({ start: 2392, end: 2692 });
    expect(progressAt(t.tracks.green!, t.tickAt)).toBe(1);
    expect(progressAt(t.tracks.green!, t.tickAt - 1)).toBeLessThan(1);
    expect(t.tracks.travel).toMatchObject({ start: KEYS_FROM, end: 2692 });
    // The words rise after the click; the card and the button are settled exactly when live.
    expect(t.tracks.text1!.start).toBe(t.tickAt);
    expect(t.tracks.text2!.end).toBe(t.doneAt);
  });

  it('one key: the click at 1692, live at 2142; two keys: 2192 and 2642', () => {
    expect([vaultBuiltTimeline(false, 1).tickAt, vaultBuiltTimeline(false, 1).doneAt]).toEqual([1692, 2142]);
    expect([vaultBuiltTimeline(false, 2).tickAt, vaultBuiltTimeline(false, 2).doneAt]).toEqual([2192, 2642]);
  });

  it('the disc is inked before the first key leaves, and the keys appear before they fly', () => {
    const t = vaultBuiltTimeline(false, 3);
    expect(t.tracks.pen!.end).toBe(800);
    expect(t.tracks.pen!.end).toBeLessThanOrEqual(KEYS_FROM);
    expect(t.tracks.appear!.end).toBeLessThanOrEqual(KEYS_FROM);
    // Sketch, then ink: half the pen's track as the sketch's 350 ms run out.
    expect(progressAt(t.tracks.pen!, t.tracks.pen!.start + 350)).toBeCloseTo(0.5, 10);
    for (const k of VAULT_BUILT_TRACK_KEYS) expect(isInstant(t.tracks[k]!)).toBe(false);
  });

  it('Reduce Motion: the lock and the green ring in 350 ms, no key flies, the words there, live at 350', () => {
    const rm = vaultBuiltTimeline(true, 3);
    expect([rm.tickAt, rm.doneAt]).toEqual([350, 350]);
    expect(rm.tracks.travel).toBeUndefined();
    expect(rm.tracks.penIn).toBeUndefined();
    expect(rm.tracks.green!.end).toBe(350);
    expect(rm.tracks.pen!.end).toBe(350);
    for (const k of ['appear', 'text1', 'text2'] as const) expect(isInstant(rm.tracks[k]!)).toBe(true);
  });

  it('the lock turns one 40 degree notch per key, still between notches', () => {
    for (const n of [1, 2, 3]) {
      const plan = vaultBuiltPlan(n);
      const { inputRange, outputRange } = lockTurnTable(n);
      const at = (ms: number) => {
        const x = (ms - KEYS_FROM) / plan.span;
        const i = inputRange.findIndex((v) => v >= x - 1e-9);
        return outputRange[i];
      };
      expect(outputRange[0]).toBe(0);
      expect(outputRange.at(-1)).toBe(n * NOTCH_DEG);
      plan.keys.forEach((k, i) => {
        expect(at(k.turnFrom)).toBeCloseTo(i * NOTCH_DEG, 6);
        expect(at(k.turnTo)).toBeCloseTo((i + 1) * NOTCH_DEG, 6);
      });
    }
  });

  it('more keys share the three-key span, and one notch always ends before the next', () => {
    const designClick = vaultBuiltPlan(3).clickEnd;
    for (let n = 1; n <= 15; n++) {
      const plan = vaultBuiltPlan(n);
      expect(plan.clickEnd).toBeLessThanOrEqual(designClick);
      for (let i = 1; i < n; i++) expect(plan.keys[i].turnFrom).toBeGreaterThan(plan.keys[i - 1].turnTo);
      // Every key is in the keyhole by the time its own notch ends, so by the click.
      for (const k of plan.keys) expect(k.arrive).toBeLessThanOrEqual(k.turnTo);
      expect(plan.clickEnd).toBe(plan.keys[n - 1].turnTo);
      const { inputRange, outputRange } = lockTurnTable(n);
      // Strictly increasing inputs (the native driver divides by each step), never turning back.
      for (let i = 1; i < inputRange.length; i++) {
        expect(inputRange[i]).toBeGreaterThan(inputRange[i - 1]);
        expect(outputRange[i]).toBeGreaterThanOrEqual(outputRange[i - 1]);
      }
      expect(inputRange[0]).toBe(0);
      expect(inputRange.at(-1)).toBe(1);
      for (let i = 0; i < n; i++) {
        const [a, b] = keyFlightWindow(n, i);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThan(a);
      }
    }
    expect(vaultBuiltPace(2)).toEqual(VAULT_BUILT_PACE);
    expect(vaultBuiltPace(5)).toEqual({ travel: 320, notch: 180, beat: 250 });
  });

  it('the first key leaves at the start of the travel track', () => {
    expect(keyFlightWindow(3, 0)[0]).toBe(0);
    const e = easedTable(0.2, 0.6);
    expect(e.inputRange[0]).toBe(0.2);
    expect(e.inputRange.at(-1)).toBe(0.6);
    expect([e.outputRange[0], e.outputRange.at(-1)]).toEqual([0, 1]);
  });
});

describe('the lock', () => {
  it('one dashed ring per recovery path, 5 apart, and never past the box', () => {
    expect(ringRadii(0)).toEqual([]);
    expect(ringRadii(1)).toEqual([LOCK_R + 7]);
    expect(ringRadii(3)).toEqual([37, 42, 47]);
    for (let p = 1; p <= 6; p++) {
      const r = ringRadii(p);
      expect(r).toHaveLength(p);
      // The stroke (0.8) stays inside the 0-100 drawing.
      expect(r.at(-1)! + 0.4).toBeLessThanOrEqual(50);
      for (let i = 1; i < p; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    }
  });

  it('the pen dot starts at the top of the disc, sketches round, and inks round again', () => {
    const { size, inputRange, x, y } = lockPenPath(LOCK_BOX);
    expect(size).toBe(14);
    const top = [50 * 2.2 - 7, (50 - LOCK_R) * 2.2 - 7];
    for (const t of [0, 0.5, 1]) {
      const i = inputRange.indexOf(t);
      expect(x[i]).toBeCloseTo(top[0], 6);
      expect(y[i]).toBeCloseTo(top[1], 6);
    }
    // Sketching goes counter-clockwise: a quarter of the way in, it is on the left.
    expect(x[inputRange.indexOf(0.125)]).toBeLessThan(top[0]);
    // Inking goes clockwise: a quarter of the way in, on the right.
    expect(x[inputRange.indexOf(0.625)]).toBeGreaterThan(top[0]);
    expect(lockPenPath(MIN_LOCK_BOX).size).toBe(7);
  });

  it('the glass is the disc exactly, inside the first recovery ring, in any box', () => {
    expect(lockGlass(LOCK_BOX)).toEqual({ size: 132, inset: 44 });
    expect(lockGlass(MIN_LOCK_BOX)).toEqual({ size: 66, inset: 22 });
    for (const box of [MIN_LOCK_BOX, 137, 160, 199, LOCK_BOX]) {
      const { size, inset } = lockGlass(box);
      // Its edge is where the outline is inked, so the ink sits on the glass edge.
      expect(size / 2).toBeCloseTo((LOCK_R * box) / 100, 9);
      // Centred in the box.
      expect(2 * inset + size).toBeCloseTo(box, 9);
      // The dashed rings stay outside it.
      expect(size / 2).toBeLessThan((ringRadii(1)[0] * box) / 100);
    }
  });

  it('the glass settles in with the ink: nothing of it while the pen sketches, all of it as the outline completes', () => {
    // The pen's track: sketch 0 -> 0.5, ink 0.5 -> 1 (the sketch's 350 ms of 650).
    expect(GLASS_IN).toEqual({ from: 0.5, to: 1 });
    expect(GLASS_SCALE_FROM).toBeGreaterThan(0.85);
    expect(GLASS_SCALE_FROM).toBeLessThan(1);
    const t = vaultBuiltTimeline(false, 3);
    expect(progressAt(t.tracks.pen!, t.tracks.pen!.start + 350)).toBeCloseTo(GLASS_IN.from, 10);
    expect(progressAt(t.tracks.pen!, t.tracks.pen!.end)).toBe(GLASS_IN.to);
    // Reduce Motion inks without a sketch: the pen's track starts at the ink, so the glass settles over the same 350 ms.
    const rm = vaultBuiltTimeline(true, 3);
    expect(progressAt(rm.tracks.pen!, 0)).toBeCloseTo(GLASS_IN.from, 10);
    expect(progressAt(rm.tracks.pen!, 350)).toBe(GLASS_IN.to);
    // The glass is there before the first key sets off for the keyhole.
    expect(t.tracks.pen!.end).toBeLessThanOrEqual(KEYS_FROM);
  });

  it('takes the room left over, from 110 up to the design’s 220', () => {
    expect(vaultBuiltBox(600, 700)).toBe(MIN_LOCK_BOX);
    expect(vaultBuiltBox(600, 600)).toBe(MIN_LOCK_BOX);
    expect(vaultBuiltBox(650, 600)).toBe(160);
    expect(vaultBuiltBox(900, 600)).toBe(LOCK_BOX);
    expect(vaultBuiltBox(NaN, 600)).toBe(MIN_LOCK_BOX);
  });

  it('the row of keys and their names stays inside the page on any phone, at any lock size', () => {
    // An iPhone 16's page and an SE's: three keys at the design's spacing,
    // each name as wide as the spacing allows less the room between names
    // (B2 drew them 120 wide at 104 apart, so two long names could touch).
    for (const w of [361, 343]) {
      expect(keyRow(3, w)).toMatchObject({ gap: KEY_GAP_X, labelW: KEY_GAP_X - KEY_LABEL_SPACE });
    }
    expect(keyRow(1, 343).x).toEqual([0]);
    for (const box of [MIN_LOCK_BOX, 160, LOCK_BOX]) {
      for (const w of [288, 343, 361, 398]) {
        for (let n = 1; n <= 12; n++) {
          const { icon, labelW, x } = keyRow(n, w, box);
          const reach = Math.max(...x.map(Math.abs)) + Math.max(icon, labelW) / 2;
          expect(reach).toBeLessThanOrEqual(w / 2 + 1e-9);
          // Centred on the lock.
          expect(x[0]).toBeCloseTo(-x[n - 1], 9);
        }
      }
    }
  });

  it('names under neighbouring keys never overlap once the row closes up', () => {
    // A 3 of 5 on an iPhone 16: "Trezor Safe 5" next to "Ledger Flex" overlapped.
    for (const box of [MIN_LOCK_BOX, 160, LOCK_BOX]) {
      for (const w of [288, 343, 361, 398]) {
        for (let n = 2; n <= 12; n++) {
          const { gap, labelW, scale, nameScale } = keyRow(n, w, box);
          if (labelW > 0 && gap < KEY_GAP_X * scale) {
            expect(labelW).toBeLessThanOrEqual(gap - KEY_LABEL_SPACE * nameScale);
          }
        }
      }
    }
  });

  it('the row scales with the lock box, so an iPhone SE keeps B2’s proportions (decided 2026-10-02)', () => {
    // At the design's box the row IS B2.
    expect(keyRow(3, 361)).toMatchObject({
      scale: 1,
      nameScale: 1,
      icon: KEY_ICON,
      startY: KEY_START_Y,
      labelTop: KEY_LABEL_TOP,
      gap: KEY_GAP_X,
      labelW: KEY_GAP_X - KEY_LABEL_SPACE,
      x: [-KEY_GAP_X, 0, KEY_GAP_X],
    });
    // The SE's lock is half the size: so are its keys, their spacing and their
    // flight. Its names keep a 10pt floor, so each is cut to the spacing less
    // the room between names, never the full 60 (render 2026-10-02: overlap).
    expect(keyRow(3, 343, MIN_LOCK_BOX)).toMatchObject({ scale: 0.5, icon: 15, startY: 75, labelTop: 17, gap: 52 });
    expect(keyRow(3, 343, MIN_LOCK_BOX).labelW).toBeCloseTo(52 - KEY_LABEL_SPACE * KEY_NAME_MIN_SCALE, 9);
    expect(keyRow(3, 343, MIN_LOCK_BOX).x).toEqual([-52, 0, 52]);
    for (const box of [MIN_LOCK_BOX, 132, 160, 187, 199, LOCK_BOX]) {
      const s = box / LOCK_BOX;
      const r = keyRow(3, 361, box);
      expect(r.scale).toBeCloseTo(s, 9);
      expect(r.icon).toBeCloseTo(KEY_ICON * s, 9);
      expect(r.gap).toBeCloseTo(KEY_GAP_X * s, 9);
      expect(r.startY).toBeCloseTo(KEY_START_Y * s, 9);
      expect(r.labelTop).toBeCloseTo(KEY_LABEL_TOP * s, 9);
      expect(r.labelW).toBeCloseTo(Math.min(KEY_LABEL_W * s, KEY_GAP_X * s - KEY_LABEL_SPACE * r.nameScale), 9);
      r.x.forEach((x, i) => expect(x).toBeCloseTo((i - 1) * KEY_GAP_X * s, 9));
      // The glyph against the lock and the spacing against the glyph, as in B2.
      expect(r.icon / box).toBeCloseTo(KEY_ICON / LOCK_BOX, 9);
      expect(r.gap / r.icon).toBeCloseTo(KEY_GAP_X / KEY_ICON, 9);
      expect(r.startY / box).toBeCloseTo(KEY_START_Y / LOCK_BOX, 9);
    }
  });

  it('a name’s type scales with the row but never below its floor, and what the type spaces follows it', () => {
    expect(KEY_NAME_MIN_SCALE).toBeCloseTo(10 / 12, 9);
    expect(keyRow(3, 361, LOCK_BOX).nameScale).toBe(1);
    expect(keyRow(3, 361, 198).nameScale).toBeCloseTo(0.9, 9);
    // From the floor down, the type stays put while the glyph keeps shrinking.
    for (const box of [MIN_LOCK_BOX, 150, 183]) {
      const r = keyRow(3, 361, box);
      expect(r.nameScale).toBe(KEY_NAME_MIN_SCALE);
      expect(r.icon).toBeLessThan(KEY_ICON * KEY_NAME_MIN_SCALE);
    }
    // A closed-up row keeps the names apart by KEY_LABEL_SPACE at the TYPE's scale,
    // and still drops names that would be an ellipsis at that type.
    // Six keys still fit the SE's scaled spacing; seven close up.
    expect(keyRow(6, 343, MIN_LOCK_BOX).gap).toBeCloseTo(KEY_GAP_X * 0.5, 9);
    const closed = keyRow(7, 343, MIN_LOCK_BOX);
    expect(closed.gap).toBeLessThan(KEY_GAP_X * closed.scale);
    expect(closed.labelW).toBeCloseTo(closed.gap - KEY_LABEL_SPACE * KEY_NAME_MIN_SCALE, 9);
    expect(closed.labelW).toBeGreaterThanOrEqual(44 * KEY_NAME_MIN_SCALE);
    expect(keyRow(12, 288, MIN_LOCK_BOX).labelW).toBe(0);
  });
});

describe('the two render problems of 2026-10-02', () => {
  it('a name never reaches its neighbour, on any phone, at any lock size', () => {
    for (const box of [110, 140, 160, 190, 220]) {
      for (const pageW of [288, 343, 361, 398]) {
        for (let n = 2; n <= 12; n += 1) {
          const row = keyRow(n, pageW, box);
          if (row.labelW === 0) continue;
          // Names are centred under their keys: half a name each side of the
          // key, so two neighbours leave the agreed room between them.
          expect(row.gap - row.labelW).toBeGreaterThanOrEqual(KEY_LABEL_SPACE * row.nameScale - 1e-9);
        }
      }
    }
    // The iPhone SE case that overlapped: three keys, half-size row.
    const se = keyRow(3, 343, 110);
    expect(se.labelW).toBeLessThan(se.gap);
  });

  it('every recovery ring has a whole number of dashes, so no seam where it starts', () => {
    for (const r of ringRadii(6)) {
      const [dash, gap] = ringDash(r).split(' ').map(Number);
      const around = 2 * Math.PI * r;
      const count = around / (dash + gap);
      expect(Math.abs(count - Math.round(count))).toBeLessThan(1e-3);
      // Still the graph's own waiting line: about 2 on, 2.6 off.
      expect(dash / gap).toBeCloseTo(2 / 2.6, 3);
    }
  });
});

