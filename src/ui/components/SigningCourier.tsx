/**
 * Signing on the hardware, design A "The courier" (decided 2026-10-03: "yes,
 * build it"). What the signing screen's Bluetooth step shows once a device
 * has answered and the transaction starts on its way: a drawn phone on the
 * left, the device on the right, and the path between them.
 *
 *   1. Sending        the key's name; ONE bar along the path filling toward
 *                     the device (a BitBox: one pulse, no bar); the drawing
 *                     shows its loading page; Back pinned at the foot.
 *   2. Your turn      "3. Sign the transaction" (step 3 of the device's
 *                     plan, numbered as every turn page is, decided 2026-10-05:
 *                     `hww/deviceSteps.ts`); no bar: the phone greys,
 *                     the device lights in the one green and three chevrons
 *                     pulse toward it; the drawing is the hero and steps
 *                     through the device's own review pages, round and round
 *                     (the last page held as long as the longest, then the
 *                     first again), the press hint lighting the control to
 *                     press on each page (`SigningTour`, `PressHint`); the
 *                     card to compare against; what to do on this model; how
 *                     to stop on the device. No phone button.
 *   3. Coming back    the key's name; the bar fills back toward the phone and
 *                     holds near the end until the network answers; the
 *                     drawing shows signing, then signed.
 *   Not signed        a decline ("You declined on the Ledger. Nothing was
 *                     sent.") or a failure (the connection flow's own
 *                     sentence), with Try again and Back at the foot of
 *                     the page (`SigningCourierFooter`).
 *
 * Several transactions in one visit (the refresh session, decided 2026-10-05) run
 * the three screens once each, on the same feed: the slide is keyed by the
 * transaction's place in its batch and the leg (`legKey`, `legOrder`), so the
 * next transaction's sending screen slides in from the right like a new page
 * and the client reads "transaction 2 of 3" where the lines name it.
 *
 * Every signal and every word is decided in the pure modules
 * (`ui/hww/signingCeremony.ts`, `ui/hww/signingDevice.ts`); this file draws
 * them. It reads the ceremony from its feed, so the Ledger's ~12 messages a
 * second redraw this view alone. Motion is opacity and transforms on the
 * native driver, never a layout value; the muted phone is a colour. It is
 * mounted by ONE hook, `hooks/useSigningCourier`, which every screen that
 * signs on a device goes through, and which hands the page's pinned footer
 * the courier's buttons (`SigningCourierFooter`) the same way.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { Button } from './Button';
import { SentCard } from './SentPage';
import { StepTransition } from './StepTransition';
import { ChevronRightIcon } from './TablerIcons';
import { DeviceArt, deviceArtBox, deviceArtWidth } from './DeviceArt';
import { hintReach } from './PressHint';
import { extraRoom } from './pressHintScript';
import { SigningTour } from './SigningTour';
import { backShown, legKey, legOrder, pathFor } from '../hww/signingCeremony';
import type { CeremonyFeed, CeremonyState, PathKind } from '../hww/signingCeremony';
import { brandOf, compareRows, courierWords, nameRows, screenFor } from '../hww/signingDevice';
import type { DeviceDrawing, TourFacts } from '../hww/signingDevice';

/** The drawn phone's width, and its height. */
const PHONE_W = 36;
const PHONE_H = (PHONE_W * 110) / 60;
/** What the press hint keeps free between a pill and the title or the card. */
const HINT_CLEAR = 2;
/** The least room the path keeps between the phone and the device: three chevrons. */
const MIN_PATH = 64;

interface Props {
  /** The ceremony's signals, pushed by the signing task. */
  feed: CeremonyFeed;
  drawing: DeviceDrawing;
  /** The key being signed with: the title of screens 1 and 3. */
  keyName: string;
  facts: TourFacts;
  /** The connection flow's own sentence when it failed (the disconnect sentence, say). */
  failure: string | null;
}

export function SigningCourier({ feed, drawing, keyName, facts, failure }: Props): React.JSX.Element | null {
  const state = useSyncExternalStore(feed.subscribe, feed.get);
  const leg = state?.leg;
  const words = state ? courierWords(drawing, keyName, state, facts, failure) : null;
  const title = words?.title;
  // VoiceOver hears the turn and the ending as they come.
  useEffect(() => {
    if (title && (leg === 'approve' || leg === 'declined' || leg === 'failed')) {
      AccessibilityInfo.announceForAccessibility(title);
    }
  }, [leg, title]);
  if (state == null || words == null) return null;
  // A self-transfer on a one-key vault leaves nothing to compare: no card.
  const rows = state.leg === 'approve' ? (state.asks === 'name' ? nameRows(facts) : compareRows(facts)) : [];
  return (
    <StepTransition stepKey={legKey(state)} order={legOrder(state)} style={styles.inner}>
      <Text style={styles.title} accessibilityRole="header">
        {words.title}
      </Text>
      <CourierRow state={state} drawing={drawing} facts={facts} />
      {state.leg === 'approve' ? (
        <>
          {rows.length > 0 && <SentCard title={words.compareTitle ?? ''} rows={rows} />}
          <Text style={styles.body}>{words.body}</Text>
          <Text style={styles.caption}>{words.caption}</Text>
        </>
      ) : (
        words.line != null && <Text style={styles.sub}>{words.line}</Text>
      )}
    </StepTransition>
  );
}

/**
 * Does the courier have buttons for the page's foot in this state? Back while
 * the transaction is on its way (held, not hidden, once it has left: leaving
 * could no longer stop it); Try again and Back once the device declined or
 * the link failed; nothing during the client's turn on the device. The hook
 * reads it as a yes or no, so the page around the courier redraws only as
 * its footer comes and goes, never with the feed's ~12 messages a second.
 */
export function courierFootShown(state: CeremonyState | null): boolean {
  if (state == null) return false;
  return backShown(state) !== 'none' || state.leg === 'declined' || state.leg === 'failed';
}

/**
 * The courier's buttons, in the page's pinned footer (decided 2026-10-05: every
 * page's actions at the bottom) while the courier itself draws the content:
 * the page puts them in its footer (`Screen`'s `footer`, or its own
 * `PageFooter`) only while `courierFootShown` says there are any, so a
 * footer is never empty. It reads the same feed, so the ~12 messages a
 * second redraw these two buttons and the courier alone, never the screen
 * around them.
 */
export function SigningCourierFooter({
  feed,
  onBack,
  onRetry,
}: {
  feed: CeremonyFeed;
  onBack: () => void;
  onRetry: () => void;
}): React.JSX.Element | null {
  const state = useSyncExternalStore(feed.subscribe, feed.get);
  if (state == null) return null;
  const back = backShown(state);
  const ended = state.leg === 'declined' || state.leg === 'failed';
  if (back === 'none' && !ended) return null;
  return (
    <>
      {ended && <Button title="Try again" onPress={onRetry} />}
      <Button title="Back" variant="ghost" onPress={onBack} disabled={back === 'held'} />
    </>
  );
}

/** The picture: the phone, the path between, the device. The bar IS the path. */
function CourierRow({ state, drawing, facts }: { state: CeremonyState; drawing: DeviceDrawing; facts: TourFacts }): React.JSX.Element {
  const path = pathFor(brandOf(drawing), state.leg);
  const there = state.leg === 'approve';
  const screen = screenFor(state, facts);
  return (
    <DeviceRow drawing={drawing} path={path} there={there} fill={state.fill}>
      {(w) =>
        screen === 'tour' ? (
          <SigningTour key={state.turn} drawing={drawing} width={w} facts={facts} />
        ) : (
          <DeviceArt drawing={drawing} width={w} screen={screen} lit={there} />
        )
      }
    </DeviceRow>
  );
}

/**
 * The courier's row, for the ceremony and for the turns before it
 * (`DeviceTurn`): the drawn phone on the left (greyed when it is the
 * client's turn, `there`), the path between, and the device drawn by
 * `children` at the width that fits beside the phone.
 */
export function DeviceRow({
  drawing,
  path,
  there,
  fill = 0,
  children,
}: {
  drawing: DeviceDrawing;
  path: { kind: PathKind; towardPhone: boolean };
  there: boolean;
  /** The bar's fill, where the path is a bar. */
  fill?: number;
  children: (width: number) => React.ReactNode;
}): React.JSX.Element {
  const { width: windowW } = useWindowDimensions();
  // The row's own width once laid out, the page's (the window less its
  // gutters) until then: the turn pages now sit inside sheets padded wider
  // than a page (the key sheets, decided 2026-10-04), where a width read off the
  // window overflows the sheet's edge.
  const [rowW, setRowW] = useState<number | null>(null);
  const avail = rowW ?? windowW - 2 * theme.spacing.lg;
  const room = avail - PHONE_W - 2 * theme.spacing.md - MIN_PATH;
  const w = deviceArtWidth(drawing, room);
  const box = deviceArtBox(drawing, w);
  // The Nano X's open cover rises above the stick, and the press hint's pills
  // reach past the drawing (the Nova's above it, the Nano X's under it): the
  // row leaves that room on every screen, so the drawing never moves between
  // them and no pill reaches the title or the card.
  const reach = hintReach(drawing, w, box.h);
  const slack = theme.spacing.sm + theme.spacing.md + Math.max(0, (PHONE_H - box.h) / 2);
  const above = Math.max(box.rise, extraRoom(reach.above, slack, HINT_CLEAR));
  const below = extraRoom(reach.below, slack, HINT_CLEAR);
  return (
    <View
      style={[styles.row, (above > 0 || below > 0) && { marginTop: above, marginBottom: below }]}
      onLayout={(e) => {
        const width = Math.round(e.nativeEvent.layout.width);
        if (width > 0 && width !== rowW) setRowW(width);
      }}>
      <PhoneArt width={PHONE_W} muted={there} />
      <View style={styles.path}>
        {path.kind === 'bar' && <Bar fill={fill} towardPhone={path.towardPhone} />}
        {path.kind === 'pulse' && <Pulse towardPhone={path.towardPhone} />}
        {path.kind === 'chevrons' && <Chevrons />}
        {path.kind === 'dead' && <View style={styles.deadPath} />}
      </View>
      {children(w)}
    </View>
  );
}

/** The phone, drawn in the app's line style. On the client's turn it greys (a colour). */
function PhoneArt({ width, muted }: { width: number; muted: boolean }): React.JSX.Element {
  const h = (width * PHONE_H) / PHONE_W;
  const stroke = muted ? theme.colors.faint : theme.colors.offWhite;
  return (
    <Svg width={width} height={h} viewBox="0 0 60 110" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={3} y={3} width={54} height={104} rx={12} fill={theme.colors.surfaceRaised} stroke={stroke} strokeWidth={1.5 / (width / 60)} />
      <Rect x={9} y={11} width={42} height={88} rx={7} fill={theme.colors.surface} />
      <Rect x={22} y={6} width={16} height={3} rx={1.5} fill={stroke} />
    </Svg>
  );
}

/**
 * The one bar: a scale on the native driver, never a width. It only grows;
 * the one way down is a restart, which the screen says out loud, and that
 * starts it again from nothing rather than slide it backward.
 */
function Bar({ fill, towardPhone }: { fill: number; towardPhone: boolean }): React.JSX.Element {
  const v = useRef(new Animated.Value(0)).current;
  const last = useRef(0);
  useEffect(() => {
    if (fill < last.current) v.setValue(fill);
    else Animated.timing(v, { toValue: fill, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    last.current = fill;
  }, [fill, v]);
  return (
    <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.fill, { transformOrigin: towardPhone ? 'right' : 'left', transform: [{ scaleX: v }] }]} />
    </View>
  );
}

/** One pulse travelling the path: the BitBox's instant hand-over, no bar. */
function Pulse({ towardPhone }: { towardPhone: boolean }): React.JSX.Element {
  const v = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(300),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  const travel = Math.max(0, w - 8);
  const x = v.interpolate({ inputRange: [0, 1], outputRange: towardPhone ? [travel, 0] : [0, travel] });
  const o = v.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View style={styles.pulseTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.pulseDot, { opacity: o, transform: [{ translateX: x }] }]} />
    </View>
  );
}

/** Three chevrons lighting up one after another toward the device. Still,
 *  with Reduce Motion on. */
function Chevrons(): React.JSX.Element {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current;
  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!live) return;
        if (reduce) {
          vals.forEach((v) => v.setValue(1));
          return;
        }
        loops = vals.map((v, i) =>
          Animated.loop(
            Animated.sequence([
              Animated.delay(i * 220),
              Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(v, { toValue: 0.25, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
              Animated.delay((2 - i) * 220 + 400),
            ]),
          ),
        );
        loops.forEach((l) => l.start());
      });
    return () => {
      live = false;
      loops.forEach((l) => l.stop());
    };
  }, [vals]);
  return (
    <View style={styles.chevrons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ opacity: v }}>
          <ChevronRightIcon size={22} strokeWidth={2.5} color={theme.colors.accent} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    inner: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite, flexShrink: 1 },
    sub: { ...theme.typography.body, color: theme.colors.slate },
    body: { ...theme.typography.body, color: theme.colors.offWhite },
    caption: { ...theme.typography.caption, color: theme.colors.slate },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
    path: { flex: 1, justifyContent: 'center' },
    chevrons: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
    track: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceRaised, overflow: 'hidden' },
    fill: { height: '100%', width: '100%', borderRadius: 3, backgroundColor: theme.colors.accent },
    deadPath: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceRaised },
    pulseTrack: { height: 8, justifyContent: 'center' },
    pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent },
  }),
);
