/**
 * The app's two haptics, both iOS's own feedback generators.
 *
 * The tick when you switch tabs (decided 2026-09-15: "a tiny vibration when user
 * switches between the menu ... Use the smallest possible single vibration
 * available"). iOS's selection feedback: the lightest haptic the system has,
 * the one a picker wheel makes as it clicks from one value to the next. Never
 * React Native's Vibration API, which on an iPhone is a full, long buzz.
 *
 * The Sent page's tick (decided 2026-10-02, design C): iOS's SUCCESS notification,
 * the moment the drawn mark finishes inking, once per page (`sentTick`).
 *
 * The native half comes from react-native-haptic-feedback, but its JavaScript
 * is never loaded. That package looks up its native module the moment it
 * loads and THROWS when the binary lacks it, and Metro reports a module that
 * throws while loading as a FATAL error before any try/catch around
 * require() can see it: the first tab tap on the simulator's older binary
 * aborted the app (2026-09-15). So the module is asked for with the lookup
 * that returns null instead of throwing, and a phone or simulator without it
 * stays silent.
 *
 * patches/react-native-haptic-feedback+3.0.0.patch changes three things in
 * the library (decided 2026-09-15: "the only thing now missing is a short
 * vibration"). On any iPhone with Core Haptics its "selection" was NOT
 * Apple's selection tick but a 0.2-intensity pulse from an engine started on
 * first use: too faint to feel, so the tick never played in either
 * test app. The patch sends "selection" to UIKit's
 * UISelectionFeedbackGenerator on every iPhone, and since 2026-10-02
 * "notificationSuccess" to UINotificationFeedbackGenerator the same way: on
 * Core Haptics hardware the library would otherwise play its own faint
 * two-pulse pattern instead of iOS's success haptic. It also registers the
 * module in the generated module list (codegenConfig.ios.modulesProvider),
 * as react-native-webview does. A changed patch is a NATIVE change: it
 * reaches a phone only with a native build.
 */
import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';

interface HapticFeedbackSpec extends TurboModule {
  trigger(
    type: string,
    options?: { enableVibrateFallback?: boolean; ignoreAndroidSystemSettings?: boolean },
  ): void;
}

let native: HapticFeedbackSpec | null | undefined;

function haptics(): HapticFeedbackSpec | null {
  if (native === undefined) {
    try {
      native = TurboModuleRegistry.get<HapticFeedbackSpec>('RNHapticFeedback');
    } catch {
      native = null;
    }
  }
  return native ?? null;
}

/**
 * The same selection tick, for a row swiped far enough that letting go will
 * remove it (decided 2026-11-05): the hand feels the point it crossed.
 */
export function swipeTick(): void {
  tabSwitchTick();
}

/** One selection tick. Silent where there are no haptics. */
export function tabSwitchTick(): void {
  try {
    haptics()?.trigger('selection', { enableVibrateFallback: false, ignoreAndroidSystemSettings: false });
  } catch {
    // No haptics on this device or binary: switching tabs stays silent.
  }
}

/**
 * iOS's success notification haptic, for the Sent page as its mark finishes
 * inking. Silent where there are no haptics.
 */
export function sentTick(): void {
  try {
    haptics()?.trigger('notificationSuccess', { enableVibrateFallback: false, ignoreAndroidSystemSettings: false });
  } catch {
    // No haptics on this device or binary: the page stays silent.
  }
}
