/**
 * Watchdog for native engine calls. The wallet library's bridge runs every
 * wallet call on one serial native queue (native/bdkwallet `walletQueue`;
 * bdk-rn's `bdkQueue` until the old engine's removal, decided 2026-11-04),
 * so a hung sync would otherwise leave the UI spinning forever — this makes
 * the JS side give up with a readable error while the native call unwinds.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. Check the server in Settings → Network`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
