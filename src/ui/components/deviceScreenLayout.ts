/**
 * Where the drawn devices put their words and marks (design A "The courier",
 * decided 2026-10-03), in each screen's OWN pixels: pure, so
 * `components/__tests__/deviceScreenLayout.test.ts` can hold every page to the
 * screen it is drawn on. The drawings (`NovaArt`, `NanoXArt`,
 * `LedgerTouchArt`) read their places from here and scale them to points.
 *
 * Two things went wrong in a phone test (2026-10-03) and are ruled out here:
 *
 *   - the drawn type grew with the phone's text size. That phone reads a size
 *     larger than standard, so every line of the drawings was set about 12%
 *     larger than the box it sat in: the Nova wrapped "Locktime on block:"
 *     and cut its last line, the Nano X's "Sign transaction" ran into its
 *     arrows. A device's screen is a picture, its type is the device's and
 *     never the phone's, so the drawings print through `ScreenText`
 *     (`allowFontScaling={false}`). The words the client reads (the card,
 *     the gesture line) still follow the phone's text size;
 *   - the Nano X's arrows sat on the ends of its words. On the device they
 *     are small chevrons at the very edges of the screen, centred on its
 *     height, and the words keep clear of them.
 */

// ─── The BitBox02 Nova: 128 x 64, one monospaced face ────────────────────────

/** The Nova's screen, in its own pixels. */
export const NOVA_SCREEN = { w: 128, h: 64 } as const;

/** Menlo, the drawing's face: every glyph is 1233/2048 of an em wide, so a
 *  line's width is its length times this, exactly (measured with CoreText:
 *  "Locktime on block:" is 108.37 at size 10). */
export const MENLO_ADVANCE = 1233 / 2048;

/** The Nova's type: 10 pixels on a 12-pixel line, as the photos of the device read. */
export const NOVA_TYPE = { size: 10, lineHeight: 12 } as const;

/** The × and the > (or the Total page's hold mark) along the top: nothing
 *  else may sit above this line except a title between them. */
export const NOVA_TOP_BAR = 14;

/** A title between the × and the >: clear of both. */
export const NOVA_TITLE_INSET = 18;

/** A line below the top bar may use all but two pixels each side. */
export const NOVA_BODY_INSET = 2;

/** How many characters one line holds at the Nova's size: 20. */
export const NOVA_LINE_CHARS = Math.floor(
  (NOVA_SCREEN.w - 2 * NOVA_BODY_INSET) / (MENLO_ADVANCE * NOVA_TYPE.size),
);

/** One line of text on a drawn screen, in that screen's pixels. */
export interface ScreenRow {
  text: string;
  top: number;
  /** Insets of the row's box from the screen's left and right edges. */
  left: number;
  right: number;
  size: number;
  lineHeight: number;
  bold: boolean;
  align: 'center' | 'left';
  /** The lines the page leaves room for (the Nova's rows are one line each,
   *  wrapped here; the Nano X's values wrap inside their box). */
  lines: number;
  /** Printed turned through 180 degrees: the Nova's "Tap this side" at the
   *  top, read by someone holding the device the other way up. */
  upsideDown?: boolean;
  /** A line longer than its box runs off the screen's edge, as the device
   *  shows a line it scrolls (the Nova's keys at a registration): never
   *  wrapped, never cut short with an ellipsis. */
  clip?: boolean;
}

/** A Menlo line's width at `size`. */
export function menloWidth(text: string, size: number): number {
  return text.length * MENLO_ADVANCE * size;
}

/**
 * A text broken into the Nova's lines, as the device breaks its labels: at
 * the spaces, a word longer than a line split where the line ends, and every
 * `\n` kept.
 */
export function novaWrap(text: string, perLine: number = NOVA_LINE_CHARS): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ').filter((w) => w.length > 0)) {
      let rest = word;
      while (rest.length > 0) {
        const room = line.length === 0 ? perLine : perLine - line.length - 1;
        if (rest.length <= room) {
          line = line.length === 0 ? rest : `${line} ${rest}`;
          rest = '';
        } else if (line.length > 0) {
          out.push(line);
          line = '';
        } else {
          out.push(rest.slice(0, perLine));
          rest = rest.slice(perLine);
        }
      }
    }
    out.push(line);
  }
  return out;
}

/** The size one line is set at so it fits its box: the Nova's own size
 *  wherever it fits (every realistic amount), a little smaller past that
 *  (an amount of twenty-one characters and more), never wrapped. */
export function novaFit(text: string, box: number): number {
  const whole = menloWidth(text, NOVA_TYPE.size);
  return whole <= box ? NOVA_TYPE.size : Math.floor((NOVA_TYPE.size * box * 10) / whole) / 10;
}

const novaRow = (text: string, top: number, extra: Partial<ScreenRow> = {}): ScreenRow => ({
  text,
  top,
  left: NOVA_BODY_INSET,
  right: NOVA_BODY_INSET,
  size: NOVA_TYPE.size,
  lineHeight: NOVA_TYPE.lineHeight,
  bold: false,
  align: 'center',
  lines: 1,
  ...extra,
});

/** A single value on its own line, set to fit its box (`inset` from each side). */
const novaValue = (text: string, top: number, inset: number = NOVA_BODY_INSET): ScreenRow =>
  novaRow(text, top, { size: novaFit(text, NOVA_SCREEN.w - 2 * inset), left: inset, right: inset });

/**
 * The Total page's two arrows at the right edge (decided 2026-10-03, the photos
 * nova-5 and nova-7, and the words: "the bottom right arrow appears AFTER the
 * top right arrow is held"). The page opens with the DOWN arrow alone at the
 * top right; once the top right edge is held the device shows the UP arrow at
 * the bottom right; while both edges are held the two slide together along the
 * right edge until their tips meet halfway, and the device confirms. Each is
 * 10 x 8 pixels, 6 in from the right edge, 4 from the top or the bottom.
 */
export const NOVA_HOLD_ARROW = { w: 10, h: 8, right: 6, inset: 4 } as const;

/** Where the two arrows start, how far each slides to meet, and the column
 *  they slide along (the Total page's words keep clear of it). */
export function novaHoldArrows(): { downTop: number; upTop: number; travel: number; column: [number, number] } {
  const a = NOVA_HOLD_ARROW;
  const downTop = a.inset;
  const upTop = NOVA_SCREEN.h - a.inset - a.h;
  // The down arrow's tip is its bottom edge, the up arrow's its top edge.
  const travel = (upTop - (downTop + a.h)) / 2;
  return { downTop, upTop, travel, column: [NOVA_SCREEN.w - a.right - a.w, NOVA_SCREEN.w - a.right] };
}

/** The Total page's lines keep this far in from each side: clear of the ×,
 *  and of the column the two arrows slide along (it ends 16 from the right). */
export const NOVA_TOTAL_INSET = NOVA_TITLE_INSET;

/** Lines stacked from `top`, at most `max` (the last cut short with "…"
 *  should a name ever run longer than the page). */
function novaBlock(lines: string[], top: number, max: number): ScreenRow[] {
  const kept = lines.length > max ? [...lines.slice(0, max - 1), `${lines[max - 1].slice(0, NOVA_LINE_CHARS - 1)}…`] : lines;
  return kept.map((l, i) => novaRow(l, top + i * NOVA_TYPE.lineHeight));
}

/** Where a block of `n` lines starts under a title (the photos: one line
 *  at 32, two at 26, three at 22), four filling the page under it. */
const BODY_TOP: Record<number, number> = { 1: 32, 2: 26, 3: 22, 4: 16 };

/** What the Nova prints on one of its pages. */
export type NovaPage =
  | { kind: 'nova-item'; title: string; body: string }
  | { kind: 'nova-output'; amount: string; to: string }
  | { kind: 'nova-text'; body: string }
  | { kind: 'nova-total'; total: string; fee: string | null }
  | { kind: 'done'; ok: boolean }
  /** After it is plugged in (photos 56 to 62 and a recording, 2026-10-04). */
  | { kind: 'nova-side' }
  | { kind: 'nova-password'; entered: number; last: string | null; groups: readonly string[]; depth: number }
  | { kind: 'nova-confirm'; entered: number; last: string }
  | { kind: 'nova-splash' }
  /** Registering a vault (a video of the device, 2026-10-04): one line under a title,
   *  which the device scrolls along its bottom edge (a key); and its word
   *  once the vault is registered, with a tick. */
  | { kind: 'nova-scroll'; title: string; body: string; hold: boolean }
  | { kind: 'registered'; text: string }
  /** The address check (a video of the device, 2026-10-04): the address in groups of
   *  four as one scrolling line under "Receive to", the tick in place of
   *  the ">" (the top right edge confirms). */
  | { kind: 'nova-address'; title: string; body: string };

/** A page whose one line the device scrolls along its bottom edge (the keys
 *  of a registration, the address of the address check; the videos): where
 *  the line starts and sits, and the scrollbar's thumb along the bottom, at
 *  its start, on its track (the video's frame: the thumb a tenth of the
 *  width, two fifths in, on a track centred on the screen; its width is the
 *  window's share of the line, 108 of 475 pixels for the video's address). */
export const NOVA_SCROLL = { left: NOVA_TITLE_INSET, top: 26, thumb: { x: 40, top: 57, w: 10 }, track: { x: 40, w: 48 } } as const;

/** The window a scrolled line is seen through: the screen less its insets. */
export const NOVA_SCROLL_WINDOW = NOVA_SCREEN.w - NOVA_SCROLL.left - NOVA_BODY_INSET;

/** The signing review's amount-over-address page (the photo): the amount's
 *  line, the small down arrow under it (centred), then the whole address as
 *  ONE scrolling line from `NOVA_SCROLL.left` with the thumb under it
 *  (`NOVA_SCROLL.thumb`), exactly the address check's line (decided 2026-10-05). */
export const NOVA_OUTPUT = { amount: 16, arrow: { top: 30, w: 8, h: 6 }, address: 40 } as const;

/** A scrolled line's whole width, in the screen's pixels. */
export function novaScrollWidth(body: string): number {
  return menloWidth(body, NOVA_TYPE.size);
}

/** How far the device carries a scrolled line to show its end (decided
 *  2026-10-04: "the user can scroll through the address by swiping from the
 *  right to the left on the lower edge of the bitbox. The display is not big
 *  enough to show the entire address"): what runs past the window, 0 for a
 *  line that fits. */
export function novaScrollTravel(body: string): number {
  return Math.max(0, novaScrollWidth(body) - NOVA_SCROLL_WINDOW);
}

/** How far the thumb travels along its track as the line reaches its end. */
export function novaThumbTravel(): number {
  return NOVA_SCROLL.track.w - NOVA_SCROLL.thumb.w;
}

/** The tick at the top right of the Nova's address page, where the ">" sits
 *  on every other page (the video): tapping the top right edge confirms. */
export const NOVA_CONFIRM_MARK = { right: 4, top: 2, size: 11 } as const;

/** The device's word once a vault is registered (the video: "Multisig
 *  account" over "registered" from the left, the tick at the right end of
 *  the first line): the lines' left edge and top, the characters a line
 *  holds before the tick, and the tick. */
export const NOVA_REGISTERED = { left: 6, top: 20, chars: 16, glyph: { x: 108, top: 20, size: 16 } } as const;

/** The Nova's lines for one page, each placed and sized to fit. */
export function novaRows(page: NovaPage): ScreenRow[] {
  switch (page.kind) {
    case 'nova-scroll':
    case 'nova-address':
      // The title in the bar; the one line from the left, running off the
      // screen as the device shows it (it scrolls along the bottom edge).
      return [
        novaRow(page.title, 2, { left: NOVA_TITLE_INSET, right: NOVA_TITLE_INSET, bold: true }),
        novaRow(page.body, NOVA_SCROLL.top, { left: NOVA_SCROLL.left, right: NOVA_BODY_INSET, align: 'left', clip: true }),
      ];
    case 'registered': {
      const g = NOVA_REGISTERED;
      const box = { left: g.left, right: NOVA_SCREEN.w - g.glyph.x + 2, bold: true, align: 'left' as const };
      return novaWrap(page.text, g.chars)
        .slice(0, 3)
        .map((l, i) => novaRow(l, g.top + i * NOVA_TYPE.lineHeight, box));
    }
    case 'nova-item': {
      const body = novaWrap(page.body);
      const n = Math.min(body.length, 4);
      return [
        novaRow(page.title, 2, { left: NOVA_TITLE_INSET, right: NOVA_TITLE_INSET, bold: true }),
        ...novaBlock(body, BODY_TOP[n], 4),
      ];
    }
    case 'nova-output':
      // The amount over a small arrow, then the whole address in groups of
      // four as one line from the left, running off the screen as the device
      // shows it (it scrolls along the bottom edge, decided 2026-10-05).
      return [novaValue(page.amount, NOVA_OUTPUT.amount), novaRow(page.to, NOVA_OUTPUT.address, { left: NOVA_SCROLL.left, right: NOVA_BODY_INSET, align: 'left', clip: true })];
    case 'nova-text': {
      // "Locktime on block:" / the height / "Transaction is RBF": three
      // lines from 18 as the photo shows them; "Transaction is not RBF" is
      // longer than a line and breaks, and four lines start higher.
      const lines = novaWrap(page.body);
      return novaBlock(lines, lines.length <= 3 ? 18 : NOVA_TOP_BAR, 4);
    }
    case 'nova-total': {
      // Every line clear of the right edge's column, where the two arrows
      // slide together while the client holds both edges (NOVA_HOLD_ARROW).
      const inset = NOVA_TOTAL_INSET;
      const boxed = { bold: true, left: inset, right: inset };
      return page.fee != null
        ? [
            // "Total" sits up in the bar, between the × and the down arrow.
            novaRow('Total', 8, boxed),
            novaValue(page.total, 20, inset),
            novaRow('Fee', 34, boxed),
            novaValue(page.fee, 46, inset),
          ]
        : [novaRow('Total', 20, boxed), novaValue(page.total, 32, inset)];
    }
    case 'done': {
      // "Transaction confirmed" / "canceled" at the left, the tick or the
      // cross to the right of it (NOVA_DONE_GLYPH).
      const box = { left: 14, right: NOVA_SCREEN.w - NOVA_DONE_GLYPH.x + 2, bold: true, align: 'left' as const };
      return [novaRow('Transaction', 20, box), novaRow(page.ok ? 'confirmed' : 'canceled', 32, box)];
    }
    case 'nova-side':
      // "Tap this side" at the top, turned for the person facing the other
      // way, the turning arrow between (a mark), the same words upright below.
      return [novaRow('Tap this side', NOVA_SIDE.top, { upsideDown: true }), novaRow('Tap this side', NOVA_SIDE.bottom)];
    case 'nova-password': {
      // The top bar: "<" over the first slot once there is something to go
      // back from (a character in, or a group opened), "abc" in the middle,
      // the down arrow over the third slot (a mark, NOVA_HOLD_ARROW). The
      // middle line: "Enter password" until a character is in, then the
      // entry. The groups along the bottom, one per slot.
      const p = NOVA_PASSWORD;
      const back = page.entered > 0 || page.depth > 0 ? [novaRow('<', p.abc, { left: p.back, right: 0, align: 'left' })] : [];
      const entry =
        page.entered > 0
          ? novaRow(novaEntry(page.entered, page.last, true), p.entry.top, { left: p.entry.left, align: 'left' })
          : novaRow('Enter password', p.entry.top);
      return [...back, novaRow('abc', p.abc, { left: NOVA_TITLE_INSET, right: NOVA_TITLE_INSET }), entry, ...novaSlotRows(page.groups)];
    }
    case 'nova-confirm':
      // The entry alone at the left, the two arrows at the right (marks).
      return [novaRow(novaEntry(page.entered, page.last, false), NOVA_PASSWORD.entry.top, { left: NOVA_PASSWORD.entry.left, align: 'left' })];
    case 'nova-splash':
      // The device's name, large: the edition line under it on the real
      // device names the Bitcoin-only or the Multi edition, which the phone
      // does not know, so it is not drawn.
      return [novaRow('BitBox02 Nova', NOVA_SPLASH.top, { bold: true, size: NOVA_SPLASH.size, lineHeight: NOVA_SPLASH.lineHeight })];
  }
}

// ─── The BitBox after it is plugged in ───────────────────────────────────────

/**
 * The three touch slots along each edge, by their centres: the thirds of the
 * screen. Photos of the device (2026-10-04): "012  345  6789" along the bottom and
 * "<  abc  ▼" along the top, each over its third; after a tap on "6789" the
 * bottom reads "6  7  89" in the same three places.
 */
export const NOVA_SLOTS: readonly number[] = [NOVA_SCREEN.w / 6, NOVA_SCREEN.w / 2, (NOVA_SCREEN.w * 5) / 6];

/** A slot's label sits in a box this far each side of its centre: a label is
 *  at most four characters ("6789"), 24 pixels. */
export const NOVA_SLOT_HALF = 14;

/** The password page: the "<" box's left edge, the top bar's line, the entry
 *  (or "Enter password") on the middle line, the groups along the bottom. */
export const NOVA_PASSWORD = { back: 15, abc: 2, entry: { top: 26, left: 6 }, slots: 46 } as const;

/** The side page (photos 56 and 57): the two lines, and the turning arrow
 *  between them, a circle of this radius with an arrowhead, centred. */
export const NOVA_SIDE = { top: 7, bottom: 45, arrow: { cx: NOVA_SCREEN.w / 2, cy: NOVA_SCREEN.h / 2, r: 6, stroke: 1.8 } } as const;

/**
 * The side page's turning arrow, the clockwise glyph (the anticlockwise one
 * is its mirror): an arc round (cx, cy) from below right over the top to
 * above right, and the arrowhead at its end pointing on round. Screen
 * coordinates (y down), so a growing angle is clockwise.
 */
export function novaTurnArrow(cx: number, cy: number, r: number): { arc: string; head: string } {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const at = (deg: number): [number, number] => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
  const f = (n: number) => Number(n.toFixed(2));
  const start = 50;
  const end = 335;
  const [x0, y0] = at(start);
  const [x1, y1] = at(end);
  const arc = `M${f(x0)} ${f(y0)} A${r} ${r} 0 1 1 ${f(x1)} ${f(y1)}`;
  // The head: along the tangent at the end, its base across it.
  const t = [-Math.sin(rad(end)), Math.cos(rad(end))];
  const n = [t[1], -t[0]];
  const h = r * 0.6;
  const w = r * 0.55;
  const head = `M${f(x1 + t[0] * h)} ${f(y1 + t[1] * h)} L${f(x1 + n[0] * w)} ${f(y1 + n[1] * w)} L${f(x1 - n[0] * w)} ${f(y1 - n[1] * w)} Z`;
  return { arc, head };
}

/** The lock (the recording): a body under a shackle, centred on the screen;
 *  the shackle swings open about its left foot by `openTurn` degrees. */
export const NOVA_LOCK = { cx: NOVA_SCREEN.w / 2, body: { top: 33, w: 12, h: 9, r: 1.5 }, shackle: { r: 4, stroke: 1.8 }, openTurn: -55 } as const;

/** The splash: the device's name, bold, set larger than the pages' type. */
export const NOVA_SPLASH = { top: 24, size: 13, lineHeight: 16 } as const;

/** The password's entry as the device prints it: every character but the
 *  last hidden as a dot, the last still readable, the cursor after it while
 *  more can be typed (photos 59 and 60), none on the confirmation (58). */
export function novaEntry(entered: number, last: string | null, cursor: boolean): string {
  if (entered <= 0) return '';
  return `${'•'.repeat(entered - 1)}${last ?? ''}${cursor ? '_' : ''}`;
}

/** The groups along the bottom, each centred in its slot's box. */
export function novaSlotRows(groups: readonly string[]): ScreenRow[] {
  return groups.map((g, i) => {
    const c = NOVA_SLOTS[i] ?? NOVA_SLOTS[NOVA_SLOTS.length - 1];
    return novaRow(g, NOVA_PASSWORD.slots, { left: c - NOVA_SLOT_HALF, right: NOVA_SCREEN.w - c - NOVA_SLOT_HALF });
  });
}

/** The tick or the cross of the Nova's last page: x from the left, its size. */
export const NOVA_DONE_GLYPH = { x: 86, top: 22, size: 20 } as const;

// ─── The Ledger Nano X: 128 x 64, white on black ─────────────────────────────

/** The Nano X's screen, in its own pixels. */
export const NANO_X_SCREEN = { w: 128, h: 64 } as const;

/**
 * The arrows: small chevrons four pixels wide and seven tall at the very
 * edges of the screen, two pixels in, centred on its height (Ledger's own
 * places, and the photos nanox-3 to nanox-7).
 */
export const NANO_X_ARROW = { inset: 2, w: 4, h: 7, stroke: 1.2 } as const;

/** The columns the arrows take, their stroke included: [from, to]. */
export function nanoXArrowColumns(): { left: [number, number]; right: [number, number] } {
  const a = NANO_X_ARROW;
  const half = a.stroke / 2;
  return {
    left: [a.inset - half, a.inset + a.w + half],
    right: [NANO_X_SCREEN.w - a.inset - a.w - half, NANO_X_SCREEN.w - a.inset + half],
  };
}

/** The least room a line keeps from an arrow's stroke. */
export const NANO_X_ARROW_GAP = 2;

/** A line's inset from each side on a page with arrows, clear of them (the
 *  arrows end at 6.6): 9 pixels, as on the device, where the 42-character
 *  testnet address takes three lines (the photo nanox-5). CoreText breaks it
 *  into three lines in this box on both the iPhone 17 Pro and the SE; where
 *  inside the address each break falls can differ by a character between the
 *  two sizes. Pages without arrows keep 6. */
export const NANO_X_TEXT_INSET = 9;
export const NANO_X_PLAIN_INSET = 6;

/** The Nano X's type: 10 pixels on a 12-pixel line, regular and bold. The
 *  photos read "Sign transaction" 90 pixels wide, "From account" 73 and
 *  "0.00000106 TEST" 82: the system face at 10 sets them at 89, 74 and 91. */
export const NANO_X_TYPE = { size: 10, lineHeight: 12 } as const;

/** Past this many characters a long page's value (an address) takes four
 *  lines (measured: a 42-character address takes three, a 62-character one
 *  four), so the page starts higher. */
export const LONG_VALUE_CHARS = 42;

/** What the Nano X shows on one page: its lines, its one glyph, its arrows. */
export interface NanoXLayout {
  rows: ScreenRow[];
  glyph: { kind: 'bitcoin' | 'tick' | 'cross' | 'spinner'; top: number; size: number } | null;
  arrows: { left: boolean; right: boolean };
  /** The PIN page's slots, keys and cursor (`nanoPinLayout`). */
  pin?: NanoPinLayout;
}

/** What the Nano X prints on one page. */
export type NanoXPage =
  | { kind: 'working'; text: string }
  | { kind: 'done'; ok: boolean }
  | { kind: 'intro' }
  | { kind: 'item'; title: string; value: string; long?: boolean }
  | { kind: 'sign' }
  /** "Enter PIN" (photos 64 and 67): `entered` digits in, the cursor on
   *  a digit (0 to 9) or the tick (`NANO_PIN_TICK`). */
  | { kind: 'pin'; entered: number; cursor: number }
  /** "Open app" over the app's name, the bitcoin glyph above (photo 70). */
  | { kind: 'open-app'; app: string }
  /** Registering a vault (a video of the device, 2026-10-04): "Review account to
   *  register" under the glyph with the right arrow alone; "Review co-signer
   *  public keys" in bold between both arrows; the tick over "Register
   *  account"; and the device's word alone, "Account registered". */
  | { kind: 'register-intro' }
  | { kind: 'register-keys' }
  | { kind: 'register-approve' }
  | { kind: 'notice'; text: string }
  /** The address check (a video of the device, 2026-10-04): "Verify bitcoin address"
   *  under the glyph with the right arrow alone (its address and name pages
   *  are 'item'); the tick over "Confirm"; and the app's home where the
   *  check ends, the title over "app is ready" with the right arrow alone. */
  | { kind: 'address-intro' }
  | { kind: 'confirm' }
  | { kind: 'app-home'; app: string };

/**
 * The Nano X's PIN page, read off photos of the device: "Enter PIN" small at the top;
 * a row of eight slots (hollow until a digit is in), five pixels at a nine
 * pixel pitch, centred; the digits 0 to 9 bold on a nine pixel pitch,
 * centred, with the backspace one pitch left of them once a digit is in and
 * the tick one pitch right of them once four are (a PIN's least); a seven
 * pixel underline under the key the cursor is on.
 */
export const NANO_PIN = {
  title: { top: 8 },
  slots: { top: 28, d: 5, pitch: 9, count: 8 },
  keys: { top: 42, pitch: 9, size: 11, lineHeight: 12 },
  cursor: { top: 56, w: 7, h: 1 },
  /** The tick shows from this many digits (a Ledger PIN is four to eight). */
  min: 4,
} as const;

/** The row's keys in order: the ten digits and, when shown, the backspace
 *  and the tick; `NANO_PIN_TICK` is the tick's cursor index. */
export const NANO_PIN_TICK = 10;

export interface NanoPinLayout {
  /** Each slot's left edge, at `NANO_PIN.slots.top`, and whether it is filled. */
  slots: { x: number; filled: boolean }[];
  /** Each key's cell (its left edge, `NANO_PIN.keys.pitch` wide): a digit, or a glyph. */
  keys: { x: number; text: string; glyph?: 'backspace' | 'tick' }[];
  /** The underline's left edge, at `NANO_PIN.cursor.top`. */
  cursor: { x: number };
}

export function nanoPinLayout(page: { entered: number; cursor: number }): NanoPinLayout {
  const P = NANO_PIN;
  const slotsW = P.slots.count * P.slots.pitch - (P.slots.pitch - P.slots.d);
  const sx = (NANO_X_SCREEN.w - slotsW) / 2;
  const slots = Array.from({ length: P.slots.count }, (_, i) => ({ x: sx + i * P.slots.pitch, filled: i < page.entered }));
  const digitsW = 10 * P.keys.pitch;
  const x0 = (NANO_X_SCREEN.w - digitsW) / 2;
  const keys: NanoPinLayout['keys'] = [];
  if (page.entered > 0) keys.push({ x: x0 - P.keys.pitch - 1, text: '', glyph: 'backspace' });
  for (let i = 0; i < 10; i++) keys.push({ x: x0 + i * P.keys.pitch, text: String(i) });
  const tickX = x0 + digitsW + 1;
  if (page.entered >= P.min) keys.push({ x: tickX, text: '', glyph: 'tick' });
  const on = page.cursor === NANO_PIN_TICK && page.entered >= P.min ? tickX : x0 + Math.max(0, Math.min(9, page.cursor)) * P.keys.pitch;
  return { slots, keys, cursor: { x: on + (P.keys.pitch - P.cursor.w) / 2 } };
}

const nanoRow = (text: string, top: number, inset: number, extra: Partial<ScreenRow> = {}): ScreenRow => ({
  text,
  top,
  left: inset,
  right: inset,
  size: NANO_X_TYPE.size,
  lineHeight: NANO_X_TYPE.lineHeight,
  bold: false,
  align: 'center',
  lines: 1,
  ...extra,
});

export function nanoXLayout(page: NanoXPage): NanoXLayout {
  const both = { left: true, right: true };
  const inset = NANO_X_TEXT_INSET;
  switch (page.kind) {
    case 'working':
      // "Loading transaction" / "Signing transaction" under the dotted ring.
      return { rows: [nanoRow(page.text, 34, NANO_X_PLAIN_INSET)], glyph: { kind: 'spinner', top: 10, size: 16 }, arrows: { left: false, right: false } };
    case 'done':
      return {
        rows: [nanoRow(page.ok ? 'Transaction signed' : 'Transaction rejected', 34, NANO_X_PLAIN_INSET, { bold: true })],
        glyph: { kind: page.ok ? 'tick' : 'cross', top: 10, size: 14 },
        arrows: { left: false, right: false },
      };
    case 'intro':
      // The first page has only the right arrow; its words stay centred.
      return {
        rows: [nanoRow('Review transaction', 24, inset), nanoRow('to send bitcoin', 36, inset)],
        glyph: { kind: 'bitcoin', top: 8, size: 12 },
        arrows: { left: false, right: true },
      };
    case 'item':
      if (page.long) {
        // The address under "To": three lines, or four past 42 characters.
        const four = page.value.length > LONG_VALUE_CHARS;
        return {
          rows: [
            nanoRow(page.title, four ? 2 : 8, inset, { bold: true }),
            nanoRow(page.value, four ? 14 : 21, inset, { lines: four ? 4 : 3 }),
          ],
          glyph: null,
          arrows: both,
        };
      }
      // A title over its value; a long name may take a second line.
      return { rows: [nanoRow(page.title, 9, inset, { bold: true }), nanoRow(page.value, 34, inset, { lines: 2 })], glyph: null, arrows: both };
    case 'sign':
      return { rows: [nanoRow('Sign transaction', 34, inset, { bold: true })], glyph: { kind: 'tick', top: 19, size: 12 }, arrows: both };
    case 'pin':
      // "Enter PIN" small at the top, no arrows: the slots and the keys below (nanoPinLayout).
      return { rows: [nanoRow('Enter PIN', NANO_PIN.title.top, NANO_X_PLAIN_INSET)], glyph: null, arrows: { left: false, right: false }, pin: nanoPinLayout(page) };
    case 'open-app':
      // The bitcoin glyph, "Open app" over the app's name, the right arrow alone (photo 70).
      return {
        rows: [nanoRow('Open app', 16, inset, { bold: true }), nanoRow(page.app, 28, inset, { bold: true })],
        glyph: { kind: 'bitcoin', top: 3, size: 11 },
        arrows: { left: false, right: true },
      };
    case 'register-intro':
      // As the review's first page, in the registration's words (the video).
      return {
        rows: [nanoRow('Review account', 24, inset), nanoRow('to register', 36, inset)],
        glyph: { kind: 'bitcoin', top: 8, size: 12 },
        arrows: { left: false, right: true },
      };
    case 'register-keys':
      return {
        rows: [nanoRow('Review co-signer', 24, inset, { bold: true }), nanoRow('public keys', 36, inset, { bold: true })],
        glyph: null,
        arrows: both,
      };
    case 'register-approve':
      // As "Sign transaction": the tick over the bold line, both arrows.
      return { rows: [nanoRow('Register account', 34, inset, { bold: true })], glyph: { kind: 'tick', top: 19, size: 12 }, arrows: both };
    case 'notice':
      // The device's word alone on the middle line, no glyph, no arrows.
      return { rows: [nanoRow(page.text, 26, NANO_X_PLAIN_INSET)], glyph: null, arrows: { left: false, right: false } };
    case 'address-intro':
      // As the review's first page, in the address check's words (the video).
      return {
        rows: [nanoRow('Verify bitcoin', 24, inset), nanoRow('address', 36, inset)],
        glyph: { kind: 'bitcoin', top: 8, size: 12 },
        arrows: { left: false, right: true },
      };
    case 'confirm':
      // As "Sign transaction": the tick over the bold word, both arrows.
      return { rows: [nanoRow('Confirm', 34, inset, { bold: true })], glyph: { kind: 'tick', top: 19, size: 12 }, arrows: both };
    case 'app-home':
      // The app's home (the video): the glyph, the title bold over "app is
      // ready", the right arrow alone, as "Open app" is laid out.
      return {
        rows: [nanoRow(page.app, 16, inset, { bold: true }), nanoRow('app is ready', 28, inset)],
        glyph: { kind: 'bitcoin', top: 3, size: 11 },
        arrows: { left: false, right: true },
      };
  }
}

// ─── The touchscreen Ledgers' pages ──────────────────────────────────────────

/**
 * Where the touchscreen Ledgers (Gen5, Flex, Stax) put their words and marks,
 * read off photos of a Gen5: places in fractions of the E Ink's width W
 * or height H, type in fractions of W scaled by the model's `typeScale` (the
 * Flex and the Stax hold more pixels for their size). `LedgerTouchArt`'s
 * pages are laid out from these, and the press hint finds the footer's ">" and
 * the "Hold to sign" tile from the same numbers (`einkAnchors`), so the two
 * cannot drift apart.
 */
export const EINK_PAGE = {
  /** The side margin (× W). */
  pad: 0.07,
  /** The footer: its top (× H), Reject's part (× W), the counter part's side padding (× pad). */
  footer: { top: 0.85, split: 0.39, inset: 0.7 },
  /** The first page: the bitcoin disc, the title, "Swipe to review" (tops, × H). */
  intro: { disc: 0.22, title: 0.4, note: 0.6 },
  /** An output's page: the column's top (× H), its right inset (× pad), the gap before a group (× H). */
  output: { top: 0.08, right: 0.6, gap: 0.05 },
  /** The fee's page: the column's top (× H). */
  fees: { top: 0.07 },
  /** The last page: disc, title and rule (tops, × H), the tile's row (height × H), its right inset (× pad). */
  sign: { disc: 0.15, title: 0.33, rule: 0.62, row: 0.23, right: 0.85 },
  /** Bitcoin app 2.2.1 to 2.4.1's name page (tops, × H). */
  name: { disc: 0.2, title: 0.38, value: 0.6 },
  /** Signed or rejected: the ring's top and the gap under it (× H). */
  done: { top: 0.34, gap: 0.04 },
  /** The locked device's PIN page (photos of a Gen5): the title's top
   *  (× H); the dots' row (top × H; the first dot's left, its diameter and
   *  the pitch × W); the keypad's top rule (× H), four rows of three cells
   *  down to the screen's foot, dotted rules between. */
  pin: { title: 0.115, dots: { top: 0.215, left: 0.2, d: 0.05, pitch: 0.087 }, pad: 0.385 },
  /** "Open app?" (a photo of a Gen5): the "i" box at the top right (its
   *  insets from the right and the top, × W and × H; its size × W and × H),
   *  the disc, the title and the app's name (tops × H), the dark Open button
   *  (top and height × H, side inset and corner × W), "Don't open" (top × H). */
  open: { info: { right: 0.03, top: 0.04, w: 0.19, h: 0.14 }, disc: 0.24, title: 0.365, app: 0.465, button: { top: 0.685, h: 0.14, x: 0.03, r: 0.025 }, dont: 0.89 },
  /** Registering the vault (a Gen5 video, 2026-10-04): the keys' intro
   *  title (no disc; top × H), a key page's column top (× H) and the lines
   *  it leaves the key (a real key takes seven or eight, measured), the
   *  last page's disc and title (tops × H) and its dark Approve button (top
   *  and height × H, side inset and corner × W), above the footer. */
  register: { keysTitle: 0.36, keyTop: 0.06, keyLines: 8, approve: { disc: 0.15, title: 0.33, button: { top: 0.62, h: 0.14, x: 0.03, r: 0.025 } } },
  /** The app's home page (the same video): the gear in a box at the top
   *  right (the "i" box's place), the disc, the title, the note under it
   *  (tops × H), the rule over "Quit app" (× H). */
  home: { disc: 0.2, title: 0.33, note: 0.44, rule: 0.82 },
  /** The address check's page (a Gen5 video, 2026-10-04): the "Address"
   *  column's top (× H) and the lines it leaves the address (the device
   *  shows a 62-character address over four), the "Account name" column's
   *  top (× H), and the row of the QR button and the dark Confirm (top and
   *  height × H; the gap between them × pad), above the footer. The name
   *  column sits higher than on the device so the "Tap" over Confirm has
   *  its room between them (the hint never covers the device's words). */
  address: { top: 0.04, lines: 4, name: 0.36, row: { top: 0.65, h: 0.115, gap: 0.5 } },
  /** Type and marks (× W × typeScale): [size, line height] for text. */
  type: {
    title: [0.075, 0.088],
    small: [0.058, 0.072],
    value: [0.074, 0.088],
    foot: [0.062, 0.072],
    address: [0.07, 0.084],
    holdToSign: 0.072,
    chevron: 0.085,
    tile: 0.19,
    /** The tile's corner radius (× its side). */
    tileCorner: 0.14,
    disc: 0.14,
    /** The signed and rejected pages' outlined circle, and its stroke (the recording). */
    doneDisc: 0.2,
    doneStroke: 0.012,
    /** The thin dark line that fills along the "Hold to sign" row's top edge while the tile is held. */
    holdLine: 0.012,
    /** The PIN page: its title, the keypad's digits, its backspace and tick glyphs. */
    pinTitle: [0.062, 0.078],
    padDigit: 0.085,
    padGlyph: 0.095,
    /** "Open app?": the app's name, the button's label, "Don't open". */
    appName: [0.068, 0.084],
    button: 0.074,
  },
} as const;

/** One type unit of the touch screens, rounded to a tenth of a point. */
export function einkUnit(k: number, W: number, typeScale: number): number {
  return Math.round(k * typeScale * W * 10) / 10;
}

/** A control on a drawing: its centre and the radius the hint rings it at;
 *  a square control (the touchscreens' tile, 2r on a side) its corner radius;
 *  a wide one (the Open button) its width and height, ringed as a rounded
 *  rectangle. */
export interface ControlSpot {
  x: number;
  y: number;
  r: number;
  corner?: number;
  w?: number;
  h?: number;
}

/**
 * The address page's row (the Gen5 video): the QR button, a square as tall
 * as the row at the left margin, and the dark Confirm from `gap` after it to
 * the right margin; in the E Ink's own points.
 */
export function einkAddressRow(W: number, H: number): { top: number; h: number; qr: { left: number; side: number }; confirm: { left: number; w: number } } {
  const p = EINK_PAGE;
  const pad = p.pad * W;
  const side = p.address.row.h * H;
  const left = pad + side + pad * p.address.row.gap;
  return { top: p.address.row.top * H, h: side, qr: { left: pad, side }, confirm: { left, w: W - pad - left } };
}

/**
 * The controls of a touch Ledger's pages, in the E Ink's own points: the
 * footer's ">" (tapped to move on: its slot at the right end of the counter
 * part), the "Hold to sign" tile at the right end of the last page's row, the
 * Open and Approve buttons, the address page's Confirm, and the PIN keys.
 */
export function einkAnchors(W: number, H: number, typeScale: number): { next: ControlSpot; tile: ControlSpot; open: ControlSpot; approve: ControlSpot; confirm: ControlSpot; pin: ControlSpot[] } {
  const p = EINK_PAGE;
  const pad = p.pad * W;
  const chev = einkUnit(p.type.chevron, W, typeScale);
  const tile = einkUnit(p.type.tile, W, typeScale);
  const b = p.open.button;
  const ab = p.register.approve.button;
  const row = einkAddressRow(W, H);
  const cell = einkPinCells(W, H);
  const digit = einkUnit(p.type.padDigit, W, typeScale);
  return {
    next: { x: W - pad * p.footer.inset - chev / 2, y: ((p.footer.top + 1) / 2) * H, r: chev * 0.85 },
    tile: { x: W - pad * p.sign.right - tile / 2, y: (p.sign.rule + p.sign.row / 2) * H, r: tile / 2, corner: tile * p.type.tileCorner },
    // The Open button: as wide as the page less its insets, ringed as a rounded rectangle.
    open: { x: W / 2, y: (b.top + b.h / 2) * H, r: (b.h * H) / 2, w: W - 2 * b.x * W, h: b.h * H, corner: b.r * W },
    // The registration's Approve button, the same shape, above the footer.
    approve: { x: W / 2, y: (ab.top + ab.h / 2) * H, r: (ab.h * H) / 2, w: W - 2 * ab.x * W, h: ab.h * H, corner: ab.r * W },
    // The address page's Confirm: the right part of its row, beside the QR button.
    confirm: { x: row.confirm.left + row.confirm.w / 2, y: row.top + row.h / 2, r: row.h / 2, w: row.confirm.w, h: row.h, corner: b.r * W },
    // Each PIN key: a ring round its glyph, in the cell's centre.
    pin: Array.from({ length: 12 }, (_, i) => ({ x: (((i % 3) + 0.5) * W) / 3, y: cell.top + (Math.floor(i / 3) + 0.5) * cell.h, r: digit * 0.72 })),
  };
}

/** The touchscreens' keypad cells: the top of the first row and a cell's height. */
export function einkPinCells(W: number, H: number): { top: number; h: number; w: number } {
  const top = EINK_PAGE.pin.pad * H;
  return { top, h: (H - top) / 4, w: W / 3 };
}

/** The free band over the keypad, between the dots and the first row: where
 *  the one "Tap" pill of the PIN entry sits (a pill over a key would cover
 *  the digits beside it). */
export function einkPinBand(W: number, H: number): { top: number; bottom: number } {
  const d = EINK_PAGE.pin.dots;
  return { top: d.top * H + d.d * W, bottom: EINK_PAGE.pin.pad * H };
}

// ─── The touchscreen Ledgers' working mark ───────────────────────────────────

/**
 * What the Gen5, the Flex and the Stax show while they work, read off a
 * recording of a Gen5 (2026-10-03, `loading.mp4`): ONE corner
 * bracket on the corners of a small invisible box, top left (an L opening
 * down and right), then top right, bottom right, bottom left, and round
 * again, about 0.6 s at each corner, and no glide between: an E Ink screen
 * redraws, it does not move. Centred above "Loading transaction", the two
 * together centred on the screen. In units of the screen's width (the
 * Gen5's E Ink, 215 pixels wide in the recording): the box 28 x 24.5 pixels,
 * its arms 11 across and 7 down, the stroke 2, the words' capitals 17 below.
 */
export const EINK_WORKING = {
  box: { w: 0.13, h: 0.114 },
  arm: { across: 0.051, down: 0.033 },
  stroke: 0.0093,
  /** From the box to the words' line (the capitals sit lower in it). */
  gap: 0.058,
} as const;

/** The corners in the order the mark visits them: clockwise from top left. */
export const WORKING_CORNERS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
export type WorkingCorner = (typeof WORKING_CORNERS)[number];

/** How long the mark stays on one corner. */
export const CORNER_MS = 600;

/** The bracket at one corner of a `w` x `h` box: arms `across` and `down`
 *  long, drawn on the stroke's centre line so the whole stroke is inside. */
export function cornerPath(c: WorkingCorner, w: number, h: number, across: number, down: number, stroke: number): string {
  const i = stroke / 2;
  const left = c === 'topLeft' || c === 'bottomLeft';
  const top = c === 'topLeft' || c === 'topRight';
  const x = left ? i : w - i;
  const y = top ? i : h - i;
  const dx = left ? across : -across;
  const dy = top ? down : -down;
  return `M${x + dx} ${y} L${x} ${y} L${x} ${y + dy}`;
}

/** Shown or not as one clock runs 0 to 4 (a corner a step): a jump, never a
 *  fade, so exactly one corner shows at any moment; the step from one to the
 *  next takes a thousandth of a corner's time. */
export function cornerShown(index: number): { inputRange: number[]; outputRange: number[] } {
  const e = 0.001;
  if (index === 0) return { inputRange: [0, 1 - e, 1], outputRange: [1, 1, 0] };
  if (index === WORKING_CORNERS.length - 1) return { inputRange: [index - e, index, WORKING_CORNERS.length], outputRange: [0, 1, 1] };
  return { inputRange: [index - e, index, index + 1 - e, index + 1], outputRange: [0, 1, 1, 0] };
}
