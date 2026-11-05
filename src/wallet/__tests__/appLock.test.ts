/**
 * The lock comes back after the app has been away (decided 2026-09-26).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_LOCK_AFTER_SECONDS,
  LOCK_AFTER_CHOICES,
  lockAfterLabel,
  lockAfterSeconds,
  shouldRelock,
} from '../appLock';

describe('shouldRelock', () => {
  it('never while the app has not left', () => {
    expect(shouldRelock(null, 10_000_000, 0)).toBe(false);
  });
  it('once the chosen time has passed away from the app', () => {
    expect(shouldRelock(0, 59_999, 60)).toBe(false);
    expect(shouldRelock(0, 60_000, 60)).toBe(true);
    expect(shouldRelock(0, 1, 0)).toBe(true);
  });
  it('a clock turned back counts as time up', () => {
    expect(shouldRelock(100_000, 50_000, 900)).toBe(true);
  });
});

describe('the setting', () => {
  it('is short, and unknown values fall back to the default', () => {
    expect(Math.max(...LOCK_AFTER_CHOICES)).toBeLessThanOrEqual(15 * 60);
    expect(lockAfterSeconds({})).toBe(DEFAULT_LOCK_AFTER_SECONDS);
    expect(lockAfterSeconds({ lockAfterSeconds: 3600 })).toBe(DEFAULT_LOCK_AFTER_SECONDS);
    expect(lockAfterSeconds({ lockAfterSeconds: 0 })).toBe(0);
  });
  it('labels read plainly', () => {
    expect(LOCK_AFTER_CHOICES.map(lockAfterLabel)).toEqual(['At once', '1 min', '5 min', '15 min']);
  });
});

describe('the gate', () => {
  const src = (p: string): string => readFileSync(join(__dirname, '..', '..', p), 'utf8');

  it('listens for the app leaving and coming back', () => {
    const gate = src('ui/auth/AuthGate.tsx');
    expect(gate).toMatch(/AppState\.addEventListener/);
    expect(gate).toMatch(/shouldRelock\(/);
  });

  it('draws the lock inside every modal, which is its own window', () => {
    expect(src('ui/components/AppModal.tsx')).toMatch(/LockScreen/);
  });

  it('never compares a PIN itself: services/appPin does', () => {
    for (const f of ['ui/auth/AuthGate.tsx', 'ui/auth/useRequireAuth.tsx', 'ui/screens/SecuritySettingsScreen.tsx']) {
      expect(src(f)).not.toMatch(/verifyPin|hashPin|legacyPinMatches|sha256/);
    }
  });

  it('asks before a lock is weakened in Security settings', () => {
    const s = src('ui/screens/SecuritySettingsScreen.tsx');
    expect(s).not.toMatch(/onChange=\{\(v\) => updateSettings\(\{ requireAuth/);
    expect(s).toMatch(/requireAuth\('Turn off this lock'\)/);
  });

  it('never shuts the owner out: no PIN verifier and no phone passcode opens the lock', () => {
    for (const f of ['ui/auth/AuthGate.tsx', 'ui/auth/useRequireAuth.tsx']) {
      const g = src(f);
      expect(g).toMatch(/relaxPasscodeRequirement\(\)/);
      expect(g).toMatch(/hasVerifier/);
    }
    expect(src('ui/auth/AuthGate.tsx')).toMatch(/if \(!next\.hasVerifier && !settingsRef\.current\.pinHash\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*unlock\(\);/);
  });

  it('the app-switcher card is covered as soon as the app resigns active, not only in the background', () => {
    const swift = readFileSync(join(__dirname, '..', '..', '..', 'ios', 'KeelWallet', 'AppDelegate.swift'), 'utf8');
    expect(swift).toMatch(/func sceneWillResignActive\(_ scene: UIScene\) \{\s*coverWindow\(\)/);
    expect(swift).toMatch(/func sceneDidEnterBackground\(_ scene: UIScene\) \{\s*coverWindow\(\)/);
    expect(swift).toMatch(/func sceneDidBecomeActive[\s\S]*privacyCover\?\.removeFromSuperview\(\)/);
  });

  it('asks before a first PIN is added to a Face ID lock, not only before a PIN is changed', () => {
    const s = src('ui/screens/SecuritySettingsScreen.tsx');
    expect(s).toMatch(/if \(\(hasPin \|\| settings\.biometricsEnabled\) && !\(await requireAuth\(/);
    expect(s).not.toMatch(/if \(hasPin && !\(await requireAuth\('Change PIN'\)\)\) return;/);
  });

  it('hides what the lock covers from VoiceOver, and the lock is a modal view', () => {
    const lockScreen = src('ui/auth/LockScreen.tsx');
    const roots = lockScreen.match(/<View style=\{\[StyleSheet\.absoluteFill[^>]*>/g) ?? [];
    expect(roots.length).toBe(3);
    for (const r of roots) expect(r).toMatch(/accessibilityViewIsModal/);
    expect(src('ui/auth/AuthGate.tsx')).toMatch(/<View style=\{styles\.fill\} \{\.\.\.hiddenWhileLocked\(model\.visible\)\}>\s*\{children\}/);
    expect(src('ui/components/AppModal.tsx')).toMatch(/\{\.\.\.hiddenWhileLocked\(!!lock\?\.visible\)\}>\s*\{children\}/);
  });

  it('never mounts the app while the vault list is not loaded', () => {
    const gate = src('ui/auth/AuthGate.tsx');
    const loadingBranch = gate.indexOf('if (loading) {');
    const appMount = gate.indexOf('{children}');
    expect(loadingBranch).toBeGreaterThan(0);
    expect(loadingBranch).toBeLessThan(appMount);
    // The lock is decided by the settings alone, so it shows while the list waits.
    expect(gate).toMatch(/const locked = settingsLoaded && lockable/);
    expect(gate).not.toMatch(/const locked = !loading/);
  });

  it('moves an old-form PIN out of the settings file at launch', () => {
    const gate = src('ui/auth/AuthGate.tsx');
    expect(gate).toMatch(/adoptLegacyPin\(legacy\)/);
    expect(gate).toMatch(/pinHash: undefined, pinSalt: undefined/);
  });
});

describe('hiddenWhileLocked', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hiddenWhileLocked } = require('../../ui/auth/lockState') as typeof import('../../ui/auth/lockState');
  it('hides everything below while locked, and nothing otherwise', () => {
    expect(hiddenWhileLocked(true)).toEqual({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
    expect(hiddenWhileLocked(false)).toEqual({ accessibilityElementsHidden: false, importantForAccessibility: 'auto' });
  });
});
