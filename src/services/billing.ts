/**
 * Subscriptions + checkout hand-off (spec confirmed with the backend team,
 * 2026-07-19 briefing).
 *
 * The WEBSITE configurator is the source of truth for plans and payment
 * (Stripe / BTCPay) — the app never implements a native plan picker or
 * touches card data. Flow:
 *   1. App opens the configurator in the browser.
 *   2. After payment the site deep-links back: tiam://checkout/complete
 *      (?quote_id=<uuid>).
 *   3. App polls GET /api/billing/subscriptions/my/ (live in prod today)
 *      every 2s for up to 30s until the webhook lands.
 * Gating rule (from the backend team): a feature is active when ANY
 * subscription has status "active" and end_at in the future.
 */
import { COMPANY_API, authHeaders } from './companyAuth';
import type { CompanySession } from './companyAuth';

export const CONFIGURATOR_URL = 'https://21stcapital.com/configurator';
export const SUBSCRIPTIONS_URL = `${COMPANY_API}/api/billing/subscriptions/my/`;
/** Portfolio-save creates the pricing quote (same endpoint the website uses). */
export const PORTFOLIO_SAVE_URL = `${COMPANY_API}/api/vaults/portfolio/save/`;
export const PLANS_URL = `${COMPANY_API}/api/billing/plans/`;
/** The website's checkout page renders the Stripe checkout for a quote. */
export const CHECKOUT_SITE = 'https://21stcapital.com';

export type VaultConfigType = 'single-1-1' | 'multi-2-2' | 'multi-2-3';

export interface VaultQuoteConfig {
  tier: 'premium' | 'elite' | 'starter' | string;
  tierName: string;
  /** EXACT backend PlanItem name for the annual subscription. Needed because
   *  one plan can hold several annual items at different prices (single-sig
   *  Premium is $195, multisig Premium $395) and the backend bills the
   *  ITEM's base_price, never the amount we send. */
  planItemName?: string;
  configType: VaultConfigType;
  userEmail: string;
  rescue: boolean;
  inheritance: boolean;
  heirCount: number;
  annual: number;
  onboarding: number;
  /** Vaults the plan includes (Premium 1, Elite 2, Elite Plus 3). Recorded on
   *  the portfolio as what was bought; the backend floors by tier as well. */
  vaultCount?: number;
  /** Whether 21st Capital co-signs (a rescue-only vault does not). */
  companyCosigner?: boolean;
  /** Months of each heir holding their OWN key, for the portfolio's vault
   *  row (the same shape the key claim reports). */
  heirTimelocks?: number[];
}

/** The plain sentences a failed checkout shows (decided 2026-10-01). The
 *  server prices every order and refuses one it cannot; the client reads
 *  one sentence, never a status code. */
export const PRICES_CHANGED_MESSAGE = 'Prices changed. Please reload.';
export const ONBOARDING_REQUIRED_MESSAGE =
  'Your first plan with us includes the one-time onboarding.';

/** The server refused to leave the onboarding out: it has no earlier plan of
 *  this client's on file (backend code ONBOARDING_REQUIRED). */
export class OnboardingRequiredError extends Error {
  constructor() {
    super(ONBOARDING_REQUIRED_MESSAGE);
    this.name = 'OnboardingRequiredError';
  }
}

/** The plan list could not be read, or no longer holds the price the client
 *  was shown: the server prices every line by its plan item and refuses a
 *  line without one, so nothing is sent. */
export class PricesChangedError extends Error {
  constructor() {
    super(PRICES_CHANGED_MESSAGE);
    this.name = 'PricesChangedError';
  }
}

/** The server's refusal codes that mean "what you were shown is not what we
 *  sell now" (apps.billing.pricing). */
const PRICES_CHANGED_CODES = new Set([
  'UNKNOWN_PLAN_ITEM',
  'UNKNOWN_ITEM',
  'NO_PLAN',
  'HARDWARE_MISMATCH',
  'UNKNOWN_DEVICE',
]);

/**
 * May the app leave the onboarding out of this client's order? The server's
 * own answer ("onboarded" on the entitlement probe) decides whenever it is
 * given. An older backend says nothing, and then only rows of the client's
 * OWN that really started count: a PENDING or FAILED checkout is no history,
 * and neither is a plan somebody else pays for (the old rule, "any row at
 * all", left the onboarding out for both and the checkout refused them).
 */
export function isOnboardedClient(
  serverOnboarded: boolean | null | undefined,
  subs: Subscription[],
  lifetimeElite = false,
): boolean {
  if (typeof serverOnboarded === 'boolean') return serverOnboarded;
  if (lifetimeElite) return true;
  return subs.some((s) => {
    if (s.held) return false;
    const status = s.status.toLowerCase();
    return status !== 'pending' && status !== 'failed';
  });
}

export interface VaultQuoteResult {
  quoteId: string;
  /** Backend Portfolio id — the handle for the vault-testing status. */
  portfolioId?: string;
}

/**
 * Create a per-user PricingQuote for this vault plan (subscription +
 * onboarding), mirroring the website's POST /vaults/portfolio/save/. Returns
 * the quote id — open CHECKOUT_SITE/checkout/<id> for the Stripe page — plus
 * the portfolio id for the testing-status banner.
 */
export async function createVaultQuote(
  session: CompanySession,
  cfg: VaultQuoteConfig,
): Promise<VaultQuoteResult> {
  const isMulti = cfg.configType.startsWith('multi');

  // Resolve the REAL PlanItem ids so the quote items are typed correctly on
  // the backend (ANNUAL_SUBSCRIPTION + ONBOARDING) — without them every item
  // falls back to ONE_TIME and Stripe's subscription checkout fails with
  // "contact the merchant" (decided 2026-07-21). Mirrors the website resolver.
  let subItem: { id?: string; name: string; amount: number } = {
    name: `${cfg.tierName} annual subscription`,
    amount: cfg.annual,
  };
  let onboardingItem: { id?: string; name: string; amount: number } = {
    name: 'Onboarding (1-on-1)',
    amount: cfg.onboarding,
  };
  try {
    const res = await fetch(PLANS_URL, { headers: authHeaders(session) });
    if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
    if (res.ok) {
      const plans = (await res.json()) as Array<{
        name?: string;
        items?: Array<{ id?: string; name?: string; type?: string; base_price?: string }>;
      }>;
      const plan = plans.find((p) => p.name === cfg.tierName);
      const everyItem = plans.flatMap((p) => p.items ?? []);
      // Exact name first — a plan can hold several ANNUAL_SUBSCRIPTION items
      // at different prices, and picking "the first one" silently billed a
      // single-sig client the multisig rate (found 2026-07-27).
      const annual =
        (cfg.planItemName ? everyItem.find((i) => i.name === cfg.planItemName) : undefined) ??
        plan?.items?.find((i) => i.type === 'ANNUAL_SUBSCRIPTION');
      const onboarding = plan?.items?.find((i) => i.type === 'ONBOARDING');
      if (annual?.id) {
        const itemPrice = annual.base_price != null ? parseFloat(annual.base_price) : cfg.annual;
        // NEVER bill a price the user didn't see. The backend bills the
        // item's base_price, so when it disagrees with what the client was
        // shown the line keeps no id and nothing is sent (below).
        if (Math.abs(itemPrice - cfg.annual) < 0.01) {
          subItem = { id: annual.id, name: annual.name ?? subItem.name, amount: itemPrice };
        }
      }
      // Same rule as the annual line: NEVER bill a price the user didn't
      // see. The backend overrides our amount with the item's base_price, so
      // attaching the id when they disagree would re-bill $495 to a
      // returning client the app just told "no onboarding fee"
      // (decided 2026-07-27: onboarding is once per CLIENT).
      if (onboarding?.id && cfg.onboarding > 0) {
        const itemPrice =
          onboarding.base_price != null ? parseFloat(onboarding.base_price) : cfg.onboarding;
        if (Math.abs(itemPrice - cfg.onboarding) < 0.01) {
          onboardingItem = {
            id: onboarding.id,
            name: onboarding.name ?? onboardingItem.name,
            amount: itemPrice,
          };
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Your session has expired')) throw e;
    // The plan list could not be read: the lines keep no id (below).
  }
  // A line without its plan item is refused by the server since it prices
  // every order itself (decided 2026-09-30): the old label-and-amount fallback
  // cannot be paid any more. The client was shown a price we could not
  // confirm, so they are asked to reload instead.
  if (!subItem.id || (cfg.onboarding > 0 && !onboardingItem.id)) {
    throw new PricesChangedError();
  }

  const payload = {
    portfolio: {
      total_vault_count: Math.max(1, cfg.vaultCount ?? 1),
      effective_tier: cfg.tier,
      user_email: cfg.userEmail,
    },
    vaults: [
      {
        vault_index: 0,
        config_type: cfg.configType,
        company_cosigner: cfg.companyCosigner ?? true,
        calculated_tier: cfg.tier,
        key_configuration: { option: 'use-existing', hardware_wallets: [] },
        security_features: {
          multi_sig: isMulti,
          rescue_key: cfg.rescue ? 'yes' : 'no',
          inheritance_planning: cfg.inheritance,
          active_features: [],
        },
        inheritance: {
          enabled: cfg.inheritance,
          heir_count: cfg.heirCount,
          // Own-key heirs with their timelocks, so the row the checkout
          // creates already describes the vault (the claim overwrites it
          // with the final build anyway).
          heirs: (cfg.heirTimelocks ?? []).map((months, index) => ({
            index,
            access_method: 'use-existing',
            timelock_duration: months,
          })),
        },
        rescue_key: cfg.rescue ? 'yes' : 'no',
      },
    ],
    pricing_summary: {
      // A zero onboarding fee means the line does not exist at all — an
      // item with amount 0 would still let the backend price it from the
      // PlanItem (decided 2026-07-27).
      setup_fee_total: cfg.onboarding > 0 ? onboardingItem.amount : 0,
      annual_subscription_total: subItem.amount,
      hardware_total: 0,
      currency: 'USD',
      // Bill the subscription NOW — the app activates the vault on payment, it
      // does not use the website's deferred, onboarding-gated billing. The
      // backend only bills subscriptions immediately when this flag is set.
      immediate_billing: true,
      items:
        cfg.onboarding > 0
          ? [
              { id: subItem.id, label: subItem.name, amount: subItem.amount },
              { id: onboardingItem.id, label: onboardingItem.name, amount: onboardingItem.amount },
            ]
          : [{ id: subItem.id, label: subItem.name, amount: subItem.amount }],
    },
  };
  const res = await fetch(PORTFOLIO_SAVE_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code = checkoutRefusalCode(text);
    if (code === 'ONBOARDING_REQUIRED') throw new OnboardingRequiredError();
    if (code && PRICES_CHANGED_CODES.has(code)) throw new PricesChangedError();
    throw new Error(`Could not start checkout (${res.status}). ${text.slice(0, 120)}`);
  }
  const body = (await res.json()) as {
    quote_id?: string;
    portfolio_id?: string;
    json?: { quote_id?: string; portfolio_id?: string };
  };
  const quoteId = body.quote_id ?? body.json?.quote_id;
  if (!quoteId) throw new Error('Checkout could not be prepared (no quote returned).');
  return { quoteId, portfolioId: body.portfolio_id ?? body.json?.portfolio_id };
}

/** The refusal code in a portfolio-save error body ({"error": CODE, ...}),
 *  or null. Pure, exported for tests. */
export function checkoutRefusalCode(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** The website checkout page for a quote (opens Stripe for that user). */
export function checkoutUrlForQuote(quoteId: string): string {
  return `${CHECKOUT_SITE}/checkout/${quoteId}`;
}

export const WEB_HANDOFF_URL = `${COMPANY_API}/api/auth/web-handoff/`;

/**
 * Checkout URL that LOGS THE BROWSER IN first. The phone's browser has its
 * own (usually expired) website session — the price page still renders, but
 * Stripe's session creation then 401s behind the generic "contact the
 * merchant" screen (decided 2026-07-21). So we mint a one-time login token and
 * route through the website's verify-link page, which signs the browser in
 * fresh and forwards to the checkout. Falls back to the plain URL.
 */
export async function checkoutUrlWithLogin(
  session: CompanySession,
  quoteId: string,
): Promise<string> {
  try {
    const res = await fetch(WEB_HANDOFF_URL, {
      method: 'POST',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect: `/checkout/${quoteId}` }),
    });
    if (res.ok) {
      const body = (await res.json()) as { handoff_url?: string };
      if (body.handoff_url) return body.handoff_url;
    }
  } catch {
    // fall through to the plain URL
  }
  return checkoutUrlForQuote(quoteId);
}

export const VAULT_TESTING_STATUS_URL = `${COMPANY_API}/api/vaults/testing-status/`;

export interface VaultTestingStatus {
  /** ISO timestamp once a staff member marked the vault tested; null before. */
  testedAt: string | null;
  /**
   * The server had THIS vault's row to answer from. A null testedAt with
   * known=false means "no row", not "not tested": only a known answer may
   * clear a cached tested state (decided 2026-09-07, staff can set a vault back).
   */
  known: boolean;
}

/**
 * Has a staff member marked this vault tested (after the setup meeting)?
 * Drives Verify external keys and the Receive warning; the vault page has
 * no booking banner any more (decided 2026-09-21). Without a portfolioId the
 * backend uses the user's latest portfolio.
 *
 * `account` is the account number on our own key in the vault, given when
 * the vault was IMPORTED and its number was read off that key rather than
 * remembered from building it (decided 2026-09-28). The answer then counts only
 * when the server's row holds that same account: the client's own vault 2
 * is not the vault 2 of somebody else's plan.
 */
export async function fetchVaultTesting(
  session: CompanySession,
  portfolioId?: string,
  vaultNumber?: number,
  account?: number,
): Promise<VaultTestingStatus> {
  // Since 2026-09-03 one paid portfolio holds EVERY vault the client builds
  // with our keys, so "is the portfolio tested" is no longer this vault's
  // answer: the vault is named by its number and the backend answers for
  // that row alone.
  const params = new URLSearchParams();
  if (portfolioId) params.set('portfolio_id', portfolioId);
  if (vaultNumber != null) params.set('vault_number', String(vaultNumber));
  // Sent for a server that can look the row up by account directly; one
  // that cannot ignores it, and the check below holds either way.
  if (account != null) params.set('account', String(account));
  const qs = params.toString();
  const url = qs ? `${VAULT_TESTING_STATUS_URL}?${qs}` : VAULT_TESTING_STATUS_URL;
  const res = await fetch(url, { headers: authHeaders(session) });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not check vault testing status (${res.status}).`);
  const body = (await res.json()) as {
    vaults?: Array<{ vault_index?: number; tested_at?: string | null }>;
    vault?: { vault_number?: number; account?: number | null; tested_at?: string | null } | null;
  };
  const vaults = Array.isArray(body.vaults) ? body.vaults : [];
  let testedAt: string | null;
  let known: boolean;
  if (account != null && (body.vault == null || body.vault.account !== account)) {
    // No row holds this account (or an older server, whose portfolio-wide
    // answer belongs to whichever purchase is latest): not a verdict.
    return { testedAt: null, known: false };
  }
  if (vaultNumber != null && body.vault !== undefined) {
    // This vault's own row (null = no row yet, or not tested).
    testedAt = body.vault?.tested_at ?? null;
    known = body.vault != null;
  } else {
    // Older server, or no vault number known: the portfolio-wide answer,
    // right only while a portfolio holds one vault.
    const allTested = vaults.length > 0 && vaults.every((v) => !!v.tested_at);
    testedAt = allTested ? (vaults[0]?.tested_at ?? null) : null;
    known = vaults.length > 0;
  }
  return {
    testedAt,
    known,
  };
}
export const MY_EXISTING_VAULTS_URL = `${COMPANY_API}/api/vaults/my-existing-vaults/`;

/**
 * The client's 21st Capital ACCOUNT NUMBER for each vault (decided 2026-08-28:
 * "every vault with our keys involved has an account number with us").
 *
 * It is a real, permanent, human-facing number — the one staff quote in
 * support and the one already printed on the client's estate plan ("Account
 * 1041 ONLY"). It comes from the client's allocated block (block_start, e.g.
 * 1000) plus the vault's number, so vault 1 is 1001. The portfolio UUID is
 * NOT this: it is a primary key, it changes whenever a client rebuilds, and
 * no client ever sees one.
 *
 * The backend only lists vaults it has marked tested, and a client with no
 * allocated block has no number at all — a purely self-custodial vault never
 * gets one. Absent is a normal answer here, not a failure.
 */
export interface VaultAccountEntry {
  portfolioId: string;
  vaultNumber?: number;
  /** e.g. 1041. Absent when the backend has not allocated one. */
  account?: number;
}

export async function fetchVaultAccounts(
  session: CompanySession,
): Promise<VaultAccountEntry[]> {
  const res = await fetch(MY_EXISTING_VAULTS_URL, { headers: authHeaders(session) });
  if (!res.ok) throw new Error(`Could not read vault accounts (${res.status}).`);
  const body = (await res.json()) as {
    vaults?: Array<{ portfolio_id?: string; vault_number?: number; account?: number | null }>;
  };
  return (Array.isArray(body.vaults) ? body.vaults : [])
    .filter((v) => !!v.portfolio_id)
    .map((v) => ({
      portfolioId: String(v.portfolio_id),
      vaultNumber: v.vault_number,
      account: v.account ?? undefined,
    }));
}

export const PORTFOLIO_MY_URL = `${COMPANY_API}/api/vaults/portfolio/my/`;

/** The client's LATEST checkout configuration — the backend's record of what
 *  was actually configured and paid (decided 2026-07-26: the portfolio, not a
 *  hardcoded tier constant, is the vault entitlement). */
export interface PortfolioSummary {
  id: string;
  status: 'DRAFT' | 'COMPLETED' | 'PAID' | 'ONBOARDING_PAID' | string;
  totalVaultCount: number;
  effectiveTier: string | null;
}

export async function fetchMyPortfolio(
  session: CompanySession,
): Promise<PortfolioSummary | null> {
  const res = await fetch(PORTFOLIO_MY_URL, { headers: authHeaders(session) });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not check your portfolio (${res.status}).`);
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.id) return null; // {"message": "No portfolios found"}
  return {
    id: String(body.id),
    status: String(body.status ?? ''),
    totalVaultCount: Number(body.total_vault_count ?? 0) || 0,
    effectiveTier: (body.effective_tier as string) ?? null,
  };
}

/**
 * Vaults the client is entitled to run with 21st Capital keys. The PAID
 * portfolio's configured vault count is the primary source (it records the
 * actual purchase); the tier constant is the floor for clients whose
 * portfolio predates per-vault configuration. Never less generous than
 * either — an over-count blocks a paying customer, an under-count doesn't.
 */
export function entitledVaultCount(
  subs: Subscription[],
  portfolio: PortfolioSummary | null,
  now: Date = new Date(),
  lifetimeElite = false,
): number {
  // A Lifetime Elite member holds no subscription row and often no
  // portfolio, yet may open the whole block (decided 2026-09-04).
  if (lifetimeElite) return LIFETIME_ELITE_VAULTS;
  const paid =
    portfolio && (portfolio.status === 'PAID' || portfolio.status === 'ONBOARDING_PAID');
  const fromPortfolio = paid ? portfolio.totalVaultCount : 0;
  return Math.max(fromPortfolio, maxVaultsForPlan(subs, now));
}

/** THE RULE (decided 2026-09-04): Premium 1, Elite 2, Elite Plus 3, Lifetime
 *  Elite 10, the whole account block and the hard maximum per client. The
 *  backend's PLAN_VAULT_FLOOR / LIFETIME_ELITE_VAULTS say the same. */
export const LIFETIME_ELITE_VAULTS = 10;

/** Deep link the website fires after a successful checkout. */
export const CHECKOUT_COMPLETE_PATH = 'checkout/complete';

export interface Subscription {
  id: string;
  planName?: string;
  tier?: string;
  status: 'pending' | 'active' | 'cancelled' | 'expired' | string;
  amount?: number;
  currency?: string;
  startAt?: string;
  endAt?: string;
  nextRenewalAt?: string;
  autoRenew?: boolean;
  provider?: string;
  /** A staff-assigned Lifetime Elite membership: no billing row behind it,
   *  so there is no price, renewal or cancellation to show (2026-09-12). */
  lifetime?: boolean;
  /** The plan that PAYS for a vault of this client's (decided 2026-09-20: the
   *  vault is theirs, only the billing is somebody else's): every feature of
   *  that plan, but never its vault count, and nothing to renew or cancel.
   *  `heldOf` is the payer's email, `payerName` their name when known. The
   *  flag keeps the API's word; no client reads it. */
  held?: boolean;
  heldOf?: string;
  payerName?: string;
  /** Which vault of the payer's plan it pays for (metadata.vault_number):
   *  two vaults of one plan are two rows that otherwise read the same. */
  vaultNumber?: number;
}

/** What the app calls a Lifetime Elite membership, whatever the server sends.
 *  The server's title put an em dash between "Elite" and "Lifetime", and
 *  Apple photographed it on the Subscriptions screen (2026-09-11). The name
 *  still contains "elite" and not "plus", so every name-based gate
 *  (tierVaultLimit, the Estate Plan's Elite fields) reads it the same. */
export const LIFETIME_PLAN_NAME = 'Lifetime Elite';

/** Pure parser — exported for tests. Tolerates unknown extra fields. */
export function parseSubscriptions(body: unknown): Subscription[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { results?: unknown[] })?.results)
      ? (body as { results: unknown[] }).results
      : [];
  return list.flatMap((raw): Subscription[] => {
    const o = raw as Record<string, unknown>;
    if (typeof o?.id !== 'string' || typeof o?.status !== 'string') return [];
    // The backend's SubscriptionAdminSerializer sends `plan_item` as a bare
    // id and the NAME in a separate flat field `plan_item_name` — reading
    // `.name` off the id left planName permanently undefined, so a client
    // whose `tier` is null (every Stripe subscription — only BTCPay and the
    // historical importer write it) looked like they had NO plan at all
    // (found 2026-07-27). Read the flat field, keep the nested one as a
    // fallback in case the endpoint ever gains depth.
    const plan = o.plan_item as Record<string, unknown> | string | undefined;
    const nestedName =
      plan && typeof plan === 'object' && typeof plan.name === 'string' ? plan.name : undefined;
    const rawName =
      typeof o.plan_item_name === 'string' && o.plan_item_name ? o.plan_item_name : nestedName;
    // The server's synthetic lifetime row carries the id "lifetime-elite" and
    // metadata.lifetime_elite; either marks it.
    const meta = o.metadata as
      | { lifetime_elite?: unknown; held_of?: unknown; payer_name?: unknown; vault_number?: unknown }
      | null
      | undefined;
    const lifetime = o.id === 'lifetime-elite' || meta?.lifetime_elite === true;
    // The server's synthetic row for a plan behind a HELD vault carries an
    // id "held-…" and metadata.held_of (decided 2026-09-19).
    const heldOf = typeof meta?.held_of === 'string' && meta.held_of ? meta.held_of : undefined;
    const held = o.id.startsWith('held-') || heldOf != null;
    const payerName =
      typeof meta?.payer_name === 'string' && meta.payer_name.trim() ? meta.payer_name.trim() : undefined;
    const planName = lifetime ? LIFETIME_PLAN_NAME : rawName;
    return [
      {
        id: o.id,
        planName,
        tier: typeof o.tier === 'string' ? o.tier : undefined,
        status: o.status,
        // DRF serialises DecimalField as a STRING ("995.00").
        amount:
          typeof o.amount === 'number'
            ? o.amount
            : typeof o.amount === 'string' && o.amount.trim() !== '' && !isNaN(Number(o.amount))
              ? Number(o.amount)
              : undefined,
        currency: typeof o.currency === 'string' ? o.currency : undefined,
        startAt: typeof o.start_at === 'string' ? o.start_at : undefined,
        endAt: typeof o.end_at === 'string' ? o.end_at : undefined,
        nextRenewalAt: typeof o.next_renewal_at === 'string' ? o.next_renewal_at : undefined,
        autoRenew: typeof o.auto_renew === 'boolean' ? o.auto_renew : undefined,
        provider: typeof o.provider === 'string' ? o.provider : undefined,
        ...(lifetime ? { lifetime: true } : {}),
        ...(held ? { held: true, ...(heldOf ? { heldOf } : {}), ...(payerName ? { payerName } : {}) } : {}),
        ...(typeof meta?.vault_number === 'number' && Number.isFinite(meta.vault_number)
          ? { vaultNumber: meta.vault_number }
          : {}),
      },
    ];
  });
}

/** The backend's gating rule: active status + end date in the future.
 *  Case-insensitive: the backend enum serializes as "ACTIVE" (uppercase). */
export function hasActiveSubscription(subs: Subscription[], now: Date = new Date()): boolean {
  return subs.some(
    (s) =>
      s.status.toLowerCase() === 'active' &&
      (!s.endAt || new Date(s.endAt).getTime() > now.getTime()),
  );
}

/**
 * The membership list the app shows (2026-09-12). The server adds its
 * synthetic lifetime row only when a member has NO other rows, so a Lifetime
 * Elite member with an old expired plan saw only that plan. With the
 * profile's flag on and no lifetime row in the list, the lifetime line goes
 * first; otherwise the list comes back unchanged.
 */
export function withLifetimeMembership(
  subs: Subscription[],
  lifetimeElite: boolean,
): Subscription[] {
  if (!lifetimeElite || subs.some((s) => s.lifetime)) return subs;
  return [
    { id: 'lifetime-elite', planName: LIFETIME_PLAN_NAME, tier: 'elite', status: 'ACTIVE', lifetime: true },
    ...subs,
  ];
}

export type MembershipState =
  | { kind: 'active' }
  | { kind: 'ended'; at: string }
  | { kind: 'inactive' };

/**
 * One membership row as a read-only status, for the builds that sell nothing
 * (2026-09-12). The rule is hasActiveSubscription's, so this screen agrees
 * with every other gate in the app: a cancelled plan is not active even before
 * its end date, because the server marks it CANCELED at once.
 */
export function membershipState(sub: Subscription, now: Date = new Date()): MembershipState {
  if (sub.lifetime || hasActiveSubscription([sub], now)) return { kind: 'active' };
  if (sub.endAt && new Date(sub.endAt).getTime() <= now.getTime()) {
    return { kind: 'ended', at: sub.endAt };
  }
  return { kind: 'inactive' };
}

/**
 * The Membership line of a plan somebody else pays for: "Elite Plus Annual,
 * paid for by Toni" (decided 2026-09-20). The backend sends it in those words; an
 * older backend still says "(plan of toni@example.com)", which no client may
 * read, so that ending is rewritten here from the row's own payer.
 */
export function heldPlanLabel(sub: Subscription): string | undefined {
  const name = sub.planName;
  if (!sub.held || !name) return name;
  const old = /\s*\(plan of [^)]*\)\s*$/i;
  if (!old.test(name)) return name;
  const who = sub.payerName || sub.heldOf;
  const base = name.replace(old, '');
  return who ? `${base}, paid for by ${who}` : base;
}

/**
 * The Membership card (decided 2026-09-21: "make them match our vault containers
 * ... make sure the icon represents the plan ... and the deadlines of the
 * membership written as well, if not conflicting with Apple's comments").
 * One card per row, drawn like a vault card: a tile, the plan's name, a line
 * under it, and on the right the status over the date.
 */

/** The plan's own name, without "paid for by Toni" (that goes underneath). */
export function planTitle(sub: Subscription, fallback: string): string {
  const name = heldPlanLabel(sub) ?? '';
  const base = sub.held ? name.replace(/\s*,\s*(paid for by|bezahlt von)\s+.*$/i, '') : name;
  return base.trim() || fallback;
}

/** The line under the name: which vault, and who pays, for a plan somebody
 *  else pays for; else what kind of membership it is. Never a price. */
export function planSubtitle(sub: Subscription): string {
  if (sub.held) {
    const who = sub.payerName || sub.heldOf;
    const parts = [
      sub.vaultNumber != null ? `Vault ${sub.vaultNumber}` : null,
      who ? `Paid for by ${who}` : null,
    ].filter((x): x is string => !!x);
    return parts.join(' · ');
  }
  if (sub.lifetime) return 'Lifetime membership';
  return 'Your plan';
}

/** The tile icon of a plan, by its tier: Premium a star, Elite (lifetime
 *  included) a crown, Elite Plus a diamond; anything unknown a shield. */
export function planIcon(sub: Pick<Subscription, 'tier' | 'planName' | 'lifetime'>): 'star' | 'crown' | 'diamond' | 'shield' {
  const limit = sub.lifetime ? Math.max(2, tierVaultLimit(sub.tier, sub.planName)) : tierVaultLimit(sub.tier, sub.planName);
  if (limit >= 3) return 'diamond';
  if (limit === 2) return 'crown';
  if (limit === 1) return 'star';
  return 'shield';
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The date under the status. "Until 12 Oct 2027" says when a plan runs to
 * and is plain information, so it shows in every build. "Renews" speaks of
 * billing, which Apple photographed in the builds that sell nothing (letter
 * of 2026-09-11), so it appears only where purchases are on, and only on
 * the client's own card-renewed plan. A lifetime membership has no end.
 */
export function planDeadline(
  sub: Subscription,
  opts: { purchases: boolean; now?: Date } = { purchases: false },
): string {
  if (sub.lifetime) return 'No end date';
  const state = membershipState(sub, opts.now);
  if (state.kind === 'ended') return `Ended ${shortDate(state.at)}`;
  if (state.kind !== 'active' || !sub.endAt || Number.isNaN(Date.parse(sub.endAt))) return '';
  const renews = opts.purchases && !sub.held && sub.autoRenew === true;
  return `${renews ? 'Renews' : 'Until'} ${shortDate(sub.endAt)}`;
}

/** A plan somebody else pays for has two states for its owner: it runs, or
 *  it has ended. There is no price, renewal or cancellation to show in ANY
 *  build: the billing is the payer's alone. */
export function heldPlanStatus(sub: Subscription, now: Date = new Date()): 'Active' | 'Ended' {
  return hasActiveSubscription([sub], now) ? 'Active' : 'Ended';
}

/**
 * Has the plan that pays for THIS vault ended? Asked for a vault somebody
 * else's plan pays for (`payerEmail` = the wallet's `heldOf`). The payer's
 * row decides when the backend sends one (it keeps sending it after the plan
 * ended, with its real status); an older backend drops the row instead, and
 * then any live plan on the account stands in, as it did before.
 */
export function payerPlanEnded(
  subs: Subscription[],
  payerEmail: string,
  now: Date = new Date(),
): boolean {
  const who = payerEmail.trim().toLowerCase();
  const theirs = subs.filter((s) => s.held && (s.heldOf ?? '').trim().toLowerCase() === who);
  if (theirs.length > 0) return !hasActiveSubscription(theirs, now);
  return !hasActiveSubscription(subs, now);
}

/**
 * Vaults a multisig plan includes (decided 2026-07-23): Premium 1, Elite 2, Elite
 * Plus 3. The APP enforces this on 21C-vault creation (the website billing is
 * left untouched). Starter / non-multisig / no active plan → 0.
 */
export function tierVaultLimit(tier?: string, planName?: string): number {
  // Take the MAX of both signals rather than short-circuiting on `tier`:
  // `tier` is stale or null on most rows, and after staff re-tier a client
  // (Elite → Elite Plus) the PLAN ITEM is what changes. A stale tier must
  // never cap a newer plan (decided 2026-07-27: a manual upgrade has to raise
  // the app's vault limit immediately).
  const fromTier = (() => {
    const t = (tier ?? '').toLowerCase().replace(/[\s_]+/g, '-');
    if (t === 'elite-plus') return 3;
    if (t === 'elite') return 2;
    if (t === 'premium') return 1;
    return 0;
  })();
  const fromName = (() => {
    const n = (planName ?? '').toLowerCase();
    if (n.includes('elite') && n.includes('plus')) return 3;
    if (n.includes('elite')) return 2;
    if (n.includes('premium')) return 1;
    return 0;
  })();
  return Math.max(fromTier, fromName);
}

export type PlanTier = 'premium' | 'elite' | 'elite-plus';

/** The client's highest ACTIVE multisig tier, or null (Starter / none). */
export function activePlanTier(
  subs: Subscription[],
  now: Date = new Date(),
  lifetimeElite = false,
): PlanTier | null {
  // The TIER counts every active row, a held plan included (decided 2026-09-19:
  // the invitation grants all the benefits); the vault COUNT below does not.
  let limit = 0;
  for (const s of subs) {
    if (isActiveRow(s, now)) limit = Math.max(limit, tierVaultLimit(s.tier, s.planName));
  }
  const fromSubs: PlanTier | null =
    limit >= 3 ? 'elite-plus' : limit === 2 ? 'elite' : limit === 1 ? 'premium' : null;
  // Lifetime Elite is "everything an Elite subscriber gets" (decided 2026-08-07)
  // with no subscription row: at least Elite, never demoted below a higher
  // paid tier on the same account.
  if (lifetimeElite && fromSubs !== 'elite-plus') return 'elite';
  return fromSubs;
}

/** The most vaults the client's ACTIVE plan allows (max across active subs). */
export function maxVaultsForPlan(subs: Subscription[], now: Date = new Date()): number {
  let max = 0;
  for (const s of subs) {
    // A held plan brings its features, never its vault count (decided
    // 2026-09-19: a plan paid by someone else gives its features, never its
    // vault count).
    if (s.held) continue;
    if (isActiveRow(s, now)) max = Math.max(max, tierVaultLimit(s.tier, s.planName));
  }
  return max;
}

function isActiveRow(s: Subscription, now: Date): boolean {
  return (
    s.status.toLowerCase() === 'active' &&
    (!s.endAt || new Date(s.endAt).getTime() > now.getTime())
  );
}

export async function fetchSubscriptions(session: CompanySession): Promise<Subscription[]> {
  const res = await fetch(SUBSCRIPTIONS_URL, { headers: authHeaders(session) });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not check your plan (${res.status}).`);
  return parseSubscriptions(await res.json());
}

/**
 * After the checkout deep link fires, the Stripe webhook may still be in
 * flight — poll (2s cadence, 30s budget per the backend brief) until an
 * active subscription appears.
 */
export async function pollSubscriptionActive(
  session: CompanySession,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<boolean> {
  const interval = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + (opts?.timeoutMs ?? 30_000);
  for (;;) {
    try {
      if (hasActiveSubscription(await fetchSubscriptions(session))) return true;
    } catch {
      // transient — keep polling until the deadline
    }
    if (Date.now() + interval > deadline) return false;
    await new Promise<void>((r) => setTimeout(() => r(), interval));
  }
}
