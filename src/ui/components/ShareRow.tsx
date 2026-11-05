/**
 * The share row: the system sheet, Telegram and WhatsApp, each a 56pt
 * circle with a name under it. Receive shares an address with it; Share
 * portfolio shares an invite link (decided 2026-09-14: "add the same share icons
 * we have for sharing a bitcoin address"). One component, so the two rows
 * cannot drift apart.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import { TelegramIcon, WhatsAppIcon } from './BrandShareIcons';
import { IosShareIcon } from './TablerIcons';

export type ShareTarget = 'system' | 'telegram' | 'whatsapp';

export function ShareRow({ onShare }: { onShare: (target: ShareTarget) => void }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <ShareButton label="SHARE" onPress={() => onShare('system')}>
        <View style={styles.circle}>
          <Gloss size={56} radius={28} />
          {/* The share mark the transaction page's header shows, drawn, not a
              "↑" glyph (decided 2026-10-05). */}
          <IosShareIcon size={24} color={theme.colors.offWhite} />
        </View>
      </ShareButton>
      <ShareButton label="TELEGRAM" onPress={() => onShare('telegram')}>
        <View style={styles.art}>
          <TelegramIcon size={56} />
          {/* The brand draws its own circle, so the glass goes on top with a light bloom. */}
          <Gloss size={56} radius={28} glow="light" />
        </View>
      </ShareButton>
      <ShareButton label="WHATSAPP" onPress={() => onShare('whatsapp')}>
        <View style={styles.art}>
          <WhatsAppIcon size={56} />
          <Gloss size={56} radius={28} glow="light" />
        </View>
      </ShareButton>
    </View>
  );
}

function ShareButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={label}>
      {children}
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: theme.spacing.xl,
    marginTop: theme.spacing.sm,
  },
  btn: { alignItems: 'center', gap: theme.spacing.xs },
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: { width: 56, height: 56 },
  label: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1 },
}));
