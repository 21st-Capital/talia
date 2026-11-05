/**
 * Every page's actions at the foot (decided 2026-10-05: "move all the buttons to
 * the bottom of the page. Currently, some pages show the cancel or back
 * button in the middle and some at the bottom").
 *
 * Structural, like sentPage: the repo has no component tests, and each rule
 * below is a line a later edit could quietly drop.
 *
 *   - `Screen` offers ONE pinned bottom area, `PageFooter`, after its scroll
 *     view; the content keeps the footer's room clear and gives the safe
 *     area to the footer;
 *   - the footer stands above the home indicator, rises with the keyboard
 *     (field AND button above the keys) and dissolves what scrolls under it;
 *   - inside every footer the ghost Back/Cancel comes last and brings no
 *     spacing of its own;
 *   - the signing screen's Bluetooth step, a phone test's screenshot, keeps its Back
 *     in the footer, the courier's buttons with it;
 *   - the hardware step draws no button: every host takes its one Back into
 *     its footer (or a sheet's foot), as "Back" while there is a step inside
 *     the screen to return to and otherwise the screen's own "Cancel", never
 *     both (the second screenshot, the address check on a Ledger), and no
 *     host page ends without that one button;
 *   - the reveal hook measures against the scroll area's own edge where it
 *     ends above the keys (a sheet's foot), so a field's confirm clears it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { typography } from '../theme';

const UI = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The source from `from` up to the next `to` after it. Both must exist. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect({ from, found: a >= 0 }).toEqual({ from, found: true });
  const b = src.indexOf(to, a + from.length);
  expect({ to, found: b >= 0 }).toEqual({ to, found: true });
  return src.slice(a, b);
}

/** The text inside the braces that open at `open` (the index of the `{`). */
function braced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces');
}

/**
 * The statement that starts at `from`, up to its `;` outside every bracket:
 * a `const footer = …;` whose value is JSX, a ternary or an IIFE.
 */
function statement(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(from, i);
  }
  throw new Error('unterminated statement');
}

/** The body of the function whose `function` keyword is at `from`. */
function functionBody(src: string, from: number): string {
  // Past the parameter list (which may hold destructuring braces) first.
  let depth = 0;
  let i = src.indexOf('(', from);
  for (; i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')' && --depth === 0) break;
  }
  return braced(src, src.indexOf('{', i));
}

/**
 * The buttons that render TOGETHER in a block: each outermost `<>…</>`
 * fragment or `<PageFooter>…</PageFooter>` element is one column (a footer
 * with several branches, as the signing screen's switch, Share portfolio's
 * ternary or Two-factor's three PageFooters, holds one per branch and their
 * buttons never share a column); a block with neither (a `<PageFooter>`'s
 * children, a lone button) is one column itself.
 */
function columns(block: string): string[] {
  const out: string[] = [];
  const opens = ['<>', '<PageFooter>'];
  const closes = ['</>', '</PageFooter>'];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < block.length; i++) {
    const open = opens.find((t) => block.startsWith(t, i));
    const close = closes.find((t) => block.startsWith(t, i));
    if (open) {
      if (depth === 0) start = i;
      depth += 1;
      i += open.length - 1;
    } else if (close) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(block.slice(start, i + close.length));
        start = -1;
      }
      i += close.length - 1;
    }
  }
  return out.length > 0 ? out : [block];
}

/**
 * Every footer's JSX in a file: `<PageFooter>…</PageFooter>`, `footer={…}`,
 * and the footers built apart from the element, as `const footer =`,
 * `const stepFooter =` or `const pageFooter =` (the signing screen, the
 * refresh session, Share portfolio, Vault sync, Import), and the functions
 * that render a step's buttons for a host's footer (`…Footer`,
 * `…FooterButtons`: the co-sign panel's, the courier's).
 */
function footerBlocks(src: string): string[] {
  const out: string[] = [];
  const tag = /<PageFooter>([\s\S]*?)<\/PageFooter>/g;
  for (let m = tag.exec(src); m; m = tag.exec(src)) out.push(m[1]);
  const prop = /\bfooter=\{/g;
  for (let m = prop.exec(src); m; m = prop.exec(src)) out.push(braced(src, m.index + 'footer='.length));
  const named = /\bconst (footer|stepFooter|pageFooter) =/g;
  for (let m = named.exec(src); m; m = named.exec(src)) out.push(statement(src, m.index));
  const fn = /\bfunction \w*Footer(Buttons)?\(/g;
  for (let m = fn.exec(src); m; m = fn.exec(src)) out.push(functionBody(src, m.index));
  return out;
}

describe('the pinned page footer', () => {
  it('Screen offers a footer slot and mounts PageFooter after the scroll view', () => {
    const screen = code(read('components/Screen.tsx'));
    expect(screen).toMatch(/footer\?: React\.ReactNode;/);
    expect(screen).toMatch(/\{footed && <PageFooter>\{footer\}<\/PageFooter>\}/);
    // The content keeps the footer's room clear; the safe area is the footer's.
    expect(screen).toMatch(/paddingBottom: footed \? FOOTER_ROOM : insets\.bottom \+ theme\.spacing\.lg,/);
    // Keyboard: the footer's rise shortens the scroll area, so no inset on
    // top of it, and only the field is scrolled clear of the fade. The
    // keyboard props come from the one helper, so a footer arriving with the
    // keys up takes back the inset the automatic mode set (decided 2026-10-18,
    // codeFieldAboveKeys.test.ts).
    expect(screen).toMatch(/\{\.\.\.keyboardInsets\(footed\)\}/);
    expect(screen).not.toMatch(/automaticallyAdjustKeyboardInsets=/);
    expect(screen).toMatch(/useRevealFocusedField\(innerRef, offsetY, !!scroll, \{ confirmPinned: footed \}\)/);
    // The keyboard fade stays for pages without a footer.
    expect(screen).toMatch(/\{!footed && kbHeight > 0 && <FadeEdge bottom=\{kbHeight\} \/>\}/);
    // The non-scrolling page keeps its one padded root unless it has a footer.
    expect(screen).toMatch(/if \(!footed\) \{\s*return \(\s*<View style=\{\[styles\.root, pad, style\]\}>/);
    expect(code(read('components/index.ts'))).toMatch(/export \{ PageFooter, FOOTER_ROOM \} from '\.\/PageFooter';/);
  });

  it('PageFooter stands above the safe area, rises with the keyboard, and dissolves what scrolls under it', () => {
    const footer = code(read('components/PageFooter.tsx'));
    expect(footer).toMatch(/useSafeAreaInsets\(\)/);
    expect(footer).toMatch(/useKeyboardHeight\(\)/);
    expect(footer).toMatch(/kbHeight > 0 \? kbHeight \+ theme\.spacing\.md : insets\.bottom \+ theme\.spacing\.lg/);
    // Fade under anything pinned (decided 2026-09-12): the footer carries its own,
    // hung off its top edge over the scroll area, and the content pads by it.
    expect(footer).toMatch(/<FadeEdge \/>/);
    expect(footer).toMatch(/top: -FADE_EDGE_H/);
    expect(footer).toMatch(/export const FOOTER_ROOM = FADE_EDGE_H \+ theme\.spacing\.sm;/);
    // The page gutter and the buttons' gap come from the theme; themed sheet;
    // no ground over the glow; colour, never opacity.
    expect(footer).toMatch(/paddingHorizontal: theme\.spacing\.lg,/);
    expect(footer).toMatch(/gap: theme\.spacing\.sm,/);
    expect(footer).toMatch(/themedStyles\(/);
    expect(footer).not.toMatch(/backgroundColor/);
    expect(footer).not.toMatch(/\bopacity\s*:/);
  });

  it("the reveal hook lifts only the field when the confirm is pinned, and never measures past the scroll area's own edge", () => {
    const hook = code(read('hooks/useRevealFocusedField.ts'));
    expect(hook).toMatch(/confirmPinned\?: boolean;/);
    expect(hook).toMatch(/wanted: fieldBottom \+ FADE_EDGE_H \+ 4,/);
    // The floor is the keys or the scroll area's bottom edge, whichever is
    // higher, in BOTH modes (decided 2026-10-05: the key sheet's Add key was
    // scrolled clear of the keys alone and landed under the foot's Back).
    expect(hook).toMatch(/const floor = revealFloor\(top, host\.y \+ host\.h\);/);
    expect(hook.match(/keyboardTop: floor,/g)).toHaveLength(2);
    expect(hook).not.toMatch(/keyboardTop: top,|keyboardTop: Math\.min\(/);
  });

  it('inside every footer the ghost Back/Cancel comes last, with no spacing of its own', () => {
    const files = sources(UI).filter((f) => /\/(screens|components)\//.test(f));
    let footers = 0;
    // The footers built apart from the element are scanned too (decided
    // 2026-10-05: they held most of the step footers and were not checked).
    const scanned = footerBlocks(code(read('screens/SignPsbtScreen.tsx')));
    expect(scanned.some((b) => /Complete and send/.test(b) && /Back to all keys/.test(b))).toBe(true);
    expect(footerBlocks(code(read('components/CosignRequestPanel.tsx'))).some((b) => /actions\.primary/.test(b))).toBe(true);
    expect(footerBlocks(code(read('screens/ImportScreen.tsx'))).some((b) => /Add this vault/.test(b))).toBe(true);
    for (const f of files) {
      const rel = f.slice(UI.length + 1);
      for (const block of footerBlocks(code(readFileSync(f, 'utf8')))) {
        footers += 1;
        for (const column of columns(block)) {
          const buttons = column.match(/<Button\b[\s\S]*?\/>/g) ?? [];
          let ghostSeen = false;
          for (const b of buttons) {
            const ghost = /variant="ghost"/.test(b);
            const conditional = /variant=\{/.test(b);
            if (ghostSeen && !ghost && !conditional) {
              throw new Error(`${rel}: a primary button under a ghost one in a footer:\n${column}`);
            }
            if (ghost) ghostSeen = true;
          }
        }
        // The footer owns the spacing: no AFTER_SCAN, no margin on a button.
        expect({ rel, afterScan: /AFTER_SCAN/.test(block) }).toEqual({ rel, afterScan: false });
        expect({ rel, margin: /margin(Top|Bottom)/.test(block) }).toEqual({ rel, margin: false });
      }
    }
    expect(footers).toBeGreaterThan(0);
  });

  it("the signing screen's Bluetooth step keeps its Back in the footer, the courier's buttons too", () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    // Nothing to tap in the flow of the step: the search, the device's turn
    // pages and the courier draw the content alone.
    const step = between(sign, "{phase === 'bluetooth' && wallet != null && (", "{phase === 'file' && (");
    expect(step).not.toMatch(/<Button\b/);
    expect(sign).toMatch(/const footed = phase === 'bluetooth' && wallet != null;/);
    // The step's ONE Back (hww-signing, decided 2026-10-05: to the device list
    // first, then the key list) is the step's to decide and this footer's to
    // draw: handed over, never drawn under the step as well.
    expect(step).toMatch(/onBack=\{backFromDevice\}\s*onFooterBack=\{setStepBack\}/);
    expect(sign).toMatch(/<PageFooter>\s*<Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/>\s*<\/PageFooter>/);
    // The courier's buttons, from the one hook, once the transaction is on its way.
    expect(sign).toMatch(/const courierFoot = footed \? signing\.footer\(backFromDevice\) : null;/);
    expect(sign).toMatch(/courierFoot != null && <PageFooter>\{courierFoot\}<\/PageFooter>/);
    expect(sign).toMatch(/footed && styles\.contentFooted/);
    expect(sign).toMatch(/contentFooted: \{ paddingBottom: FOOTER_ROOM \}/);
    // The ferries' way back is the method step's one Back, never a second one
    // in the flow: out of the ferries to the device list first.
    expect(sign).not.toMatch(/<ChooseAnother\b/);
    expect(sign).toMatch(/<Button title="Back" variant="ghost" onPress=\{ferries \? \(\) => setFerries\(false\) : backFromDevice\} \/>/);

    // The refresh session's signing step: the same Back, the same courier buttons.
    const session = code(read('screens/RefreshSessionScreen.tsx'));
    expect(session).toMatch(/onBack=\{\(\) => setPhase\('summary'\)\}\s*onFooterBack=\{setStepBack\}/);
    expect(session).toMatch(
      /case 'sign':\s*if \(signing\.courier != null\) return signing\.footer\(\(\) => setPhase\('summary'\)\);\s*return stepBack != null \? <Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/> : null;/,
    );

    // The hook hands the footer the courier's buttons only while there are
    // any, read off the feed as a yes or no, so a footer is never empty and
    // the screen never redraws with the feed.
    const hook = code(read('hooks/useSigningCourier.tsx'));
    expect(hook).toMatch(/const footShown = useSyncExternalStore\(feed\.subscribe, \(\) => courierFootShown\(feed\.get\(\)\)\);/);
    expect(hook).toMatch(/courier == null \|\| !footShown \? null : <SigningCourierFooter feed=\{feed\} onBack=\{onBack\} onRetry=\{retry\} \/>/);

    const courier = code(read('components/SigningCourier.tsx'));
    const page = between(courier, 'export function SigningCourier(', 'export function SigningCourierFooter(');
    expect(page).not.toMatch(/<Button\b/);
    expect(courier).toMatch(/return backShown\(state\) !== 'none' \|\| state\.leg === 'declined' \|\| state\.leg === 'failed';/);
    const foot = courier.slice(courier.indexOf('export function SigningCourierFooter('));
    // Same words, same handlers, same hold: Try again then Back once the
    // device declined or the link failed; Back alone while on its way.
    expect(foot).toMatch(/if \(back === 'none' && !ended\) return null;/);
    expect(foot).toMatch(
      /<>\s*\{ended && <Button title="Try again" onPress=\{onRetry\} \/>\}\s*<Button title="Back" variant="ghost" onPress=\{onBack\} disabled=\{back === 'held'\} \/>\s*<\/>/,
    );
  });

  it("the hardware step draws no button: its one Back is every host's footer's, never beside a Cancel", () => {
    // The step decides where its Back goes and hands it over (`onFooterBack`,
    // required, so a host cannot forget it); it draws no Button of its own,
    // and neither do the flows and pickers it mounts (decided 2026-10-05, a
    // screenshot of the address check with Back and Cancel stacked mid-page).
    // Reconnect and the hint over it, text that belongs to the drawing, stay
    // in the content.
    const step = code(read('components/HardwareConnect.tsx'));
    expect(step).toMatch(/onFooterBack: \(back: StepBack \| null\) => void;/);
    expect(step).not.toMatch(/<Button\b|from '\.\/Button'|ChooseAnother|AFTER_SCAN|backUnder|withBack/);
    expect(step).toMatch(/<StepLink label=\{RECONNECT\} onPress=\{reconnect\} \/>/);
    expect(step).toMatch(/<Text style=\{styles\.hint\}>\{reconnectHint\(modelInfo\(pick\)\.kind\)\}<\/Text>/);
    for (const rel of ['components/HwwConnectFlow.tsx', 'components/LedgerConnectFlow.tsx', 'components/DeviceTurn.tsx', 'components/TurnSlide.tsx', 'components/DevicePicker.tsx', 'components/KeyDevicePicker.tsx']) {
      expect({ rel, button: /<Button\b/.test(code(read(rel))) }).toEqual({ rel, button: false });
    }
    // AFTER_SCAN went with the last in-flow button.
    expect(code(read('components/HwwConnectFlow.tsx'))).not.toMatch(/AFTER_SCAN/);
    expect(code(read('components/index.ts'))).not.toMatch(/ChooseAnother|AFTER_SCAN/);

    // Every host hands the Back over, once per mount, and draws it as ONE
    // ghost "Back": in its footer, or at a sheet's foot right under the
    // scroll area; outside the step's slide either way.
    const hosts = sources(UI).filter((f) => /\/(screens|components)\//.test(f) && /<HardwareConnect\b/.test(code(readFileSync(f, 'utf8'))));
    expect(hosts.map((f) => f.slice(UI.length + 1)).sort()).toEqual([
      'components/KeyEntrySheet.tsx',
      'screens/ImportScreen.tsx',
      'screens/RefreshSessionScreen.tsx',
      'screens/RegisterHardwareScreen.tsx',
      'screens/ReplaceDeviceScreen.tsx',
      'screens/SignPsbtScreen.tsx',
      'screens/VaultBuilderScreen.tsx',
      'screens/VerifyAddressScreen.tsx',
    ]);
    for (const f of hosts) {
      const rel = f.slice(UI.length + 1);
      const src = code(readFileSync(f, 'utf8'));
      const mounts = src.match(/<HardwareConnect\b/g)?.length ?? 0;
      const handed = src.match(/onFooterBack=\{setStepBack\}/g)?.length ?? 0;
      expect({ rel, mounts, handed }).toEqual({ rel, mounts, handed: mounts });
      expect({ rel, back: /<Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/>/.test(src) }).toEqual({ rel, back: true });
      expect({ rel, inFlow: /ChooseAnother|AFTER_SCAN/.test(src) }).toEqual({ rel, inFlow: false });
      // One button for one move: a footer column that holds the step's Back
      // and the screen's Cancel holds them as either/or, never stacked.
      for (const block of footerBlocks(src)) {
        for (const column of columns(block)) {
          if (/title="Back"/.test(column) && /title="Cancel"/.test(column)) {
            expect({ rel, eitherOr: /onPress=\{stepBack\.onPress\} \/>\s*\)?\s*:\s*\(?\s*<Button\s+title="Cancel"/.test(column) }).toEqual({ rel, eitherOr: true });
          }
        }
      }
    }
    // The sheets keep their own foot: the Back right under the scroll area.
    expect(code(read('components/KeyEntrySheet.tsx'))).toMatch(
      /<\/ScrollView>\s*\{stepBack != null && \(\s*<View style=\{styles\.sheetFoot\}>\s*<Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/>\s*<\/View>\s*\)\}/,
    );
    // The vault builder's: "Remove this key", the sheet's own action, at the
    // foot over the Back, never inside the scroll area under the device
    // drawing (decided 2026-10-05: two outlined buttons stacked, one mid-sheet).
    const builder = code(read('screens/VaultBuilderScreen.tsx'));
    expect(builder).toMatch(
      /<\/ScrollView>\s*\{\(replaceXpub != null \|\| stepBack != null\) && \(\s*<View style=\{styles\.sheetFoot\}>\s*\{replaceXpub != null && \(\s*<Button\s+title="Remove this key"\s+variant="ghost"[\s\S]*?\/>\s*\)\}\s*\{stepBack != null && <Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/>\}\s*<\/View>\s*\)\}/,
    );
    expect(between(builder, 'contentContainerStyle={styles.sheetScrollContent}>', '</ScrollView>')).not.toMatch(/Remove this key/);
    // One foot for both sheets: the buttons' gap above and between them.
    for (const rel of ['components/KeyEntrySheet.tsx', 'screens/VaultBuilderScreen.tsx']) {
      expect(code(read(rel))).toMatch(/sheetFoot: \{ paddingTop: theme\.spacing\.sm, gap: theme\.spacing\.sm \},/);
    }

    // Every host page ends in the ONE button (decided 2026-10-05: only the
    // address check, signing and the refresh session did; registration from
    // the checklist, the key and device lists and the import's list had none).
    // The address check, as in the screenshot: Back while there is a list to
    // return to, else Cancel.
    expect(code(read('screens/VerifyAddressScreen.tsx'))).toMatch(
      /footer=\{stepBack != null \? <Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/> : <Button title="Cancel" variant="ghost" onPress=\{\(\) => navigation\.goBack\(\)\} \/>\}/,
    );
    // Registration and Replace: the Passport page's Scan the code over the
    // same either/or, on every page of the step.
    for (const rel of ['screens/RegisterHardwareScreen.tsx', 'screens/ReplaceDeviceScreen.tsx']) {
      expect(code(read(rel))).toMatch(
        /\{scanCode && <Button title="Scan the code" onPress=\{[^}]*\} \/>\}\s*\{stepBack != null \? <Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/> : <Button title="Cancel" variant="ghost" onPress=\{\(\) => navigation\.goBack\(\)\} \/>\}/,
      );
    }
    const register = code(read('screens/RegisterHardwareScreen.tsx'));
    expect(register).toMatch(/const stepFooter = \(\s*<>/);
    expect(register).toMatch(/<Screen scroll footer=\{stepFooter\}>/);
    const replace = code(read('screens/ReplaceDeviceScreen.tsx'));
    // Replace: while the step is on the page (nothing is tappable while the
    // key is saved); with several keys the key picker is a step inside the
    // screen, so the device list's Back returns to it; the picker itself,
    // the first list, ends in Cancel as the address check's key list does.
    expect(replace).toMatch(/const stepFooter = connecting \? \(\s*<>/);
    expect(replace).toMatch(/onBack=\{keys\.length > 1 \? \(\) => setPicked\(null\) : undefined\}/);
    expect(replace).toMatch(/<Screen scroll footer=\{<Button title="Cancel" variant="ghost" onPress=\{\(\) => navigation\.goBack\(\)\} \/>\}>\s*<InfoHeading/);
    // The import: on the locked backup the step's Back takes Cancel's place
    // while the step has one; on a product's search the same either/or, the
    // Cancel leaving for the products the device was picked from.
    const importSrc = code(read('screens/ImportScreen.tsx'));
    expect(importSrc).toMatch(/\{hwwUnlocking && stepBack != null \? \(\s*<Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/>\s*\) : \(\s*<Button\s+title="Cancel"/);
    expect(importSrc).toMatch(/const hwwStep = methods\.includes\('ble'\) && bleOpen;/);
    expect(importSrc).toMatch(
      /\{hwwStep && \(stepBack != null \? <Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/> : <Button title="Cancel" variant="ghost" onPress=\{\(\) => navigation\.goBack\(\)\} \/>\)\}/,
    );
  });

  it('the line under a hero figure and a bold body word have their own tokens', () => {
    expect(typography.heroCaption).toEqual({ fontSize: 17, lineHeight: 22, fontWeight: '400', fontFamily: 'Figtree' });
    // The body's size and leading, the body's face, one weight up.
    expect(typography.bodyStrong).toEqual({ ...typography.body, fontWeight: '600' });
  });
});
