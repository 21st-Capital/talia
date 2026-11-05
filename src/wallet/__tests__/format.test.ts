import { groupDigits, formatSats, formatBtc, formatSignedSats } from '../format';

describe('groupDigits', () => {
  it('groups thousands', () => {
    expect(groupDigits(1234567)).toBe('1,234,567');
    expect(groupDigits(999)).toBe('999');
    expect(groupDigits(-1500)).toBe('-1,500');
  });
});

describe('formatSats', () => {
  it('formats with unit and singular/plural', () => {
    expect(formatSats(150000)).toBe('150,000 sats');
    expect(formatSats(1)).toBe('1 sat');
  });
});

describe('formatBtc', () => {
  it('formats sats as trimmed BTC', () => {
    expect(formatBtc(150000)).toBe('0.0015 BTC');
    expect(formatBtc(100000000)).toBe('1 BTC');
    expect(formatBtc(0)).toBe('0 BTC');
    expect(formatBtc(-50000)).toBe('-0.0005 BTC');
  });
});

describe('formatSignedSats', () => {
  it('prefixes incoming amounts with +', () => {
    expect(formatSignedSats(150000)).toBe('+150,000 sats');
    expect(formatSignedSats(-50000)).toBe('-50,000 sats');
  });
});

import { formatAmount, formatSignedAmount } from '../format';
import { formatRelativeTime } from '../history';

describe('formatAmount / formatSignedAmount', () => {
  it('respects the unit setting', () => {
    expect(formatAmount(150000, 'btc')).toBe('0.0015 BTC');
    expect(formatAmount(150000, 'sats')).toBe('150,000 sats');
    expect(formatSignedAmount(150000, 'btc')).toBe('+0.0015 BTC');
    expect(formatSignedAmount(-150000, 'sats')).toBe('-150,000 sats');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 6, 14, 12, 0) ;
  it('formats recent times relatively', () => {
    expect(formatRelativeTime(now / 1000 - 30, now)).toBe('just now');
    expect(formatRelativeTime(now / 1000 - 6 * 3600, now)).toBe('6 hours ago');
    expect(formatRelativeTime(now / 1000 - 35 * 60, now)).toBe('35 minutes ago');
  });
  it('falls back to a date beyond 24 hours', () => {
    expect(formatRelativeTime(now / 1000 - 3 * 86400, now)).toMatch(/^Jul 11, \d{1,2}:\d{2} (am|pm)$/);
  });
});

import { formatCardAmount } from '../format';

describe('formatCardAmount', () => {
  it('groups BTC decimals ledger-style (2+3+3)', () => {
    // Digit groups are separated by U+2009 (thin space) for ledger-style type.
    expect(formatCardAmount(20734954, 'btc')).toBe('0.20\u2009734\u2009954');
    expect(formatCardAmount(0, 'btc')).toBe('0.00\u2009000\u2009000');
    expect(formatCardAmount(150000000, 'btc')).toBe('1.50\u2009000\u2009000');
  });
  it('groups sats plainly', () => {
    expect(formatCardAmount(150000, 'sats')).toBe('150,000');
  });
});

import { chunkAddress } from '../format';

describe('chunkAddress', () => {
  it('splits into 4-char groups with a short tail', () => {
    expect(chunkAddress('bc1q3t3r2qffxm8n')).toEqual(['bc1q', '3t3r', '2qff', 'xm8n']);
    expect(chunkAddress('bc1q3t3r2q')).toEqual(['bc1q', '3t3r', '2q']);
    expect(chunkAddress('')).toEqual([]);
  });
});

import { addressDigitRuns } from '../format';

describe('addressDigitRuns', () => {
  it('groups consecutive digits and letters', () => {
    expect(addressDigitRuns('bc1q9a33qpk')).toEqual([
      { text: 'bc', digit: false },
      { text: '1', digit: true },
      { text: 'q', digit: false },
      { text: '9', digit: true },
      { text: 'a', digit: false },
      { text: '33', digit: true },
      { text: 'qpk', digit: false },
    ]);
    expect(addressDigitRuns('')).toEqual([]);
  });
});

describe('auto unit (switches at 0.1 BTC)', () => {
  const { formatAmount, resolveUnit, AUTO_BTC_THRESHOLD } = require('../format');
  it('resolves per amount', () => {
    expect(resolveUnit(AUTO_BTC_THRESHOLD, 'auto')).toBe('btc');
    expect(resolveUnit(AUTO_BTC_THRESHOLD - 1, 'auto')).toBe('sats');
    expect(resolveUnit(-AUTO_BTC_THRESHOLD, 'auto')).toBe('btc'); // sign-agnostic
    expect(resolveUnit(50, 'btc')).toBe('btc'); // explicit units unchanged
  });
  it('formats accordingly', () => {
    expect(formatAmount(10_378_254, 'auto')).toBe('0.10378254 BTC');
    expect(formatAmount(999_999, 'auto')).toBe('999,999 sats');
    expect(formatAmount(999_999, 'btc')).toBe('0.00999999 BTC');
  });
});
