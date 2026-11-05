import { isProviderRescuePath, pathStillShut } from '../policyPathState';

const OURS = new Set(['cc000008', '49578625']);
const isProviderKey = (fp?: string) => !!fp && OURS.has(fp.toLowerCase());

const primary = {
  groups: [{ keys: [{ fingerprint: 'abf931aa' }, { fingerprint: 'cc000005' }, { fingerprint: '49578625' }] }],
};
const ourRescue = { olderBlocks: 3, groups: [{ keys: [{ fingerprint: 'cc000008' }] }] };
const heirPath = {
  olderBlocks: 52596,
  groups: [{ keys: [{ fingerprint: 'deadbeef' }, { fingerprint: '49578625' }] }],
};

describe('a path is grey while its clock runs, whoever holds the keys', () => {
  it('the everyday path is never grey', () => {
    expect(pathStillShut(primary, { 3: 0 })).toBe(false);
  });

  it('an HEIR path greys exactly like ours (decided 2026-09-23)', () => {
    expect(pathStillShut(heirPath, { 52596: 900 })).toBe(true);
    expect(pathStillShut(ourRescue, { 3: 2 })).toBe(true);
  });

  it('once open, it reads like any other path', () => {
    expect(pathStillShut(heirPath, { 52596: 0 })).toBe(false);
    expect(pathStillShut(ourRescue, { 3: -5 })).toBe(false);
  });

  it('no clock started yet is still shut, and so is not knowing', () => {
    expect(pathStillShut(ourRescue, { 3: null })).toBe(true);
    expect(pathStillShut(ourRescue, undefined)).toBe(true);
    expect(pathStillShut(ourRescue, {})).toBe(true);
  });
});

describe('only OUR rescue path offers to ask us for a rescue', () => {
  it('a timelocked path of 21st Capital keys alone is ours', () => {
    expect(isProviderRescuePath(ourRescue, isProviderKey)).toBe(true);
  });

  it("an heir's recovery path is not, even with our key beside theirs", () => {
    expect(isProviderRescuePath(heirPath, isProviderKey)).toBe(false);
  });

  it('the everyday path is not, however many of our keys it holds', () => {
    expect(isProviderRescuePath(primary, isProviderKey)).toBe(false);
    expect(isProviderRescuePath({ groups: [{ keys: [{ fingerprint: '49578625' }] }] }, isProviderKey)).toBe(false);
  });

  it('a path with no keys at all is nobody’s', () => {
    expect(isProviderRescuePath({ olderBlocks: 3, groups: [] }, isProviderKey)).toBe(false);
    expect(isProviderRescuePath({ olderBlocks: 3, groups: [{ keys: [] }] }, isProviderKey)).toBe(false);
  });
});
