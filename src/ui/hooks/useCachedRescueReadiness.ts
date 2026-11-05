/**
 * What this phone already knows about a vault's rescue readiness, at once.
 *
 * Decided 2026-09-23: "the app loads for quite a while before really knowing if
 * the vault is ready for rescue or not, especially [when] there are a lot of
 * vaults ... it should not take that long to know the timelock is expired."
 * The coins, their funding heights and the chain tip are cached on this
 * phone already, so the answer needs no network at all. The live check still
 * runs behind it wherever one is run.
 *
 * `undefined` while reading, `null` when the cache cannot answer.
 */
import { useEffect, useState } from 'react';

import { agedTipHeight, loadUtxoCache } from '../../wallet/utxoCache';
import { loadTxCache } from '../../wallet/txCache';
import { cachedRescueReadiness } from '../../wallet/rescueReadiness';
import type { RescueReadiness } from '../../wallet/rescueReadiness';

export function useCachedRescueReadiness(
  walletId: string | undefined,
  olderBlocks: number | undefined,
): RescueReadiness | null | undefined {
  const [answer, setAnswer] = useState<RescueReadiness | null | undefined>(undefined);
  useEffect(() => {
    if (!walletId || olderBlocks === undefined) {
      setAnswer(null);
      return;
    }
    let alive = true;
    void (async () => {
      const [cache, txs] = await Promise.all([loadUtxoCache(walletId), loadTxCache(walletId)]);
      if (!alive) return;
      setAnswer(
        cachedRescueReadiness(
          cache?.utxos,
          txs,
          cache ? agedTipHeight(cache) : undefined,
          olderBlocks,
        ),
      );
    })();
    return () => {
      alive = false;
    };
  }, [walletId, olderBlocks]);
  return answer;
}
