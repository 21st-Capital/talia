/**
 * Building a vault when a plan's vaults can be for someone else (decided
 * 2026-09-20): who counts against the own plan, the cap, the rebuild offer,
 * when the which-vault question is asked, which fingerprints are the
 * builder's everyday keys, and the same-device warning.
 */
// companyAuth touches the iOS Keychain natively; the package ships
// untranspiled ESM that Jest cannot load, and these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BUILDER_COPY,
  allocatedTitle,
  alreadyOnPhoneTitle,
  assignedOptionLabel,
  buildableAssignedVaults,
  builderEverydayFingerprints,
  countsAgainstOwnPlan,
  everyBuildIsPaidByOther,
  firstRunAssignedVault,
  firstRunTitle,
  firstUnbuiltAssigned,
  issuedVaultIsOnThisPhone,
  ownFreeSlots,
  ownPlanCap,
  ownPlanVerdict,
  payerFirstName,
  pendingClaimMatches,
  rebuildableOwnVaults,
  whichVaultToBuild,
} from '../vaultAllocation';
import {
  VaultAllocatedError,
  cleanOwnerFingerprints,
  fetchNextVaultKeys,
  parseKeyEntitlement,
  parseSameDevice,
} from '../companyAuth';
import type { CompanySession, KeyEntitlement } from '../companyAuth';
import type { WalletMeta } from '../../wallet/types';

const TPUB_A = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
const TPUB_B = 'tpubDCDuqEgbT3rnSzcJZC94rWJqBUyVbEgigqW9NkNkzyLYQCsNbTJVEWuLNfYzRe4EGkMK9ARxBDeHfxecFFrBAztDsZLYNiBB1uD86ZLpuXn';

function vault(over: Partial<WalletMeta>): WalletMeta {
  return {
    id: 'w1',
    label: 'Savings',
    descriptor: `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)`,
    network: 'testnet',
    kind: 'single-sig',
    source: 'created',
    transport: 'created',
    createdAt: 0,
    ...over,
  } as WalletMeta;
}

function ent(over: Record<string, unknown>): KeyEntitlement {
  return parseKeyEntitlement({ entitled: true, ...over });
}

const ANNA_PAYS_2 = {
  payer_id: 7,
  payer_email: 'toni@example.com',
  payer_name: 'Toni Example',
  vault_number: 2,
  claimed: false,
};

describe('the family member’s first run', () => {
  it('offers the assigned vault nobody has built when the phone holds no vault', () => {
    const e = ent({ own_plan: false, holdings: [ANNA_PAYS_2] });
    const v = firstRunAssignedVault(e, []);
    expect(v).toMatchObject({ payerId: 7, vaultNumber: 2, payerEmail: 'toni@example.com' });
    expect(firstRunTitle(2)).toBe('Vault 2 is yours');
    expect(BUILDER_COPY.buildIt).toBe('Build it');
  });

  it('says nothing once it is built, or once the phone holds a vault', () => {
    expect(firstRunAssignedVault(ent({ holdings: [{ ...ANNA_PAYS_2, claimed: true }] }), [])).toBeNull();
    expect(firstRunAssignedVault(ent({ holdings: [ANNA_PAYS_2] }), [vault({})])).toBeNull();
    expect(firstRunAssignedVault(ent({}), [])).toBeNull();
    expect(firstRunAssignedVault(null, [])).toBeNull();
  });

  it('a portfolio kept by hand is not a vault on this phone', () => {
    const e = ent({ holdings: [ANNA_PAYS_2] });
    expect(firstRunAssignedVault(e, [vault({ manual: true })])?.vaultNumber).toBe(2);
  });

  it('takes the lowest number when several wait, and an older backend reads as not built', () => {
    const e = ent({
      holdings: [
        { payer_id: 7, payer_email: 'toni@example.com', vault_number: 3 },
        { payer_id: 7, payer_email: 'toni@example.com', vault_number: 2 },
      ],
    });
    expect(firstRunAssignedVault(e, [])?.vaultNumber).toBe(2);
  });
});

describe('who counts against the own plan', () => {
  const ours = { portfolioId: 'p1', vaultNumber: 1, providerKeyFingerprints: ['0c21c051'] };

  it('a vault with our keys counts; a vault somebody else pays for never does', () => {
    expect(countsAgainstOwnPlan(vault(ours))).toBe(true);
    expect(countsAgainstOwnPlan(vault({ ...ours, heldOf: 'toni@example.com' }))).toBe(false);
  });

  it('locked, keyless, unknown to the backend and hand-kept vaults do not count', () => {
    expect(countsAgainstOwnPlan(vault({ ...ours, locked: true }))).toBe(false);
    expect(countsAgainstOwnPlan(vault({ ...ours, providerKeyFingerprints: [] }))).toBe(false);
    expect(countsAgainstOwnPlan(vault({ providerKeyFingerprints: ['0c21c051'] }))).toBe(false);
    expect(countsAgainstOwnPlan(vault({ ...ours, manual: true }))).toBe(false);
  });
});

describe('the own-plan cap', () => {
  it('is what the plan includes minus the slots that are for someone else', () => {
    expect(ownPlanCap(3, [])).toBe(3);
    expect(ownPlanCap(3, [{ vaultNumber: 2 }])).toBe(2);
    expect(ownPlanCap(2, [{ vaultNumber: 1 }, { vaultNumber: 2 }])).toBe(0);
    // The same number listed twice is one slot, and the cap never goes negative.
    expect(ownPlanCap(2, [{ vaultNumber: 2 }, { vaultNumber: 2 }])).toBe(1);
    expect(ownPlanCap(1, [{ vaultNumber: 1 }, { vaultNumber: 2 }])).toBe(0);
  });

  it('stops the payer at the cap, not at what the plan includes', () => {
    // Elite, two vaults, vault 2 is Alex Example's: one tested own vault is the limit.
    expect(ownPlanVerdict(2, [{ vaultNumber: 2 }], 0)).toBe('ok');
    expect(ownPlanVerdict(2, [{ vaultNumber: 2 }], 1)).toBe('full');
    expect(ownPlanVerdict(2, [], 1)).toBe('ok');
    expect(ownPlanVerdict(2, [], 2)).toBe('full');
  });

  it('a payer who kept no vault is told so, and an unknown plan never stops anyone', () => {
    expect(ownPlanVerdict(1, [{ vaultNumber: 1 }], 0)).toBe('allAssigned');
    expect(ownPlanVerdict(0, [{ vaultNumber: 1 }], 3)).toBe('ok');
  });
});

describe('the rebuild offer', () => {
  it('offers own numbers built before that are not on this phone', () => {
    const e = ent({ vaults_included: 3, vaults_claimed: [1, 2, 3] });
    expect(rebuildableOwnVaults(e, [vault({ vaultNumber: 1 })])).toEqual([2, 3]);
  });

  it('never offers a number that is for someone else', () => {
    const e = ent({
      vaults_included: 3,
      vaults_claimed: [1, 2],
      vaults_allocated: [{ vault_number: 2, email: 'alex@example.com', name: 'Alex Example', built: true }],
    });
    expect(rebuildableOwnVaults(e, [])).toEqual([1]);
  });

  it('a vault somebody else pays for never hides an own number that matches', () => {
    const e = ent({ vaults_included: 2, vaults_claimed: [2] });
    const annasVault2 = vault({ vaultNumber: 2, heldOf: 'toni@example.com' });
    expect(rebuildableOwnVaults(e, [annasVault2])).toEqual([2]);
  });
});

describe('which vault are you building?', () => {
  it('nobody with only an own plan is ever asked', () => {
    expect(whichVaultToBuild(ent({ vaults_included: 2, vaults_own_free: 2 }), [])).toEqual({ kind: 'own' });
  });

  it('one assigned vault and nothing else is served with no question', () => {
    const w = whichVaultToBuild(ent({ own_plan: false, holdings: [ANNA_PAYS_2] }), []);
    expect(w).toMatchObject({ kind: 'assigned', vault: { payerId: 7, vaultNumber: 2 } });
  });

  it('an own plan with nothing left to build does not turn it into a question', () => {
    const e = ent({
      own_plan: true,
      vaults_included: 1,
      vaults_claimed: [1],
      vaults_own_free: 0,
      holdings: [ANNA_PAYS_2],
    });
    expect(whichVaultToBuild(e, [vault({ vaultNumber: 1 })]).kind).toBe('assigned');
  });

  it('asks when an own free slot AND an unbuilt assigned vault exist', () => {
    const e = ent({ own_plan: true, vaults_included: 1, vaults_own_free: 1, holdings: [ANNA_PAYS_2] });
    const w = whichVaultToBuild(e, []);
    expect(w.kind).toBe('ask');
    if (w.kind !== 'ask') throw new Error('unreachable');
    expect(w.own).toBe(true);
    expect(w.vaults.map((v) => v.vaultNumber)).toEqual([2]);
    expect(BUILDER_COPY.whichVaultTitle).toBe('Which vault are you building?');
    expect(BUILDER_COPY.ownOption).toBe('A vault of my own plan');
    expect(assignedOptionLabel(w.vaults[0], false)).toBe('The vault Toni pays for');
  });

  it('an own vault that can be rebuilt is a second answer too', () => {
    const e = ent({
      own_plan: true,
      vaults_included: 1,
      vaults_claimed: [1],
      vaults_own_free: 0,
      holdings: [ANNA_PAYS_2],
    });
    expect(whichVaultToBuild(e, []).kind).toBe('ask');
  });

  it('an assigned vault already on this phone is never offered again', () => {
    const e = ent({ own_plan: true, vaults_own_free: 1, holdings: [{ ...ANNA_PAYS_2, claimed: true }] });
    const here = vault({ vaultNumber: 2, heldOf: 'Toni@Example.com' });
    expect(buildableAssignedVaults(e, [here])).toEqual([]);
    expect(whichVaultToBuild(e, [here])).toEqual({ kind: 'own' });
    // Built before and NOT on this phone: a reinstall is never a dead end.
    expect(whichVaultToBuild(e, []).kind).toBe('ask');
  });

  it('no plan of their own and the assigned vault on this phone: nothing to build', () => {
    // A claim that names nobody is answered with that vault's keys AGAIN by
    // the backend, so a second vault here would share its 21st Capital keys.
    const e = ent({ own_plan: false, holdings: [{ ...ANNA_PAYS_2, claimed: true }] });
    const here = vault({ vaultNumber: 2, heldOf: 'toni@example.com' });
    expect(whichVaultToBuild(e, [here])).toMatchObject({ kind: 'none', vault: { vaultNumber: 2 } });
    expect(alreadyOnPhoneTitle(2)).toBe('Vault 2 is already on this phone');
    // Not on this phone: it is served, as before (a reinstall).
    expect(whichVaultToBuild(e, []).kind).toBe('assigned');
    // A different payer's vault 2, or an own vault 2, is not that vault.
    expect(whichVaultToBuild(e, [vault({ vaultNumber: 2, heldOf: 'ben@example.com' })]).kind).toBe('assigned');
    expect(whichVaultToBuild(e, [vault({ vaultNumber: 2 })]).kind).toBe('assigned');
    // Nobody's family member: the ordinary own path.
    expect(whichVaultToBuild(ent({ own_plan: false }), [here])).toEqual({ kind: 'own' });
  });

  it('the backstop: keys of an assigned vault that is on this phone are never placed again', () => {
    const here = vault({ vaultNumber: 2, heldOf: 'Toni@Example.com' });
    expect(issuedVaultIsOnThisPhone({ heldOf: 'toni@example.com', vaultNumber: 2 }, [here])).toBe(true);
    expect(issuedVaultIsOnThisPhone({ heldOf: 'toni@example.com', vaultNumber: 3 }, [here])).toBe(false);
    expect(issuedVaultIsOnThisPhone({ heldOf: 'ben@example.com', vaultNumber: 2 }, [here])).toBe(false);
    // An own vault is never judged here: its rebuild is offered by number.
    expect(issuedVaultIsOnThisPhone({ vaultNumber: 2 }, [vault({ vaultNumber: 2 })])).toBe(false);
    expect(issuedVaultIsOnThisPhone({ heldOf: 'toni@example.com' }, [here])).toBe(false);
    expect(issuedVaultIsOnThisPhone({ heldOf: 'toni@example.com', vaultNumber: 2 }, [])).toBe(false);
  });

  it('a person with no plan of their own is never priced or sold anything', () => {
    expect(everyBuildIsPaidByOther(ent({ own_plan: false, holdings: [ANNA_PAYS_2] }))).toBe(true);
    expect(everyBuildIsPaidByOther(ent({ own_plan: true, holdings: [ANNA_PAYS_2] }))).toBe(false);
    expect(everyBuildIsPaidByOther(ent({ own_plan: false }))).toBe(false);
    expect(everyBuildIsPaidByOther(null)).toBe(false);
  });

  it('several assigned vaults are asked about with no own option, told apart by number', () => {
    const e = ent({
      own_plan: false,
      holdings: [ANNA_PAYS_2, { payer_id: 9, payer_email: 'ben@example.com', vault_number: 1 }],
    });
    const w = whichVaultToBuild(e, []);
    if (w.kind !== 'ask') throw new Error('expected a question');
    expect(w.own).toBe(false);
    expect(w.vaults.map((v) => assignedOptionLabel(v, true))).toEqual([
      'Vault 2, which Toni pays for',
      'Vault 1, which ben@example.com pays for',
    ]);
  });

  it('the payer’s first name, else the email', () => {
    expect(payerFirstName({ payerName: '  Toni Maria Example ', payerEmail: 'toni@example.com' })).toBe('Toni');
    expect(payerFirstName({ payerName: '', payerEmail: 'toni@example.com' })).toBe('toni@example.com');
  });

  it('an older backend that sends no free figure is worked out, or assumed open', () => {
    expect(ownFreeSlots(ent({ own_plan: false, vaults_included: 1 }))).toBe(0);
    expect(ownFreeSlots(ent({ vaults_included: 2, vaults_claimed: [1] }))).toBe(1);
    expect(ownFreeSlots(ent({ vaults_included: 1, vaults_claimed: [1] }))).toBe(0);
    expect(ownFreeSlots(ent({}))).toBe(1);
    expect(ownFreeSlots(ent({ vaults_included: 2, vaults_own_free: 0 }))).toBe(0);
  });
});

describe('a remembered claim', () => {
  it('decides while nobody has said which vault is being built', () => {
    expect(pendingClaimMatches({ vaultNumber: 1 }, undefined)).toBe(true);
    expect(pendingClaimMatches({ vaultNumber: 2, heldOf: 7 }, undefined)).toBe(true);
    expect(pendingClaimMatches(undefined, undefined)).toBe(false);
  });

  it('is never served to a build of a different vault', () => {
    // Sent here to build Toni's vault 2: an own claim of vault 1 is not it.
    expect(pendingClaimMatches({ vaultNumber: 1 }, 7, 2)).toBe(false);
    expect(pendingClaimMatches({ vaultNumber: 2, heldOf: 7 }, 7, 2)).toBe(true);
    expect(pendingClaimMatches({ vaultNumber: 3, heldOf: 7 }, 7, 2)).toBe(false);
    expect(pendingClaimMatches({ vaultNumber: 2, heldOf: 9 }, 7, 2)).toBe(false);
    // Building on the own plan: a claim of somebody else's vault is not it.
    expect(pendingClaimMatches({ vaultNumber: 2, heldOf: 7 }, null)).toBe(false);
    expect(pendingClaimMatches({ vaultNumber: 1 }, null)).toBe(true);
  });
});

describe('the refusal when the vault is for someone else', () => {
  const rows = [
    { vaultNumber: 2, name: 'Alex Example', email: 'alex@example.com' },
    { vaultNumber: 3, name: '', email: 'sam@example.com' },
  ];
  it('names them from the plan’s own list, name first, else email', () => {
    expect(allocatedTitle(2, rows)).toBe('Vault 2 is for Alex Example');
    expect(allocatedTitle(3, rows)).toBe('Vault 3 is for sam@example.com');
  });
  it('falls back to the backend’s sentence, then reads without a name', () => {
    expect(allocatedTitle(4, rows, 'Vault 4 is for Lou. They build it in their own Talia.')).toBe(
      'Vault 4 is for Lou',
    );
    expect(allocatedTitle(4, [], 'Vault 4 is for alex@example.com. They build it in their own Talia.')).toBe(
      'Vault 4 is for alex@example.com',
    );
    expect(allocatedTitle(4, [])).toBe('Vault 4 is for someone else');
    expect(allocatedTitle(null, [])).toBe('This vault is for someone else');
  });
  it('names the first slot nobody has built when the rest of the plan is theirs', () => {
    const e = ent({
      vaults_allocated: [
        { vault_number: 3, email: 'sam@example.com' },
        { vault_number: 2, email: 'alex@example.com', name: 'Alex Example', built: true },
      ],
    });
    expect(firstUnbuiltAssigned(e)?.vaultNumber).toBe(3);
    expect(firstUnbuiltAssigned(ent({}))).toBeNull();
  });
});

describe('the builder’s everyday keys', () => {
  it('are their own everyday keys: never ours, and an heir is never passed in', () => {
    const fps = builderEverydayFingerprints({
      userKeys: [{ fingerprint: '73C5DA0A' }, { fingerprint: 'a1b2c3d4' }],
      coSignerKey: { fingerprint: '0c21c051' },
      coSignerIsOwn: false,
      providerFps: ['0C21C051'],
    });
    expect(fps).toEqual(['73c5da0a', 'a1b2c3d4']);
  });

  it('a second key the builder holds themselves counts', () => {
    const fps = builderEverydayFingerprints({
      userKeys: [{ fingerprint: '73c5da0a' }],
      coSignerKey: { fingerprint: 'deadbeef' },
      coSignerIsOwn: true,
      providerFps: [],
    });
    expect(fps).toEqual(['73c5da0a', 'deadbeef']);
  });

  it('drops a key of ours even in a user slot, duplicates, and anything that is not 8 hex', () => {
    const fps = builderEverydayFingerprints({
      userKeys: [
        { fingerprint: '0c21c051' },
        { fingerprint: '73c5da0a' },
        { fingerprint: '73C5DA0A' },
        { fingerprint: 'xyz' },
        {},
      ],
      coSignerKey: null,
      coSignerIsOwn: true,
      providerFps: new Set(['0c21c051']),
    });
    expect(fps).toEqual(['73c5da0a']);
  });

  it('only lower-case 8 hex ever reaches the backend', () => {
    expect(cleanOwnerFingerprints(['73C5DA0A', ' a1b2c3d4 ', 'a1b2c3d4', '', null, undefined, '12345'])).toEqual([
      '73c5da0a',
      'a1b2c3d4',
    ]);
  });
});

describe('the same device in two people’s vaults', () => {
  it('reads the backend’s notice, and nothing from an older backend', () => {
    expect(parseSameDevice({ vault_number: 1, name: 'Toni' })).toEqual({ vaultNumber: 1, name: 'Toni' });
    expect(parseSameDevice(null)).toBeUndefined();
    expect(parseSameDevice(undefined)).toBeUndefined();
    expect(parseSameDevice('yes')).toBeUndefined();
    expect(parseSameDevice({})).toBeUndefined();
  });

});

describe('the claim itself', () => {
  const session = { accessToken: 't', email: 'alex@example.com' } as unknown as CompanySession;
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const answer = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });

  it('sends owner_fingerprints, cleaned, beside held_of', async () => {
    const f = answer(200, { vault_number: 2, account: 1002, held_of: 'toni@example.com' });
    global.fetch = f as unknown as typeof fetch;
    await fetchNextVaultKeys(session, 'mainnet', 2, undefined, 7, ['73C5DA0A', 'junk']);
    const sent = JSON.parse(f.mock.calls[0][1].body);
    expect(sent).toMatchObject({ network: 'mainnet', vault_number: 2, held_of: 7, owner_fingerprints: ['73c5da0a'] });
  });

  it('sends no owner_fingerprints key when there is none to send', async () => {
    const f = answer(200, { vault_number: 1 });
    global.fetch = f as unknown as typeof fetch;
    await fetchNextVaultKeys(session, 'mainnet');
    expect(JSON.parse(f.mock.calls[0][1].body)).not.toHaveProperty('owner_fingerprints');
  });

  it('reads same_device when the backend sends it, and tolerates its absence', async () => {
    global.fetch = answer(200, { vault_number: 2, same_device: { vault_number: 1, name: 'Toni' } }) as unknown as typeof fetch;
    expect((await fetchNextVaultKeys(session, 'mainnet')).sameDevice).toEqual({ vaultNumber: 1, name: 'Toni' });
    global.fetch = answer(200, { vault_number: 2, same_device: null }) as unknown as typeof fetch;
    expect((await fetchNextVaultKeys(session, 'mainnet')).sameDevice).toBeUndefined();
    global.fetch = answer(200, { vault_number: 2 }) as unknown as typeof fetch;
    expect((await fetchNextVaultKeys(session, 'mainnet')).sameDevice).toBeUndefined();
  });

  it('403 ALLOCATED is its own refusal and carries the vault number', async () => {
    global.fetch = answer(403, {
      error: 'ALLOCATED',
      message: 'Vault 2 is for Alex Example. They build it in their own Talia.',
      vault_number: 2,
    }) as unknown as typeof fetch;
    const err = await fetchNextVaultKeys(session, 'mainnet', 2).catch((e) => e);
    expect(err).toBeInstanceOf(VaultAllocatedError);
    expect(err.vaultNumber).toBe(2);
    expect(allocatedTitle(err.vaultNumber, [], err.message)).toBe('Vault 2 is for Alex Example');
  });
});

describe('the owner of an assigned vault is never sold anything (the builder screen)', () => {
  const screen = readFileSync(
    join(__dirname, '..', '..', 'ui', 'screens', 'LayeredVaultScreen.tsx'),
    'utf8',
  );

  it('keys in hand: no price and no checkout when somebody else pays', () => {
    expect(screen).toMatch(/const otherPays = heldOf != null \|\| !!issued\.heldOf;/);
    expect(screen).toMatch(/\(otherPays \|\| planActive \|\| !tier \|\| !PURCHASES_ENABLED\)/);
    // Both halves of the "Keys received" dialog: the price sentence and the
    // checkout button.
    expect(screen.match(/planActive \|\| !tier \|\| otherPays/g)?.length).toBe(2);
    expect(screen).not.toMatch(/\n\s*planActive \|\| !tier\n/);
  });

  it('no Elite step and no plan card on the way there', () => {
    expect(screen).toMatch(/!alreadyElite &&\n\s*!paidByOther &&/);
    expect(screen).toMatch(/\{tier && paidByOther \? \(/);
    expect(BUILDER_COPY.nothingToPay).not.toMatch(/your plan/i);
  });

  it('not in the plan: the title and the buttons alone, never the payer’s sentence', () => {
    expect(screen).toMatch(/message: heldOf != null \? '' : e\.message,/);
  });

  it('a claim that named a payer is remembered WITH the payer', () => {
    expect(screen).toMatch(/\.\.\.\(heldOf != null \? \{ heldOf \} : \{\}\),/);
    expect(screen).not.toMatch(/issued\.heldOf && heldOf != null/);
  });

  it('the keys of a vault already on this phone are never placed', () => {
    const backstop = screen.indexOf('issuedVaultIsOnThisPhone(issued, wallets)');
    expect(backstop).toBeGreaterThan(-1);
    expect(backstop).toBeLessThan(screen.indexOf('void savePendingClaim('));
    expect(backstop).toBeLessThan(screen.indexOf('setCoSignerKey(issued.coSigner)'));
  });
});

describe('the words', () => {
  it('no dash, and none of the retired words, in anything a client reads', () => {
    const words = [
      ...Object.values(BUILDER_COPY),
      firstRunTitle(2),
      assignedOptionLabel(
        { payerId: 1, payerEmail: 'toni@example.com', payerName: 'Toni', vaultNumber: 2, claimed: false },
        false,
      ),
      assignedOptionLabel(
        { payerId: 1, payerEmail: 'toni@example.com', payerName: 'Toni', vaultNumber: 2, claimed: false },
        true,
      ),
      allocatedTitle(2, []),
      allocatedTitle(null, []),
      alreadyOnPhoneTitle(2),
      alreadyOnPhoneTitle(null),
    ];
    for (const w of words) {
      expect(w).not.toMatch(/[\u2014\u2013]/);
      expect(w).not.toMatch(/\b(hold|holder|holds|held|leave|invitation)\b/i);
      expect(w).not.toMatch(/plan of/i);
    }
  });
});
