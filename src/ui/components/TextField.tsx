/** Labelled text input used across import/send forms. */
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { theme, themedStyles } from '../theme';

/** The control inside the field's right edge (a scan or paste button) is a
 *  40pt square sitting `xs` in from the edge; the text keeps clear of it
 *  and one more `xs`. Named, so the padding tracks the control. */
const TRAILING_SIZE = 40;
const TRAILING_INSET = theme.spacing.xs;

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Taller than the shared multiline height, in points. The Estate Plan's
   *  comment box needs it: clients write real instructions there, including
   *  whole incapacity clauses, and a four-line window makes that feel like the
   *  wrong place to do it (decided 2026-08-30). */
  minHeight?: number;
  autoCapitalize?: 'none' | 'sentences' | 'characters';
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  monospace?: boolean;
  /** Password-style entry (sync password). */
  secure?: boolean;
  error?: string;
  /** A control sitting inside the field's right edge (a scan button on the
   *  Kraken key fields, decided 2026-09-07). The text keeps clear of it. */
  trailing?: React.ReactNode;
  /** Hard cap on the text (vault and portfolio names, decided 2026-09-12). */
  maxLength?: number;
  /** One quiet line under the field (e.g. "Up to 16 characters"). */
  hint?: string;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  minHeight,
  autoCapitalize = 'none',
  keyboardType = 'default',
  monospace,
  error,
  secure,
  trailing,
  maxLength,
  hint,
}: TextFieldProps): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      {/* No label, no label line: a field can carry its name as the
          placeholder instead (the Send fields, decided 2026-09-12). */}
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputWrap}>
        <TextInput
          secureTextEntry={secure}
          style={[
            styles.input,
            multiline && styles.multiline,
            multiline && minHeight != null && { minHeight, maxHeight: minHeight * 2 },
            monospace && styles.mono,
            !!error && styles.inputError,
            trailing != null && styles.inputWithTrailing,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.faint}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
        {/* In a multiline box the control sits beside the FIRST line, where
            the text starts, not floating mid-box. */}
        {trailing != null && (
          <View style={multiline ? styles.trailingTop : styles.trailing}>{trailing}</View>
        )}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {!error && !!hint && <Text style={styles.hintText}>{hint}</Text>}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { gap: theme.spacing.xs },
  inputWrap: { justifyContent: 'center' },
  inputWithTrailing: { paddingRight: TRAILING_INSET + TRAILING_SIZE + TRAILING_INSET },
  trailing: { position: 'absolute', right: TRAILING_INSET, top: 0, bottom: 0, justifyContent: 'center' },
  trailingTop: { position: 'absolute', right: TRAILING_INSET, top: theme.spacing.xs, justifyContent: 'flex-start' },
  label: {
    ...theme.typography.label,
    color: theme.colors.slate,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    color: theme.colors.offWhite,
    ...theme.typography.body,
    // NO line height on a TextInput. The type scale carries one (decided
    // 2026-08-28) and iOS applies it to the input's text box, which
    // crops the glyphs: a phone test caught an email address rendering cut off on
    // the sign-up form. The token's family, size and weight are all we want
    // here; the box's own padding does the spacing.
    lineHeight: undefined,
  },
  // Cap growth so a long descriptor scrolls inside the box instead of
  // pushing the rest of the form off-screen.
  multiline: { minHeight: 96, maxHeight: 200, textAlignVertical: 'top' },
  // The mono token's face and size; its line height stays off an input.
  mono: { fontFamily: theme.typography.mono.fontFamily, fontSize: theme.typography.mono.fontSize },
  inputError: { borderColor: theme.colors.negative },
  errorText: {
    ...theme.typography.caption,
    color: theme.colors.negative,
  },
  hintText: { ...theme.typography.caption, color: theme.colors.faint },
}));
