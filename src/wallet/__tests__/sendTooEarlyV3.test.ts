/**
 * BDK upgrade (decided 2026-10-15): sendTooEarly.test.ts's checks on the
 * NEW library's transactions (`bdkTimelockedSpends.v3.json`: the same coins
 * and paths, built and finalized by bdk-ffi 3.1.1 from the fork's talia-3
 * line). A finalized spend whose coins have not waited long enough is
 * refused before the network sees it, whichever library finalized it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { signedSpendReadiness } from '../rescueReadiness';
import { signedTxWaits } from '../sendTooEarly';

interface Spend {
  shape: string;
  spend: 'heir' | 'rescue';
  coin: 'old' | 'recent';
  coinTxid: string;
  coinHeight: number;
  tip: number;
  hex: string;
}

const load = (file: string) =>
  (JSON.parse(fs.readFileSync(path.join(__dirname, '../../bitcoin/engine/__fixtures__', file), 'utf8')) as { spends: Spend[] }).spends;
const v3 = load('bdkTimelockedSpends.v3.json');
const v028 = load('bdkTimelockedSpends.json');

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const verdict = (s: Spend, tip = s.tip) =>
  signedSpendReadiness(signedTxWaits(bytes(s.hex), 'testnet')!, [{ txid: s.coinTxid, confirmed: true, blockHeight: s.coinHeight }], tip);

describe('the new library\'s timelocked spends', () => {
  it('are the same spends as 0.28\'s', () => {
    expect(v3.map((s) => [s.shape, s.spend, s.coin, s.coinTxid, s.coinHeight, s.tip])).toEqual(
      v028.map((s) => [s.shape, s.spend, s.coin, s.coinTxid, s.coinHeight, s.tip]),
    );
  });

  it.each(v3.map((s) => [`${s.shape} ${s.spend} ${s.coin}`, s] as const))('%s: the same verdict as 0.28\'s transaction', (_n, s) => {
    const twin = v028.find((o) => o.shape === s.shape && o.spend === s.spend && o.coin === s.coin)!;
    expect(verdict(s)).toEqual(verdict(twin));
    // and the same waits read off the transaction
    expect(signedTxWaits(bytes(s.hex), 'testnet')).toEqual(signedTxWaits(bytes(twin.hex), 'testnet'));
  });

  it('a young coin on a timelocked path waits; an old one goes', () => {
    const find = (shape: string, spend: string, coin: string) => v3.find((s) => s.shape === shape && s.spend === spend && s.coin === coin)!;
    expect(verdict(find('wsh-layered-older', 'rescue', 'recent'))).toEqual({ state: 'waiting', blocks: 65535 - 10 });
    expect(verdict(find('tr-nums-layered-older', 'heir', 'recent'))).toEqual({ state: 'waiting', blocks: 4383 - 10 });
    expect(verdict(find('tr-nums-layered-older', 'rescue', 'old'))).toEqual({ state: 'ready' });
    expect(verdict(find('wsh-after-future', 'rescue', 'old'))).toEqual({ state: 'waiting', blocks: 5000 });
  });
});
