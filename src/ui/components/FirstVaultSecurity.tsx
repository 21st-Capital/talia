/**
 * The first vault switches security on (decided 2026-09-08): Face ID, the lock
 * when opening the app, and auth to unhide balances, all at once, once the
 * first vault has landed on this phone. A wallet with money in it should
 * not sit behind nothing because nobody visited Settings.
 *
 * Asked, not sprung ("ask him with a pop up"): a few seconds after the
 * vault lands, while the owner is looking at it, a Talia dialog offers Face
 * ID; the system prompt comes only on Turn on, and only a SUCCESSFUL prompt
 * switches anything ("unless the user denies the access to Face ID"). A
 * denied prompt or Not now leaves everything as it was, since a lock with
 * no way through would shut the owner out of their own app. A phone with no
 * Face ID or Touch ID set up is left alone too; the PIN stays a choice made
 * in Settings.
 *
 * Watches the vault count only once the stored vaults have loaded, so an
 * existing install with vaults never sees this; it is the 0 → 1 moment
 * seen live, whichever screen added the vault.
 */
import React, { useEffect, useRef, useState } from 'react';
import { hasAppPin, useWallets } from '../../wallet';
import { biometricsInfo, promptBiometricStrict } from '../../platform/biometrics';
import { AppDialog } from './AppDialog';

/** How long after the vault lands (or the hardware step ends) the offer appears. */
const OFFER_DELAY_MS = 3500;

/**
 * A screen with its own question to ask first (the single-sig import's
 * "Connect to hardware", found 2026-09-08: the Face ID prompt landed on top of
 * it and closed it) defers the prompt, then resumes it when its step is
 * done. Resuming more than once is harmless; the prompt runs at most once.
 */
let deferred = false;
let pendingRun: (() => void) | null = null;

export function deferFirstVaultSecurity(): void {
  deferred = true;
}

export function resumeFirstVaultSecurity(): void {
  deferred = false;
  const run = pendingRun;
  pendingRun = null;
  if (run) run();
}

export function FirstVaultSecurity(): React.JSX.Element | null {
  const { wallets, settings, loading, updateSettings } = useWallets();
  const prevCount = useRef<number | null>(null);
  const running = useRef(false);
  /** The offer, once the phone has said it has Face ID or Touch ID. */
  const [offer, setOffer] = useState<{ name: string } | null>(null);

  useEffect(() => {
    if (loading) return;
    // Vaults with coins behind them: a portfolio kept by hand shares the
    // list but is not what this protects (a test copy held portfolios
    // and the count never left zero, 2026-09-08).
    const count = wallets.filter((w) => !w.manual).length;
    const prev = prevCount.current;
    prevCount.current = count;
    // Only the moment the first vault arrives, seen live.
    if (prev !== 0 || count === 0) return;
    // Already protected by a method: nothing to switch on.
    if (settings.biometricsEnabled || hasAppPin(settings)) return;
    if (running.current) return;
    running.current = true;
    const run = () => {
      // A little later still, so the offer lands while the owner is looking
      // at the vault, not on top of the screen change.
      setTimeout(() => {
        void (async () => {
          try {
            const info = await biometricsInfo();
            if (!info.available) return;
            const name = info.type === 'FaceID' ? 'Face ID' : info.type === 'TouchID' ? 'Touch ID' : 'biometrics';
            setOffer({ name });
          } catch {
            running.current = false;
          }
        })();
      }, OFFER_DELAY_MS);
    };
    // No cleanup: a re-render in that moment must not cancel the offer.
    setTimeout(() => {
      if (deferred) {
        pendingRun = run; // the screen resumes it when its own step is done
        return;
      }
      run();
    }, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, wallets, settings.biometricsEnabled, settings.pinSet, settings.pinHash, updateSettings]);

  const turnOn = async () => {
    if (!offer) return;
    try {
      // Biometrics only: turning Face ID ON must prove the sensor itself,
      // the phone passcode is no proof of it.
      const ok = await promptBiometricStrict(`Protect your vault with ${offer.name}`);
      if (!ok) return;
      await updateSettings({
        biometricsEnabled: true,
        requireAuthOnOpen: true,
        requireAuthToUnhide: true,
      });
    } catch {
      // A failed prompt leaves the settings as they were.
    } finally {
      running.current = false;
    }
  };

  if (!offer) return null;
  return (
    <AppDialog
      visible
      title={`Protect your vault with ${offer.name}?`}
      actions={[
        { label: `Turn on ${offer.name}`, onPress: () => void turnOn() },
        {
          label: 'Not now',
          variant: 'ghost',
          onPress: () => {
            running.current = false;
          },
        },
      ]}
      onClose={() => setOffer(null)}
    />
  );
}
