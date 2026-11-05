/**
 * The BitBox02 Nova, drawn from six photos (design A "The courier", decided
 * 2026-10-03). Over Bluetooth a BitBox is always a Nova: the BitBox02 has no
 * radio.
 *
 * Proportions read off the photos and the published size (54.5 x 25.4 x 9.6
 * mm with its USB-C plug): a landscape slab, height 0.54 of its width,
 * corners 7%; the black glass face inside a 2% rim of the body's colour; the
 * OLED (128 x 64 px, pale cyan on black) 66% of the width, 2:1, centred; the
 * faint BitBox mark on the glass at the right; the USB-C plug on the left
 * end. Drawn in Bitcoin Orange, the finish of the photos. Units of the
 * body's width. Its pages: the review and the Total page's two-edge hold,
 * and, after it is plugged in, the side choice, the password entry, the
 * confirmation, the lock and the splash (decided 2026-10-04).
 */
import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { ChevronRightIcon } from './TablerIcons';
import { CrossGlyph, LitOutline, ScreenText, TickGlyph } from './DeviceArtParts';
import type { Motion, MotionDeg } from './DeviceArtParts';
import { NOVA_CONFIRM_MARK, NOVA_DONE_GLYPH, NOVA_HOLD_ARROW, NOVA_LOCK, NOVA_OUTPUT, NOVA_REGISTERED, NOVA_SCREEN, NOVA_SCROLL, NOVA_SIDE, NOVA_SLOTS, novaHoldArrows, novaRows, novaScrollWidth, novaTurnArrow } from './deviceScreenLayout';
import type { ControlSpot, ScreenRow } from './deviceScreenLayout';
import { NOVA, SHEEN } from './deviceArtPalette';
import { theme } from '../theme';
import type { DeviceScreen } from '../hww/signingDevice';

const BB = {
  h: 0.54,
  r: 0.07,
  rim: 0.02,
  oled: { x: 0.17, w: 0.66, h: 0.33 },
  plug: { w: 0.1, h: 0.14, r: 0.03 },
  mark: { cx: 0.905, cy: 0.5, r: 0.03 },
} as const;

export function novaSize(width: number): { w: number; h: number } {
  return { w: width + BB.plug.w * width, h: BB.h * width };
}

/**
 * The Total page as the device runs it while the client holds it (decided
 * 2026-10-03, photos nova-5 and nova-7): the down arrow alone at the top
 * right; once the top right edge is held, the up arrow at the bottom right;
 * while both edges are held the two slide together until they meet; then
 * "Transaction confirmed". Every value comes from the press hint's clock
 * (`pressHintScript.ts`); without it the page stands still as photo nova-5.
 */
export interface NovaProgress {
  kind: 'nova';
  /** The Total page (its words, the × and the arrows): shown, then gone when the device confirms. */
  page: Motion;
  /** "Transaction confirmed" and its tick: shown when the arrows meet. */
  confirmed: Motion;
  /** The up arrow: shown once the top edge is held. */
  up: Motion;
  /** The up arrow's small rise as it comes in, in points. */
  upRise: Motion;
  /** How far each arrow has slid toward the other, in points (down, and up as a negative). */
  downY: Motion;
  upY: Motion;
}

/**
 * The Nova after it is plugged in, as the drawing plays it while the phone
 * waits for its unlock and pairing (decided 2026-10-04, photos 56 to 62 and the
 * recording): the side page's arrow turning one way, then its mirror the
 * other; the confirmation's two arrows sliding together while both edges are
 * held, as on Total; the lock's shackle swinging open. Every value comes from
 * the press hint's clock; without it each page stands still.
 */
export interface NovaUnlockProgress {
  kind: 'nova-unlock';
  /** The side page's arrow: its turn, and which of its two glyphs shows. */
  turn: MotionDeg;
  ccw: Motion;
  cw: Motion;
  /** How far each of the confirmation's arrows has slid toward the other, in points (down, and up as a negative). */
  downY: Motion;
  upY: Motion;
  /** The shackle's swing about its left foot. */
  shackle: MotionDeg;
}

/**
 * A page whose one line the device scrolls, as the drawing plays it (decided
 * 2026-10-04 on the address check: "the user can scroll through the address
 * by swiping from the right to the left on the lower edge of the bitbox. The
 * display is not big enough to show the entire address"; the same on the
 * address under each amount of the signing review, decided 2026-10-05): the line
 * carried left through its window as the finger runs along the lower edge,
 * the thumb carried right along its track. One per frame swiped (`page`, the
 * review frame's index). Every value comes from the press hint's clock;
 * without it the line stands at its start, as the video's frame shows it.
 */
export interface NovaScrollProgress {
  page: number;
  /** How far the line has been carried left, in points (0 to minus the travel). */
  line: Motion;
  /** How far the thumb has moved right along its track, in points. */
  thumb: Motion;
}

/** The Total page's arrows, from `NOVA_HOLD_ARROW`: pointing down, or up. */
const ARROW_PATH = { down: 'M0 0 H10 L5 8 Z', up: 'M0 8 H10 L5 0 Z' } as const;

/** The anticlockwise turning arrow is the clockwise one in a mirror. */
const MIRRORED = { transform: [{ scaleX: -1 }] } as const;

/** The Nova's pages, in its own 128 x 64 pixels: the words from
 *  `novaRows` (each line placed and sized to fit the screen), the marks here. */
function NovaScreen({ W, screen, motion, scrolls }: { W: number; screen: DeviceScreen; motion?: NovaProgress | NovaUnlockProgress; scrolls?: readonly NovaScrollProgress[] }): React.JSX.Element | null {
  const progress = motion?.kind === 'nova' ? motion : undefined;
  const unlock = motion?.kind === 'nova-unlock' ? motion : undefined;
  const f = W / NOVA_SCREEN.w;
  const px = (n: number) => n * f;
  const mono = { fontFamily: theme.typography.mono.fontFamily, color: NOVA.oled };
  const rows = (list: ScreenRow[]) =>
    list.map((r, i) => (
      <ScreenText
        key={i}
        numberOfLines={1}
        ellipsizeMode={r.clip ? 'clip' : undefined}
        style={[
          mono,
          {
            position: 'absolute',
            left: px(r.left),
            right: px(r.right),
            top: px(r.top),
            fontSize: px(r.size),
            lineHeight: px(r.lineHeight),
            textAlign: r.align,
            fontWeight: r.bold ? '700' : '400',
          },
          r.upsideDown ? { transform: [{ rotate: '180deg' }] } : null,
        ]}>
        {r.text}
      </ScreenText>
    ));
  const cross = <ScreenText style={[mono, { position: 'absolute', left: px(6), top: px(2), fontSize: px(10), lineHeight: px(12) }]}>{'×'}</ScreenText>;
  const next = (
    <View style={{ position: 'absolute', right: px(4), top: px(2) }}>
      <ChevronRightIcon size={px(11)} strokeWidth={2.4} color={NOVA.oled} />
    </View>
  );
  const A = NOVA_HOLD_ARROW;
  const arrows = novaHoldArrows();
  const arrow = (d: string) => (
    <Svg width={px(A.w)} height={px(A.h)} viewBox={`0 0 ${A.w} ${A.h}`}>
      <Path d={d} fill={NOVA.oled} />
    </Svg>
  );
  /** "Transaction confirmed" (or "canceled") with its tick or cross. */
  const done = (ok: boolean) => {
    const g = NOVA_DONE_GLYPH;
    return (
      <>
        {rows(novaRows({ kind: 'done', ok }))}
        <View style={{ position: 'absolute', left: px(g.x), top: px(g.top) }}>
          {ok ? (
            <TickGlyph size={px(g.size)} color={NOVA.oled} strokeWidth={2.2} />
          ) : (
            <CrossGlyph size={px(g.size)} color={NOVA.oled} strokeWidth={2.2} />
          )}
        </View>
      </>
    );
  };
  switch (screen.kind) {
    case 'loading':
    case 'blank':
    case 'name':
      // The Nova draws nothing while the transaction streams in, and never
      // asks for a vault's name before the transaction.
      return null;
    case 'signing':
    case 'signed':
    case 'rejected':
      return done(screen.kind !== 'rejected');
    case 'nova-side': {
      // "Tap this side" at the top and the bottom, the turning arrow between
      // (photos 56 and 57): the anticlockwise glyph turning, then its
      // mirror turning the other way, on the clock; without it, the first
      // stands still.
      const a = NOVA_SIDE.arrow;
      const side = a.r * 2 + 4;
      const paths = novaTurnArrow(side / 2, side / 2, a.r);
      const glyph = (anticlockwise: boolean) => (
        <Svg width={px(side)} height={px(side)} viewBox={`0 0 ${side} ${side}`} style={anticlockwise ? MIRRORED : undefined}>
          <Path d={paths.arc} stroke={NOVA.oled} strokeWidth={a.stroke} fill="none" strokeLinecap="round" />
          <Path d={paths.head} fill={NOVA.oled} />
        </Svg>
      );
      const box = { position: 'absolute' as const, left: px(a.cx - side / 2), top: px(a.cy - side / 2) };
      return (
        <>
          {rows(novaRows(screen))}
          {unlock ? (
            <>
              <Animated.View style={[box, { opacity: unlock.ccw, transform: [{ rotate: unlock.turn }] }]}>{glyph(true)}</Animated.View>
              <Animated.View style={[box, { opacity: unlock.cw, transform: [{ rotate: unlock.turn }] }]}>{glyph(false)}</Animated.View>
            </>
          ) : (
            <View style={box}>{glyph(true)}</View>
          )}
        </>
      );
    }
    case 'nova-password':
      // The top bar's words, the entry and the groups from the layout; the
      // down arrow over the right slot, where the Total page has it.
      return (
        <>
          {rows(novaRows(screen))}
          <View style={{ position: 'absolute', right: px(A.right), top: px(arrows.downTop) }}>{arrow(ARROW_PATH.down)}</View>
        </>
      );
    case 'nova-confirm':
      // Both arrows at once (photo 58), sliding together while both
      // edges are held, exactly as on Total.
      return (
        <>
          {rows(novaRows(screen))}
          <Animated.View style={{ position: 'absolute', right: px(A.right), top: px(arrows.downTop), transform: [{ translateY: unlock?.downY ?? 0 }] }}>
            {arrow(ARROW_PATH.down)}
          </Animated.View>
          <Animated.View style={{ position: 'absolute', right: px(A.right), top: px(arrows.upTop), transform: [{ translateY: unlock?.upY ?? 0 }] }}>
            {arrow(ARROW_PATH.up)}
          </Animated.View>
        </>
      );
    case 'nova-lock': {
      // The lock (the recording): the body, and the shackle swinging open
      // about its left foot on the clock; without it, closed.
      const L = NOVA_LOCK;
      const b = L.body;
      const sh = L.shackle;
      const sw = 2 * sh.r + sh.stroke;
      const shH = sh.r + sh.stroke;
      const shackle = (
        <Svg width={px(sw)} height={px(shH)} viewBox={`0 0 ${sw} ${shH}`}>
          <Path
            d={`M${sh.stroke / 2} ${shH} V${sh.r + sh.stroke / 2} A${sh.r} ${sh.r} 0 0 1 ${sw - sh.stroke / 2} ${sh.r + sh.stroke / 2} V${shH}`}
            stroke={NOVA.oled}
            strokeWidth={sh.stroke}
            fill="none"
          />
        </Svg>
      );
      const box = { position: 'absolute' as const, left: px(L.cx - sw / 2), top: px(b.top - shH + sh.stroke / 2), width: px(sw), height: px(shH) };
      return (
        <>
          <View style={{ position: 'absolute', left: px(L.cx - b.w / 2), top: px(b.top), width: px(b.w), height: px(b.h), borderRadius: px(b.r), backgroundColor: NOVA.oled }} />
          {unlock ? (
            <Animated.View style={[box, { transformOrigin: 'left bottom', transform: [{ rotate: unlock.shackle }] }]}>{shackle}</Animated.View>
          ) : (
            <View style={box}>{shackle}</View>
          )}
        </>
      );
    }
    case 'nova-splash':
      // The device's name, large; no edition line (the phone does not know it).
      return <>{rows(novaRows(screen))}</>;
    case 'registered': {
      // "Multisig account registered" with the tick at the right (the video).
      const g = NOVA_REGISTERED.glyph;
      return (
        <>
          {rows(novaRows({ kind: 'registered', text: screen.text }))}
          <View style={{ position: 'absolute', left: px(g.x), top: px(g.top) }}>
            <TickGlyph size={px(g.size)} color={NOVA.oled} strokeWidth={2.2} />
          </View>
        </>
      );
    }
    case 'pin':
    case 'open-app':
    case 'app-home':
      // A Ledger's turns before the transaction, which the BitBox never has.
      return null;
    default:
      break;
  }
  const { page, index } = screen;
  // A page whose one line the device scrolls (a key, the address, the
  // address under an amount): on the clock the line is carried left through
  // its window as the finger runs along the lower edge, the thumb right along
  // its track (decided 2026-10-04, 2026-10-05); without it the line stands at its
  // start and the thumb at its track's left end, as the video's frame shows
  // them. The frame's own scroll, if it has one.
  const scroll = scrolls?.find((s) => s.page === index);
  const t = NOVA_SCROLL.thumb;
  const thumb = scroll ? (
    <Animated.View style={{ position: 'absolute', left: px(t.x), top: px(t.top), width: px(t.w), height: 1, backgroundColor: NOVA.oled, transform: [{ translateX: scroll.thumb }] }} />
  ) : (
    <View style={{ position: 'absolute', left: px(t.x), top: px(t.top), width: px(t.w), height: 1, backgroundColor: NOVA.oled }} />
  );
  const scrolled = (body: ScreenRow) =>
    scroll ? (
      <View style={{ position: 'absolute', left: px(body.left), right: px(body.right), top: px(body.top), height: px(body.lineHeight), overflow: 'hidden' }}>
        <Animated.View style={{ width: px(novaScrollWidth(body.text)) + 2, transform: [{ translateX: scroll.line }] }}>
          <ScreenText numberOfLines={1} style={[mono, { fontSize: px(body.size), lineHeight: px(body.lineHeight), textAlign: 'left' }]}>
            {body.text}
          </ScreenText>
        </Animated.View>
      </View>
    ) : (
      rows([body])
    );
  switch (page.kind) {
    case 'nova-address': {
      // The address check's last page (the video): the address in groups
      // of four as one scrolling line under "Receive to", and a tick in
      // place of the ">" at the top right, where the edge that confirms is.
      const m = NOVA_CONFIRM_MARK;
      const [title, body] = novaRows(page);
      return (
        <>
          {cross}
          <View style={{ position: 'absolute', right: px(m.right), top: px(m.top) }}>
            <TickGlyph size={px(m.size)} color={NOVA.oled} strokeWidth={2.4} />
          </View>
          {rows([title])}
          {scrolled(body)}
          {thumb}
        </>
      );
    }
    case 'nova-scroll': {
      // One line under its title, running off the screen as the device shows
      // it (the thumb along the bottom says it scrolls); on the last page
      // the down arrow in place of the ">", and, on the clock, the up arrow
      // coming in and both sliding together exactly as on Total.
      if (!page.hold) {
        return (
          <>
            {cross}
            {next}
            {rows(novaRows(page))}
            {thumb}
          </>
        );
      }
      const held = (
        <>
          {cross}
          <Animated.View style={{ position: 'absolute', right: px(A.right), top: px(arrows.downTop), transform: [{ translateY: progress?.downY ?? 0 }] }}>
            {arrow(ARROW_PATH.down)}
          </Animated.View>
          {rows(novaRows(page))}
          {thumb}
        </>
      );
      if (!progress) return held;
      return (
        <>
          {held}
          <Animated.View style={{ position: 'absolute', right: px(A.right), top: px(arrows.upTop), transform: [{ translateY: progress.upY }] }}>
            <Animated.View style={{ opacity: progress.up, transform: [{ translateY: progress.upRise }] }}>{arrow(ARROW_PATH.up)}</Animated.View>
          </Animated.View>
        </>
      );
    }
    case 'nova-item':
    case 'nova-text':
      return (
        <>
          {cross}
          {next}
          {rows(novaRows(page))}
        </>
      );
    case 'nova-output': {
      // The amount over a small down arrow, then the whole address as one
      // scrolling line in groups of four with the thumb under it (the
      // photo), swiped to its end on the clock exactly as the address
      // check's line (decided 2026-10-05); the ">" moves on.
      const [amount, to] = novaRows(page);
      const a = NOVA_OUTPUT.arrow;
      return (
        <>
          {cross}
          {next}
          {rows([amount])}
          <Svg width={px(a.w)} height={px(a.h)} viewBox={`0 0 ${a.w} ${a.h}`} style={{ position: 'absolute', left: px(NOVA_SCREEN.w / 2 - a.w / 2), top: px(a.top) }}>
            <Path d={`M0 0 H${a.w} L${a.w / 2} ${a.h} Z`} fill={NOVA.oled} />
          </Svg>
          {scrolled(to)}
          {thumb}
        </>
      );
    }
    case 'nova-total': {
      // The page opens with the down arrow alone at the top right (photo nova-5).
      const total = (
        <>
          {cross}
          <Animated.View style={{ position: 'absolute', right: px(A.right), top: px(arrows.downTop), transform: [{ translateY: progress?.downY ?? 0 }] }}>
            {arrow(ARROW_PATH.down)}
          </Animated.View>
          {rows(novaRows(page))}
        </>
      );
      if (!progress) return total;
      return (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress.page }]}>
            {total}
            {/* The up arrow, once the top edge is held, sliding up to meet the down arrow. */}
            <Animated.View style={{ position: 'absolute', right: px(A.right), top: px(arrows.upTop), transform: [{ translateY: progress.upY }] }}>
              <Animated.View style={{ opacity: progress.up, transform: [{ translateY: progress.upRise }] }}>{arrow(ARROW_PATH.up)}</Animated.View>
            </Animated.View>
          </Animated.View>
          {/* The device confirms once the arrows meet (photo nova-7). */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress.confirmed }]}>{done(true)}</Animated.View>
        </>
      );
    }
    default:
      return null;
  }
}

export function NovaArt({
  width,
  screen,
  lit,
  progress,
  scrolls,
}: {
  width: number;
  screen: DeviceScreen;
  lit: boolean;
  progress?: NovaProgress | NovaUnlockProgress;
  /** The frames whose line is swiped along, each with its own way (`page`). */
  scrolls?: readonly NovaScrollProgress[];
}): React.JSX.Element {
  const plugW = BB.plug.w * width;
  const u = width;
  const h = BB.h * u;
  const ow = BB.oled.w * u;
  const oh = BB.oled.h * u;
  const ox = plugW + BB.oled.x * u;
  const oy = (h - oh) / 2;
  const rim = BB.rim * u;
  const mr = BB.mark.r * u;
  return (
    <View style={{ width: width + plugW, height: h }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width + plugW} height={h}>
        <Defs>
          <LinearGradient id="bbbody" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={NOVA.body[0]} />
            <Stop offset="1" stopColor={NOVA.body[1]} />
          </LinearGradient>
          <LinearGradient id="bbglass" x1="0" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor={NOVA.glass[0]} />
            <Stop offset="1" stopColor={NOVA.glass[1]} />
          </LinearGradient>
          <LinearGradient id="bbsheen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={SHEEN} stopOpacity={NOVA.sheen[0]} />
            <Stop offset="0.45" stopColor={SHEEN} stopOpacity={NOVA.sheen[1]} />
            <Stop offset="1" stopColor={SHEEN} stopOpacity={NOVA.sheen[2]} />
          </LinearGradient>
          <LinearGradient id="bbplug" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={NOVA.plug[0]} />
            <Stop offset="1" stopColor={NOVA.plug[1]} />
          </LinearGradient>
        </Defs>
        {/* The USB-C plug on the left end, then the body, the glass face and its sheen. */}
        <Rect x={0} y={(h - BB.plug.h * u) / 2} width={plugW + rim} height={BB.plug.h * u} rx={BB.plug.r * u} fill="url(#bbplug)" />
        <Rect x={plugW} y={0} width={u} height={h} rx={BB.r * u} fill="url(#bbbody)" />
        <Rect x={plugW + rim} y={rim} width={u - 2 * rim} height={h - 2 * rim} rx={(BB.r - 0.015) * u} fill="url(#bbglass)" />
        <Rect x={plugW + rim} y={rim} width={u - 2 * rim} height={h - 2 * rim} rx={(BB.r - 0.015) * u} fill="url(#bbsheen)" />
        {/* The faint BitBox mark on the glass. */}
        <G transform={`translate(${plugW + BB.mark.cx * u} ${BB.mark.cy * h})`}>
          <Path
            d={`M0 ${-mr} L${mr * 0.87} ${-mr * 0.5} L${mr * 0.87} ${mr * 0.5} L0 ${mr} L${-mr * 0.87} ${mr * 0.5} L${-mr * 0.87} ${-mr * 0.5} Z`}
            stroke={NOVA.oled}
            strokeOpacity={NOVA.markStrength}
            strokeWidth={0.8}
            fill="none"
          />
        </G>
        {lit && <LitOutline x={plugW} w={u} h={h} r={BB.r * u} />}
      </Svg>
      <View style={{ position: 'absolute', left: ox, top: oy, width: ow, height: oh, overflow: 'hidden' }}>
        <NovaScreen W={ow} screen={screen} motion={progress} scrolls={scrolls} />
      </View>
    </View>
  );
}

// ─── Where the client touches (the press hint's anchors) ─────────────────────

/** The Nova's touch edges and its OLED, in the drawing's box (plug included). */
export interface NovaAnchors {
  /** The top right edge of the body, above the screen's ">": tap to move on, hold on Total. */
  edgeTop: ControlSpot;
  /** The bottom right edge, under it: held too on Total, once the up arrow shows. */
  edgeBottom: ControlSpot;
  /** The middle of the bottom edge: tapped to choose the side facing the client (decided 2026-10-04). */
  edgeMiddle: ControlSpot;
  /** The whole lower edge, run along from right to left to scroll a line
   *  (the address, decided 2026-10-04): lit at its middle, travelling
   *  `alongReach` points each way, inside the body's ends. */
  edgeAlong: ControlSpot;
  alongReach: number;
  /** The bottom edge under each of the password's three groups (`NOVA_SLOTS`). */
  slots: ControlSpot[];
  /** The OLED, where the words are. */
  screen: { x: number; y: number; w: number; h: number };
  /** The OLED's own pixel in points. */
  px: number;
}

export function novaAnchors(width: number): NovaAnchors {
  const plugW = BB.plug.w * width;
  const u = width;
  const h = BB.h * u;
  const ow = BB.oled.w * u;
  const oh = BB.oled.h * u;
  const ox = plugW + BB.oled.x * u;
  const oy = (h - oh) / 2;
  const f = ow / NOVA_SCREEN.w;
  // Over the ">" (4 pixels in from the screen's right edge, 11 wide).
  const x = ox + ow - 9.5 * f;
  return {
    edgeTop: { x, y: 1, r: 9 },
    edgeBottom: { x, y: h - 1, r: 9 },
    edgeMiddle: { x: plugW + u / 2, y: h - 1, r: 9 },
    edgeAlong: { x: plugW + u / 2, y: h - 1, r: 9 },
    // The bar of light (38 wide) kept inside the body's rounded ends.
    alongReach: u / 2 - 26,
    slots: NOVA_SLOTS.map((sx) => ({ x: ox + sx * f, y: h - 1, r: 9 })),
    screen: { x: ox, y: oy, w: ow, h: oh },
    px: f,
  };
}
