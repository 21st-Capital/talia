/**
 * The app lock's state, kept OUTSIDE React (decided 2026-09-26).
 * The app root remounts on a theme change (`key={scheme}` in
 * App.tsx); lock state held in AuthGate's own useState was lost with it.
 * AppModal reads the same state, because a Modal is its own window and would
 * otherwise stay visible, and usable, above the lock screen.
 */
import React from 'react';

export interface LockState {
  /** The owner got past the lock at least once in this process. */
  unlockedOnce: boolean;
  /** The lock came back after the app was away (see wallet/appLock.ts). */
  relocked: boolean;
  /** The app is in the background: everything is covered. */
  covered: boolean;
  /** When the app last went to the background, null while it is in front. */
  leftAt: number | null;
}

let state: LockState = { unlockedOnce: false, relocked: false, covered: false, leftAt: null };
const listeners = new Set<() => void>();

export function getLockState(): LockState {
  return state;
}

export function setLockState(patch: Partial<LockState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLockState(): LockState {
  return React.useSyncExternalStore(subscribeLock, getLockState);
}

/** What a lock screen shows and does. AuthGate owns it; every surface that
 *  must hide behind the lock (the root, each open modal) renders it. */
export interface LockModel {
  /** Show the lock (or the plain cover) over this surface. */
  visible: boolean;
  /** Only the cover (app in the background): no prompt, no pad. */
  coverOnly: boolean;
  pinFirst: boolean;
  biometricsEnabled: boolean;
  /** Face ID is off for Talia in iOS Settings. */
  bioUnavailable: boolean;
  /** A Face ID try failed: offer the manual Unlock button. */
  bioFailed: boolean;
  pinError: string | null;
  pinReset: number;
  /** Offer the phone passcode (too many PIN tries, or no PIN verifier). */
  offerPasscode: boolean;
  onPinChange: (pin: string) => void;
  tryBiometric: () => void;
  openWithPasscode: () => void;
}

export const LockContext = React.createContext<LockModel | null>(null);

/**
 * Props for the view that holds what the lock covers (the app, or an open
 * modal's content). An opaque view on top hides it from the eye, not from
 * VoiceOver, which still reads and moves through every element behind it
 * (decided 2026-09-30): these take it out of the accessibility tree while the
 * lock is up. The lock itself is `accessibilityViewIsModal` (LockScreen).
 */
export function hiddenWhileLocked(locked: boolean): {
  accessibilityElementsHidden: boolean;
  importantForAccessibility: 'no-hide-descendants' | 'auto';
} {
  return {
    accessibilityElementsHidden: locked,
    importantForAccessibility: locked ? 'no-hide-descendants' : 'auto',
  };
}
