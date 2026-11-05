/**
 * The vault overview graph, drawn as the client's Estate Plan draws it (decided
 * 2026-09-25: "Everything is visible on one single graph: the keys, the
 * fingerprints, the timelocks, the time until they unlock"), grown one step
 * at a time in the vault builder: the step's own path while it is being
 * built, everything together on the summary.
 *
 * It is a port of the PDF's `graph_page.html` in Talia's own card: one lane
 * per way to spend, an amber key tile with a glyph per key, a dark green key
 * card holding the lane's title and then each key with its master
 * fingerprint under it, and a line that is dashed while the lane waits and
 * solid amber once it opens. The TIMELINE, that is the gridlines at "After
 * 8 / 12 / 15 months" and the arrowheads on the lines, is drawn only while
 * a drawn lane waits (`timelineShown`, one rule for all of it; decided
 * 2026-09-25: "on the primary layer, do not use any arrows at all ... Only
 * add the arrows as soon as additional layers are added"), and there is no
 * ACTIVE pill anywhere ("Drop the 'active' piller from all screens").
 * Without the timeline a lane's line is its opening dot and a plain line
 * that simply ends, because there is nothing after it to point at. NOTHING
 * FADES here any more, not the card's right end and not the line's: both
 * were tried, ported to the Estate Plan PDF, and dropped in all three the
 * same day (decided 2026-09-25, on the printed plan and on a light phone: "The
 * fade looks really bad on a white background", "no fade on any page. It
 * doesnt look nice on white so we should change it on dark as well"). The
 * card's ground is `palette.greenCard`, one green in all three drawings.
 * The ROWS come from
 * `vaultGraphRows`, so the builder can never draw a shape the Estate Plan
 * would not. Both are PHONE decisions, to save space ("no, only do
 * this on the phone because we have to save space"): the Estate Plan PDF
 * and the staff dashboard keep their pills and arrows on purpose.
 *
 * On the KEY step the graph is not a picture but the place keys are added
 * (decided 2026-09-25: "this new design will win us so much space that we wont
 * even need the extra 'add key' section! we can build the add key section
 * inside the graph itself"): one ROW per key, and the row is the control
 * ("use the container itself as the button"; "If the user wants to
 * change a key, he can simply click the key"). Those rows no longer carry
 * the Estate Plan's line: with no axis and no arrowhead on that step the
 * line said nothing, so rows were asked for in the VAULT SCREEN's own family
 * instead ("a glassy container with a key and the name + fingerprint.
 * Please delete the orange lines and small arrow ... keep the accent
 * orange color of the key"). They are drawn on the vault card's one recipe
 * (`surface` ground, `radius.lg`, `overflow: hidden`, no hairline, `Gloss`
 * first at `cardGlow()`), with the key in the brand amber, as the COMPACT
 * ONE-LINE row picked from four candidates (2026-09-25: "Lets go with
 * C"): the amber key inline before the name, the fingerprint trailing
 * quietly on the right. A row says four things: whose key it is, its
 * name, its fingerprint when known, and whether the slot is empty or
 * filled. An empty slot the client can fill reads "Add key" in bold and
 * is drawn so it can never pass for a key (a dashed outline, no
 * fingerprint); tapping it adds the key, tapping a filled row replaces
 * it. The extra primary key is a choice shown as two rows under
 * "Who holds the third key?": ours (active by default) and the client's
 * own, a radio mark on the active one, one tap to switch; the option NOT
 * taken is a grey outline naming the option ("21st Capital", "Your own
 * key"), never a button, because it is not in the vault. ONLY the key
 * step's rows lost their line: the heirs, rescue and summary lanes keep
 * theirs, because there the line encodes WHEN a path opens, which is the
 * whole point of that drawing. The summary draws the primary path as ONE
 * lane again, the vault-overview way. The key step's look STOPS there (decided
 * 2026-09-25: "combining the two doesnt look nice. Lets go with C and
 * keep the graphs independent"): carrying that container through to the
 * timelocked lanes was built and rejected, so those lanes stay the Estate
 * Plan's card, and the app, the PDF and the staff dashboard go on drawing
 * ONE picture.
 *
 * Two things hold BY CONSTRUCTION, never by eye ("make the keys align
 * with their name", "the lines do not align with 'After X months'"):
 *
 *   1. Each glyph in the amber column sits on the exact line of its key.
 *      Both columns are drawn from ONE arithmetic, `laneLayout`, on the
 *      step's metrics: cell i of the amber column and block i of the card
 *      share a top and a height (a block is its name alone for an empty
 *      slot, name plus fingerprint or state otherwise), and the glyph is
 *      centred on the first name line of its cell. A key's name is kept to
 *      ONE line (ellipsised): a second line would move every block under
 *      it, and the fingerprint under the name is what identifies the key
 *      on a device anyway.
 *   2. Each milestone label is centred on its gridline: a fixed-width label
 *      placed at the same percent as the line, pulled back by half its
 *      width. The axis, the gridlines and every lane's track are the same
 *      width (the card's content past KEY_COL), so one percent is one x.
 *
 * The key card is DARK in both themes (it is the document's ink), so its
 * own inks are pinned to the dark palette the way the scanner pins what it
 * draws over the camera: a light-mode token would be dark on dark there.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Card } from './Card';
import { InfoHeading } from './InfoDot';
import { KeyIcon } from './KeyIcon';
import { KeySlotRow } from './KeySlotRow';
import { RadioMark } from './RadioMark';
import { palette, theme, themedStyles } from '../theme';
import {
  ADD_KEY_LABEL,
  COSIGNER_LABEL,
  LANE_METRICS,
  MILESTONES,
  OWN_OPTION_LABEL,
  laneLayout,
  timelineShown,
} from './vaultGraphRows';
import type {
  GraphFocus,
  GraphKey,
  GraphRow,
  KeyBlockLayout,
  KeySlot,
  LaneMetrics,
} from './vaultGraphRows';

/** What the key step's graph can do to the draft. */
export interface GraphActions {
  /** Add a key to an empty slot: opens the key sheet for it. */
  onAdd: (slot: KeySlot) => void;
  /** Put another key in a slot of the client's, in place. */
  onReplace: (slot: KeySlot) => void;
  /** Who holds the extra primary key: 21st Capital, or the client. */
  onPickHolder: (which: 'ours' | 'own') => void;
}

/**
 * The picture's sizes. The rhythm (`m`) is what `laneLayout` runs on, and
 * the tile, card and glyph follow it.
 */
interface Scale {
  m: LaneMetrics;
  tile: number;
  glyph: number;
  card: number;
  radius: number;
}

/** The picture: the document's density, for lanes that share a screen. */
const PICTURE: Scale = { m: LANE_METRICS, tile: 26, glyph: 13, card: 124, radius: 5 };

const KEY_GAP = 4;
/** The picture's tile column plus card: exactly as wide as the axis starts after. */
const KEY_COL = PICTURE.tile + KEY_GAP + PICTURE.card;

/** The band the line is drawn in. */
const LINE_H = 16;
const LINE_Y = LINE_H / 2;
const DOT_R = 4;
/** The start dot sits its own radius in, or the band clips it (PolicyOverview learned this). */
const START_X = DOT_R + 2;
const ARROW = 8;
const HEADER_H = 28;
/**
 * A milestone label's box, centred on its gridline. The first line sits at
 * 25% of the axis, so the label clears the left edge whenever the axis is
 * at least 2 × (AXIS_LABEL_W / 2) / 0.25 = 96pt wide, and the last (75%)
 * clears the right edge by the same arithmetic; the narrowest phone Talia
 * runs on (375pt) leaves the axis 141pt. No right inset is needed.
 */
const AXIS_LABEL_W = 48;
/** The key step's rows are the controls: a phone-sized target each. */
const ROW_MIN_H = 48;
const HIT = { top: 4, bottom: 4, left: 8, right: 8 };
/** What the ⓘ says. True for every shape the builder can draw. */
const READ_ME =
  'One lane for each way to spend. The keys on a lane sign together, and the line shows when that lane opens. ' +
  'A lane with no wait is open for every coin from the start. A lane with a wait opens only for a coin left untouched for that long: every coin has its own clock, and moving or refreshing a coin starts it again. ' +
  'A row drawn as an outline holds no key yet. 21st Capital keys are added when the vault is created.';

const PENDING_NOTE = 'added at creation';

/** The colours of one drawing. Resolved per render: `theme.colors` is live. */
interface Ink {
  tile: string;
  glyph: string;
  card: string;
  cardInk: string;
  cardFaint: string;
  fingerprint: string;
  dashed: string;
  solid: string;
  grid: string;
  header: string;
  ghost: string;
  /** The outline and the word of a row that is a button. */
  button: string;
  buttonInk: string;
}

function inkFor(): Ink {
  return {
    // The card is the document's ink in both themes; its inks are pinned.
    card: palette.greenCard,
    cardInk: palette.white,
    cardFaint: palette.slate,
    fingerprint: palette.accent,
    glyph: palette.white,
    tile: theme.colors.gold,
    dashed: theme.colors.slate,
    solid: theme.colors.gold,
    grid: theme.colors.slate,
    header: theme.colors.slate,
    ghost: theme.colors.slate,
    button: theme.colors.accent,
    buttonInk: theme.colors.accentText,
  };
}

export function VaultGraph({
  rows,
  focus,
  actions,
  foldable,
}: {
  /** The lanes of this step (see `focusedRows`); nothing is drawn for none. */
  rows: readonly GraphRow[];
  focus: GraphFocus;
  /** On the key step only: the graph adds and replaces keys itself. */
  actions?: GraphActions;
  /**
   * May the client fold this graph away, so the form beneath it has the
   * screen (decided 2026-09-25: "let the user collapse the window down and
   * bring it back up if he needs more space")? The card then grows a
   * grabber and is DRAGGED shut and open ("Instead of an arrow, please
   * let the user be able to drag it down and back up"). The key step and
   * the summary say no, because there the graph IS the page.
   *
   * WHETHER it is folded is this component's own business and nobody
   * else's. It used to be the screen's state, passed back down, and the
   * gesture and the prop then disagreed for a frame or two whenever they
   * were set in different ticks, which the hunt for the flash filmed on a phone
   * turned up along the way (the flash itself was the spring, see
   * `useFold`). One source of truth cannot disagree with itself.
   */
  foldable?: boolean;
}): React.JSX.Element | null {
  const ink = inkFor();
  const timeline = timelineShown(rows);
  const perKey = focus === 'primary' && !!actions;
  if (rows.length === 0) return null;
  const heading = (
    <InfoHeading style={styles.eyebrow} title="How to read this" text={READ_ME}>
      VAULT OVERVIEW
    </InfoHeading>
  );
  const drawing = (
    <View>
      {timeline && <Axis ink={ink} />}
      <View style={styles.lanes}>
        {timeline && <Gridlines ink={ink} />}
        {perKey
          ? rows.map((row) => (
              <KeyLanes key={row.id} row={row} ink={ink} actions={actions} />
            ))
          : rows.map((row) => <Lane key={row.id} row={row} ink={ink} timeline={timeline} />)}
      </View>
    </View>
  );
  // DOCKED, the screen's own lower panel is the card (decided 2026-09-25: "lets
  // make the entire lower part green with round edges"), so the graph draws
  // none of its own: a card inside that panel would be a second surface on
  // the first, and its rounded corners were what showed the page through in
  // the first place. Everywhere the graph IS the page (the key step, the
  // summary) it carries the card as it always has.
  //
  // The heading and the drawing are built HERE and handed to `Fold` as
  // finished elements, so that the fold's own renders, one per frame while
  // the card moves, reach its wrapper alone: React skips an element it is
  // handed unchanged, and this component does not render for a drag.
  return foldable ? (
    <Fold heading={heading}>{drawing}</Fold>
  ) : (
    <Card style={styles.card}>
      {heading}
      {drawing}
    </Card>
  );
}

/**
 * What the dock remembers between mounts: whether the client folded it
 * away, and how tall its body is.
 *
 * The fold, because it is their choice for the whole wizard (someone who
 * wanted the room on the heirs step still wants it on the rescue step) and
 * the dock is remounted as the steps change. The height, so a fresh mount
 * that starts shut knows how far a drag up can go before its own body has
 * reported in. One dock exists at a time, so one of each is enough.
 */
let lastShut = false;
let lastBodyH = 0;

/** How long the card takes to finish a fold once the finger lets go. */
const FOLD_MS = 240;

/**
 * The docked card's frame: the grabber, the heading, and the body that
 * folds. The pan handlers sit on this wrapper and never on `Card`, which
 * takes `children` and `style` alone and drops spread props in silence
 * (the first build's drag did nothing at all, and only dragging it in the
 * simulator showed it).
 *
 * The body is measured on the INNER view, which is never given a height:
 * a child of a clipped view still lays out at its own natural height, so
 * the measurement is the drawing's true height whether the card is open,
 * shut or halfway, and lands in a ref with no render.
 */
function Fold({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  const fold = useFold();
  return (
    <View {...fold.pan} style={styles.card}>
      <TouchableOpacity
        onPress={fold.toggle}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel={fold.shut ? 'Show the vault overview' : 'Hide the vault overview'}>
        <View style={styles.grabber} />
      </TouchableOpacity>
      {heading}
      <View style={fold.bodyStyle}>
        <View onLayout={fold.measure}>{children}</View>
      </View>
    </View>
  );
}

/**
 * The drag that folds the card shut and open again (decided 2026-09-25:
 * "Instead of an arrow, please let the user be able to drag it down and
 * back up"). PanResponder, the same one `DraggableSheet` uses, because the
 * app has no gesture-handler library and a drag is not worth a native
 * dependency.
 *
 * 🔴 THE HEIGHT NEVER GOES BELOW ZERO, AND NOTHING HERE IS A SPRING. It
 * used to fold on `Animated.spring` driving the body's HEIGHT, and that is
 * what flashed (three phone recordings: "the container flashes back for like
 * a milisecond and disappears again", "only when I slam the container
 * down"; then, with the animation deleted: "without the animation, the
 * problem is gone"). A spring with any bounce OVERSHOOTS its target, and
 * the target was 0: for its last few frames it wrote a height a fraction
 * of a point BELOW zero. To Yoga a negative height is not a height at all
 * (`Node::hasDefiniteLength` wants `>= 0`), so for those frames the body
 * laid out with NO height, which is its natural height, which is the
 * whole drawing appearing and vanishing. Caught on the simulator with a
 * probe of every value the animation wrote: `height: -0.028`, and in the
 * same millisecond the panel's glow measured the panel at its full open
 * height; `height: 0`, written last by the spring coming to rest, and the
 * panel was folded again. A hard throw hands the spring more energy, so
 * the overshoot lasts long enough to be seen; a slow drag's dies inside a
 * frame. Narrowing the fold's renders took it from thirteen frames to one
 * because each render re-committed whatever the spring held at that
 * moment; deleting the spring took it to none, and so does this.
 *
 * EVERY HEIGHT THE CARD SHOWS IS A PLAIN PROP THAT REACT COMMITTED. The
 * body follows the finger because each move sets the height in state,
 * clamped to the drawing; it finishes the fold because a
 * `requestAnimationFrame` clock sets the height in state, one frame at a
 * time, on an ease-out that runs from where the body stands to its end and
 * cannot pass it. `place` is the one write, and it clamps at zero, so no
 * curve anyone fits here later can write a height Yoga will not keep. At
 * rest the style is `{height: 0}` or nothing at all. No `Animated`, no
 * `LayoutAnimation`, no `setNativeProps`: a state height is what is on
 * screen, and there is nothing beside it to disagree. The one cost is a
 * render per frame while the card moves, and the heading and the drawing
 * come to `Fold` as finished elements, so that render is the wrapper
 * alone.
 *
 * The responder claims only a deliberate vertical drag, so the ⓘ and the
 * grabber's own tap still work. A release decides by a flick or by where
 * the body stands; the side is committed at once and the clock finishes
 * the slide. A TERMINATE decides nothing: it only slides the body back to
 * the committed side.
 */
function useFold() {
  const [shut, setShutState] = useState(lastShut);
  /** The height on screen while a finger or the clock moves it; null at rest. */
  const [moving, setMoving] = useState<number | null>(null);
  /** The committed side, readable from a native callback without a render. */
  const shutRef = useRef(lastShut);
  const movingRef = useRef<number | null>(null);
  /** The body's natural height, as its inner view last measured it. */
  const bodyH = useRef(lastBodyH);
  /** The clock's pending frame, so a new touch can stop it. */
  const frame = useRef<number | null>(null);
  /** Where the body stood when the finger landed. */
  const base = useRef(0);
  /** This gesture has already ended: nothing after it may decide again. */
  const decided = useRef(false);

  /** The one write. Below zero is not a height to Yoga, it is no height. */
  const place = useCallback((h: number | null) => {
    const kept = h === null ? null : Math.max(0, h);
    movingRef.current = kept;
    setMoving(kept);
  }, []);

  const stopClock = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);
  useEffect(() => stopClock, [stopClock]);

  /** Where the body stands right now, in points. */
  const standing = useCallback(
    () => movingRef.current ?? (shutRef.current ? 0 : bodyH.current),
    [],
  );

  /** Slide from wherever the body stands to `to`, a frame at a time, then rest. */
  const slide = useCallback(
    (to: number) => {
      stopClock();
      const from = standing();
      const span = to - from;
      if (Math.abs(span) < 0.5) {
        place(null);
        return;
      }
      // Placed now, in the same render as the side it was decided with, so
      // a tap on the grabber starts sliding from where the card stands
      // rather than snapping to the far side for a frame first.
      place(from);
      const t0 = Date.now();
      const tick = () => {
        const p = Math.min(1, (Date.now() - t0) / FOLD_MS);
        if (p < 1) {
          place(from + span * (1 - (1 - p) ** 3));
          frame.current = requestAnimationFrame(tick);
        } else {
          frame.current = null;
          // At rest the committed side's own style holds the height.
          place(null);
        }
      };
      frame.current = requestAnimationFrame(tick);
    },
    [place, standing, stopClock],
  );

  /** How a gesture ends, once: the side is committed and the slide starts. */
  const set = useCallback(
    (nextShut: boolean) => {
      decided.current = true;
      if (shutRef.current !== nextShut) {
        shutRef.current = nextShut;
        lastShut = nextShut;
        setShutState(nextShut);
      }
      slide(nextShut ? 0 : bodyH.current);
    },
    [slide],
  );

  const toggle = useCallback(() => {
    decided.current = false;
    set(!shutRef.current);
  }, [set]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          decided.current = false;
          stopClock();
          base.current = standing();
        },
        onPanResponderMove: (_e, g) => {
          if (decided.current) return;
          place(Math.max(0, Math.min(bodyH.current, base.current - g.dy)));
        },
        onPanResponderRelease: (_e, g) => {
          if (decided.current) return;
          const flicked = Math.abs(g.vy) > 0.6;
          set(flicked ? g.vy > 0 : standing() < bodyH.current / 2);
        },
        // A terminate is not a decision: the body goes back to the side
        // that is committed, and nothing is told.
        onPanResponderTerminate: () => {
          if (decided.current) return;
          decided.current = true;
          slide(shutRef.current ? 0 : bodyH.current);
        },
      }).panHandlers,
    [place, set, slide, standing, stopClock],
  );

  const measure = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) {
      bodyH.current = h;
      lastBodyH = h;
    }
  }, []);

  return {
    shut,
    toggle,
    pan,
    measure,
    // A plain height while it moves; at rest, shut or nothing at all.
    bodyStyle:
      moving !== null ? { height: moving, overflow: 'hidden' as const } : shut ? SHUT_STYLE : undefined,
  };
}

/** Folded and at rest: one object, so it is one style and never a new one. */
const SHUT_STYLE = { height: 0, overflow: 'hidden' as const };

/** "After 8 / 12 / 15 months", each centred on its gridline. */
function Axis({ ink }: { ink: Ink }): React.JSX.Element {
  return (
    <View style={styles.axis}>
      {MILESTONES.map((m) => (
        <Text
          key={m.months}
          style={[styles.axisLabel, { left: `${m.percent}%` as `${number}%`, color: ink.header }]}>
          {`After ${m.months}\nmonths`}
        </Text>
      ))}
    </View>
  );
}

/** The three gridlines, fading downward as they do on the document. */
function Gridlines({ ink }: { ink: Ink }): React.JSX.Element {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
  };
  return (
    <View style={styles.grid} pointerEvents="none" onLayout={onLayout}>
      {size && size.w > 1 && size.h > 1 && (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id="vaultGraphGrid" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink.grid} stopOpacity={0.35} />
              <Stop offset="1" stopColor={ink.grid} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {MILESTONES.map((m, i) => (
            <Rect
              key={m.months}
              x={(size.w * m.percent) / 100 - 1}
              y={0}
              width={2}
              height={size.h * (0.4 + i * 0.3)}
              fill="url(#vaultGraphGrid)"
            />
          ))}
        </Svg>
      )}
    </View>
  );
}

/**
 * The amber tile: a spacer the height of the card's title, then one cell
 * per key, each exactly its block's height from `laneLayout`, the glyph
 * centred on the name line at the top of the cell. As an outline (`edge`
 * set) it holds nothing yet: dashed, no fill, the glyph in the edge's
 * colour.
 *
 * ONE key is the exception: its glyph is centred in the tile (decided
 * 2026-09-25: "please make the key always centered in the orange
 * container. It only does it now if there are three lines of text. As soon
 * as there are 2 lines of text, the key drops to the bottom"). The tile
 * stretches to the card, and the card's height depends on whether the lane
 * prints a wait, so a top-aligned lone glyph floated at a different place
 * on every lane. With one key there is nothing to line it up WITH: the
 * name it belongs to is the only one there. Two or more keys keep the
 * per-key alignment, which is the whole point of the column there.
 *
 * The glyph is always full white, never dimmed for an empty slot: at 35%
 * over the amber it read as grey and could not be seen in a phone test
 * ("please make the key lighter so its more visible"). The Estate Plan PDF
 * and the staff dashboard never dimmed it either, so this also puts the
 * three back on one drawing. What says a slot is empty is its NAME, faint
 * in the card beside it.
 */
function Tile({
  blocks,
  withTitle,
  edge,
  ink,
  sc,
}: {
  blocks: readonly KeyBlockLayout[];
  withTitle: boolean;
  /** The outline's colour, for a slot or an option that holds nothing. */
  edge?: string;
  ink: Ink;
  sc: Scale;
}): React.JSX.Element {
  const ghost = edge != null;
  const lone = blocks.length < 2;
  return (
    <View
      style={[
        styles.tile,
        lone && styles.tileLone,
        { width: sc.tile, borderRadius: sc.radius, paddingVertical: sc.m.padV },
        ghost ? [styles.tileGhost, { borderColor: edge }] : { backgroundColor: ink.tile },
      ]}>
      {withTitle && !lone && <View style={{ height: sc.m.titleH }} />}
      {blocks.map((b, i) => (
        <View key={i} style={[!lone && { height: b.height }, i > 0 && { marginTop: sc.m.keySpace }]}>
          <View style={[styles.glyphLine, { height: sc.m.labelLh }]}>
            <KeyIcon size={sc.glyph} color={ghost ? edge : ink.glyph} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * One key block: its name on one line and, only when there is one, its
 * fingerprint or its state tight under it. Exactly `layout.height` tall.
 */
function KeyBlock({
  k,
  layout,
  last,
  ink,
}: {
  k: GraphKey;
  layout: KeyBlockLayout;
  last: boolean;
  ink: Ink;
}): React.JSX.Element {
  const second =
    k.state === 'placed' && k.fingerprint ? (
      <Text numberOfLines={1} style={[styles.cardFp, { color: ink.fingerprint }]}>
        {k.fingerprint}
      </Text>
    ) : k.state === 'pending' ? (
      <Text numberOfLines={1} style={[styles.cardNote, { color: ink.cardFaint }]}>
        {PENDING_NOTE}
      </Text>
    ) : null;
  return (
    <View style={{ height: layout.height }}>
      <Text
        numberOfLines={1}
        style={[styles.cardKey, { color: k.state === 'empty' ? ink.cardFaint : ink.cardInk }]}>
        {k.label}
        {last ? '' : ' +'}
      </Text>
      {second}
    </View>
  );
}

/**
 * The card's box on a scale: width, corner, padding. The card ends with a
 * HARD edge, the way the Estate Plan PDF and the staff dashboard draw it.
 * It dissolved into its line for a day (decided 2026-09-25: "fade the end of it
 * out and dont abruptly end the container"), that was ported to the
 * document, and it was dropped in all three the same day once seen on
 * paper and on a light phone: "The fade looks really bad on a white
 * background" and "Lets get rid of the fade completely and use the green".
 */
function cardBox(sc: Scale): object {
  return {
    width: sc.card,
    borderRadius: sc.radius,
    paddingVertical: sc.m.padV,
    paddingHorizontal: 8,
  };
}

/** The vault-overview lane: tile, the card with the title and every key, the track. */
function Lane({ row, ink, timeline }: { row: GraphRow; ink: Ink; timeline: boolean }): React.JSX.Element {
  const sc = PICTURE;
  const ghost = row.state === 'undecided';
  // An outline has no keys; its one glyph sits beside the hint, which takes
  // a one-line block of its own.
  const hintKey: GraphKey[] = ghost ? [{ label: row.hint ?? '', state: 'empty' }] : [];
  const keys = ghost ? hintKey : row.keys;
  const layout = laneLayout(keys, true, sc.m);
  return (
    <View style={styles.lane}>
      <View style={[styles.keyCol, { width: KEY_COL }]}>
        <Tile blocks={layout.keys} withTitle edge={ghost ? ink.ghost : undefined} ink={ink} sc={sc} />
        <View
          style={[
            styles.keyCard,
            cardBox(sc),
            ghost ? [styles.keyCardGhost, { borderColor: ink.ghost }] : { backgroundColor: ink.card },
          ]}>
          <Text numberOfLines={1} style={[styles.cardTitle, { color: ghost ? ink.ghost : ink.cardInk }]}>
            {row.title}
          </Text>
          {ghost ? (
            <View style={{ height: layout.keys[0]?.height }}>
              <Text numberOfLines={1} style={[styles.cardHint, { color: ink.ghost }]}>
                {row.hint}
              </Text>
            </View>
          ) : (
            row.keys.map((k, i) => (
              <View key={`${k.label}-${i}`} style={i > 0 && { marginTop: sc.m.keySpace }}>
                <KeyBlock k={k} layout={layout.keys[i]} last={i === row.keys.length - 1} ink={ink} />
              </View>
            ))
          )}
          {!!row.waitLabel && (
            <Text numberOfLines={1} style={[styles.cardWait, { color: ink.cardFaint }]}>
              {row.waitLabel}
            </Text>
          )}
        </View>
      </View>
      {!ghost && <Track row={row} ink={ink} timeline={timeline} />}
    </View>
  );
}

/**
 * The key step: the path's title as a caption, then one row per key of the
 * client's, then the question over the extra key with its two options. Each
 * row is the control: an empty one adds its key, a filled one replaces it.
 */
function KeyLanes({
  row,
  ink,
  actions,
}: {
  row: GraphRow;
  ink: Ink;
  actions: GraphActions;
}): React.JSX.Element {
  const own = row.keys.filter((k) => k.slot?.kind === 'user');
  const extra = row.keys.find((k) => k.slot?.kind === 'coSigner');
  const holder = row.holder;
  const rows: React.ReactNode[] = own.map((k, i) => (
    <KeyRow key={`own-${i}`} k={k} actions={actions} />
  ));
  if (extra && holder) {
    rows.push(
      <Text key="q" numberOfLines={1} style={[styles.keyCaption, styles.question, { color: ink.header }]}>
        {holder.question}
      </Text>,
      // Ours first, active by default; the client's own beside it. The
      // active option is the key the vault holds; the inactive one names
      // the option, and claims nothing.
      <KeyRow
        key="ours"
        k={holder.active === 'ours' ? extra : { label: COSIGNER_LABEL, state: 'empty', ours: true }}
        actions={actions}
        option={{ on: holder.active === 'ours', pick: () => actions.onPickHolder('ours') }}
      />,
      <KeyRow
        key="own"
        k={holder.active === 'own' ? extra : { label: OWN_OPTION_LABEL, state: 'empty' }}
        actions={actions}
        option={{ on: holder.active === 'own', pick: () => actions.onPickHolder('own') }}
      />,
    );
  }
  return (
    <View style={styles.keyLanes}>
      <Text numberOfLines={1} style={[styles.keyCaption, { color: ink.header }]}>
        {row.title}
      </Text>
      {rows}
    </View>
  );
}

/**
 * One key's row on the key step. What it says: whose key (the amber key;
 * "21st Capital" or the client's own name), its name, its fingerprint
 * when known (or "added at creation" for ours), and
 * whether the slot is filled. Empty and the client's to fill: "Add key" in
 * bold, drawn so it cannot pass for a key; the tap adds the key. Filled:
 * the tap replaces a key of the client's (never one of ours). As the
 * holder option NOT taken: a grey outline naming the option; the tap picks
 * it. Options carry a radio mark.
 */
function KeyRow({
  k,
  actions,
  option,
}: {
  k: GraphKey;
  actions: GraphActions;
  option?: { on: boolean; pick: () => void };
}): React.JSX.Element {
  const inactive = option != null && !option.on;
  const filled = !inactive && k.state !== 'empty';
  const addable = !inactive && k.state === 'empty' && !!k.slot;
  const replaceable = filled && !k.ours && !!k.slot;
  const onPress = inactive
    ? option.pick
    : addable
      ? () => actions.onAdd(k.slot as KeySlot)
      : replaceable
        ? () => actions.onReplace(k.slot as KeySlot)
        : undefined;
  const what = inactive ? `Choose ${k.label}` : addable ? `${ADD_KEY_LABEL}: ${k.label}` : `Replace ${k.label}`;
  const placed = k.state === 'placed' && !!k.fingerprint;
  return (
    <KeySlotRow
      name={k.label}
      trailing={placed ? k.fingerprint : k.state === 'pending' ? PENDING_NOTE : undefined}
      mono={placed}
      filled={filled}
      addable={addable}
      inactive={inactive}
      onPress={onPress}
      accessibilityLabel={what}
      after={option ? <RadioMark on={option.on} /> : undefined}
    />
  );
}
/**
 * The line: dashed from the start dot to where the lane opens, solid amber
 * from there on. With the timeline it ends in an arrowhead; without it (the
 * primary path alone, nothing waiting) it simply ends, because there is
 * nothing after it to point at. It used to dissolve over its last stretch,
 * as the card once dissolved into it; BOTH fades were dropped on 2026-09-25
 * after they were seen on a light phone and on the printed plan: "no fade on
 * any page. It doesnt look nice on white so we should change it on dark as
 * well". Measures its own width, so percentages land on the gridlines
 * above.
 */
function Track({
  row,
  ink,
  timeline,
}: {
  row: GraphRow;
  ink: Ink;
  timeline: boolean;
}): React.JSX.Element {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setW((prev) => (prev === width ? prev : width));
  };
  const open = row.dashedPercent <= 0;
  const openX = open ? START_X : (w * row.dashedPercent) / 100;
  const end = timeline ? w - ARROW - 1 : w;
  return (
    <View style={styles.track} onLayout={onLayout}>
      {w > 1 && (
        <>
          <Svg width={w} height={LINE_H}>
            {!open && (
              <Line
                x1={START_X}
                y1={LINE_Y}
                x2={openX}
                y2={LINE_Y}
                stroke={ink.dashed}
                strokeWidth={2}
                strokeDasharray="5 4"
              />
            )}
            <Line x1={openX} y1={LINE_Y} x2={end} y2={LINE_Y} stroke={ink.solid} strokeWidth={2} />
            {timeline && (
              <Path
                d={`M ${end} ${LINE_Y - 5} L ${w - 1} ${LINE_Y} L ${end} ${LINE_Y + 5} Z`}
                fill={ink.solid}
              />
            )}
          </Svg>
          {/* The dots are Views over the line: where the clock starts, dark
              while it waits, amber when open; then the moment it opens. */}
          <Dot x={START_X} color={open ? ink.solid : ink.dashed} />
          {!open && <Dot x={openX} color={ink.solid} />}
        </>
      )}
    </View>
  );
}

function Dot({ x, color }: { x: number; color: string }): React.JSX.Element {
  return <View style={[styles.dot, { left: x - DOT_R, backgroundColor: color }]} />;
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { gap: theme.spacing.md },
    /** What the client drags to fold the card shut, the app's sheet grabber. */
    grabber: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.hairline,
    },
    eyebrow: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.1 },

    axis: { height: HEADER_H, marginLeft: KEY_COL },
    axisLabel: {
      position: 'absolute',
      top: 0,
      width: AXIS_LABEL_W,
      marginLeft: -AXIS_LABEL_W / 2,
      textAlign: 'center',
      fontSize: 9,
      lineHeight: 11,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    lanes: { gap: theme.spacing.md },
    grid: { position: 'absolute', top: 0, bottom: 0, left: KEY_COL, right: 0 },

    lane: { flexDirection: 'row', alignItems: 'stretch' },
    keyCol: { flexDirection: 'row', gap: KEY_GAP },

    // The key step's rows, in the vault card's own family: the surface
    // ground, the large corner, clipped, no hairline, the Gloss first at
    // the card strength (the one container look every card shares).
    keyLanes: { gap: theme.spacing.md },
    keyCaption: { ...theme.typography.label, letterSpacing: 0.3 },
    question: { marginTop: theme.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      minHeight: ROW_MIN_H,
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.sm + 2,
      paddingHorizontal: theme.spacing.lg,
    },
    rowGlass: { backgroundColor: theme.colors.surface, overflow: 'hidden' },
    rowOutline: { borderWidth: 1, borderStyle: 'dashed' },
    // The name takes the room left between the key and the fingerprint, and
    // gives it up first: the fingerprint is how a key is told apart.
    rowName: { ...theme.typography.body, fontWeight: '600', color: theme.colors.ink, flex: 1, minWidth: 0 },
    rowAdd: { fontWeight: '700' },
    rowFp: { ...theme.typography.mono },
    rowNote: { ...theme.typography.caption },
    rowTrail: { flexShrink: 0 },

    // Both columns are drawn from laneLayout on the step's metrics: the
    // same padding at the top, the same title spacer, the same block
    // heights and spaces.
    tile: { alignItems: 'center', justifyContent: 'flex-start' },
    /** One key: nothing to line it up with, so it centres in the tile. */
    tileLone: { justifyContent: 'center' },
    tileGhost: { borderWidth: 1, borderStyle: 'dashed' },
    /** The name's line inside a glyph cell; the glyph is centred on it. */
    glyphLine: { justifyContent: 'center' },

    // The ground is the card green itself; cardBox sets the width, corner
    // and padding for the scale.
    keyCard: { justifyContent: 'flex-start' },
    keyCardGhost: { borderWidth: 1, borderStyle: 'dashed' },
    cardTitle: { height: LANE_METRICS.titleH, fontSize: 11, lineHeight: LANE_METRICS.labelLh, fontWeight: '700', letterSpacing: -0.2 },
    cardKey: { fontSize: 11, lineHeight: LANE_METRICS.labelLh, fontWeight: '400', letterSpacing: -0.2 },
    // The master fingerprint, under the key: how an heir finds the key on
    // their own device (decided 2026-07-27), in the document's green.
    cardFp: { fontFamily: 'Menlo', fontSize: 9, lineHeight: LANE_METRICS.noteLh, letterSpacing: 0.2 },
    cardNote: { fontSize: 9, lineHeight: LANE_METRICS.noteLh, fontWeight: '400' },
    cardHint: { fontSize: 9, lineHeight: LANE_METRICS.labelLh, fontWeight: '400' },
    cardWait: { fontSize: 9, lineHeight: LANE_METRICS.noteLh, fontWeight: '400', marginTop: LANE_METRICS.keySpace },

    track: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
    dot: {
      position: 'absolute',
      top: '50%',
      marginTop: -DOT_R,
      width: DOT_R * 2,
      height: DOT_R * 2,
      borderRadius: DOT_R,
    },
  }),
);
