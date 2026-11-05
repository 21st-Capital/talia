import { pathTitle } from '../policyTitles';
import type { PolicyPath } from '../../../bitcoin/descriptor';

const path = (extra: Partial<PolicyPath> = {}): PolicyPath => ({ groups: [], ...extra } as PolicyPath);

describe('policy card titles (decided 2026-09-21)', () => {
  it('calls the only path of a plain vault its spending policy', () => {
    const only = path();
    expect(pathTitle(only, [only])).toBe('Spending policy');
  });

  it('keeps primary and recovery paths for a layered vault', () => {
    const primary = path();
    const rescue = path({ olderBlocks: 1000 });
    expect(pathTitle(primary, [primary, rescue])).toBe('Primary path');
    expect(pathTitle(rescue, [primary, rescue])).toBe('Recovery path');
    const heir = path({ olderBlocks: 2000 });
    expect(pathTitle(heir, [primary, rescue, heir])).toBe('Recovery path 2');
  });
});
