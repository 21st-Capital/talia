import {
  CHART_RANGES,
  RANGE_SPEC,
  aggregateCandles,
  candleSpanMs,
  candlesFromPoints,
  candlesSince,
  changeAt,
  convertCandles,
  formatScrubTime,
  localMidnight,
  parseKlines,
  rateLookup,
  summarize,
  timeAxis,
  utcDayKey,
  withLiveClose,
} from '../chartSeries';
import type { Candle } from '../chartSeries';

const H = 60 * 60_000;
const D = 24 * H;

function k(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c };
}

describe('parseKlines', () => {
  it('reads Binance rows (strings) into numeric candles and drops junk', () => {
    const raw = [
      [1_700_000_000_000, '100.5', '110', '90', '105', '12.3', 1_700_000_299_999],
      ['not', 'a', 'row'],
      [1_700_000_300_000, '0', '1', '1', '1'], // zero open
      [1_700_000_600_000, '100', '90', '110', '100'], // high < low
      null,
      [1_700_000_900_000, '105', '106', '104', '105.5'],
    ];
    expect(parseKlines(raw)).toEqual([
      k(1_700_000_000_000, 100.5, 110, 90, 105),
      k(1_700_000_900_000, 105, 106, 104, 105.5),
    ]);
    expect(parseKlines(null)).toEqual([]);
    expect(parseKlines({ error: 'x' })).toEqual([]);
  });
});

describe('aggregateCandles', () => {
  it('folds fine candles into buckets counted from the first candle: open first / close last / wick extremes', () => {
    const span = 30 * 60_000; // 30-minute candles from 5-minute klines
    const base = Math.floor(1_700_000_000_000 / span) * span + 10 * 60_000; // not on a clock boundary
    const fine: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const t = base + i * 5 * 60_000;
      fine.push(k(t, 100 + i, 101 + i, 99 + i, 100.5 + i));
    }
    const out = aggregateCandles(fine, span);
    // first bucket = the first 6 klines, dated at the first kline; second = the remaining 4
    expect(out).toHaveLength(2);
    expect(out[0].t).toBe(base);
    expect(out[1].t).toBe(base + span);
    expect(out[0].o).toBe(100);
    expect(out[0].c).toBe(105.5);
    expect(out[0].h).toBe(106);
    expect(out[0].l).toBe(99);
    expect(out[1].o).toBe(106);
    expect(out[1].c).toBe(109.5);
    expect(out[1].h).toBe(110);
    expect(out[1].l).toBe(105);
  });

  it('never dates a candle before the data begins (weekly klines, 8-week candles)', () => {
    const week = 7 * D;
    const monday = Date.parse('2017-08-14T00:00:00Z');
    const weeks: Candle[] = Array.from({ length: 20 }, (_, i) => k(monday + i * week, 1, 2, 0.5, 1.5));
    const out = aggregateCandles(weeks, 8 * week);
    expect(out[0].t).toBe(monday);
    expect(out).toHaveLength(3);
    expect(out[2].t).toBe(monday + 16 * week);
  });

  it('is the identity for a zero span and on empty input', () => {
    const c = [k(1, 1, 2, 0.5, 1.5)];
    expect(aggregateCandles(c, 0)).toEqual(c);
    expect(aggregateCandles([], 60_000)).toEqual([]);
  });

  it('every range folds to a sensible candle count', () => {
    for (const r of CHART_RANGES) {
      const spec = RANGE_SPEC[r];
      const perCandle = spec.group;
      const count = Math.ceil(spec.limit / perCandle);
      // ALL has ~474 weekly klines today, not 1000; the cap is the design.
      const expected = r === 'ALL' ? Math.ceil(474 / perCandle) : count;
      expect(expected).toBeGreaterThanOrEqual(40);
      expect(expected).toBeLessThanOrEqual(70);
    }
  });
});

describe('rateLookup / convertCandles', () => {
  const table = { '2026-09-08': 0.85, '2026-09-09': 0.86, '2026-09-10': 0.87 };
  const at = (day: string, hour = 12): number => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);

  it('uses the day’s own rate, and the previous published day on weekends', () => {
    const rate = rateLookup(table);
    expect(rate(at('2026-09-09'))).toBe(0.86);
    // a day with no entry (weekend/holiday) takes the last one before it
    expect(rate(at('2026-09-09', 23))).toBe(0.86);
    expect(rate(Date.parse('2026-09-09T23:59:59Z'))).toBe(0.86);
  });

  it('days after the table take the live ratio when given, else the last rate', () => {
    expect(rateLookup(table, 0.9)(at('2026-09-11'))).toBe(0.9);
    expect(rateLookup(table)(at('2026-09-11'))).toBe(0.87);
    expect(rateLookup(table, 0)(at('2026-09-11'))).toBe(0.87); // a zero ratio is not a ratio
  });

  it('days before the table take the first rate; an empty table yields null', () => {
    expect(rateLookup(table)(at('2020-01-01'))).toBe(0.85);
    expect(rateLookup({})(at('2026-09-09'))).toBeNull();
    expect(rateLookup({}, 0.9)(at('2026-09-09'))).toBe(0.9);
    expect(rateLookup({ '2026-09-09': Number.NaN })(at('2026-09-09'))).toBeNull();
  });

  it('convertCandles scales every leg and drops candles without a rate', () => {
    const usd = [k(at('2026-09-09'), 100, 110, 90, 105), k(at('2026-09-10'), 105, 106, 104, 105)];
    const rate = (t: number): number | null => (utcDayKey(t) === '2026-09-09' ? 0.5 : null);
    expect(convertCandles(usd, rate)).toEqual([k(at('2026-09-09'), 50, 55, 45, 52.5)]);
  });
});

describe('withLiveClose', () => {
  it('moves the last close to the live price and stretches the wick', () => {
    const c = [k(1, 100, 110, 90, 105), k(2, 105, 106, 104, 105)];
    expect(withLiveClose(c, 120)[1]).toEqual(k(2, 105, 120, 104, 120));
    expect(withLiveClose(c, 50)[1]).toEqual(k(2, 105, 106, 50, 50));
    expect(withLiveClose(c, 120)[0]).toEqual(c[0]);
  });
  it('leaves the series alone without a usable price', () => {
    const c = [k(1, 100, 110, 90, 105)];
    expect(withLiveClose(c, null)).toBe(c);
    expect(withLiveClose(c, 0)).toBe(c);
    expect(withLiveClose([], 5)).toEqual([]);
  });
});

describe('candlesFromPoints / candlesSince', () => {
  it('turns close-only points into flat candles and filters junk', () => {
    expect(candlesFromPoints([{ t: 1, p: 10 }, { t: 2, p: Number.NaN }, { t: 3, p: -1 }])).toEqual([k(1, 10, 10, 10, 10)]);
  });
  it('candlesSince keeps candles at or after the start', () => {
    const c = [k(1, 1, 1, 1, 1), k(5, 1, 1, 1, 1), k(9, 1, 1, 1, 1)];
    expect(candlesSince(c, 5).map((x) => x.t)).toEqual([5, 9]);
  });
});

describe('summarize / changeAt', () => {
  const c = [k(1, 100, 112, 95, 104), k(2, 104, 108, 99, 101), k(3, 101, 103, 97, 110)];
  it('line mode: open = first open, last = last close, extremes over closes', () => {
    const s = summarize(c, 'line')!;
    expect(s.open).toBe(100);
    expect(s.last).toBe(110);
    expect(s.high).toBe(110);
    expect(s.low).toBe(101);
    expect(s.changeAbs).toBe(10);
    expect(s.changePct).toBeCloseTo(10, 6);
  });
  it('candle mode: extremes over wicks', () => {
    const s = summarize(c, 'candles')!;
    expect(s.high).toBe(112);
    expect(s.low).toBe(95);
  });
  it('empty series → null; changeAt against the open', () => {
    expect(summarize([], 'line')).toBeNull();
    expect(changeAt(200, 190)).toEqual({ changeAbs: -10, changePct: -5 });
    expect(changeAt(0, 5).changePct).toBe(0);
  });
});

describe('timeAxis', () => {
  it('today runs local midnight to midnight regardless of the candles', () => {
    const now = Date.parse('2026-09-11T14:10:00');
    const axis = timeAxis('1D', [k(now - H, 1, 1, 1, 1)], now);
    expect(axis.start).toBe(localMidnight(now));
    expect(axis.end - axis.start).toBe(D);
  });
  it('other ranges span their candles, padded by the candle span', () => {
    const c = [k(1000, 1, 1, 1, 1), k(2000, 1, 1, 1, 1)];
    expect(timeAxis('1W', c, 5000)).toEqual({ start: 1000, end: 2000 });
    expect(timeAxis('1W', c, 5000, 500)).toEqual({ start: 1000, end: 2500 });
    expect(timeAxis('1W', [c[0]], 5000).end).toBeGreaterThan(1000);
    expect(timeAxis('1W', [], 5000)).toEqual({ start: 5000, end: 5000 });
  });
  it('candleSpanMs is interval × group', () => {
    expect(candleSpanMs('1D')).toBe(30 * 60_000);
    expect(candleSpanMs('1Y')).toBe(7 * D);
  });
});

describe('formatScrubTime', () => {
  const now = Date.parse('2026-09-11T14:10:00');
  it('today and yesterday carry the clock', () => {
    expect(formatScrubTime(Date.parse('2026-09-11T09:05:00'), '1D', now)).toBe('Today 09:05');
    expect(formatScrubTime(Date.parse('2026-09-10T21:35:00'), '1D', now)).toBe('Yesterday 21:35');
  });
  it('week and month show day and clock; long ranges show the date', () => {
    expect(formatScrubTime(Date.parse('2026-09-08T14:00:00'), '1W', now)).toBe('8 Sep, 14:00');
    expect(formatScrubTime(Date.parse('2026-09-08T14:00:00'), '1M', now)).toBe('8 Sep, 14:00');
    expect(formatScrubTime(Date.parse('2021-03-02T00:00:00'), '5Y', now)).toBe('2 Mar 2021');
    expect(formatScrubTime(Date.parse('2017-08-14T00:00:00'), 'ALL', now)).toBe('14 Aug 2017');
  });
});

describe('utcDayKey', () => {
  it('keys by UTC day', () => {
    expect(utcDayKey(Date.parse('2026-09-11T23:30:00Z'))).toBe('2026-09-11');
    expect(utcDayKey(Date.parse('2026-09-12T00:30:00Z'))).toBe('2026-09-12');
  });
});
