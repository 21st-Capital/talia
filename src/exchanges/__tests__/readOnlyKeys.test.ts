/**
 * Decided 2026-09-26: exchange keys were trusted to be
 * read-only. Talia only reads, so a key that can trade, withdraw or transfer
 * is refused.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  COINBASE_KEY_TOO_POWERFUL,
  KRAKEN_KEY_TOO_POWERFUL,
  KRAKEN_KEY_UNCHECKABLE,
  KRAKEN_PERMISSION_PROBES,
  coinbaseKeyVerdict,
  krakenPermissionVerdict,
  krakenReadOnlyVerdict,
} from '..';

describe('Kraken permission answers', () => {
  it('Permission denied means the key cannot', () => {
    expect(krakenPermissionVerdict(['EGeneral:Permission denied'])).toBe('denied');
  });

  it('any answer Kraken reached past its permission check means the key CAN', () => {
    expect(krakenPermissionVerdict([])).toBe('allowed');
    expect(krakenPermissionVerdict(undefined)).toBe('allowed');
    expect(krakenPermissionVerdict(['EFunding:Unknown withdraw key'])).toBe('allowed');
    expect(krakenPermissionVerdict(['EOrder:Insufficient funds'])).toBe('allowed');
    expect(krakenPermissionVerdict(['EGeneral:Invalid arguments:volume minimum not met'])).toBe('allowed');
  });

  it('a question that was never really asked is unknown', () => {
    for (const e of ['EAPI:Rate limit exceeded', 'EAPI:Invalid nonce', 'EAPI:Invalid key', 'EAPI:Invalid signature', 'EService:Unavailable', 'EGeneral:Temporary lockout']) {
      expect(krakenPermissionVerdict([e])).toBe('unknown');
    }
  });

  it('the questions move nothing: Balance first, WithdrawInfo, and AddOrder only validated', () => {
    const paths = KRAKEN_PERMISSION_PROBES.map((p) => p.path);
    expect(paths).toEqual(['/0/private/Balance', '/0/private/WithdrawInfo', '/0/private/AddOrder']);
    const order = KRAKEN_PERMISSION_PROBES.find((p) => p.path.endsWith('AddOrder'));
    expect(order?.params.validate).toBe('true');
    for (const p of KRAKEN_PERMISSION_PROBES) {
      expect(p.path).not.toMatch(/\/Withdraw$|WalletTransfer|CancelOrder/);
    }
  });
});

describe('Kraken key verdict (decided 2026-09-30)', () => {
  const denied = 'denied' as const;
  const allowed = 'allowed' as const;
  const unknown = 'unknown' as const;

  it('a key with only the Query permissions is read only', () => {
    expect(krakenReadOnlyVerdict({ queryFunds: allowed, withdraw: denied, trade: denied })).toBe('readOnly');
  });

  it('Withdraw WITHOUT Query Funds is never taken for read only', () => {
    // Kraken refuses WithdrawInfo for want of Query Funds, which says nothing
    // about Withdraw. Balance is refused too, and that decides it.
    expect(krakenReadOnlyVerdict({ queryFunds: denied, withdraw: denied, trade: denied })).toBe('uncheckable');
  });

  it('a key that can withdraw or trade is too powerful, whatever else it lacks', () => {
    expect(krakenReadOnlyVerdict({ queryFunds: allowed, withdraw: allowed, trade: denied })).toBe('tooPowerful');
    expect(krakenReadOnlyVerdict({ queryFunds: denied, withdraw: denied, trade: allowed })).toBe('tooPowerful');
  });

  it('a question never really asked leaves the answer unknown', () => {
    expect(krakenReadOnlyVerdict({ queryFunds: unknown, withdraw: denied, trade: denied })).toBe('unknown');
    expect(krakenReadOnlyVerdict({ queryFunds: allowed, withdraw: unknown, trade: denied })).toBe('unknown');
  });

  it('the sync deletes a key it cannot check, like one that is too powerful', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'services', 'krakenSync.ts'), 'utf8');
    expect(src).toMatch(/e\.message === KRAKEN_KEY_TOO_POWERFUL \|\| e\.message === KRAKEN_KEY_UNCHECKABLE/);
    expect(src).toMatch(/throw new Error\(KRAKEN_KEY_UNCHECKABLE\)/);
  });
});

describe('Coinbase key permissions', () => {
  it('read-only only when Coinbase says it can neither trade nor transfer', () => {
    expect(coinbaseKeyVerdict({ can_view: true, can_trade: false, can_transfer: false })).toBe('readOnly');
    expect(coinbaseKeyVerdict({ can_view: true, can_trade: true, can_transfer: false })).toBe('tooPowerful');
    expect(coinbaseKeyVerdict({ can_view: true, can_trade: false, can_transfer: true })).toBe('tooPowerful');
    expect(coinbaseKeyVerdict({})).toBe('unknown');
    expect(coinbaseKeyVerdict(null)).toBe('unknown');
  });
});

describe('the refusals', () => {
  it('say what to do, in plain words, with no em dash', () => {
    for (const m of [KRAKEN_KEY_TOO_POWERFUL, KRAKEN_KEY_UNCHECKABLE, COINBASE_KEY_TOO_POWERFUL]) {
      expect(m).not.toMatch(/—/);
      expect(m).toMatch(/make a new key/);
    }
  });

  it('both connect screens check the key BEFORE keeping it, and both syncs check it again', () => {
    const ui = join(__dirname, '..', '..', 'ui', 'screens');
    const services = join(__dirname, '..', '..', 'services');
    for (const [file, check, save] of [
      ['KrakenConnectScreen.tsx', 'assertKrakenKeyReadOnly(', 'saveKrakenCredentials(walletId'],
      ['CoinbaseConnectScreen.tsx', 'assertCoinbaseKeyReadOnly(', 'saveCoinbaseCredentials(walletId'],
    ]) {
      const src = readFileSync(join(ui, file), 'utf8');
      const at = src.indexOf(check);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(src.indexOf(save));
      expect(src.slice(at, at + 80)).toMatch(/, true\)/);
    }
    for (const [file, sync, check] of [
      ['krakenSync.ts', 'export async function syncKrakenPortfolio(', 'assertKrakenKeyReadOnly(creds'],
      ['coinbaseSync.ts', 'export async function syncCoinbasePortfolio(', 'assertCoinbaseKeyReadOnly(creds'],
    ]) {
      const src = readFileSync(join(services, file), 'utf8');
      const body = src.slice(src.indexOf(sync), src.indexOf(sync) + 1200);
      expect(body).toContain(check);
    }
  });
});
