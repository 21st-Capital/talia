/**
 * The flash after a copy (decided 2026-09-14: "similar to the screenshot effect
 * on iOS, it could show an effect that blurs the background and shows an
 * 'Address copied' success message"). The page blurs and darkens for a
 * moment with a tick and the message dead centre, then clears. Touches pass
 * through, so a tap on Share right after a copy still lands.
 *
 * Mount it in a page's `overlay` slot (Screen) or as the last child of a
 * full-screen root, so it covers the whole page and not just the scroll
 * content. It fades itself in on mount and out when `visible` drops.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { getColorScheme, theme, themedStyles } from '../theme';
import { COPIED_FLASH_BLUR, COPIED_FLASH_DIM_ALPHA, copiedFlashMaterial } from './copiedFlashBackdrop';
import { DrawnIcon } from './DrawnIcon';
import { GlassPanel } from './GlassPanel';

export function CopiedFlash({ visible, label }: { visible: boolean; label: string }): React.JSX.Element | null {
  const fade = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(fade, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, fade]);
  if (!mounted) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
      <BlurView
        style={StyleSheet.absoluteFill}
        // Light: the page stays recognisable behind the message (decided 2026-09-14:
        // "a little bit less blurry, or more transparent"; decided 2026-10-04:
        // "a little bit more transparent. It looks too blurred"). The
        // material and the two numbers live in copiedFlashBackdrop.ts.
        blurType={copiedFlashMaterial(getColorScheme())}
        blurAmount={COPIED_FLASH_BLUR}
        reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
      />
      <View style={styles.dim} />
      <View style={styles.centre}>
        {/* The same glass as the sheets and dialogs, with the app icon's
            finish on it (decided 2026-09-14: "the same glassy gloss effect like
            the other parts of the app"). */}
        <GlassPanel style={styles.card} radius={theme.radius.lg}>
          <DrawnIcon kind="tick" size={40} strokeWidth={5} />
          <Text style={styles.text}>{label}</Text>
        </GlassPanel>
      </View>
    </Animated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // A thin dim: enough for the card to read over a white QR code, thin
  // enough that the page stays visible behind it (the alpha and why it is
  // on `hull`: copiedFlashBackdrop.ts).
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.hull + COPIED_FLASH_DIM_ALPHA },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: theme.spacing.xl,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    // The light edge glass catches, as on the dock.
    borderColor: theme.colors.offWhite + '2E',
  },
  text: { ...theme.typography.title, color: theme.colors.offWhite },
}));
