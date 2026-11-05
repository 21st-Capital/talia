/**
 * Where a payment's address lands. It is pasted or scanned and never typed
 * (decided 2026-10-31 after a phone test: nobody types an address, and doing
 * so is bad practice), so nothing here takes text and no keyboard opens:
 * Paste and Scan while it is empty, the address read only with Replace once
 * it is in. A long address is cut here, so the page's Verify block shows it
 * whole. `locked` holds it as it stands while the page acts on the address,
 * with nothing moving on the page. A tap anywhere on the empty field opens
 * iOS's own Paste bubble at the finger (decided 2026-11-01 after a phone test:
 * people expect it of a field, and a tap here did nothing), and what it pastes
 * goes to the page as Paste's answer does. The two icons stay as they are, and
 * VoiceOver reads them, not the field.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { factsStacked } from './ledgerRowLayout';
import { ClipboardIcon, ScanIcon } from './TablerIcons';
import { pasteBubble } from '../../platform/clipboard';
import { theme, themedStyles } from '../theme';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export function AddressField({
  address,
  locked = false,
  onPaste,
  onPasted,
  onScan,
  onReplace,
}: {
  address: string;
  locked?: boolean;
  /** The Paste icon: the page reads the clipboard. */
  onPaste: () => void;
  /** The bubble: iOS hands over the text. */
  onPasted: (text: string) => void;
  onScan: () => void;
  onReplace: () => void;
}): React.JSX.Element {
  const stacked = factsStacked(useWindowDimensions().fontScale);
  const iconColor = locked ? theme.colors.faint : theme.colors.accent;
  const offerPaste = async (e: GestureResponderEvent) => {
    const text = await pasteBubble(e.nativeEvent.pageX, e.nativeEvent.pageY);
    if (text !== null) onPasted(text);
  };
  if (address) {
    return (
      <View style={[styles.field, stacked && styles.fieldStacked]}>
        <Text style={[styles.address, stacked && styles.addressStacked]} numberOfLines={1} ellipsizeMode="middle">
          {address}
        </Text>
        <TouchableOpacity
          style={[styles.replace, stacked && styles.replaceStacked]}
          onPress={onReplace}
          disabled={locked}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Replace the address">
          <Text style={[styles.replaceText, locked && styles.replaceLocked]}>Replace</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={styles.field}
      activeOpacity={1}
      accessible={false}
      disabled={locked}
      onPress={(e) => void offerPaste(e)}>
      <Text style={styles.placeholder}>Paste or scan the address</Text>
      <TouchableOpacity
        style={styles.control}
        onPress={onPaste}
        disabled={locked}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Paste from the clipboard">
        <ClipboardIcon size={22} color={iconColor} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.control}
        onPress={onScan}
        disabled={locked}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Scan the address">
        <ScanIcon size={22} color={iconColor} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // TextField's box and height, as the Note to Self field right under it
  // draws them.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.xs,
  },
  placeholder: { ...theme.typography.body, color: theme.colors.faint, flex: 1 },
  // At the accessibility sizes the word beside it would leave the address no
  // room, so it stacks as the label and value rows do, Replace at the right.
  fieldStacked: { flexDirection: 'column', alignItems: 'stretch' },
  address: { ...theme.typography.mono, color: theme.colors.offWhite, flex: 1, minWidth: 0 },
  addressStacked: { flex: 0, paddingTop: theme.spacing.sm },
  control: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  replace: { minHeight: 40, justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  replaceStacked: { alignSelf: 'flex-end' },
  replaceText: { ...theme.typography.bodyStrong, color: theme.colors.accentText },
  replaceLocked: { color: theme.colors.faint },
}));
