/**
 * ONE Sent page after every broadcast (decided 2026-10-02, design C "Sketch and
 * ink", with the sub line moved above Done). Structural, like
 * speedUpAndCancel: the repo has no component tests, and each rule below is
 * a line a later edit could quietly drop.
 *
 *   - every broadcast success state renders `SentPage`, and none draws a
 *     tick of its own there (the small DrawnIcon keeps its other uses);
 *   - the mark animates on the native driver, never a layout value;
 *   - the haptic is iOS's success notification, asked for without loading
 *     the package, and the patch sends it to UIKit.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const ROOT = join(UI, '..', '..');
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

/** Each broadcast success state: where it starts, where it ends. */
const SUCCESS_STATES: Array<{ name: string; file: string; from: string; to: string }> = [
  {
    name: 'signing screen: Sent, Refreshed, Sped up, Cancel sent, the refresh queue',
    file: 'screens/SignPsbtScreen.tsx',
    from: "{phase === 'done' && (",
    to: '</StepTransition>',
  },
  {
    name: 'Pending transactions: Send all',
    file: 'screens/PendingCosignScreen.tsx',
    from: 'if (sentBatch) {',
    to: 'if (sent && sentWallet) {',
  },
  {
    name: 'Pending transactions: one co-signed transaction',
    file: 'screens/PendingCosignScreen.tsx',
    from: 'if (sent && sentWallet) {',
    to: 'if (batchDetail) {',
  },
  {
    name: 'refresh session: Refresh sent, Partly sent',
    file: 'screens/RefreshSessionScreen.tsx',
    from: "{phase === 'sent' && sentCount > 0 && (",
    to: "{phase === 'cosign'",
  },
  {
    name: 'rescue: Rescue sent',
    file: 'screens/RescueScreen.tsx',
    from: "if (step === 'sent' && rescueSent && sentVault) {",
    to: "if (step === 'select' || step === 'sent') {",
  },
];

describe('one Sent page', () => {
  it.each(SUCCESS_STATES)('$name renders SentPage and draws no tick of its own', ({ file, from, to }) => {
    const block = between(code(read(file)), from, to);
    expect(block).toMatch(/<SentPage\b/);
    // No tick, no ring, no drawn path of its own: the mark is SentMark's.
    expect(block).not.toMatch(/<DrawnIcon\b/);
    expect(block).not.toMatch(/<(Svg|Path|SentMark)\b/);
  });

  it('every broadcast lands on it', () => {
    // The signing screen: the broadcast sets the done phase.
    const sign = between(code(read('screens/SignPsbtScreen.tsx')), 'const onBroadcast = async', 'const sentKind');
    expect(sign.indexOf("setPhase('done')")).toBeGreaterThan(sign.search(/\.broadcast(Psbt|RawTx)\(/));
    // Pending: one, and Send all, each with what went out.
    const pending = code(read('screens/PendingCosignScreen.tsx'));
    const one = between(pending, 'const send = async', 'const sendBatch');
    // Read right after the broadcast and BEFORE the sync that follows it:
    // BDK answers one call at a time, and the page must not wait behind a
    // whole sync with the payment already out (decided 2026-10-02).
    const factsAt = one.indexOf('const facts = await sentFactsFor(engine, wallet, result.psbtBase64, txid, plan);');
    expect(factsAt).toBeGreaterThan(one.search(/\.broadcastPsbt\(/));
    expect(factsAt).toBeLessThan(one.lastIndexOf('void syncWallet(wallet, { force: true })'));
    expect(one).toMatch(/setSent\(\{ walletId: wallet\.id, facts \}\)/);
    const all = between(pending, 'const sendBatch = async', 'const askCancelBatch');
    expect(all).toMatch(/wentOut\.push\(await sentFactsFor\(/);
    expect(all.indexOf('wentOut.push(await sentFactsFor(')).toBeLessThan(all.indexOf('void syncWallet('));
    expect(all).toMatch(/facts: mergeSentFacts\(wentOut\)/);
    // The refresh session sends itself into its sent phase.
    const session = between(code(read('screens/RefreshSessionScreen.tsx')), 'const sendAll = async', 'const plan = useMemo');
    expect(session).toMatch(/setPhase\('sent'\)/);
    // The rescue is no longer a dialog: the same page.
    const rescue = code(read('screens/RescueScreen.tsx'));
    const broadcast = between(rescue, 'const broadcast = async', 'const askedFor =');
    expect(broadcast.indexOf("setStep('sent')")).toBeGreaterThan(broadcast.indexOf('engine.broadcastRescue('));
    expect(rescue).not.toMatch(/title: 'Rescue sent'/);
  });

  it('nothing sent is not a Sent page: no tick at all', () => {
    const pending = between(code(read('screens/PendingCosignScreen.tsx')), 'if (sentBatch) {', 'if (sent && sentWallet) {');
    const none = between(pending, 'if (sentBatch.count === 0', '<SentPage');
    expect(none).not.toMatch(/<(DrawnIcon|SentPage)\b/);
    const session = between(
      code(read('screens/RefreshSessionScreen.tsx')),
      "{phase === 'sent' && sentCount === 0 && (",
      "{phase === 'cosign'",
    );
    expect(session).not.toMatch(/<(DrawnIcon|SentPage)\b/);
  });

  it('only SentPage draws the mark and plays the haptic, once', () => {
    // The clock and the haptic are shared with ONE other page, "Vault built"
    // (decided 2026-10-02), which runs the same engine on its own tracks and
    // never draws the tick.
    const PAGES = [join('components', 'SentPage.tsx'), join('components', 'VaultBuiltPage.tsx')];
    const offenders = sources(UI)
      .filter((p) => !PAGES.some((page) => p.endsWith(page)) && !p.endsWith(join('components', 'SentMark.tsx')))
      .filter((p) => /<SentMark\b|useSentTimeline\(|sentTick\b/.test(code(readFileSync(p, 'utf8'))));
    expect(offenders.map((p) => p.slice(UI.length + 1))).toEqual([]);
    expect(code(read('components/VaultBuiltPage.tsx'))).not.toMatch(/<SentMark\b/);
    const page = code(read('components/SentPage.tsx'));
    expect(page.match(/sentTick/g)).toHaveLength(2); // the import and the one call
    // The clock waits for Reduce Motion and the mark's size (below), and runs the Sent tracks.
    expect(page).toMatch(/const timeline = useMemo\(\(\) => \(sized && reduce != null \? sentTimeline\(reduce\) : null\), \[sized, reduce\]\);/);
    expect(page).toMatch(/useSentTimeline\(SENT_TRACK_KEYS, timeline, startAfterMs, sentTick,/);
  });

  it('starts once the step’s slide has finished', () => {
    expect(code(read('components/StepTransition.tsx'))).toMatch(/duration = STEP_SLIDE_MS/);
    expect(code(read('components/SentPage.tsx'))).toMatch(/startAfterMs = STEP_SLIDE_MS/);
  });

  it('animates on the native driver only, and never a layout value', () => {
    for (const rel of ['components/SentMark.tsx', 'components/SentPage.tsx']) {
      const src = code(read(rel));
      expect(src).not.toMatch(/useNativeDriver:\s*false/);
      expect(src).not.toMatch(/LayoutAnimation|setNativeProps|Animated\.spring/);
      // Every interpolation drives a stroke offset, a transform or opacity.
      expect(src).not.toMatch(/(height|width|top|left|margin\w*|padding\w*)\s*:\s*\w+\.interpolate\(/);
    }
    const mark = code(read('components/SentMark.tsx'));
    expect(mark).toMatch(/useNativeDriver: true/);
    // Side effects are timers on the same clock, never a completion callback.
    expect(mark).not.toMatch(/\.start\(\s*\(/);
  });

  it('Done is visible as it rises but not tappable until live, and VoiceOver reads the title then', () => {
    const page = code(read('components/SentPage.tsx'));
    expect(page).toMatch(/pointerEvents=\{live \? 'auto' : 'none'\}/);
    expect(page).toMatch(/accessibilityElementsHidden=\{!live\}/);
    expect(page).toMatch(/AccessibilityInfo\.announceForAccessibility\(words\.title\)/);
    expect(page).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    // The mark is decoration.
    expect(code(read('components/SentMark.tsx'))).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it('hidden balances read as dots, and fiat shows only where the app shows it', () => {
    const page = code(read('components/SentPage.tsx'));
    expect(page).toMatch(/const masked = settings\.hideBalances \|\| !!wallet\.balanceHidden;/);
    expect(page).toMatch(/fiatShown\(wallet\.network, settings\.btcOnly\)/);
    expect(page).toMatch(/masked \? \(\s*MASK_HERO/);
  });

  it('the new surfaces are themed, use the one hero size, and never write an em dash', () => {
    for (const rel of ['components/SentMark.tsx', 'components/SentPage.tsx', 'components/sentPageModel.ts']) {
      const src = code(read(rel));
      if (rel.endsWith('.tsx')) {
        expect(src).toMatch(/themedStyles\(/);
        expect(src).not.toMatch(/=\s*StyleSheet\.create\(/);
        // Theme tokens only.
        expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
      }
      const strings = src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect(strings.filter((s) => /[—–]/.test(s))).toEqual([]);
    }
    const page = code(read('components/SentPage.tsx'));
    expect(page).toMatch(/hero: heroFigure\(\),/); // the one hero figure (theme heroFigure)
    // The unit sits in the figure's own text, as on every balance (decided 2026-10-03).
    expect(page).toMatch(/`\$\{hero\.figure\} \$\{hero\.unit\}`/);
    expect(page).toMatch(/<FitText style=\{styles\.hero\}>/);
    // The mark has no container, so no Gloss of its own.
    expect(code(read('components/SentMark.tsx'))).not.toMatch(/Gloss/);
  });

  it('a short screen draws a smaller mark, settled before anything shows', () => {
    const page = code(read('components/SentPage.tsx'));
    // Laid out once with the smallest mark, measured, then the largest that fits.
    expect(page).toMatch(/<SentMark values=\{values\} reduce=\{reduce \?\? false\} box=\{box \?\? MIN_INK_BOX\} \/>/);
    expect(page).toMatch(/settle\(sentMarkBox\(page, top \+ SPACER_MIN \+ foot\)\)/);
    for (const part of ['page', 'top', 'foot']) expect(page).toContain(`onLayout={measure('${part}')}`);
    expect(page).toMatch(/spacer: \{ flex: 1, minHeight: SPACER_MIN \}/);
    // A layout that never reports still shows the page.
    expect(page).toMatch(/setTimeout\(\(\) => setBox\(\(cur\) => cur \?\? INK_BOX\), SIZE_FALLBACK_MS\)/);
    // The size is the box, its tuck and the pen; never a hard-coded 220 in the mark.
    const mark = code(read('components/SentMark.tsx'));
    expect(mark).toMatch(/penPath\(box\)/);
    expect(mark).toMatch(/markTuck\(box\)/);
    expect(mark).toMatch(/<Svg width=\{box\} height=\{box\}/);
  });

  it('sits at one height under the header on every screen', () => {
    // The signing screen pads its own scroll view; the others mount the page
    // in a Screen, which under the stack header added the status bar a
    // second time (decided 2026-10-02: the mark 58pt lower on RefreshSession
    // and Rescue, lower still on Pending). One token for both tops.
    const screen = code(read('components/Screen.tsx'));
    expect(screen).toMatch(/export const UNDER_HEADER_TOP = theme\.spacing\.lg;/);
    // ...and since 2026-10-05 every page under the shared header
    // gets the same top through UnderHeaderContext, which the stack's page
    // layout provides from the headerShown it offsets the glow by.
    expect(screen).toMatch(/paddingTop: underHeader \|\| headerAbove \? UNDER_HEADER_TOP : insets\.top \+ theme\.spacing\.md,/);
    expect(screen).toMatch(/export const UnderHeaderContext = createContext\(false\);/);
    const navigator = code(read('navigation/RootNavigator.tsx'));
    expect(navigator).toMatch(/<UnderHeaderContext\.Provider value=\{headerShown !== false\}>\{children\}<\/UnderHeaderContext\.Provider>/);
    expect(code(read('screens/SignPsbtScreen.tsx'))).toMatch(
      /content: \{ padding: theme\.spacing\.lg, paddingTop: UNDER_HEADER_TOP, /,
    );
    // Every Screen that holds a Sent page asks for it...
    for (const s of SUCCESS_STATES.filter((x) => !x.file.endsWith('SignPsbtScreen.tsx') && !x.file.endsWith('RefreshSessionScreen.tsx'))) {
      expect({ name: s.name, block: between(code(read(s.file)), s.from, s.to) }).toEqual({
        name: s.name,
        block: expect.stringMatching(/<Screen scroll underHeader style=\{styles\.sentContent\}>\s*<SentPage\b/),
      });
    }
    // (the refresh session's one Screen wraps every step: only while the page shows)
    const session = code(read('screens/RefreshSessionScreen.tsx'));
    expect(session).toMatch(/<Screen\s+scroll\s+underHeader=\{phase === 'sent' && sentCount > 0\}/);
    // ...and nothing else on those screens does: their other steps keep their top.
    const count = (rel: string) => (code(read(rel)).match(/\bunderHeader\b/g) ?? []).length;
    expect({
      pending: count('screens/PendingCosignScreen.tsx'),
      rescue: count('screens/RescueScreen.tsx'),
      session: count('screens/RefreshSessionScreen.tsx'),
    }).toEqual({ pending: 2, rescue: 1, session: 1 });
  });

  it('what did not go out is the Sent page’s own card, amounts in the owner’s unit', () => {
    // The receipt and the card under it are one component, so the heading
    // style and the card's look cannot part (decided 2026-10-02: Pending's
    // card was headed in the caption style and wrote "(7,500,000 sats)").
    const page = code(read('components/SentPage.tsx'));
    expect(page).toMatch(/export function SentCard\(/);
    expect(page).toMatch(/<SentCard\s+title=\{sentCardTitle\(facts\)\}/);
    expect(page.match(/<Card\b/g)).toHaveLength(1);
    expect(between(page, 'export function SentCard(', 'const SIZE_FALLBACK_MS')).toMatch(
      /<Text style=\{styles\.label\}>\{title\}<\/Text>/,
    );
    const pending = code(read('screens/PendingCosignScreen.tsx'));
    const batch = between(pending, 'if (sentBatch) {', 'if (sent && sentWallet) {');
    expect(batch).toMatch(/<SentCard\s+title=\{FAILURES_TITLE\}\s+rows=\{sentFailureRows\(sentBatch\.failures, failuresMasked, settings\.unit\)\}/);
    expect(batch).toMatch(/const failuresMasked = settings\.hideBalances \|\| !!batchWallet\?\.balanceHidden;/);
    expect(batch).not.toMatch(/<Card\b|styles\.detailLabel/);
    // The coin's amount travels as a number, never written into the reason.
    const all = between(pending, 'const sendBatch = async', 'const askCancelBatch');
    expect(all).toMatch(/failures\.push\(\{ coin: i \+ 1, amountSats: row\.pending\.amountSats \?\? null, reason: notReachedWords\(e\) \?\? \(e as Error\)\.message \}\)/);
    expect(all).not.toMatch(/formatSats\(/);
    // The refresh session's Partly sent is the same card.
    const session = code(read('screens/RefreshSessionScreen.tsx'));
    expect(session).toMatch(/<SentCard\s+title=\{FAILURES_TITLE\}\s+rows=\{sentFailureRows\(failed, settings\.hideBalances \|\| !!wallet\.balanceHidden, settings\.unit\)\}/);
  });

  it('on the signing screen the rising Done is never clipped', () => {
    // The step wrapper clips its slide; the Sent page's step lifts that.
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    expect(sign).toMatch(/style=\{\[styles\.stepWrap, phase === 'done' && styles\.stepFill\]\}/);
    expect(sign).toMatch(/stepFill: \{ flex: 1, overflow: 'visible' \}/);
  });

  it('a sped-up return leads with the cancelled payment and says the coins come back, on both screens', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    // Read from the records when the ceremony opens, not after the
    // broadcast (decided 2026-10-02): the co-sign request carries it too.
    expect(sign).toMatch(
      /useEffect\(\(\) => \{\s*if \(replacesKind !== 'speedup' \|\| !replacesTxid\) return;[\s\S]{0,80}returnedPayment\(route\.params\.walletId, replacesTxid\)/,
    );
    expect(between(sign, 'const onBroadcast = async', 'const sentKind')).not.toMatch(/returnedPayment\(/);
    expect(sign.indexOf('const [returnSats, setReturnSats]')).toBeLessThan(sign.indexOf('const cosignAmountSats'));
    expect(sign).toMatch(/const spedUpReturn = isSpedUpReturn\(replaces, returnSats\);/);
    expect(sign).toMatch(/isReturn: spedUpReturn,/);
    expect(sign).toMatch(/cancelledSats: replaces\?\.kind === 'cancel' \? replaces\.amountSats : spedUpReturn \? returnSats : null,/);
    expect(sign).toMatch(/sentWords\(sentKind, \{ index: queueIndex, total: queue\.length \}, spedUpReturn\)/);
    const pending = code(read('screens/PendingCosignScreen.tsx'));
    const facts = between(pending, 'async function sentFactsFor(', 'export function PendingCosignScreen');
    expect(facts).toMatch(/plan\?\.kind === 'speedup' \? await returnedPayment\(wallet\.id, plan\.oldTxid\)/);
    expect(facts).toMatch(/const isReturn = plan\?\.kind === 'speedup' && \(plan\.what === 'return' \|\| returned != null\);/);
    expect(facts).toMatch(/const cancelledSats = plan\?\.kind === 'cancel' \? plan\.amount : isReturn \? returned : null;/);
    expect(pending).toMatch(/sentWords\(sent\.facts\.kind, undefined, sent\.facts\.isReturn\)/);
  });

  it('paying nobody else is a refresh only on a vault with a timelock', () => {
    // The transaction page and the vault list call it Sent otherwise, and
    // "What a refresh does" talks about each coin's clock.
    const pending = between(
      code(read('screens/PendingCosignScreen.tsx')),
      'async function sentFactsFor(',
      'export function PendingCosignScreen',
    );
    expect(pending).toMatch(/const timelocked = minOlderBlocks\(wallet\.descriptor\) != null;/);
    expect(pending).toMatch(/plan \? plan\.kind : recipients\.length === 0 && timelocked \? 'refresh' : 'payment'/);
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    expect(sign).toMatch(
      /const refreshWording =\s*isSelfRefresh && planSettled && !replaces && wallet != null && minOlderBlocks\(wallet\.descriptor\) != null;/,
    );
  });

  it('the small DrawnIcon keeps its other uses', () => {
    // The copied flash, the co-sign "requested" states.
    expect(code(read('components/CopiedFlash.tsx'))).toMatch(/<DrawnIcon kind="tick"/);
    expect(code(read('screens/SignPsbtScreen.tsx'))).toMatch(/<DrawnIcon kind="cross"/);
  });
});

describe('the Sent haptic', () => {
  const haptics = code(readFileSync(join(ROOT, 'src', 'platform', 'haptics.ts'), 'utf8'));

  it('is iOS’s success notification, from the native module alone', () => {
    // Never the package: its load throws without the module, and Metro makes that fatal.
    expect(haptics).not.toMatch(/from 'react-native-haptic-feedback'|require\('react-native-haptic-feedback'\)/);
    expect(haptics).toMatch(/TurboModuleRegistry\.get<HapticFeedbackSpec>\('RNHapticFeedback'\)/);
    const tick = between(haptics, 'export function sentTick', '\n}');
    expect(tick).toMatch(/haptics\(\)\?\.trigger\('notificationSuccess'/);
    expect(tick).toMatch(/catch/);
  });

  it('is sent to UIKit by the patch, the way the selection tick is', () => {
    const patch = readFileSync(join(ROOT, 'patches', 'react-native-haptic-feedback+3.0.0.patch'), 'utf8');
    expect(patch).toMatch(
      /\+ {4}if \(\[type isEqual:@"selection"\] \|\| \[type isEqual:@"notificationSuccess"\]\) \{\n\+ {8}\[self playUIKitHaptic:type\];\n\+ {8}return;/,
    );
    // And the module stays in the generated module list.
    expect(patch).toMatch(/"modulesProvider"/);
  });
});
