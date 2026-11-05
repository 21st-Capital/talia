import { mergePlanHeirsIntoVault, usableEmail, type PlanHeir, type VaultHeir } from '../planHeirs';

let seq = 0;
const newId = (): string => `new-${++seq}`;
beforeEach(() => {
  seq = 0;
});

const draft = (over: Partial<PlanHeir> = {}): PlanHeir => ({
  firstName: 'Mara',
  lastName: 'Kestrel',
  email: '',
  keyFingerprint: '',
  ...over,
});

describe('the bug that was reported', () => {
  // Two heirs in the plan: one the vault already knew, one typed during the
  // submission. Only the first was ever offered an invite.
  const known: VaultHeir = { id: 'v1', email: 'ben@example.com' };
  const drafts = [
    draft({ heirId: 'v1', firstName: 'Ben', lastName: 'Example', email: 'ben@example.com' }),
    draft({ firstName: 'Leo', lastName: 'Zomo', email: 'leo@example.com' }),
  ];

  it('adds the heir who existed only in the plan', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault([known], drafts, newId);
    expect(changed).toBe(true);
    expect(heirs).toHaveLength(2);
    expect(heirs[1]).toEqual({ id: 'new-1', name: 'Leo Zomo', email: 'leo@example.com' });
  });

  it('does not duplicate the heir the vault already knew', () => {
    const { heirs } = mergePlanHeirsIntoVault([known], drafts, newId);
    expect(heirs.filter((h) => h.email === 'ben@example.com')).toHaveLength(1);
  });

  it('still works when the vault has no heirs recorded at all', () => {
    // The old loop skipped such a vault outright, losing every named heir.
    const { heirs, changed } = mergePlanHeirsIntoVault([], drafts, newId);
    expect(changed).toBe(true);
    expect(heirs.map((h) => h.email)).toEqual(['ben@example.com', 'leo@example.com']);
  });
});

describe('matching an existing entry', () => {
  it('matches a keyed heir by fingerprint, case-insensitively', () => {
    const existing: VaultHeir[] = [{ fingerprint: 'aabbccdd' }];
    const { heirs } = mergePlanHeirsIntoVault(
      existing,
      [draft({ keyFingerprint: 'AABBCCDD', email: 'mara@example.com' })],
      newId,
    );
    expect(heirs).toHaveLength(1);
    expect(heirs[0].email).toBe('mara@example.com');
  });

  it('matches a keyless heir by creation id', () => {
    const { heirs } = mergePlanHeirsIntoVault(
      [{ id: 'v9' }],
      [draft({ heirId: 'v9', email: 'mara@example.com' })],
      newId,
    );
    expect(heirs).toEqual([{ id: 'v9', name: 'Mara Kestrel', email: 'mara@example.com' }]);
  });

  it('matches by email when there is no key and no id', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ name: 'Mara Kestrel', email: 'Mara@Example.com' }],
      [draft({ email: 'mara@example.com' })],
      newId,
    );
    expect(heirs).toHaveLength(1);
    expect(changed).toBe(false); // already had the address
  });

  it('gives one draft to at most one entry', () => {
    // Two vault entries sharing a key must not both swallow the same draft.
    const existing: VaultHeir[] = [{ fingerprint: 'aabbccdd' }, { fingerprint: 'aabbccdd' }];
    const { heirs } = mergePlanHeirsIntoVault(
      existing,
      [draft({ keyFingerprint: 'aabbccdd', email: 'mara@example.com' })],
      newId,
    );
    expect(heirs[0].email).toBe('mara@example.com');
    expect(heirs[1].email).toBeUndefined();
  });
});

describe('addresses', () => {
  it('never overwrites an address the vault already holds', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ id: 'v1', name: 'Mara Kestrel', email: 'old@example.com' }],
      [draft({ heirId: 'v1', email: 'new@example.com' })],
      newId,
    );
    expect(heirs[0].email).toBe('old@example.com');
    expect(changed).toBe(false);
  });

  it('never writes a blank over a stored address', () => {
    const { heirs } = mergePlanHeirsIntoVault(
      [{ id: 'v1', email: 'kept@example.com' }],
      [draft({ heirId: 'v1', email: '' })],
      newId,
    );
    expect(heirs[0].email).toBe('kept@example.com');
  });

  it('ignores an address that is not a complete one', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ id: 'v1', name: 'Mara Kestrel' }],
      [draft({ heirId: 'v1', email: 'mara@' })],
      newId,
    );
    expect(heirs[0].email).toBeUndefined();
    expect(changed).toBe(false);
  });

  it('adds a child with no address at all, so they reach the invite list', () => {
    // Decided 2026-08-30: kids too young to have an email must still be nameable,
    // and must still show up where invites are sent from.
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [],
      [draft({ firstName: 'Mara', lastName: 'K', email: '' })],
      newId,
    );
    expect(changed).toBe(true);
    expect(heirs).toEqual([{ id: 'new-1', name: 'Mara K' }]);
  });
});

describe('carrying the key the plan says they hold', () => {
  // The key is what makes an invite key-sealed instead of code-only, so
  // losing it silently weakens the protection on that person's inheritance.
  const VAULT_KEYS = new Set(['aabbccdd', 'deadbeef']);

  it('gives a newly named heir the key the plan recorded', () => {
    const { heirs } = mergePlanHeirsIntoVault(
      [],
      [draft({ firstName: 'Mara', lastName: 'K', keyFingerprint: 'AABBCCDD' })],
      newId,
      VAULT_KEYS,
    );
    expect(heirs[0].fingerprint).toBe('aabbccdd');
  });

  it('upgrades a keyless entry that the plan says now holds a key', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ id: 'v1', email: 'mara@example.com' }],
      [draft({ heirId: 'v1', keyFingerprint: 'aabbccdd' })],
      newId,
      VAULT_KEYS,
    );
    expect(heirs[0].fingerprint).toBe('aabbccdd');
    expect(changed).toBe(true);
  });

  it('IGNORES a key this vault does not contain', () => {
    // InviteHeirScreen refuses such a fingerprint with "Key not found", so
    // storing it would create an heir whose invite cannot be made at all.
    // One plan covers several vaults and a key may belong to only one.
    const { heirs } = mergePlanHeirsIntoVault(
      [],
      [draft({ firstName: 'Mara', lastName: 'K', keyFingerprint: 'ffffffff' })],
      newId,
      VAULT_KEYS,
    );
    expect(heirs[0].fingerprint).toBeUndefined();
  });

  it('adds no key when the caller names none, which is the safe default', () => {
    const { heirs } = mergePlanHeirsIntoVault(
      [],
      [draft({ firstName: 'Mara', lastName: 'K', keyFingerprint: 'aabbccdd' })],
      newId,
    );
    expect(heirs[0].fingerprint).toBeUndefined();
  });

  it('never replaces a key the vault already recorded', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ name: 'Mara Kestrel', fingerprint: 'deadbeef' }],
      [draft({ keyFingerprint: 'deadbeef' })],
      newId,
      VAULT_KEYS,
    );
    expect(heirs[0].fingerprint).toBe('deadbeef');
    expect(changed).toBe(false);
  });
});

describe('what must not be added', () => {
  it('ignores an empty heir slot', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [],
      [draft({ firstName: '', lastName: '', email: '' })],
      newId,
    );
    expect(heirs).toEqual([]);
    expect(changed).toBe(false);
  });

  it('reports no change when the plan tells the vault nothing new', () => {
    const existing: VaultHeir[] = [{ id: 'v1', name: 'Ben Example', email: 'ben@example.com' }];
    const { heirs, changed } = mergePlanHeirsIntoVault(
      existing,
      [draft({ heirId: 'v1', firstName: 'Ben', lastName: 'Example', email: 'ben@example.com' })],
      newId,
    );
    expect(changed).toBe(false);
    expect(heirs).toEqual(existing);
  });

  it('is idempotent: filing the same plan twice adds nobody twice', () => {
    const drafts = [draft({ firstName: 'Leo', lastName: 'Zomo', email: 'leo@example.com' })];
    const first = mergePlanHeirsIntoVault([], drafts, newId);
    // Second run: the heir is now on the vault and the draft is seeded with
    // its id, exactly as knownHeirs would rebuild it.
    const seeded = [{ ...drafts[0], heirId: first.heirs[0].id }];
    const second = mergePlanHeirsIntoVault(first.heirs, seeded, newId);
    expect(second.heirs).toHaveLength(1);
    expect(second.changed).toBe(false);
  });

  it('is idempotent even when the draft lost its id, matching on email', () => {
    const drafts = [draft({ firstName: 'Leo', lastName: 'Zomo', email: 'leo@example.com' })];
    const first = mergePlanHeirsIntoVault([], drafts, newId);
    const second = mergePlanHeirsIntoVault(first.heirs, drafts, newId);
    expect(second.heirs).toHaveLength(1);
  });

  it('keeps an existing keyed entry untouched when no draft matches it', () => {
    const existing: VaultHeir[] = [{ fingerprint: 'deadbeef', months: 12 }];
    const { heirs } = mergePlanHeirsIntoVault(existing, [], newId);
    expect(heirs).toEqual(existing);
  });
});

describe('names (decided 2026-09-21: the invite greeted "Hello test bitbox,")', () => {
  it('gives a matched keyed heir the plan\'s name, never the key\'s label', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ id: 'v1', fingerprint: '4a290600', months: 12 }],
      [draft({ firstName: 'Toni', lastName: 'Example', keyFingerprint: '4A290600' })],
      newId,
    );
    expect(changed).toBe(true);
    expect(heirs[0]).toEqual({ id: 'v1', name: 'Toni Example', fingerprint: '4a290600', months: 12 });
  });

  it('takes a corrected spelling from a re-filing', () => {
    const { heirs, changed } = mergePlanHeirsIntoVault(
      [{ id: 'v1', name: 'Ana Example' }],
      [draft({ heirId: 'v1', firstName: 'Toni', lastName: 'Example' })],
      newId,
    );
    expect(changed).toBe(true);
    expect(heirs[0].name).toBe('Toni Example');
  });

  it('gives a shared key to the heir, not the person standing in for them', () => {
    const { heirs } = mergePlanHeirsIntoVault(
      [{ id: 'v1', fingerprint: 'aabbccdd' }],
      [
        draft({ firstName: 'Robin', lastName: 'Example', keyFingerprint: 'aabbccdd', substituteFor: 'u1' }),
        draft({ firstName: 'Toni', lastName: 'Example', keyFingerprint: 'aabbccdd' }),
      ],
      newId,
      new Set(['aabbccdd']),
    );
    expect(heirs[0].name).toBe('Toni Example');
    expect(heirs[1].name).toBe('Robin Example');
  });
});

describe('usableEmail', () => {
  it.each(['a@example.org', ' a@example.org '])('accepts %s', (v) => expect(usableEmail(v)).toBe(true));
  it.each(['', '   ', 'a@b', 'a b@example.org', undefined])('rejects %s', (v) =>
    expect(usableEmail(v)).toBe(false),
  );
});
