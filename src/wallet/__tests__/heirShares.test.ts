import {
  heirsInPool,
  pruneSubstitutes,
  remainingFor,
  shareIssues,
  substituteCandidates,
  type ShareHeir,
} from '../heirShares';

const heir = (over: Partial<ShareHeir> & { uid: string }): ShareHeir => ({
  name: `Heir ${over.uid}`,
  percentage: 0,
  substituteForUid: '',
  ...over,
});

/** The common case: everything to the spouse, the children stand in for her. */
const spousePlan = (): ShareHeir[] => [
  heir({ uid: 'a', name: 'Toni', percentage: 100 }),
  heir({ uid: 'b', name: 'Mara', percentage: 50, substituteForUid: 'a' }),
  heir({ uid: 'c', name: 'Leo', percentage: 50, substituteForUid: 'a' }),
];

describe('pools', () => {
  it('separates the estate from a stand-in group', () => {
    const heirs = spousePlan();
    expect(heirsInPool(heirs, '').map((h) => h.uid)).toEqual(['a']);
    expect(heirsInPool(heirs, 'a').map((h) => h.uid)).toEqual(['b', 'c']);
  });

  it('does NOT count stand-ins against the estate', () => {
    // The bug this whole module exists for: with the children counted against
    // the estate there was 0% left and the form could not be completed.
    const heirs = spousePlan();
    expect(remainingFor(heirs, 'a')).toBe(100);
  });

  it('caps a stand-in by what the other stand-ins leave', () => {
    const heirs = spousePlan();
    expect(remainingFor(heirs, 'b')).toBe(50); // c already holds 50
    expect(remainingFor(heirs, 'c')).toBe(50);
  });

  it('leaves a second direct heir only what the first did not take', () => {
    const heirs = [heir({ uid: 'a', percentage: 70 }), heir({ uid: 'b', percentage: 0 })];
    expect(remainingFor(heirs, 'b')).toBe(30);
  });

  it('never returns a negative remainder', () => {
    const heirs = [heir({ uid: 'a', percentage: 100 }), heir({ uid: 'b', percentage: 40 })];
    expect(remainingFor(heirs, 'b')).toBe(0);
  });

  it('treats an unknown uid as a fresh full pool', () => {
    expect(remainingFor(spousePlan(), 'nobody')).toBe(100);
  });
});

describe('substituteCandidates', () => {
  it('offers only named direct heirs ahead of this one', () => {
    const heirs = [
      heir({ uid: 'a', name: 'Toni' }),
      heir({ uid: 'b', name: '' }), // not described yet
      heir({ uid: 'c', name: 'Mara', substituteForUid: 'a' }),
      heir({ uid: 'd', name: 'Leo' }),
    ];
    expect(substituteCandidates(heirs, 3).map((h) => h.uid)).toEqual(['a']);
  });

  it('offers nothing to the first heir', () => {
    expect(substituteCandidates(spousePlan(), 0)).toEqual([]);
  });
});

describe('pruneSubstitutes', () => {
  it('clears a link whose target was removed', () => {
    const heirs = [heir({ uid: 'b', name: 'Mara', substituteForUid: 'a' })];
    expect(pruneSubstitutes(heirs)[0].substituteForUid).toBe('');
  });

  it('clears a link to someone who became a stand-in (no chains)', () => {
    const heirs = [
      heir({ uid: 'a', name: 'Toni' }),
      heir({ uid: 'b', name: 'Mara', substituteForUid: 'a' }),
      heir({ uid: 'c', name: 'Leo', substituteForUid: 'b' }),
    ];
    const out = pruneSubstitutes(heirs);
    expect(out[1].substituteForUid).toBe('a'); // still valid
    expect(out[2].substituteForUid).toBe('');
  });

  it('returns the same array when every link is sound', () => {
    const heirs = spousePlan();
    expect(pruneSubstitutes(heirs)).toBe(heirs);
  });
});

describe('shareIssues', () => {
  it('is silent on a complete plan', () => {
    expect(shareIssues(spousePlan())).toEqual([]);
  });

  it('is silent on an untouched form', () => {
    expect(shareIssues([heir({ uid: 'a', name: '' })])).toEqual([]);
  });

  it('reports an estate that does not add up', () => {
    const issues = shareIssues([
      heir({ uid: 'a', name: 'Toni', percentage: 60 }),
      heir({ uid: 'b', name: 'Mara', percentage: 30 }),
    ]);
    expect(issues.map((i) => i.kind)).toEqual(['estateTotal']);
    expect(issues[0].message).toContain('10%');
  });

  it('reports a stand-in group that does not add up, by name', () => {
    const heirs = spousePlan();
    heirs[2].percentage = 30;
    const issues = shareIssues(heirs);
    expect(issues.map((i) => i.kind)).toEqual(['standInTotal']);
    expect(issues[0].message).toContain('Toni');
    expect(issues[0].message).toContain('80%');
  });

  it('does not confuse a stand-in group with the estate total', () => {
    // Both pools are complete; neither should be reported.
    expect(shareIssues(spousePlan())).toEqual([]);
  });

  it('names anyone left inheriting nothing', () => {
    const issues = shareIssues([
      heir({ uid: 'a', name: 'Toni', percentage: 100 }),
      heir({ uid: 'b', name: 'Mara', percentage: 0 }),
    ]);
    expect(issues.some((i) => i.kind === 'noShare' && i.message.includes('Mara'))).toBe(true);
  });

  it('never uses an em dash: clients read these', () => {
    const heirs = spousePlan();
    heirs[0].percentage = 40;
    heirs[2].percentage = 10;
    heirs.push(heir({ uid: 'd', name: 'Zero', percentage: 0 }));
    const messages = shareIssues(heirs).map((i) => i.message);
    expect(messages.length).toBeGreaterThan(2);
    for (const m of messages) expect(m).not.toMatch(/[—–]/);
  });
});
