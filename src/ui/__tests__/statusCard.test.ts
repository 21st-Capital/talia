/**
 * The status card (decided 2026-10-05, after a layout pass left-aligned every card:
 * first BlueWallet's Electrum page beside ours, then in a phone test "simply
 * delete the word 'status' above 'connect', so lets go back to how that
 * looked like before the change").
 *
 * Structural, like pageFooter: the repo has no component tests, and each
 * rule below is a line a later edit could quietly drop.
 *
 *   - `StatusCard` is a `Card` (surface + Gloss) with NO heading: the whole
 *     card is one centred block, the state in its pill, what it is connected
 *     to in mono, the detail line, each centred so a long line wraps centred;
 *   - the exception is written into the page-layout rule, not just the code;
 *   - the Network page draws its status through it, with its own words, and
 *     keeps no pill of its own;
 *   - the portfolio sync page, the same role, draws its status through it,
 *     and its footer buttons stay where the layout pass pinned them;
 *   - no other screen or component draws a status pill of its own.
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
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the status card: no heading, the status centred', () => {
  const card = code(read('components/StatusCard.tsx'));

  it('is a Card that is one centred block, the pill first, with no heading at all', () => {
    expect(card).toMatch(/import \{ Card \} from '\.\/Card'/);
    expect(card).toMatch(/<Card style=\{\[styles\.card, style\]\}>\s*<View\s+style=\{\[\s*styles\.pill,/);
    expect(card).toMatch(/card: \{ alignItems: 'center', gap: theme\.spacing\.xs \}/);
    // "delete the word 'status'": no heading prop, text or style (the
    // pill's type token, `typography.heading`, is the one "heading" left).
    expect(card).not.toMatch(/(?<!\.)\bheading\b/);
    expect(card).not.toMatch(/'Status'/);
  });

  it('centres the pill word, the subject in mono and the detail line, so long lines wrap centred', () => {
    expect(card).toMatch(/pill: \{\s*borderRadius: theme\.radius\.pill,/);
    expect(card).toMatch(/state: \{ \.\.\.theme\.typography\.heading, color: theme\.colors\.slate, textAlign: 'center' \}/);
    expect(card).toMatch(/subject: \{ \.\.\.theme\.typography\.mono, color: theme\.colors\.offWhite, textAlign: 'center' \}/);
    expect(card).toMatch(/detail: \{ \.\.\.theme\.typography\.caption, color: theme\.colors\.slate, textAlign: 'center' \}/);
    // The colours the Network page always had, in colour, never `opacity`.
    expect(card).toMatch(/stateOk: \{ color: theme\.colors\.positive \}/);
    expect(card).toMatch(/stateBad: \{ color: theme\.colors\.negative \}/);
    expect(card).not.toMatch(/\bopacity\b/);
  });

  it('is exported with the other components', () => {
    expect(code(read('components/index.ts'))).toMatch(/export \{ StatusCard \} from '\.\/StatusCard'/);
  });

  it('is written into the page-layout rule as the one centred card, with no heading', () => {
    const rules = readFileSync(RULES, 'utf8');
    expect(rules).toMatch(/a live status card \([^"]*2026-10-05[^"]*"simply delete the word 'status' above 'connect'/);
    expect(rules).toMatch(/`ui\/components\/StatusCard` is the one piece: NO heading, the whole card centred/);
  });

  it('the Network page draws its status through it, its own words unchanged, with no pill or heading of its own', () => {
    const network = code(read('screens/NetworkSettingsScreen.tsx'));
    expect(network).toMatch(/\bStatusCard\b.*from '\.\.\/components'/);
    const status = network.slice(network.indexOf('<StatusCard'), network.indexOf('/>', network.indexOf('<StatusCard')));
    expect(status).toMatch(/tone=\{status === 'connected' \? 'ok' : status === 'failed' \? 'bad' : 'idle'\}/);
    for (const word of ["'Connected'", "'Not connected'", "'Testing…'", "'Not tested'"]) expect(status).toContain(word);
    expect(status).toMatch(/subject=\{currentUrl\}/);
    expect(status).toMatch(/detail=\{statusDetail\}/);
    expect(status).not.toMatch(/heading=/);
    // The first card on the page, before "Network" and "Preferred server".
    expect(network.indexOf('<StatusCard')).toBeLessThan(network.indexOf('<Card'));
    expect(network).not.toMatch(/statusPill|statusCard|radius\.pill/);
  });

  it('the portfolio sync page, the same role, draws its status through it, its buttons still in the footer', () => {
    const sync = code(read('screens/VaultSyncSettingsScreen.tsx'));
    expect(sync).toMatch(/\bStatusCard\b.*from '\.\.\/components'/);
    expect(sync).toMatch(/<StatusCard\s+tone="ok"\s+state="Sync is on"\s+detail=\{/);
    expect(sync).not.toMatch(/<StatusCard[^>]*heading=/);
    expect(sync).not.toMatch(/statusRow|statusOn|statusSub/);
    // Decided 2026-10-05: "keep the button on portfolio sync down": Sync now and
    // Turn sync off live in the page's pinned footer, never in the flow.
    expect(sync).toMatch(/<Screen scroll footer=\{footer\}>/);
    const footer = sync.slice(sync.indexOf('const footer'), sync.indexOf('<Screen scroll footer'));
    expect(footer).toMatch(/title="Sync now"/);
    expect(footer).toMatch(/title="Turn sync off" variant="ghost"/);
    expect(footer).toMatch(/title="Turn sync on"/);
    const body = sync.slice(sync.indexOf('<Screen scroll footer'));
    expect(body).not.toMatch(/<Button/);
  });

  it('the sync page\'s other card heading is in the same heading colour, so the page has one', () => {
    // "Private by construction" sits right above the status card (decided
    // 2026-10-05: in accentText it was a green heading over a white card).
    const sync = code(read('screens/VaultSyncSettingsScreen.tsx'));
    expect(sync).toMatch(/noteTitle: \{ \.\.\.theme\.typography\.heading, color: theme\.colors\.offWhite \}/);
    expect(sync).not.toMatch(/typography\.heading[^}]*accentText/);
  });

  it('no other screen or component draws a status pill of its own', () => {
    const own = sources(UI).filter((path) => !path.endsWith('StatusCard.tsx') && /statusPill|pillOk|pillBad|pillIdle/.test(code(readFileSync(path, 'utf8'))));
    expect(own).toEqual([]);
  });
});
