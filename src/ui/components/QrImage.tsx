/** QR code display wrapper (address / PSBT) on a padded paper tile. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { theme, themedStyles } from '../theme';

export function QrImage({
  value,
  size = 220,
}: {
  value: string;
  size?: number;
}): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <QRCode
        value={value}
        size={size}
        color={theme.colors.inkOnPaper}
        backgroundColor={theme.colors.paper}
        ecl="M"
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  tile: {
    alignSelf: 'center',
    backgroundColor: theme.colors.paper,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
}));
