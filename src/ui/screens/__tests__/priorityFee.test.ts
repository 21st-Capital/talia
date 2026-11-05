/**
 * The Priority choice Send and the Rescue both open (decided 2026-10-31: one
 * choice, read one way, on the shared FeeSheet).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseFeeRate, PRIORITIES, priorityCustom, priorityLabel, priorityRate, priorityRows } from '../priorityFee';
import { MAX_FEE_RATE, MIN_FEE_RATE } from '../../../wallet/feeEstimates';

jest.mock('../../components/FeeSheet', () => ({}));

const presets = { fast: 12, medium: 6, slow: 2.5, live: true };
const money = (rate: number) => ({ main: `$${rate}`, sub: `${rate} sats` });

describe('the Priority choice', () => {
  it('offers High, Medium and Slow, top to bottom', () => {
    expect(PRIORITIES.map((p) => p.label)).toEqual(['High', 'Medium', 'Slow']);
  });

  it('reads a rate as a German keyboard types it, inside the limits', () => {
    expect(parseFeeRate('2,5')).toBe(2.5);
    expect(parseFeeRate('')).toBeNull();
    expect(parseFeeRate(String(MIN_FEE_RATE / 2))).toBeNull();
    expect(parseFeeRate(String(MAX_FEE_RATE + 1))).toBeNull();
  });

  it('a custom rate that cannot be used reads as Slow, so nothing is built from a half-typed field', () => {
    expect(priorityRate(presets, 'fast', '')).toBe(12);
    expect(priorityRate(presets, 'custom', '7')).toBe(7);
    expect(priorityRate(presets, 'custom', 'abc')).toBe(2.5);
    expect(priorityLabel('custom')).toBe('Custom');
    expect(priorityLabel('fast')).toBe('High');
  });

  it('draws each tier with its wait, rate and fee', () => {
    const picked: string[] = [];
    const rows = priorityRows({ presets, priority: 'fast', money, onPick: (t) => picked.push(t) });
    expect(rows.map((r) => [r.label, r.on, r.main, r.sub])).toEqual([
      ['High', true, '$12', '12 sats'],
      ['Medium', false, '$6', '6 sats'],
      ['Slow', false, '$2.5', '2.5 sats'],
    ]);
    expect(rows[0].meta).toContain('12 sat/vB');
    rows[1].onPress?.();
    expect(picked).toEqual(['medium']);
  });

  it('the client’s own rate: typing a usable number picks it, anything else says the limits', () => {
    const typed: string[] = [];
    const picks: string[] = [];
    const custom = (customRate: string, priority: 'fast' | 'custom' = 'fast') =>
      priorityCustom({
        presets,
        priority,
        customRate,
        money,
        onCustomRate: (t) => typed.push(t),
        onPick: (p) => picks.push(p),
      });
    custom('').onChangeText('3');
    expect(typed).toEqual(['3']);
    expect(picks).toEqual(['custom']);
    expect(custom('3', 'custom')).toMatchObject({ on: true, main: '$3', sub: '3 sats', bad: null });
    expect(custom('0').bad).toBe(`${MIN_FEE_RATE} to ${MAX_FEE_RATE}`);
    expect(custom('').bad).toBeNull();
    expect(custom('').placeholder).toBe('2.5');
  });
});

describe('Send and the Rescue open the same choice', () => {
  const read = (name: string) => readFileSync(join(__dirname, '..', name), 'utf8');

  it.each(['SendScreen.tsx', 'RescueScreen.tsx'])('%s draws priorityRows and priorityCustom on FeeSheet', (name) => {
    const src = read(name);
    expect(src).toMatch(/<FeeSheet\b/);
    expect(src).toMatch(/rows=\{priorityRows\(\{/);
    expect(src).toMatch(/custom=\{priorityCustom\(\{/);
  });

  it('the rescue’s fee is the client’s: no fixed rate is left', () => {
    expect(read('RescueScreen.tsx')).not.toMatch(/feeRate:\s*\d/);
  });
});
