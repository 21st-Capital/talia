/**
 * The touchscreen Ledgers, drawn (design A "The courier", decided 2026-10-03):
 * the Nano Gen5 from photos of the device ("looks perfect"), the Flex and the Stax
 * from Ledger's own renders. One family, one E Ink screen: the three
 * run the same Bitcoin app pages, laid out as the photos show them.
 *
 * Besides the review pages: the locked device's PIN keypad and "Open app?"
 * (decided 2026-10-04, from photos), drawn before the transaction.
 *
 * The products' colours come from `deviceArtPalette.ts`, the one place they
 * live; the lit outline is the theme's one green.
 */
import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { ChevronLeftIcon, ChevronRightIcon, CurrencyBitcoinIcon } from './TablerIcons';
import { BackspaceGlyph, CornerMark, GearGlyph, LitOutline, OutlinedDone, QrGlyph, ScreenText, TickGlyph, bracketMarkPath } from './DeviceArtParts';
import type { Motion } from './DeviceArtParts';
import { EINK_PAGE, EINK_WORKING, einkAddressRow, einkAnchors, einkPinBand, einkPinCells, einkUnit } from './deviceScreenLayout';
import type { ControlSpot } from './deviceScreenLayout';
import { EINK, FLEX, GEN5, SHEEN, STAX } from './deviceArtPalette';
import { PAD_BACKSPACE, PAD_TICK, PIN_MIN, padDigitAt } from '../hww/deviceTurns';
import type { DeviceScreen } from '../hww/signingDevice';

/**
 * The device's own progress on the last page while the client holds "Hold to
 * sign" (decided 2026-10-04, from a recording of a Gen5): a THIN DARK LINE filling
 * left to right along the top edge of the "Hold to sign" row, then the page
 * ghosting away as "Signing transaction" comes with its jumping corner. The
 * press hint's clock drives it (`pressHintScript.ts`); the device draws no
 * ring round the tile.
 */
export interface TouchProgress {
  kind: 'touch';
  /** The line's fill, 0 to 1 of the screen's width (a scale, never a width). */
  line: Motion;
  /** The page's ink: 1, then ghosted, then gone. */
  page: Motion;
  /** "Signing transaction" and its corner: 0, then 1. */
  signing: Motion;
}

interface TouchArtProps {
  width: number;
  screen: DeviceScreen;
  lit: boolean;
  /** The hold ring on the last page, from the press hint's clock. */
  progress?: TouchProgress;
}

/** Where the client touches a touch Ledger, in the drawing's box: the footer's
 *  ">" (tap to move on), the "Hold to sign" tile, the "Open app?" page's Open
 *  button, the registration's dark Approve button and the address page's
 *  dark Confirm (the device videos, 2026-10-04), the PIN page's twelve keys (by
 *  cell) and the free band over them where its one word sits; the side
 *  button that turns the device on (decided 2026-10-04: "before entering a pin on
 *  all Ledger Gen5, Flex and Stax, the device needs to be 'turned on' which
 *  is done by pressing the side button"), ringed as the rounded rectangle it
 *  is; and the screen itself (where the words are). */
export interface TouchAnchors {
  next: ControlSpot;
  tile: ControlSpot;
  open: ControlSpot;
  approve: ControlSpot;
  confirm: ControlSpot;
  pin: ControlSpot[];
  side: ControlSpot;
  band: { top: number; bottom: number };
  screen: { x: number; y: number; w: number; h: number };
}

/** A side button on the right edge, in units of the body's width: its top,
 *  its height, how far it stands out, and its corner. */
type SideButton = { readonly y: number; readonly h: number; readonly w: number; readonly r: number };

/** The black bitcoin disc the review pages carry. */
function BitcoinDisc({ d }: { d: number }): React.JSX.Element {
  return (
    <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: EINK.ink, alignItems: 'center', justifyContent: 'center' }}>
      <CurrencyBitcoinIcon size={d * 0.74} strokeWidth={2.6} color={EINK.paper} />
    </View>
  );
}

/** One of the device's dotted rules. */
function Dotted({ from, to, at, W, H, vertical }: { from: number; to: number; at: number; W: number; H: number; vertical?: boolean }): React.JSX.Element {
  return (
    <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path
        d={vertical ? `M${at} ${from} L${at} ${to}` : `M${from} ${at} L${to} ${at}`}
        stroke={EINK.dots}
        strokeWidth={1}
        strokeDasharray="1 2.6"
      />
    </Svg>
  );
}

/**
 * What the E Ink shows: the Bitcoin app's pages as the photos lay them out,
 * placed from `EINK_PAGE`. `typeScale` shrinks the type a little on the Flex
 * and the Stax, whose screens hold more pixels for their size. `progress` is
 * the hold ring the last page fills while the client holds the tile (the
 * press hint's clock); without it the page stands still.
 */
export function EinkScreen({
  W,
  H,
  screen,
  typeScale = 1,
  progress,
}: {
  W: number;
  H: number;
  screen: DeviceScreen;
  typeScale?: number;
  progress?: TouchProgress;
}): React.JSX.Element | null {
  const P = EINK_PAGE;
  const T = P.type;
  // Type sizes relative to the screen's width, read off the photos.
  const f = (k: number) => einkUnit(k, W, typeScale);
  const text = (t: readonly [number, number]) => ({ fontSize: f(t[0]), lineHeight: f(t[1]) });
  const title = { ...text(T.title), fontWeight: '600' as const, color: EINK.ink, textAlign: 'center' as const };
  const small = { ...text(T.small), fontWeight: '400' as const, color: EINK.ink };
  const value = { ...text(T.value), fontWeight: '600' as const, color: EINK.ink };
  const foot = { ...text(T.foot), color: EINK.ink };
  const pad = P.pad * W;
  const footerTop = P.footer.top * H;
  const split = P.footer.split * W;
  const chev = f(T.chevron);

  // The corner jumping round its box, the words under it, the two centred on
  // the screen (a recording of a Gen5).
  const working = (words: string) => {
    const k = EINK_WORKING;
    return (
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <CornerMark w={f(k.box.w)} h={f(k.box.h)} across={f(k.arm.across)} down={f(k.arm.down)} stroke={f(k.stroke)} color={EINK.ink} />
        <ScreenText style={[small, { marginTop: f(k.gap), textAlign: 'center' }]}>{words}</ScreenText>
      </View>
    );
  };

  // The footer: "Reject" on the review and the registration, "Cancel" on the
  // address check (the device videos), the counter and the chevrons.
  const footer = (n: number, total: number, left: string = 'Reject') => (
    <>
      <Dotted from={0} to={W} at={footerTop} W={W} H={H} />
      <Dotted from={footerTop} to={H} at={split} W={W} H={H} vertical />
      <View style={{ position: 'absolute', left: 0, right: 0, top: footerTop, bottom: 0, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: split, paddingLeft: pad }}>
          <ScreenText style={[foot, { fontWeight: '700' }]}>{left}</ScreenText>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: pad * P.footer.inset }}>
          <View style={{ width: chev }}>{n > 1 && <ChevronLeftIcon size={chev} strokeWidth={2.6} color={EINK.ink} />}</View>
          <ScreenText style={[foot, { fontWeight: '500' }]}>
            {n} of {total}
          </ScreenText>
          <View style={{ width: chev }}>{n < total && <ChevronRightIcon size={chev} strokeWidth={2.6} color={EINK.ink} />}</View>
        </View>
      </View>
    </>
  );

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
    case 'signing':
      return working(screen.kind === 'loading' ? 'Loading transaction' : 'Signing transaction');
    case 'signed':
    case 'rejected':
      // An outlined circle holding the tick (the device recording), or the cross.
      return (
        <View style={{ position: 'absolute', left: 0, right: 0, top: P.done.top * H, alignItems: 'center', gap: P.done.gap * H }}>
          <OutlinedDone size={f(T.doneDisc)} stroke={f(T.doneStroke)} ok={screen.kind === 'signed'} color={EINK.ink} />
          <ScreenText style={title}>{screen.kind === 'signed' ? 'Transaction signed' : 'Transaction rejected'}</ScreenText>
        </View>
      );
    case 'pin': {
      // The locked device (photos of a Gen5): "Enter your PIN", a dot
      // per digit in, the keypad in the order this pass gives it (the device
      // shuffles it every time it asks), the tick tile dark once four are in.
      const pin = P.pin;
      const cells = einkPinCells(W, H);
      const digit = { fontSize: f(T.padDigit), lineHeight: Math.round(f(T.padDigit) * 1.25), fontWeight: '600' as const, color: EINK.ink };
      const dot = pin.dots.d * W;
      const glyph = f(T.padGlyph);
      const enough = screen.entered >= PIN_MIN;
      return (
        <>
          <ScreenText style={[text(T.pinTitle), { color: EINK.ink, position: 'absolute', left: 0, right: 0, top: pin.title * H, textAlign: 'center' }]}>Enter your PIN</ScreenText>
          <View style={{ position: 'absolute', left: pin.dots.left * W, top: pin.dots.top * H, flexDirection: 'row', gap: (pin.dots.pitch - pin.dots.d) * W }}>
            {Array.from({ length: screen.entered }, (_, i) => (
              <View key={i} style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: EINK.ink }} />
            ))}
          </View>
          {[0, 1, 2, 3].map((r) => (
            <Dotted key={r} from={0} to={W} at={cells.top + r * cells.h} W={W} H={H} />
          ))}
          {[1, 2].map((c) => (
            <Dotted key={c} from={cells.top} to={H} at={c * cells.w} W={W} H={H} vertical />
          ))}
          {Array.from({ length: 12 }, (_, i) => {
            const box = {
              position: 'absolute' as const,
              left: (i % 3) * cells.w,
              top: cells.top + Math.floor(i / 3) * cells.h,
              width: cells.w,
              height: cells.h,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
            };
            if (i === PAD_TICK) {
              return enough ? (
                <View key={i} style={[box, { backgroundColor: EINK.ink }]}>
                  <TickGlyph size={glyph} color={EINK.paper} strokeWidth={2.6} />
                </View>
              ) : null;
            }
            if (i === PAD_BACKSPACE) {
              return (
                <View key={i} style={box}>
                  <BackspaceGlyph size={glyph} color={EINK.ink} ink={EINK.paper} />
                </View>
              );
            }
            return (
              <View key={i} style={box}>
                <ScreenText style={digit}>{padDigitAt(screen.pad, i) ?? ''}</ScreenText>
              </View>
            );
          })}
        </>
      );
    }
    case 'open-app': {
      // "Open app?" (a photo of a Gen5): the "i" box top right, the
      // disc, the app's name, the dark Open button, "Don't open" under it.
      const o = P.open;
      const bold = { fontSize: f(T.button), lineHeight: Math.round(f(T.button) * 1.25), fontWeight: '600' as const };
      return (
        <>
          <View
            style={{
              position: 'absolute',
              right: o.info.right * W,
              top: o.info.top * H,
              width: o.info.w * W,
              height: o.info.h * H,
              borderWidth: 1,
              borderStyle: 'dotted',
              borderColor: EINK.dots,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <ScreenText style={[small, { fontWeight: '600' }]}>i</ScreenText>
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, top: o.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: o.title * H }]}>Open app?</ScreenText>
          <ScreenText style={[text(T.appName), { color: EINK.ink, position: 'absolute', left: 0, right: 0, top: o.app * H, textAlign: 'center' }]}>{screen.app}</ScreenText>
          <View
            style={{
              position: 'absolute',
              left: o.button.x * W,
              right: o.button.x * W,
              top: o.button.top * H,
              height: o.button.h * H,
              borderRadius: o.button.r * W,
              backgroundColor: EINK.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <ScreenText style={[bold, { color: EINK.paper }]}>Open</ScreenText>
          </View>
          <ScreenText style={[bold, { color: EINK.ink, position: 'absolute', left: 0, right: 0, top: o.dont * H, textAlign: 'center' }]}>{"Don't open"}</ScreenText>
        </>
      );
    }
    case 'name':
      // Bitcoin app 2.2.1 to 2.4.1: the registered vault's name, before the review.
      return (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: P.name.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: P.name.title * H }]}>{'Spend from\nknown wallet'}</ScreenText>
          <ScreenText style={[value, { position: 'absolute', left: pad, right: pad, top: P.name.value * H, textAlign: 'center' }]}>{screen.name}</ScreenText>
        </>
      );
    case 'registered':
      // The vault approved (the device video): the outlined tick over the device's word.
      return (
        <View style={{ position: 'absolute', left: 0, right: 0, top: P.done.top * H, alignItems: 'center', gap: P.done.gap * H }}>
          <OutlinedDone size={f(T.doneDisc)} stroke={f(T.doneStroke)} ok color={EINK.ink} />
          <ScreenText style={title}>{screen.text}</ScreenText>
        </View>
      );
    case 'app-home': {
      // The app's home page where "Open app?" lands (the Gen5 video): the
      // gear in its box top right, the disc, the title, the note, "Quit app"
      // in the footer under a rule.
      const o = P.open.info;
      const h = P.home;
      const bold = { fontSize: f(T.button), lineHeight: Math.round(f(T.button) * 1.25), fontWeight: '600' as const };
      return (
        <>
          <View
            style={{
              position: 'absolute',
              right: o.right * W,
              top: o.top * H,
              width: o.w * W,
              height: o.h * H,
              borderWidth: 1,
              borderStyle: 'dotted',
              borderColor: EINK.dots,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <GearGlyph size={f(T.padGlyph)} color={EINK.ink} />
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, top: h.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: h.title * H }]}>{screen.app}</ScreenText>
          <ScreenText style={[small, { position: 'absolute', left: pad, right: pad, top: h.note * H, textAlign: 'center' }]} numberOfLines={4}>
            {screen.note}
          </ScreenText>
          <Dotted from={0} to={W} at={h.rule * H} W={W} H={H} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: h.rule * H, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <ScreenText style={[bold, { color: EINK.ink }]}>Quit app</ScreenText>
          </View>
        </>
      );
    }
    default:
      break;
  }

  const { page, index, total } = screen;
  const n = index + 1;
  switch (page.kind) {
    case 'touch-intro':
      return (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: P.intro.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: P.intro.title * H }]}>{'Review transaction\nto send bitcoin'}</ScreenText>
          <ScreenText style={[small, { position: 'absolute', left: 0, right: 0, top: P.intro.note * H, textAlign: 'center' }]}>Swipe to review</ScreenText>
          {footer(n, total)}
        </>
      );
    case 'touch-output':
      return (
        <>
          <View style={{ position: 'absolute', left: pad, right: pad * P.output.right, top: P.output.top * H }}>
            {page.account != null && (
              <>
                <ScreenText style={small}>{page.account}</ScreenText>
                <ScreenText style={[value, { marginBottom: P.output.gap * H }]}>{page.name}</ScreenText>
              </>
            )}
            <ScreenText style={small}>Amount</ScreenText>
            <ScreenText style={value}>{page.amount}</ScreenText>
            <ScreenText style={[small, { marginTop: P.output.gap * H }]}>To</ScreenText>
            <ScreenText style={[value, text(T.address)]}>{page.to}</ScreenText>
          </View>
          {footer(n, total)}
        </>
      );
    case 'touch-fees':
      return (
        <>
          <View style={{ position: 'absolute', left: pad, right: pad, top: P.fees.top * H }}>
            {page.account != null && (
              <>
                <ScreenText style={small}>{page.account}</ScreenText>
                <ScreenText style={[value, { marginBottom: P.output.gap * H }]}>{page.name}</ScreenText>
              </>
            )}
            <ScreenText style={small}>Fees</ScreenText>
            <ScreenText style={value}>{page.fee}</ScreenText>
          </View>
          {footer(n, total)}
        </>
      );
    case 'touch-sign': {
      const tile = f(T.tile);
      const s = P.sign;
      const lineH = f(T.holdLine);
      const sign = (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: s.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: s.title * H }]}>{'Sign transaction\nto send bitcoin?'}</ScreenText>
          <Dotted from={0} to={W} at={s.rule * H} W={W} H={H} />
          <View
            style={{
              position: 'absolute',
              left: pad,
              right: pad * s.right,
              top: s.rule * H,
              height: s.row * H,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
            <ScreenText style={[value, { fontSize: f(T.holdToSign) }]}>Hold to sign</ScreenText>
            <View style={{ width: tile, height: tile, borderRadius: tile * T.tileCorner, backgroundColor: EINK.ink, alignItems: 'center', justifyContent: 'center' }}>
              <TickGlyph size={tile * 0.55} color={EINK.paper} />
            </View>
          </View>
          {progress && (
            // The hold: the thin line filling along the row's top edge, a
            // scale on the native driver (the device recording), over the rule.
            <Animated.View
              style={{
                position: 'absolute',
                left: 0,
                top: s.rule * H - lineH / 2,
                width: W,
                height: lineH,
                backgroundColor: EINK.ink,
                transformOrigin: 'left',
                transform: [{ scaleX: progress.line }],
              }}
            />
          )}
          {footer(n, total)}
        </>
      );
      if (!progress) return sign;
      return (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress.page }]}>{sign}</Animated.View>
          {/* The page ghosts into "Signing transaction" as the hold completes. */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress.signing }]}>{working('Signing transaction')}</Animated.View>
        </>
      );
    }
    // Registering the vault (the Gen5 video, 2026-10-04).
    case 'touch-register-intro':
      return (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: P.intro.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: P.intro.title * H }]}>{'Review account\nto register'}</ScreenText>
          <ScreenText style={[small, { position: 'absolute', left: 0, right: 0, top: P.intro.note * H, textAlign: 'center' }]}>Swipe to review</ScreenText>
          {footer(n, total)}
        </>
      );
    case 'touch-register-keys':
      // No disc on this one (the video).
      return (
        <>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: P.register.keysTitle * H }]}>{'Review co-signer\npublic keys'}</ScreenText>
          <ScreenText style={[small, { position: 'absolute', left: 0, right: 0, top: P.intro.note * H, textAlign: 'center' }]}>Swipe to review</ScreenText>
          {footer(n, total)}
        </>
      );
    case 'touch-register-account':
      return (
        <>
          <View style={{ position: 'absolute', left: pad, right: pad, top: P.output.top * H }}>
            <ScreenText style={small}>Account name</ScreenText>
            <ScreenText style={value}>{page.name}</ScreenText>
            <ScreenText style={[small, { marginTop: P.output.gap * H }]}>Spending policy</ScreenText>
            <ScreenText style={value}>{page.policy}</ScreenText>
          </View>
          {footer(n, total)}
        </>
      );
    case 'touch-register-key':
      // One key a page: its title small, the key wrapping in the address's
      // size, as many lines as the column leaves it.
      return (
        <>
          <View style={{ position: 'absolute', left: pad, right: pad, top: P.register.keyTop * H }}>
            <ScreenText style={small}>{page.title}</ScreenText>
            <ScreenText style={[value, text(T.address)]} numberOfLines={P.register.keyLines}>
              {page.key}
            </ScreenText>
          </View>
          {footer(n, total)}
        </>
      );
    case 'touch-register-approve': {
      // "Register account?" over the dark Approve button, above the footer
      // (which has no ">" here: the button is the way on).
      const ap = P.register.approve;
      const bold = { fontSize: f(T.button), lineHeight: Math.round(f(T.button) * 1.25), fontWeight: '600' as const };
      return (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: ap.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: ap.title * H }]}>Register account?</ScreenText>
          <View
            style={{
              position: 'absolute',
              left: ap.button.x * W,
              right: ap.button.x * W,
              top: ap.button.top * H,
              height: ap.button.h * H,
              borderRadius: ap.button.r * W,
              backgroundColor: EINK.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <ScreenText style={[bold, { color: EINK.paper }]}>Approve</ScreenText>
          </View>
          {footer(n, total)}
        </>
      );
    }
    // The address check (the Gen5 video, 2026-10-04).
    case 'touch-address-intro':
      return (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: P.intro.disc * H, alignItems: 'center' }}>
            <BitcoinDisc d={f(T.disc)} />
          </View>
          <ScreenText style={[title, { position: 'absolute', left: 0, right: 0, top: P.intro.title * H }]}>{'Verify bitcoin\naddress'}</ScreenText>
          <ScreenText style={[small, { position: 'absolute', left: 0, right: 0, top: P.intro.note * H, textAlign: 'center' }]}>Swipe to continue</ScreenText>
          {footer(n, total, 'Cancel')}
        </>
      );
    case 'touch-address': {
      // "Address" over the address, "Account name" over the name (none for
      // a vault the device shows as a plain account), the QR button beside
      // the dark Confirm, "Cancel" and "<" in the footer (no ">": the
      // button is the way on).
      const ad = P.address;
      const row = einkAddressRow(W, H);
      const bold = { fontSize: f(T.button), lineHeight: Math.round(f(T.button) * 1.25), fontWeight: '600' as const };
      return (
        <>
          <View style={{ position: 'absolute', left: pad, right: pad, top: ad.top * H }}>
            <ScreenText style={small}>Address</ScreenText>
            <ScreenText style={[value, text(T.address)]} numberOfLines={ad.lines}>
              {page.address}
            </ScreenText>
          </View>
          {page.name != null && (
            <View style={{ position: 'absolute', left: pad, right: pad, top: ad.name * H }}>
              <ScreenText style={small}>Account name</ScreenText>
              <ScreenText style={value} numberOfLines={1}>
                {page.name}
              </ScreenText>
            </View>
          )}
          <View
            style={{
              position: 'absolute',
              left: row.qr.left,
              top: row.top,
              width: row.qr.side,
              height: row.qr.side,
              borderWidth: 1,
              borderStyle: 'dotted',
              borderColor: EINK.dots,
              borderRadius: P.open.button.r * W,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <QrGlyph size={row.qr.side * 0.5} color={EINK.ink} />
          </View>
          <View
            style={{
              position: 'absolute',
              left: row.confirm.left,
              width: row.confirm.w,
              top: row.top,
              height: row.h,
              borderRadius: P.open.button.r * W,
              backgroundColor: EINK.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <ScreenText style={[bold, { color: EINK.paper }]}>Confirm</ScreenText>
          </View>
          {footer(n, total, 'Cancel')}
        </>
      );
    }
    default:
      return null;
  }
}

// ─── The Nano Gen5 ───────────────────────────────────────────────────────────

/**
 * Proportions measured off six photos of a Gen5 (body 53.35 x 79.4
 * mm): a portrait card, corners about a tenth of its width; the E Ink
 * (300 x 400 px, so 3:4) starts 9% in from each side and 7% down and takes
 * 81% of the width; under it a chin of 22% of the height with the bracket
 * mark on the left and the round-cornered silver button on the right. Units
 * of the body's width.
 *
 * The side button that turns it on (decided 2026-10-04) is drawn on the right
 * edge in the upper quarter, where the Flex carries its own: the photos are
 * taken from the front and show no button on the left edge's visible upper
 * half (photo 65), so the right edge is read off the family, not off a
 * photo of the Gen5's own edge.
 */
const G5 = {
  h: 1.488,
  r: 0.095,
  screen: { x: 0.093, y: 0.072, w: 0.814, h: 1.085, r: 0.012 },
  button: { x: 0.71, y: 1.23, w: 0.23, h: 0.22, r: 0.055 },
  mark: { cx: 0.18, cy: 1.34, half: 0.062, arm: 0.036, sw: 0.011 },
  side: { y: 0.2, h: 0.17, w: 0.03, r: 0.012 },
  typeScale: 1,
} as const;

/** The pixel mascot on the Gen5's button: the scoop with its two eyes, the
 *  rim and the latticed cone, as a few squares. */
const MASCOT: ReadonlyArray<[number, number]> = [
  [1, 0], [2, 0], [3, 0],
  [0, 1], [1, 1], [2, 1], [3, 1], [4, 1],
  [0, 2], [2, 2], [4, 2],
  [0, 3], [1, 3], [2, 3], [3, 3], [4, 3],
  [0, 4], [2, 4], [4, 4],
  [1, 5], [3, 5],
  [1, 6], [2, 6], [3, 6],
  [2, 7],
  [2, 8],
];

export function gen5Height(width: number): number {
  return G5.h * width;
}

/** The drawing's box: the body plus the side button standing out of its right edge. */
export function gen5Size(width: number): { w: number; h: number } {
  return { w: width + G5.side.w * width, h: G5.h * width };
}

export function Gen5Art({ width, screen, lit, progress }: TouchArtProps): React.JSX.Element {
  const u = width;
  const h = G5.h * u;
  const s = G5.screen;
  const b = G5.button;
  const m = G5.mark;
  const W = s.w * u;
  const H = s.h * u;
  const inset = 0.012 * u;
  const side = G5.side.w * u;
  // Nine rows of pixels at about two thirds of the button's height, centred on it.
  const p = (b.h / 13) * u;
  const mx = (b.x + (b.w - 5 * (b.h / 13)) / 2) * u;
  const my = (b.y + (b.h - 9 * (b.h / 13)) / 2) * u;
  return (
    <View style={{ width: width + side, height: h }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width + side} height={h}>
        <Defs>
          <LinearGradient id="g5body" x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={GEN5.body[0]} />
            <Stop offset="1" stopColor={GEN5.body[1]} />
          </LinearGradient>
          <LinearGradient id="g5sheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SHEEN} stopOpacity={GEN5.sheen[0]} />
            <Stop offset="0.35" stopColor={SHEEN} stopOpacity={GEN5.sheen[1]} />
            <Stop offset="1" stopColor={SHEEN} stopOpacity={GEN5.sheen[2]} />
          </LinearGradient>
          <LinearGradient id="g5silver" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={GEN5.silver[0]} />
            <Stop offset="1" stopColor={GEN5.silver[1]} />
          </LinearGradient>
        </Defs>
        {/* The side button first, so the body's edge sits over its root; the
            body's own finish, with the lip's sheen on its outer edge. */}
        <Rect x={u - 0.01 * u} y={G5.side.y * u} width={side + 0.01 * u} height={G5.side.h * u} rx={G5.side.r * u} fill="url(#g5body)" stroke="url(#g5sheen)" strokeWidth={inset / 2} />
        {/* The body and its glossy lip. */}
        <Rect x={0} y={0} width={u} height={h} rx={G5.r * u} fill="url(#g5body)" />
        <Rect x={inset / 2} y={inset / 2} width={u - inset} height={h - inset} rx={G5.r * u - inset / 2} fill="none" stroke="url(#g5sheen)" strokeWidth={inset} />
        {/* The screen: a dark seam, then the E Ink. */}
        <Rect x={(s.x - 0.01) * u} y={(s.y - 0.01) * u} width={(s.w + 0.02) * u} height={(s.h + 0.02) * u} rx={(s.r + 0.01) * u} fill={GEN5.seam} />
        <Rect x={s.x * u} y={s.y * u} width={W} height={H} rx={s.r * u} fill={EINK.paper} />
        {/* The bracket mark and the button on the chin. */}
        <Path d={bracketMarkPath(m, u)} stroke={SHEEN} strokeOpacity={GEN5.markStrength} strokeWidth={m.sw * u} fill="none" strokeLinecap="square" />
        <Rect x={b.x * u} y={b.y * u} width={b.w * u} height={b.h * u} rx={b.r * u} fill="url(#g5silver)" stroke={GEN5.silverEdge} strokeWidth={0.5} />
        {MASCOT.map(([cx, cy], i) => (
          <Rect key={i} x={mx + cx * p} y={my + cy * p} width={p * 0.92} height={p * 0.92} fill={GEN5.pixel} />
        ))}
        {lit && <LitOutline w={u} h={h} r={G5.r * u} />}
      </Svg>
      <View style={{ position: 'absolute', left: s.x * u, top: s.y * u, width: W, height: H, overflow: 'hidden' }}>
        <EinkScreen W={W} H={H} screen={screen} typeScale={G5.typeScale} progress={progress} />
      </View>
    </View>
  );
}

// ─── The Ledger Flex ─────────────────────────────────────────────────────────

/**
 * Proportions read off Ledger's render and the published size (56.5 x 78.4
 * mm): a portrait graphite card, corners about a tenth of the width; the E
 * Ink (480 x 600 px, 4:5) inside a thin black bezel, 6% in from each side and
 * 7% down; the bottom 14% of the body is the copper chin carrying the
 * bracket mark; the orange side button on the right edge in the upper third.
 */
const FX = {
  h: 1.388,
  r: 0.09,
  screen: { x: 0.06, y: 0.075, w: 0.88, h: 1.1, r: 0.018 },
  chin: { y: 1.19 },
  mark: { cx: 0.13, cy: 1.29, half: 0.048, arm: 0.028, sw: 0.009 },
  side: { y: 0.2, h: 0.15, w: 0.034, r: 0.012 },
  typeScale: 0.9,
} as const;

export function flexSize(width: number): { w: number; h: number } {
  return { w: width + FX.side.w * width, h: FX.h * width };
}

export function FlexArt({ width, screen, lit, progress }: TouchArtProps): React.JSX.Element {
  const u = width;
  const h = FX.h * u;
  const s = FX.screen;
  const m = FX.mark;
  const W = s.w * u;
  const H = s.h * u;
  const inset = 0.012 * u;
  const side = FX.side.w * u;
  return (
    <View style={{ width: width + side, height: h }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width + side} height={h}>
        <Defs>
          <LinearGradient id="fxbody" x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={FLEX.body[0]} />
            <Stop offset="1" stopColor={FLEX.body[1]} />
          </LinearGradient>
          <LinearGradient id="fxsheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SHEEN} stopOpacity={FLEX.sheen[0]} />
            <Stop offset="0.4" stopColor={SHEEN} stopOpacity={FLEX.sheen[1]} />
            <Stop offset="1" stopColor={SHEEN} stopOpacity={FLEX.sheen[2]} />
          </LinearGradient>
          <LinearGradient id="fxorange" x1="0" y1="0" x2="0.3" y2="1">
            <Stop offset="0" stopColor={FLEX.orange[0]} />
            <Stop offset="1" stopColor={FLEX.orange[1]} />
          </LinearGradient>
        </Defs>
        {/* The side button first, so the body's edge sits over its root. */}
        <Rect x={u - 0.01 * u} y={FX.side.y * u} width={side + 0.01 * u} height={FX.side.h * u} rx={FX.side.r * u} fill="url(#fxorange)" />
        <Rect x={0} y={0} width={u} height={h} rx={FX.r * u} fill="url(#fxbody)" />
        {/* The copper chin: the body's own bottom corners, squared at its top. */}
        <Rect x={0} y={FX.chin.y * u} width={u} height={h - FX.chin.y * u} rx={FX.r * u} fill="url(#fxorange)" />
        <Rect x={0} y={FX.chin.y * u} width={u} height={0.1 * u} fill="url(#fxorange)" />
        <Path d={`M0 ${FX.chin.y * u} H${u}`} stroke={SHEEN} strokeOpacity={FLEX.chinEdgeStrength} strokeWidth={1} />
        <Rect x={inset / 2} y={inset / 2} width={u - inset} height={h - inset} rx={FX.r * u - inset / 2} fill="none" stroke="url(#fxsheen)" strokeWidth={inset} />
        {/* The bezel, then the E Ink. */}
        <Rect x={(s.x - 0.018) * u} y={(s.y - 0.018) * u} width={(s.w + 0.036) * u} height={(s.h + 0.036) * u} rx={(s.r + 0.018) * u} fill={FLEX.bezel} />
        <Rect x={s.x * u} y={s.y * u} width={W} height={H} rx={s.r * u} fill={EINK.paper} />
        <Path d={bracketMarkPath(m, u)} stroke={FLEX.markInk} strokeWidth={m.sw * u} fill="none" strokeLinecap="square" />
        {lit && <LitOutline w={u} h={h} r={FX.r * u} />}
      </Svg>
      <View style={{ position: 'absolute', left: s.x * u, top: s.y * u, width: W, height: H, overflow: 'hidden' }}>
        <EinkScreen W={W} H={H} screen={screen} typeScale={FX.typeScale} progress={progress} />
      </View>
    </View>
  );
}

// ─── The Ledger Stax ─────────────────────────────────────────────────────────

/**
 * Proportions read off Ledger's render and the published size (85 x 54 x 6
 * mm, a credit card): a portrait card in a dark green-black frame, corners
 * 8% of the width; the 3.7" E Ink (400 x 672 px) fills the face almost edge
 * to edge inside a slim bezel and wraps round the right edge, which straight
 * on reads as a thin shaded strip; the slim side button on the right edge.
 */
const SX = {
  h: 1.574,
  r: 0.08,
  screen: { x: 0.035, y: 0.045, w: 0.86, h: 1.46, r: 0.05 },
  spine: { x: 0.895, w: 0.075 },
  side: { y: 0.16, h: 0.24, w: 0.024, r: 0.01 },
  typeScale: 0.95,
} as const;

export function staxSize(width: number): { w: number; h: number } {
  return { w: width + SX.side.w * width, h: SX.h * width };
}

export function StaxArt({ width, screen, lit, progress }: TouchArtProps): React.JSX.Element {
  const u = width;
  const h = SX.h * u;
  const s = SX.screen;
  const W = s.w * u;
  const H = s.h * u;
  const side = SX.side.w * u;
  const inset = 0.01 * u;
  return (
    <View style={{ width: width + side, height: h }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width + side} height={h}>
        <Defs>
          <LinearGradient id="sxframe" x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={STAX.frame[0]} />
            <Stop offset="1" stopColor={STAX.frame[1]} />
          </LinearGradient>
          <LinearGradient id="sxsheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SHEEN} stopOpacity={STAX.sheen[0]} />
            <Stop offset="0.5" stopColor={SHEEN} stopOpacity={STAX.sheen[1]} />
            <Stop offset="1" stopColor={SHEEN} stopOpacity={STAX.sheen[2]} />
          </LinearGradient>
          {/* The spine: the E Ink curving away, darker toward the edge. */}
          <LinearGradient id="sxspine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={EINK.paper} />
            <Stop offset="0.55" stopColor={STAX.spine[0]} />
            <Stop offset="1" stopColor={STAX.spine[1]} />
          </LinearGradient>
          <LinearGradient id="sxbutton" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={STAX.button[0]} />
            <Stop offset="1" stopColor={STAX.button[1]} />
          </LinearGradient>
        </Defs>
        <Rect x={u - 0.01 * u} y={SX.side.y * u} width={side + 0.01 * u} height={SX.side.h * u} rx={SX.side.r * u} fill="url(#sxbutton)" />
        <Rect x={0} y={0} width={u} height={h} rx={SX.r * u} fill="url(#sxframe)" />
        <Rect x={inset / 2} y={inset / 2} width={u - inset} height={h - inset} rx={SX.r * u - inset / 2} fill="none" stroke="url(#sxsheen)" strokeWidth={inset} />
        {/* The bezel, the flat E Ink, then the curved strip beside it. */}
        <Rect
          x={(s.x - 0.012) * u}
          y={(s.y - 0.012) * u}
          width={(SX.spine.x + SX.spine.w - s.x + 0.024) * u}
          height={(s.h + 0.024) * u}
          rx={(s.r + 0.012) * u}
          fill={STAX.bezel}
        />
        <Rect x={s.x * u} y={s.y * u} width={W + 0.02 * u} height={H} rx={s.r * u} fill={EINK.paper} />
        <Rect x={SX.spine.x * u} y={s.y * u} width={SX.spine.w * u} height={H} rx={0.02 * u} fill="url(#sxspine)" />
        <Rect x={SX.spine.x * u} y={s.y * u} width={0.012 * u} height={H} fill={EINK.paper} />
        {lit && <LitOutline w={u} h={h} r={SX.r * u} />}
      </Svg>
      <View style={{ position: 'absolute', left: s.x * u, top: s.y * u, width: W, height: H, overflow: 'hidden' }}>
        <EinkScreen W={W} H={H} screen={screen} typeScale={SX.typeScale} progress={progress} />
      </View>
    </View>
  );
}

// ─── Where the client touches (the press hint's anchors) ─────────────────────

function touchAnchors(width: number, sc: { x: number; y: number; w: number; h: number }, typeScale: number, sb: SideButton): TouchAnchors {
  const u = width;
  const x = sc.x * u;
  const y = sc.y * u;
  const W = sc.w * u;
  const H = sc.h * u;
  const a = einkAnchors(W, H, typeScale);
  const band = einkPinBand(W, H);
  const at = (c: ControlSpot): ControlSpot => ({ ...c, x: x + c.x, y: y + c.y });
  // The side button: the part standing out of the body's right edge, as a
  // wide control (its ring and its fill follow its rounded rectangle).
  const side: ControlSpot = { x: u + (sb.w * u) / 2, y: (sb.y + sb.h / 2) * u, r: (sb.w * u) / 2, w: sb.w * u, h: sb.h * u, corner: sb.r * u };
  return { next: at(a.next), tile: at(a.tile), open: at(a.open), approve: at(a.approve), confirm: at(a.confirm), pin: a.pin.map(at), side, band: { top: y + band.top, bottom: y + band.bottom }, screen: { x, y, w: W, h: H } };
}

export function gen5Anchors(width: number): TouchAnchors {
  return touchAnchors(width, G5.screen, G5.typeScale, G5.side);
}

export function flexAnchors(width: number): TouchAnchors {
  return touchAnchors(width, FX.screen, FX.typeScale, FX.side);
}

export function staxAnchors(width: number): TouchAnchors {
  return touchAnchors(width, SX.screen, SX.typeScale, SX.side);
}
