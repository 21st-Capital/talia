// companyAuth touches the iOS Keychain natively; the package ships
// untranspiled ESM that Jest cannot load, and these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import { readFileSync } from 'fs';
import { join } from 'path';

import * as vaultHolders from '../vaultHolders';
import {
  OWNERS_COPY,
  TwoFactorRequiredError,
  assignActionLabel,
  assignConfirmTitle,
  emailLooksValid,
  estateOwnerLine,
  hasOwnPlanSlots,
  holdersRefusal,
  ownerSlotRows,
  ownerStateWords,
  paidForByName,
  parseVaultHoldersPage,
} from '../vaultHolders';
import { parseKeyEntitlement } from '../companyAuth';

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `h${n}`,
  vault_number: n,
  email: 'alex@example.com',
  status: 'active',
  holder_email: 'alex@example.com',
  holder_name: 'Alex Example',
  payer_email: 'payer@example.com',
  payer_name: 'Toni',
  email_mismatch: false,
  created_at: '2026-09-19T10:00:00Z',
  accepted_at: '2026-09-19T10:05:00Z',
  expires_at: null,
  ...extra,
});

describe('the vaults of a plan, as the backend lists them', () => {
  it('lists every paid slot, built or not, with who it is for', () => {
    const page = parseVaultHoldersPage({
      hosted: [row(2)],
      held: [],
      vaults: [
        { vault_number: 1, account: 1001, config_type: 'multi-2-3', tested_at: '2026-09-01T00:00:00Z', claimed: true, holder: null },
        { vault_number: 2, account: 1002, config_type: null, tested_at: null, claimed: false, holder: row(2, { signed_in: true, built: false, account: 1002 }) },
        { vault_number: 3, account: null, config_type: null, tested_at: null, claimed: false, holder: null },
        { nope: true },
      ],
    });
    expect(page.vaults.map((v) => v.vaultNumber)).toEqual([1, 2, 3]);
    expect(page.vaults[0].claimed).toBe(true);
    expect(page.vaults[1].holder).toMatchObject({ holderName: 'Alex Example', signedIn: true, built: false, account: 1002 });
    expect(page.vaults[2]).toMatchObject({ account: null, claimed: false, holder: null });
    expect(page.hosted).toHaveLength(1);
  });

  it('reads an older answer without the slots', () => {
    expect(parseVaultHoldersPage({ hosted: [], held: [] }).vaults).toEqual([]);
  });

  it('an older backend sends no claimed, built or signed_in: status and tested_at stand in', () => {
    const page = parseVaultHoldersPage({
      vaults: [
        { vault_number: 1, tested_at: '2026-09-01T00:00:00Z', holder: null },
        { vault_number: 2, tested_at: null, holder: row(2, { status: 'invited' }) },
        { vault_number: 3, tested_at: '2026-09-02T00:00:00Z', holder: row(3) },
      ],
    });
    expect(page.vaults[0].claimed).toBe(true);
    expect(page.vaults[1].claimed).toBe(false);
    expect(page.vaults[1].holder).toMatchObject({ signedIn: false, built: false });
    expect(page.vaults[2].holder).toMatchObject({ signedIn: true, built: true });
  });
});

describe('the Vault owners list (decided 2026-09-20)', () => {
  const holder = (extra: Record<string, unknown> = {}) =>
    parseVaultHoldersPage({ vaults: [{ vault_number: 2, holder: row(2, extra) }] }).vaults[0].holder!;
  const slot = (n: number, extra: Partial<vaultHolders.PayerVault> = {}): vaultHolders.PayerVault => ({
    vaultNumber: n,
    account: 1000 + n,
    configType: null,
    testedAt: null,
    claimed: false,
    holder: null,
    ...extra,
  });

  it('words every slot: you, the other person, not assigned', () => {
    const rows = ownerSlotRows(
      [
        slot(3),
        slot(1, { claimed: true }),
        slot(2, { holder: holder({ signed_in: false, built: false, status: 'invited', holder_name: '' , holder_email: null }) }),
      ],
      (n) => (n === 1 ? 'Savings' : undefined),
    );
    expect(rows.map((r) => r.title)).toEqual(['Vault 1: you', 'Vault 2: alex@example.com', 'Vault 3: not assigned']);
    expect(rows.map((r) => r.sub)).toEqual(['Savings, Built', 'Not signed in yet', null]);
    expect(rows.map((r) => r.canAssign)).toEqual([false, false, true]);
  });

  it('the three states of the other person, name before email', () => {
    expect(ownerStateWords({ built: false, signedIn: false })).toBe('Not signed in yet');
    expect(ownerStateWords({ built: false, signedIn: true })).toBe('Signed in');
    expect(ownerStateWords({ built: true, signedIn: true })).toBe('Built');
    const [r] = ownerSlotRows([slot(2, { holder: holder({ signed_in: true, built: true }) })]);
    expect(r).toMatchObject({ title: 'Vault 2: Alex Example', sub: 'Built', kind: 'someoneElse' });
  });

  it('an assigned row never carries a button, whatever its state', () => {
    for (const extra of [
      { status: 'invited', signed_in: false, built: false },
      { signed_in: true, built: false },
      { signed_in: true, built: true },
    ]) {
      expect(ownerSlotRows([slot(2, { holder: holder(extra) })])[0].canAssign).toBe(false);
    }
  });

  it('a built slot is never offered, tested or only claimed; vault 1 is when it is free', () => {
    expect(ownerSlotRows([slot(1, { claimed: true })])[0]).toMatchObject({ kind: 'you', sub: 'Built', canAssign: false });
    expect(ownerSlotRows([slot(1, { testedAt: '2026-09-01' })])[0]).toMatchObject({ kind: 'you', canAssign: false });
    expect(ownerSlotRows([slot(1)])[0]).toMatchObject({ title: 'Vault 1: not assigned', canAssign: true });
  });

  it('a vault on this phone is the payer’s own even before its keys were claimed', () => {
    expect(ownerSlotRows([slot(2)], () => 'Kids')[0]).toMatchObject({
      title: 'Vault 2: you',
      sub: 'Kids',
      canAssign: false,
    });
  });

  it('the confirm dialog is one title', () => {
    expect(assignConfirmTitle(3, ' alex@example.com ')).toBe('Vault 3 is for alex@example.com?');
  });

  it('checks the email before the button lights', () => {
    expect(emailLooksValid(' alex@example.com ')).toBe(true);
    for (const bad of ['', 'robin', 'robin@', 'robin@example', 'k id@example.com']) {
      expect(emailLooksValid(bad)).toBe(false);
    }
  });

  it('the Settings row is for a client with a plan of their own', () => {
    expect(hasOwnPlanSlots(null)).toBe(false);
    // Somebody whose only vault another person pays for: no slots of their own.
    expect(hasOwnPlanSlots(parseVaultHoldersPage({ hosted: [], held: [row(2)], vaults: [] }))).toBe(false);
    expect(hasOwnPlanSlots({ vaults: [slot(1)] })).toBe(true);
  });
});

describe('who pays, said in two places only', () => {
  it('the name from the entitlement, else the email the wallet recorded', () => {
    const holdings = [{ payerEmail: 'Toni@Example.com', payerName: 'Toni' }];
    expect(paidForByName('toni@example.com', holdings)).toBe('Toni');
    expect(paidForByName('toni@example.com', [{ payerEmail: 'toni@example.com', payerName: '' }])).toBe('toni@example.com');
    expect(paidForByName('toni@example.com')).toBe('toni@example.com');
    expect(paidForByName(undefined, holdings)).toBeNull();
  });

  it('the Estate Plan line the payer reads', () => {
    expect(estateOwnerLine('Alex Example')).toBe('For Alex Example, who files its Estate Plan from their own account');
  });
});

describe('the entitlement answer', () => {
  it('reads what the 2026-09-20 backend added', () => {
    const ent = parseKeyEntitlement({
      entitled: true,
      tier: 'elite-plus',
      vaults_included: 3,
      vaults_claimed: [1],
      own_plan: true,
      vaults_allocated: [{ vault_number: 2, email: 'alex@example.com', name: 'Alex Example', status: 'active', built: false }, { nope: 1 }],
      vaults_own_free: 1,
      holdings: [{ payer_id: 7, payer_email: 'toni@example.com', payer_name: 'Toni', vault_number: 2, claimed: true }],
    });
    expect(ent.vaultsAllocated).toEqual([{ vaultNumber: 2, email: 'alex@example.com', name: 'Alex Example', status: 'active', built: false }]);
    expect(ent.vaultsOwnFree).toBe(1);
    expect(ent.holdings).toEqual([{ payerId: 7, payerEmail: 'toni@example.com', payerName: 'Toni', vaultNumber: 2, claimed: true }]);
  });

  it('an older backend: nothing allocated, nothing claimed, free slots unknown', () => {
    const ent = parseKeyEntitlement({
      entitled: true,
      vaults_included: 2,
      holdings: [{ payer_id: 7, payer_email: 'toni@example.com', vault_number: 2 }],
    });
    expect(ent.vaultsAllocated).toEqual([]);
    expect(ent.vaultsOwnFree).toBeNull();
    expect(ent.holdings[0]).toMatchObject({ claimed: false, payerName: '' });
    expect(ent.ownPlan).toBe(true);
    expect(parseKeyEntitlement({ vaults_own_free: -2 }).vaultsOwnFree).toBe(0);
  });
});

describe('a refused assignment', () => {
  it('two-factor missing is a typed error, so the screen can open the setup', () => {
    const e = holdersRefusal(403, { error: '2FA_REQUIRED', message: 'x' }, 'Could not assign the vault');
    expect(e).toBeInstanceOf(TwoFactorRequiredError);
    expect(OWNERS_COPY.twoFactorTitle).toBe('Two-factor is required');
    expect(OWNERS_COPY.twoFactorSetUp).toBe('Set up two-factor');
    const screen = readFileSync(join(__dirname, '..', '..', 'ui', 'screens', 'VaultHoldersScreen.tsx'), 'utf8');
    expect(screen).toMatch(/TwoFactorRequiredError/);
    expect(screen).toMatch(/navigate\('TwoFactor', \{ gate: true \}\)/);
  });

  it('every other refusal keeps the backend’s words', () => {
    const e = holdersRefusal(409, { error: 'SLOT_BUILT', message: 'Vault 1 is already built.' }, 'x');
    expect(e).not.toBeInstanceOf(TwoFactorRequiredError);
    expect(e.message).toBe('Vault 1 is already built.');
    expect(holdersRefusal(500, {}, 'Could not assign the vault').message).toBe('Could not assign the vault (500).');
    expect(holdersRefusal(401, {}, 'x').message).toMatch(/session has expired/);
  });

  it('VoiceOver can tell the free slots apart', () => {
    expect(assignActionLabel(3)).toBe('Assign vault 3 to someone else');
    expect(assignActionLabel(1)).not.toBe(assignActionLabel(3));
  });
});

describe('words a client never reads (decided 2026-09-20)', () => {
  const BANNED = /\bhold\b|\bholds\b|holder|\bheld\b|plan of|\bleave\b|invitation|—|–/i;
  const strings = [
    ...Object.values(OWNERS_COPY),
    assignConfirmTitle(3, 'alex@example.com'),
    assignActionLabel(3),
    estateOwnerLine('Alex Example'),
    ownerStateWords({ built: false, signedIn: false }),
    ownerStateWords({ built: false, signedIn: true }),
    ownerStateWords({ built: true, signedIn: true }),
  ];

  it('guards the guard', () => {
    for (const s of ['Vaults you hold', 'Plan of toni@example.com', 'Leave', 'Invitation code', 'a — b']) {
      expect(s).toMatch(BANNED);
    }
  });

  it('none of the screen’s own words', () => {
    expect(strings.length).toBeGreaterThan(15);
    expect(strings.filter((s) => BANNED.test(s))).toEqual([]);
  });

  it('the payer’s name stays off the everyday card, the refusals and the lapsed note', () => {
    expect(OWNERS_COPY.lapsedTitle).toBe('The plan that pays for this vault has ended');
    expect(OWNERS_COPY.lapsedBody).toBe('Nothing is locked. The vault itself does not change.');
    const card = readFileSync(join(__dirname, '..', '..', 'ui', 'screens', 'WalletListScreen.tsx'), 'utf8');
    expect(card).not.toMatch(/heldOf|Plan of/);
  });

  it('the screen offers no way to take a vault back', () => {
    expect(Object.keys(vaultHolders)).not.toEqual(expect.arrayContaining(['revokeVaultHolder']));
    expect(Object.keys(vaultHolders)).not.toEqual(expect.arrayContaining(['acceptVaultInvitation']));
    const screen = readFileSync(join(__dirname, '..', '..', 'ui', 'screens', 'VaultHoldersScreen.tsx'), 'utf8');
    expect(screen).not.toMatch(/revoke|Remove|Leave|Invitation code|accept/i);
  });
});
