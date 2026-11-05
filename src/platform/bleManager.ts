/**
 * The ONE `BleManager` Talia's own code may use.
 *
 * Two separate reasons this is a singleton rather than a `new BleManager()`
 * wherever it is convenient:
 *
 *   1. A BleManager holds a CoreBluetooth central. The Ledger stack already
 *      taught us this the expensive way: its Bluetooth factory built a fresh
 *      manager on every call and leaked one per build (see platform/
 *      ledger.ts). Ours is created once, lazily, and never destroyed for the
 *      life of the process.
 *   2. `startDeviceScan` STOPS any scan already running, on the same manager
 *      or another. Two scanners in the app is not two scans, it is the second
 *      one silently killing the first, so every scan Talia starts must go
 *      through here and stop itself promptly.
 *
 * The Ledger's device-management kit keeps its own manager inside the package
 * and we cannot take that away from it. So the discipline is: never scan for a
 * BitBox while a Ledger scan is running, and vice versa. The BitBox flow stops
 * its scan the moment it has a device.
 */
import { BleManager } from 'react-native-ble-plx';
import type { State } from 'react-native-ble-plx';

let manager: BleManager | null = null;

/** Created on first use: constructing one asks iOS for the Bluetooth stack,
 *  which is not something to do at import time. */
export function bleManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Wait until the radio is actually usable, or say plainly why it is not.
 *  Returns null when ready, otherwise a client-facing reason.
 *
 *  WAITS, never samples. A freshly created manager reports 'Unknown' for the
 *  first few hundred milliseconds while CoreBluetooth boots, and judging that
 *  moment produced a wrong "not ready" on almost every first open, cured by
 *  an immediate retry (decided 2026-08-31). Only a state that MEANS something
 *  (off, denied, absent) is worth reporting; a state that means "still
 *  starting" is worth waiting out. */
export async function bluetoothBlocker(timeoutMs = 6000): Promise<string | null> {
  const mgr = bleManager();
  return await new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.remove();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish('Bluetooth did not start. Close and reopen the app, and check Bluetooth is on in Settings.'),
      timeoutMs,
    );
    const sub = mgr.onStateChange((state: State) => {
      switch (state) {
        case 'PoweredOn':
          finish(null);
          break;
        case 'PoweredOff':
          finish('Bluetooth is switched off. Turn it on and try again.');
          break;
        case 'Unauthorized':
          finish('Talia is not allowed to use Bluetooth. You can grant that in Settings, under Talia.');
          break;
        case 'Unsupported':
          finish('This device has no Bluetooth radio Talia can use.');
          break;
        default:
          // Unknown / Resetting: still booting; the next state decides.
          break;
      }
    }, true);
  });
}
