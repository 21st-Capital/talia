# Design rules

The rules every Talia screen follows. Paths are relative to `src/ui/` unless
they say otherwise. Structural tests in `src/ui/__tests__/` hold the code to
these rules (`pageFooter.test.ts`, `pageHead.test.ts`, `statusCard.test.ts`
and others), so a change to a rule goes into this note and its test in the
same commit.

## Colours and spacing

Colours and spacing come from `theme/` and never from a literal: a rebrand
touches `theme/colors.ts` only. The sanctioned exceptions are other
products' own colours, which do not change with the app's palette: the
exchange and provider logos, and the signing devices' colours in
`components/deviceArtPalette.ts`, the one place they live (see
`docs/hardware-signing.md`).

Colour roles: primary text `offWhite`, secondary `slate`, hints `faint`,
warnings `gold`, errors `negative`, links `accentText`. Every gain and loss
uses `positive` and `negative`. A disabled control says so in colour, never
with `opacity`.

## Page layout

A page's actions live in ONE pinned bottom area: `Screen`'s `footer` prop
(`components/PageFooter`; a page with its own scroll view mounts
`<PageFooter>` after it and pads its content by `FOOTER_ROOM`). The primary
action is on top, a quiet second choice under it, and Back, Cancel or Done
last; never a `Button` in the flow of the page. The footer takes the safe
area and rises with the keyboard, so a field and its button both stay above
the keys. What stays in the content: an action that belongs to one row or
card, and a text link that belongs to what it sits under ("Reconnect").

The hardware step has ONE Back, decided by `HardwareConnect` and handed to
the page through `onFooterBack`: the step, the flows and the pickers draw no
`Button` of their own, and a page never shows Back and Cancel for one move.

## Type

One token per role, never a hand-set font size, weight or line height:
`title`, `body` under it, `heading`, `label`, `caption`,
`hero`/`heroUnit`/`heroCaption`, `bodyStrong` and `mono`. Every amount
figure uses `hero`. A chevron is `ChevronRightIcon`, not a glyph.

## Alignment

Everything is left-aligned except the hero block, the Sent page, result and
empty states, and two shapes decided on 2026-10-05:

- a page head with an icon over its title and line (decided 2026-10-05: "the
  two attached screens look super awkward if the icons are on the left,
  please bring them back to the center");
- a live status card (decided 2026-10-05: "simply delete the word 'status' above 'connect', so lets
  go back to how that looked like before the change").

The pieces that draw them:

- Page heads: `ui/components/PageHead` is the one piece: the icon, a tag
  when the page has one, the title with its info dot beside it
  (`InfoHeading`) and the line under it, all centred and wrapping centred,
  `md` between them. The Rescue page's head and its result, Support and the
  Estate Plan sign-in's three steps use it, and every page head of that
  shape must. The cards, lists and fields under the head stay left;
  a title WITHOUT an icon stays left, and an icon in a ROW beside a title (the done
  heads) is another shape and stays as it is. `pageHead.test.ts` sweeps
  every screen for an icon over a title drawn by hand.
- Status cards: `ui/components/StatusCard` is the one piece: NO heading, the whole card centred: the
  state pill, what it is connected to in mono and the detail line, long
  lines wrapping centred. The Network page and the portfolio sync page use
  it, and every live connection or sync status card must. A label and value
  row (two-factor On/Off), a list row with a status subtitle and a form's
  progress caption are other roles and stay left.

## Spacing between things

The gutter is `lg` on every page and on the footer; `md` between a title,
its line and the first card; `lg` between cards; `sm` between buttons. No
literal spacing numbers.
