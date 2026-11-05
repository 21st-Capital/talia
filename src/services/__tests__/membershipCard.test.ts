// companyAuth touches the iOS Keychain natively; these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import { parseSubscriptions, planDeadline, planIcon, planSubtitle, planTitle } from '../billing';
import type { Subscription } from '../billing';

const NOW = new Date('2026-09-21T12:00:00Z');

const held = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'held-1',
  planName: 'Lifetime Elite, paid for by Alex Example',
  tier: 'elite',
  status: 'active',
  held: true,
  heldOf: 'alex@example.com',
  payerName: 'Alex Example',
  vaultNumber: 2,
  endAt: '2027-10-12T00:00:00Z',
  ...over,
});

describe('the Membership card (decided 2026-09-21)', () => {
  it('reads the vault a held plan pays for off the row', () => {
    const [row] = parseSubscriptions([
      {
        id: 'held-7',
        plan_item_name: 'Elite Plus Annual, paid for by Toni',
        tier: 'elite-plus',
        provider: 'held',
        status: 'ACTIVE',
        metadata: { held_of: 'toni@example.com', payer_name: 'Toni', vault_number: 3 },
      },
    ]);
    expect(row.vaultNumber).toBe(3);
  });

  it('keeps the plan name as the title and moves the payer underneath', () => {
    const sub = held();
    expect(planTitle(sub, 'Plan')).toBe('Lifetime Elite');
    expect(planSubtitle(sub)).toBe('Vault 2 · Paid for by Alex Example');
    expect(planTitle(held({ planName: 'Elite Annual, bezahlt von Toni' }), 'Plan')).toBe('Elite Annual');
  });

  it('tells two vaults of one plan apart', () => {
    expect(planSubtitle(held({ vaultNumber: 2 }))).not.toBe(planSubtitle(held({ vaultNumber: 3 })));
  });

  it('says what an own plan is, never a price', () => {
    const own: Subscription = { id: '1', planName: 'Elite Annual', status: 'active', amount: 1200 };
    expect(planTitle(own, 'Plan')).toBe('Elite Annual');
    expect(planSubtitle(own)).toBe('Your plan');
    expect(planSubtitle({ id: 'lifetime-elite', planName: 'Lifetime Elite', status: 'active', lifetime: true })).toBe(
      'Lifetime membership',
    );
    expect(planTitle({ id: '2', status: 'active' }, 'Plan')).toBe('Plan');
  });

  it('gives each tier its own icon', () => {
    expect(planIcon({ tier: 'premium' })).toBe('star');
    expect(planIcon({ planName: 'Elite Annual' })).toBe('crown');
    expect(planIcon({ planName: 'Elite Plus Annual' })).toBe('diamond');
    expect(planIcon({ planName: 'Lifetime Elite', lifetime: true })).toBe('crown');
    expect(planIcon({})).toBe('shield');
  });

  it('writes the deadline without billing words where nothing is sold', () => {
    const own: Subscription = { id: '1', planName: 'Elite', status: 'active', endAt: '2027-10-12T00:00:00Z', autoRenew: true };
    expect(planDeadline(own, { purchases: false, now: NOW })).toBe('Until 12 Oct 2027');
    expect(planDeadline(own, { purchases: true, now: NOW })).toBe('Renews 12 Oct 2027');
    expect(planDeadline({ ...own, autoRenew: false }, { purchases: true, now: NOW })).toBe('Until 12 Oct 2027');
    // A plan somebody else pays for never "renews" for its owner.
    expect(planDeadline(held(), { purchases: true, now: NOW })).toBe('Until 12 Oct 2027');
  });

  it('says a lifetime membership has no end, and when an ended plan ended', () => {
    expect(planDeadline({ id: 'l', status: 'active', lifetime: true }, { purchases: false, now: NOW })).toBe('No end date');
    const ended: Subscription = { id: '3', planName: 'Elite', status: 'expired', endAt: '2026-03-03T00:00:00Z' };
    expect(planDeadline(ended, { purchases: false, now: NOW })).toBe('Ended 3 Mar 2026');
    expect(planDeadline({ id: '4', status: 'active' }, { purchases: false, now: NOW })).toBe('');
  });
});
