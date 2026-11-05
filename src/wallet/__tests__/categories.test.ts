import {
  sectionsForWallets,
  visibleWallets,
  visibleTotalSats,
  manualTotalSats,
  effectiveCategory,
  portfolioCategory,
  portfolioSectionsFor,
  isBuiltinCategory,
  isBuiltinPortfolioCategory,
  vaultSectionChoices,
  portfolioSectionChoices,
  allCategories,
  categoryTitleFor,
  storedCategoryFor,
  hiddenSectionKeys,
  withSectionHidden,
  CATEGORY_OTHER,
  CATEGORY_SAVINGS,
  CATEGORY_SPENDING,
  CATEGORY_VIRTUAL,
  CATEGORY_SINGLE_SIG,
  CATEGORY_MULTISIG,
} from '../categories';
import type { WalletMeta } from '../types';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { MULTISIG_2_OF_3, SPARROW_SINGLE_SIG } from '../../bitcoin/descriptor/__fixtures__/descriptors';

function w(id: string, category?: string, descriptor = SPARROW_SINGLE_SIG): WalletMeta {
  return {
    id,
    label: id,
    descriptor,
    network: 'bitcoin',
    kind: 'single-sig',
    source: 'generic',
    transport: 'paste',
    createdAt: 0,
    category,
  };
}

/** A shared vault, for the section its shape puts it in. */
const multi = (id: string, category?: string): WalletMeta => ({
  ...w(id, category, MULTISIG_2_OF_3),
  kind: 'multisig',
});

describe('sectionsForWallets', () => {
  it('sections a vault by its own shape, custom labels after (decided 2026-09-09)', () => {
    const sections = sectionsForWallets([w('a'), multi('b'), w('c'), multi('d', 'Inheritance')]);
    expect(sections.map((s) => s.title)).toEqual(['Single-sig', 'Multisig', 'Inheritance']);
    expect(sections[0].data.map((x) => x.id)).toEqual(['a', 'c']);
    expect(sections[1].data.map((x) => x.id)).toEqual(['b']);
  });

  it('the retired auto-stamps are not a choice: the shape still decides', () => {
    // 'savings' was written at creation, never picked, so it must not pin a
    // vault to a section the owner never chose.
    const sections = sectionsForWallets([w('a', CATEGORY_SAVINGS), multi('b', CATEGORY_SPENDING)]);
    expect(sections.map((s) => s.key)).toEqual([CATEGORY_SINGLE_SIG, CATEGORY_MULTISIG]);
  });

  it('a label chosen on Arrange wins over the shape', () => {
    expect(effectiveCategory(w('a', 'Cold storage'))).toBe('Cold storage');
    expect(effectiveCategory(multi('b', CATEGORY_SINGLE_SIG))).toBe(CATEGORY_SINGLE_SIG);
  });

  it('a descriptor nothing can read lands in Other rather than a guess', () => {
    expect(effectiveCategory(w('x', undefined, 'not a descriptor'))).toBe('');
  });

  it('omits empty sections and keeps custom labels verbatim', () => {
    const sections = sectionsForWallets([w('a', 'Cold storage')]);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Cold storage');
  });
});

describe('Virtual section (manual wallets)', () => {
  const manual = (id: string, category?: string): WalletMeta => ({
    ...w(id, category),
    descriptor: '',
    manual: true,
  });

  it('sections manual wallets under Virtual', () => {
    const sections = sectionsForWallets([w('chain', CATEGORY_SAVINGS), manual('hand')]);
    const virtual = sections.find((s) => s.key === CATEGORY_VIRTUAL);
    expect(virtual?.title).toBe('Virtual');
    expect(virtual?.data.map((x) => x.id)).toEqual(['hand']);
  });

  it('the flag wins over a stray category — a legacy manual wallet cannot strand under Other', () => {
    // The first device test's manual wallet was created before the category existed.
    const sections = sectionsForWallets([manual('legacy', undefined), manual('stray', 'savings')]);
    expect(sections.map((s) => s.key)).toEqual([CATEGORY_VIRTUAL]);
    expect(sections[0].data.map((x) => x.id)).toEqual(['legacy', 'stray']);
  });

  it('Virtual sorts after custom labels, before Other', () => {
    const sections = sectionsForWallets([
      w('o', undefined, 'not a descriptor'),
      manual('m'),
      w('c', 'Cold storage'),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['Cold storage', CATEGORY_VIRTUAL, '']);
  });

  it('hiding the Virtual category hides every manual wallet, category field or not', () => {
    const list = [w('chain', CATEGORY_SAVINGS), manual('legacy', undefined), manual('new', 'virtual')];
    expect(visibleWallets(list, [CATEGORY_VIRTUAL]).map((x) => x.id)).toEqual(['chain']);
  });

  it('effectiveCategory: the manual flag beats everything, then a chosen label, then the shape', () => {
    expect(effectiveCategory(manual('a', 'savings'))).toBe(CATEGORY_VIRTUAL);
    expect(effectiveCategory(manual('b', undefined))).toBe(CATEGORY_VIRTUAL);
    expect(effectiveCategory(w('c', 'Cold storage'))).toBe('Cold storage');
    expect(effectiveCategory(w('d'))).toBe(CATEGORY_SINGLE_SIG);
    expect(effectiveCategory(multi('e'))).toBe(CATEGORY_MULTISIG);
  });

  it('manual balances stay out of the on-chain total and in the manual total', () => {
    const chain = { ...w('chain', CATEGORY_SAVINGS), cachedBalanceSats: 5000 };
    const hand = { ...manual('hand'), cachedBalanceSats: 3000 };
    expect(visibleTotalSats([chain, hand], [])).toBe(5000);
    expect(manualTotalSats([chain, hand], [])).toBe(3000);
  });
});

describe('Portfolio tab sections (decided 2026-09-02)', () => {
  const manual = (id: string, category?: string): WalletMeta => ({
    ...w(id, category),
    descriptor: '',
    manual: true,
  });

  it('portfolioCategory: undefined and the legacy "virtual" both read as Other; labels are trimmed', () => {
    expect(portfolioCategory(manual('legacy', undefined))).toBe('');
    expect(portfolioCategory(manual('stamped', 'virtual'))).toBe('');
    expect(portfolioCategory(manual('padded', '  Family  '))).toBe('Family');
  });

  it('portfolioCategory leaves the home screen alone: effectiveCategory still answers Virtual', () => {
    const p = manual('family', 'Family');
    expect(portfolioCategory(p)).toBe('Family');
    expect(effectiveCategory(p)).toBe(CATEGORY_VIRTUAL);
    expect(sectionsForWallets([p]).map((s) => s.key)).toEqual([CATEGORY_VIRTUAL]);
  });

  it('custom labels alphabetical, then My Portfolios; no Savings/Spending built-ins', () => {
    const sections = portfolioSectionsFor([
      manual('a'),
      manual('b', 'Trading'),
      manual('c', 'Family'),
      manual('d', 'virtual'),
      manual('e', 'Family'),
      manual('f', 'savings'),
    ]);
    // localeCompare, like the vault sections: case-insensitive alphabetical,
    // and "savings" is just a label here, not a built-in.
    expect(sections.map((s) => s.title)).toEqual(['Family', 'savings', 'Trading', 'My Portfolios']);
    expect(sections.map((s) => s.key)).toEqual(['Family', 'savings', 'Trading', '']);
    expect(sections[0].data.map((x) => x.id)).toEqual(['c', 'e']);
    expect(sections[3].data.map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('respects the portfolio order list; unknown keys sink after the ordered ones', () => {
    const list = [manual('a'), manual('b', 'Trading'), manual('c', 'Family'), manual('d', 'Kids')];
    expect(portfolioSectionsFor(list, ['', 'Trading']).map((s) => s.key)).toEqual([
      '',
      'Trading',
      'Family',
      'Kids',
    ]);
    // A stale key in the order list is harmless.
    expect(portfolioSectionsFor(list, ['Gone', 'Kids']).map((s) => s.key)).toEqual([
      'Kids',
      'Family',
      'Trading',
      '',
    ]);
  });

  it('omits empty sections and ignores on-chain wallets entirely', () => {
    expect(portfolioSectionsFor([manual('a', 'Family')]).map((s) => s.key)).toEqual(['Family']);
    expect(portfolioSectionsFor([w('chain'), w('cold', 'Cold storage')])).toEqual([]);
    const mixed = portfolioSectionsFor([w('chain', 'Family'), manual('p', 'Family'), w('o')]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].data.map((x) => x.id)).toEqual(['p']);
  });
});

describe('Arrange section chips (decided 2026-09-12)', () => {
  const manual = (id: string, category?: string): WalletMeta => ({
    ...w(id, category),
    descriptor: '',
    manual: true,
  });
  /** The chips Arrange's name dialog offers vault `v` when the list holds `list`. */
  const chipsFor = (list: WalletMeta[], v: WalletMeta) =>
    vaultSectionChoices(
      sectionsForWallets(list).map((s) => s.key),
      effectiveCategory(v),
    );

  it('a vault filed under the single-sig key gets ONE Single-sig chip, selected', () => {
    // A "Test vault" (a BlueWallet zpub) after a Done on Arrange: the
    // stored category is the raw key, and so is its section's key.
    const vault = w('test', CATEGORY_SINGLE_SIG);
    const chips = chipsFor([vault], vault);
    expect(chips.map((c) => c.title)).toEqual(['Single-sig', 'Multisig', 'Other']);
    expect(chips.filter((c) => c.selected).map((c) => c.key)).toEqual([CATEGORY_SINGLE_SIG]);
  });

  it('the same when nothing is stored and the shape files the vault', () => {
    const vault = w('test');
    const chips = chipsFor([vault, multi('shared')], vault);
    expect(chips.map((c) => c.title)).toEqual(['Single-sig', 'Multisig', 'Other']);
    expect(chips.filter((c) => c.selected).map((c) => c.key)).toEqual([CATEGORY_SINGLE_SIG]);
  });

  it('other sections follow in list order, one chip each, titled like their headers', () => {
    const keys = [
      'Family',
      CATEGORY_MULTISIG,
      '',
      CATEGORY_SINGLE_SIG,
      'Cold storage',
      CATEGORY_VIRTUAL,
    ];
    const chips = vaultSectionChoices(keys, 'Cold storage');
    expect(chips.map((c) => c.title)).toEqual([
      'Single-sig',
      'Multisig',
      'Other',
      'Family',
      'Cold storage',
      'Virtual',
    ]);
    expect(chips.filter((c) => c.selected).map((c) => c.title)).toEqual(['Cold storage']);
  });

  it('every section the vaults make by themselves is built in; a chosen label is not', () => {
    // What Arrange leans on to refuse a rename or a typed name and to keep
    // an emptied section. Its old copy of this list missed the shape keys.
    const byThemselves = sectionsForWallets([
      w('a'),
      multi('b'),
      w('o', undefined, 'not a descriptor'),
      manual('m'),
      w('c', 'Cold storage'),
    ])
      .map((s) => s.key)
      .filter((k) => k !== 'Cold storage');
    expect(byThemselves).toEqual([CATEGORY_SINGLE_SIG, CATEGORY_MULTISIG, CATEGORY_VIRTUAL, '']);
    expect(byThemselves.every(isBuiltinCategory)).toBe(true);
    expect(isBuiltinCategory('Cold storage')).toBe(false);
    // The retired stamps stay reserved.
    expect(isBuiltinCategory(CATEGORY_SAVINGS)).toBe(true);
    expect(isBuiltinCategory(CATEGORY_SPENDING)).toBe(true);
  });

  it('portfolios: My Portfolios once, then the labels; the legacy "virtual" is My Portfolios', () => {
    const list = [manual('a', CATEGORY_VIRTUAL), manual('b', 'Family'), manual('c')];
    const keys = portfolioSectionsFor(list).map((s) => s.key);
    const chips = portfolioSectionChoices(keys, portfolioCategory(list[0]));
    expect(chips.map((c) => c.title)).toEqual(['My Portfolios', 'Family']);
    expect(chips.filter((c) => c.selected).map((c) => c.title)).toEqual(['My Portfolios']);
    expect(isBuiltinPortfolioCategory('')).toBe(true);
    expect(isBuiltinPortfolioCategory(CATEGORY_VIRTUAL)).toBe(true);
    expect(isBuiltinPortfolioCategory('Family')).toBe(false);
  });
});

describe('Other, chosen on Arrange (decided 2026-10-07)', () => {
  const manual = (id: string, category?: string): WalletMeta => ({
    ...w(id, category),
    descriptor: '',
    manual: true,
  });

  it('a vault moved to Other STAYS under Other, readable descriptor and all', () => {
    // The leftover from 2026-09-09: Done stored undefined for that section, which
    // reads as "no choice was made", so the vault came back under its shape.
    const single = w('a', CATEGORY_OTHER);
    const shared = multi('b', CATEGORY_OTHER);
    expect(effectiveCategory(single)).toBe('');
    expect(effectiveCategory(shared)).toBe('');
    expect(sectionsForWallets([single, shared]).map((s) => s.title)).toEqual(['Other']);
  });

  it('what Arrange stores reads back as the section it filed the vault under', () => {
    for (const key of [CATEGORY_SINGLE_SIG, CATEGORY_MULTISIG, 'Cold storage', '']) {
      expect(effectiveCategory(w('a', storedCategoryFor(key, 'vaults')))).toBe(key);
    }
    // '' is the one key that cannot be stored as itself.
    expect(storedCategoryFor('', 'vaults')).toBe(CATEGORY_OTHER);
    expect(storedCategoryFor('Cold storage', 'vaults')).toBe('Cold storage');
  });

  it('a portfolio filed under My Portfolios still stores nothing at all', () => {
    const stored = storedCategoryFor('', 'portfolios');
    expect(stored).toBeUndefined();
    expect(portfolioCategory(manual('p', stored))).toBe('');
    expect(portfolioCategory(manual('q', storedCategoryFor('Family', 'portfolios')))).toBe('Family');
    // And the marker never reaches that tab, so the home screen's Virtual
    // section is untouched either way.
    expect(effectiveCategory(manual('p'))).toBe(CATEGORY_VIRTUAL);
  });

  it('the marker is a built-in key: never a typed label, never a raw header', () => {
    // Arrange refuses a built-in key as a section name, so nobody can type
    // "other" back in as a label effectiveCategory would then swallow.
    expect(isBuiltinCategory(CATEGORY_OTHER)).toBe(true);
    expect(categoryTitleFor(CATEGORY_OTHER, 1)).toBe('Other');
    expect(categoryTitleFor('', 1)).toBe('Other');
  });

  it('chosen or unreadable, Other is ONE section to list and ONE to hide', () => {
    const chosen = w('a', CATEGORY_OTHER); // readable, moved by hand
    const unreadable = w('b', undefined, 'not a descriptor');
    expect(allCategories([chosen, unreadable])).toEqual(['']);
    expect(visibleWallets([chosen, unreadable], ['']).map((x) => x.id)).toEqual([]);
  });

  it('an old hidden "other" hides Other, and Settings shows it hidden (decided 2026-10-15)', () => {
    // Builds before 2026-09-07 let a section be typed as "other"
    // and hidden by that name. effectiveCategory now reads such a vault as
    // Other itself, so the saved entry must hide Other, or the vault and its
    // balance came back on the home screen with no switch left to clear it.
    const typed = w('a', 'other'); // the old typed label, same spelling as the marker
    const unreadable = w('b', undefined, 'not a descriptor');
    const shown = w('c', CATEGORY_MULTISIG);
    expect(allCategories([typed, unreadable])).toEqual(['']);
    expect(visibleWallets([typed, unreadable, shown], ['other']).map((x) => x.id)).toEqual(['c']);
    expect(hiddenSectionKeys(['other']).has('')).toBe(true);
    expect(hiddenSectionKeys([CATEGORY_MULTISIG]).has('')).toBe(false);
  });

  it('the Other switch writes "" and drops the old spelling either way', () => {
    // Showing Other again clears the old entry rather than leaving it behind.
    expect(withSectionHidden(['other', CATEGORY_MULTISIG], '', false)).toEqual([CATEGORY_MULTISIG]);
    expect(withSectionHidden(['other', '', 'Cold storage'], '', false)).toEqual(['Cold storage']);
    // Hiding writes the section's own key once, never a second spelling.
    expect(withSectionHidden(['other'], '', true)).toEqual(['']);
    expect(withSectionHidden([], '', true)).toEqual(['']);
    // Every other section is written and cleared by its own key, as before.
    expect(withSectionHidden([], CATEGORY_SINGLE_SIG, true)).toEqual([CATEGORY_SINGLE_SIG]);
    expect(withSectionHidden([CATEGORY_SINGLE_SIG, ''], CATEGORY_SINGLE_SIG, false)).toEqual(['']);
  });

  it('the name dialog lights Other once for a vault filed there', () => {
    const vault = w('a', CATEGORY_OTHER);
    const chips = vaultSectionChoices(
      sectionsForWallets([vault]).map((s) => s.key),
      effectiveCategory(vault),
    );
    expect(chips.map((c) => c.title)).toEqual(['Single-sig', 'Multisig', 'Other']);
    expect(chips.filter((c) => c.selected).map((c) => c.title)).toEqual(['Other']);
  });
});

describe('the default icon follows the section (decided 2026-10-07)', () => {
  // `walletIconFor` is `defaultIconFor(effectiveCategory(w))`, so these are the
  // values the icon maps. They used to be read off the stored category, which
  // is empty until the first Done on Arrange: a vault showed the bitcoin sign
  // under "Single-sig" and then flipped to the wallet icon for no visible
  // reason.
  it('a vault nobody has arranged already answers its shape', () => {
    expect(w('a').category).toBeUndefined();
    expect(effectiveCategory(w('a'))).toBe(CATEGORY_SINGLE_SIG);
    expect(effectiveCategory(multi('b'))).toBe(CATEGORY_MULTISIG);
  });

  it('Other and a custom label keep the plain default', () => {
    expect(effectiveCategory(w('a', CATEGORY_OTHER))).toBe('');
    expect(effectiveCategory(w('b', undefined, 'not a descriptor'))).toBe('');
    expect(effectiveCategory(w('c', 'Cold storage'))).toBe('Cold storage');
  });
});

describe('the stored category is read in ONE place', () => {
  // Sectioning, hiding, the Settings list and now the default icons all go
  // through categories.ts. A screen reading `wallet.category` itself is how
  // both halves of this fix were missed in the first place.
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : files(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  it('no screen or component reads a wallet\'s category field', () => {
    const offenders = files(join(__dirname, '..', '..', 'ui')).filter((f) =>
      /\.category\b/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('no screen reads the saved hidden list without the Other mapping', () => {
    const offenders = files(join(__dirname, '..', '..', 'ui')).filter((f) =>
      /hiddenCategories\.(includes|indexOf|filter|some)\b/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('defaultIconFor is called only where the helper lives', () => {
    const offenders = files(join(__dirname, '..', '..', 'ui')).filter(
      (f) => /\bdefaultIconFor\s*\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('walletIcons.tsx'),
    );
    expect(offenders).toEqual([]);
  });
});
