/**
 * THE key container: one row, one key, everywhere a key slot is shown.
 *
 * This shape was picked from four rendered candidates (2026-09-25: "Lets go
 * with C") for the vault builder's key step, and then every other
 * key slot was asked to match it (2026-09-26: "Please match the key container to our
 * new key container standard we chose"). Before that the heirs step, the
 * rescue step and the Build-your-vault screen each drew their own lookalike
 * with an "Add key" pill beside the text and an ✕ to clear it.
 *
 * The row says four things and no more: whose key it is (the amber key),
 * its name, its fingerprint when known, and whether the slot is filled.
 *
 *   filled   the vault card's own recipe, so it reads as a container this
 *            app lets you press: `surface` ground, `radius.lg`, clipped, no
 *            hairline, `Gloss` first at `cardGlow()`, the key in the brand
 *            amber and the fingerprint trailing quietly in mono.
 *   empty    a dashed outline in the selection green reading "Add key" in
 *            that green, drawn so it can never pass for a key.
 *   inactive a grey dashed outline naming an option NOT taken. It claims
 *            nothing, because that key is not in the vault.
 *
 * THE ROW IS THE CONTROL (decided 2026-09-25: "use the container itself as the
 * button", "If the user wants to change a key, he can simply click the
 * key"). No pill beside it, no chevron, no ✕. Tapping an empty slot adds
 * its key and tapping a filled one replaces it; a row with nothing to do is
 * not a button at all, so VoiceOver reads it as what it shows rather than
 * offering something that never happens.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Gloss, cardGlow } from './Gloss';
import { KeyIcon } from './KeyIcon';
import { theme, themedStyles } from '../theme';
// The words live with the graph's other words, in one pure module.
import { ADD_KEY_LABEL } from './vaultGraphRows';

/** A phone-sized target, whatever the text inside is. */
const ROW_MIN_H = 48;
const HIT = { top: 4, bottom: 4, left: 8, right: 8 };

export function KeySlotRow({
  name,
  trailing,
  filled,
  addable,
  inactive,
  onPress,
  accessibilityLabel,
  mono = true,
  after,
}: {
  /** The key's name, or the slot's when it holds none. */
  name: string;
  /** The fingerprint, or a short state like "added at creation". */
  trailing?: string;
  /** Does the slot hold a key? Filled rows get the glass; empty ones an outline. */
  filled?: boolean;
  /** Empty AND the client's to fill: it reads "Add key" in the selection green. */
  addable?: boolean;
  /** An option not taken: named in grey, never a button's green. */
  inactive?: boolean;
  onPress?: () => void;
  /** Only a row that DOES something is a button, and only then says what. */
  accessibilityLabel?: string;
  /** Is the trailing text a fingerprint (mono) or a plain note? */
  mono?: boolean;
  /** Anything that belongs at the end of the row, such as a radio mark. */
  after?: React.ReactNode;
}): React.JSX.Element {
  const edge = inactive ? theme.colors.slate : addable ? theme.colors.accent : undefined;
  const label = addable ? ADD_KEY_LABEL : name;
  return (
    <TouchableOpacity
      style={[
        styles.row,
        filled ? styles.glass : [styles.outline, { borderColor: edge ?? theme.colors.slate }],
      ]}
      activeOpacity={0.7}
      hitSlop={HIT}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? accessibilityLabel : undefined}
      onPress={onPress}>
      {filled && <Gloss radius={theme.radius.lg} strength={cardGlow()} />}
      <KeyIcon size={20} color={edge ?? (filled ? theme.colors.gold : theme.colors.slate)} />
      <Text
        numberOfLines={1}
        style={[
          styles.name,
          addable && styles.add,
          (inactive || (!filled && !addable)) && styles.nameInactive,
        ]}>
        {label}
      </Text>
      {!!trailing && (
        <Text numberOfLines={1} style={[mono ? styles.fp : styles.note, styles.trail]}>
          {trailing}
        </Text>
      )}
      {after}
    </TouchableOpacity>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      minHeight: ROW_MIN_H,
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.sm + 2,
      paddingHorizontal: theme.spacing.lg,
    },
    glass: { backgroundColor: theme.colors.surface, overflow: 'hidden' },
    outline: { borderWidth: 1, borderStyle: 'dashed' },
    // The name takes the room left between the key and the fingerprint, and
    // gives it up first: the fingerprint is how a key is told apart.
    name: { ...theme.typography.bodyStrong, color: theme.colors.offWhite, flex: 1, minWidth: 0 },
    // "Add key" is the same weight as a key's name, told apart by its green.
    add: { color: theme.colors.accentText },
    nameInactive: { color: theme.colors.slate },
    fp: { ...theme.typography.mono, color: theme.colors.slate },
    note: { ...theme.typography.caption, color: theme.colors.slate },
    trail: { flexShrink: 0 },
  }),
);
