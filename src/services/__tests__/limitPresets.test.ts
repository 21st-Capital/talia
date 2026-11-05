import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import * as presets from '../limitPresets';
import {
  LIMIT_PRESETS,
  LIMIT_UNIT,
  limitAmount,
  limitInput,
  limitOrderProblem,
  limitText,
  matchingPreset,
  presetLabel,
} from '../limitPresets';

describe('limit presets (decided 2026-09-21: limits are in BTC only)', () => {
  it('offers rising BTC amounts, and BTC is the one unit', () => {
    expect(LIMIT_UNIT).toBe('BTC');
    expect(LIMIT_PRESETS).toEqual([0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]);
    expect([...LIMIT_PRESETS].sort((a, b) => a - b)).toEqual([...LIMIT_PRESETS]);
  });

  // Decided 2026-10-05: the standard limit on every Elite and Elite Plus vault is
  // 0.01 BTC a month and 0.1 BTC a year. Both must be presets, so a vault on
  // the standard shows its limits in the dropdown and never as a typed
  // custom amount.
  it('leads with 0.01 BTC, and both standard limits are presets', () => {
    expect(LIMIT_PRESETS[0]).toBe(0.01);
    expect(new Set(LIMIT_PRESETS).size).toBe(LIMIT_PRESETS.length);
    expect(presetLabel(0.01)).toBe('0.01');
    expect(matchingPreset('0.01')).toBe('0.01');
    expect(matchingPreset('0.1')).toBe('0.1');
    expect(limitText('0.01')).toBe('0.01 BTC');
    expect(limitOrderProblem('0.01', '0.1')).toBeNull();
  });

  it('labels a preset the way the form stores it', () => {
    expect(presetLabel(0.25)).toBe('0.25');
    expect(presetLabel(10)).toBe('10');
  });

  it('has no unit switch left: one preset list, no unit reset', () => {
    expect(Array.isArray(LIMIT_PRESETS)).toBe(true);
    expect(presets).not.toHaveProperty('withLimitUnit');
  });

  // One list, so a new preset reaches every dropdown at once: the limit
  // dropdown builds its options from LIMIT_PRESETS and no other file keeps
  // its own copy of the amounts.
  it('the dropdown reads LIMIT_PRESETS and no file keeps its own copy', () => {
    const src = join(__dirname, '..', '..');
    const field = readFileSync(join(src, 'ui', 'components', 'LimitFields.tsx'), 'utf8');
    expect(field).toMatch(/LIMIT_PRESETS\.map\(presetLabel\)/);
    const copies: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(at);
        } else if (/\.tsx?$/.test(e.name) && e.name !== 'limitPresets.ts') {
          if (/0\.05,\s*0\.1,\s*0\.25|'0\.05',\s*'0\.1'/.test(readFileSync(at, 'utf8'))) copies.push(at);
        }
      }
    };
    walk(src);
    expect(copies).toEqual([]);
  });
});

describe('limitAmount', () => {
  it('reads plain, grouped and Swiss-grouped numbers, and nothing else', () => {
    expect(limitAmount('0.5')).toBe(0.5);
    expect(limitAmount('10,000')).toBe(10_000);
    expect(limitAmount("10'000")).toBe(10_000);
    expect(limitAmount('')).toBeNull();
    expect(limitAmount('abc')).toBeNull();
    expect(limitAmount('0')).toBeNull();
  });
});

describe('limitInput', () => {
  it('reads a German keypad comma as the decimal mark, so 0,75 is 0.75 BTC and never 75', () => {
    expect(limitInput('0,75')).toBe('0.75');
    expect(limitAmount(limitInput('0,75'))).toBe(0.75);
    expect(limitInput('1.5')).toBe('1.5');
    expect(limitInput('')).toBe('');
  });
});

describe('limitOrderProblem (decided 2026-09-21: only a monthly and a yearly limit)', () => {
  it('accepts a rising or equal pair, and blanks', () => {
    expect(limitOrderProblem('1', '12')).toBeNull();
    expect(limitOrderProblem('1', '1')).toBeNull();
    expect(limitOrderProblem('', '')).toBeNull();
    expect(limitOrderProblem('5', '')).toBeNull();
    expect(limitOrderProblem('', '5')).toBeNull();
  });

  it('refuses a yearly limit below the monthly one, by value', () => {
    expect(limitOrderProblem('5', '1')).toBe('The yearly limit cannot be lower than the monthly limit.');
    expect(limitOrderProblem('0.50', '0.25')).toMatch(/yearly limit cannot be lower than the monthly/);
  });

  it('takes two limits and never mentions a daily one', () => {
    expect(limitOrderProblem.length).toBe(2);
    expect(limitOrderProblem('5', '1')).not.toMatch(/daily/i);
  });

  it('never an em or en dash', () => {
    for (const s of [limitOrderProblem('5', '1'), limitText('0.5')]) {
      expect(s).not.toMatch(/[–—]/);
    }
  });
});

describe('matchingPreset and limitText', () => {
  it('knows a saved preset by its value, trailing zeros or not (decided 2026-09-21)', () => {
    expect(matchingPreset('0.50')).toBe('0.5');
    expect(matchingPreset('0.5')).toBe('0.5');
    expect(matchingPreset('10')).toBe('10');
    expect(matchingPreset('0.010')).toBe('0.01');
    expect(matchingPreset('0.01000000')).toBe('0.01');
    expect(matchingPreset('0.75')).toBeNull();
    expect(matchingPreset('')).toBeNull();
  });

  it('writes every limit in BTC', () => {
    expect(limitText('0.25')).toBe('0.25 BTC');
    expect(limitText('0.50')).toBe('0.5 BTC');
    expect(limitText('3')).toBe('3 BTC');
    expect(limitText('')).toBe('');
  });
});

describe('no daily limit and no other currency anywhere (decided 2026-09-21)', () => {
  // Every file that shows, edits or sends a co-signing limit.
  const files = [
    ['ui', 'components', 'LimitFields.tsx'],
    ['ui', 'screens', 'CosignLimitsScreen.tsx'],
    ['ui', 'screens', 'InheritanceSetupScreen.tsx'],
    ['ui', 'screens', 'SendScreen.tsx'],
    ['services', 'cosignLimits.ts'],
    ['services', 'inheritance.ts'],
    ['services', 'limitPresets.ts'],
  ];

  it('no field, payload or unit switch for a daily limit, EUR or USD', () => {
    for (const parts of files) {
      const src = readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
      expect({ file: parts.join('/'), hit: src.match(/dailyLimit|Daily co-signing|LimitUnitField|LIMIT_UNITS|withLimitUnit|'EUR'|'USD'/)?.[0] ?? null }).toEqual({
        file: parts.join('/'),
        hit: null,
      });
    }
  });

  // Decided 2026-09-21: "we dont have recovery path limits! we only have
  // cosigning limits!" A recovery path carries no limit, in the form or the
  // payload.
  it('a recovery path has no limit', () => {
    const block = (file: string[], head: string): string => {
      const src = readFileSync(join(__dirname, '..', '..', ...file), 'utf8');
      const at = src.indexOf(head);
      expect(at).toBeGreaterThan(-1);
      return src.slice(at, src.indexOf('\n}', at));
    };
    expect(block(['services', 'inheritance.ts'], 'export interface InheritanceLegacyPath {')).not.toMatch(/Limit\b|Limit\?/);
    expect(block(['ui', 'screens', 'InheritanceSetupScreen.tsx'], 'interface PathDraft {')).not.toMatch(/Limit\b|Limit\?/);
  });
});
