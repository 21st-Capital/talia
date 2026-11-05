/**
 * Decided 2026-09-26: platform/icloud.ts "lit up
 * automatically" once a native ICloudKVS module was linked, and addWallet and
 * upgradeDescriptor then uploaded every vault's descriptor to iCloud
 * key-value storage in the clear. The path is gone; this keeps it gone. A
 * cloud backup, if it ever returns, is an explicit per-vault choice that
 * uploads only the sealed backup, and it gets a design of its own.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');
const IOS = join(__dirname, '..', '..', '..', 'ios', 'KeelWallet');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...files(full, ext));
    } else if (ext.test(name)) out.push(full);
  }
  return out;
}

describe('no automatic cloud copy of a descriptor', () => {
  it('the iCloud key-value module is not in the app', () => {
    expect(existsSync(join(SRC, 'platform', 'icloud.ts'))).toBe(false);
    const offenders = files(SRC, /\.(ts|tsx)$/)
      .filter((f) => /ICloudKVS|NSUbiquitousKeyValueStore|saveVaultBackup/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the app does not carry the iCloud key-value entitlement or native code', () => {
    if (!existsSync(IOS)) return;
    const offenders = files(IOS, /\.(m|mm|swift|entitlements|plist)$/)
      .filter((f) => /ubiquity-kvstore|NSUbiquitousKeyValueStore/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(IOS, f));
    expect(offenders).toEqual([]);
  });
});
