/**
 * App lock. When "require auth on open" is enabled (and a method is
 * configured), the app shows the lock until the owner authenticates.
 * Biometrics prompt silently; the full-screen PIN pad is the fallback (or the
 * primary method when biometrics are off).
 *
 * The biometric prompt is the passcode-backed one (see platform/biometrics):
 * once iOS has locked Face ID after too many failed tries, the same prompt
 * goes straight to the phone passcode, so the owner is never shut out until
 * Face ID is reset outside the app (decided 2026-09-12). With an app PIN set, a
 * locked-out or unavailable Face ID lands on the PIN pad at once.
 *
 * Decided 2026-09-26: the lock used to run once per
 * launch and never came back, so after one unlock the app stayed open to
 * whoever picked the phone up. Now:
 *   - leaving the app covers it (and iOS's own snapshot is covered natively,
 *     SceneDelegate in AppDelegate.swift), and coming back after the time
 *     chosen in Security settings (wallet/appLock.ts) asks again;
 *   - a lock that comes back is drawn OVER the app, never instead of it, so
 *     a half-built vault or a signing session is still there afterwards; and
 *     every open modal draws it too (AppModal), because a modal is its own
 *     window above everything else;
 *   - the PIN is checked by services/appPin.ts: a Keychain verifier, a count
 *     of wrong tries with growing waits, and the phone passcode as the way
 *     through after too many (decided the same day). Nobody is ever locked out. An
 *     old-form PIN is moved out of the settings file into the Keychain at
 *     the first launch, whatever unlocks the app.
 *
 * Decided 2026-09-30:
 *   - The app switcher card: iOS shows the LIVE window there while Talia is
 *     only inactive, so the native cover goes on at sceneWillResignActive
 *     (AppDelegate.swift), not only in the background.
 *   - While the vault list is not loaded (a Keychain that does not answer,
 *     or data this phone cannot open) the app is NOT mounted: the lock shows
 *     as configured (settings load on their own), then a plain cover or the
 *     StoreProblemScreen. wallet/storage refuses every save meanwhile.
 *   - VoiceOver: while the lock is up, everything under it is hidden from
 *     accessibility (`hiddenWhileLocked`), and the lock is a modal view.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, StyleSheet, View } from 'react-native';
import {
  hasAppPin,
  lockAfterSeconds,
  shouldRelock,
  useWallets,
  waitMessage,
} from '../../wallet';
import { promptBiometric } from '../../platform/biometrics';
import type { BiometricFailReason } from '../../platform/biometrics';
import {
  adoptLegacyPin,
  checkPin,
  pinStatus,
  relaxPasscodeRequirement,
  resetPinTries,
} from '../../services/appPin';
import type { PinStatus } from '../../services/appPin';
import { LockContext, getLockState, hiddenWhileLocked, setLockState, useLockState } from './lockState';
import type { LockModel } from './lockState';
import { LockScreen } from './LockScreen';
import { StoreProblemScreen } from './StoreProblemScreen';

export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { settings, loading, settingsLoaded, storeProblem, retryLoad, startOverStore, updateSettings } =
    useWallets();
  const hasPin = hasAppPin(settings);
  const lockable = settings.requireAuthOnOpen && (settings.biometricsEnabled || hasPin);
  const lock = useLockState();

  const [pinError, setPinError] = useState<string | null>(null);
  const [pinReset, setPinReset] = useState(0);
  const [triedBio, setTriedBio] = useState(false);
  /** Why the last biometric prompt did not unlock; null until one has failed. */
  const [bioFail, setBioFail] = useState<BiometricFailReason | null>(null);
  /** What the Keychain says about the PIN; null until read. */
  const [status, setStatus] = useState<PinStatus | null>(null);
  const checking = useRef(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const lockableRef = useRef(lockable);
  lockableRef.current = lockable;

  // With no lock configured the app is simply open: switching the lock on
  // later must not throw the owner out on the spot.
  useEffect(() => {
    if (settingsLoaded && !lockable && !getLockState().unlockedOnce) setLockState({ unlockedOnce: true });
  }, [settingsLoaded, lockable]);

  // An old-form PIN leaves the settings file at the first launch, whatever
  // unlocks the app: a Face ID user may never type it (decided 2026-09-30).
  useEffect(() => {
    if (!settingsLoaded || !settings.pinHash || !settings.pinSalt) return;
    const legacy = { salt: settings.pinSalt, hash: settings.pinHash };
    void adoptLegacyPin(legacy).then((moved) => {
      if (moved) void updateSettings({ pinSet: true, pinHash: undefined, pinSalt: undefined });
    });
  }, [settingsLoaded, settings.pinHash, settings.pinSalt, updateSettings]);

  // Leaving covers the app; coming back after the chosen time locks it again.
  // 'inactive' alone (the Face ID sheet, Control Centre) changes nothing.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        setLockState({ leftAt: Date.now(), covered: true });
        return;
      }
      if (next !== 'active') return;
      const s = getLockState();
      const relock =
        lockableRef.current &&
        s.unlockedOnce &&
        shouldRelock(s.leftAt, Date.now(), lockAfterSeconds(settingsRef.current));
      setLockState({ leftAt: null, covered: false, relocked: s.relocked || relock });
      if (relock) {
        Keyboard.dismiss(); // the pad needs the room
        setTriedBio(false);
        setBioFail(null);
        setPinError(null);
        setPinReset((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, []);

  const locked = settingsLoaded && lockable && (!lock.unlockedOnce || lock.relocked);
  const covered = settingsLoaded && lockable && lock.covered;

  useEffect(() => {
    if (locked && hasPin) void pinStatus().then(setStatus);
  }, [locked, hasPin]);

  const unlock = useCallback(() => {
    setLockState({ unlockedOnce: true, relocked: false });
    setPinError(null);
    void resetPinTries();
  }, []);

  const tryBiometric = useCallback(async () => {
    setTriedBio(true);
    const outcome = await promptBiometric('Unlock Talia');
    if (outcome.ok) unlock();
    else setBioFail(outcome.reason); // only now show a manual retry affordance
  }, [unlock]);

  useEffect(() => {
    // Never while covered: that is the app in the background.
    if (locked && !covered && settings.biometricsEnabled && !triedBio) {
      void tryBiometric();
    }
  }, [locked, covered, settings.biometricsEnabled, triedBio, tryBiometric]);

  const openWithPasscode = useCallback(async () => {
    const outcome = await promptBiometric('Unlock Talia with your passcode');
    if (outcome.ok) {
      unlock();
      return;
    }
    if (outcome.reason === 'unavailable') {
      // This phone has no passcode to ask for. The PIN stays the way in, one
      // try at a time with the longest wait, so nobody is locked out.
      await relaxPasscodeRequirement();
      const next = await pinStatus();
      if (!next.hasVerifier && !settingsRef.current.pinHash) {
        // No PIN verifier on this phone and no passcode to ask for: nothing
        // could ever open the lock, so it must not stay shut.
        unlock();
        return;
      }
      setStatus(next);
    }
  }, [unlock]);

  const onPinChange = useCallback(
    (pin: string) => {
      if (checking.current) return;
      const known = status?.length ?? null;
      if (known != null ? pin.length !== known : pin.length < 4) {
        if (pin.length < 4) setPinError(null);
        return;
      }
      checking.current = true;
      // Let the last dot paint before the check takes the thread.
      setTimeout(() => {
        void (async () => {
          try {
            const s = settingsRef.current;
            const result = await checkPin(pin, {
              legacy: s.pinHash && s.pinSalt ? { salt: s.pinSalt, hash: s.pinHash } : undefined,
              final: known != null || pin.length >= 8,
            });
            if (result.kind === 'incomplete') return;
            if (result.kind === 'ok') {
              if (result.upgraded) {
                await updateSettings({ pinSet: true, pinHash: undefined, pinSalt: undefined });
              }
              unlock();
              return;
            }
            setStatus(result.status);
            setPinError(
              result.status.passcodeRequired
                ? 'Use your phone passcode to open Talia.'
                : result.status.waitMs > 0
                  ? waitMessage(result.status.waitMs)
                  : 'Wrong PIN. Try again.',
            );
            setPinReset((k) => k + 1);
          } finally {
            checking.current = false;
          }
        })();
      }, 30);
    },
    [status, unlock, updateSettings],
  );

  const model: LockModel = useMemo(
    () => ({
      visible: locked || covered,
      coverOnly: covered || !locked,
      pinFirst: hasPin && (!settings.biometricsEnabled || bioFail !== null),
      biometricsEnabled: settings.biometricsEnabled,
      bioUnavailable: bioFail === 'unavailable',
      bioFailed: bioFail !== null,
      pinError,
      pinReset,
      offerPasscode:
        status != null &&
        (status.passcodeRequired || status.waitMs > 0 || (!status.hasVerifier && !settings.pinHash)),
      onPinChange,
      tryBiometric: () => void tryBiometric(),
      openWithPasscode: () => void openWithPasscode(),
    }),
    [locked, covered, hasPin, settings.biometricsEnabled, settings.pinHash, bioFail, pinError, pinReset, status, onPinChange, tryBiometric, openWithPasscode],
  );

  // Settings not read yet: nothing is known about the lock, show nothing.
  if (!settingsLoaded) {
    return (
      <LockContext.Provider value={model}>
        <View style={styles.fill}>
          <LockScreen model={{ ...model, coverOnly: true }} />
        </View>
      </LockContext.Provider>
    );
  }

  // Before the first unlock nothing of the app is mounted at all, as before.
  if (locked && !lock.unlockedOnce) {
    return (
      <LockContext.Provider value={model}>
        <View style={styles.fill}>
          <LockScreen model={model} />
        </View>
      </LockContext.Provider>
    );
  }

  // Past the lock but the vault list is not loaded: never the app itself,
  // which would show an empty list and could save it over the real one.
  if (loading) {
    return (
      <LockContext.Provider value={model}>
        <View style={styles.fill}>
          <View style={styles.fill} {...hiddenWhileLocked(model.visible)}>
            {storeProblem ? (
              <StoreProblemScreen problem={storeProblem} onRetry={retryLoad} onStartFresh={startOverStore} />
            ) : (
              <LockScreen model={{ ...model, coverOnly: true }} />
            )}
          </View>
          {model.visible && <LockScreen model={model} />}
        </View>
      </LockContext.Provider>
    );
  }

  return (
    <LockContext.Provider value={model}>
      {/* Always this one wrapper, so locking never remounts the app. */}
      <View style={styles.fill} {...hiddenWhileLocked(model.visible)}>
        {children}
      </View>
      {model.visible && <LockScreen model={model} />}
    </LockContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
