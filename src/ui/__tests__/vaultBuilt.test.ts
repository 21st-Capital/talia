/**
 * ONE "Vault built" page, after a vault is built in Talia and nowhere else
 * (decided 2026-10-02, design B "Keys into the lock", pace B2). Structural, like
 * sentPage.test: the repo has no component tests, and each rule below is a
 * line a later edit could quietly drop.
 *
 *   - both builders land on it, over the new vault, and nothing else does
 *     (no import, no claimed heir vault, no portfolio, no vault from another
 *     Talia);
 *   - its button takes the builders' own next step, decided by the vault
 *     page's own registration rule, so it never tells a vault whose keys need
 *     no registration to register;
 *   - the Face ID offer waits for it;
 *   - it runs on the Sent page's clock, on the native driver, never a layout
 *     value; the button is tappable only once live; and "Vault built" is
 *     Home's "Total Balance" through the one shared token.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { composeLayeredVault, composeMultisig, composeSinglesig, monthsToBlocks } from '../../bitcoin/descriptor/compose';
import type { KeyOrigin } from '../../bitcoin/descriptor';
import { isSingleSigVault, registrationWalk } from '../../wallet/keyDevices';
import type { WalletMeta } from '../../wallet/types';

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

/** The landing both builders make once the vault is saved. */
const LANDING =
  /landOverTab\('VaultsTab', \[\s*\{ name: 'WalletDetail', params: \{ walletId: wallet\.id \} \},\s*\{ name: 'VaultBuilt', params: \{ walletId: wallet\.id \} \},\s*\]\);/;

const BUILDERS = [
  { name: 'the vault wizard', file: 'screens/LayeredVaultScreen.tsx', from: 'const doCreate = async', to: 'const onCreate = () =>' },
  { name: 'Build your vault', file: 'screens/VaultBuilderScreen.tsx', from: 'const onCreate = async', to: 'const sections: Section[]' },
];

describe('the Vault built page', () => {
  it.each(BUILDERS)('$name lands on it, over the new vault, once the vault is saved', ({ file, from, to }) => {
    const create = between(code(read(file)), from, to);
    expect(create).toMatch(LANDING);
    expect(create.search(LANDING)).toBeGreaterThan(create.indexOf('await addWallet('));
    // The next step is the page's button now: the builder never takes it itself.
    expect(create).not.toMatch(/RegisterVault|promptHardwareRegistration/);
    expect(create.match(/name: 'VaultBuilt'/g)).toHaveLength(1);
  });

  it('nothing else lands on it: no import, no heir vault, no portfolio, no vault from another Talia', () => {
    const builders = BUILDERS.map((b) => join(UI, b.file));
    const routeUse = /name: 'VaultBuilt'|(navigate|replace|push|popTo)\(\s*'VaultBuilt'/;
    const landers = sources(UI)
      .filter((p) => routeUse.test(code(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(UI.length + 1));
    expect(landers.sort()).toEqual(builders.map((p) => p.slice(UI.length + 1)).sort());
    // Spelled out for the flows most likely to be wired to it by mistake.
    for (const rel of [
      'screens/ImportScreen.tsx',
      'screens/ClaimInviteScreen.tsx',
      'screens/ManualWalletSetupScreen.tsx',
      'screens/ClaimSharedPortfolioScreen.tsx',
    ]) {
      expect({ rel, mentions: /VaultBuilt\b/.test(code(read(rel))) }).toEqual({ rel, mentions: false });
    }
  });

  it('is a root-stack route with no header and no way back, under the builders’ own gate', () => {
    const nav = code(read('navigation/RootNavigator.tsx'));
    expect(nav).toMatch(
      /\{\(SIGNING_ENABLED \|\| HWW_ENABLED\) && \(\s*<RootStack\.Screen name="VaultBuilt" component=\{VaultBuiltScreen\} options=\{\{ headerShown: false, gestureEnabled: false, animationTypeForReplace: 'pop' \}\} \/>/,
    );
    expect(code(read('navigation/types.ts'))).toMatch(/VaultBuilt: \{ walletId: string \};/);
    // No header bar: the page pads for the status bar itself.
    const screen = code(read('screens/VaultBuiltScreen.tsx'));
    expect(screen).toMatch(/<Screen scroll style=\{styles\.content\}>\s*<VaultBuiltPage\b/);
    expect(screen).not.toMatch(/underHeader/);
  });

  it('arrives straight from the wizard: the reset pops the wizard away over it, so no frame of the vault page shows first', () => {
    // landOverTab's reset replaces the wizard with [WalletDetail, VaultBuilt].
    // react-native-screens animates a replace's default 'push' with UIKit's
    // setViewControllers, which pushes FROM the new screen beneath (the vault
    // page, with its own "Register now" card): it showed for a frame and then
    // slid away (simulator, 2026-10-02). 'pop' keeps the wizard's last step on
    // top and pops it, revealing this page, so nothing else is ever seen.
    const nav = code(read('navigation/RootNavigator.tsx'));
    const route = between(nav, '<RootStack.Screen name="VaultBuilt"', '/>');
    expect(route).toMatch(/animationTypeForReplace: 'pop'/);
    expect(route).not.toMatch(/animation:/);
    // Still landed OVER the vault page, through landOverTab, so the button's
    // pops reach it: never VaultBuilt alone, never a screen-dispatched reset.
    for (const b of BUILDERS) {
      const create = between(code(read(b.file)), b.from, b.to);
      expect(create).toMatch(LANDING);
      expect(create).not.toMatch(/resetOverTab|navigation\.dispatch|navigation\.(navigate|push|replace)\(\s*'VaultBuilt'/);
    }
    // The clock starts at the end of that pop: the page listens for its own
    // arrival, not for a push's.
    expect(code(read('screens/VaultBuiltScreen.tsx'))).toMatch(/addListener\('transitionEnd'/);
  });

  it('the button takes the builders’ next step, by the vault page’s own registration rule', () => {
    const screen = code(read('screens/VaultBuiltScreen.tsx'));
    const next = between(screen, 'function nextStep(', '\n}');
    expect(next).toMatch(/if \(SIGNING_ENABLED\) return isSingleSigVault\(wallet\) \? 'open' : 'register';/);
    // The walk runs under the same gate as on the vault page.
    expect(next).toMatch(/if \(!LEDGER_PREVIEW\) return 'open';/);
    expect(next).toMatch(/return registrationWalk\(wallet, ours\)\.length > 0 \? 'register' : 'open';/);
    const onNext = between(screen, 'const onNext = () => {', '\n  };');
    expect(onNext).toMatch(/if \(built\.next === 'open'\) \{\s*navigation\.popTo\('WalletDetail', \{ walletId \}\);/);
    expect(onNext).toMatch(/if \(SIGNING_ENABLED\) \{\s*navigation\.replace\('RegisterVault', \{ walletId, fresh: true \}\);/);
    expect(onNext).toMatch(/navigation\.popTo\('WalletDetail', \{ walletId, promptHardwareRegistration: true \}\);/);
    // The vault page's walk asks the very same function.
    expect(code(read('screens/WalletDetailScreen.tsx'))).toMatch(
      /const regChecklist = useCallback\(\(w: WalletMeta\) => registrationWalk\(w, known21C\), \[known21C\]\);/,
    );
    expect(screen).toMatch(/words=\{vaultBuiltWords\(built\.next\)\}/);
  });

  it('the Face ID offer waits for the page, and for the walk after it', () => {
    const screen = code(read('screens/VaultBuiltScreen.tsx'));
    expect(screen).toMatch(
      /useEffect\(\(\) => \{\s*deferFirstVaultSecurity\(\);\s*return \(\) => \{\s*if \(!handedToWalk\.current\) resumeFirstVaultSecurity\(\);\s*\};\s*\}, \[\]\);/,
    );
    // Handed over only on the way into the walk.
    const onNext = between(screen, 'const onNext = () => {', '\n  };');
    expect(onNext.indexOf('handedToWalk.current = true;')).toBeLessThan(
      onNext.indexOf("navigation.popTo('WalletDetail', { walletId, promptHardwareRegistration: true });"),
    );
    expect(onNext.match(/handedToWalk\.current = true/g)).toHaveLength(1);
    // A walk with nothing to ask hands the offer straight back.
    const detail = code(read('screens/WalletDetailScreen.tsx'));
    expect(detail).toMatch(
      /if \(!\(!SIGNING_ENABLED && LEDGER_PREVIEW\) \|\| regChecklist\(wallet\)\.length === 0\) \{\s*resumeFirstVaultSecurity\(\);\s*return;\s*\}/,
    );
  });

  it('starts once its push is over, its size settled and Reduce Motion known', () => {
    const screen = code(read('screens/VaultBuiltScreen.tsx'));
    expect(screen).toMatch(/navigation\.addListener\('transitionEnd', \(e\) => \{\s*if \(!e\.data\.closing\) setArrived\(true\);/);
    expect(screen).toMatch(/setTimeout\(\(\) => setArrived\(true\), ARRIVE_FALLBACK_MS\)/);
    const page = code(read('components/VaultBuiltPage.tsx'));
    expect(page).toMatch(/sized && arrived && reduce != null \? vaultBuiltTimeline\(reduce, keyCount\) : null/);
    expect(page).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    // The lock is laid out at its smallest first, then takes the room left.
    expect(page).toMatch(/box=\{box \?\? MIN_LOCK_BOX\}/);
    expect(page).toMatch(/settle\(vaultBuiltBox\(page, top \+ SPACER_MIN \+ foot\)\)/);
    for (const part of ['page', 'top', 'foot']) expect(page).toContain(`onLayout={measure('${part}')}`);
    expect(page).toMatch(/setTimeout\(\(\) => setBox\(\(cur\) => cur \?\? LOCK_BOX\), SIZE_FALLBACK_MS\)/);
    // The facts are read once: nothing the vault page learns moves a flying key.
    expect(screen).toMatch(/const \[built\] = useState</);
  });

  it('runs on the Sent page’s clock, with its own tracks, and plays the haptic once at the click', () => {
    const page = code(read('components/VaultBuiltPage.tsx'));
    expect(page).toMatch(/useSentTimeline\(VAULT_BUILT_TRACK_KEYS, timeline, 0, sentTick,/);
    expect(page.match(/sentTick/g)).toHaveLength(2); // the import and the one call
    // No second engine: no timing of its own anywhere on the page or the mark.
    for (const rel of ['components/VaultBuiltPage.tsx', 'components/VaultBuiltMark.tsx']) {
      expect(code(read(rel))).not.toMatch(/Animated\.(timing|parallel|sequence|loop|delay)\(/);
    }
  });

  it('animates on the native driver only, and never a layout value', () => {
    for (const rel of ['components/VaultBuiltMark.tsx', 'components/VaultBuiltPage.tsx']) {
      const src = code(read(rel));
      expect(src).not.toMatch(/useNativeDriver:\s*false/);
      expect(src).not.toMatch(/LayoutAnimation|setNativeProps|Animated\.spring/);
      // Every interpolation drives a stroke offset, a transform or opacity.
      expect(src).not.toMatch(/(height|width|top|left|right|bottom|margin\w*|padding\w*)\s*:\s*[\w.]+\.interpolate\(/);
    }
    // The mark is decoration; VoiceOver hears the page.
    expect(code(read('components/VaultBuiltMark.tsx'))).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it('the button is visible as it rises but tappable only once live, and VoiceOver hears the title and the name then', () => {
    const page = code(read('components/VaultBuiltPage.tsx'));
    expect(page).toMatch(/pointerEvents=\{live \? 'auto' : 'none'\}/);
    expect(page).toMatch(/accessibilityElementsHidden=\{!live\}/);
    expect(page).toMatch(
      /setLive\(true\);\s*AccessibilityInfo\.announceForAccessibility\(vaultBuiltAnnouncement\(facts\)\);/,
    );
    expect(page).toMatch(/<Text style=\{styles\.title\} accessibilityRole="header">/);
  });

  it('reads top to bottom as the design: lock, "Vault built", the name, the shape line, the Keys card, the sub line, the button', () => {
    const page = code(read('components/VaultBuiltPage.tsx'));
    const order = [
      '<VaultBuiltMark',
      '{words.title}',
      '<FitText style={styles.hero}>{facts.name}</FitText>',
      '{vaultBuiltLine(facts)}',
      '<SentCard title="Keys" rows={rows} />',
      '<View style={styles.spacer} />',
      '{words.sub}',
      '<Button title={words.action} onPress={onNext} />',
    ];
    const at = order.map((s) => page.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The Sent page's own card, never one of its own.
    expect(page).not.toMatch(/<Card\b/);
    expect(code(read('components/VaultBuiltMark.tsx'))).not.toMatch(/<Card\b/);
    expect(page).toMatch(/hero: heroFigure\(\),/); // the one hero figure (theme heroFigure)
    expect(page).toMatch(/centre: \{ alignItems: 'center', alignSelf: 'stretch', gap: 4 \}/);
  });

  it('the lock disc is glass: the app’s own finish, settling in under the inked outline (decided 2026-10-02)', () => {
    const mark = code(read('components/VaultBuiltMark.tsx'));
    // HeaderIconButton's recipe: the raised surface, clipped, no hairline, and Gloss as the FIRST child.
    const recipe = between(mark, 'glass: {', '}');
    expect(recipe).toMatch(/backgroundColor: theme\.colors\.surfaceRaised/);
    expect(recipe).toMatch(/overflow: 'hidden'/);
    expect(recipe).not.toMatch(/border|hairline/);
    expect(mark).toMatch(
      /<Animated\.View style=\{\[styles\.glass, d\.disc, \{ opacity: d\.glassIn, transform: \[\{ scale: d\.glassScale \}\] \}\]\}>\s*<Gloss size=\{d\.disc\.width\} radius=\{d\.disc\.width \/ 2\} \/>\s*<\/Animated\.View>/,
    );
    expect(mark.match(/<Gloss\b/g)).toHaveLength(1);
    // The glass is the disc exactly (the outline is inked at LOCK_R), placed by the model.
    expect(mark).toMatch(/const glass = lockGlass\(box\);/);
    expect(mark).toMatch(
      /disc: \{ width: glass\.size, height: glass\.size, borderRadius: glass\.size \/ 2, left: glass\.inset, top: glass\.inset \}/,
    );
    // It settles in off the pen's own track as the ink completes: opacity and scale, native driver, no clock of its own.
    expect(mark).toMatch(
      /const glassIn = pen\.interpolate\(\{ inputRange: \[GLASS_IN\.from, GLASS_IN\.to\], outputRange: \[0, 1\], extrapolate: 'clamp' \}\);/,
    );
    expect(mark).toMatch(/glassScale: glassIn\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[GLASS_SCALE_FROM, 1\] \}\)/);
    // Drawn in order: the rings outside it, the glass, then the outline's sketch and ink,
    // the keyhole on the glass in the ink colour, and the green ring around its edge.
    const order = ['opacity: values.rings', 'styles.glass', 'offset={d.sketch}', 'offset={d.ink}', 'offset={d.keyholeEye}', 'offset={d.green}'];
    const at = order.map((s) => mark.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(mark).toMatch(/offset=\{d\.keyholeEye\} color=\{theme\.colors\.offWhite\}/);
    expect(mark).toMatch(/offset=\{d\.green\} color=\{theme\.colors\.positive\}/);
  });

  it('"Vault built" is Home’s "Total Balance", and the tab heroes and the vault’s and portfolio’s names share that one token', () => {
    expect(code(read('components/VaultBuiltPage.tsx'))).toMatch(/title: heroLabel\(\),/);
    expect(code(read('screens/WalletListScreen.tsx'))).toMatch(/totalLabel: heroLabel\(\),/);
    expect(code(read('screens/VirtualVaultsListScreen.tsx'))).toMatch(/totalLabel: heroLabel\(\),/);
    expect(code(read('screens/WalletDetailScreen.tsx'))).toMatch(/heroName: heroLabel\(\),/);
    expect(code(read('screens/ManualWalletScreen.tsx'))).toMatch(/heroName: heroLabel\(\),/);
    const theme = code(read('theme/index.ts'));
    expect(theme).toMatch(/return \{ \.\.\.typography\.label, color: activePalette\(\)\.slate, textAlign: 'center' \};/);
    // Nobody spells it out by hand any more.
    const byHand = /\.\.\.theme\.typography\.label, color: theme\.colors\.slate, textAlign: 'center' \}/;
    const copies = sources(UI)
      .filter((p) => byHand.test(code(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(UI.length + 1));
    expect(copies).toEqual([]);
  });

  it('the row of keys scales with the lock box: glyph, spacing, names and their type, from the model’s one row', () => {
    // On an iPhone SE the lock shrinks to 110 while the keys kept their 30pt
    // and 104pt spacing and looked big beside it (decided 2026-10-02).
    const mark = code(read('components/VaultBuiltMark.tsx'));
    expect(mark).toMatch(/const row = keyRow\(n, pageW, box\);/);
    // No design-size literal survives in the mark: the row carries every size.
    expect(mark).not.toMatch(/KEY_ICON|KEY_START_Y|KEY_LABEL_TOP|KEY_GAP_X|KEY_LABEL_W/);
    expect(mark).toMatch(/<KeyIcon size=\{d\.icon\}/);
    expect(mark).toMatch(/keyAt: \{ left: box \/ 2 - row\.icon \/ 2, top: box \/ 2 - row\.icon \/ 2, width: row\.icon, height: row\.icon \}/);
    expect(mark).toMatch(/label: \{ width: row\.labelW, left: \(row\.icon - row\.labelW\) \/ 2, top: row\.labelTop \}/);
    expect(mark).toMatch(/outputRange: \[row\.startY, 0\]/);
    expect(mark).toMatch(
      /fontSize: theme\.typography\.caption\.fontSize \* row\.nameScale,\s*lineHeight: theme\.typography\.caption\.lineHeight \* row\.nameScale,/,
    );
    expect(mark).toMatch(/style=\{\[styles\.keyName, d\.label, d\.nameType, \{ opacity: d\.keys\[i\]\.name \}\]\}/);
  });

  it('is themed, uses theme tokens only, and never writes an em dash', () => {
    for (const rel of [
      'components/VaultBuiltMark.tsx',
      'components/VaultBuiltPage.tsx',
      'components/vaultBuiltModel.ts',
      'screens/VaultBuiltScreen.tsx',
    ]) {
      const src = code(read(rel));
      if (rel.endsWith('.tsx')) {
        expect(src).toMatch(/themedStyles\(/);
        expect(src).not.toMatch(/=\s*StyleSheet\.create\(/);
        expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
        expect(src).not.toMatch(/rgba?\(/);
      }
      const strings = src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect(strings.filter((s) => /[—–]/.test(s))).toEqual([]);
    }
    // The model stays pure: no React Native, so the tests above run in Node.
    expect(code(read('components/vaultBuiltModel.ts'))).not.toMatch(/from 'react-native'|from 'react'/);
  });
});

// ------------------------------------------------------------------ the next step, per shape

const xpub = {
  a: 'tpubD6NzVbkrYhZ4XKTpDpd55aveE9jaKSRetSgKpxsQeVys9ePqDdtLsFteg7VrWuew2sRoK6ACau4GDaY3CHoytheBCpPH28qkTt49iHXtXVg',
  b: 'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3',
  c: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
  ours: 'tpubD6NzVbkrYhZ4XJDrzRvuxHEyQaPd1mwwdDofEJwekX18tAdsqeKfxss79AJzg1431FybXg5rfpTrJF4iAhyR7RubberdzEQXiRmXGADH2eA',
  heir: 'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp',
  rescue: 'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK',
};
const k = (fingerprint: string, x: string, originPath = "48'/1'/0'/2'"): KeyOrigin => ({ fingerprint, originPath, xpub: x });
const A = k('a1b2c3d4', xpub.a);
const B = k('5e6f7a8b', xpub.b);
const C = k('0c0ffee0', xpub.c);
const OURS = k('21c0c051', xpub.ours);
const HEIR = k('9c0d1e2f', xpub.heir);
const RESCUE = k('21c0e5c0', xpub.rescue);

function built(descriptor: string, over: Partial<WalletMeta> = {}): WalletMeta {
  return {
    id: 'w1',
    label: 'Vault',
    descriptor,
    network: 'testnet',
    kind: descriptor.startsWith('wpkh(') ? 'single-sig' : descriptor.startsWith('wsh(sortedmulti') ? 'multisig' : 'miniscript',
    source: 'created',
    transport: 'created',
    createdAt: 0,
    ...over,
  } as WalletMeta;
}
const ours = new Set(['21c0c051', '21c0e5c0']);
const next = (w: WalletMeta) => (registrationWalk(w, ours).length > 0 ? 'register' : 'open');

describe('the button’s next step, per vault shape (the vault page’s own walk)', () => {
  it('a plain single key has nothing to register: Open the vault', () => {
    const w = built(composeSinglesig(k('a1b2c3d4', xpub.a, "84'/1'/0'")));
    expect(isSingleSigVault(w)).toBe(true);
    expect(next(w)).toBe('open');
  });

  it('a self-custodial 2 of 3 is shown to its devices: Register on hardware', () => {
    expect(next(built(composeMultisig(2, [A, B, C], { script: 'wsh' })))).toBe('register');
  });

  it('a 2 of 3 with our co-signer registers the client’s own devices, never ours', () => {
    const w = built(composeMultisig(2, [A, B, OURS], { providerFingerprints: ['21c0c051'] }), {
      providerKeyFingerprints: ['21c0c051'],
    });
    expect(next(w)).toBe('register');
    const asked = registrationWalk(w, ours).flatMap((i) => (i.fingerprint ? [i.fingerprint] : []));
    expect(asked).not.toContain('21c0c051');
  });

  it('layered with an heir and the rescue key: the owner’s everyday keys, never the heir’s or ours', () => {
    const w = built(
      composeLayeredVault({ threshold: 2, keys: [OURS, A, B] }, [
        { threshold: 1, keys: [HEIR], olderBlocks: monthsToBlocks(8) },
        { threshold: 1, keys: [RESCUE], olderBlocks: monthsToBlocks(15) },
      ]),
      { heirs: [{ id: 'h1', fingerprint: '9c0d1e2f', months: 8 }], providerKeyFingerprints: ['21c0c051', '21c0e5c0'] },
    );
    expect(next(w)).toBe('register');
    const items = registrationWalk(w, ours);
    expect(items).toHaveLength(1);
    expect(items[0].fingerprint).toBeNull(); // both of the owner's keys, one row
  });

  it('one key with a timelock is shown to its device too (the custom builder missed it before)', () => {
    const w = built(
      composeLayeredVault({ threshold: 1, keys: [A] }, [{ threshold: 1, keys: [B], olderBlocks: monthsToBlocks(12) }]),
    );
    expect(isSingleSigVault(w)).toBe(false);
    expect(next(w)).toBe('register');
  });

  it('a vault no device can be shown is never told to register', () => {
    // Separate receive and change lists: no device takes that shape.
    const w = built(`wsh(sortedmulti(2,[a1b2c3d4/48'/1'/0'/2']${xpub.a}/0/*,[5e6f7a8b/48'/1'/0'/2']${xpub.b}/0/*))`);
    expect(next(w)).toBe('open');
  });
});
