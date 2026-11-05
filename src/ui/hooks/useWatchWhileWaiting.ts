/**
 * Keep checking, but only while it can change something (decided 2026-08-28).
 *
 * A client who has asked 21st Capital to co-sign should not have to leave the
 * screen and come back for it to notice the signature arriving. This runs the
 * check on a slow timer while the screen is FOCUSED and the caller says
 * something is still outstanding, and once more the moment the app returns to
 * the foreground, which is what happens when they read our email and come
 * straight back.
 *
 * It stops on its own the moment nothing is waiting, so a settled screen costs
 * nothing. The check must be quiet: no spinners, no flicker — the client is
 * looking at the screen while it runs.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';

/** The slice of react-navigation this needs, so the hook stays testable. */
interface FocusAware {
  isFocused: () => boolean;
  addListener: (event: 'focus' | 'blur', cb: () => void) => () => void;
}

export function useWatchWhileWaiting(
  waiting: boolean,
  check: () => void,
  navigation: FocusAware,
  intervalMs = 15000,
): void {
  useEffect(() => {
    if (!waiting) return;
    let focused = navigation.isFocused();
    const onFocus = navigation.addListener('focus', () => {
      focused = true;
    });
    const onBlur = navigation.addListener('blur', () => {
      focused = false;
    });
    const timer = setInterval(() => {
      if (focused) check();
    }, intervalMs);
    // Coming back from the mail app is the most likely moment for the answer
    // to have changed, and it fires no 'focus' event: the screen never lost
    // focus, the APP did.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused) check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      onFocus();
      onBlur();
    };
  }, [waiting, check, navigation, intervalMs]);
}
