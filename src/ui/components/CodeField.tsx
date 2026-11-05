/**
 * The one true 6-digit code input (decided 2026-07-23) — used for EVERY OTP /
 * authenticator code across the app so they all look and behave the same.
 *
 * Six digit boxes driven by ONE real number-pad input laid over them with
 * invisible ink (iOS offers an emailed code above the keyboard only for a
 * field it takes to be visible), and a clear label saying WHICH code this is.
 * Non-numeric recovery codes stay on a plain TextField: this is digits only.
 *
 * The "Paste code" button follows the code's SOURCE (decided 2026-09-16: "you can
 * delete the Paste code button because it becomes unnecessary. Either the user
 * will type it or he will grab it from the suggestion. You can keep the paste
 * code button for the Authenticator OTP"). So it is shown wherever the code
 * has to be carried by hand, which is exactly where `oneTimeCode` is false: an
 * authenticator app, or a code read off the confirmation page. An emailed code
 * shows no button, because the phone offers it and typing six digits is the
 * fallback.
 *
 * THE WHOLE STEP LIVES HERE (reported 2026-08-29: "there are way too many buttons").
 * A six-digit code submits itself the moment the sixth digit lands, so a
 * "Verify & continue" button underneath was a button that never needed
 * pressing. Resending belongs beside the prompt, not at the bottom of a stack.
 * So this component owns the label, the boxes, the resend link, the paste
 * link, the working state and the error, and a caller is left with the one
 * button that does something else: Cancel, or Back.
 *
 * It also owns the RETRY. A wrong code leaves six digits sitting in the boxes,
 * and onComplete only fires when the sixth digit lands, so without clearing
 * them the client would be stuck staring at a code that will never resubmit.
 * Passing `error` clears the boxes, which is the behaviour every one-time-code
 * field should have and which no caller should have to remember.
 *
 * Above the keyboard it is the WHOLE field that has to show, the boxes with
 * the Paste and the error under them (decided 2026-10-18), not the invisible input
 * alone, which covers the boxes only: the field registers itself as its
 * input's extent (hooks/fieldExtent.ts) and the page's keyboard scroller
 * keeps all of it clear of the keys and the footer.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { heroLabel, theme, themedStyles } from '../theme';
import { Button } from './Button';
import { readClipboard } from '../../platform/clipboard';
import { registerFieldExtent } from '../hooks/fieldExtent';

/**
 * The digits' size, the one code in the app drawn above the type scale
 * (sanctioned, decided 2026-10-05): six boxes read at arm's length while the
 * client compares them with the authenticator. The invisible input over the
 * boxes is set at the same size so a tap lands on the digit it covers.
 */
const CODE_DIGIT_SIZE = 28;

export function CodeField({
  value,
  onChange,
  onComplete,
  label,
  length = 6,
  autoFocus = true,
  showPaste,
  oneTimeCode = true,
  error,
  onAlternative,
  alternativeLabel = 'Resend code',
  busy = false,
  busyLabel = 'Checking…',
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fired when the user reaches `length` digits — wire it to auto-submit. */
  onComplete?: (v: string) => void;
  /** A clear "which code is this" heading, e.g. "Code from your email". */
  label?: string;
  length?: number;
  /** Opens the keyboard on mount. ON by default (decided 2026-09-01, now that
   *  every code screen scrolls itself above the keyboard): the boxes are
   *  ready to type into, and the paste button still sits right below. */
  autoFocus?: boolean;
  /** Defaults to the OPPOSITE of `oneTimeCode`: the button belongs where the
   *  code has to be carried by hand. */
  showPaste?: boolean;
  /** The code arrives in an email the phone can read, so iOS offers it over
   *  the keyboard: true for the emailed OTP, false for an authenticator's and
   *  for one read off a confirmation page. */
  oneTimeCode?: boolean;
  /** The last failure. Shown under the boxes, and CLEARS them so the client
   *  can simply try again. */
  error?: string;
  /**
   * The way out when this code is not working, offered under the prompt where
   * someone looks first: resend the email, or fall back to a recovery code
   * (decided 2026-08-29 wanted both in the same place).
   */
  onAlternative?: () => void;
  alternativeLabel?: string;
  /** Checking the code: the paste link becomes a working line. */
  busy?: boolean;
  busyLabel?: string;
}): React.JSX.Element {
  const inputRef = useRef<TextInput | null>(null);
  const fieldRef = useRef<View | null>(null);
  // The boxes, the Paste and the error are one field to the keyboard scroller.
  useEffect(
    () =>
      registerFieldExtent({
        focused: () => inputRef.current?.isFocused() ?? false,
        extent: () => fieldRef.current,
      }),
    [],
  );

  // A new error means the code in the boxes was refused. Clear it, so the next
  // paste or the next six taps submit again. Deliberately no refocus: most
  // people paste, and the keyboard would cover the message telling them why.
  const lastError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (error && error !== lastError.current && value.length > 0) onChange('');
    lastError.current = error;
  }, [error, value.length, onChange]);

  const set = (raw: string): void => {
    const clean = raw.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  const paste = async (): Promise<void> => {
    const text = (await readClipboard()) ?? '';
    // Prefer a standalone run of exactly `length` digits (handles "code: 123456
    // — valid 10 min"); otherwise fall back to stripping to digits.
    const m = text.match(new RegExp(`\\b\\d{${length}}\\b`));
    set(m ? m[0] : text);
  };

  return (
    <View ref={fieldRef} style={cf.container}>
      {label ? <Text style={cf.label}>{label}</Text> : null}
      {onAlternative ? (
        <TouchableOpacity onPress={onAlternative} disabled={busy} activeOpacity={0.7}>
          <Text style={[cf.alt, busy && cf.altOff]}>{alternativeLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => inputRef.current?.focus()}
        style={cf.wrap}>
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            style={[
              cf.box,
              i === value.length && cf.boxActive,
              i < value.length && cf.boxFilled,
            ]}>
            <Text style={cf.digit}>{value[i] ?? ''}</Text>
          </View>
        ))}
        <TextInput
          ref={inputRef}
          style={cf.entry}
          value={value}
          onChangeText={set}
          keyboardType="number-pad"
          textContentType={oneTimeCode ? 'oneTimeCode' : 'none'}
          // Android's own hint for the same thing; iOS keeps to textContentType.
          autoComplete={oneTimeCode ? 'one-time-code' : 'off'}
          autoFocus={autoFocus}
          maxLength={length}
          caretHidden
          selectionColor="transparent"
        />
      </TouchableOpacity>
      {busy ? (
        <Text style={cf.working}>{busyLabel}</Text>
      ) : (
        (showPaste ?? !oneTimeCode) && <Button title="Paste code" variant="ghost" onPress={() => void paste()} />
      )}
      {error ? <Text style={cf.error}>{error}</Text> : null}
    </View>
  );
}

const cf = themedStyles(() => StyleSheet.create({
  container: { gap: theme.spacing.xs, alignItems: 'stretch' },
  label: heroLabel(),
  // Under the prompt, where someone looks when no code arrived (decided 2026-08-29).
  alt: { ...theme.typography.caption, color: theme.colors.accentText, textAlign: 'center' },
  altOff: { color: theme.colors.faint },
  working: { ...theme.typography.caption, color: theme.colors.slate, textAlign: 'center' },
  error: { ...theme.typography.caption, color: theme.colors.negative, textAlign: 'center' },
  wrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.sm,
  },
  box: {
    width: 46,
    height: 58,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: theme.colors.accent },
  boxFilled: { borderColor: theme.colors.slate },
  digit: { fontSize: CODE_DIGIT_SIZE, fontWeight: '700', color: theme.colors.offWhite, fontFamily: 'Menlo' },
  // The REAL field, laid over the boxes at full size with invisible ink. It
  // used to be a 1pt square at opacity 0, and iOS offers the code above the
  // keyboard ("From Gmail", seen in a phone test 2026-09-16) only for a field it takes to be
  // visible and usable, so the suggestion never appeared however correct
  // `textContentType` was. The boxes above draw the digits; this carries them,
  // and a tap anywhere on them lands in it.
  entry: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: 'transparent',
    backgroundColor: 'transparent',
    fontSize: CODE_DIGIT_SIZE,
    textAlign: 'center',
  },
}));
