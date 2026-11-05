/**
 * The Estate Plan wizard files for the vault the client tapped.
 *
 * Found in a phone test (2026-09-24): "No matter which vault I click, it seems to select the
 * first vault which is still missing an estate plan. So if I click vault 4,
 * it shows vault 2 to be selected because vault 2 is still missing the plan.
 * Please just choose the vault that the user selects."
 *
 * Two things had to be true at once for that to happen, and both are fixed:
 * the named account was applied only when the backend's list already carried
 * it, and the chip list was intersected with the vaults THIS PHONE holds, so
 * a vault kept on another device was invisible and the fallback filled in.
 */

/** The wizard's own rule, stated once so the test can hold it. */
function chosenAccount(opts: {
  /** The account the wizard was opened for, if any. */
  wanted?: number;
  /** Accounts the backend offers, with whether each already has a plan. */
  offered: Array<{ account: number; hasPlan: boolean }>;
}): number | undefined {
  if (opts.wanted != null) return opts.wanted;
  const remaining = opts.offered.filter((a) => !a.hasPlan);
  return remaining.length === 1 ? remaining[0].account : undefined;
}

/** Which chips are drawn, given the phone's own vaults. */
function chips(opts: {
  chosen?: number;
  offered: Array<{ account: number; hasPlan: boolean }>;
  onThisPhone: number[];
}): number[] {
  const offered = opts.offered
    .filter((a) => !a.hasPlan || a.account === opts.chosen)
    .map((a) => a.account);
  const rows = opts.onThisPhone.filter((a) => offered.includes(a));
  if (opts.chosen != null && !rows.includes(opts.chosen)) rows.unshift(opts.chosen);
  return rows;
}

const OFFERED = [
  { account: 1011, hasPlan: false },
  { account: 1012, hasPlan: false },
  { account: 1015, hasPlan: false },
];

/** Whether step 1 says anything about which vault, and what. */
function scopeCard(opts: {
  /** The wizard was opened FROM a vault. */
  openedForAVault: boolean;
  /** How many vaults the client has with us. */
  vaults: number;
  /** The server has answered. */
  loaded: boolean;
}): 'asks' | 'states' | 'nothing' {
  if (!opts.openedForAVault) return 'asks';
  return opts.vaults > 1 ? 'states' : 'nothing';
}

describe('what step 1 says about which vault', () => {
  it('never asks when the wizard was opened from a vault', () => {
    // Including before the server answers: the route already knows, and
    // waiting drew the question for half a second and then replaced it.
    expect(scopeCard({ openedForAVault: true, vaults: 3, loaded: false })).toBe('states');
    expect(scopeCard({ openedForAVault: true, vaults: 3, loaded: true })).toBe('states');
  });

  it('says nothing at all when the client has one vault', () => {
    expect(scopeCard({ openedForAVault: true, vaults: 1, loaded: true })).toBe('nothing');
    expect(scopeCard({ openedForAVault: true, vaults: 1, loaded: false })).toBe('nothing');
  });

  it('asks only where nobody has already answered', () => {
    expect(scopeCard({ openedForAVault: false, vaults: 3, loaded: true })).toBe('asks');
  });
});

describe('which vault the wizard files for', () => {
  it('is the one the client tapped, not the first without a plan', () => {
    expect(chosenAccount({ wanted: 1015, offered: OFFERED })).toBe(1015);
  });

  it('is the tapped one even when that vault already has a plan', () => {
    // Staff reopen a filed plan; the hub sends the client back to it.
    const offered = [{ account: 1011, hasPlan: false }, { account: 1012, hasPlan: true }];
    expect(chosenAccount({ wanted: 1012, offered })).toBe(1012);
  });

  it('falls back only when the client named no vault at all', () => {
    expect(chosenAccount({ offered: [{ account: 1011, hasPlan: false }] })).toBe(1011);
    expect(chosenAccount({ offered: OFFERED })).toBeUndefined();
  });

  it('shows the tapped vault even when this phone does not hold it', () => {
    // The exact shape of the bug from the phone test: only vault 1012 is on the phone, so the
    // chip list showed that one alone and the form read as having chosen it.
    expect(chips({ chosen: 1015, offered: OFFERED, onThisPhone: [1012] })).toEqual([1015, 1012]);
  });

  it('does not draw the tapped vault twice when the phone holds it', () => {
    expect(chips({ chosen: 1012, offered: OFFERED, onThisPhone: [1012] })).toEqual([1012]);
  });

  it('keeps a vault with a plan out of the list unless it is the chosen one', () => {
    const offered = [{ account: 1011, hasPlan: true }, { account: 1012, hasPlan: false }];
    expect(chips({ offered, onThisPhone: [1011, 1012] })).toEqual([1012]);
    expect(chips({ chosen: 1011, offered, onThisPhone: [1011, 1012] })).toEqual([1011, 1012]);
  });
});

/**
 * The plan starts with a name the client can keep or change (decided 2026-09-25:
 * "Estate Plan for <Vault Name from the app>").
 */
function startingName(opts: {
  typed?: string;
  vaultIsKnown: boolean;
  vaultName: string;
  alreadyNamed?: boolean;
}): string | null {
  if (opts.alreadyNamed || (opts.typed ?? '').trim()) return null; // leave it alone
  if (!opts.vaultIsKnown || opts.vaultName === 'this vault') return null;
  return `Estate Plan for ${opts.vaultName}`;
}

describe('the name a plan starts with', () => {
  it('names the vault it is for', () => {
    expect(startingName({ vaultIsKnown: true, vaultName: 'My multitest20' })).toBe(
      'Estate Plan for My multitest20',
    );
    expect(startingName({ vaultIsKnown: true, vaultName: 'Vault 3' })).toBe('Estate Plan for Vault 3');
  });

  it('never writes over a name the client typed', () => {
    expect(startingName({ typed: 'My own title', vaultIsKnown: true, vaultName: 'Vault 3' })).toBeNull();
    // Nor over one a plan being amended already carries.
    expect(startingName({ alreadyNamed: true, vaultIsKnown: true, vaultName: 'Vault 3' })).toBeNull();
  });

  it('writes nothing while the vault has no name to give', () => {
    expect(startingName({ vaultIsKnown: false, vaultName: 'Vault 3' })).toBeNull();
    expect(startingName({ vaultIsKnown: true, vaultName: 'this vault' })).toBeNull();
  });
});
