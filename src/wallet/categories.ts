/**
 * Wallet categories for the home screen sections.
 *
 * Decided 2026-09-09: "add Single sig and multisig as the main two section
 * categories ... do not ask the user the question under which category he
 * wants to add the vault ... unless he goes himself and changes it
 * manually under the arrange settings." So a vault's section is DERIVED
 * from its own shape, and nothing is written at creation or import. A
 * label on `wallet.category` is therefore always a deliberate choice made
 * on the Arrange screen, and it wins.
 *
 * The old built-ins 'savings' and 'spending' were STAMPED automatically at
 * creation, never chosen, so they are read as "no choice made" and those
 * vaults fall into the section their shape decides. The same trick keeps
 * portfolios out of a legacy 'virtual' section, a few lines down.
 *
 * Because an unset category means "no choice made", the one choice that CAN'T
 * be stored as itself is Other, whose section is keyed `''`: see
 * CATEGORY_OTHER.
 */
import { parseKeyOrigins, stripChecksum } from '../bitcoin/descriptor';
import type { WalletMeta } from './types';

/** Retired as automatic stamps; read as "unset" wherever they survive. */
export const CATEGORY_SAVINGS = 'savings';
export const CATEGORY_SPENDING = 'spending';
export const CATEGORY_SINGLE_SIG = 'single-sig';
export const CATEGORY_MULTISIG = 'multisig';
/**
 * "Other", CHOSEN. The section itself is keyed `''` everywhere, and `''`
 * cannot be stored: an unset category reads as "no choice was made", so a
 * vault whose descriptor Talia CAN read was filed under Other on Arrange and
 * came straight back under Single-sig or Multisig (decided 2026-10-07). This
 * marker is what that choice looks like on disk, and `effectiveCategory`
 * reads it back as the section's own key. Vaults only: a portfolio's "My
 * Portfolios" is still an unset category (see `portfolioCategory`).
 */
export const CATEGORY_OTHER = 'other';
/** Manual wallets live here (decided 2026-08-25) — grouped apart from on-chain
 *  vaults so "kept by hand" reads at the section level, not just per card. */
export const CATEGORY_VIRTUAL = 'virtual';

/**
 * The category a wallet ACTS in. For manual wallets the flag is the truth —
 * they always behave as Virtual, whatever `category` says (a legacy manual
 * wallet created before the category existed has none at all). Every consumer
 * (sectioning, hiding, the settings list) must go through this, or a wallet
 * can show under one section and hide under another.
 */
export function effectiveCategory(w: WalletMeta): string {
  if (w.manual) return CATEGORY_VIRTUAL;
  const c = w.category?.trim() ?? '';
  // Other, chosen on Arrange: the section is keyed '' and the marker is that
  // choice stored. Read before the label test, so it never becomes a label.
  if (c === CATEGORY_OTHER) return '';
  // A deliberate label wins. The two retired auto-stamps do not count as
  // one, so those vaults follow their shape like every new vault.
  if (c && c !== CATEGORY_SAVINGS && c !== CATEGORY_SPENDING) return c;
  return shapeCategory(w);
}

/**
 * What Arrange STORES for a wallet it has just filed under `sectionKey`, which
 * is a key of the list it was dragged on (an effective category, or '' for the
 * section at the bottom).
 *
 * The round trip is the whole point: `effectiveCategory` for a vault and
 * `portfolioCategory` for a portfolio have to read the answer back as that
 * same key. Other needs the marker to survive it; a portfolio's My Portfolios
 * needs the opposite, nothing stored at all, since its tab reads an unset
 * category as its own default section.
 */
export function storedCategoryFor(
  sectionKey: string,
  mode: 'vaults' | 'portfolios',
): string | undefined {
  if (sectionKey !== '') return sectionKey;
  return mode === 'portfolios' ? undefined : CATEGORY_OTHER;
}

/**
 * The section a vault's own shape puts it in. A descriptor the parser
 * cannot read at all lands in "Other" rather than being called something
 * it might not be.
 */
export function shapeCategory(w: WalletMeta): string {
  if (w.manual || !w.descriptor) return '';
  try {
    const keys = parseKeyOrigins(stripChecksum(w.descriptor).body);
    const distinct = new Set(keys.map((k) => k.fingerprint?.toLowerCase() ?? k.xpub));
    // No key at all means the string was not understood. `sigTypeLabel`
    // answers "Single-sig" there, which is the right answer to "how many
    // keys did I see" and the wrong one to "which section is this".
    if (distinct.size === 0) return '';
    return distinct.size > 1 ? CATEGORY_MULTISIG : CATEGORY_SINGLE_SIG;
  } catch {
    return '';
  }
}

export interface WalletSection {
  /** Stable category key: 'single-sig' | 'multisig' | 'virtual' | custom
   *  label | '' (Other; My Portfolios on the Portfolio tab). */
  key: string;
  title: string;
  data: WalletMeta[];
}

function builtinTitle(base: string, count: number): string {
  return count === 1 ? base : `${base}s`;
}

/**
 * Group wallets into ordered sections. Default order: Single-sig,
 * Multisig, custom labels (alphabetical), then Virtual and Other. When the user has arranged
 * categories (`categoryOrder`), that order wins; unknown keys keep their
 * default position after the ordered ones. Empty sections are omitted.
 */
export function sectionsForWallets(
  wallets: WalletMeta[],
  categoryOrder?: string[],
): WalletSection[] {
  const single: WalletMeta[] = [];
  const multi: WalletMeta[] = [];
  const virtual: WalletMeta[] = [];
  const other: WalletMeta[] = [];
  const custom = new Map<string, WalletMeta[]>();

  for (const w of wallets) {
    const c = effectiveCategory(w);
    // Manual wallets always land here — see effectiveCategory (the
    // "stranded under Other" case showed up on the first device test).
    if (c === CATEGORY_VIRTUAL) {
      virtual.push(w);
      continue;
    }
    if (!c) other.push(w);
    else if (c === CATEGORY_SINGLE_SIG) single.push(w);
    else if (c === CATEGORY_MULTISIG) multi.push(w);
    else {
      const group = custom.get(c);
      if (group) group.push(w);
      else custom.set(c, [w]);
    }
  }

  const sections: WalletSection[] = [];
  if (single.length) sections.push({ key: CATEGORY_SINGLE_SIG, title: 'Single-sig', data: single });
  if (multi.length) sections.push({ key: CATEGORY_MULTISIG, title: 'Multisig', data: multi });
  for (const label of [...custom.keys()].sort((a, b) => a.localeCompare(b))) {
    sections.push({ key: label, title: label, data: custom.get(label)! });
  }
  if (virtual.length)
    sections.push({ key: CATEGORY_VIRTUAL, title: 'Virtual', data: virtual });
  if (other.length) sections.push({ key: '', title: 'Other', data: other });

  if (categoryOrder && categoryOrder.length > 0) {
    const rank = new Map(categoryOrder.map((k, i) => [k, i]));
    sections.sort((a, b) => {
      const ra = rank.has(a.key) ? rank.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.key) ? rank.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }
  return sections;
}

/** Title for a category key (used by the arrange sheet). */
export function categoryTitleFor(key: string, count: number): string {
  if (key === CATEGORY_SINGLE_SIG) return 'Single-sig';
  if (key === CATEGORY_MULTISIG) return 'Multisig';
  if (key === CATEGORY_SAVINGS) return builtinTitle('Savings Account', count);
  if (key === CATEGORY_SPENDING) return builtinTitle('Spending Account', count);
  if (key === CATEGORY_VIRTUAL) return 'Virtual';
  // Both spellings of Other: the section's key and the stored marker.
  return key === '' || key === CATEGORY_OTHER ? 'Other' : key;
}

/**
 * Every key a vault section is BUILT IN under ('' is Other). None of them is
 * ever a custom label: Arrange never shows one as a chip of its own, never
 * lets a section be named after one, never offers to rename one, and keeps
 * its section on screen when emptied. Virtual reaches the vault list only
 * through a legacy label; the retired stamps and the Other marker stay listed
 * so nobody types one back in as a label that effectiveCategory would then
 * ignore.
 *
 * The list lives HERE, beside the sections it describes. ArrangeModal once
 * kept its own copy, still naming Savings and Spending after the sections
 * became Single-sig and Multisig, and showed the single-sig key as a second,
 * lowercase chip beside "Single-sig", both selected (decided 2026-09-12).
 */
const BUILTIN_CATEGORIES: readonly string[] = [
  '',
  CATEGORY_SINGLE_SIG,
  CATEGORY_MULTISIG,
  CATEGORY_VIRTUAL,
  CATEGORY_OTHER,
  CATEGORY_SAVINGS,
  CATEGORY_SPENDING,
];

export function isBuiltinCategory(key: string): boolean {
  return BUILTIN_CATEGORIES.includes(key);
}

/** One chip on Arrange's "Show this vault under" row. */
export interface SectionChoice {
  key: string;
  title: string;
  selected: boolean;
}

/**
 * The sections offered every time first, then every other section on the
 * list in its order. ONE chip per key, titled by the same function as the
 * list's headers and selected by key, so the vault's own section is lit
 * exactly once and a built-in key never comes back as its raw text.
 */
function sectionChoices(
  alwaysOffered: readonly string[],
  sectionKeys: readonly string[],
  current: string,
  titleFor: (key: string) => string,
): SectionChoice[] {
  return [...new Set([...alwaysOffered, ...sectionKeys])].map((key) => ({
    key,
    title: titleFor(key),
    selected: key === current,
  }));
}

/**
 * The chips for a VAULT: Single-sig, Multisig and Other always (a vault
 * falls into a shape section by itself, decided 2026-09-09, so moving one back is
 * one tap), then the custom sections. `sectionKeys` are the Arrange list's
 * section keys, which are effective categories (sectionsForWallets), and
 * `current` is the key of the section the vault sits in on that list.
 */
export function vaultSectionChoices(
  sectionKeys: readonly string[],
  current: string,
): SectionChoice[] {
  return sectionChoices([CATEGORY_SINGLE_SIG, CATEGORY_MULTISIG, ''], sectionKeys, current, (key) =>
    categoryTitleFor(key, 1),
  );
}

// ── Portfolio tab sections (decided 2026-09-02: "the exact same arrange/delete and
// label category structure we have for vaults, also for portfolios") ─────────

/**
 * The section a PORTFOLIO (manual wallet) shows under on the Portfolio tab.
 * Portfolios reuse `WalletMeta.category` for their own labels, read through
 * THIS helper: the legacy value 'virtual' (stamped at creation until
 * 2026-09-03) and a missing value both mean '' = "Other". `effectiveCategory`
 * keeps answering 'virtual' for manual wallets so the HOME screen's sectioning
 * and hiding are untouched; the two helpers answer different questions.
 */
export function portfolioCategory(w: WalletMeta): string {
  const c = w.category?.trim() ?? '';
  // No CATEGORY_OTHER here: Arrange writes that marker for VAULTS only, and
  // "My Portfolios" stays an unset category, so nothing can store it on a
  // portfolio.
  return c === CATEGORY_VIRTUAL ? '' : c;
}

/** The section every portfolio starts in. Not "Other" (decided 2026-09-07): with
 *  no built-in sections beside it there is nothing for it to be other than. */
export const PORTFOLIO_DEFAULT_SECTION_TITLE = 'My Portfolios';

/** Title for a portfolio section key: labels verbatim, '' = My Portfolios.
 *  No account-type built-ins here, so a label spelled "savings" is just a label. */
export function portfolioSectionTitleFor(key: string): string {
  return key === '' ? PORTFOLIO_DEFAULT_SECTION_TITLE : key;
}

/** The keys a PORTFOLIO section is built in under: My Portfolios ('') and
 *  the legacy 'virtual', which portfolioCategory() reads as My Portfolios
 *  and which, typed as a label, would collide with the home screen's
 *  Virtual section. Arrange treats them as it treats isBuiltinCategory's. */
export function isBuiltinPortfolioCategory(key: string): boolean {
  return key === '' || key === CATEGORY_VIRTUAL;
}

/** The chips for a PORTFOLIO: My Portfolios always, then the labels on the
 *  list, by the same rules as vaultSectionChoices. */
export function portfolioSectionChoices(
  sectionKeys: readonly string[],
  current: string,
): SectionChoice[] {
  return sectionChoices([''], sectionKeys, current, portfolioSectionTitleFor);
}

/**
 * Group PORTFOLIOS into ordered sections for the Portfolio tab. Default
 * order: custom labels (alphabetical), then My Portfolios. No Savings/Spending here:
 * those are account TYPES for on-chain vaults, not portfolio labels. When the
 * user has arranged the sections (`portfolioCategoryOrder`, kept apart from
 * the vault `categoryOrder` so one label used on both tabs never shares an
 * order), that order wins; unknown keys keep their default position after the
 * ordered ones. Empty sections are omitted; on-chain wallets are ignored.
 */
export function portfolioSectionsFor(
  wallets: WalletMeta[],
  portfolioCategoryOrder?: string[],
): WalletSection[] {
  const other: WalletMeta[] = [];
  const custom = new Map<string, WalletMeta[]>();
  for (const w of wallets) {
    if (!w.manual) continue;
    const c = portfolioCategory(w);
    if (!c) {
      other.push(w);
      continue;
    }
    const group = custom.get(c);
    if (group) group.push(w);
    else custom.set(c, [w]);
  }

  const sections: WalletSection[] = [];
  for (const label of [...custom.keys()].sort((a, b) => a.localeCompare(b))) {
    sections.push({ key: label, title: portfolioSectionTitleFor(label), data: custom.get(label)! });
  }
  // "My Portfolios" whether or not custom sections exist (decided 2026-09-07);
  // it used to read "Portfolios" alone and "Other" beside custom sections.
  if (other.length) {
    sections.push({ key: '', title: portfolioSectionTitleFor(''), data: other });
  }

  if (portfolioCategoryOrder && portfolioCategoryOrder.length > 0) {
    const rank = new Map(portfolioCategoryOrder.map((k, i) => [k, i]));
    sections.sort((a, b) => {
      const ra = rank.has(a.key) ? rank.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.key) ? rank.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }
  return sections;
}

/**
 * The section key a SAVED hidden-list entry stands for. Settings writes
 * section keys, so Other is '', but builds before 2026-09-07 let a
 * vault's section be typed as "other" and hidden under that name. Since
 * `effectiveCategory` reads 'other' as Other itself, such an entry has to
 * hide Other too, or that vault and its balance would come back on the home
 * screen with no switch left in Settings to clear it (decided 2026-10-15).
 */
function hiddenEntryKey(entry: string): string {
  return entry === CATEGORY_OTHER ? '' : entry;
}

/** The section keys a saved hidden list hides. Always read it through this. */
export function hiddenSectionKeys(hiddenCategories: readonly string[]): Set<string> {
  return new Set(hiddenCategories.map(hiddenEntryKey));
}

/**
 * The hidden list after the Settings switch for section `key` is set. Other
 * is written as '' and an old 'other' entry goes with it on either answer, so
 * the old spelling never outlives the first toggle.
 */
export function withSectionHidden(
  hiddenCategories: readonly string[],
  key: string,
  hide: boolean,
): string[] {
  const k = hiddenEntryKey(key);
  const rest = hiddenCategories.filter((c) => hiddenEntryKey(c) !== k);
  return hide ? [...rest, k] : rest;
}

/** Wallets whose category isn't hidden from the home screen. */
export function visibleWallets(wallets: WalletMeta[], hiddenCategories: string[]): WalletMeta[] {
  if (hiddenCategories.length === 0) return wallets;
  const hidden = hiddenSectionKeys(hiddenCategories);
  return wallets.filter((w) => !hidden.has(effectiveCategory(w)));
}

/**
 * Total of the ON-CHAIN balances the user can currently see: excludes wallets
 * in hidden categories and wallets individually hidden.
 *
 * MANUAL wallets are excluded too (decided 2026-08-25). Their balance is typed in
 * by hand and cannot go stale-but-look-fresh the way a synced one can, so
 * folding it into this figure would make an unverifiable number read as a
 * verified one. `manualTotalSats` reports it separately.
 */
export function visibleTotalSats(wallets: WalletMeta[], hiddenCategories: string[]): number {
  return visibleWallets(wallets, hiddenCategories)
    .filter((w) => !w.balanceHidden && !w.locked && !w.manual)
    .reduce((sum, w) => sum + (w.cachedBalanceSats ?? 0), 0);
}

/** The same sum over MANUAL wallets only — shown apart from the real total. */
export function manualTotalSats(wallets: WalletMeta[], hiddenCategories: string[]): number {
  return visibleWallets(wallets, hiddenCategories)
    .filter((w) => w.manual && !w.balanceHidden)
    .reduce((sum, w) => sum + (w.cachedBalanceSats ?? 0), 0);
}

/** Every category label in use (for the Settings hide/show list). */
export function allCategories(wallets: WalletMeta[]): string[] {
  const set = new Set<string>();
  for (const w of wallets) set.add(effectiveCategory(w));
  return [...set];
}
