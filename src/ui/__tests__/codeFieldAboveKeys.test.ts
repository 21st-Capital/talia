/**
 * The code boxes AND their Paste stay above the keys on every page that asks
 * for a code (decided 2026-10-18, from screenshots of the co-signing request:
 * "The authenticator code request moves all the way up beyond the screen
 * when the key pad spaces are clicked so the user doesnt see the numbers
 * anymore!").
 *
 * Structural, like pageFooter and hwwSigning: the repo has no component
 * tests, and each rule below is a line a later edit could quietly drop. The
 * cause, reproduced on the iPhone 17 and iPhone SE simulators, had two halves:
 *   - React Native keeps the keyboard inset its automatic mode set when the
 *     mode is switched off, which the signing screen did the moment the
 *     authenticator step's footer arrived with the keys still up (308pt of
 *     room past the end of the page on an iPhone 17);
 *   - the signing screen then scrolled to the END of the page on every
 *     keyboard, which with that inset left only the end of the error line
 *     and Back above the keys.
 * And on an iPhone SE, once that was gone, the boxes arrived right on the
 * footer with the Paste under it: the scroller took a field scrolled under
 * the footer for another screen's, and measured the invisible input over the
 * boxes alone.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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

const rel = (f: string) => f.slice(UI.length + 1);

/** Every file that draws a six-digit code field, itself or through the shared steps. */
const CODE_FIELD = /<(CodeField|AuthenticatorStep|CosignRequestPanel)\b/;
const codeFiles = () => sources(UI).filter((f) => CODE_FIELD.test(code(readFileSync(f, 'utf8'))));

/**
 * Each JSX `<ScrollView` in a source, its opening tag and what it holds up to
 * its own `</ScrollView>`. None of these files nests one in another, and a
 * nested one would end the outer block early, so that is refused.
 */
function scrollBlocks(src: string): { opening: string; body: string }[] {
  // A JSX opening, never the `useRef<ScrollView | null>` type.
  return [...src.matchAll(/(?<![\w.])<ScrollView[\s>]/g)].map((m) => {
    const start = m.index ?? 0;
    const close = src.indexOf('</ScrollView>', start);
    const block = src.slice(start, close);
    expect(block.slice(1).includes('<ScrollView')).toBe(false);
    // The opening tag ends at its first `>` outside the braces of its props
    // (`onScroll={(e) => {...}}` holds one).
    let depth = 0;
    let openEnd = block.length;
    for (let i = 0; i < block.length; i += 1) {
      const ch = block[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        openEnd = i + 1;
        break;
      }
    }
    return { opening: block.slice(0, openEnd), body: block };
  });
}

/** The pieces that draw the field inside a host's scroll view, never a page of their own. */
const CONTENT = ['components/AuthenticatorStep.tsx', 'components/CosignRequestPanel.tsx'];

describe('the code field above the keys', () => {
  it('knows every page that asks for a code', () => {
    expect(codeFiles().map(rel).sort()).toEqual([
      'components/AuthSheet.tsx',
      'components/AuthenticatorStep.tsx',
      'components/CosignRequestPanel.tsx',
      'screens/CosignLimitsScreen.tsx',
      'screens/InheritanceScreen.tsx',
      'screens/RefreshSessionScreen.tsx',
      'screens/RescueScreen.tsx',
      'screens/SignPsbtScreen.tsx',
      'screens/TwoFactorScreen.tsx',
    ]);
  });

  it('no page that asks for a code scrolls to its end: the shared scroller lifts the field, bounded', () => {
    for (const f of codeFiles()) {
      const src = code(readFileSync(f, 'utf8'));
      expect({ file: rel(f), scrollToEnd: /scrollToEnd\(/.test(src) }).toEqual({ file: rel(f), scrollToEnd: false });
      if (CONTENT.includes(rel(f))) continue;
      // Its scroll view runs useRevealFocusedField, itself or through Screen.
      const lifted = /useRevealFocusedField\(/.test(src) || /<Screen\b[^>]*?\bscroll\b/.test(src);
      expect({ file: rel(f), lifted }).toEqual({ file: rel(f), lifted: true });
    }
  });

  it('no scroll view switches the automatic keyboard inset by hand: the one helper writes the footer in', () => {
    // ArrangeModal is a full-screen modal with no PageFooter: its automatic
    // inset is never switched off, so it can never be left behind.
    const allowed = ['hooks/keyboardInsets.ts', 'components/ArrangeModal.tsx'];
    for (const f of sources(UI)) {
      if (allowed.includes(rel(f))) continue;
      const src = code(readFileSync(f, 'utf8'));
      expect({ file: rel(f), byHand: /automaticallyAdjustKeyboardInsets/.test(src) }).toEqual({ file: rel(f), byHand: false });
    }
    expect(code(read('components/Screen.tsx'))).toMatch(/\{\.\.\.keyboardInsets\(footed\)\}/);
  });

  it('the signing screen: the helper with its footer, the shared scroller, its offset and its growth', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    expect(sign).toMatch(/\{\.\.\.keyboardInsets\(footed \|\| stepFooter != null\)\}/);
    // Every action of the page is in its footer, so only the field is lifted.
    expect(sign).toMatch(/const \{ reveal \} = useRevealFocusedField\(rootScrollRef, rootOffsetY, phase === 'cosign', \{ confirmPinned: true \}\);/);
    expect(sign).toMatch(/onScroll=\{\(e\) => \{\s*rootOffsetY\.current = e\.nativeEvent\.contentOffset\.y;\s*\}\}/);
    expect(sign).toMatch(/onContentSizeChange=\{reveal\}/);
    expect(sign).not.toMatch(/Keyboard\.addListener/);
  });

  it('two-factor setup lifts its code with the same scroller', () => {
    const tfa = code(read('screens/TwoFactorScreen.tsx'));
    expect(tfa).toMatch(/const \{ reveal \} = useRevealFocusedField\(scrollRef, offsetY, stage === 'setup', \{ confirmPinned: true \}\);/);
    expect(tfa).toMatch(/onScroll=\{\(e\) => \{\s*offsetY\.current = e\.nativeEvent\.contentOffset\.y;\s*\}\}/);
    expect(tfa).toMatch(/onContentSizeChange=\{reveal\}/);
    expect(tfa).not.toMatch(/Keyboard\.addListener/);
  });

  it("the Estate Plan sign-in: React keeps ONE scroll view across its stages, and every stage says whether it has a footer", () => {
    const estate = code(read('screens/InheritanceScreen.tsx'));
    // Each JSX opening (never the `useRef<ScrollView | null>` type), up to
    // its content style, carries the helper.
    const openings = [...estate.matchAll(/<ScrollView[\s]/g)].map((m) =>
      estate.slice(m.index, estate.indexOf('contentContainerStyle=', m.index)),
    );
    expect(openings.length).toBeGreaterThanOrEqual(4);
    for (const opening of openings) {
      expect(opening).toMatch(/\{\.\.\.keyboardInsets\((true|false|teaserOffered)\)\}/);
    }
    // The emailed code has no footer; the authenticator code has Cancel.
    const stage = (tag: string) => scrollBlocks(estate).find((b) => b.body.includes(tag));
    expect(stage('tag="EMAIL CODE"')?.opening).toMatch(/\{\.\.\.keyboardInsets\(false\)\}\s*style=\{styles\.root\}\s*contentContainerStyle=\{\[styles\.content, safeBottom\]\}/);
    expect(stage('tag="AUTHENTICATOR CODE"')?.opening).toMatch(/\{\.\.\.keyboardInsets\(true\)\}/);
    expect(code(read('screens/InheritanceScreen.tsx'))).toMatch(/const \{ reveal \} = useRevealFocusedField\(revealScrollRef, revealOffsetY, true, \{ confirmPinned: formFooted \}\);/);
  });

  it('every scroll view that holds a code field is the scroller’s: its ref, its offset and its growth (decided 2026-10-18)', () => {
    // Checked per SCROLL VIEW, not per file: the Estate Plan called the
    // scroller once, while its emailed-code stage, one of five scroll views
    // in that file, passed no ref, so React set the shared ref to null there
    // and nothing lifted that code or its error line.
    let checked = 0;
    for (const f of codeFiles()) {
      for (const { opening, body } of scrollBlocks(code(readFileSync(f, 'utf8')))) {
        if (!CODE_FIELD.test(body)) continue;
        checked += 1;
        const has = {
          file: rel(f),
          ref: /\bref=\{\w+\}/.test(opening),
          offset: /onScroll=\{\(e\) => \{\s*\w+\.current = e\.nativeEvent\.contentOffset\.y;\s*\}\}/.test(opening),
          growth: /onContentSizeChange=\{reveal\}/.test(opening),
        };
        expect(has).toEqual({ file: rel(f), ref: true, offset: true, growth: true });
      }
    }
    // The Estate Plan's two code stages, the signing screen, two-factor setup and the login sheet.
    expect(checked).toBe(5);
  });

  it('the code field is ONE field to the scroller: the boxes, the Paste and the error', () => {
    const field = code(read('components/CodeField.tsx'));
    expect(field).toMatch(/registerFieldExtent\(\{\s*focused: \(\) => inputRef\.current\?\.isFocused\(\) \?\? false,\s*extent: \(\) => fieldRef\.current,\s*\}\)/);
    // The registered view is the outer one, and the Paste and the error are inside it.
    const view = field.slice(field.indexOf('<View ref={fieldRef} style={cf.container}>'));
    expect(view.startsWith('<View ref={fieldRef} style={cf.container}>')).toBe(true);
    const body = view.slice(0, view.indexOf('\n  );\n}'));
    expect(body).toMatch(/title="Paste code"/);
    expect(body).toMatch(/style=\{cf\.error\}/);
    expect(body).toMatch(/<TextInput\b/);
  });

  it('the scroller keeps the extent clear, asks the view tree whose field it is, and keeps the input on screen', () => {
    const hook = code(read('hooks/useRevealFocusedField.ts'));
    expect(hook).toMatch(/measure\(focusedFieldExtent\(\)\)/);
    expect(hook).toMatch(/const fieldBottom = revealSpan\(field, extent\)\.bottom;/);
    // The tree first; the old overlap test only when the tree cannot say.
    expect(hook).toMatch(/contains\(scroller, input\)/);
    expect(hook).toMatch(/if \(!\(inside \?\? overlapsHost\(field, host\)\)\) return;/);
    expect(hook).not.toMatch(/field\.y \+ field\.h <= host\.y \|\| field\.y >= host\.y \+ host\.h/);
    // The bound still measures from the input's own top.
    expect(hook.match(/fieldTop: field\.y,/g)).toHaveLength(2);
  });

  it('a footer that mounts with the keys up starts above them', () => {
    const kb = code(read('hooks/useKeyboardHeight.ts'));
    expect(kb).toMatch(/return Keyboard\.isVisible\(\) \? Keyboard\.metrics\(\)\?\.height \?\? 0 : 0;/);
    expect(kb).toMatch(/const \[height, setHeight\] = useState\(heightNow\);/);
    // The did-events back the will-events up, without an animation of their own.
    expect(kb).toMatch(/Keyboard\.addListener\('keyboardDidShow', \(e\) => moveTo\(e\.endCoordinates\.height\)\)/);
    expect(kb).toMatch(/Keyboard\.addListener\('keyboardDidHide', \(\) => moveTo\(0\)\)/);
  });

  it('the keyboard’s animation is configured only for a height that changes (decided 2026-10-18)', () => {
    // configureNext applies to the next render of the whole app: one
    // configured for a height the view already has renders nothing and lands
    // on the next, unrelated, render. The behaviour is mounted in
    // hooks/__tests__/useKeyboardHeight.test.tsx; this pins the one call.
    const kb = code(read('hooks/useKeyboardHeight.ts'));
    expect(kb.match(/LayoutAnimation\.configureNext\(/g)).toHaveLength(1);
    expect(kb).toMatch(/if \(glideMs != null && next !== current\.current\) \{\s*LayoutAnimation\.configureNext\(/);
    // Every height the view takes goes through the one move, which keeps the ref.
    expect(kb.match(/setHeight\(/g)).toHaveLength(1);
    expect(kb).toMatch(/current\.current = next;\s*setHeight\(next\);/);
  });

  it('the keyboard waits while a step slides in (decided 2026-10-18: the authenticator step went invisible after a pasted code)', () => {
    // The keyboard's animation carried the sliding step's stale start (native
    // driver) onto the screen. Mounted in useKeyboardHeight.test.tsx,
    // stepTransitionHold.test.tsx and stepSlides.test.ts; this pins the wiring.
    const kb = code(read('hooks/useKeyboardHeight.ts'));
    expect(kb).toMatch(/import \{ slidesRunning, whenSlidesLand \} from '\.\.\/components\/stepSlides';/);
    expect(kb).toMatch(/if \(!slidesRunning\(\) && held == null\) \{\s*apply\(next, glideMs\);\s*return;\s*\}/);
    expect(kb).toMatch(/stopWaiting = whenSlidesLand\(land\);\s*cap = setTimeout\(land, SLIDE_HOLD_CAP_MS\);/);
    // The slide is counted BEFORE its values move and released only once React caught up.
    const slide = code(read('components/StepTransition.tsx'));
    expect(slide).toMatch(/const done = slideStarted\(\);\s*landed\.current = done;\s*tx\.setValue\(/);
    expect(slide).toMatch(/\]\)\.start\(\(\) => \{\s*setTimeout\(done, SLIDE_SETTLE_MS\);\s*\}\);/);
    expect(slide).toMatch(/useEffect\(\(\) => \(\) => landed\.current\?\.\(\), \[\]\);/);
    // Still the native driver: the fix is the keyboard's wait, never a slower slide.
    expect(slide.match(/useNativeDriver: true/g)).toHaveLength(2);
    // Nothing else configures a keyboard animation of its own.
    for (const f of sources(UI)) {
      if (rel(f) === 'hooks/useKeyboardHeight.ts') continue;
      const src = code(readFileSync(f, 'utf8'));
      if (!/Keyboard\.addListener/.test(src)) continue;
      expect({ file: rel(f), configures: /LayoutAnimation\.configureNext/.test(src) }).toEqual({ file: rel(f), configures: false });
    }
  });

  it("Send's own step slide makes the keyboard wait too (decided 2026-11-05: the amount step sometimes stayed blank with only Continue on screen)", () => {
    // Send slides its steps itself, and the amount step's field opens the
    // keyboard as it slides in, so its slide must be counted like
    // StepTransition's: before the value moves, released once React caught
    // up, and on leaving the page; applied before the step first paints.
    const send = code(read('screens/SendScreen.tsx'));
    expect(send).toMatch(/import \{ slideStarted \} from '\.\.\/components\/stepSlides';/);
    expect(send).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(prevStep\.current === step\) return;/);
    expect(send).toMatch(/const done = slideStarted\(\);\s*slideLanded\.current = done;\s*slide\.setValue\(/);
    expect(send).toMatch(/useNativeDriver: true,\s*\}\)\.start\(\(\) => \{\s*setTimeout\(done, SLIDE_SETTLE_MS\);\s*\}\);/);
    expect(send).toMatch(/useEffect\(\(\) => \(\) => slideLanded\.current\?\.\(\), \[\]\);/);
    // Any other page that slides on the native driver AND opens the keyboard
    // by itself counts its slide the same way, or uses StepTransition.
    for (const f of sources(UI)) {
      const src = code(readFileSync(f, 'utf8'));
      if (!/useNativeDriver: true/.test(src) || !/autoFocus/.test(src)) continue;
      expect({ file: rel(f), counted: /slideStarted\(\)|<StepTransition\b/.test(src) }).toEqual({ file: rel(f), counted: true });
    }
  });
});
