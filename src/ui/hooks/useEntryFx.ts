/**
 * Fiat conversions for a portfolio's foreign-currency entries.
 *
 * An entry keeps the currency it was recorded in. To total them in ONE
 * currency, each foreign entry is converted at the rate of its OWN date, never
 * today's: what a client paid in dollars in 2024 is a 2024 dollar amount.
 *
 * The map is TAGGED with the currency it converts INTO and is withheld while
 * that does not match, because the screens stay mounted across a currency
 * switch and a stale map would be read as if its values were the new currency.
 * Until the new conversions land, foreign entries honestly read "not counted"
 * rather than silently wrong.
 */
import { useEffect, useState } from 'react';

import type { FiatCurrency, ManualEntry } from '../../wallet';
import { convertFiatOnDate } from '../../wallet';

export function useEntryFx(
  entries: readonly ManualEntry[],
  currency: FiatCurrency,
): ReadonlyMap<string, number> | undefined {
  const [fx, setFx] = useState<{ currency: FiatCurrency; map: Map<string, number> }>({
    currency,
    map: new Map(),
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = new Map<string, number>();
      for (const e of entries) {
        if (e.fiatAmount == null || !e.fiatCurrency || e.fiatCurrency === currency) continue;
        const v = await convertFiatOnDate(e.fiatAmount, e.fiatCurrency, currency, e.date / 1000);
        if (v != null) m.set(e.id, v);
      }
      if (!cancelled) setFx({ currency, map: m });
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, currency]);
  return fx.currency === currency ? fx.map : undefined;
}
