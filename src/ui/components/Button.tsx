/**
 * Keel button. Site-parity rules (decided 2026-07-17):
 *   dark theme  → white background, black text
 *   light theme → black background, white text
 * `primary` and `accent` both render that action style (legacy call sites
 * keep working); `selection` is the lime selected-chip state; `ghost` stays
 * the quiet outline.
 */
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { theme, themedStyles } from '../theme';

/**
 * Every mounted ACTION button (primary or accent), so the keyboard scroller
 * can measure where a field's confirm actually is instead of guessing
 * (useRevealFocusedField, decided 2026-09-18). Ghost and selection buttons are
 * never a confirm.
 */
type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
const confirmButtons = new Set<React.RefObject<Measurable | null>>();

export async function measureConfirmButtons(): Promise<Array<{ y: number; h: number }>> {
  const out: Array<{ y: number; h: number }> = [];
  await Promise.all(
    [...confirmButtons].map(
      (ref) =>
        new Promise<void>((resolve) => {
          const node = ref.current;
          if (!node?.measureInWindow) return resolve();
          node.measureInWindow((_x, y, _w, h) => {
            // An unmounted or hidden button measures as nothing; skip it.
            if (h > 0) out.push({ y, h });
            resolve();
          });
        }),
    ),
  );
  return out;
}

type Variant = 'primary' | 'accent' | 'ghost' | 'selection';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** What VoiceOver reads instead of the title, for a screen that shows the
   *  same title several times ("Assign vault 3 to someone else"). */
  accessibilityLabel?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityLabel,
}: ButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading;
  const ref = useRef<Measurable | null>(null);
  const isConfirm = variant === 'primary' || variant === 'accent';
  useEffect(() => {
    if (!isConfirm) return;
    confirmButtons.add(ref);
    return () => {
      confirmButtons.delete(ref);
    };
  }, [isConfirm]);
  return (
    <TouchableOpacity
      ref={ref as unknown as React.Ref<React.ComponentRef<typeof TouchableOpacity>>}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        styles.base,
        styles[variant],
        isDisabled && (variant === 'ghost' ? styles.disabledGhost : styles.disabled),
        style,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'ghost' ? theme.colors.offWhite : theme.colors.actionText}
        />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`], isDisabled && styles.disabledLabel]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  base: {
    // Buttons stacked one under another are ALWAYS the same width (decided
    // 2026-09-23: "why are the bottons in three different sizes? that looks
    // really odd"). A button sized itself to its own label wherever its
    // container centred its children, so three actions in one sheet came
    // out three widths. Stretching here fixes every screen at once; a
    // caller that genuinely needs a narrow button passes its own style,
    // which is applied last.
    alignSelf: 'stretch',
    minHeight: 50,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 13,
  },
  primary: { backgroundColor: theme.colors.action },
  accent: { backgroundColor: theme.colors.action },
  selection: { backgroundColor: theme.colors.accent },
  ghost: {
    backgroundColor: theme.colors.transparent,
    borderWidth: 1.5,
    borderColor: theme.colors.hairline,
  },
  // A button that cannot be pressed is drawn in its own COLOURS, never with
  // `opacity` (reported 2026-09-16: "the continue button shows as gray even if
  // everything is ready to continue. It actually works if the user clicks
  // it"). `opacity` on a TouchableOpacity is not ours: the touchable drives
  // that property with its own native Animated.Value for press feedback, and
  // paints from it rather than from the style, so the dim of an earlier
  // render can stay on screen after the button goes live. A background colour
  // re-renders like anything else and cannot go stale.
  disabled: { backgroundColor: theme.colors.actionMuted },
  disabledGhost: { borderColor: theme.colors.faint },
  disabledLabel: { color: theme.colors.actionTextMuted },
  // Centered even when the label wraps to two lines.
  label: { ...theme.typography.heading, textAlign: 'center' },
  primaryLabel: { color: theme.colors.actionText },
  accentLabel: { color: theme.colors.actionText },
  selectionLabel: { color: theme.colors.accentInk },
  ghostLabel: { color: theme.colors.offWhite },
}));
