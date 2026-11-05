/**
 * The BTC price in the user's fiat, LIVE — one tick per second.
 *
 * Extracted from PriceChart's proven pattern (decided 2026-08-25, after the manual
 * wallet screen showed no fiat at all): the one-shot REST spot fetch can fail
 * on device while the home screen's price visibly ticks, because the ticker
 * rides a shared WebSocket (wallet/livePrice.ts), not REST. Any screen that
 * shows a fiat value should use THIS hook, so "the price the app already has"
 * and "the price this screen shows" can never disagree.
 *
 * REST is still used two ways, both non-fatal: to seed the first paint before
 * the socket's first tick, and to refresh the fiat/USD ratio each minute for
 * non-USD currencies (fiat pairs move far slower than bitcoin does).
 */
import { useEffect, useRef, useState } from 'react';
import { getBtcPrice } from '../../wallet';
import type { FiatCurrency } from '../../wallet';
import { subscribeLiveUsdPrice } from '../../wallet/livePrice';
import { ecbRate } from '../../wallet/ecbRate';

export function useLiveRate(currency: FiatCurrency, enabled = true): number | null {
  const [rate, setRate] = useState<number | null>(null);
  const ratioRef = useRef(1);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // A new currency starts UNKNOWN. Without these two resets a currency
    // switch kept ticking in the old currency: the seed's `prev ?? r` saw the
    // stale rate and dropped the new one, and the socket replay multiplied by
    // the old currency's ratio (2026-08-25 adversarial review).
    setRate(null);
    ratioRef.current = currency === 'USD' ? 1 : Number.NaN;

    // Seed immediately so the screen isn't blank until the first tick.
    void getBtcPrice(currency).then(
      (r) => !cancelled && r != null && setRate((prev) => prev ?? r),
    );

    const refreshRatio = async (): Promise<void> => {
      if (currency === 'USD') {
        ratioRef.current = 1;
        return;
      }
      const [fiat, usd] = await Promise.all([getBtcPrice(currency), getBtcPrice('USD')]);
      if (!cancelled && fiat != null && usd != null && usd > 0) {
        ratioRef.current = fiat / usd;
        return;
      }
      // Spot sources failed — the ECB reference rate (frankfurter.dev, a
      // host proven reachable where mempool.space is not) still gives a
      // correct USD→fiat ratio, so the per-second ticker never starves.
      const ecb = await ecbRate('USD', currency, Date.now() / 1000);
      if (!cancelled && ecb != null && !Number.isFinite(ratioRef.current)) {
        ratioRef.current = ecb;
      }
    };
    void refreshRatio();
    const ratioIv = setInterval(() => void refreshRatio(), 60_000);

    const unsubscribe = subscribeLiveUsdPrice((usd) => {
      // Hold socket ticks until THIS currency's ratio is known — the REST
      // seed covers the gap. A tick through a stale ratio is a wrong price.
      if (!cancelled && Number.isFinite(ratioRef.current)) {
        setRate(usd * ratioRef.current);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(ratioIv);
      unsubscribe();
    };
  }, [currency, enabled]);

  return enabled ? rate : null;
}
