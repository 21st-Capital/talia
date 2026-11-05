/**
 * The engine report tells builds apart by when each install first ran
 * (decided 2026-10-28): iOS puts every build of an app in a new bundle
 * container, so a new bundle path is a new build. The path stays on the
 * phone; the report gets a date.
 */
import { installSince, REPORT_INSTALL_KEY } from '../reportInstall';

function storage(failing = false) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => {
      if (failing) throw new Error('no storage');
      return m.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      if (failing) throw new Error('no storage');
      m.set(k, v);
    },
  };
}

const A = '/var/containers/Bundle/Application/1111/KeelWallet.app';
const B = '/var/containers/Bundle/Application/2222/KeelWallet.app';
const T1 = new Date('2026-10-28T08:00:00.000Z');
const T2 = new Date('2026-10-29T09:30:00.000Z');

describe('when this install first ran', () => {
  it('stays the same for every launch of one install, and is new for the next build', async () => {
    const s = storage();
    expect(await installSince(s, A, T1)).toBe(T1.toISOString());
    expect(await installSince(s, A, T2)).toBe(T1.toISOString());
    expect(await installSince(s, B, T2)).toBe(T2.toISOString());
    expect(await installSince(s, B, new Date('2026-11-01T00:00:00.000Z'))).toBe(T2.toISOString());
    // The path is kept on the phone, beside the date.
    expect(JSON.parse(s.m.get(REPORT_INSTALL_KEY)!)).toEqual({ bundle: B, since: T2.toISOString() });
  });

  it('is unknown with no bundle path or no storage, and a stored value that is not a date starts over', async () => {
    expect(await installSince(storage(), undefined, T1)).toBeUndefined();
    expect(await installSince(storage(), '', T1)).toBeUndefined();
    expect(await installSince(storage(true), A, T1)).toBeUndefined();
    const s = storage();
    s.m.set(REPORT_INSTALL_KEY, JSON.stringify({ bundle: A, since: 'yesterday' }));
    expect(await installSince(s, A, T1)).toBe(T1.toISOString());
    s.m.set(REPORT_INSTALL_KEY, 'not json');
    expect(await installSince(s, A, T2)).toBe(T2.toISOString());
  });
});
