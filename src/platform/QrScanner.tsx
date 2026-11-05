/**
 * Full-screen QR scanner, isolated behind a component so screens depend on a
 * plain `onScanned(text)` callback rather than the native camera module.
 *
 * Used to import descriptors/xpubs via QR (Sparrow and Liana both export QR).
 *
 * Every scanner in the app is this one component, so the "from a picture"
 * button (decided 2026-09-08) lives here once: bottom left, it opens the photo
 * library, reads the code out of the chosen picture and hands it to the same
 * onScanned as a live read. Its mirror image, bottom right, appears only
 * when the screen offers a typed alternative (`onTypeInstead`, address
 * verification by text, decided 2026-09-12).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { askForCamera, cameraPermission, openAppSettings, type PermissionState } from './permissions';
import { Camera } from 'react-native-camera-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, theme, themedStyles } from '../ui/theme';

/**
 * Anything drawn ON the live camera keeps the DARK palette's colours whatever
 * the app's theme (reported 2026-09-14: "this text is not readable. Its dark on
 * dark"). A camera picture is never the paper ground, so a light-mode token
 * such as `offWhite` (which IS the dark ink on paper) renders dark on dark,
 * and the light palette's deepened gold loses its glow. This is the same rule
 * as Gloss's `onDark`: the surface is a photograph, not a page.
 */
const onCamera = {
  ink: palette.offWhite,
  gold: palette.gold,
  onGold: palette.hull,
} as const;
import { KeyboardIcon, PhotoIcon } from '../ui/components/TablerIcons';
import { PageGlow } from '../ui/components/PageGlow';
import { Gloss } from '../ui/components/Gloss';
import { pickQrFromPhotos } from './qrFromPhoto';

export interface QrScannerProps {
  /**
   * 'own' (a Modal host): paint the page ground and its glow here. 'page':
   * the scanner sits in a stack screen, where the navigator's page layout
   * already lays both and this root stays transparent.
   */
  ground?: 'own' | 'page';
  onScanned: (value: string) => void;
  onCancel: () => void;
  /** Keep scanning after the first read (animated multi-frame QRs like BBQr). */
  continuous?: boolean;
  /** Override the helper line under the reticle. */
  hint?: string;
  /** Extra line (e.g. "Scanned 3 of 7 frames") rendered under the hint. */
  status?: string;
  /** When set, a second round button (bottom right) lets the user leave the
   *  camera and type or paste the value instead. */
  onTypeInstead?: () => void;
}

/**
 * Asks the system when it has never been asked, and reads the answer as it
 * stands when it has (decided 2026-09-26). A refusal given once cannot be asked
 * again by any app, so the screen says so and offers Settings instead of
 * showing a camera that will never start.
 */
async function askAboutTheCamera(): Promise<PermissionState> {
  const now = await cameraPermission();
  return now === 'undetermined' ? askForCamera() : now;
}

export function QrScanner({
  onScanned,
  onCancel,
  continuous,
  hint,
  status,
  onTypeInstead,
  ground = 'own',
}: QrScannerProps): React.JSX.Element {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const handled = useRef(false);
  const lastValue = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  /** The picture path: busy while the picker or the detector runs, and a
   *  short note when the picture held no code. */
  const [picking, setPicking] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  // Asked on every entry to this screen, and read again whenever the app comes
  // back to the front, so returning from Settings starts the camera with
  // nothing more to tap.
  useEffect(() => {
    let alive = true;
    const ask = () => {
      void askAboutTheCamera().then((state) => {
        if (alive) setPermission(state);
      });
    };
    ask();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ask();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const fromPhoto = useCallback(async () => {
    if (picking || (!continuous && handled.current)) return;
    setPicking(true);
    setPhotoNote(null);
    try {
      const value = await pickQrFromPhotos();
      if (value == null) return; // cancelled
      if (continuous) {
        // One picture is one frame. A plain code completes at once; an
        // animated code needs the camera, and the status line says how
        // many frames are still missing.
        lastValue.current = value;
        onScanned(value);
        return;
      }
      handled.current = true;
      onScanned(value);
    } catch (e) {
      setPhotoNote(e instanceof Error ? e.message : 'Could not read that picture.');
    } finally {
      setPicking(false);
    }
  }, [picking, continuous, onScanned]);

  const onReadCode = useCallback(
    (event: { nativeEvent: { codeStringValue: string } }) => {
      const value = event.nativeEvent.codeStringValue.trim();
      if (continuous) {
        // The camera re-reads the same frame many times a second — only pass
        // along changes; the joiner dedupes revisited frames by index anyway.
        if (value === lastValue.current) return;
        lastValue.current = value;
        onScanned(value);
        return;
      }
      if (handled.current) return;
      handled.current = true;
      onScanned(value);
    },
    [onScanned, continuous],
  );

  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <PageGlow />
        <Text style={styles.deniedTitle}>Talia cannot use the camera</Text>
        <Text style={styles.deniedText}>
          Turn the camera on for Talia in your phone's settings, and this screen starts
          scanning.
        </Text>
        <TouchableOpacity onPress={() => void openAppSettings()} style={styles.settingsBtn}>
          <Text style={styles.settingsText}>Open Settings</Text>
        </TouchableOpacity>
        {/* One action on this page, so Back is a plain link under it. */}
        <TouchableOpacity onPress={onCancel} style={styles.backLink} activeOpacity={0.7}>
          <Text style={styles.backLinkText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, ground === 'own' && styles.ownGround]}>
      {/* The page ground with its glow, so the moment before the camera
          starts (and any edge it does not cover) is never a black bar
          (reported 2026-09-12: "there are still dark parts left"). */}
      {ground === 'own' && <PageGlow />}
      {permission != null && (
        <Camera
          style={StyleSheet.absoluteFill}
          // Fill the box like every phone's own camera; "contain" letterboxed
          // the picture between two black bars.
          resizeMode="cover"
          scanBarcode
          onReadCode={onReadCode}
          // The native default throttles to ONE read per 2 s — useless for
          // animated BBQr, where frames change every ~300 ms.
          scanThrottleDelay={continuous ? 80 : 500}
        />
      )}
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.reticle} />
        <Text style={styles.hint}>{hint ?? 'Scan a descriptor or xpub QR'}</Text>
        {!!status && <Text style={styles.status}>{status}</Text>}
        {!!photoNote && <Text style={styles.photoNote}>{photoNote}</Text>}
        <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.roundBtn, styles.photoBtn, { bottom: insets.bottom + theme.spacing.lg }]}
        onPress={() => void fromPhoto()}
        disabled={picking}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Read the code from a picture">
        {/* Over the live camera: sheen and edge only; 52 less the 1pt border each side. */}
        <Gloss size={50} radius={25} glow={false} onDark />
        {picking ? (
          <ActivityIndicator color={onCamera.ink} />
        ) : (
          <PhotoIcon size={26} color={onCamera.ink} />
        )}
      </TouchableOpacity>
      {onTypeInstead && (
        <TouchableOpacity
          style={[styles.roundBtn, styles.typeBtn, { bottom: insets.bottom + theme.spacing.lg }]}
          onPress={onTypeInstead}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Type or paste the address">
          <Gloss size={50} radius={25} glow={false} onDark />
          <KeyboardIcon size={26} color={onCamera.ink} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  container: { flex: 1 },
  ownGround: { backgroundColor: theme.colors.hull },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.hull,
    padding: theme.spacing.xl,
  },
  /** The refusal state is on the app's OWN ground, so it takes the theme's
   *  colours, unlike anything drawn over the camera. */
  deniedTitle: {
    ...theme.typography.title,
    color: theme.colors.offWhite,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  deniedText: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  settingsBtn: {
    backgroundColor: theme.colors.action,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  settingsText: { color: theme.colors.actionText, ...theme.typography.heading },
  backLink: { marginTop: theme.spacing.lg },
  backLinkText: { ...theme.typography.label, color: theme.colors.slate },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 240,
    height: 240,
    borderColor: onCamera.gold,
    borderWidth: 3,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.transparent,
  },
  hint: {
    color: onCamera.ink,
    marginTop: theme.spacing.lg,
    ...theme.typography.body,
    // Long hints used to run off both edges of the camera view, unreadable
    // (decided 2026-07-26) — centre them in a legible band over the picture.
    textAlign: 'center',
    maxWidth: '86%',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  status: {
    color: onCamera.gold,
    marginTop: theme.spacing.sm,
    ...theme.typography.label,
  },
  photoNote: {
    color: onCamera.gold,
    marginTop: theme.spacing.sm,
    ...theme.typography.label,
    textAlign: 'center',
    maxWidth: '86%',
  },
  photoBtn: { left: theme.spacing.lg },
  typeBtn: { right: theme.spacing.lg },
  roundBtn: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(244,241,232,0.35)',
  },
  msg: { color: theme.colors.offWhite, ...theme.typography.body, marginBottom: theme.spacing.lg },
  cancelBtn: {
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.pill,
    backgroundColor: onCamera.gold,
  },
  cancelText: { color: onCamera.onGold, ...theme.typography.label },
}));
