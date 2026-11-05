/**
 * Heirs are named as people (decided 2026-09-21: the invite email read "Hello
 * test bitbox,", the label of the heir's key).
 */
import {
  filedPlanHeirs,
  heirTitle,
  inviteGreeting,
  inviteHeirName,
  inviteNeedsPlanFirst,
  withFiledNames,
} from '../heirNames';

// An app-filed plan: each heir carries the key's fingerprint, uppercase.
const appPlan = {
  id: 7,
  heirs: [
    { firstName: 'Toni', lastName: 'Example', email: 'toni@example.com', keyLabel: 'test bitbox', keyFingerprint: '4A290600' },
    { firstName: 'Robin', lastName: 'Example', email: '', keyLabel: 'No Key Access', keyFingerprint: '', substituteFor: 'Toni Example' },
    { firstName: 'Leo', lastName: 'Keyless', email: 'Leo@Example.com', keyLabel: 'No Key Access', keyFingerprint: '' },
  ],
};

// A website-filed plan: heirs name only the key's label.
const webPlan = {
  id: 3,
  heirs: [{ firstName: 'Mara', lastName: 'Web', email: 'mara@example.com', keyLabel: 'Trezor' }],
  hardware_wallet_labels: ['Ledger', 'Trezor'],
  key_fingerprints: { all: [], hardware: ['11111111', '2222AAAA'] },
};

describe('reading the filed plans', () => {
  it('names each heir and finds the key they hold, app or website plan', () => {
    const filed = filedPlanHeirs([appPlan, webPlan]);
    expect(filed).toEqual([
      { name: 'Toni Example', fingerprint: '4a290600', email: 'toni@example.com', standIn: false },
      { name: 'Robin Example', fingerprint: '', email: '', standIn: true },
      { name: 'Leo Keyless', fingerprint: '', email: 'leo@example.com', standIn: false },
      { name: 'Mara Web', fingerprint: '2222aaaa', email: 'mara@example.com', standIn: false },
    ]);
  });

  it('prefers the key register over the hardware list for a label', () => {
    const plan = {
      heirs: [{ firstName: 'Ria', lastName: 'R', keyLabel: 'Coldkey' }],
      hardware_wallet_labels: ['Coldkey'],
      key_fingerprints: { all: [{ label: 'coldkey', fingerprint: 'ABCDEF01' }], hardware: ['99999999'] },
    };
    expect(filedPlanHeirs([plan])[0].fingerprint).toBe('abcdef01');
  });

  it('survives anything unexpected', () => {
    expect(filedPlanHeirs(undefined)).toEqual([]);
    expect(filedPlanHeirs([null, 5, { heirs: 'x' }, { heirs: [null, { firstName: '' }] }])).toEqual([]);
  });
});

describe('putting the names onto the vault', () => {
  const filed = filedPlanHeirs([appPlan, webPlan]);

  it('names a keyed heir by the key, a keyless one by the address', () => {
    const { heirs, changed } = withFiledNames(
      [
        { id: 'a', fingerprint: '4a290600' },
        { id: 'b', email: 'leo@example.com' },
        { id: 'c', fingerprint: '2222aaaa' },
      ],
      filed,
    );
    expect(changed).toBe(true);
    expect(heirs.map((h) => h.name)).toEqual(['Toni Example', 'Leo Keyless', 'Mara Web']);
  });

  it('never names a keyed heir by an address alone', () => {
    // Same address as Toni, different key: not Toni.
    const { heirs } = withFiledNames([{ fingerprint: 'ffffffff', email: 'toni@example.com' }], filed);
    expect(heirs[0].name).toBeUndefined();
  });

  it('keeps a name the vault already holds, and reports no change', () => {
    const existing = [{ id: 'a', name: 'Toni E.', fingerprint: '4a290600' }];
    const { heirs, changed } = withFiledNames(existing, filed);
    expect(changed).toBe(false);
    expect(heirs).toEqual(existing);
  });

  it('gives a shared key to the heir, not the stand-in', () => {
    const shared = filedPlanHeirs([
      { heirs: [
        { firstName: 'Robin', lastName: 'X', keyFingerprint: 'AABBCCDD', substituteFor: 'Toni X' },
        { firstName: 'Toni', lastName: 'X', keyFingerprint: 'AABBCCDD' },
      ] },
    ]);
    expect(withFiledNames([{ fingerprint: 'aabbccdd' }], shared).heirs[0].name).toBe('Toni X');
  });
});

describe('what the owner and the heir read', () => {
  it('greets the person, or nobody in particular', () => {
    expect(inviteGreeting('Toni Example')).toBe('Hello Toni Example,');
    expect(inviteGreeting('')).toBe('Hello,');
    expect(inviteGreeting(undefined)).toBe('Hello,');
  });

  it('titles a row by the name, else "Heir 2"', () => {
    expect(heirTitle({ name: 'Toni Example' }, 0)).toBe('Toni Example');
    expect(heirTitle({}, 1)).toBe('Heir 2');
  });

  it('names an invite already sent through its heir, never by a key label', () => {
    const heirs = [{ id: 'h1', name: 'Toni Example', fingerprint: '4a290600', email: 'toni@example.com' }];
    const keyLabels = { '4a290600': 'test bitbox' };
    const inv = { id: 'i1', heirLabel: 'test bitbox', heirEmail: 'toni@example.com' };
    // Through this phone's record of the invite.
    expect(inviteHeirName(inv, [{ inviteId: 'i1', heirFingerprint: '4a290600' }], heirs, keyLabels)).toBe('Toni Example');
    // Through the address when this phone has no record.
    expect(inviteHeirName(inv, [], heirs, keyLabels)).toBe('Toni Example');
    // Nothing names them: the address, never the key's label.
    expect(inviteHeirName(inv, [], [], keyLabels)).toBe('toni@example.com');
    expect(inviteHeirName({ ...inv, heirEmail: '' }, [], [], keyLabels)).toBe('Your heir');
    // A label that is a real name (sent after the fix) is shown as it is.
    expect(inviteHeirName({ id: 'i2', heirLabel: 'Leo Keyless', heirEmail: '' }, [], [], keyLabels)).toBe('Leo Keyless');
  });
});

describe('no screen names an heir after their key', () => {
  it('the invite and Estate Plan screens build no heir name from keyLabels', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path') as typeof import('path');
    for (const f of ['InviteHeirScreen.tsx', 'InheritanceScreen.tsx']) {
      const src = readFileSync(join(__dirname, '..', '..', 'ui', 'screens', f), 'utf8');
      expect({ f, hit: /name:\s*\([^)]*keyLabels/.test(src) }).toEqual({ f, hit: false });
      expect({ f, hello: /Hello \$\{heir\.name\}/.test(src) }).toEqual({ f, hello: false });
    }
  });

  it('the end of vault setup opens the Estate Plan, not the invites', () => {
    // Decided 2026-09-21: invites go out only after the plan names the heirs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path') as typeof import('path');
    const src = readFileSync(join(__dirname, '..', '..', 'ui', 'screens', 'RegisterVaultScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/['"]InviteHeir['"]/);
    expect(src).toMatch(/replace\('InheritanceSetup'/);
  });
});

describe('the vault menu opens the Estate Plan first (decided 2026-09-21)', () => {
  const filed = filedPlanHeirs([appPlan]);

  it('opens the plan while no plan names the vault\'s heirs', () => {
    expect(inviteNeedsPlanFirst([{ id: 'h', fingerprint: 'deadbeef' }], filed, false)).toBe(true);
    expect(inviteNeedsPlanFirst([{ id: 'h' }], [], false)).toBe(true);
  });

  it('opens the invites once a plan names them, here or on the server', () => {
    expect(inviteNeedsPlanFirst([{ id: 'h', name: 'Toni Example' }], [], false)).toBe(false);
    expect(inviteNeedsPlanFirst([{ id: 'h', fingerprint: '4a290600' }], filed, false)).toBe(false);
  });

  it('opens the invites when this vault already has a plan', () => {
    expect(inviteNeedsPlanFirst([{ id: 'h', fingerprint: 'deadbeef' }], [], true)).toBe(false);
  });
});
