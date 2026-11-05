/**
 * The "Vault built" page's drawn lock (decided 2026-10-02, design B "Keys into
 * the lock", pace B2). A pen dot sketches the lock's disc faintly and
 * backwards, then inks it forwards, and the disc is GLASS (decided the same day:
 * "build the lock in a matching glossy optic"): the app's own finish, the one
 * every round button and icon tile carries (HeaderIconButton's recipe,
 * `Gloss` first), which settles in under the outline as the ink completes.
 * The keyhole draws on the glass in the ink colour; the vault's keys appear
 * named in a row under it (the client's first, 21st Capital's last) and
 * travel into the keyhole one by one, the lock turning a 40 degree notch for
 * each; the green ring inks around the glass edge over the last notch and
 * completes with the final click. One dashed ring around the lock per
 * recovery path, outside the glass.
 *
 * Everything moves on the NATIVE driver, through `useSentTimeline`'s tracks:
 * stroke offsets, opacity and transforms only, never a layout value (the
 * fold-flash lesson). The numbers and the geometry live in
 * `vaultBuiltModel.ts`, tested. Decoration only: VoiceOver hears the page's
 * title and the vault's name.
 */
import React, { useMemo } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import { KeyIcon } from './KeyIcon';
import {
  circleCcw,
  circleCw,
  easedTable,
  GLASS_IN,
  GLASS_SCALE_FROM,
  keyFlightWindow,
  keyRow,
  KEYHOLE_EYE,
  KEYHOLE_EYE_LEN,
  KEYHOLE_WEDGE,
  KEYHOLE_WEDGE_LEN,
  LOCK_BOX,
  LOCK_LEN,
  LOCK_R,
  lockGlass,
  lockPenPath,
  lockTurnTable,
  ringDash,
  ringRadii,
} from './vaultBuiltModel';
import type { VaultBuiltTrackKey } from './vaultBuiltModel';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type VaultBuiltValues = Record<VaultBuiltTrackKey, Animated.Value>;

/** A stroke drawn by its dash offset, in the 0-100 box scaled to `box` points. */
function Stroke({
  d,
  len,
  offset,
  color,
  width,
  box,
}: {
  d: string;
  len: number;
  offset: Animated.AnimatedInterpolation<number>;
  color: string;
  width: number;
  box: number;
}): React.JSX.Element {
  return (
    <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <AnimatedPath
        d={d}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${len}`}
        strokeDashoffset={offset}
      />
    </Svg>
  );
}

/** A 0 -> 1 track as a dash offset: nothing drawn at 0, the whole stroke at 1. */
const drawn = (v: Animated.Value, len: number) => v.interpolate({ inputRange: [0, 1], outputRange: [len, 0] });

export function VaultBuiltMark({
  values,
  keys,
  recoveryPaths,
  reduce,
  box = LOCK_BOX,
}: {
  values: VaultBuiltValues;
  /** The everyday path's key names, the client's first and ours last. */
  keys: readonly string[];
  /** One dashed ring each. */
  recoveryPaths: number;
  reduce: boolean;
  /** The design's 220 unless the screen is short (`vaultBuiltBox`). */
  box?: number;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const pageW = width - 2 * theme.spacing.lg;
  const n = keys.length;
  const { pen, penIn, penOut, keyhole, travel } = values;
  // Built once per size and key count: the values never change, and the
  // page re-renders when the button goes live.
  const d = useMemo(() => {
    const path = lockPenPath(box);
    const glass = lockGlass(box);
    const turn = lockTurnTable(n);
    // The row scales with the box: glyph, spacing, names and their type.
    const row = keyRow(n, pageW, box);
    // The glass settles in with the ink: nothing of it while the pen sketches.
    const glassIn = pen.interpolate({ inputRange: [GLASS_IN.from, GLASS_IN.to], outputRange: [0, 1], extrapolate: 'clamp' });
    return {
      frame: { width: box, height: box },
      dot: { width: path.size, height: path.size, borderRadius: path.size / 2 },
      // The glass disc: the disc exactly, its edge under the inked outline.
      disc: { width: glass.size, height: glass.size, borderRadius: glass.size / 2, left: glass.inset, top: glass.inset },
      glassIn,
      glassScale: glassIn.interpolate({ inputRange: [0, 1], outputRange: [GLASS_SCALE_FROM, 1] }),
      sketch: pen.interpolate({ inputRange: [0, 0.5], outputRange: [LOCK_LEN, 0], extrapolate: 'clamp' }),
      ink: pen.interpolate({ inputRange: [0.5, 1], outputRange: [LOCK_LEN, 0], extrapolate: 'clamp' }),
      penX: pen.interpolate({ inputRange: path.inputRange, outputRange: path.x }),
      penY: pen.interpolate({ inputRange: path.inputRange, outputRange: path.y }),
      penScale: Animated.multiply(penIn, penOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
      keyholeEye: drawn(keyhole, KEYHOLE_EYE_LEN),
      keyholeWedge: drawn(keyhole, KEYHOLE_WEDGE_LEN),
      green: drawn(values.green, LOCK_LEN),
      turn: travel.interpolate({
        inputRange: turn.inputRange,
        outputRange: turn.outputRange.map((deg) => `${deg}deg`),
      }),
      rings: ringRadii(recoveryPaths),
      // A key's size and its place in the keyhole (where its flight ends), the
      // room each name has and the name's type, all at the row's scale.
      icon: row.icon,
      keyAt: { left: box / 2 - row.icon / 2, top: box / 2 - row.icon / 2, width: row.icon, height: row.icon },
      label: { width: row.labelW, left: (row.icon - row.labelW) / 2, top: row.labelTop },
      nameType: {
        fontSize: theme.typography.caption.fontSize * row.nameScale,
        lineHeight: theme.typography.caption.lineHeight * row.nameScale,
      },
      named: row.labelW > 0,
      keys: Array.from({ length: n }, (_, i) => {
        const [a, b] = keyFlightWindow(n, i);
        const e = travel.interpolate({ ...easedTable(a, b), extrapolate: 'clamp' });
        return {
          x: e.interpolate({ inputRange: [0, 1], outputRange: [row.x[i], 0] }),
          y: e.interpolate({ inputRange: [0, 1], outputRange: [row.startY, 0] }),
          scale: e.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
          // Visible as the row appears, gone as it enters the keyhole.
          opacity: Animated.multiply(values.appear, e.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] })),
          // The name lets go of its key as it sets off.
          name: e.interpolate({ inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: 'clamp' }),
        };
      }),
    };
  }, [box, n, pageW, recoveryPaths, values, pen, penIn, penOut, keyhole, travel]);

  return (
    <View style={d.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* The recovery paths: a dashed ring each, the graph's waiting line. */}
      {d.rings.length > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: values.rings }]}>
          <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
            {d.rings.map((r) => (
              <Circle
                key={r}
                cx={50}
                cy={50}
                r={r}
                stroke={theme.colors.slate}
                strokeWidth={0.8}
                strokeDasharray={ringDash(r)}
                fill="none"
              />
            ))}
          </Svg>
        </Animated.View>
      )}
      {/* The disc is glass, the app's own finish (HeaderIconButton's recipe,
          Gloss FIRST): it settles in under the outline as the ink completes. */}
      <Animated.View style={[styles.glass, d.disc, { opacity: d.glassIn, transform: [{ scale: d.glassScale }] }]}>
        <Gloss size={d.disc.width} radius={d.disc.width / 2} />
      </Animated.View>
      {/* The disc's outline: sketched faint and backwards, then inked forwards. */}
      {!reduce && <Stroke d={circleCcw(LOCK_R)} len={LOCK_LEN} offset={d.sketch} color={theme.colors.faint} width={1} box={box} />}
      <Stroke d={circleCw(LOCK_R)} len={LOCK_LEN} offset={d.ink} color={theme.colors.offWhite} width={2.4} box={box} />
      {/* The keyhole, drawn on the glass in the ink colour, turns a notch for each key. */}
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: d.turn }] }]}>
        <Stroke d={KEYHOLE_EYE} len={KEYHOLE_EYE_LEN} offset={d.keyholeEye} color={theme.colors.offWhite} width={2.4} box={box} />
        <Stroke d={KEYHOLE_WEDGE} len={KEYHOLE_WEDGE_LEN} offset={d.keyholeWedge} color={theme.colors.offWhite} width={2.4} box={box} />
      </Animated.View>
      {/* The click: the one green inks around the glass edge. */}
      <Stroke d={circleCw(LOCK_R)} len={LOCK_LEN} offset={d.green} color={theme.colors.positive} width={5} box={box} />
      {!reduce && (
        <Animated.View
          style={[
            styles.pen,
            d.dot,
            { transform: [{ translateX: d.penX }, { translateY: d.penY }, { scale: d.penScale }] },
          ]}
        />
      )}
      {/* The keys, named, travelling into the keyhole one by one. */}
      {!reduce &&
        keys.map((name, i) => (
          <Animated.View
            key={`${i}:${name}`}
            style={[
              styles.key,
              d.keyAt,
              {
                opacity: d.keys[i].opacity,
                transform: [{ translateX: d.keys[i].x }, { translateY: d.keys[i].y }, { scale: d.keys[i].scale }],
              },
            ]}>
            <KeyIcon size={d.icon} color={theme.colors.gold} />
            {d.named && (
              <Animated.Text numberOfLines={1} style={[styles.keyName, d.label, d.nameType, { opacity: d.keys[i].name }]}>
                {name}
              </Animated.Text>
            )}
          </Animated.View>
        ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // The glass disc, HeaderIconButton's recipe: the raised surface, clipped,
    // no hairline (the Gloss brings the edge). Its size and place come with
    // the box (`d.disc`).
    glass: { position: 'absolute', backgroundColor: theme.colors.surfaceRaised, overflow: 'hidden' },
    // Its size comes with the box (`d.dot`).
    pen: { position: 'absolute', left: 0, top: 0, backgroundColor: theme.colors.offWhite },
    // Its size and place come with the box (`d.keyAt`), and so do its name's
    // room, place and type (`d.label`, `d.nameType`).
    key: { position: 'absolute', alignItems: 'center' },
    keyName: {
      ...theme.typography.caption,
      color: theme.colors.slate,
      position: 'absolute',
      textAlign: 'center',
    },
  }),
);
