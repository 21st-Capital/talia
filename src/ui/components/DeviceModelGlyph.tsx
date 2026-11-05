/**
 * Each model's own outline, for the row that names it in "Which device?" (decided
 * 2026-10-04: "It doesnt look nice to repeat the same logo repeatedly! try to
 * avoid that"). The brand's mark sits on the brand's row alone; a model row
 * shows the SHAPE of the product instead, so the four Ledgers read apart at
 * a glance: the Nano Gen5 a slim slab with its side button, the Flex squarer
 * with its chin, the Stax tall with its spine, the Nano X a stick with its
 * two buttons; the Nova a stick on end with its plug and touch edges; the
 * Passport a handset with its keypad.
 *
 * Line drawings in the brand amber on the raised tile with the glass finish,
 * like every icon tile in a list row (Settings' rows). Theme tokens only:
 * these are not the products' colours, so the device-art palette is not
 * theirs. One drawing per model, exhaustive: a model added to the registry
 * without one does not compile.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import type { DeviceModel } from '../../wallet/deviceKinds';

/** The tile every row draws its mark or glyph in: the brand marks' own size. */
export const DEVICE_ROW_MARK = 40;
const GLYPH = 30;
const STROKE = 1.6;

type Draw = (color: string) => React.JSX.Element;

/** Drawn in a 40 by 40 box; the body outlined, the screen a tint, the parts
 *  that tell one model from another filled. */
const GLYPHS: Record<DeviceModel, Draw> = {
  gen5: (c) => (
    <>
      <Rect x={11} y={4} width={18} height={32} rx={3.5} stroke={c} strokeWidth={STROKE} fill="none" />
      <Rect x={13.5} y={7} width={13} height={22} rx={1.5} fill={c} fillOpacity={0.3} />
      <Rect x={29.6} y={12} width={1.8} height={6} rx={0.9} fill={c} />
    </>
  ),
  flex: (c) => (
    <>
      <Rect x={8} y={5} width={24} height={30} rx={3.5} stroke={c} strokeWidth={STROKE} fill="none" />
      <Rect x={10.5} y={7.5} width={19} height={19} rx={1.5} fill={c} fillOpacity={0.3} />
      <Rect x={10.5} y={28.5} width={19} height={4} rx={1} fill={c} />
    </>
  ),
  stax: (c) => (
    <>
      <Rect x={9} y={3} width={22} height={34} rx={3.5} stroke={c} strokeWidth={STROKE} fill="none" />
      <Rect x={11.5} y={5.5} width={13.5} height={29} rx={1.5} fill={c} fillOpacity={0.3} />
      <Rect x={26} y={5.5} width={2.6} height={29} rx={1.3} fill={c} />
    </>
  ),
  nanoX: (c) => (
    <>
      <Rect x={3} y={14} width={34} height={12} rx={6} stroke={c} strokeWidth={STROKE} fill="none" />
      <Rect x={13} y={17} width={12} height={6} rx={1} fill={c} fillOpacity={0.3} />
      <Rect x={7.5} y={12.2} width={3.5} height={2.2} rx={1.1} fill={c} />
      <Rect x={29} y={12.2} width={3.5} height={2.2} rx={1.1} fill={c} />
    </>
  ),
  nova: (c) => (
    <>
      <Rect x={13} y={3} width={14} height={28} rx={3} stroke={c} strokeWidth={STROKE} fill="none" />
      <Rect x={15.5} y={6} width={9} height={7} rx={1} fill={c} fillOpacity={0.3} />
      <Path d="M12.2 17v7M27.8 17v7" stroke={c} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
      <Rect x={16.5} y={31} width={7} height={5} rx={1.5} stroke={c} strokeWidth={STROKE} fill="none" />
    </>
  ),
  passport: (c) => (
    <>
      <Rect x={11} y={3} width={18} height={34} rx={4} stroke={c} strokeWidth={STROKE} fill="none" />
      <Rect x={13.5} y={6} width={13} height={11} rx={1.5} fill={c} fillOpacity={0.3} />
      {[21.5, 26, 30.5].flatMap((cy) => [16, 20, 24].map((cx) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.2} fill={c} />))}
    </>
  ),
};

/** The model's outline alone, `size` points square. */
export function ModelGlyph({ model, size = GLYPH, color }: { model: DeviceModel; size?: number; color?: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {GLYPHS[model](color ?? theme.colors.gold)}
    </Svg>
  );
}

/** The model's outline in a list row's icon tile: the raised surface with the
 *  glass finish first, the glyph in the brand amber (or a state's colour: a
 *  key that has signed). */
export function ModelTile({ model, color }: { model: DeviceModel; color?: string }): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <Gloss size={DEVICE_ROW_MARK} radius={theme.radius.sm} />
      <ModelGlyph model={model} color={color} />
    </View>
  );
}

/** The same tile holding any glyph: the key of a key whose device is not
 *  known, so every row of a key list is one height and one finish. */
export function GlyphTile({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <Gloss size={DEVICE_ROW_MARK} radius={theme.radius.sm} />
      {children}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: {
      width: DEVICE_ROW_MARK,
      height: DEVICE_ROW_MARK,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
  }),
);
