// companyAuth touches the iOS Keychain natively — irrelevant to these pure
// parser tests, and the package ships untranspiled ESM that Jest can't load.
jest.mock('react-native-keychain', () => ({}));

import {
  parseSubscriptions,
  hasActiveSubscription,
  maxVaultsForPlan,
  activePlanTier,
  createVaultQuote,
  entitledVaultCount,
  LIFETIME_ELITE_VAULTS,
  LIFETIME_PLAN_NAME,
  heldPlanLabel,
  heldPlanStatus,
  isOnboardedClient,
  membershipState,
  OnboardingRequiredError,
  ONBOARDING_REQUIRED_MESSAGE,
  PricesChangedError,
  PRICES_CHANGED_MESSAGE,
  payerPlanEnded,
  tierVaultLimit,
  withLifetimeMembership,
} from '../billing';
import type { MembershipState, Subscription } from '../billing';
import { keyProofReportBody, parseIssuedVaultKeys, parseKeyEntitlement } from '../companyAuth';

describe('parseSubscriptions', () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    id: 'a-uuid',
    plan_item: { name: 'Elite', tier: 'elite', price: 995 },
    tier: 'elite',
    status: 'active',
    amount: 995,
    currency: 'USD',
    start_at: '2026-01-01T00:00:00Z',
    end_at: '2027-01-01T00:00:00Z',
    next_renewal_at: '2027-01-01T00:00:00Z',
    auto_renew: true,
    provider: 'stripe',
    ...over,
  });

  it('parses the documented shape (bare list or {results})', () => {
    for (const body of [[sub()], { results: [sub()] }]) {
      const [s] = parseSubscriptions(body);
      expect(s.planName).toBe('Elite');
      expect(s.tier).toBe('elite');
      expect(s.status).toBe('active');
      expect(s.endAt).toBe('2027-01-01T00:00:00Z');
      expect(s.provider).toBe('stripe');
    }
  });

  it('drops malformed entries instead of crashing', () => {
    expect(parseSubscriptions([{ nope: true }, sub()])).toHaveLength(1);
    expect(parseSubscriptions('garbage')).toEqual([]);
  });
});

describe('hasActiveSubscription (backend gating rule)', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  it('requires active status AND a future end date', () => {
    expect(
      hasActiveSubscription([{ id: 'x', status: 'active', endAt: '2027-01-01T00:00:00Z' }], now),
    ).toBe(true);
    expect(
      hasActiveSubscription([{ id: 'x', status: 'active', endAt: '2026-01-01T00:00:00Z' }], now),
    ).toBe(false);
    expect(
      hasActiveSubscription([{ id: 'x', status: 'pending', endAt: '2027-01-01T00:00:00Z' }], now),
    ).toBe(false);
    expect(hasActiveSubscription([], now)).toBe(false);
  });
  it("accepts the backend's real uppercase status (enum serializes as ACTIVE)", () => {
    // The Django SubscriptionStatus enum is "ACTIVE" and the serializer sends
    // it raw — the gate must be case-insensitive or the vault never unlocks.
    expect(
      hasActiveSubscription([{ id: 'x', status: 'ACTIVE', endAt: '2027-01-01T00:00:00Z' }], now),
    ).toBe(true);
    expect(
      hasActiveSubscription([{ id: 'x', status: 'EXPIRED', endAt: '2027-01-01T00:00:00Z' }], now),
    ).toBe(false);
  });
});

describe('parseIssuedVaultKeys', () => {
  it('parses both keys, lowercases fingerprints', () => {
    const keys = parseIssuedVaultKeys({
      network: 'testnet4',
      co_signer: { fingerprint: 'A1B2C3D4', origin_path: "48'/1'/0'/2'", xpub: 'tpubCOSIGN' },
      rescue: { fingerprint: 'e5f60708', origin_path: "48'/1'/0'/2'", xpub: 'tpubRESCUE' },
    });
    expect(keys.coSigner).toEqual({
      fingerprint: 'a1b2c3d4',
      originPath: "48'/1'/0'/2'",
      xpub: 'tpubCOSIGN',
      proof: null,
    });
    expect(keys.rescue?.xpub).toBe('tpubRESCUE');
  });

  it('keeps each key\'s device proof RAW, for keyAttestation.ts alone to judge (decided 2026-09-26)', () => {
    const proof = { format: '21c-key-proof-v1', manifest: 'm', signature: 's', index: 0, path: [] };
    const keys = parseIssuedVaultKeys({
      co_signer: { fingerprint: 'a1b2c3d4', origin_path: "48'/0'/1001'/2'", xpub: 'xpubX', proof },
      rescue: { fingerprint: 'e5f60708', origin_path: "48'/0'/1001'/2'", xpub: 'xpubY', proof: 'not an object' },
    });
    expect(keys.coSigner?.proof).toEqual(proof);
    // malformed stays malformed: it must read as INVALID, never as missing
    expect(keys.rescue?.proof).toBe('not an object');
  });

  it('handles the one-key-assigned shape (rescue: null)', () => {
    const keys = parseIssuedVaultKeys({
      co_signer: { fingerprint: 'a1b2c3d4', origin_path: "48'/0'/0'/2'", xpub: 'xpubX' },
      rescue: null,
    });
    expect(keys.coSigner?.xpub).toBe('xpubX');
    expect(keys.rescue).toBeUndefined();
  });
});

describe('the REAL backend subscription shape (regression, 2026-07-27)', () => {
  // SubscriptionAdminSerializer sends plan_item as a bare id and the name in
  // a SEPARATE flat field; DecimalFields arrive as strings. Reading .name off
  // the id left every Stripe subscriber (tier null) looking planless — the
  // app then could not see a staff Elite→Elite Plus upgrade at all.
  const real = [
    {
      id: 'b0e9a0d2-1111-2222-3333-444455556666',
      plan_item: 'd41d8cd9-9f00-4b20-a1e2-8fc3a9b0c7de',
      plan_item_name: 'Elite Plus Annual',
      tier: null,
      status: 'ACTIVE',
      amount: '1495.00',
      currency: 'USD',
      end_at: '2027-07-27T00:00:00Z',
      provider: 'stripe',
    },
  ];

  it('reads the plan name from the flat plan_item_name field', () => {
    const [sub] = parseSubscriptions(real);
    expect(sub.planName).toBe('Elite Plus Annual');
    expect(sub.amount).toBe(1495);
  });

  it('a manual Elite Plus upgrade raises the vault limit even with tier null', () => {
    expect(maxVaultsForPlan(parseSubscriptions(real))).toBe(3);
    expect(activePlanTier(parseSubscriptions(real))).toBe('elite-plus');
  });

  it('a stale tier can never cap a newer plan item', () => {
    // Staff re-tiered the plan item to Elite Plus but the old tier column
    // still says "elite" — the generous signal must win.
    const stale = parseSubscriptions([{ ...real[0], tier: 'elite' }]);
    expect(maxVaultsForPlan(stale)).toBe(3);
  });

  it('still understands a populated tier (BTCPay / imported rows)', () => {
    const btcpay = parseSubscriptions([
      { ...real[0], plan_item_name: undefined, tier: 'elite' },
    ]);
    expect(maxVaultsForPlan(btcpay)).toBe(2);
  });
});

describe('Lifetime Elite (decided 2026-09-04: Premium 1, Elite 2, Elite Plus 3, Lifetime Elite 10)', () => {
  it('opens the whole block with no subscription and no portfolio', () => {
    expect(LIFETIME_ELITE_VAULTS).toBe(10);
    expect(entitledVaultCount([], null, new Date(), true)).toBe(10);
  });

  it('is nothing special when the flag is off', () => {
    expect(entitledVaultCount([], null, new Date(), false)).toBe(0);
  });

  it('reads as Elite for copy and upsells, never below a higher paid tier', () => {
    expect(activePlanTier([], new Date(), true)).toBe('elite');
    expect(activePlanTier([], new Date(), false)).toBeNull();
    const elitePlus = parseSubscriptions([
      {
        id: 'sub-1',
        status: 'active',
        tier: 'elite-plus',
        plan_item_name: 'Elite Plus Annual',
        end_at: null,
      },
    ]);
    expect(activePlanTier(elitePlus, new Date(), true)).toBe('elite-plus');
  });
});

describe('onboarding is once per client (decided 2026-07-27)', () => {
  const plansBody = [
      {
        id: 'plan-premium',
        name: 'Premium',
        items: [
          { id: 'item-single', name: 'Premium Single-Sig Annual', type: 'ANNUAL_SUBSCRIPTION', base_price: '195.00' },
          { id: 'item-onboarding', name: 'Onboarding', type: 'ONBOARDING', base_price: '495.00' },
        ],
      },
  ];
  const session = { accessToken: 't', email: 'c@example.com' } as never;
  const cfg = {
    tier: 'premium' as const,
    tierName: 'Premium',
    planItemName: 'Premium Single-Sig Annual',
    configType: 'single-1-1' as const,
    userEmail: 'c@example.com',
    rescue: true,
    inheritance: false,
    heirCount: 0,
    annual: 195,
  };

  function mockFetch(): jest.Mock {
    const fn = jest.fn(async (url: string) => {
      if (String(url).includes('plans')) {
        return { ok: true, json: async () => plansBody } as never;
      }
      return { ok: true, json: async () => ({ portfolio_id: 'p1', quote_id: 'q1' }) } as never;
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fn;
    return fn as unknown as jest.Mock;
  }

  it('sends NO onboarding line when the client already onboarded', async () => {
    const fn = mockFetch();
    await createVaultQuote(session, { ...cfg, onboarding: 0 });
    const save = fn.mock.calls.find((c) => !String(c[0]).includes('plans'))!;
    const body = JSON.parse((save[1] as { body: string }).body);
    expect(body.pricing_summary.setup_fee_total).toBe(0);
    expect(body.pricing_summary.items).toHaveLength(1);
    expect(
      body.pricing_summary.items.some((i: { id?: string }) => i.id === 'item-onboarding'),
    ).toBe(false);
  });

  it('still bills the $495 onboarding for a first-time client', async () => {
    const fn = mockFetch();
    await createVaultQuote(session, { ...cfg, onboarding: 495 });
    const save = fn.mock.calls.find((c) => !String(c[0]).includes('plans'))!;
    const body = JSON.parse((save[1] as { body: string }).body);
    expect(body.pricing_summary.setup_fee_total).toBe(495);
    expect(body.pricing_summary.items).toHaveLength(2);
    expect(body.pricing_summary.items[1].id).toBe('item-onboarding');
  });
});

// The server's synthetic Lifetime Elite row, exactly as the backend sends it
// to a member with no other subscription rows. Its title carried an em dash
// that Apple photographed on the Subscriptions screen (2026-09-11).
const LIFETIME_ROW = {
  id: 'lifetime-elite',
  plan_item_name: 'Elite — Lifetime',
  tier: 'elite',
  provider: 'manual',
  amount: '0.00',
  status: 'ACTIVE',
  auto_renew: false,
  end_at: null,
  metadata: { lifetime_elite: true },
};

describe('the Lifetime Elite row (2026-09-12)', () => {
  it('is marked lifetime and named without the em dash', () => {
    const [s] = parseSubscriptions([LIFETIME_ROW]);
    expect(s.lifetime).toBe(true);
    expect(s.planName).toBe(LIFETIME_PLAN_NAME);
    expect(s.planName).toBe('Lifetime Elite');
    expect(s.planName).not.toContain('—');
  });

  it.each([
    ['a plain title', { ...LIFETIME_ROW, plan_item_name: 'Lifetime Elite' }],
    ['a uuid id and only metadata.lifetime_elite', { ...LIFETIME_ROW, id: 'c3a1e0f2-5555-6666-7777-888899990000' }],
    ['only the id', { ...LIFETIME_ROW, metadata: null }],
  ])('is still found with %s', (_label, raw) => {
    const [s] = parseSubscriptions([raw]);
    expect(s.lifetime).toBe(true);
    expect(s.planName).toBe('Lifetime Elite');
  });

  it('leaves a normal Stripe row alone', () => {
    const [s] = parseSubscriptions([
      {
        id: 'b0e9a0d2-1111-2222-3333-444455556666',
        plan_item_name: 'Elite Annual',
        tier: null,
        status: 'ACTIVE',
        amount: '995.00',
        end_at: '2027-07-27T00:00:00Z',
        provider: 'stripe',
        metadata: {},
      },
    ]);
    expect(s.lifetime).toBeUndefined();
    expect(s.planName).toBe('Elite Annual');
  });

  it('still reads as Elite at every name-based gate', () => {
    const now = new Date('2026-09-12T12:00:00Z');
    const subs = parseSubscriptions([LIFETIME_ROW]);
    expect(tierVaultLimit(subs[0].tier, subs[0].planName)).toBe(2);
    expect(tierVaultLimit(undefined, subs[0].planName)).toBe(2); // tier null: the name alone
    expect(maxVaultsForPlan(subs, now)).toBe(2);
    expect(activePlanTier(subs, now)).toBe('elite'); // from the row, profile flag off
    // InheritanceSetupScreen shows the Estate Plan's Elite fields for an active
    // row whose planName includes "elite".
    expect(subs[0].planName!.toLowerCase()).toContain('elite');
    expect(subs[0].planName!.toLowerCase()).not.toContain('plus');
  });
});

describe('withLifetimeMembership (the server adds its lifetime row only when there is no other)', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const expiredElite: Subscription = {
    id: 'sub-old',
    planName: 'Elite Annual',
    status: 'EXPIRED',
    endAt: '2025-09-01T00:00:00Z',
  };

  it('puts the lifetime line first when the flag is on and the list lacks it', () => {
    const subs = [expiredElite];
    const out = withLifetimeMembership(subs, true);
    expect(out).toHaveLength(2);
    expect(out[0].lifetime).toBe(true);
    expect(out[0].planName).toBe(LIFETIME_PLAN_NAME);
    expect(out[1]).toBe(expiredElite);
    expect(subs).toHaveLength(1); // the input is not mutated
    expect(hasActiveSubscription(subs, now)).toBe(false);
    expect(hasActiveSubscription(out, now)).toBe(true);
    expect(activePlanTier(out, now)).toBe('elite');
  });

  it("never duplicates the server's own lifetime row", () => {
    const subs = parseSubscriptions([LIFETIME_ROW]);
    const out = withLifetimeMembership(subs, true);
    expect(out).toBe(subs);
    expect(out).toHaveLength(1);
  });

  it('returns the same array when the flag is off', () => {
    const subs = [expiredElite];
    expect(withLifetimeMembership(subs, false)).toBe(subs);
    expect(withLifetimeMembership([], false)).toEqual([]);
  });
});

describe('membershipState (read-only status for the builds that sell nothing)', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const FUTURE = '2027-01-01T00:00:00Z';
  const PAST = '2026-01-03T00:00:00Z';
  const row = (status: string, endAt?: string): Subscription => ({ id: 'x', status, endAt });

  it('a lifetime membership is active', () => {
    const [fromServer] = parseSubscriptions([LIFETIME_ROW]);
    expect(membershipState(fromServer, now)).toEqual({ kind: 'active' });
    const [added] = withLifetimeMembership([], true);
    expect(membershipState(added, now)).toEqual({ kind: 'active' });
  });

  const CASES: Array<[string, string | undefined, MembershipState]> = [
    ['ACTIVE', FUTURE, { kind: 'active' }],
    ['ACTIVE', undefined, { kind: 'active' }],
    ['ACTIVE', PAST, { kind: 'ended', at: PAST }],
    ['EXPIRED', PAST, { kind: 'ended', at: PAST }],
    ['CANCELED', FUTURE, { kind: 'inactive' }],
    ['PENDING', undefined, { kind: 'inactive' }],
  ];

  it.each(CASES)('%s ending %s, in upper and lower case alike', (status, endAt, want) => {
    expect(membershipState(row(status, endAt), now)).toEqual(want);
    expect(membershipState(row(status.toLowerCase(), endAt), now)).toEqual(want);
  });

  it('an end date of exactly now has ended, as hasActiveSubscription says', () => {
    const at = now.toISOString();
    expect(hasActiveSubscription([row('ACTIVE', at)], now)).toBe(false);
    expect(membershipState(row('ACTIVE', at), now)).toEqual({ kind: 'ended', at });
  });
});

describe('a plan somebody else pays for (decided 2026-09-20)', () => {
  const held = {
    id: 'held-abc',
    plan_item_name: 'Elite Plus Annual, paid for by Toni',
    tier: 'elite-plus',
    status: 'ACTIVE',
    amount: '0.00',
    auto_renew: false,
    provider: 'held',
    metadata: { held_of: 'toni@example.com', payer_name: 'Toni', vault_number: 2 },
  };
  const now = new Date('2026-09-20T12:00:00Z');

  it('is parsed with the payer, and keeps the backend’s name', () => {
    const [row] = parseSubscriptions([held]);
    expect(row.held).toBe(true);
    expect(row.heldOf).toBe('toni@example.com');
    expect(row.payerName).toBe('Toni');
    expect(heldPlanLabel(row)).toBe('Elite Plus Annual, paid for by Toni');
  });

  it('grants the tier but never the vault count', () => {
    const subs = parseSubscriptions([held]);
    expect(activePlanTier(subs)).toBe('elite-plus');
    expect(maxVaultsForPlan(subs)).toBe(0);
  });

  it('an older backend’s "(plan of ...)" is never shown', () => {
    const [byName] = parseSubscriptions([
      { ...held, plan_item_name: 'Elite Plus Annual (plan of toni@example.com)' },
    ]);
    expect(heldPlanLabel(byName)).toBe('Elite Plus Annual, paid for by Toni');
    const [byEmail] = parseSubscriptions([
      {
        ...held,
        plan_item_name: 'Elite Plus Annual (plan of toni@example.com)',
        metadata: { held_of: 'toni@example.com' },
      },
    ]);
    expect(heldPlanLabel(byEmail)).toBe('Elite Plus Annual, paid for by toni@example.com');
    // A row of the client's own is never touched.
    const [own] = parseSubscriptions([{ id: 's1', status: 'ACTIVE', plan_item_name: 'Elite Annual' }]);
    expect(heldPlanLabel(own)).toBe('Elite Annual');
  });

  it('reads Active or Ended, nothing else', () => {
    const [live] = parseSubscriptions([{ ...held, end_at: '2027-01-01T00:00:00Z' }]);
    expect(heldPlanStatus(live, now)).toBe('Active');
    for (const status of ['EXPIRED', 'CANCELED', 'PENDING']) {
      const [row] = parseSubscriptions([{ ...held, status }]);
      expect(heldPlanStatus(row, now)).toBe('Ended');
    }
    const [ranOut] = parseSubscriptions([{ ...held, end_at: '2026-09-01T00:00:00Z' }]);
    expect(heldPlanStatus(ranOut, now)).toBe('Ended');
  });

  it('the payer’s plan decides the lapsed note, never the owner’s own cheaper plan', () => {
    const own = { id: 's1', status: 'ACTIVE', plan_item_name: 'Premium Annual', end_at: '2027-01-01T00:00:00Z' };
    const ended = { ...held, status: 'EXPIRED' };
    expect(payerPlanEnded(parseSubscriptions([held, own]), 'Toni@example.com', now)).toBe(false);
    expect(payerPlanEnded(parseSubscriptions([ended, own]), 'toni@example.com', now)).toBe(true);
    // Another payer's row says nothing about this vault.
    const other = { ...held, id: 'held-x', metadata: { held_of: 'bob@example.com' } };
    expect(payerPlanEnded(parseSubscriptions([ended, other]), 'toni@example.com', now)).toBe(true);
  });

  it('an older backend drops the ended row: any live plan on the account stands in', () => {
    const own = { id: 's1', status: 'ACTIVE', plan_item_name: 'Premium Annual', end_at: '2027-01-01T00:00:00Z' };
    expect(payerPlanEnded([], 'toni@example.com', now)).toBe(true);
    expect(payerPlanEnded(parseSubscriptions([own]), 'toni@example.com', now)).toBe(false);
  });
});

describe('returning clients follow the checkout\'s own rule (decided 2026-10-01)', () => {
  const row = (status: string, over: Partial<Subscription> = {}): Subscription => ({
    id: `s-${status}`,
    status,
    planName: 'Premium Annual',
    ...over,
  });

  it('a client whose only row is PENDING has not been onboarded', () => {
    expect(isOnboardedClient(null, [row('PENDING')])).toBe(false);
    expect(isOnboardedClient(undefined, [row('pending')])).toBe(false);
  });

  it('a client whose only row FAILED has not been onboarded', () => {
    expect(isOnboardedClient(null, [row('FAILED')])).toBe(false);
  });

  it('a family member whose only rows are held has not been onboarded', () => {
    const held = row('ACTIVE', { id: 'held-1', held: true, heldOf: 'payer@example.com' });
    expect(isOnboardedClient(null, [held, { ...held, id: 'held-2', status: 'EXPIRED' }])).toBe(
      false,
    );
  });

  it('a plan of their own that started counts, whatever it is now', () => {
    expect(isOnboardedClient(null, [row('PENDING'), row('EXPIRED')])).toBe(true);
    expect(isOnboardedClient(null, [row('CANCELED')])).toBe(true);
    expect(isOnboardedClient(null, [], true)).toBe(true);
  });

  it('the server\'s answer decides whenever it is given', () => {
    expect(isOnboardedClient(false, [row('ACTIVE')], true)).toBe(false);
    expect(isOnboardedClient(true, [])).toBe(true);
  });

  it('reads "onboarded" off the entitlement probe, null when an older backend is silent', () => {
    expect(parseKeyEntitlement({ entitled: false, onboarded: false }).onboarded).toBe(false);
    expect(parseKeyEntitlement({ entitled: true, onboarded: true }).onboarded).toBe(true);
    expect(parseKeyEntitlement({ entitled: true }).onboarded).toBeNull();
    expect(parseKeyEntitlement({ onboarded: 'yes' }).onboarded).toBeNull();
  });
});

describe('a refused checkout reads as one plain sentence (decided 2026-10-01)', () => {
  const plansBody = [
    {
      id: 'plan-premium',
      name: 'Premium',
      items: [
        { id: 'item-annual', name: 'Premium Annual', type: 'ANNUAL_SUBSCRIPTION', base_price: '395.00' },
        { id: 'item-onboarding', name: 'Premium Onboarding', type: 'ONBOARDING', base_price: '495.00' },
      ],
    },
  ];
  const session = { accessToken: 't', email: 'c@example.com' } as never;
  const cfg = {
    tier: 'premium' as const,
    tierName: 'Premium',
    planItemName: 'Premium Annual',
    configType: 'multi-2-3' as const,
    userEmail: 'c@example.com',
    rescue: false,
    inheritance: false,
    heirCount: 0,
    annual: 395,
    onboarding: 0,
  };

  function mockFetch(
    plans: { ok: boolean; status?: number; body?: unknown } | 'throw',
    save: { ok: boolean; status: number; body: unknown } = {
      ok: true,
      status: 201,
      body: { quote_id: 'q1' },
    },
  ): jest.Mock {
    const fn = jest.fn(async (url: string) => {
      if (String(url).includes('plans')) {
        if (plans === 'throw') throw new Error('offline');
        return {
          ok: plans.ok,
          status: plans.status ?? (plans.ok ? 200 : 500),
          json: async () => plans.body,
        } as never;
      }
      return {
        ok: save.ok,
        status: save.status,
        json: async () => save.body,
        text: async () => JSON.stringify(save.body),
      } as never;
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fn;
    return fn as unknown as jest.Mock;
  }
  const saves = (fn: jest.Mock) => fn.mock.calls.filter((c) => !String(c[0]).includes('plans'));

  it('says the onboarding is needed when the server has no earlier plan on file', async () => {
    mockFetch(
      { ok: true, body: plansBody },
      {
        ok: false,
        status: 400,
        body: {
          error: 'ONBOARDING_REQUIRED',
          message: 'Your first plan with us includes the one-time onboarding.',
        },
      },
    );
    const err = await createVaultQuote(session, cfg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OnboardingRequiredError);
    expect((err as Error).message).toBe(ONBOARDING_REQUIRED_MESSAGE);
    expect((err as Error).message).not.toMatch(/400|\u2014/);
  });

  it('asks for a reload when the plan list cannot be fetched, and sends nothing', async () => {
    for (const plans of ['throw', { ok: false, status: 503 }] as const) {
      const fn = mockFetch(plans);
      const err = await createVaultQuote(session, cfg).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PricesChangedError);
      expect((err as Error).message).toBe(PRICES_CHANGED_MESSAGE);
      expect(saves(fn)).toHaveLength(0);
    }
  });

  it('asks for a reload when the price shown is not the plan item\'s any more', async () => {
    const fn = mockFetch({ ok: true, body: plansBody });
    const err = await createVaultQuote(session, { ...cfg, annual: 295 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PricesChangedError);
    expect(saves(fn)).toHaveLength(0);
    // The onboarding line too, for a first-time client.
    const fn2 = mockFetch({ ok: true, body: plansBody });
    const err2 = await createVaultQuote(session, { ...cfg, onboarding: 395 }).catch(
      (e: unknown) => e,
    );
    expect(err2).toBeInstanceOf(PricesChangedError);
    expect(saves(fn2)).toHaveLength(0);
  });

  it('asks for a reload when the server refuses the lines', async () => {
    mockFetch(
      { ok: true, body: plansBody },
      { ok: false, status: 400, body: { error: 'UNKNOWN_PLAN_ITEM', message: 'x' } },
    );
    await expect(createVaultQuote(session, cfg)).rejects.toBeInstanceOf(PricesChangedError);
  });

  it('every line it sends names its plan item', async () => {
    const fn = mockFetch({ ok: true, body: plansBody });
    await createVaultQuote(session, { ...cfg, onboarding: 495 });
    const body = JSON.parse((saves(fn)[0][1] as { body: string }).body);
    expect(body.pricing_summary.items.map((i: { id?: string }) => i.id)).toEqual([
      'item-annual',
      'item-onboarding',
    ]);
  });
});

describe('keyProofReportBody', () => {
  it('names where and what, never the key', () => {
    const body = keyProofReportBody({
      network: 'mainnet', account: 1003, purpose: 'rescue', status: 'invalid', code: 'PROOF_PATH', refused: false,
    });
    expect(body).toEqual({
      network: 'mainnet', account: 1003, purpose: 'rescue', status: 'invalid', code: 'PROOF_PATH', refused: false,
    });
    expect(Object.keys(body).sort()).toEqual(['account', 'code', 'network', 'purpose', 'refused', 'status']);
  });

  it('says when the proof refused the build (the backend files it as enforced)', () => {
    const body = keyProofReportBody({
      network: 'testnet4', account: 1001, purpose: 'cosigner', status: 'invalid', code: 'PROOF_WRONG_KEY', refused: true,
    });
    expect(body.refused).toBe(true);
  });
});
