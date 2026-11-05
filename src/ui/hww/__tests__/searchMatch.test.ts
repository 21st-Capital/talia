import { foundModel, splitFound } from '../searchMatch';
import type { FoundView } from '../searchMatch';

const id = (v: FoundView) => v;
const nanoX = (n: string): FoundView => ({ brand: 'ledger', id: n, kitModel: 'nanoX' });
const gen5 = (n: string): FoundView => ({ brand: 'ledger', id: n, kitModel: 'apexp' });
const nova = (n: string): FoundView => ({ brand: 'bitbox', id: n });

describe('the search lists the device picked, and takes the one not yet spent (decided 2026-10-04)', () => {
  it('reads the model the kit reports; a BitBox is a Nova', () => {
    expect(foundModel(nanoX('a'))).toBe('nanoX');
    expect(foundModel(gen5('b'))).toBe('gen5');
    expect(foundModel(nova('c'))).toBe('nova');
    expect(foundModel({ brand: 'ledger', id: 'd', kitModel: 'nanoSP' })).toBeNull();
  });

  it('lists only the model picked, nothing else', () => {
    const s = splitFound([gen5('g'), nanoX('x1'), nova('n'), nanoX('x2')], id, 'nanoX');
    expect(s.shown.map((f) => f.id)).toEqual(['x1', 'x2']);
    expect(splitFound([gen5('g'), nanoX('x')], id, 'nova').shown).toEqual([]);
  });

  it('takes the one unused match by itself, even with a spent one in sight (a phone-test screenshot)', () => {
    const s = splitFound([nanoX('spent'), nanoX('fresh')], id, 'nanoX', new Set(['spent']));
    expect(s.auto?.id).toBe('fresh');
  });

  it('takes nothing when two unused matches are in sight, or none, or only a spent one', () => {
    expect(splitFound([nanoX('a'), nanoX('b')], id, 'nanoX').auto).toBeNull();
    expect(splitFound([gen5('a')], id, 'nanoX').auto).toBeNull();
    expect(splitFound([nanoX('a')], id, 'nanoX', new Set(['a'])).auto).toBeNull();
  });

  it('lists only when two or more of the model are in sight (decided 2026-10-04)', () => {
    expect(splitFound([nanoX('a')], id, 'nanoX').listed).toEqual([]);
    expect(splitFound([nanoX('a'), gen5('g')], id, 'nanoX').listed).toEqual([]);
    expect(splitFound([nanoX('a'), nanoX('b')], id, 'nanoX').listed.map((f) => f.id)).toEqual(['a', 'b']);
    // Two in sight, one spent: listed, and the fresh one is taken by itself.
    const two = splitFound([nanoX('spent'), nanoX('fresh')], id, 'nanoX', new Set(['spent']));
    expect(two.listed).toHaveLength(2);
    expect(two.auto?.id).toBe('fresh');
  });

  it('one match already spent: not listed, not taken, said in a line', () => {
    const s = splitFound([nanoX('a')], id, 'nanoX', new Set(['a']));
    expect(s).toMatchObject({ listed: [], auto: null });
    expect(s.spentOnly?.id).toBe('a');
    expect(splitFound([nanoX('a')], id, 'nanoX').spentOnly).toBeNull();
  });

  it('never takes a device of another model by itself', () => {
    expect(splitFound([gen5('g')], id, 'nanoX').auto).toBeNull();
    expect(splitFound([nova('n')], id, 'gen5').auto).toBeNull();
  });
});

describe('the search screen uses the rule', () => {
  it('lists split.shown and nothing else, searches only the picked brand, and auto-connects split.auto alone', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path');
    const src: string = readFileSync(join(__dirname, '..', '..', 'components', 'HwwConnectFlow.tsx'), 'utf8');
    expect(src).toMatch(/const split = splitFound\(state\.kind === 'scanning' \? state\.found : \[\], viewOf, expect, usedDeviceIds\);/);
    expect(src).toMatch(/const sole = cyclesDone >= 1 && state\.kind === 'scanning' \? split\.auto : null;/);
    expect(src).toMatch(/\{split\.listed\.map\(\(f\) => \{/);
    expect(src).not.toMatch(/\{split\.shown\.map/);
    expect(src).toMatch(/Use it anyway/);
    expect(src).not.toMatch(/split\.others|Other devices nearby|state\.found\.map/);
    expect(src).toMatch(/kind === modelInfo\(expectRef\.current\)\.kind && \(kindsRef\.current == null \|\| kindsRef\.current\.includes\(kind\)\)/);
    expect(src).not.toMatch(/state\.found\.length === 1/);
  });
});

describe('a Ledger window that found nothing restarts the kit (decided 2026-10-04: a fresh install never found a Gen5 on the first search)', () => {
  it('rebuilds after a dry window, a bounded number of times, and a restarted search counts again', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path');
    const src: string = readFileSync(join(__dirname, '..', '..', 'components', 'HwwConnectFlow.tsx'), 'utf8');
    expect(src).toMatch(/if \(searches\('ledger'\) && !ledgerSeenRef\.current && dryRebuildsRef\.current < LEDGER_DRY_REBUILDS\) \{\s*dryRebuildsRef\.current \+= 1;\s*flagLedgerScanDead\(\);/);
    expect(src).toMatch(/export const LEDGER_DRY_REBUILDS = 3;/);
    expect(src).toMatch(/cyclesRef\.current = 0;\s*dryRebuildsRef\.current = 0;/);
  });
});

describe('the search page does not flip (decided 2026-10-04)', () => {
  it('draws no search line under the device, and no Restart (the step\u2019s Reconnect does it, decided 2026-10-05)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path');
    const src: string = readFileSync(join(__dirname, '..', '..', 'components', 'HwwConnectFlow.tsx'), 'utf8');
    const page = src.slice(src.indexOf("{state.kind === 'scanning' && searchPage && searchDrawing != null && ("), src.indexOf("{state.kind === 'scanning' && (\n"));
    expect(page).toMatch(/<DeviceTurn drawing=\{searchDrawing\}/);
    expect(page).not.toMatch(/Looking for your hardware/);
    expect(src).not.toMatch(/Restart the search<\/Text>/);
    // One hint, the step's short one: the search's own "Nothing found yet" is gone.
    expect(src).not.toMatch(/'Nothing found yet\./);
  });
});

