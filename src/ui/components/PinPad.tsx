/**
 * Full-screen PIN pad (Aqua-style): big title, hint, six dots, and a large
 * numeric keypad. Used for setting a PIN (Security settings) and for
 * unlocking the app (AuthGate).
 *
 * `onChange` fires on every keystroke with the current entry — the parent
 * decides when it's complete (fixed length when setting; verify-as-you-type
 * when unlocking, which also covers legacy 4–8 digit PINs).
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';

const MAX_LEN = 8;
const DOTS = 6;

export function PinPad({
  title,
  subtitle,
  error,
  onChange,
  onCancel,
  resetKey,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  onChange: (pin: string) => void;
  onCancel?: () => void;
  /** Bump to clear the entry (e.g. after a wrong PIN or between stages). */
  resetKey?: number;
}): React.JSX.Element {
  const [pin, setPin] = useState('');
  const lastReset = React.useRef(resetKey);
  if (lastReset.current !== resetKey) {
    lastReset.current = resetKey;
    if (pin !== '') setPin('');
  }

  const press = useCallback(
    (k: string) => {
      setPin((prev) => {
        const next =
          k === '<' ? prev.slice(0, -1) : prev.length >= MAX_LEN ? prev : prev + k;
        onChange(next);
        return next;
      });
    },
    [onChange],
  );

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Text style={styles.title}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <View style={styles.dots}>
          {Array.from({ length: DOTS }, (_, i) => (
            <View key={i} style={[styles.dot, i < Math.min(pin.length, DOTS) && styles.dotFilled]} />
          ))}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.pad}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => (
          <View key={row.join()} style={styles.padRow}>
            {row.map((k) => (
              <TouchableOpacity key={k} style={styles.key} onPress={() => press(k)} activeOpacity={0.6}>
                <Text style={styles.keyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <View style={styles.padRow}>
          {onCancel ? (
            <TouchableOpacity style={styles.key} onPress={onCancel} activeOpacity={0.6}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.key} />
          )}
          <TouchableOpacity style={styles.key} onPress={() => press('0')} activeOpacity={0.6}>
            <Text style={styles.keyText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.key} onPress={() => press('<')} activeOpacity={0.6}>
            <Text style={styles.keyText}>⌫</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xl },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    marginTop: theme.spacing.md,
  },
  dots: { flexDirection: 'row', gap: theme.spacing.xl, marginTop: theme.spacing.xxl },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.surfaceRaised,
  },
  dotFilled: { backgroundColor: theme.colors.gold },
  error: { ...theme.typography.body, color: theme.colors.negative, marginTop: theme.spacing.lg },

  pad: { paddingBottom: theme.spacing.xxl, paddingHorizontal: theme.spacing.lg },
  padRow: { flexDirection: 'row' },
  key: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 18 },
  keyText: { fontSize: 34, fontWeight: '400', color: theme.colors.offWhite },
  cancelText: { fontSize: 17, fontWeight: '600', color: theme.colors.slate },
}));
