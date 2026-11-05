/**
 * Marks for the products a vault can come from (decided 2026-09-08: "try to use
 * logos of each provider"). Drawn in-app with react-native-svg, traced from
 * the logo images supplied (Ledger, BitBox, BlueWallet, Foundation,
 * Electrum 2026-09-08; Liana 2026-09-09; Sparrow is a bird of our own), the way the exchange marks were: no image asset
 * ships and the tile reads at any size.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { brand, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import type { ImportProvider } from '../screens/importProviders';

/**
 * Ledger: four corner brackets around an L, white on black (the supplied image, a
 * 1526 square). The brackets are INSET (decided 2026-09-09: "needs a bit more
 * space around its edges with the black background just like on the
 * attached example"): the reference leaves about a sixth of the tile as
 * black on each side, and the tile's own rounded corners eat the rest, so
 * the group is scaled about the centre rather than the paths redrawn.
 */
function LedgerMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 1526 1526">
      <Rect width="1526" height="1526" fill="#000000" />
      <G transform="translate(759 759) scale(0.72) translate(-759 -759)">
        <Path d="M63 153H588v79H142v263H63z" fill="#FFFFFF" />
        <Path d="M932 153h523v342h-79V232H932z" fill="#FFFFFF" />
        <Path d="M63 1020h79v265h446v79H63z" fill="#FFFFFF" />
        <Path d="M1376 1020h79v344H932v-79h444z" fill="#FFFFFF" />
        <Path d="M588 495h77v458h267v67H588z" fill="#FFFFFF" />
      </G>
    </Svg>
  );
}

/**
 * BitBox: two upright panels and the base of the box, the BitBox02 mark
 * (the supplied image, a 280 square). Inset like the Ledger one (decided 2026-09-09):
 * the reference leaves about a quarter of the tile as background on each
 * side, so the group is scaled about its own centre and the paths are
 * untouched. The ground is the charcoal of that image, not pure black.
 */
function BitboxMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 280 280">
      <Rect width="280" height="280" fill="#1C1C1C" />
      <G transform="translate(140 142) scale(0.62) translate(-140 -142)">
        <Polygon points="128,15 80,35 80,128 33,148 33,208 128,163" fill="#FFFFFF" />
        <Polygon points="152,15 200,35 200,128 247,148 247,208 152,163" fill="#FFFFFF" />
        <Polygon points="140,185 235,228 140,270 45,228" fill="#FFFFFF" />
      </G>
    </Svg>
  );
}

/**
 * Foundation (the Passport's maker): a copper disc cut by a dark triangle
 * into three petals (the supplied image, a 400 square). Inset like the Ledger and
 * BitBox tiles (decided 2026-09-09: "a bit more space on the foundation
 * passport logo as well"): the reference leaves about a tenth of the tile
 * clear around the disc, and its ground is a blue-grey charcoal.
 */
function FoundationMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 400 400">
      <Defs>
        <LinearGradient id="copper" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F3BFA4" />
          <Stop offset="0.55" stopColor="#D9927A" />
          <Stop offset="1" stopColor="#B86A52" />
        </LinearGradient>
      </Defs>
      <Rect width="400" height="400" fill="#202228" />
      <G transform="translate(200 200) scale(0.94) translate(-200 -200)">
        <Circle cx="200" cy="200" r="168" fill="url(#copper)" />
        <Polygon
          points="200,32 58,272 342,272"
          fill="#202228"
          stroke="#202228"
          strokeWidth="18"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
}

/**
 * Sparrow: a low-poly bird of our own drawing on a white tile (decided
 * 2026-11-05: no third-party image file ships whose licence is not known).
 * Flat polygons in greys with an orange eye, so the tile reads as the bird
 * Sparrow's users know without copying its artwork.
 */
function SparrowMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect width="100" height="100" fill="#FFFFFF" />
      <Polygon points="20,16 52,40 40,50" fill="#4B5563" />
      <Polygon points="10,32 48,48 34,58" fill="#6B7280" />
      <Polygon points="38,50 52,40 60,38 64,48 58,64" fill="#9CA3AF" />
      <Polygon points="34,58 40,50 58,64 44,68" fill="#4B5563" />
      <Polygon points="60,38 70,33 78,38 76,46 64,48" fill="#374151" />
      <Polygon points="64,48 76,46 66,60 58,64" fill="#D1D5DB" />
      <Polygon points="77,39 88,43 76,45" fill="#1F2937" />
      <Polygon points="44,68 30,88 40,90 52,68" fill="#6B7280" />
      <Circle cx="71.5" cy="39" r="1.7" fill="#F97316" />
    </Svg>
  );
}

/**
 * BlueWallet: three stacked blues with the word "blue" (the supplied image, a
 * 447 square).
 */
function BlueWalletMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 447 447">
      <Rect width="447" height="447" fill="#1B4B9F" />
      <Rect x="0" y="100" width="447" height="420" rx="100" fill="#4A7FDA" />
      <Rect x="0" y="210" width="447" height="420" rx="100" fill="#8BD3F5" />
      <SvgText x="405" y="355" fill="#FFFFFF" fontSize="72" fontWeight="bold" textAnchor="end">
        blue
      </SvgText>
    </Svg>
  );
}

/**
 * Liana: their app icon, measured off the 600px original supplied
 * (2026-09-09, second pass). The big shape has a STRAIGHT right edge, a
 * wide rounded top left, the bottom right swept away, and a square corner
 * at the bottom left; the small leaf beside its foot is a symmetric leaf
 * tilted the same way.
 */
function LianaMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 600 600">
      <Rect width="600" height="600" fill="#1C1C1C" />
      <Path d="M311 30v370a160 160 0 0 1-160 160h-36V225A195 195 0 0 1 311 30z" fill="#00E96B" />
      <Path d="M311 556a196 196 0 0 1 196-196 196 196 0 0 1-196 196z" fill="#00E96B" />
    </Svg>
  );
}

/**
 * Electrum: three blue orbits around a Bitcoin B on a dark disc (the supplied
 * image, a 512 square).
 */
function ElectrumMark({ size }: { size: number }): React.JSX.Element {
  const orbit = (rotate: number) => (
    <Path
      key={rotate}
      d="M31 256a225 95 0 1 0 450 0a225 95 0 1 0 -450 0"
      fill="none"
      stroke="url(#electrumBlue)"
      strokeWidth="26"
      transform={`rotate(${rotate} 256 256)`}
    />
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="electrumBlue" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1E88F0" />
          <Stop offset="1" stopColor="#0B5FCB" />
        </LinearGradient>
        <LinearGradient id="electrumDisc" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2A2A2A" />
          <Stop offset="1" stopColor="#0A0A0A" />
        </LinearGradient>
      </Defs>
      <Rect width="512" height="512" fill="#0A0A0A" />
      <Circle cx="256" cy="256" r="256" fill="url(#electrumDisc)" />
      {[0, 60, -60].map(orbit)}
      <SvgText x="256" y="318" fill="#1E88F0" fontSize="176" fontWeight="bold" textAnchor="middle">
        B
      </SvgText>
      <Rect x="232" y="176" width="14" height="30" fill="#1E88F0" />
      <Rect x="262" y="176" width="14" height="30" fill="#1E88F0" />
      <Rect x="232" y="312" width="14" height="30" fill="#1E88F0" />
      <Rect x="262" y="312" width="14" height="30" fill="#1E88F0" />
    </Svg>
  );
}

/**
 * Talia: the knot on the brand green. NOT the shared badge component: that
 * one paints its ground in `theme.colors.surface`, which is exactly the
 * provider card's own colour, so the tile vanished into the card while the
 * six others read as coloured squares (decided 2026-09-08). Brand constants,
 * not theme tokens, for the same reason as every other mark here.
 */
function TaliaMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Rect width="120" height="120" fill={brand.green} />
      <Path d="M31 44 h50" stroke={brand.offWhite} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Path d="M54 22 v56 a17 17 0 1 0 17 -17" stroke={brand.offWhite} strokeWidth={10} strokeLinecap="round" fill="none" />
      <Circle cx={93} cy={44} r={6} fill={brand.gold} />
    </Svg>
  );
}


/**
 * Other: no brand to borrow, so Talia's own green with the import sign, a
 * tray in cream and the arrow coming in, in the app's lime (decided 2026-09-21,
 * "Import, arrow into a tray", replacing the magnifier of 2026-09-09, which
 * read as a search). Brand constants, not theme tokens: the tile paints its
 * own ground like every other mark here.
 */
function OtherMark({ size }: { size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Rect width="48" height="48" fill={brand.green} />
      <Path
        d="M12 28v4.5a3.5 3.5 0 0 0 3.5 3.5h17a3.5 3.5 0 0 0 3.5-3.5V28"
        fill="none"
        stroke={brand.offWhite}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M24 11v17M18 22.5l6 6l6-6"
        fill="none"
        stroke="#9FE870"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ProviderTile({ provider, size = 52 }: { provider: ImportProvider; size?: number }): React.JSX.Element {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.22 }]}>
      {provider === 'ledger' && <LedgerMark size={size} />}
      {provider === 'bitbox' && <BitboxMark size={size} />}
      {provider === 'passport' && <FoundationMark size={size} />}
      {provider === 'sparrow' && <SparrowMark size={size} />}
      {provider === 'bluewallet' && <BlueWalletMark size={size} />}
      {provider === 'liana' && <LianaMark size={size} />}
      {provider === 'electrum' && <ElectrumMark size={size} />}
      {provider === 'other' && <OtherMark size={size} />}
      {provider === 'talia' && <TaliaMark size={size} />}
      {/* On top, not first: each mark paints an opaque ground that would hide
          it. A light bloom, never the brand green, over another company's logo. */}
      <Gloss size={size} radius={size * 0.22} glow="light" />
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  }),
);
