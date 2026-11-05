import { formatChange, formatCompact, formatCompactFiat, formatFiatValue, formatSignedFiat, formatSignedPct, readsNegative } from '../marketFormat';

describe('formatFiatValue', () => {
  it('formats with the currency symbol and two decimals (none for yen)', () => {
    expect(formatFiatValue(66465.09, 'EUR')).toBe('€66,465.09');
    expect(formatFiatValue(66465.094, 'USD')).toBe('$66,465.09');
    expect(formatFiatValue(9876543.4, 'JPY')).toBe('¥9,876,543');
    expect(formatFiatValue(1234.5, 'CHF')).toBe('CHF 1,234.50');
  });
});

describe('formatSignedFiat / formatSignedPct', () => {
  it('uses + and a real minus sign, never an ASCII hyphen', () => {
    expect(formatSignedFiat(307.19, 'EUR')).toBe('+€307.19');
    expect(formatSignedFiat(-307.19, 'EUR')).toBe('−€307.19');
    expect(formatSignedFiat(0, 'USD')).toBe('+$0.00');
    expect(formatSignedPct(0.456)).toBe('+0.46%');
    expect(formatSignedPct(-12.3456)).toBe('−12.35%');
    expect(formatSignedFiat(-1, 'EUR').charCodeAt(0)).toBe(0x2212);
  });
  it('a change that rounds to nothing is not a loss', () => {
    expect(formatSignedFiat(-0.001, 'EUR')).toBe('+€0.00');
    expect(formatSignedFiat(-0.005, 'EUR')).toBe('−€0.01');
    expect(formatSignedFiat(-0.4, 'JPY')).toBe('+¥0');
    expect(formatSignedPct(-0.001)).toBe('+0.00%');
    expect(formatSignedPct(-0.005)).toBe('−0.01%');
    expect(readsNegative(-0.004, 'USD')).toBe(false);
    expect(readsNegative(-0.006, 'USD')).toBe(true);
  });
});

describe('formatChange', () => {
  it('writes the signed amount and the unsigned percentage in parentheses', () => {
    expect(formatChange(23.99, 0.031, 'USD')).toBe('+$23.99 (0.03%)');
    expect(formatChange(-112.84, -0.149, 'EUR')).toBe('−€112.84 (0.15%)');
    expect(formatChange(11468.42, 286.66, 'USD')).toBe('+$11,468.42 (286.66%)');
    expect(formatChange(5, null, 'USD')).toBe('+$5.00');
    expect(formatChange(-0.001, -0.0001, 'USD')).toBe('+$0.00 (0.00%)');
  });
});

describe('formatCompact', () => {
  it('matches the Stats card style: 1.54T, 29.33B, 20.08M, 21M', () => {
    expect(formatCompact(1_540_000_000_000)).toBe('1.54T');
    expect(formatCompact(29_330_000_000)).toBe('29.33B');
    expect(formatCompact(20_082_718)).toBe('20.08M');
    expect(formatCompact(21_000_000)).toBe('21M');
    expect(formatCompact(1_500_000)).toBe('1.5M');
  });
  it('keeps the zeros of whole numbers (100M is not 1M)', () => {
    expect(formatCompact(100_000_000)).toBe('100M');
    expect(formatCompact(240_000_000_000_000)).toBe('240T');
    expect(formatCompact(1_000_000_000)).toBe('1B');
    expect(formatCompact(10_500_000)).toBe('10.5M');
  });
  it('drops decimals at three digits and groups anything under a million', () => {
    expect(formatCompact(123_456_000_000)).toBe('123B');
    expect(formatCompact(999_999)).toBe('999,999');
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(-2_500_000)).toBe('−2.5M');
    expect(formatCompact(Number.NaN)).toBe('');
  });
  it('prefixes the currency symbol', () => {
    expect(formatCompactFiat(1_334_316_063_853, 'EUR')).toBe('€1.33T');
    expect(formatCompactFiat(25_296_380_002, 'USD')).toBe('$25.3B');
  });
});
