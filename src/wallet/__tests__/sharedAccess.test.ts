import { EDITABLE_EXPORT_ACTIONS, isSharedViewer, mayExportEditableCopy } from '../sharedAccess';
import type { WalletMeta } from '../types';

const share = (patch: Partial<NonNullable<WalletMeta['sharedPortfolio']>>) =>
  ({ sharedPortfolio: { shareId: 's1', role: 'member', since: 1, ...patch } }) as Pick<
    WalletMeta,
    'sharedPortfolio'
  >;

describe('isSharedViewer', () => {
  it('is true for a portfolio this phone joined by invite', () => {
    expect(isSharedViewer(share({ role: 'member' }))).toBe(true);
  });

  it('is false for the owner, who is the only one who may change it', () => {
    expect(isSharedViewer(share({ role: 'owner' }))).toBe(false);
  });

  it('is false once sharing has ended: the copy is the member’s own again', () => {
    expect(isSharedViewer(share({ role: 'member', ended: 'stopped' }))).toBe(false);
    expect(isSharedViewer(share({ role: 'member', ended: 'removed' }))).toBe(false);
  });

  it('is false for a portfolio that was never shared', () => {
    expect(isSharedViewer({})).toBe(false);
    expect(isSharedViewer(undefined)).toBe(false);
    expect(isSharedViewer(null)).toBe(false);
  });
});

describe('mayExportEditableCopy', () => {
  it('refuses a member: that file re-imports as an editable portfolio and would outlive the share', () => {
    expect(mayExportEditableCopy(share({ role: 'member' }))).toBe(false);
  });

  it('allows the owner', () => {
    expect(mayExportEditableCopy(share({ role: 'owner' }))).toBe(true);
  });

  it('allows a portfolio that was never shared', () => {
    expect(mayExportEditableCopy({})).toBe(true);
    expect(mayExportEditableCopy(undefined)).toBe(true);
  });

  it('covers only the two formats that re-import, never the account statement', () => {
    expect([...EDITABLE_EXPORT_ACTIONS].sort()).toEqual(['backup', 'qr']);
    expect(EDITABLE_EXPORT_ACTIONS.has('statement')).toBe(false);
    expect(EDITABLE_EXPORT_ACTIONS.has('exportMenu')).toBe(false);
  });
});
