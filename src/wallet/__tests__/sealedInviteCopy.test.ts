/**
 * Found in a phone test on 2026-09-22: an heir whose key has NO timelock was told the vault stays
 * sealed "until its waiting period ends". Only a countdown invite has one.
 */
import { claimedMessage, notReleasedLine, sealedCardLine } from '../sealedInviteCopy';
import type { SealedInviteFacts } from '../sealedInviteCopy';

const NOW = Date.parse('2026-09-22T12:00:00Z');
const facts = (over: Partial<SealedInviteFacts>): SealedInviteFacts => ({
  access: 'key',
  mode: 'full',
  vaultLabel: '2/3 family',
  releaseAt: null,
  ...over,
});

describe('an heir key with no timelock (the phone test of 2026-09-22)', () => {
  const f = facts({ access: 'key', mode: 'full' });

  it('says sealed until opened with the key, and nothing about waiting', () => {
    expect(claimedMessage(f)).toBe(
      'You are named on "2/3 family". The vault appears sealed on your home screen until you open it with your key.',
    );
    expect(sealedCardLine(f, NOW)).toBe('Heir · open it with your key');
    expect(notReleasedLine(f, NOW)).toBe('Checking whether your vault is ready to open.');
    for (const s of [claimedMessage(f), sealedCardLine(f, NOW), notReleasedLine(f, NOW)]) {
      expect(s).not.toMatch(/waiting|timelock|opens in/i);
    }
  });
});

describe('a timelocked heir key keeps its countdown', () => {
  // Decided 2026-09-22: the release comes at the vault's FIRST heir waiting
  // period, which with several heirs may not be this heir's own.
  it('names the first waiting period for an heir, never "its"', () => {
    expect(claimedMessage(facts({ mode: 'strict' }))).toBe(
      'You are named on "2/3 family". The vault appears sealed on your home screen until the first waiting period for an heir ends; opening it then also needs your key.',
    );
    expect(claimedMessage(facts({ mode: 'strict', access: 'code' }))).toMatch(
      /opens by itself when the first waiting period for an heir ends\.$/,
    );
    const due = facts({ mode: 'strict', releaseAt: new Date(NOW - 60 * 1000).toISOString() });
    expect(notReleasedLine(due, NOW)).toBe(
      'The first waiting period for an heir has ended. Checking for the release.',
    );
    for (const s of [
      claimedMessage(facts({ mode: 'strict' })),
      claimedMessage(facts({ mode: 'strict', access: 'code' })),
      notReleasedLine(due, NOW),
    ]) {
      expect(s).not.toMatch(/its waiting period|The waiting period/);
    }
  });

  it('counts down on the home card and the claim screen', () => {
    const f = facts({ mode: 'strict', releaseAt: new Date(NOW + 30 * 24 * 3600 * 1000).toISOString() });
    expect(sealedCardLine(f, NOW)).toMatch(/^Heir · opens in \u2248 /);
    expect(notReleasedLine(f, NOW)).toMatch(/^The vault opens to you in \u2248 /);
    expect(sealedCardLine(facts({ mode: 'strict' }), NOW)).toBe('Heir · waiting for release');
  });
});

it('never an em dash', () => {
  const all = [
    claimedMessage(facts({})),
    claimedMessage(facts({ access: 'code' })),
    claimedMessage(facts({ mode: 'strict' })),
    claimedMessage(facts({ mode: 'strict', access: 'code' })),
    notReleasedLine(facts({ mode: 'strict', releaseAt: new Date(NOW).toISOString() }), NOW),
  ].join(' ');
  expect(all).not.toMatch(/[—–]/);
});
