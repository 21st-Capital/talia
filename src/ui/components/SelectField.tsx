/**
 * A dropdown: one field showing the current choice, a sheet listing every
 * choice when tapped (decided 2026-09-21: "use a drop down for the limits instead
 * of chips, it makes the screen way too full"). The field is the Send
 * screen's Priority field and the sheet is its Priority sheet, so the two
 * pickers in the app look and behave the same.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { AppModal } from './AppModal';
import { DraggableSheet } from './DraggableSheet';
import { ChevronRightIcon } from './TablerIcons';
import { RadioMark } from './RadioMark';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The sheet on its own: a title and a list of choices (decided 2026-09-21, the
 * two-factor "Choose your app" list). With `value` each row carries a radio,
 * as a dropdown's sheet does; without it each row is a place to go and ends
 * in a chevron.
 */
export function ChoiceSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: ReadonlyArray<SelectOption<T>>;
  value?: T;
  onPick: (v: T) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <DraggableSheet visible={visible} onDismiss={onClose} style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {options.map((o) => {
            const on = value !== undefined && o.value === value;
            return (
              <TouchableOpacity
                key={o.value || '__none'}
                style={styles.row}
                onPress={() => onPick(o.value)}
                activeOpacity={0.8}
                accessibilityRole={value !== undefined ? 'radio' : 'button'}
                accessibilityState={value !== undefined ? { selected: on } : undefined}>
                <Text style={styles.rowLabel}>{o.label}</Text>
                {value !== undefined ? (
                  <RadioMark on={on} />
                ) : (
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
              </TouchableOpacity>
            );
          })}
        </DraggableSheet>
      </TouchableOpacity>
    </AppModal>
  );
}

export function SelectField<T extends string>({
  title,
  value,
  shown,
  options,
  onChange,
  style,
}: {
  /** The sheet's heading, and what a screen reader hears on the field. */
  title: string;
  value: T;
  /** What the closed field reads, when it differs from the option's label. */
  shown?: string;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = shown ?? options.find((o) => o.value === value)?.label ?? '';
  return (
    <>
      <TouchableOpacity
        style={[styles.field, style]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${current}`}>
        <Text style={styles.fieldText} numberOfLines={1}>
          {current}
        </Text>
        <View style={styles.chevronDown}>
          <ChevronRightIcon size={20} color={theme.colors.slate} />
        </View>
      </TouchableOpacity>

      <ChoiceSheet
        visible={open}
        title={title}
        options={options}
        value={value}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // The Send screen's Priority field.
    field: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.hairline,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md + 2,
    },
    fieldText: { ...theme.typography.heading, color: theme.colors.offWhite, flex: 1 },
    chevronDown: { transform: [{ rotate: '90deg' }] },
    // The Priority sheet.
    backdrop: { flex: 1, backgroundColor: theme.colors.scrim, justifyContent: 'flex-end' },
    sheet: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xxl + theme.spacing.md,
      borderTopWidth: 1,
      borderColor: theme.colors.offWhite + '2E',
    },
    sheetTitle: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderTopWidth: 1,
      borderColor: theme.colors.hairline,
    },
    rowLabel: { ...theme.typography.heading, color: theme.colors.offWhite, flex: 1 },
  }),
);
