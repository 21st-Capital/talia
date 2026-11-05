/**
 * Thin-line icons picked from the Tabler outline set (MIT, v3.44):
 * headset (Support tab), menu-2 (Settings tab), broadcast / currency-bitcoin /
 * fingerprint (Settings rows). Rendered via react-native-svg — no icon-font
 * native dependency.
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../theme';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function makeIcon(paths: string[]): (props: IconProps) => React.JSX.Element {
  return function TablerIcon({
    size = 24,
    color = theme.colors.offWhite,
    strokeWidth = 2,
  }: IconProps): React.JSX.Element {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {paths.map((d, i) => (
          <Path
            key={i}
            d={d}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </Svg>
    );
  };
}

export const HeadsetIcon = makeIcon([
  'M4 14v-3a8 8 0 1 1 16 0v3',
  'M18 19c0 1.657 -2.686 3 -6 3',
  'M4 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3',
  'M15 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3',
]);

export const MenuIcon = makeIcon(['M4 6l16 0', 'M4 12l16 0', 'M4 18l16 0']);

/** Tabler "dots" — the ⋯ of a page menu, drawn so it centres exactly in a
 *  round button (the text glyph sat above the middle, found 2026-09-14). */
export const DotsIcon = makeIcon([
  'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
]);

/** Tabler "logout" — the door-and-arrow for signing out. */
export const LogoutIcon = makeIcon([
  'M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2',
  'M9 12h12l-3 -3',
  'M18 15l3 -3',
]);

/** Tabler "parachute" — picked for Rescue (decided 2026-09-14), over the lifebuoy. */
export const ParachuteIcon = makeIcon([
  'M22 12a10 10 0 1 0 -20 0',
  'M22 12c0 -1.66 -1.46 -3 -3.25 -3c-1.79 0 -3.25 1.34 -3.25 3c0 -1.66 -1.57 -3 -3.5 -3c-1.93 0 -3.5 1.34 -3.5 3c0 -1.66 -1.46 -3 -3.25 -3c-1.79 0 -3.25 1.34 -3.25 3',
  'M2 12l10 10l-3.5 -10',
  'M15.5 12l-3.5 10l10 -10',
]);

/**
 * A dial with a limit mark, for Co-signing limits (decided 2026-09-21, option D of
 * four). Drawn in Tabler's own grammar on its "brand-speedtest" arc: the open
 * dial, a short mark at the top right where the limit sits, and the needle
 * resting below it on a small hub. The row is about a ceiling, not speed.
 */
export const LimitGaugeIcon = makeIcon([
  'M5.636 19.364a9 9 0 1 1 12.728 0',
  'M18.364 5.636l-2.12 2.12',
  'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  'M11.66 11.06l-1.54 -4.23',
]);

/**
 * Tabler "stethoscope", for Settings > Diagnostics (the wallet engine, the
 * connection test, the report; decided 2026-10-16). Its own mark: the gauge
 * above means Co-signing limits, and one icon means one thing.
 */
export const StethoscopeIcon = makeIcon([
  'M6 4h-1a2 2 0 0 0 -2 2v3.5h0a5.5 5.5 0 0 0 11 0v-3.5a2 2 0 0 0 -2 -2h-1',
  'M8 15a6 6 0 1 0 12 0v-3',
  'M11 3v2',
  'M6 3v2',
  'M20 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
]);

/** Tabler "lifebuoy" — the life-guard ring, kept for anything else that needs it. */
export const LifebuoyIcon = makeIcon([
  'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
  'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  'M15 15l3.35 3.35',
  'M9 15l-3.35 3.35',
  'M14.65 9l3.35 -3.35',
  'M9.35 9l-3.35 -3.35',
]);

export const UserIcon = makeIcon([
  'M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0',
  'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
]);

export const TrashIcon = makeIcon([
  'M4 7l16 0',
  'M10 11l0 6',
  'M14 11l0 6',
  'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
  'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
]);

export const BroadcastIcon = makeIcon([
  'M18.364 19.364a9 9 0 1 0 -12.728 0',
  'M15.536 16.536a5 5 0 1 0 -7.072 0',
  'M11 13a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
]);

/** Tabler `download`: bringing an existing vault in (decided 2026-09-14). */
export const DownloadIcon = makeIcon([
  'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2',
  'M7 11l5 5l5 -5',
  'M12 4l0 12',
]);

/** Tabler `settings`: the gear on the General row (decided 2026-09-14). */
export const SettingsGearIcon = makeIcon([
  'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z',
  'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
]);

export const CurrencyBitcoinIcon = makeIcon([
  'M6 6h8a3 3 0 0 1 0 6a3 3 0 0 1 0 6h-8',
  'M8 6l0 12',
  'M8 12l6 0',
  'M9 3l0 3',
  'M13 3l0 3',
  'M9 18l0 3',
  'M13 18l0 3',
]);

export const FingerprintIcon = makeIcon([
  'M18.9 7a8 8 0 0 1 1.1 5v1a6 6 0 0 0 .8 3',
  'M8 11a4 4 0 0 1 8 0v1a10 10 0 0 0 2 6',
  'M12 11v2a14 14 0 0 0 2.5 8',
  'M8 15a18 18 0 0 0 1.8 6',
  'M4.9 19a22 22 0 0 1 -.9 -7v-1a8 8 0 0 1 12 -6.95',
]);

export const FaceIdIcon = makeIcon([
  'M4 8v-2a2 2 0 0 1 2 -2h2',
  'M4 16v2a2 2 0 0 0 2 2h2',
  'M16 4h2a2 2 0 0 1 2 2v2',
  'M16 20h2a2 2 0 0 0 2 -2v-2',
  'M9 10l.01 0',
  'M15 10l.01 0',
  'M9.5 15a3.5 3.5 0 0 0 5 0',
]);

export const ScanIcon = makeIcon([
  'M5 12h14',
  'M3 7v-2a2 2 0 0 1 2 -2h2',
  'M3 17v2a2 2 0 0 0 2 2h2',
  'M17 3h2a2 2 0 0 1 2 2v2',
  'M17 21h2a2 2 0 0 0 2 -2v-2',
]);

export const WorldIcon = makeIcon([
  'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
  'M3.6 9h16.8',
  'M3.6 15h16.8',
  'M11.5 3a17 17 0 0 0 0 18',
  'M12.5 3a17 17 0 0 1 0 18',
]);

export const XIcon = makeIcon([
  'M4 4l11.733 16h4.267l-11.733 -16l-4.267 0',
  'M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772',
]);

export const InstagramIcon = makeIcon([
  'M4 8a4 4 0 0 1 4 -4h8a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4l0 -8',
  'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  'M16.5 7.5v.01',
]);

export const TelegramOutlineIcon = makeIcon([
  'M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4',
]);

export const MessageCircleIcon = makeIcon([
  'M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1',
]);

export const PhoneIcon = makeIcon([
  'M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2',
]);

export const BellIcon = makeIcon([
  'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6',
  'M9 17v1a3 3 0 0 0 6 0v-1',
]);

export const ClockIcon = makeIcon([
  'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
  'M12 7v5l3 3',
]);

/** Row-navigation chevron (Tabler chevron-right) — replaces the tiny '›'
 *  font glyph on tappable rows app-wide (decided 2026-07-18). */
export const ChevronRightIcon = makeIcon(['M9 6l6 6l-6 6']);

/** Back chevron (Tabler chevron-left) — THE header back icon (decided
 *  2026-07-18: bold rounded stroke, not the font glyph). */
export const ChevronLeftIcon = makeIcon(['M15 6l-6 6l6 6']);

/** Circular-arrow refresh (drawn to a reference, 2026-07-18): near-full circle,
 *  arrowhead at the top-left. Used for "fresh address" style actions. */
export const RefreshIcon = makeIcon(['M4.05 13a8 8 0 1 0 .5 -4', 'M4.55 4v5h5']);

/** Copy (Tabler copy) — tap-to-copy affordance next to txids etc. */
export const CopyIcon = makeIcon([
  'M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z',
  'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
]);

/** Clipboard (Tabler clipboard) — the Paste button on the import field. */
export const ClipboardIcon = makeIcon([
  'M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2',
  'M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z',
]);

/** Photo (Tabler photo) — the scanner's "from a picture" button. */
export const PhotoIcon = makeIcon([
  'M15 8h.01',
  'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z',
  'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5',
  'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
]);

/** Keyboard (Tabler keyboard) — the scanner's "type or paste the address"
 *  button (address verification by text, decided 2026-09-12). */
export const KeyboardIcon = makeIcon([
  'M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z',
  'M6 10l0 .01',
  'M10 10l0 .01',
  'M14 10l0 .01',
  'M18 10l0 .01',
  'M6 14l0 .01',
  'M18 14l0 .01',
  'M10 14l4 .01',
]);

/** Share (Tabler share-2 style) — system share sheet trigger. */
export const ShareIcon = makeIcon([
  'M6 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  'M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  'M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  'M8.7 10.7l6.6 -3.4',
  'M8.7 13.3l6.6 3.4',
]);

/** Tabler "coins" — the Virtual Vaults tab (same glyph as the wallet icon). */
export const CoinsIcon = makeIcon([
  'M9 14c0 1.657 2.686 3 6 3s6 -1.343 6 -3s-2.686 -3 -6 -3s-6 1.343 -6 3',
  'M9 14v4c0 1.656 2.686 3 6 3s6 -1.344 6 -3v-4',
  'M3 6c0 1.072 1.144 2.062 3 2.598s4.144 .536 6 0c1.856 -.536 3 -1.526 3 -2.598c0 -1.072 -1.144 -2.062 -3 -2.598s-4.144 -.536 -6 0c-1.856 .536 -3 1.526 -3 2.598',
  'M3 6v10c0 .888 .772 1.45 2 2',
  'M3 11c0 .888 .772 1.45 2 2',
]);

/** Tabler "report-analytics" — the Portfolio tab: a clipboard with bars,
 *  the chosen one from a board of 24 (2026-09-02). Replaced "trending-up", which
 *  was turned down. */
export const ReportAnalyticsIcon = makeIcon([
  'M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2',
  'M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2',
  'M9 17v-5',
  'M12 17v-1',
  'M15 17v-3',
]);

/** Tabler "pencil" — rename-in-place (virtual vault header, decided 2026-08-25). */
export const PencilIcon = makeIcon([
  'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4',
  'M13.5 6.5l4 4',
]);

/**
 * The iOS share glyph — a tray with an arrow lifting out of it. Distinct from
 * ShareIcon above (Tabler's three-node "share", which reads as Android).
 * Used where the action attaches to content rather than to a button
 * (decided 2026-07-28).
 */
export const IosShareIcon = makeIcon([
  'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2',
  'M7 9l5 -5l5 5',
  'M12 4l0 12',
]);

// Tabler "lock" — timelocked keys on the signing screen.
export const LockIcon = makeIcon([
  'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z',
  'M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0',
  'M8 11v-4a4 4 0 1 1 8 0v4',
]);

// Tabler "file-export" — PSBT file hand-off.
export const FileIcon = makeIcon([
  'M14 3v4a1 1 0 0 0 1 1h4',
  'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
]);

// The satsymbol — three bars with a dash above and below (unit marker).
export const SatoshiIcon = makeIcon([
  'M12 3.5v2.5',
  'M6.5 9.5h11',
  'M6.5 13h11',
  'M6.5 16.5h11',
  'M12 20v2.5',
]);

export const WarningIcon = makeIcon([
  'M12 9v4',
  'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z',
  'M12 16h.01',
]);

export const MailIcon = makeIcon([
  'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z',
  'M3 7l9 6l9 -6',
]);

export const DeviceMobileIcon = makeIcon([
  'M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14z',
  'M11 4h2',
  'M12 17v.01',
]);

export const BluetoothIcon = makeIcon(['M7 8l10 8l-5 4l0 -16l5 4l-10 8']);

/** Tabler circle-check: the done tick in checklists. */
export const CircleCheckIcon = makeIcon([
  'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
  'M9 12l2 2l4 -4',
]);

/** Tabler arrows-diagonal: expand the price chart to landscape. */
export const ArrowsDiagonalIcon = makeIcon([
  'M16 4l4 0l0 4',
  'M14 10l6 -6',
  'M8 20l-4 0l0 -4',
  'M4 20l6 -6',
]);

/** Tabler arrows-diagonal-minimize: back from the landscape chart. */
export const ArrowsDiagonalMinimizeIcon = makeIcon([
  'M6 10h4v-4',
  'M4 4l6 6',
  'M18 14h-4v4',
  'M14 14l6 6',
]);

/** Tabler chart-candle: the candlestick toggle on the price chart. */
export const ChartCandleIcon = makeIcon([
  'M4 6m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z',
  'M6 4l0 2',
  'M6 14l0 6',
  'M10 12m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z',
  'M12 4l0 8',
  'M12 20l0 1',
  'M16 8m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z',
  'M18 4l0 4',
  'M18 13l0 7',
]);

/** Tabler chart-line: back to the line chart. */
export const ChartLineIcon = makeIcon(['M4 19l16 0', 'M4 15l4 -6l4 2l4 -5l4 4']);

/** Tabler plus and minus: the round add buttons on the home and portfolios
 *  pages, the home chart's remove button, the heir stepper. A glyph in a
 *  Text sat off-centre and brought its own type size (decided 2026-10-05:
 *  drawn once here, no longer copied per page). */
export const PlusIcon = makeIcon(['M12 5l0 14', 'M5 12l14 0']);
export const MinusIcon = makeIcon(['M5 12l14 0']);

/** Tabler x: the remove mark on a key or layer row (XIcon above is the X logo). */
export const CloseIcon = makeIcon(['M18 6l-12 12', 'M6 6l12 12']);

/** Tabler search: the Addresses search field's mark. */
export const SearchIcon = makeIcon(['M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6']);

/** Tabler arrows-sort: the Send amount's unit switch (BTC and fiat). */
export const ArrowsSortIcon = makeIcon(['M3 9l4 -4l4 4m-4 -4v14', 'M21 15l-4 4l-4 -4m4 4v-14']);

/** Tabler arrow-right: the arrow after a text link that leads somewhere. */
export const ArrowRightIcon = makeIcon(['M5 12l14 0', 'M13 18l6 -6', 'M13 6l6 6']);
