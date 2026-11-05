/**
 * A page head with an icon over its title and line is CENTRED (decided
 * 2026-10-05, from Rescue and Support screenshots after a layout pass left-aligned
 * them: "the two attached screens look super awkward if the icons are on the
 * left, please bring them back to the center").
 *
 * Structural, like pageFooter: the repo has no component tests, and each
 * rule below is a line a later edit could quietly drop.
 *
 *   - `PageHead` is the one piece: the icon, a tag when there is one, the
 *     title with its ⓘ beside it, the line under it, all centred, `md` apart;
 *   - the rule is written into the page-layout rule, not just the code;
 *   - the Rescue page (its head and its result), Support and the Estate Plan
 *     sign-in's three steps draw their head through it and keep no head of
 *     their own;
 *   - no screen draws an icon over a title by hand in a left-aligned block:
 *     an icon in a ROW beside a title (the done heads) is another shape, and
 *     a result or empty state that centres itself already reads right.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
/** The public design rules; the page-layout section is held to the code here. */
const RULES = join(UI, '..', '..', 'docs', 'design-rules.md');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** An icon, logo or image element with a title (or an ⓘ heading) right under it. */
const ICON_OVER_TITLE =
  /<(\w+(?:Icon|Logo|Image))\b[^>]*?\/>\s*(?:<\/View>\s*|<View\b[^>]*\/>\s*)?<(?:InfoHeading\b|Text style=\{\[?styles\.(?:title|emptyTitle|resultTitle)\b)/g;

/** The attributes of the container the position sits in (View, Screen, ScrollView). */
function enclosingAttrs(src: string, at: number): string {
  const tokens = [...src.slice(0, at).matchAll(/<(?:View|Screen|ScrollView|Animated\.View)\b([^>]*)>|<\/(?:View|Screen|ScrollView|Animated\.View)>/g)];
  let depth = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const [whole, attrs] = tokens[i];
    if (whole.startsWith('</')) depth++;
    else if (attrs.trimEnd().endsWith('/')) continue; // self-closing: a spacer
    else if (depth > 0) depth--;
    else return attrs;
  }
  return '';
}

function styleBody(src: string, name: string): string {
  const m = src.match(new RegExp(`\\b${name}: \\{([^}]*)\\}`));
  return m ? m[1] : '';
}

describe('the page head: an icon over its title and line, centred', () => {
  const head = code(read('components/PageHead.tsx'));

  it('is one centred block: the icon, the tag, the title with its dot, the line, md apart', () => {
    expect(head).toMatch(/import \{ InfoHeading \} from '\.\/InfoDot'/);
    expect(head).toMatch(/<View style=\{\[styles\.head, style\]\}>\s*\{icon\}\s*\{!!tag && <Text style=\{styles\.tag\}>\{tag\}<\/Text>\}/);
    expect(head).toMatch(/<InfoHeading title=\{info\.title\} text=\{info\.text\} style=\{styles\.title\}>\s*\{title\}\s*<\/InfoHeading>/);
    expect(head).toMatch(/<Text style=\{styles\.title\}>\{title\}<\/Text>/);
    expect(head).toMatch(/<Text style=\{styles\.line\}>\{line\}<\/Text>/);
    expect(head).toMatch(/head: \{ alignItems: 'center', gap: theme\.spacing\.md \}/);
    expect(head).toMatch(/tag: \{ \.\.\.theme\.typography\.label, color: theme\.colors\.gold, textAlign: 'center' \}/);
    expect(head).toMatch(/title: \{ \.\.\.theme\.typography\.title, color: theme\.colors\.offWhite, textAlign: 'center' \}/);
    expect(head).toMatch(/line: \{ \.\.\.theme\.typography\.body, color: theme\.colors\.slate, textAlign: 'center' \}/);
    // Tokens only: no literal size, weight or spacing.
    expect(head).not.toMatch(/fontSize|fontWeight|lineHeight|\b(?:gap|margin\w*|padding\w*): \d/);
  });

  it('keeps the dot beside a centred title: InfoHeading centres its row for a centred text', () => {
    expect(code(read('components/infoRowStyle.ts'))).toMatch(/if \(text\.textAlign === 'center'\) row\.justifyContent = 'center';/);
  });

  it('is exported with the other components', () => {
    expect(code(read('components/index.ts'))).toMatch(/export \{ PageHead \} from '\.\/PageHead'/);
  });

  it('is written into the page-layout rule, with what stays left', () => {
    const rules = readFileSync(RULES, 'utf8');
    expect(rules).toMatch(/a page head with an icon over its title and line \([^)]*2026-10-05/);
    expect(rules).toMatch(/`ui\/components\/PageHead` is the one piece/);
    expect(rules).toMatch(/a title WITHOUT an icon stays left/);
  });

  it.each([
    ['screens/RescueScreen.tsx', 3, ['Rescue a vault', 'Speed-up requested', 'Rescue requested']],
    ['screens/ContactScreen.tsx', 1, ["We're here to help"]],
    ['screens/InheritanceScreen.tsx', 3, ['Your 21st Capital account', 'Check your email', 'Now a different code']],
  ])('%s draws its head through PageHead, %i times, and keeps no head of its own', (rel, count, titles) => {
    const src = code(read(rel));
    expect(src).toMatch(/\bPageHead\b[^;]*from '\.\.\/components'/);
    expect(src.match(/<PageHead\b/g)).toHaveLength(count);
    for (const title of titles) expect(src).toMatch(new RegExp(`title="${title.replace(/'/g, "'")}"`));
    // The left-aligned heads are gone, and no centring by hand either.
    expect(src).not.toMatch(/\b(?:head|header|loginHead|headCentered): \{[^}]*alignItems/);
    expect(src).not.toMatch(/\b(?:title|sub|body|stepTag): \{[^}]*textAlign: 'center'/);
  });

  it('the Rescue page\'s head keeps its dot ("When a rescue is possible") and its line per vault', () => {
    const src = code(read('screens/RescueScreen.tsx'));
    const start = src.indexOf('<PageHead');
    const head = src.slice(start, src.indexOf('line=', start) + 260);
    expect(head).toMatch(/icon=\{<ParachuteIcon size=\{40\} color=\{theme\.colors\.gold\} \/>\}/);
    expect(head).toMatch(/info=\{\{\s*title: 'When a rescue is possible',/);
    // The vault's own name when opened from it; otherwise the question, only
    // while there is a vault to choose (decided 2026-11-04: a vault with a
    // request on its way is not listed).
    expect(head).toMatch(
      /line=\{\s*onlyThisVault\s*\? askedVault!\.w\.label\s*: listedVaults\.length > 0 \|\| openVaultIds == null\s*\? 'Choose the vault to rescue\.'\s*: undefined\s*\}/,
    );
  });

  it('the Estate Plan sign-in steps keep their disc, their tag and the bold email', () => {
    const src = code(read('screens/InheritanceScreen.tsx'));
    expect(src).toMatch(/tag="EMAIL CODE"/);
    expect(src).toMatch(/tag="AUTHENTICATOR CODE"/);
    expect(src).toMatch(/line=\{\s*<>\s*We sent a 6-digit code to\{' '\}\s*<Text style=\{styles\.bodyStrong\}>/);
    expect(src.match(/icon=\{\s*<View style=\{styles\.stepIcon\}>/g)).toHaveLength(2);
  });

  it('no screen or component draws an icon over a title by hand in a left-aligned block', () => {
    const offenders: string[] = [];
    const hits: string[] = [];
    for (const path of sources(UI)) {
      if (path.endsWith('PageHead.tsx')) continue;
      const src = code(readFileSync(path, 'utf8'));
      for (const m of src.matchAll(ICON_OVER_TITLE)) {
        // An icon in a disc of its own: judge the block the disc sits in.
        const wrapped = m[0].indexOf('</View>');
        const attrs = enclosingAttrs(src, (m.index ?? 0) + (wrapped >= 0 ? wrapped + '</View>'.length : 0));
        const names = [...attrs.matchAll(/styles\.(\w+)/g)].map((s) => s[1]);
        const bodies = names.map((n) => styleBody(src, n));
        const row = bodies.some((b) => /flexDirection: 'row'/.test(b));
        const centred = bodies.some((b) => /alignItems: 'center'/.test(b));
        const where = `${path.slice(UI.length + 1)}: ${m[1]} over a title, in ${names.join(' + ') || 'no style'}`;
        hits.push(where);
        if (!row && !centred) offenders.push(where);
      }
    }
    // The sweep sees the done heads (an icon in a row beside the title), so it
    // is not silently blind.
    expect(hits.some((h) => /DrawnIcon over a title, in doneHead/.test(h))).toBe(true);
    expect(offenders).toEqual([]);
  });
});
