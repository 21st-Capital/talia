/**
 * The round glass button at the top of a screen (decided 2026-09-14: "add the
 * same effect we have for the + and scanner icon on the home screen for
 * every button or anything else that appears at the top of the screen").
 * A 40pt circle on the raised surface with the app icon's finish, the same
 * on every page: the back chevron, the home's scan and +, a page's ⋯ menu,
 * Receive's new-address arrow, the Estate Plan's share. The touch target is
 * padded to 48pt.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';

export const HEADER_BTN = 40;
/** The buttons' ROW inside a page's own top bar: the circles plus the bar's
 *  4pt bottom padding. The two pages whose big number travels into the bar
 *  (the vault and the portfolio) rest it, dock it and centre their sync
 *  spinner on this row, so it must track the real button size: left at 48
 *  while the buttons went to 40pt, the number kept its old place and the gap
 *  under it closed (decided 2026-09-14). Never write the literal. */
export const HEADER_BTN_ROW = HEADER_BTN + 4;
/** Extra band UNDER that row on those same two pages: the room the docked
 *  "as of <day>" line needs. Without it the date sat on the first
 *  transaction (decided 2026-09-16: "make the upper navigation bar slightly
 *  thicker to make sure there is enough space for both the balance and the
 *  date"). The docked number stays on the buttons' row, the caption hangs
 *  below it inside this room, and the page's hero gives the same amount back
 *  at the top so nothing at rest moves. Both pages read the two numbers from
 *  here, so the vault's bar and the portfolio's bar cannot drift apart. */
export const HEADER_CAPTION_ROOM = 14;
/** The docked "as of" caption on those same two pages lives inside the
 *  number's morph and shows only once docked (its opacity rises with the
 *  scroll), so it is sized for where it is READ: at the number's end scale
 *  these 24pt land at ~10pt under the 17pt number, in the room
 *  HEADER_CAPTION_ROOM keeps (decided 2026-09-16). A text token's size would dock
 *  at 7pt; the heroCaption token lends its face. Named here, like the two
 *  measures above, so the vault's and the portfolio's captions cannot drift
 *  apart (decided 2026-10-05: the portfolio's had fallen to the system font). */
export const MORPH_CAPTION_SIZE = 24;
/** The most the phone's text size grows that caption: the largest standard
 *  size (decided 2026-10-22). The band under the buttons is a fixed
 *  HEADER_CAPTION_ROOM, so at the accessibility sizes the caption was cut
 *  ("as of 28 Feb…") and drawn over the first row scrolling under the bar. */
export const MORPH_CAPTION_MAX_SCALE = 1.35;
/** Where the caption's top sits under the number's top, before the scale. */
export const MORPH_CAPTION_TOP = 66;

/**
 * A disabled button says so through what it shows (the caller draws its icon
 * in `faint`, or shows its spinner), never through opacity (decided
 * 2026-10-05: colour, never opacity, for a disabled state).
 */
export function HeaderIconButton({
  onPress,
  label,
  children,
  disabled,
  style,
}: {
  onPress: () => void;
  /** The accessibility label: what the button does. */
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.hit, style]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
      activeOpacity={0.8}>
      {/* Nothing is painted on the touchable itself: its `opacity` is the
          native press feedback's, and a value set from a render can outlive
          the state that asked for it (decided 2026-09-16). */}
      <View style={styles.btn}>
        <Gloss size={HEADER_BTN} radius={HEADER_BTN / 2} />
        {children}
      </View>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  hit: { width: HEADER_BTN, height: HEADER_BTN },
  btn: {
    width: HEADER_BTN,
    height: HEADER_BTN,
    borderRadius: HEADER_BTN / 2,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
