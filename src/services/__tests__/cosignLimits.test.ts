/**
 * Co-signing limits are monthly and yearly, in BTC only (decided 2026-09-21:
 * "lets only offer limits in BTC" and "remove the daily limit and only keep
 * a monthly and yearly limit"). What the app sends, what it reads back, and
 * the Send screen's one line.
 */
// companyAuth touches the iOS Keychain natively; the package ships
// untranspiled ESM that Jest cannot load, and these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import {
  changeCosignLimits,
  fetchCosignLimits,
  fetchRemainingLimits,
  limitRows,
  limitsOfVault,
  usedPercent,
} from '../cosignLimits';
import type { RemainingLimits, VaultLimits } from '../cosignLimits';
import type { CompanySession } from '../companyAuth';

const session = { accessToken: 't', expiresAt: 0 } as CompanySession;
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});
const answer = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('what the app sends', () => {
  it('a change carries monthly and yearly, the unit BTC, and no daily field', async () => {
    const f = answer(200, { status: 'applied', limits: { daily: '', monthly: '0.5', yearly: '5', unit: 'BTC' } });
    global.fetch = f as unknown as typeof fetch;
    await changeCosignLimits(
      session,
      { account: 1161, network: 'testnet4' },
      { monthly: '0.5', yearly: '5' },
      { emailOtp: ' 123456 ', totp: '654321' },
    );
    const [url, init] = f.mock.calls[0];
    // A limit is changed on ONE VAULT, named as the whole system names it
    // (decided 2026-09-23): the account number our key sits at, plus the chain.
    expect(url).toMatch(/\/cosign\/limits\/1161\/testnet4\/$/);
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({ monthlyLimit: '0.5', yearlyLimit: '5', limitUnit: 'BTC', email_otp: '123456', totp: '654321' });
    expect(sent).not.toHaveProperty('dailyLimit');
  });
});

describe('what the app reads back', () => {
  it('reads one row per VAULT, with the daily and unit the server still sends dropped', async () => {
    global.fetch = answer(200, {
      elite: true,
      vaults: [
        {
          account: 1161,
          network: 'testnet4',
          vault_number: 1,
          limits: { daily: '', monthly: '0.25', yearly: '2', unit: 'BTC' },
          pending: { daily: '', monthly: '0.5', yearly: '2', unit: 'BTC', requested_at: 'a', effective_at: 'b' },
        },
      ],
    }) as unknown as typeof fetch;
    const page = await fetchCosignLimits(session);
    expect(page.vaults[0].account).toBe(1161);
    expect(page.vaults[0].vaultNumber).toBe(1);
    expect(page.vaults[0].limits).toEqual({ monthly: '0.25', yearly: '2' });
    expect(page.vaults[0].pending).toEqual({ monthly: '0.5', yearly: '2', requestedAt: 'a', effectiveAt: 'b' });
  });

  it('lists a vault that carries no limit yet, so the first one can be set', async () => {
    global.fetch = answer(200, {
      elite: true,
      vaults: [
        { account: 1162, network: 'mainnet', vault_number: 2, limits: { monthly: '', yearly: '' }, pending: null },
      ],
    }) as unknown as typeof fetch;
    const page = await fetchCosignLimits(session);
    expect(page.vaults).toHaveLength(1);
    expect(page.vaults[0].limits).toEqual({ monthly: '', yearly: '' });
  });

  it('drops a row that names no vault rather than guess at one', async () => {
    global.fetch = answer(200, { elite: true, vaults: [{ limits: { monthly: '1' } }, null, 7] }) as unknown as typeof fetch;
    expect((await fetchCosignLimits(session)).vaults).toEqual([]);
  });

  it('reads the monthly and yearly windows and drops a daily one from an older server', async () => {
    global.fetch = answer(200, {
      mode: 'limits',
      windows: [
        { window: 'daily', amount: 0.1, unit: 'BTC', limit_sats: 10_000_000, used_sats: 0, left_sats: 1 },
        { window: 'monthly', amount: 0.5, unit: 'BTC', limit_sats: 50_000_000, used_sats: 30_000_000, left_sats: 20_000_000 },
        { window: 'yearly', amount: 5, unit: 'BTC', limit_sats: 500_000_000, used_sats: 0, left_sats: 500_000_000 },
      ],
    }) as unknown as typeof fetch;
    const r = await fetchRemainingLimits(session);
    expect(r.windows.map((w) => w.window)).toEqual(['monthly', 'yearly']);
    expect(r.windows[0]).toEqual({ window: 'monthly', limitSats: 50_000_000, usedSats: 30_000_000, leftSats: 20_000_000 });
  });
});

describe('the Send screen rows (decided 2026-09-22)', () => {
  const limits = (windows: RemainingLimits['windows']): RemainingLimits => ({ mode: 'limits', note: '', windows });
  const both = limits([
    { window: 'monthly', limitSats: 50_000_000, usedSats: 30_000_000, leftSats: 20_000_000 },
    { window: 'yearly', limitSats: 500_000_000, usedSats: 30_000_000, leftSats: 470_000_000 },
  ]);

  it('shows every limit that is set, monthly first, as the share already used', () => {
    expect(limitRows(both, 1_000_000)).toEqual([
      { label: 'Monthly limit', value: '60% used', sub: '0.2 of 0.5 BTC left', over: false },
      { label: 'Yearly limit', value: '6% used', sub: '4.7 of 5 BTC left', over: false },
    ]);
  });

  it('marks the limit a send does not fit, which 21st Capital rejects', () => {
    const rows = limitRows(both, 25_000_000); // 0.25 BTC, 0.2 left this month
    expect(rows[0]).toEqual({ label: 'Monthly limit', value: 'Over the limit', sub: '0.2 of 0.5 BTC left', over: true });
    expect(rows[1].over).toBe(false);
  });

  it('a send of exactly what is left still fits', () => {
    expect(limitRows(both, 20_000_000)[0].over).toBe(false);
  });

  it('reads nothing used as 0%, a sliver as <1%, and never more than 100%', () => {
    expect(usedPercent(0, 5_000_000)).toBe('0%');
    expect(usedPercent(10_000, 5_000_000)).toBe('<1%');
    expect(usedPercent(2_500_000, 5_000_000)).toBe('50%');
    expect(usedPercent(9_000_000, 5_000_000)).toBe('100%');
  });

  it('a phone test case: nothing requested yet of a 0.05 BTC month', () => {
    const rows = limitRows(limits([{ window: 'monthly', limitSats: 5_000_000, usedSats: 0, leftSats: 5_000_000 }]), 17_602);
    expect(rows).toEqual([{ label: 'Monthly limit', value: '0% used', sub: '0.05 of 0.05 BTC left', over: false }]);
  });

  it('says so when the vaults are checked by hand, and nothing when there is no limit', () => {
    expect(limitRows({ mode: 'manual', note: '', windows: [] }, 0)).toEqual([
      { label: 'Co-signing limit', value: 'Checked by hand', sub: 'Your vaults carry different limits', over: false },
    ]);
    expect(limitRows({ mode: 'none', note: '', windows: [] }, 0)).toEqual([]);
    expect(limitRows(limits([{ window: 'monthly', limitSats: null, usedSats: 0, leftSats: null }]), 0)).toEqual([]);
  });

  it('never mentions a day, and never an em or en dash', () => {
    const text = limitRows(both, 25_000_000).map((r) => `${r.label} ${r.value} ${r.sub}`).join(' ');
    expect(text).not.toMatch(/today|daily|[–—]/i);
  });
});

describe('the limit of one vault', () => {
  const row = (account: number, network: string, vaultNumber: number): VaultLimits => ({
    account,
    network,
    vaultNumber,
    limits: { monthly: '0.01', yearly: '0.1' },
    pending: null,
  });
  const all = [row(12, 'mainnet', 1), row(13, 'mainnet', 2), row(12, 'testnet4', 1)];

  it('is the row of that vault alone', () => {
    expect(limitsOfVault(all, { account: 13, network: 'mainnet' })).toEqual([all[1]]);
  });

  it('never takes the same number on the other chain', () => {
    expect(limitsOfVault(all, { account: 12, network: 'testnet4' })).toEqual([all[2]]);
    expect(limitsOfVault(all, { account: 12, network: 'mainnet' })).toEqual([all[0]]);
  });

  it('is nothing when the vault has no row or no number, never every vault', () => {
    expect(limitsOfVault(all, { account: 14, network: 'mainnet' })).toEqual([]);
    expect(limitsOfVault(all, null)).toEqual([]);
  });
});
