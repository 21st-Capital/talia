/**
 * The Ledger's open after the PIN never waits in silence (decided 2026-10-04, a
 * Nano X while signing: "After I put the pin, it doesnt prompt the app
 * opening. Only on the second try it does"). platform/ledger.ts is native
 * I/O, so the shape is pinned here; the behaviour is checked on the device.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'ledger.ts'), 'utf8');

describe('openBitcoinAppReady', () => {
  it('gives up on a silent open of an unlocked device and runs it again on a fresh link', () => {
    expect(src).toMatch(/if \(!progressed && lastStatus !== 'locked'\) \{\s*stalled = true;/);
    expect(src).toMatch(/if \(was === 'locked' && view\.status !== 'locked'\) arm\(\);/);
    expect(src).toMatch(/if \(p != null && p !== 'unlock'\) progressed = true;/);
    expect(src).toMatch(/if \(!unlockSeen && !stalled\) throw e;/);
    expect(src).toMatch(/export const OPEN_STALL_MS = 6000;/);
  });

  it('tries the reconnection a few times, a moment apart', () => {
    expect(src).toMatch(/for \(let i = 0; i < RECONNECT_TRIES && fresh == null; i\+\+\)/);
    expect(src).toMatch(/export const RECONNECT_TRIES = 3;/);
    expect(src).toMatch(/export const RECONNECT_GAP_MS = 1500;/);
  });
});
