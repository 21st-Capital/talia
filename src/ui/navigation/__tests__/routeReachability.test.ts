/**
 * Every route a screen navigates to must exist where that screen can reach it.
 *
 * React Navigation resolves `navigate('X')` against the CURRENT navigator and
 * its parents, never a sibling. When the target is missing, a dev build logs
 * a warning and a Release build does nothing at all: the button is simply
 * dead, with no crash, no message and nothing in the logs.
 *
 * That is how it was found in a phone test (2026-08-30). The Estate Plan questionnaire was
 * registered on BOTH the Vaults stack and the Settings stack, because it is
 * reachable from a vault and from the account hub. Its success page sends the
 * client on to invite their heirs, and `InviteHeir` existed only on the Vaults
 * stack. Reached from a vault it worked; reached from Settings, which is the
 * route most clients take, "Invite my heirs" did nothing. It had been that way
 * since the success page was built.
 *
 * Since the native tab bar (trial, 2026-09-15) the app is ONE root stack: the
 * tab bar (`Tabs`) at the bottom, each tab holding its root screen alone on a
 * one-screen stack, and every other screen registered once on the root
 * stack. Every screen reaches the root stack's routes, and only those: from
 * above the bar a tab root is not reachable by name, and a tab is not
 * reachable at all. A reset that names `WalletList`, or a getParent() jump to
 * `'VaultsTab'`, is the new dead button, which is why flows land on a tab
 * through `resetOverTab` and one test below looks for the old shapes.
 *
 * A structural test rather than a render test: this repo deliberately has no
 * component tests (they are brittle against camera and navigation natives), and
 * the defect is in the wiring, which is exactly what static structure can see.
 * It reads the navigator the same way a reviewer would.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..', '..');
const UI = join(SRC, 'ui');
const NAV = readFileSync(join(UI, 'navigation', 'RootNavigator.tsx'), 'utf8');

/** `name="X"` on each <Stack.Screen>, in order, whether written inline or wrapped. */
function screenNames(stack: string): string[] {
  const re = new RegExp(`<${stack}\\.Screen[\\s\\S]{0,400}?name="(\\w+)"`, 'g');
  return [...NAV.matchAll(re)].map((m) => m[1]);
}

function routesOf(stack: string): Set<string> {
  return new Set(screenNames(stack));
}

/** route name -> component name, per stack. */
function componentsOf(stack: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(
    `<${stack}\\.Screen[\\s\\S]{0,400}?name="(\\w+)"[\\s\\S]{0,200}?component=\\{(\\w+)`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(NAV)) !== null) out.set(m[1], m[2]);
  return out;
}

/** Literal `navigation.navigate('X')` targets inside one screen file. */
function navigateTargets(component: string): string[] {
  let src: string;
  try {
    src = readFileSync(join(UI, 'screens', `${component}.tsx`), 'utf8');
  } catch {
    return []; // not a screen file (shared component, or lives elsewhere)
  }
  return [...src.matchAll(/navigation\.navigate\(\s*'(\w+)'/g)].map((m) => m[1]);
}

/** The build flags wrapped around a root-stack registration (`{FLAGS && (`), or ''. */
function gateOf(name: string): string {
  const at = NAV.indexOf(`name="${name}"`);
  const open = NAV.lastIndexOf('<RootStack.Screen', at);
  const from = Math.max(NAV.lastIndexOf('/>', open), NAV.lastIndexOf('*/}', open));
  return NAV.slice(from, open).match(/\{\s*([^{}]*?)\s*&&\s*\(\s*$/)?.[1] ?? '';
}

/** Every .ts and .tsx under a directory, tests aside. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(path);
    return e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Source with its comments blanked, so documentation can never satisfy a
 *  rule that is about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

const ROOT = 'RootStack';
/** Each tab's one-screen stack, and the root screen it holds. */
const TAB_STACKS: Record<string, string> = {
  VaultsTabStack: 'WalletList',
  VirtualTabStack: 'VirtualList',
  SettingsTabStack: 'Settings',
};

describe('route reachability', () => {
  it('finds the navigator and its stacks', () => {
    // Guard the guard: a rename that breaks these regexes would otherwise turn
    // every assertion below into a vacuous pass.
    const root = routesOf(ROOT);
    expect(root.size).toBeGreaterThan(40);
    expect(root).toContain('Tabs');
    expect(root).toContain('WalletDetail');
    expect(componentsOf(ROOT).size).toBeGreaterThan(40);
    expect(gateOf('InviteHeir')).toMatch(/SIGNING_ENABLED/);
    expect(gateOf('WalletDetail')).toBe('');
  });

  it('shows the tab bar on the three tab roots and nowhere else', () => {
    // Each tab's stack holds its root alone, and no tab root is on the root
    // stack: everything else is pushed above the bar, which hides it.
    for (const [stack, rootName] of Object.entries(TAB_STACKS)) {
      expect(screenNames(stack)).toEqual([rootName]);
      expect(routesOf(ROOT).has(rootName)).toBe(false);
    }
    // The bar is the root stack's first screen, so it is the bottom of the stack.
    expect(screenNames(ROOT)[0]).toBe('Tabs');
  });

  it('registers every screen once', () => {
    const names = screenNames(ROOT);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('every route a screen navigates to is on the root stack', () => {
    const available = routesOf(ROOT);
    const screens: Array<[string, string]> = [
      ...componentsOf(ROOT),
      ...Object.keys(TAB_STACKS).flatMap((stack) => [...componentsOf(stack)]),
    ];
    expect(screens.length).toBeGreaterThan(40);
    const broken: string[] = [];
    for (const [route, component] of screens) {
      for (const target of new Set(navigateTargets(component))) {
        if (!available.has(target)) broken.push(`${component} (${route}) -> '${target}'`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('never names a tab root in a reset or jumps tabs through getParent()', () => {
    // From above the bar both are dead in a Release build: the root stack has
    // no route called WalletList, and a root-stack screen has no parent to jump
    // tabs through. A flow lands on a tab with resetOverTab instead.
    const shapes =
      /name:\s*'(?:WalletList|VirtualList|Settings)'|navigate\(\s*'(?:VaultsTab|VirtualTab|SettingsTab)'|getParent(?:<[^(]*>)?\(\)[\s\S]{0,160}?\.navigate\(/g;
    const offenders: string[] = [];
    for (const file of tsxFiles(UI)) {
      for (const m of readFileSync(file, 'utf8').matchAll(shapes)) {
        offenders.push(`${relative(SRC, file)}: ${m[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lands on a tab through landOverTab, never from a screen\'s own state', () => {
    // A landing built from the ROOT STACK's own state is undone at a cold
    // launch. React Navigation skips the tab bar's first upward state commit,
    // so that state is not in the root stack's yet; the RESET is accepted and
    // then overwritten when the bar does commit, rebuilding from the pre-reset
    // routes. Nothing is logged, and it bites exactly once per launch, because
    // the failed attempt is what makes the bar commit (decided 2026-09-16: a vault
    // imported from another Talia was added but the app stayed on the import
    // page; importing again worked; after a restart it failed again).
    // `landOverTab` builds the action from the CONTAINER's state, which
    // carries the bar's from the first frame, so it is the only caller.
    //
    // The rule is invisible when broken, so this test is what holds it: it
    // reads EVERY .ts and .tsx under src/ui, not just the screens.
    const HELPER = join(UI, 'navigation', 'landOverTab.ts');
    // The two modules that OWN the mechanism: the pure builder and the one
    // dispatcher. Everywhere else calls landOverTab and nothing else.
    const OWNERS = [HELPER, join(UI, 'navigation', 'overTab.ts')];
    const offenders: string[] = [];
    for (const file of sourceFiles(UI)) {
      if (OWNERS.includes(file)) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/\bresetOverTab\s*\(/.test(src)) offenders.push(`${relative(SRC, file)}: calls resetOverTab`);
      if (/CommonActions\.reset\s*\(|navigation\.reset\s*\(/.test(src)) {
        offenders.push(`${relative(SRC, file)}: resets a navigator itself`);
      }
      for (const m of src.matchAll(/\.dispatch\s*\(\s*\(?\s*state/g)) {
        offenders.push(`${relative(SRC, file)}: dispatches from its own state (${m[0].trim()})`);
      }
    }
    expect(offenders).toEqual([]);

    // The helper asks the CONTAINER (comments stripped: a quoted call shape in
    // its own documentation must not satisfy this).
    const helper = stripComments(readFileSync(HELPER, 'utf8'));
    expect(helper).toContain('navigationRef.getRootState()');
    expect(helper).toContain('navigationRef.dispatch(');

    // …and the container is that same ref. Wired to anything else, every
    // landing in the app goes silently dead.
    const nav = stripComments(NAV);
    expect(nav).toMatch(/const navRef = navigationRef;/);
    expect(nav).toMatch(/<NavigationContainer[\s\S]{0,200}ref=\{navRef\}/);
    expect(nav).not.toMatch(/useNavigationContainerRef/);
  });

  it('opens every modal through AppModal, so a tap puts the keyboard away', () => {
    // A Modal is its own window: the tap-to-dismiss handler on the app root
    // never sees a touch inside one, so each modal has to carry its own. It
    // was carried by AppDialog and DraggableSheet alone, which left the
    // rename dialog, the login sheet, the key sheet and the exchange screens
    // with a keyboard only the return key could close (decided 2026-09-16).
    const raw: string[] = [];
    for (const file of sourceFiles(UI)) {
      if (file.endsWith('AppModal.tsx')) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/<Modal[\s>]/.test(src)) raw.push(relative(SRC, file));
    }
    expect(raw).toEqual([]);

    // …and the wrapper really wraps the window's content in the escape.
    const wrapper = stripComments(readFileSync(join(UI, 'components', 'AppModal.tsx'), 'utf8'));
    expect(wrapper).toMatch(/<Modal \{\.\.\.rest\}>[\s\S]*<KeyboardEscape>/);
  });

  it('opens the configurator on the key step when the 2-of-3 is already chosen', () => {
    // Found in a phone test (2026-09-21): Multisig > "Set up a 2-of-3 with 21st Capital" landed on
    // step 1 of the configurator, which asked for the 2-of-3 a second time.
    const builder = stripComments(readFileSync(join(UI, 'screens', 'VaultBuilderScreen.tsx'), 'utf8'));
    expect(builder).toMatch(/title="Set up a 2-of-3 with 21st Capital"[\s\S]{0,120}navigate\('LayeredVault', \{ scheme: 'multi-2-3' \}\)/);
    // The keys come first on that screen and the 2-of-3 offer sits at the
    // bottom of the page (decided 2026-09-21), its button inside its card with the
    // words that explain it (decided 2026-10-05: "move the 2-of-3 offer button
    // back into its card"); the pinned footer holds Create alone.
    const keysAt = builder.indexOf('{sections.map(');
    const offerAt = builder.indexOf('Want 21st Capital to co-sign?');
    const offerButtonAt = builder.indexOf('title="Set up a 2-of-3 with 21st Capital"');
    const footerAt = builder.indexOf('<PageFooter>');
    const createAt = builder.indexOf("'Create watch-only vault'");
    expect(keysAt).toBeGreaterThan(-1);
    expect(keysAt).toBeLessThan(offerAt);
    expect(offerAt).toBeLessThan(offerButtonAt);
    expect(offerButtonAt).toBeLessThan(builder.indexOf('</Card>', offerAt));
    expect(offerButtonAt).toBeLessThan(footerAt);
    expect(footerAt).toBeLessThan(createAt);
    const footer = builder.slice(footerAt, builder.indexOf('</PageFooter>', footerAt));
    expect(footer).not.toMatch(/Set up a 2-of-3/);
    // The spending policy is the configurator's graph, not the raw
    // descriptor, and a 2-of-2 is warned about once (decided 2026-09-21).
    expect(builder).toMatch(/<PolicyOverview/);
    expect(builder).not.toMatch(/>DESCRIPTOR</);
    expect(builder).not.toMatch(/needing BOTH of two keys/);
    // Three key spaces from the start, 2 of 3 by default (multisigRules), a
    // pencil and never a + and a − for the number of signatures (decided
    // 2026-09-21).
    expect(builder).toMatch(/from '\.\/multisigRules'/);
    expect(builder).toMatch(/thresholdChoices\(n\)/);
    expect(builder).toMatch(/<PencilIcon/);
    expect(builder).not.toMatch(/stepText|>＋<|>−</);
    // …and a scheme in the params is what makes the configurator skip step 1.
    const configurator = stripComments(readFileSync(join(UI, 'screens', 'LayeredVaultScreen.tsx'), 'utf8'));
    expect(configurator).toMatch(/useState\(route\.params\?\.scheme \? 1 : 0\)/);
    expect(configurator).toMatch(/useState<'21c' \| 'self'>\('21c'\)/);
  });

  it('draws every radio button through RadioMark', () => {
    // Eight hand-drawn copies in five files, in two sizes and two greens,
    // until matching them was asked for (2026-09-21).
    const copies: string[] = [];
    for (const file of sourceFiles(UI)) {
      if (file.endsWith('components/RadioMark.tsx')) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/styles\.radio(On|Dot)?\b/.test(src)) copies.push(relative(SRC, file));
    }
    expect(copies).toEqual([]);
  });

  it('draws every QR through the shared QR components', () => {
    // A code a person or a phone app scans is BrandedQr (the Receive design,
    // the Talia mark in the centre); a code a device reads is QrImage or
    // AnimatedQr. A phone test on 2026-09-21 found the two-factor QR in a design of its
    // own ("match the design of the QR code with the BTC addresses QR").
    const allowed = ['BrandedQr.tsx', 'QrImage.tsx', 'AnimatedQr.tsx'];
    const raw: string[] = [];
    for (const file of sourceFiles(UI)) {
      if (allowed.some((name) => file.endsWith(`components/${name}`))) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/react-native-qrcode-svg/.test(src)) raw.push(relative(SRC, file));
    }
    expect(raw).toEqual([]);
    for (const screen of ['ReceiveScreen.tsx', 'TwoFactorScreen.tsx']) {
      expect(stripComments(readFileSync(join(UI, 'screens', screen), 'utf8'))).toMatch(/<BrandedQr /);
    }
  });

  it('draws the small gold chip through GoldChip alone', () => {
    // "INHERITANCE-READY", "MOST POPULAR" and "RECOMMENDED" were hand-made
    // copies whose padding had drifted apart (decided 2026-09-21: "use the
    // matching chip from the app").
    const copies: string[] = [];
    for (const file of sourceFiles(UI)) {
      if (file.endsWith('components/GoldChip.tsx')) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/fontSize: 10, fontWeight: '800', letterSpacing: 0\.8, color: theme\.colors\.gold/.test(src)) {
        copies.push(relative(SRC, file));
      }
    }
    expect(copies).toEqual([]);
  });

  it('marks a recommended option on its whole card, through RecommendedBand', () => {
    // Decided 2026-09-21: no small chip ("I want something that would
    // make the entire container a more favorable choice"), but the
    // gold frame, tint and band. No screen writes RECOMMENDED by hand.
    const byHand: string[] = [];
    for (const file of sourceFiles(UI)) {
      if (file.endsWith('components/RecommendedBand.tsx')) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/>\s*RECOMMENDED\s*<|label="RECOMMENDED"/i.test(src)) byHand.push(relative(SRC, file));
    }
    expect(byHand).toEqual([]);
    for (const screen of ['CreateVaultScreen.tsx']) {
      const src = stripComments(readFileSync(join(UI, 'screens', screen), 'utf8'));
      expect(src).toMatch(/<RecommendedBand inset=/);
      expect(src).toMatch(/recommendedFrame\(\)/);
      // The frame stays gold when the card is chosen: a selected style after
      // it turned it green (found in a phone test: "why is the second container green while the
      // first one is orange???"). The choice is a RadioMark.
      expect(src).not.toMatch(/recommendedFrame\(\)[^\]]*&&\s*styles\.\w*On\b/);
    }
  });

  it('never dims a TOUCHABLE with opacity', () => {
    // `opacity` on a TouchableOpacity is not ours: the touchable drives that
    // property with its own native animation for press feedback and paints
    // from it, so the dim of an earlier render can stay on screen after the
    // control goes live. A phone test saw it on Send: "the continue button shows as
    // gray even if everything is ready to continue. It actually works if the
    // user clicks it" (2026-09-16). A touchable says "disabled" in COLOUR,
    // which re-renders like anything else. Dimming an inner View is fine, and
    // is how the header button and the dock do it.
    const offenders: string[] = [];
    for (const file of sourceFiles(UI)) {
      const src = stripComments(readFileSync(file, 'utf8'));
      // The DISABLED family only: a dim that marks a state the user can still
      // act on (a used address, a signed key, a frozen coin) is the same
      // mechanism and is on the list to move to colour, but it blocks nobody.
      const dimming = new Set<string>();
      for (const m of src.matchAll(/(\w+)\s*:\s*\{([^{}]*)\}/g)) {
        if (/disabled|dim\b/i.test(m[1]) && /\bopacity\s*:/.test(m[2])) dimming.add(m[1]);
      }
      if (dimming.size === 0) continue;
      for (const tag of src.matchAll(/<(?:TouchableOpacity|Pressable|TouchableHighlight)\b[\s\S]*?>/g)) {
        const styleProp = /style=\{([\s\S]*?)\}\s*(?:\n|[a-zA-Z]|>)/.exec(tag[0]);
        if (!styleProp) continue;
        for (const name of dimming) {
          if (new RegExp(`styles\\.${name}\\b`).test(styleProp[1])) {
            offenders.push(`${relative(SRC, file)}: ${name} on a touchable`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ships both halves of a shared portfolio in every build', () => {
    // A portfolio invite (TALIA-P-...) must be claimable from the watch-only
    // App Store build: sharing a hand-kept portfolio has nothing to do with
    // signing (decided 2026-09-12). So neither registration sits behind a flag.
    const routes = routesOf(ROOT);
    for (const name of ['SharePortfolio', 'ClaimSharedPortfolio']) {
      expect(routes.has(name)).toBe(true);
      expect(gateOf(name)).toBe('');
    }
    // And the deep link routes a portfolio code BEFORE the heir-invite gate.
    const handler = NAV.slice(NAV.indexOf('const openInvite'), NAV.indexOf('React.useEffect', NAV.indexOf('const openInvite')));
    expect(handler.indexOf('isPortfolioInviteCode')).toBeGreaterThan(0);
    expect(handler.indexOf('isPortfolioInviteCode')).toBeLessThan(handler.indexOf('!SIGNING_ENABLED'));
  });

  it('keeps the address book\'s two pages behind Send\'s own gate', () => {
    // The book is opened from Send and answers Send (decided 2026-11-05): a
    // page reachable where Send is not would hand an address to nothing, and
    // Send without them would open a dead "Address book" row.
    const routes = routesOf(ROOT);
    for (const name of ['AddressBook', 'AddAddress']) {
      expect(routes.has(name)).toBe(true);
      expect([name, gateOf(name)]).toEqual([name, gateOf('Send')]);
    }
    expect(gateOf('Send')).toMatch(/SIGNING_ENABLED/);
    expect(navigateTargets('SendScreen')).toEqual(expect.arrayContaining(['AddressBook', 'AddAddress']));
    expect(navigateTargets('AddressBookScreen')).toContain('AddAddress');
    // The book answers back through Send's own route, as EntrySource answers ManualEntry.
    const book = stripComments(readFileSync(join(UI, 'screens', 'AddressBookScreen.tsx'), 'utf8'));
    expect(book).toMatch(/navigation\.popTo\('Send', \{ walletId, picked: \{/);
  });

  it('keeps InviteHeir beside the Estate Plan questionnaire', () => {
    // The specific pairing the dead button came from: wherever the
    // questionnaire is offered, its success page must be able to finish the
    // job, so the two are registered under one gate.
    const routes = routesOf(ROOT);
    expect(routes.has('InheritanceSetup')).toBe(true);
    expect(routes.has('InviteHeir')).toBe(true);
    expect(gateOf('InviteHeir')).toBe(gateOf('InheritanceSetup'));
  });
});
