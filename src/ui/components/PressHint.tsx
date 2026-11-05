/**
 * The press hint over the drawn device on the client's turn: design C, "Lit
 * control, one word" (decided 2026-10-03: "lets go with C"). The control itself is
 * ringed in the one green and pulses softly, and a small green word on a pill
 * points at it ("Tap", "Press", "Hold", "Press both", "Hold both"). At the
 * press the ring fills, then the page turns, then the ring and the word fade.
 * It never draws over the device's words. With Reduce Motion on, the hint for
 * the page on show stands still.
 *
 * What plays when is `pressHintScript.ts` (pure, tested); where each control
 * is comes from the drawing's own anchors (`deviceAnchors`). Everything moves
 * on ONE clock, the guide's pass (`DeviceLoop`), as interpolations of it on
 * the native driver: opacity and transforms only. The device's own progress
 * (the touch Ledgers' hold line, the Nova's arrows and its confirmation, and
 * after it is plugged in its turning arrow and its lock) is drawn by the
 * drawing itself from the same clock (`useHintMotion`).
 */
import React, { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { ScreenText } from './DeviceArtParts';
import type { Motion, MotionDeg } from './DeviceArtParts';
import { deviceAnchors } from './DeviceArt';
import type { DeviceAnchors, DeviceProgress } from './DeviceArt';
import type { NovaScrollProgress } from './NovaArt';
import type { ControlSpot } from './deviceScreenLayout';
import { NOVA_LOCK, novaHoldArrows, novaThumbTravel } from './deviceScreenLayout';
import { HINT_MS, deviceHint, pinCellOf, slotOf } from './pressHintScript';
import type { Channel, HintControl, HintPlan, WordPlan } from './pressHintScript';
import type { DeviceDrawing } from '../hww/signingDevice';

/** The pill's height and its pointer's depth (the pill's words never scale
 *  with the phone's text size: it is part of the picture, `ScreenText`). */
export const PILL_H = 20;
const POINTER = 5;
/** A ring sits this far outside its control, at this stroke. */
export const RING_GAP = 5;
const RING_STROKE = 2.6;
/** The Nova's touch edge: a short bar of light straddling the body's edge,
 *  and the disc the press fills. */
const EDGE_BAR = { w: 38, h: 7, disc: 24 } as const;
/** The box a centred pill is laid out in (wider than any word). */
const WORD_BOX = 140;
/** A pill over a wide control (the Open button) sits this close above it. */
const WIDE_GAP = 2;

// ─── Where each piece goes ───────────────────────────────────────────────────

/** The spot of a control on this drawing, or null where it has none. */
export function spotOf(a: DeviceAnchors, c: HintControl): ControlSpot | null {
  switch (a.kind) {
    case 'touch': {
      const cell = pinCellOf(c);
      if (cell != null) return a.a.pin[cell] ?? null;
      return c === 'next' ? a.a.next : c === 'tile' ? a.a.tile : c === 'open' ? a.a.open : c === 'approve' ? a.a.approve : c === 'confirm' ? a.a.confirm : c === 'side' ? a.a.side : null;
    }
    case 'nanoX':
      return c === 'right' ? a.a.right : c === 'left' ? a.a.left : null;
    case 'nova': {
      const slot = slotOf(c);
      if (slot != null) return a.a.slots[slot] ?? null;
      return c === 'edgeTop' ? a.a.edgeTop : c === 'edgeBottom' ? a.a.edgeBottom : c === 'edgeMiddle' ? a.a.edgeMiddle : c === 'edgeAlong' ? a.a.edgeAlong : null;
    }
    default:
      return null;
  }
}

/** The Nova's edges (its two right ends, the middle and the three slots of
 *  its bottom edge) are lit as a bar; a wide control (the Open button) as a
 *  rounded rectangle; every other control as a ring. */
const isEdge = (c: HintControl) => c === 'edgeTop' || c === 'edgeBottom' || c === 'edgeMiddle' || c === 'edgeAlong' || slotOf(c) != null;
const isWide = (s: ControlSpot): s is ControlSpot & { w: number; h: number } => s.w != null && s.h != null;

/** Where a lit control's light reaches: a box in the drawing's frame. */
export function lightBox(c: HintControl, s: ControlSpot): { left: number; top: number; right: number; bottom: number } {
  if (isEdge(c)) {
    const r = Math.max(EDGE_BAR.disc, EDGE_BAR.h) / 2;
    return { left: s.x - EDGE_BAR.w / 2, top: s.y - r, right: s.x + EDGE_BAR.w / 2, bottom: s.y + r };
  }
  const out = RING_GAP + RING_STROKE / 2;
  if (isWide(s)) return { left: s.x - s.w / 2 - out, top: s.y - s.h / 2 - out, right: s.x + s.w / 2 + out, bottom: s.y + s.h / 2 + out };
  const r = s.r + out;
  return { left: s.x - r, top: s.y - r, right: s.x + r, bottom: s.y + r };
}

/**
 * What the press fills, in the drawing's frame: a disc over the ring and the
 * control; the Nova's edge, the disc under its bar; a wide control, the
 * rounded rectangle over its ring.
 */
export function fillBox(c: HintControl, s: ControlSpot): { left: number; top: number; width: number; height: number; radius: number } {
  if (isEdge(c)) {
    const d = EDGE_BAR.disc;
    return { left: s.x - d / 2, top: s.y - d / 2, width: d, height: d, radius: d / 2 };
  }
  const out = RING_GAP + RING_STROKE / 2;
  if (isWide(s)) {
    return { left: s.x - s.w / 2 - out, top: s.y - s.h / 2 - out, width: s.w + 2 * out, height: s.h + 2 * out, radius: (s.corner ?? 0) + out };
  }
  const d = 2 * (s.r + RING_GAP) + RING_STROKE;
  return { left: s.x - d / 2, top: s.y - d / 2, width: d, height: d, radius: d / 2 };
}

/** A pill's place: its top, where its pointer is, and how it lines up. */
export interface WordPlace {
  top: number;
  side: 'top' | 'bottom' | 'none';
  /** Centred on `x`, or its right edge at `right` with the pointer `pointer` in from it. */
  align: { kind: 'center'; x: number } | { kind: 'right'; right: number; pointer: number };
}

/**
 * Where a word's pill sits, by the design: on a touch Ledger just above its
 * control, inside the screen, its right edge at the control's (centred above
 * a wide one, the Open button; above its side button with its right edge at
 * the button's, so the pill stays inside the drawing at the row's right
 * end); in the band over its keypad, pointing at no
 * key, for the PIN entry (`band`); on the Nano X just under the right button,
 * or centred under the stick between the two; on the Nova above the top right
 * edge, in the room right of the title, and under a control on its bottom
 * edge (the middle for the side choice, a slot for a group of the password).
 * A word about two controls (`both`: "Press both", "Hold both") has no
 * pointer: the Nova's "Hold both" sits where "Hold" sat, while both edges
 * light under it (decided 2026-10-04).
 */
export function wordPlace(a: DeviceAnchors, at: HintControl | 'between' | 'band', both = false): WordPlace | null {
  if (at === 'between') {
    if (a.kind !== 'nanoX') return null;
    const { left, right } = a.a;
    return { top: left.y + left.r + 12, side: 'none', align: { kind: 'center', x: (left.x + right.x) / 2 } };
  }
  if (at === 'band') {
    if (a.kind !== 'touch') return null;
    const { band, screen } = a.a;
    return { top: band.top + (band.bottom - band.top - PILL_H) / 2, side: 'none', align: { kind: 'center', x: screen.x + screen.w / 2 } };
  }
  const s = spotOf(a, at);
  if (s == null) return null;
  const place = ((): WordPlace | null => {
    switch (a.kind) {
      case 'touch':
        // The side button stands out of the body's right edge: the pill above
        // it, its right edge at the button's, pointing at the button's middle.
        if (at === 'side' && isWide(s)) return { top: s.y - s.h / 2 - 4 - POINTER - PILL_H, side: 'bottom', align: { kind: 'right', right: s.x + s.w / 2, pointer: s.w / 2 } };
        if (isWide(s)) return { top: s.y - s.h / 2 - WIDE_GAP - POINTER - PILL_H, side: 'bottom', align: { kind: 'center', x: s.x } };
        return { top: s.y - s.r - 4 - POINTER - PILL_H, side: 'bottom', align: { kind: 'right', right: s.x + s.r, pointer: s.r } };
      case 'nanoX':
        return { top: s.y + s.r + POINTER, side: 'top', align: { kind: 'center', x: s.x } };
      case 'nova':
        return s.y > a.a.screen.y + a.a.screen.h
          ? { top: s.y + 6 + POINTER, side: 'top', align: { kind: 'center', x: s.x } }
          : { top: s.y - 6 - POINTER - PILL_H, side: 'bottom', align: { kind: 'center', x: s.x } };
      default:
        return null;
    }
  })();
  return place && both ? { ...place, side: 'none' } : place;
}

/** A pill's top and bottom, its pointer included (and, below, the rise it
 *  comes in from). */
export function wordSpan(p: WordPlace): { top: number; bottom: number } {
  return {
    top: p.top - (p.side === 'top' ? POINTER : 0),
    bottom: p.top + PILL_H + (p.side === 'bottom' ? POINTER : 0) + HINT_MS.word.lift,
  };
}

/**
 * How far the hint reaches past the drawing's box, above and below (the
 * courier's row leaves that room, `extraRoom`): every control the device
 * lights and every word it shows on the review, and what the guide before
 * the transaction lights beyond those (`before`: the Nova's bottom edge and
 * the pills under it). A Ledger's turns light the same places (the Nano X's
 * buttons) or places inside the screen (a touch Ledger's keys, its Open
 * button, the band), so they add nothing.
 */
export function hintReach(d: DeviceDrawing, width: number, boxH: number): { above: number; below: number } {
  const hint = deviceHint(d);
  const a = deviceAnchors(d, width);
  if (hint == null || a.kind === 'none') return { above: 0, below: 0 };
  let top = 0;
  let bottom = boxH;
  const controls = [hint.advance.control, ...hint.sign.controls, ...(hint.before?.controls ?? [])];
  for (const c of controls) {
    const s = spotOf(a, c);
    if (s == null) continue;
    const b = lightBox(c, s);
    top = Math.min(top, b.top);
    bottom = Math.max(bottom, b.bottom);
  }
  const places: (HintControl | 'between' | 'band')[] = [
    hint.advance.control,
    hint.sign.gesture === 'both' ? 'between' : hint.sign.controls[0],
    ...(hint.before?.words ?? []),
  ];
  for (const at of places) {
    const p = wordPlace(a, at);
    if (p == null) continue;
    const span = wordSpan(p);
    top = Math.min(top, span.top);
    bottom = Math.max(bottom, span.bottom);
  }
  return { above: Math.max(0, -top), below: Math.max(0, bottom - boxH) };
}

// ─── One clock ───────────────────────────────────────────────────────────────

/** The values the overlay draws, each an interpolation of the clock. */
interface OverlayMotion {
  /** `along`: a travelling control's place along the Nova's lower edge, in
   *  points from its middle (a swipe). */
  lit: { control: HintControl; ring: Motion; fill: Motion; along?: Motion }[];
  words: { plan: WordPlan; opacity: Motion; rise: Motion }[];
}

export interface HintMotion {
  overlay: OverlayMotion;
  /** The device's own progress, for the drawing. */
  progress: DeviceProgress | undefined;
  /** The Nova's lines carried along as its lower edge is swiped, by frame
   *  (the address check's address, the review's amount pages, decided
   *  2026-10-05): the line left by what runs past its window, the thumb
   *  right along its track. */
  scrolls: NovaScrollProgress[];
}

/**
 * Every value the hint and the device's progress take, built ONCE per pass
 * shape (never per redraw): an interpolation of `clock` on the native driver,
 * or, with Reduce Motion, the still value for the frame on show (`onSign`:
 * the guide's second still, from its `stillFrom` frame on).
 */
export function useHintMotion(
  plan: HintPlan | null,
  clock: Animated.Value,
  drawing: DeviceDrawing,
  width: number,
  still: boolean,
  onSign: boolean,
): HintMotion | null {
  const stillSide: 0 | 1 | null = still ? (onSign ? 1 : 0) : null;
  return useMemo(() => {
    if (plan == null) return null;
    // One builder: a channel times `k`, as a number or, with a `unit`, as a
    // string (a turn in degrees).
    const V = (c: Channel, k: number, unit: string): Animated.AnimatedInterpolation<number | string> | number | string => {
      if (stillSide != null) return unit ? String(c.still[stillSide] * k) + unit : c.still[stillSide] * k;
      const out: number[] | string[] = unit ? c.outputRange.map((v) => String(v * k) + unit) : k === 1 ? c.outputRange : c.outputRange.map((v) => v * k);
      return clock.interpolate({ inputRange: c.inputRange, outputRange: out, extrapolate: 'clamp' });
    };
    const N = (c: Channel, k = 1): Motion => V(c, k, '') as Motion;
    const D = (c: Channel, k: number): MotionDeg => V(c, k, 'deg') as MotionDeg;
    const anchors = deviceAnchors(drawing, width);
    const reach = anchors.kind === 'nova' ? anchors.a.alongReach : 0;
    const overlay: OverlayMotion = {
      lit: plan.lit.map((l) => ({ control: l.control, ring: N(l.ring), fill: N(l.fill), ...(l.along ? { along: N(l.along, reach) } : {}) })),
      words: plan.words.map((w) => ({ plan: w, opacity: N(w.opacity), rise: N(w.rise) })),
    };
    // A scrolled line, on each frame that swipes one: carried left by what
    // runs past its window, the thumb carried right along its track, both on
    // the clock (decided 2026-10-04).
    const px = anchors.kind === 'nova' ? anchors.a.px : 1;
    const scrolls: NovaScrollProgress[] = plan.scrolls.map((s) => ({ page: s.page, line: N(s.scroll, -s.travel * px), thumb: N(s.scroll, novaThumbTravel() * px) }));
    let progress: DeviceProgress | undefined;
    const p = plan.progress;
    if (p?.kind === 'line') {
      progress = { kind: 'touch', line: N(p.fill), page: N(p.page), signing: N(p.signing) };
    } else if (p?.kind === 'arrows') {
      const travel = novaHoldArrows().travel * px;
      progress = {
        kind: 'nova',
        page: N(p.page),
        confirmed: N(p.confirmed),
        up: N(p.up),
        upRise: N(p.upRise, HINT_MS.arrow.lift * px),
        downY: N(p.slide, travel),
        upY: N(p.slide, -travel),
      };
    } else if (p?.kind === 'unlock') {
      // The Nova after it is plugged in: the same arrows' travel on its
      // confirmation, the side page's arrow turning in degrees, the shackle
      // swinging open through its angle.
      const travel = novaHoldArrows().travel * px;
      progress = {
        kind: 'nova-unlock',
        turn: D(p.turn, 1),
        ccw: N(p.ccw),
        cw: N(p.cw),
        downY: N(p.slide, travel),
        upY: N(p.slide, -travel),
        shackle: D(p.shackle, NOVA_LOCK.openTurn),
      };
    }
    return { overlay, progress, scrolls };
  }, [plan, clock, drawing, width, stillSide]);
}

// ─── The overlay ─────────────────────────────────────────────────────────────

/** The ring round a control (or the Nova's bar of light, or the rounded
 *  rectangle round a wide control), and the fill of the press. */
function LitRing({ control, spot, ring, fill, along }: { control: HintControl; spot: ControlSpot; ring: Motion; fill: Motion; along?: Motion }): React.JSX.Element {
  const f = fillBox(control, spot);
  const press = <Animated.View style={[styles.light, { left: f.left, top: f.top, width: f.width, height: f.height, borderRadius: f.radius, opacity: fill }]} />;
  if (isEdge(control)) {
    const bar = (
      <>
        <Animated.View
          style={[styles.light, { left: spot.x - EDGE_BAR.w / 2, top: spot.y - EDGE_BAR.h / 2, width: EDGE_BAR.w, height: EDGE_BAR.h, borderRadius: EDGE_BAR.h / 2, opacity: ring }]}
        />
        {press}
      </>
    );
    // A swipe: the bar and the press travel along the edge together.
    if (along == null) return bar;
    return <Animated.View style={[styles.layer, { transform: [{ translateX: along }] }]}>{bar}</Animated.View>;
  }
  if (isWide(spot)) {
    const w = spot.w + 2 * RING_GAP;
    const h = spot.h + 2 * RING_GAP;
    const size = { w: w + RING_STROKE + 2, h: h + RING_STROKE + 2 };
    return (
      <>
        <Animated.View style={{ position: 'absolute', left: spot.x - size.w / 2, top: spot.y - size.h / 2, width: size.w, height: size.h, opacity: ring }}>
          <Svg width={size.w} height={size.h}>
            <Rect x={(size.w - w) / 2} y={(size.h - h) / 2} width={w} height={h} rx={(spot.corner ?? 0) + RING_GAP} stroke={theme.colors.accent} strokeWidth={RING_STROKE} fill="none" />
          </Svg>
        </Animated.View>
        {press}
      </>
    );
  }
  const r = spot.r + RING_GAP;
  const size = 2 * r + RING_STROKE + 2;
  return (
    <>
      <Animated.View style={{ position: 'absolute', left: spot.x - size / 2, top: spot.y - size / 2, width: size, height: size, opacity: ring }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.accent} strokeWidth={RING_STROKE} fill="none" />
        </Svg>
      </Animated.View>
      {press}
    </>
  );
}

/** The word on its pill, the pointer toward the control. */
function Word({ text, place, opacity, rise }: { text: string; place: WordPlace; opacity: Motion; rise: Motion }): React.JSX.Element {
  const a = place.align;
  const frame = a.kind === 'center' ? { left: a.x - WORD_BOX / 2, alignItems: 'center' as const } : { left: a.right - WORD_BOX, alignItems: 'flex-end' as const };
  // The pointer in a box of its own: under the control (right-aligned
  // pills), or across the pill's whole width and centred in it.
  const pointerBox: ViewStyle = a.kind === 'right' ? { right: a.pointer - POINTER } : { left: 0, right: 0, alignItems: 'center' };
  return (
    <View style={[styles.wordFrame, { top: place.top, width: WORD_BOX, ...frame }]}>
      <Animated.View style={{ opacity, transform: [{ translateY: rise }] }}>
        {place.side === 'top' && (
          <View style={[styles.pointer, { top: -POINTER }, pointerBox]}>
            <Svg width={2 * POINTER} height={POINTER}>
              <Path d={`M0 ${POINTER} H${2 * POINTER} L${POINTER} 0 Z`} fill={theme.colors.accent} />
            </Svg>
          </View>
        )}
        <View style={styles.pill}>
          <ScreenText style={styles.pillText} numberOfLines={1}>
            {text}
          </ScreenText>
        </View>
        {place.side === 'bottom' && (
          <View style={[styles.pointer, { bottom: -POINTER }, pointerBox]}>
            <Svg width={2 * POINTER} height={POINTER}>
              <Path d={`M0 0 H${2 * POINTER} L${POINTER} ${POINTER} Z`} fill={theme.colors.accent} />
            </Svg>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * The hint over a drawing `width` wide: the lit controls and the words, in
 * the drawing's own box. Nothing for a device the app cannot vouch for.
 */
export function PressHint({ drawing, width, motion }: { drawing: DeviceDrawing; width: number; motion: HintMotion | null }): React.JSX.Element | null {
  const anchors = useMemo(() => deviceAnchors(drawing, width), [drawing, width]);
  if (motion == null || anchors.kind === 'none') return null;
  return (
    <View style={styles.layer} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {motion.overlay.lit.map((l) => {
        const spot = spotOf(anchors, l.control);
        return spot && <LitRing key={l.control} control={l.control} spot={spot} ring={l.ring} fill={l.fill} along={l.along} />;
      })}
      {motion.overlay.words.map((w) => {
        const place = wordPlace(anchors, w.plan.at, w.plan.both);
        return place && <Word key={`${w.plan.text}-${w.plan.at}`} text={w.plan.text} place={place} opacity={w.opacity} rise={w.rise} />;
      })}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'visible' },
    light: { position: 'absolute', backgroundColor: theme.colors.accent },
    wordFrame: { position: 'absolute' },
    pointer: { position: 'absolute' },
    pill: {
      height: PILL_H,
      paddingHorizontal: 8,
      borderRadius: PILL_H / 2,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillText: { ...theme.typography.label, fontSize: 12, lineHeight: 14, color: theme.colors.accentInk },
  }),
);
