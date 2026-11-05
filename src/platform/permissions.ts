/**
 * Asking again, every time (decided 2026-09-26).
 *
 * The rule: a permission refused once, by accident or long ago ("Don't
 * Allow" for the camera, say), must never leave a blank screen behind. Before
 * this, a refused camera showed a blank state at every later scan, with no
 * word on why, and a client who had forgotten the refusal could not tell
 * what was wrong. Every entry to a feature now says so and offers the way
 * back.
 *
 * iOS shows its own permission dialog ONCE. After a "Don't Allow" the system
 * never asks again, whatever the app does: the only way back is the app's own
 * page in Settings. So "ask again" means this, at every entry to a feature
 * that needs a permission:
 *
 *   undetermined  ask the system, which shows its dialog
 *   denied        say so on screen and offer Settings in one tap
 *   granted       carry on
 *
 * and the answer is read again whenever the app comes back to the front, so
 * returning from Settings starts the camera with nothing more to tap.
 *
 * The camera answer comes from the camera library's own native module, which
 * reports the three states apart (`-1` for undetermined, and it is TRUTHY in
 * JavaScript, so never test it as a boolean). It is asked for through
 * `TurboModuleRegistry.get`, never by importing the package's spec, which
 * throws when a binary lacks the module and takes the whole bundle with it
 * ([rn-native-module-lazy-require-fatal]).
 */
import { Linking, PermissionsAndroid, Platform, TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';
import { readIosAnswer, type PermissionState } from './permissionAnswer';

export type { PermissionState } from './permissionAnswer';

interface CameraKitModule extends TurboModule {
  checkDeviceCameraAuthorizationStatus: () => Promise<boolean | number>;
  requestDeviceCameraAuthorization: () => Promise<boolean | number>;
}

function cameraModule(): CameraKitModule | null {
  try {
    return TurboModuleRegistry.get<CameraKitModule>('RNCameraKitModule') ?? null;
  } catch {
    return null;
  }
}

/** What the camera permission stands at right now, asking nobody. */
export async function cameraPermission(): Promise<PermissionState> {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      // Android cannot tell "never asked" from "refused" without asking, and
      // asking is what the caller does next.
      return granted ? 'granted' : 'undetermined';
    } catch {
      return 'unknown';
    }
  }
  const camera = cameraModule();
  if (!camera) return 'unknown';
  try {
    return readIosAnswer(await camera.checkDeviceCameraAuthorizationStatus());
  } catch {
    return 'unknown';
  }
}

/**
 * The camera permission, asking the system when it has never been asked. A
 * refusal already given is returned as it stands: the system will not show
 * its dialog a second time, and `openAppSettings` is the way on.
 */
export async function askForCamera(): Promise<PermissionState> {
  if (Platform.OS === 'android') {
    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: 'Camera',
        message: 'Talia needs the camera to scan codes.',
        buttonPositive: 'OK',
      });
      if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'denied' : 'undetermined';
    } catch {
      return 'unknown';
    }
  }
  const camera = cameraModule();
  if (!camera) return 'unknown';
  try {
    const now = readIosAnswer(await camera.checkDeviceCameraAuthorizationStatus());
    if (now !== 'undetermined') return now;
    return readIosAnswer(await camera.requestDeviceCameraAuthorization());
  } catch {
    return 'unknown';
  }
}

/** Talia's own page in the phone's settings, where a refusal is undone. */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing to do: the screen still says which switch to turn on.
  }
}
