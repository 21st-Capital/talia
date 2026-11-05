/**
 * Animated multi-frame QR (BBQr): cycles the frames on a paper tile so a
 * hardware wallet's camera (COLDCARD Q) can pick them up in any order.
 * Single-frame payloads render as a plain static QR.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { theme, themedStyles } from '../theme';

/** BBQr spec suggests low ECC — the animation loop is the error correction. */
const FRAME_MS = 300;

export function AnimatedQr({
  frames,
  size = 264,
}: {
  frames: string[];
  size?: number;
}): React.JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (frames.length <= 1) return;
    const iv = setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, FRAME_MS);
    return () => clearInterval(iv);
  }, [frames]);

  return (
    <View style={styles.wrap}>
      <View style={styles.tile}>
        <QRCode
          value={frames[Math.min(index, frames.length - 1)]}
          size={size}
          color={theme.colors.inkOnPaper}
          backgroundColor={theme.colors.paper}
          ecl="L"
        />
      </View>
      {frames.length > 1 && (
        <Text style={styles.caption}>
          Frame {Math.min(index, frames.length - 1) + 1} of {frames.length}. Keep the code in view
        </Text>
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { alignItems: 'center', gap: theme.spacing.sm },
  tile: {
    backgroundColor: theme.colors.paper,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  caption: { ...theme.typography.caption, color: theme.colors.slate },
}));
