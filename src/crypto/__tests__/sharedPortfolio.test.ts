/**
 * The shared-portfolio crypto is a privacy boundary: the card must open only
 * with the code, the key must never sit in the clear anywhere the server can
 * see, the shared blob must never be confused with the account blob, and two
 * members editing at once must converge through the SAME merge the account
 * loop uses (a rename never takes entries; tombstones stick; a later edit
 * wins).
 */
import { base64 } from '@scure/base';

import { generateInviteCode, normalizeInviteCode } from '../envelope';
import {
  sharedSyncPlan,
  formatPortfolioInviteCode,
  isPortfolioInviteCode,
  newPortfolioInviteCode,
  newShareId,
  newShareKey,
  normalizePortfolioInviteCode,
  openPortfolioCard,
  openSharedVault,
  portfolioLookupHash,
  portfolioLookupToken,
  sameSharedVault,
  sealPortfolioCard,
  sealSharedVault,
  sharedStamp,
} from '../sharedPortfolio';
import { RANDOM_KEY_ID, mergeVault, openSyncBlob, sealSyncBlob } from '../vaultSync';
import type { SyncVault } from '../vaultSync';

const CODE = 'TALIA-P-ABCDE-FGH1J-K2MNP-QRSTV';

function entry(id: string, stamp: number, extra: Partial<SyncVault['entries'][number]> = {}) {
  return { id, kind: 'buy' as const, amountSats: 1000, date: stamp, createdAt: stamp, updatedAt: stamp, ...extra };
}

function vault(id: string, updatedAt: number, entries: SyncVault['entries'] = [], label = id): SyncVault {
  return { id, label, entries, updatedAt };
}

describe('keys and ids', () => {
  it('a share key is 32 fresh random bytes', () => {
    const a = newShareKey();
    const b = newShareKey();
    expect(a).toHaveLength(32);
    expect(base64.encode(a)).not.toBe(base64.encode(b));
  });
  it('a share id is a v4 UUID, fresh every time', () => {
    const id = newShareId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newShareId()).not.toBe(id);
  });
});

describe('portfolio invite codes', () => {
  it('a fresh code has the TALIA-P shape', () => {
    expect(newPortfolioInviteCode()).toMatch(/^TALIA-P(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    expect(newPortfolioInviteCode()).not.toBe(newPortfolioInviteCode());
  });
  it('accepts the ways people type it', () => {
    const canonical = normalizePortfolioInviteCode(CODE);
    expect(canonical).toBe('ABCDEFGH1JK2MNPQRSTV');
    expect(normalizePortfolioInviteCode('talia-p-abcde-fgh1j-k2mnp-qrstv')).toBe(canonical);
    expect(normalizePortfolioInviteCode('talia p abcde fghIj k2mnp qrstv')).toBe(canonical);
    expect(normalizePortfolioInviteCode('  TALIAPABCDEFGHlJK2MNPQRSTV ')).toBe(canonical);
    expect(normalizePortfolioInviteCode('P-ABCDE-FGH1J-K2MNP-QRSTV')).toBe(canonical);
    expect(normalizePortfolioInviteCode('TALIA-P-ABCDE-FGH1J-K2MNP-QRSTO')).toBe(canonical!.slice(0, 19) + '0');
    expect(isPortfolioInviteCode(CODE)).toBe(true);
  });
  it('a plain heir code is NOT a portfolio code, even when its body starts with P', () => {
    expect(isPortfolioInviteCode(generateInviteCode())).toBe(false);
    expect(isPortfolioInviteCode('TALIA-PBCDE-FGH1J-K2MNP-QRSTV')).toBe(false);
    expect(normalizePortfolioInviteCode('ABCDEFGH1JK2MNPQRSTV')).toBeNull();
    expect(normalizePortfolioInviteCode('')).toBeNull();
    expect(normalizePortfolioInviteCode('TALIA-P-ABCDE-FGH1J-K2MNP-QRSTU')).toBeNull(); // U is not Crockford
    expect(normalizePortfolioInviteCode('TALIA-P-ABCDE-FGH1J-K2MNP-QRST')).toBeNull(); // short
  });
  it('and a portfolio code is not an heir code either', () => {
    expect(normalizeInviteCode(CODE)).toBeNull();
  });
  it('formats from a body or any variant, never from an heir code', () => {
    expect(formatPortfolioInviteCode('ABCDEFGH1JK2MNPQRSTV')).toBe(CODE);
    expect(formatPortfolioInviteCode('talia p abcde fgh1j k2mnp qrstv')).toBe(CODE);
    expect(() => formatPortfolioInviteCode('TALIA-ABCDE-FGH1J-K2MNP-QRSTV')).toThrow(/invite code/);
  });
  it('lookup token and hash are stable, code-shaped, and hash = sha256(token)', () => {
    const token = portfolioLookupToken(CODE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(portfolioLookupToken('talia p abcde fgh1j k2mnp qrstv')).toBe(token);
    expect(portfolioLookupHash(CODE)).toMatch(/^[0-9a-f]{64}$/);
    expect(portfolioLookupHash(CODE)).not.toBe(token);
    expect(portfolioLookupHash(newPortfolioInviteCode())).not.toBe(portfolioLookupHash(CODE));
  });
});

describe('the sealed card', () => {
  const key = newShareKey();
  const input = {
    shareId: newShareId(),
    portfolioId: 'w_abc',
    label: 'Family stack',
    icon: 'coins',
    ownerName: 'Alice Example',
    key,
  };

  it('round-trips under the code', () => {
    const sealed = sealPortfolioCard(CODE, input);
    const card = openPortfolioCard('talia p abcde fgh1j k2mnp qrstv', sealed);
    expect(card.shareId).toBe(input.shareId);
    expect(card.portfolioId).toBe('w_abc');
    expect(card.label).toBe('Family stack');
    expect(card.icon).toBe('coins');
    expect(card.ownerName).toBe('Alice Example');
    expect(base64.encode(card.key)).toBe(base64.encode(key));
  });
  it('a wrong code refuses with a plain message', () => {
    const sealed = sealPortfolioCard(CODE, input);
    expect(() => openPortfolioCard(newPortfolioInviteCode(), sealed)).toThrow(/does not open the invite/);
  });
  it('the key never appears in the clear in the sealed card', () => {
    const sealed = sealPortfolioCard(CODE, input);
    const raw = base64.decode(sealed);
    const keyB64 = base64.encode(key);
    expect(sealed).not.toContain(keyB64);
    expect(sealed).not.toContain('Family stack');
    // Neither the base64 text nor the raw bytes carry the key.
    const rawStr = Array.from(raw, (b) => String.fromCharCode(b)).join('');
    const keyStr = Array.from(key, (b) => String.fromCharCode(b)).join('');
    expect(rawStr).not.toContain(keyStr);
    expect(rawStr).not.toContain('portfolio');
  });
  it('a card of another kind, or a damaged one, is refused', () => {
    expect(() => openPortfolioCard(CODE, 'not base64!!')).toThrow();
    expect(() => openPortfolioCard(CODE, base64.encode(new Uint8Array(10)))).toThrow();
  });
  it('sealing twice never produces the same ciphertext (fresh nonce)', () => {
    expect(sealPortfolioCard(CODE, input)).not.toBe(sealPortfolioCard(CODE, input));
  });
  it('refuses a key of the wrong size', () => {
    expect(() => sealPortfolioCard(CODE, { ...input, key: new Uint8Array(16) })).toThrow(/32 bytes/);
  });
});

describe('the shared blob', () => {
  const key = newShareKey();
  const v = vault('w_abc', 5_000, [entry('e1', 1_000), entry('e2', 2_000)], 'Family stack');

  it('round-trips', () => {
    const blob = sealSharedVault(key, v);
    expect(openSharedVault(key, blob)).toEqual({ ...v, deletedEntries: undefined });
  });
  it('carries the random-key tag, not the scrypt one', () => {
    const doc = JSON.parse(sealSharedVault(key, v)) as { kdf: string; v: number };
    expect(doc.kdf).toBe(RANDOM_KEY_ID);
    expect(doc.v).toBe(1);
  });
  it('the scrypt-tagged account envelope refuses a random-key blob, and the reverse', () => {
    const shared = sealSharedVault(key, v);
    expect(() => openSyncBlob(key, shared)).toThrow(/not sealed for this kind of key/);
    const account = sealSyncBlob(key, JSON.stringify({ v: 1, vault: v }));
    expect(() => openSharedVault(key, account)).toThrow(/not sealed for this kind of key/);
  });
  it('a wrong key refuses with a plain message', () => {
    const blob = sealSharedVault(key, v);
    expect(() => openSharedVault(newShareKey(), blob)).toThrow(/could not be opened/);
  });
  it('a payload that is not one vault is damaged', () => {
    const blob = sealSyncBlob(key, JSON.stringify({ v: 1, vault: { id: 3 } }), RANDOM_KEY_ID);
    expect(() => openSharedVault(key, blob)).toThrow(/damaged/);
    const blob2 = sealSyncBlob(key, 'junk', RANDOM_KEY_ID);
    expect(() => openSharedVault(key, blob2)).toThrow(/damaged/);
  });
  it('pads to a bucket so the size reveals only the scale', () => {
    const small = JSON.parse(sealSharedVault(key, vault('w', 1))) as { ct: string };
    const bigger = JSON.parse(sealSharedVault(key, v)) as { ct: string };
    expect(small.ct.length).toBe(bigger.ct.length);
  });
});

describe('who may change a shared portfolio (sharedSyncPlan)', () => {
  it('a member takes the owner\'s copy verbatim and never pushes', () => {
    // Her own entry is not merged in: it would show a balance the owner
    // never recorded, and it could never reach anyone else (decided 2026-09-14).
    const hers = vault('p', 900, [entry('mine', 900), entry('shared', 100)]);
    const owners = vault('p', 500, [entry('shared', 100), entry('bobs', 400)]);
    const plan = sharedSyncPlan(true, hers, owners);
    expect(plan.needPush).toBe(false);
    expect(plan.merged).toBe(owners);
    expect(plan.merged.entries.map((e) => e.id)).toEqual(['shared', 'bobs']);
  });

  it('a member mirrors the owner deleting an entry, and their rename', () => {
    const hers = vault('p', 100, [entry('gone', 100), entry('kept', 100)]);
    const owners: SyncVault = {
      ...vault('p', 700, [entry('kept', 100)]),
      label: 'Bob\'s plan',
      deletedEntries: [{ id: 'gone', at: 700 }],
    };
    const plan = sharedSyncPlan(true, hers, owners);
    expect(plan.merged.entries.map((e) => e.id)).toEqual(['kept']);
    expect(plan.merged.label).toBe('Bob\'s plan');
    expect(plan.needPush).toBe(false);
  });

  it('a member with nothing of their own still mirrors, and still pushes nothing', () => {
    const owners = vault('p', 500, [entry('bobs', 400)]);
    expect(sharedSyncPlan(true, vault('p', 1, []), owners)).toEqual({ merged: owners, needPush: false });
  });

  it('the owner merges both copies and pushes when the result differs', () => {
    const mine = vault('p', 900, [entry('mine', 900)]);
    const server = vault('p', 500, [entry('theirs', 400)]);
    const plan = sharedSyncPlan(false, mine, server);
    expect(plan.merged.entries.map((e) => e.id)).toEqual(['theirs', 'mine']);
    expect(plan.needPush).toBe(true);
  });

  it('the owner pushes nothing when the server already holds everything', () => {
    const same = vault('p', 500, [entry('e1', 100)]);
    expect(sharedSyncPlan(false, same, same).needPush).toBe(false);
  });
});

describe('merge across two members (through the reused mergeVault)', () => {
  it('union: each member sees the other member\'s entries', () => {
    const toni = vault('p', 100, [entry('a1', 100)]);
    const ben = vault('p', 120, [entry('b1', 120)]);
    const merged = mergeVault(toni, ben);
    expect(merged.entries.map((e) => e.id)).toEqual(['a1', 'b1']);
    expect(sameSharedVault(merged, toni)).toBe(false);
    expect(sameSharedVault(merged, ben)).toBe(false);
  });
  it('LWW per entry: the later edit of the same entry wins regardless of vault stamp', () => {
    const toni = vault('p', 500, [entry('e1', 100, { note: 'toni', updatedAt: 200 })]);
    const ben = vault('p', 300, [entry('e1', 100, { note: 'ben', updatedAt: 400 })]);
    expect(mergeVault(toni, ben).entries[0].note).toBe('ben');
    expect(mergeVault(ben, toni).entries[0].note).toBe('ben');
  });
  it('a rename by one member never takes the other member\'s entries', () => {
    const toni = vault('p', 200, [entry('e1', 100), entry('e2', 200)]);
    const ben: SyncVault = { ...vault('p', 300, [entry('e1', 100)]), label: 'renamed' };
    const merged = mergeVault(toni, ben);
    expect(merged.label).toBe('renamed');
    expect(merged.entries.map((e) => e.id)).toEqual(['e1', 'e2']);
  });
  it('a tombstone deletes the entry for the other member and sticks', () => {
    const toni: SyncVault = { ...vault('p', 300, []), deletedEntries: [{ id: 'e1', at: 250 }] };
    const ben = vault('p', 200, [entry('e1', 100)]);
    const merged = mergeVault(toni, ben);
    expect(merged.entries).toEqual([]);
    expect(merged.deletedEntries).toEqual([{ id: 'e1', at: 250 }]);
    // A second round with the tombstone on both sides changes nothing.
    expect(sameSharedVault(mergeVault(merged, merged), merged)).toBe(true);
  });
  it('an edit AFTER the deletion resurrects the entry', () => {
    const toni: SyncVault = { ...vault('p', 300, []), deletedEntries: [{ id: 'e1', at: 250 }] };
    const ben = vault('p', 200, [entry('e1', 100, { updatedAt: 400 })]);
    const merged = mergeVault(toni, ben);
    expect(merged.entries.map((e) => e.id)).toEqual(['e1']);
    expect(merged.deletedEntries).toEqual([]);
  });
  it('sameSharedVault ignores key order and entry order', () => {
    const a = vault('p', 1, [entry('x', 1), entry('y', 2)]);
    const b: SyncVault = { updatedAt: 1, entries: [entry('y', 2), entry('x', 1)], label: 'p', id: 'p' };
    expect(sameSharedVault(a, b)).toBe(true);
  });
});

describe('sharedStamp', () => {
  it('is the newest stamp in the vault, rounded up to the minute', () => {
    expect(sharedStamp(vault('p', 7))).toBe(60_000);
    expect(sharedStamp(vault('p', 60_000))).toBe(60_000);
    expect(sharedStamp(vault('p', 1, [entry('e', 25 * 60_000 + 1)]))).toBe(26 * 60_000);
    expect(
      sharedStamp({ ...vault('p', 1), deletedEntries: [{ id: 'e', at: 3 * 60_000 + 5 }] }),
    ).toBe(4 * 60_000);
  });
});

describe('the price typed and the source travel with the entry (decided 2026-10-22)', () => {
  const rich = entry('e1', 1_000, {
    fiatAmount: 9_814.75,
    fiatCurrency: 'USD',
    pricePerBtc: 79_500,
    source: 'other',
    sourceName: 'Bitcoin ATM',
  });

  it('through the shared blob', () => {
    const key = newShareKey();
    const opened = openSharedVault(key, sealSharedVault(key, vault('w', 5_000, [rich])));
    expect(opened.entries[0]).toEqual(rich);
  });

  it('to a member, who mirrors the owner', () => {
    const owners = vault('w', 5_000, [rich]);
    expect(sharedSyncPlan(true, vault('w', 1, []), owners).merged.entries[0]).toEqual(rich);
  });

  it('through the owner\'s merge, and a later edit that took them off wins', () => {
    const plain = entry('e1', 2_000, { fiatAmount: 9_814.75, fiatCurrency: 'USD' });
    expect(mergeVault(vault('w', 1, [rich]), vault('w', 1, [entry('e2', 500)])).entries.find((e) => e.id === 'e1')).toEqual(rich);
    expect(mergeVault(vault('w', 1, [rich]), vault('w', 1, [plain])).entries[0]).toEqual(plain);
  });
});
