/**
 * Talia's own dialog — replaces native iOS alerts so every confirmation
 * matches the app's design language (decided 2026-07-17). Supports a message,
 * an optional text input (e.g. type DELETE to confirm), and stacked
 * actions rendered with the standard Button component.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { AppModal } from './AppModal';
import { Button } from './Button';
import { TextField } from './TextField';
import { useKeyboardEscape } from './KeyboardEscape';
import { GlassPanel } from './GlassPanel';
import { ChevronRightIcon, CircleCheckIcon } from './TablerIcons';
import { theme, themedStyles } from '../theme';
import { MarkedText } from './MarkedText';

export interface DialogAction {
  label: string;
  variant?: 'primary' | 'ghost' | 'selection';
  /** Destructive actions render with the negative colour. */
  destructive?: boolean;
  /** Set (true OR false) to render a checklist row instead of a button:
   *  the label left, a green tick when true, a chevron when false. For
   *  walks where finished steps stay visible (decided 2026-08-31). */
  checked?: boolean;
  /** Receives the input's current text when `input` is configured. */
  onPress: (inputValue: string) => void;
  /** Disable until the input matches (e.g. exact "DELETE"). */
  requiresInputMatch?: string;
  /** Disable until the input is non-empty (mandatory free-text). */
  requiresInput?: boolean;
}

export function AppDialog({
  visible,
  title,
  message,
  children,
  input,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  /** Rich content between the message and the actions, for the dialogs a
   *  plain string cannot serve (a chunked address, a bold amount). */
  children?: React.ReactNode;
  /** Show a text field: { label, placeholder, autoCapitalize } */
  input?: {
    label: string;
    placeholder?: string;
    autoCapitalize?: 'none' | 'sentences' | 'characters';
    /** A name Talia already knows, offered to keep or change (decided
     *  2026-09-09: "pick the name and show it to the user and give him the
     *  option to keep it or change it"). The dialog is remounted per step
     *  by its `key`, so this is read once, as a starting value. */
    defaultValue?: string;
    /** Hard cap on the text (names). */
    maxLength?: number;
    /** One quiet line under the field once the cap bites. */
    hintAtLimit?: string;
  };
  actions: DialogAction[];
  onClose: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(input?.defaultValue ?? '');
  // Most callers keep this component mounted and toggle `visible`, so the
  // initial state is captured once, long before a name is known. Sync on
  // every OPEN instead, which is also what makes each opening start clean.
  const defaultValue = input?.defaultValue;
  useEffect(() => {
    if (visible) setValue(defaultValue ?? '');
  }, [visible, defaultValue]);
  const close = () => {
    setValue(input?.defaultValue ?? '');
    onClose();
  };
  const escapeKeyboard = useKeyboardEscape();
  return (
    <AppModal visible={visible} transparent animationType="fade" onRequestClose={close}>
      {/* Keeps the dialog (and its input) above the keyboard. */}
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        onTouchEnd={escapeKeyboard}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        {/* The Touchable only swallows taps; the glass, its tint and the app
            icon's finish all come from the one GlassPanel (decided 2026-09-14). */}
        <TouchableOpacity activeOpacity={1} style={styles.cardWrap}>
          <GlassPanel style={styles.card} radius={theme.radius.lg}>
          <Text style={styles.title}>{title}</Text>
          {!!message && <MarkedText text={message} style={styles.message} />}
          {children}
          {input && (
            <TextField
              label={input.label}
              value={value}
              onChangeText={setValue}
              placeholder={input.placeholder}
              autoCapitalize={input.autoCapitalize ?? 'none'}
              maxLength={input.maxLength}
              hint={input.maxLength != null && value.length >= input.maxLength ? input.hintAtLimit : undefined}
            />
          )}
          {/* Long action lists (e.g. the portfolio chooser with 10+
              portfolios, decided 2026-08-26) scroll inside a capped height
              instead of pushing the dialog off-screen. */}
          <ScrollView
            style={styles.actionsScroll}
            contentContainerStyle={styles.actions}
            bounces={false}
            // With the keyboard up (the name-this-key input), the first tap
            // must PRESS the button, not merely dismiss the keyboard (found in a phone test on
            // 2026-08-26: every key save needed two taps).
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={actions.length > 5}>
            {actions.map((a, i) => {
              const blocked =
                (a.requiresInputMatch !== undefined && value.trim() !== a.requiresInputMatch) ||
                (a.requiresInput === true && value.trim().length === 0);
              if (a.checked !== undefined) {
                return (
                  <TouchableOpacity
                    key={`${i}:${a.label}`}
                    style={styles.rowBtn}
                    activeOpacity={0.85}
                    disabled={blocked}
                    onPress={() => {
                      const v = value;
                      close();
                      a.onPress(v);
                    }}>
                    <Text style={styles.rowLabel}>{a.label}</Text>
                    {a.checked ? (
                      <CircleCheckIcon size={22} color={theme.colors.positive} />
                    ) : (
                      <ChevronRightIcon size={18} color={theme.colors.slate} />
                    )}
                  </TouchableOpacity>
                );
              }
              return a.destructive ? (
                <TouchableOpacity
                  key={`${i}:${a.label}`}
                  style={[styles.destructiveBtn, blocked && styles.disabled]}
                  disabled={blocked}
                  activeOpacity={0.85}
                  onPress={() => {
                    const v = value;
                    close();
                    a.onPress(v);
                  }}>
                  <Text style={styles.destructiveText}>{a.label}</Text>
                </TouchableOpacity>
              ) : (
                <Button
                  key={`${i}:${a.label}`}
                  title={a.label}
                  variant={a.variant ?? 'primary'}
                  disabled={blocked}
                  onPress={() => {
                    const v = value;
                    close();
                    a.onPress(v);
                  }}
                />
              );
            })}
          </ScrollView>
          </GlassPanel>
        </TouchableOpacity>
      </TouchableOpacity>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // The dim lives on the view that runs on BEHIND the keyboard (found in a phone test on
  // 2026-09-21, "sharp edges at the corner of the lower part of the screen
  // every time the keyboard is active"). On the padded child it stopped at
  // the keyboard's top, and beside the keyboard's rounded corners the page
  // showed undimmed under a square edge. The card stays centred.
  kav: { flex: 1, backgroundColor: theme.colors.scrim },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  cardWrap: { alignSelf: 'stretch' },
  card: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    // The light edge glass catches, as on the copied flash and the dock.
    borderColor: theme.colors.offWhite + '2E',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  message: { ...theme.typography.body, color: theme.colors.slate },
  actions: { gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  actionsScroll: { flexGrow: 0, maxHeight: 380 },
  rowBtn: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceRaised,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  rowLabel: { ...theme.typography.heading, flex: 1, color: theme.colors.offWhite },
  // Button's own geometry (minHeight 50, xl across, 13 down), so the red
  // control stands exactly as tall as the buttons around it; the 13 is
  // Button's and belongs in one exported constant there.
  destructiveBtn: {
    minHeight: 50,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.negative,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 13,
  },
  destructiveText: { ...theme.typography.heading, color: theme.colors.white, textAlign: 'center' },
  // Drawn in colours, never with `opacity`: a TouchableOpacity paints that
  // property from its own native animation, so the dim of an earlier render
  // can outlive the state that asked for it. This one flips live, when the
  // client finishes typing DELETE (decided 2026-09-16).
  disabled: { backgroundColor: theme.colors.actionMuted },
}));
