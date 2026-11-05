/**
 * The QR a person or a phone app scans: dark on a rounded light tile with the
 * Talia mark dead centre. Born on Receive (the Bitcoin address) and shared
 * with two-factor setup (decided 2026-09-21: "match the design of the QR code
 * with the BTC addresses QR design"), so the two can never drift apart.
 *
 * Not for codes a hardware device reads (vault registration, the animated
 * signing codes, Export to Talia): those stay plain in QrImage / AnimatedQr,
 * because the mark forces the densest error correction and small device
 * cameras read only small codes.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { theme, themedStyles } from '../theme';
import { TaliaLogo } from './TaliaLogo';

export function BrandedQr({ value, size = 240 }: { value: string; size?: number }): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <QRCode
        value={value}
        size={size}
        color={theme.colors.inkOnPaper}
        backgroundColor={theme.colors.paper}
        ecl="H"
      />
      {/* The mark over the centre; ecl H tolerates the occlusion. */}
      <View style={styles.badge} pointerEvents="none">
        <TaliaLogo size={Math.round((size * 52) / 240)} />
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  tile: {
    alignSelf: 'center',
    backgroundColor: theme.colors.paper,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
  },
  badge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
