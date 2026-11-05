/**
 * The Ledger Nano X, drawn from eight photos (design A "The courier",
 * decided 2026-10-03, after three fixes: no mark at the top left of the OLED,
 * the stick level with the phone and the chevrons, the cover swung UP).
 *
 * In units of the body's HEIGHT (72 x 18.6 mm): a black glass stick about
 * 3.9 long with rounded ends; the round button set into the glass at 0.52
 * from the left end; the OLED (128 x 64 px, white on black) from 1.05 to
 * 2.63 along the stick and 0.79 tall; the brushed-metal swivel cover, as wide
 * as the body, pivoting on the right end at 3.45 and swung up by 40 degrees,
 * with its round cap on the pivot. The drawing's box is the stick alone, so a
 * row centres on it; the cover rises `rise` above it (`nanoXRise` is the room
 * a row leaves for it) and its near end dips `hang` below.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { CurrencyBitcoinIcon } from './TablerIcons';
import { BackspaceGlyph, CrossGlyph, LitOutline, ScreenText, Spinning, TickGlyph } from './DeviceArtParts';
import { NANO_PIN, NANO_X_ARROW, NANO_X_SCREEN, nanoXLayout } from './deviceScreenLayout';
import type { ControlSpot, NanoXPage } from './deviceScreenLayout';
import { NANO_X, SHEEN } from './deviceArtPalette';
import type { DeviceScreen } from '../hww/signingDevice';

const NX = {
  len: 3.9,
  r: 0.14,
  button: { cx: 0.52, cy: 0.5, r: 0.3 },
  oled: { x: 1.05, y: 0.105, w: 1.58, h: 0.79 },
  pivot: { x: 3.45, y: 0.5 },
  arm: { back: 0.55, fwd: 1.6, half: 0.5, angle: -40 },
  cap: { r: 0.3 },
  boxW: 5.0,
  rise: 0.95,
  hang: 0.26,
} as const;

/** How far the open cover rises above the stick, for the row's top margin. */
export function nanoXRise(width: number): number {
  return (NX.rise * width) / NX.boxW;
}

/** The stick's own height (the drawing's box). */
export function nanoXHeight(width: number): number {
  return width / NX.boxW;
}

/** The dotted ring the Nano X shows while it works, turning. */
function OledSpinner({ size }: { size: number }): React.JSX.Element {
  const dots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const a = (i / 8) * Math.PI * 2;
    return { cx: 12 + 8 * Math.cos(a), cy: 12 + 8 * Math.sin(a), r: i === 0 ? 2.2 : 1.5 };
  });
  return (
    <Spinning size={size} ms={1200}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {dots.map((d, i) => (
          <Circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={NANO_X.pixel} />
        ))}
      </Svg>
    </Spinning>
  );
}

/** The page `nanoXLayout` lays out for a screen, or null when it is dark. */
function pageFor(screen: DeviceScreen): NanoXPage | null {
  switch (screen.kind) {
    case 'blank':
    case 'nova-side':
    case 'nova-password':
    case 'nova-confirm':
    case 'nova-lock':
    case 'nova-splash':
      // Dark; the BitBox's own pages are no page of a Ledger's.
      return null;
    case 'loading':
      return { kind: 'working', text: 'Loading transaction' };
    case 'signing':
      return { kind: 'working', text: 'Signing transaction' };
    case 'signed':
    case 'rejected':
      return { kind: 'done', ok: screen.kind === 'signed' };
    case 'name':
      // Bitcoin app 2.2.1 to 2.4.1: the registered vault's name, before the review.
      return { kind: 'item', title: 'Wallet name', value: screen.name };
    case 'pin':
      return { kind: 'pin', entered: screen.entered, cursor: screen.cursor };
    case 'open-app':
      return { kind: 'open-app', app: screen.app };
    case 'registered':
      // "Account registered", "Address verified": the word alone (as the videos show).
      return { kind: 'notice', text: screen.text };
    case 'app-home':
      // The app's home, filmed at the end of an address check: the title
      // over "app is ready" (the note is the touchscreens').
      return { kind: 'app-home', app: screen.app };
    default:
      break;
  }
  const { page } = screen;
  switch (page.kind) {
    case 'nano-intro':
      return { kind: 'intro' };
    case 'nano-item':
      return { kind: 'item', title: page.title, value: page.value, long: page.long };
    case 'nano-sign':
      return { kind: 'sign' };
    case 'nano-register-intro':
      return { kind: 'register-intro' };
    case 'nano-register-keys':
      return { kind: 'register-keys' };
    case 'nano-register-approve':
      return { kind: 'register-approve' };
    case 'nano-address-intro':
      return { kind: 'address-intro' };
    case 'nano-address-confirm':
      return { kind: 'confirm' };
    default:
      return null;
  }
}

/** What the OLED shows, laid out in its own 128 x 64 pixels as the photos
 *  show it: the words and places from `nanoXLayout`, the arrows at the very
 *  edges, the battery at the top right. */
function NanoScreen({ W, screen }: { W: number; screen: DeviceScreen }): React.JSX.Element | null {
  const page = pageFor(screen);
  if (page == null) return null;
  const f = W / NANO_X_SCREEN.w;
  const px = (n: number) => n * f;
  const { rows, glyph, arrows, pin } = nanoXLayout(page);
  // The one small icon along the top edge: the battery at the top right
  // (decided 2026-10-03: there is no mark at the top left of a real Nano X).
  const battery = (
    <View style={{ position: 'absolute', right: px(5), top: px(3), width: px(5), height: px(8), borderWidth: 1, borderColor: NANO_X.pixel, borderRadius: 1 }}>
      <View style={{ position: 'absolute', left: 1, right: 1, bottom: 1, height: px(3), backgroundColor: NANO_X.pixel }} />
    </View>
  );
  const a = NANO_X_ARROW;
  const mid = NANO_X_SCREEN.h / 2;
  const chevron = (d: string) => (
    <Path d={d} stroke={NANO_X.pixel} strokeWidth={a.stroke} fill="none" strokeLinecap="square" strokeLinejoin="miter" />
  );
  return (
    <>
      {battery}
      {glyph && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: px(glyph.top), alignItems: 'center' }}>
          {glyph.kind === 'spinner' ? (
            <OledSpinner size={px(glyph.size)} />
          ) : glyph.kind === 'bitcoin' ? (
            <CurrencyBitcoinIcon size={px(glyph.size)} strokeWidth={2.8} color={NANO_X.pixel} />
          ) : glyph.kind === 'tick' ? (
            <TickGlyph size={px(glyph.size)} color={NANO_X.pixel} strokeWidth={3.2} square />
          ) : (
            <CrossGlyph size={px(glyph.size)} color={NANO_X.pixel} strokeWidth={3.2} square />
          )}
        </View>
      )}
      {rows.map((r, i) => (
        <ScreenText
          key={i}
          numberOfLines={r.lines}
          style={{
            position: 'absolute',
            left: px(r.left),
            right: px(r.right),
            top: px(r.top),
            color: NANO_X.pixel,
            fontSize: px(r.size),
            lineHeight: px(r.lineHeight),
            fontWeight: r.bold ? '700' : '400',
            textAlign: r.align,
            letterSpacing: 0,
          }}>
          {r.text}
        </ScreenText>
      ))}
      {pin && (
        // The PIN page (the photos): the eight slots, hollow until a digit
        // is in; the digits on their pitch with the backspace and the tick
        // at the ends once shown; the underline under the cursor's key.
        <>
          {pin.slots.map((slot, i) => (
            <View
              key={`s${i}`}
              style={{
                position: 'absolute',
                left: px(slot.x),
                top: px(NANO_PIN.slots.top),
                width: px(NANO_PIN.slots.d),
                height: px(NANO_PIN.slots.d),
                borderRadius: px(NANO_PIN.slots.d) / 2,
                borderWidth: Math.max(1, px(0.9)),
                borderColor: NANO_X.pixel,
                backgroundColor: slot.filled ? NANO_X.pixel : undefined,
              }}
            />
          ))}
          {pin.keys.map((key, i) => (
            <View
              key={`k${i}`}
              style={{ position: 'absolute', left: px(key.x), top: px(NANO_PIN.keys.top), width: px(NANO_PIN.keys.pitch), height: px(NANO_PIN.keys.lineHeight), alignItems: 'center', justifyContent: 'center' }}>
              {key.glyph === 'backspace' ? (
                <BackspaceGlyph size={px(9)} color={NANO_X.pixel} ink={NANO_X.glass[1]} />
              ) : key.glyph === 'tick' ? (
                <TickGlyph size={px(8)} color={NANO_X.pixel} strokeWidth={3.4} square />
              ) : (
                <ScreenText style={{ color: NANO_X.pixel, fontSize: px(NANO_PIN.keys.size), lineHeight: px(NANO_PIN.keys.lineHeight), fontWeight: '700', letterSpacing: 0 }}>{key.text}</ScreenText>
              )}
            </View>
          ))}
          <View style={{ position: 'absolute', left: px(pin.cursor.x), top: px(NANO_PIN.cursor.top), width: px(NANO_PIN.cursor.w), height: Math.max(1, px(NANO_PIN.cursor.h)), backgroundColor: NANO_X.pixel }} />
        </>
      )}
      {(arrows.left || arrows.right) && (
        // The arrows: four pixels by seven at the very edges, centred on the
        // screen's height, the words kept clear of them.
        <Svg width={W} height={px(NANO_X_SCREEN.h)} viewBox={`0 0 ${NANO_X_SCREEN.w} ${NANO_X_SCREEN.h}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {arrows.left && chevron(`M${a.inset + a.w} ${mid - a.h / 2} L${a.inset} ${mid} L${a.inset + a.w} ${mid + a.h / 2}`)}
          {arrows.right &&
            chevron(
              `M${NANO_X_SCREEN.w - a.inset - a.w} ${mid - a.h / 2} L${NANO_X_SCREEN.w - a.inset} ${mid} L${NANO_X_SCREEN.w - a.inset - a.w} ${mid + a.h / 2}`,
            )}
        </Svg>
      )}
    </>
  );
}

export function NanoXArt({ width, screen, lit }: { width: number; screen: DeviceScreen; lit: boolean }): React.JSX.Element {
  const h = width / NX.boxW;
  const y0 = NX.rise * h;
  const svgH = (NX.rise + 1 + NX.hang) * h;
  const o = NX.oled;
  const a = NX.arm;
  const pivotX = NX.pivot.x * h;
  const pivotY = y0 + NX.pivot.y * h;
  return (
    <View style={{ width, height: h, overflow: 'visible' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={svgH} style={{ position: 'absolute', left: 0, top: -y0 }}>
        <Defs>
          <LinearGradient id="nxglass" x1="0" y1="0" x2="0.2" y2="1">
            <Stop offset="0" stopColor={NANO_X.glass[0]} />
            <Stop offset="1" stopColor={NANO_X.glass[1]} />
          </LinearGradient>
          <LinearGradient id="nxmetal" x1="0" y1="0" x2="0.3" y2="1">
            <Stop offset="0" stopColor={NANO_X.metal[0]} />
            <Stop offset="1" stopColor={NANO_X.metal[1]} />
          </LinearGradient>
        </Defs>
        {/* The body: black glass with a faint top-left sheen. */}
        <Rect x={0} y={y0} width={NX.len * h} height={h} rx={NX.r * h} fill="url(#nxglass)" />
        <Rect x={0.5} y={y0 + 0.5} width={NX.len * h - 1} height={h - 1} rx={NX.r * h} fill="none" stroke={SHEEN} strokeOpacity={NANO_X.edgeStrength} strokeWidth={1} />
        {/* The round button set into the glass. */}
        <Circle cx={NX.button.cx * h} cy={y0 + NX.button.cy * h} r={NX.button.r * h} fill={NANO_X.buttonFill} stroke={NANO_X.buttonRim} strokeWidth={0.03 * h} />
        <Circle
          cx={NX.button.cx * h}
          cy={y0 + NX.button.cy * h}
          r={NX.button.r * h - 0.06 * h}
          fill="none"
          stroke={SHEEN}
          strokeOpacity={NANO_X.buttonRingStrength}
          strokeWidth={0.02 * h}
        />
        {/* The swivel cover over the right end, swung open, and its cap on the pivot. */}
        <G transform={`translate(${pivotX} ${pivotY}) rotate(${a.angle})`}>
          <Rect x={-a.back * h} y={-a.half * h} width={(a.back + a.fwd) * h} height={2 * a.half * h} rx={a.half * h} fill="url(#nxmetal)" stroke={NANO_X.metalEdge} strokeWidth={0.5} />
          <Path d={`M${-a.back * h + 0.3 * h} ${-a.half * h + 0.12 * h} H${a.fwd * h - 0.3 * h}`} stroke={SHEEN} strokeOpacity={NANO_X.coverLineStrength} strokeWidth={0.02 * h} />
        </G>
        <Circle cx={pivotX} cy={pivotY} r={NX.cap.r * h} fill={NANO_X.cap} stroke={NANO_X.capRim} strokeWidth={0.03 * h} />
        <Circle cx={pivotX} cy={pivotY} r={NX.cap.r * h - 0.08 * h} fill={NANO_X.capInner} />
        {lit && <LitOutline y={y0} w={NX.len * h} h={h} r={NX.r * h} />}
      </Svg>
      <View style={{ position: 'absolute', left: o.x * h, top: o.y * h, width: o.w * h, height: o.h * h, overflow: 'hidden' }}>
        <NanoScreen W={o.w * h} screen={screen} />
      </View>
    </View>
  );
}

// ─── Where the client presses (the press hint's anchors) ─────────────────────

/** The Nano X's two buttons and its OLED, in the drawing's box (the stick). */
export interface NanoXAnchors {
  /** The right button: the round cap on the swivel's pivot. Moves on. */
  right: ControlSpot;
  /** The left button: the dark circle set into the glass. With the right one, signs. */
  left: ControlSpot;
  /** The OLED, where the words are. */
  screen: { x: number; y: number; w: number; h: number };
}

export function nanoXAnchors(width: number): NanoXAnchors {
  const h = width / NX.boxW;
  const o = NX.oled;
  return {
    right: { x: NX.pivot.x * h, y: NX.pivot.y * h, r: NX.cap.r * h },
    left: { x: NX.button.cx * h, y: NX.button.cy * h, r: NX.button.r * h },
    screen: { x: o.x * h, y: o.y * h, w: o.w * h, h: o.h * h },
  };
}
