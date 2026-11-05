/**
 * Decided 2026-09-26: two Keychain items (the
 * portfolio-sync credential, with the sync PASSWORD in it, and the BitBox
 * pairing key) were written with react-native-keychain's default class,
 * which travels in a device backup, because their call sites forgot the
 * option. Every write now goes through services/keychain.ts, which has no
 * way to leave it out; this suite holds the line.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
import { deleteSecret, getSecret, getSecretStrict, setSecret } from '../keychain';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'testing' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('one door to the Keychain', () => {
  it('no source file but services/keychain.ts imports react-native-keychain', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(join('services', 'keychain.ts')))
      .filter((f) => /from 'react-native-keychain'|require\('react-native-keychain'\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('no source file calls setGenericPassword directly', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(join('services', 'keychain.ts')))
      .filter((f) => /setGenericPassword\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe('services/keychain', () => {
  beforeEach(() => mem.__reset());

  it('writes this-device-only, readable while unlocked, by default', async () => {
    await setSecret('svc', 'user', 'value');
    expect(mem.__items().get('svc')?.options.accessible).toBe('AccessibleWhenUnlockedThisDeviceOnly');
  });

  it("'background' is still this-device-only", async () => {
    await setSecret('svc', 'user', 'value', 'background');
    expect(mem.__items().get('svc')?.options.accessible).toBe('AccessibleAfterFirstUnlockThisDeviceOnly');
  });

  it('never writes a backup-migratable class', async () => {
    await setSecret('a', 'u', 'v');
    await setSecret('b', 'u', 'v', 'background');
    for (const item of mem.__items().values()) {
      expect(String(item.options.accessible)).toMatch(/ThisDeviceOnly$/);
    }
  });

  it('tells a miss (null) from a Keychain that cannot answer (throw)', async () => {
    expect(await getSecretStrict('nothing')).toBeNull();
    await setSecret('svc', 'u', 'v');
    mem.__failNextRead();
    await expect(getSecretStrict('svc')).rejects.toThrow();
    mem.__failNextRead();
    expect(await getSecret('svc')).toBeNull();
    expect(await getSecret('svc')).toBe('v');
    await deleteSecret('svc');
    expect(await getSecret('svc')).toBeNull();
  });
});
