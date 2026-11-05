import {
  SYNC_PASSWORD_MIN,
  credentialNeedsRewrite,
  decodeSyncCredential,
  deriveSyncKey,
  encodeSyncCredential,
  mergeSyncStates,
  openSyncBlob,
  parseSyncState,
  sealSyncBlob,
  serializeSyncState,
  stateStamp,
  syncPasswordProblem,
} from '../vaultSync';
import type { SyncState, SyncVault } from '../vaultSync';
import { base64 } from '@scure/base';

function vault(id: string, updatedAt: number, label = id): SyncVault {
  return { id, label, entries: [], updatedAt };
}

let KEY: Uint8Array;
beforeAll(async () => {
  KEY = await deriveSyncKey('correct horse battery staple', 'owner@example.com');
});

describe('key derivation', () => {
  it('is deterministic and account-scoped', async () => {
    expect(await deriveSyncKey('pw', 'a@example.com')).toEqual(await deriveSyncKey('pw', 'a@example.com'));
    expect(await deriveSyncKey('pw', 'a@example.com')).not.toEqual(await deriveSyncKey('pw', 'b@example.org'));
    expect(await deriveSyncKey('pw', 'a@example.com')).not.toEqual(await deriveSyncKey('pw2', 'a@example.com'));
  });
  it('normalizes email case and password unicode form', async () => {
    expect(await deriveSyncKey('pw', 'A@EXAMPLE.com ')).toEqual(await deriveSyncKey('pw', 'a@example.com'));
    // é composed vs decomposed must derive the same key
    expect(await deriveSyncKey('café', 'a@example.com')).toEqual(await deriveSyncKey('café', 'a@example.com'));
  });
});

describe('seal / open', () => {
  it('round-trips', () => {
    const payload = serializeSyncState({ vaults: [vault('a', 5)], tombstones: [] });
    expect(openSyncBlob(KEY, sealSyncBlob(KEY, payload))).toBe(payload);
  });
  it('a wrong password refuses to decrypt with a readable message', async () => {
    const blob = sealSyncBlob(KEY, 'secret');
    const wrong = await deriveSyncKey('other password', 'owner@example.com');
    expect(() => openSyncBlob(wrong, blob)).toThrow(/Wrong sync password/);
  });
  it('tampered ciphertext is rejected (AEAD, not just scrambled)', () => {
    const blob = JSON.parse(sealSyncBlob(KEY, 'secret')) as { ct: string };
    const bytes = base64.decode(blob.ct);
    bytes[0] ^= 0xff;
    const tampered = JSON.stringify({ ...blob, ct: base64.encode(bytes) });
    expect(() => openSyncBlob(KEY, tampered)).toThrow(/Wrong sync password/);
  });
  it('unknown envelope versions ask for an app update instead of misreading', () => {
    expect(() => openSyncBlob(KEY, JSON.stringify({ v: 9, kdf: 'x', nonce: '', ct: '' }))).toThrow(
      /newer version/,
    );
  });
  it('fresh nonces: sealing twice never produces the same blob', () => {
    expect(sealSyncBlob(KEY, 'x')).not.toBe(sealSyncBlob(KEY, 'x'));
  });
});

describe('parseSyncState', () => {
  it('round-trips and drops malformed vaults', () => {
    const good = vault('a', 1);
    const json = JSON.stringify({ v: 1, vaults: [good, { id: 42 }], tombstones: [{ id: 'x', at: 3 }] });
    const state = parseSyncState(json);
    expect(state.vaults).toEqual([good]);
    expect(state.tombstones).toEqual([{ id: 'x', at: 3 }]);
  });
  it('rejects junk', () => {
    expect(() => parseSyncState('nope')).toThrow(/damaged/);
    expect(() => parseSyncState('{"v":2,"vaults":[]}')).toThrow(/damaged/);
  });
});

describe('mergeSyncStates', () => {
  const empty: SyncState = { vaults: [], tombstones: [] };

  it('identical states change nothing', () => {
    const s = { vaults: [vault('a', 5)], tombstones: [] };
    const r = mergeSyncStates(s, s);
    expect(r.localChanged).toBe(false);
    expect(r.remoteChanged).toBe(false);
  });

  it('newer vault wins per id; both sides keep their own-only vaults', () => {
    const local = { vaults: [vault('a', 5, 'old'), vault('b', 1)], tombstones: [] };
    const remote = { vaults: [vault('a', 9, 'new'), vault('c', 2)], tombstones: [] };
    const { merged, localChanged, remoteChanged } = mergeSyncStates(local, remote);
    expect(merged.vaults.map((v) => [v.id, v.label])).toEqual([
      ['a', 'new'],
      ['b', 'b'],
      ['c', 'c'],
    ]);
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('a tombstone deletes the vault on the other side', () => {
    const local = { vaults: [], tombstones: [{ id: 'a', at: 10 }] };
    const remote = { vaults: [vault('a', 5)], tombstones: [] };
    const { merged } = mergeSyncStates(local, remote);
    expect(merged.vaults).toEqual([]);
    expect(merged.tombstones).toEqual([{ id: 'a', at: 10 }]);
  });

  it('an edit AFTER the deletion resurrects the vault — typed data beats tidiness', () => {
    const local = { vaults: [], tombstones: [{ id: 'a', at: 10 }] };
    const remote = { vaults: [vault('a', 20, 'edited later')], tombstones: [] };
    const { merged } = mergeSyncStates(local, remote);
    expect(merged.vaults.map((v) => v.label)).toEqual(['edited later']);
    expect(merged.tombstones).toEqual([]); // the losing tombstone is dropped
  });

  it('merging with empty remote flags a push, not a local change', () => {
    const local = { vaults: [vault('a', 5)], tombstones: [] };
    const r = mergeSyncStates(local, empty);
    expect(r.localChanged).toBe(false);
    expect(r.remoteChanged).toBe(true);
  });
});

describe('per-entry merge (the review\'s critical: a rename must never take entries)', () => {
  const entry = (id: string, stamp: number): SyncVault['entries'][number] => ({
    id, kind: 'buy', amountSats: 1000, date: stamp, createdAt: stamp, updatedAt: stamp,
  });

  it('REGRESSION: a stale rename keeps the other phone\'s newer entries', () => {
    // Phone A added e2 on Tuesday (vault stamp 200). Phone B, stale since
    // Monday, renamed on Wednesday (vault stamp 300) with Monday's entries.
    const phoneA: SyncVault = { ...vault('x', 200), entries: [entry('e1', 100), entry('e2', 200)] };
    const phoneB: SyncVault = { ...vault('x', 300, 'renamed'), entries: [entry('e1', 100)] };
    const { merged } = mergeSyncStates(
      { vaults: [phoneA], tombstones: [] },
      { vaults: [phoneB], tombstones: [] },
    );
    expect(merged.vaults[0].label).toBe('renamed'); // the rename wins
    expect(merged.vaults[0].entries.map((e) => e.id)).toEqual(['e1', 'e2']); // the entries SURVIVE
  });

  it('entry edits are LWW on the entry\'s own stamp', () => {
    const a: SyncVault = { ...vault('x', 200), entries: [{ ...entry('e1', 100), note: 'old', updatedAt: 100 }] };
    const b: SyncVault = { ...vault('x', 150), entries: [{ ...entry('e1', 100), note: 'new', updatedAt: 400 }] };
    const { merged } = mergeSyncStates({ vaults: [a], tombstones: [] }, { vaults: [b], tombstones: [] });
    // b's VAULT stamp is older, but its ENTRY edit is newer — the entry wins.
    expect(merged.vaults[0].entries[0].note).toBe('new');
  });

  it('a deleted entry stays deleted across the merge', () => {
    const a: SyncVault = { ...vault('x', 300), entries: [], deletedEntries: [{ id: 'e1', at: 250 }] };
    const b: SyncVault = { ...vault('x', 200), entries: [entry('e1', 100)] };
    const { merged } = mergeSyncStates({ vaults: [a], tombstones: [] }, { vaults: [b], tombstones: [] });
    expect(merged.vaults[0].entries).toEqual([]);
    expect(merged.vaults[0].deletedEntries).toEqual([{ id: 'e1', at: 250 }]);
  });

  it('an entry edited AFTER its deletion is resurrected', () => {
    const a: SyncVault = { ...vault('x', 300), entries: [], deletedEntries: [{ id: 'e1', at: 250 }] };
    const b: SyncVault = { ...vault('x', 200), entries: [{ ...entry('e1', 100), updatedAt: 400 }] };
    const { merged } = mergeSyncStates({ vaults: [a], tombstones: [] }, { vaults: [b], tombstones: [] });
    expect(merged.vaults[0].entries.map((e) => e.id)).toEqual(['e1']);
    expect(merged.vaults[0].deletedEntries).toEqual([]);
  });

  it('keeps the price typed and the source through the account blob and the merge (decided 2026-10-22)', async () => {
    const rich = { ...entry('e1', 100), fiatAmount: 9_814.75, fiatCurrency: 'USD' as const, pricePerBtc: 79_500, source: 'bitvavo', sourceName: 'Bitvavo' };
    const local: SyncState = { vaults: [{ ...vault('x', 200), entries: [rich] }], tombstones: [] };
    // Sealed, sent, opened and parsed on the other phone, field for field.
    const remote = parseSyncState(openSyncBlob(KEY, sealSyncBlob(KEY, serializeSyncState(local))));
    expect(remote.vaults[0].entries[0]).toEqual(rich);
    // Merged with a phone that only knows another entry: nothing is lost.
    const other: SyncState = { vaults: [{ ...vault('x', 300), entries: [entry('e2', 150)] }], tombstones: [] };
    const { merged } = mergeSyncStates(remote, other);
    expect(merged.vaults[0].entries.find((e) => e.id === 'e1')).toEqual(rich);
    // An entry without them (an older phone's copy) never strips a newer edit.
    const older: SyncState = { vaults: [{ ...vault('x', 400), entries: [{ ...entry('e1', 100), updatedAt: 50 }] }], tombstones: [] };
    expect(mergeSyncStates(remote, older).merged.vaults[0].entries[0]).toEqual(rich);
  });
});

describe('sync credential envelope', () => {
  // Decided 2026-09-26: the Keychain item held the sync
  // PASSWORD beside the derived key. Only the key is ever written now.
  it('writes the derived key ALONE, never a password', () => {
    const enc = encodeSyncCredential({ keyB64: 'a2V5' });
    expect(JSON.parse(enc)).toEqual({ v: 2, keyB64: 'a2V5' });
    expect(enc).not.toMatch(/password/);
    expect(decodeSyncCredential(enc)).toEqual({ keyB64: 'a2V5' });
    expect(credentialNeedsRewrite(decodeSyncCredential(enc))).toBe(false);
  });
  it('an older v1 item (password + key) still reads, and is marked for a rewrite', () => {
    const v1 = JSON.stringify({ v: 1, password: 'pw', keyB64: 'a2V5' });
    const cred = decodeSyncCredential(v1);
    expect(cred).toEqual({ password: 'pw', keyB64: 'a2V5' });
    expect(credentialNeedsRewrite(cred)).toBe(true);
  });
  it('a LEGACY bare password decodes with no key — the migration trigger', () => {
    expect(decodeSyncCredential('just a password')).toEqual({ password: 'just a password' });
    expect(credentialNeedsRewrite(decodeSyncCredential('just a password'))).toBe(true);
  });
  it('a password that happens to BE valid JSON is still a legacy password', () => {
    const tricky = '{"not":"ours"}';
    expect(decodeSyncCredential(tricky).password).toBe(tricky);
  });
});

describe('syncPasswordProblem (decided 2026-09-26)', () => {
  it('refuses anything shorter than the minimum', () => {
    expect(SYNC_PASSWORD_MIN).toBeGreaterThanOrEqual(12);
    expect(syncPasswordProblem('Tr0ub4dor&3')).toMatch(/at least 12/);
  });
  it('refuses digits alone, repeats and well-known passwords, however long', () => {
    expect(syncPasswordProblem('123456789012')).not.toBeNull();
    expect(syncPasswordProblem('aaaaaaaaaaaaaaaa')).not.toBeNull();
    expect(syncPasswordProblem('abababababababab')).not.toBeNull();
    expect(syncPasswordProblem('Password123456')).not.toBeNull();
    expect(syncPasswordProblem('bitcoinbitcoin1')).not.toBeNull();
  });
  it('accepts a long passphrase', () => {
    expect(syncPasswordProblem('correct horse battery staple')).toBeNull();
    expect(syncPasswordProblem('Glasgow-tram-1987-lemon')).toBeNull();
  });
  it('never uses an em dash in what it says', () => {
    for (const pw of ['short', '123456789012', 'passwordpassword']) {
      expect(syncPasswordProblem(pw) ?? '').not.toMatch(/\u2014/);
    }
  });
});

describe('stateStamp', () => {
  it('is the newest stamp, rounded UP to the minute — order without precision', () => {
    expect(stateStamp({ vaults: [], tombstones: [] })).toBe(60_000);
    expect(stateStamp({ vaults: [vault('a', 7)], tombstones: [{ id: 'b', at: 9 }] })).toBe(60_000);
    expect(
      stateStamp({ vaults: [vault('a', 25 * 60_000 + 1)], tombstones: [] }),
    ).toBe(26 * 60_000);
  });
});
