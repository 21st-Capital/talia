/**
 * A Ledger whose model the app does not know, drawn as a plain slab in the
 * app's own line style (design A "The courier", decided 2026-10-03): a body, a
 * pale screen, and on it only the words every Ledger model shows at that
 * moment. No product colours, so everything here is a theme token; the gesture
 * line beside it speaks for all models ("Move through the pages on the
 * Ledger. Approve on the last page.").
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { CrossGlyph, ScreenText, Spinning, TickGlyph } from './DeviceArtParts';
import { isAddressPage, isRegistrationPage } from '../hww/signingDevice';
import type { DeviceScreen } from '../hww/signingDevice';

/** A landscape card, 4:3 screen, in its own 160 x 108 box. */
const SLAB = {
  vb: [160, 108] as const,
  body: { x: 4, y: 4, w: 152, h: 100, r: 14 },
  screen: { x: 16, y: 12, w: 112, h: 84, r: 4 },
};

export function slabHeight(width: number): number {
  return (SLAB.vb[1] / SLAB.vb[0]) * width;
}

/** The words, full and (for a screen too small to hold them) short. */
function wordsFor(screen: DeviceScreen, short: boolean): string {
  switch (screen.kind) {
    case 'loading':
      return short ? 'Loading…' : 'Loading transaction';
    case 'signing':
      return short ? 'Signing…' : 'Signing transaction';
    case 'signed':
      return short ? 'Signed' : 'Transaction signed';
    case 'rejected':
      return short ? 'Rejected' : 'Transaction rejected';
    case 'name':
      return short ? 'Known wallet' : 'Spend from\nknown wallet';
    case 'review':
      if (isRegistrationPage(screen.page)) return short ? 'Review\naccount' : 'Review account\nto register';
      if (isAddressPage(screen.page)) return short ? 'Verify\naddress' : 'Verify bitcoin\naddress';
      return short ? 'Review\ntransaction' : 'Review transaction\nto send bitcoin';
    case 'pin':
      return 'Enter PIN';
    case 'open-app':
      return short ? 'Open app' : `Open app\n${screen.app}`;
    case 'registered':
      return screen.text;
    case 'app-home':
      return screen.app;
    default:
      return '';
  }
}

export function LedgerSlabArt({ width, screen, lit }: { width: number; screen: DeviceScreen; lit: boolean }): React.JSX.Element {
  const s = width / SLAB.vb[0];
  const h = SLAB.vb[1] * s;
  const stroke = lit ? theme.colors.accent : theme.colors.hairline;
  const sw = 1.5 / s;
  const g = SLAB.screen;
  const scr = { left: g.x * s, top: g.y * s, width: g.w * s, height: g.h * s };
  // A screen too small for the whole sentence shows its short form, and the
  // type never grows past what the screen's width can hold whole.
  const small = scr.height < 30 || scr.width < 72;
  const fs = Math.max(7, Math.min(12, scr.height * 0.13, scr.width / 7));
  const working = screen.kind === 'loading' || screen.kind === 'signing';
  const ink = theme.colors.inkOnPaper;
  const glyph = Math.min(16, scr.height * 0.22);
  return (
    <View style={{ width, height: h }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={h} viewBox={`0 0 ${SLAB.vb[0]} ${SLAB.vb[1]}`}>
        <Rect x={SLAB.body.x} y={SLAB.body.y} width={SLAB.body.w} height={SLAB.body.h} rx={SLAB.body.r} fill={theme.colors.surfaceRaised} stroke={stroke} strokeWidth={sw} />
        <Rect x={g.x} y={g.y} width={g.w} height={g.h} rx={g.r} fill={theme.colors.paper} />
      </Svg>
      <View style={[styles.screen, scr]}>
        {working && scr.height >= 36 && (
          <Spinning size={Math.min(22, scr.height * 0.32)} ms={1000}>
            <Svg width={Math.min(22, scr.height * 0.32)} height={Math.min(22, scr.height * 0.32)} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={9} stroke={ink} strokeWidth={2.4} fill="none" strokeDasharray="42 56" strokeLinecap="round" />
            </Svg>
          </Spinning>
        )}
        <ScreenText style={[styles.words, { fontSize: fs, lineHeight: Math.round(fs * 1.25), color: ink }]}>{wordsFor(screen, small)}</ScreenText>
        {screen.kind === 'name' && !small && (
          <ScreenText style={[styles.words, { fontSize: fs, lineHeight: Math.round(fs * 1.25), color: ink }]}>{screen.name}</ScreenText>
        )}
        {(screen.kind === 'signed' || screen.kind === 'registered') && !small && <TickGlyph size={glyph} color={ink} strokeWidth={2.4} />}
        {screen.kind === 'rejected' && !small && <CrossGlyph size={glyph} color={ink} strokeWidth={2.4} />}
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    screen: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
    // The device's own type, not the brand's: a picture of another screen.
    words: { textAlign: 'center', fontWeight: '600', fontFamily: 'System' },
  }),
);
