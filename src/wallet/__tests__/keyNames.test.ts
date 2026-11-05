/**
 * What the keys of an imported vault are called (decided 2026-09-26): Key 1, Key 2,
 * never a question about which fingerprint is which device, and never a bare
 * fingerprint on the screens that fall back to one.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { defaultKeyNames, isDefaultKeyName, keyDisplayName, keyNameTemplate, registrationAsksKeyName } from '../keyNames';

const SCREENS = join(__dirname, '..', '..', 'ui', 'screens');

const A = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
const B = 'tpubDCDuqEgbT3rnSzcJZC94rWJqBUyVbEgigqW9NkNkzyLYQCsNbTJVEWuLNfYzRe4EGkMK9ARxBDeHfxecFFrBAztDsZLYNiBB1uD86ZLpuXn';
/** C is derived from BIP-32 test vector 3's seed at m/48'/1'/0'/2'. */
const C = 'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';
const key = (fp: string, xpub: string) => `[${fp}/48'/1'/0'/2']${xpub}/<0;1>/*`;
const TRIO = `wsh(sortedmulti(2,${key('73c5da0a', A)},${key('aabbccdd', B)},${key('21c0c051', C)}))`;

describe('the names an import gives the keys', () => {
  it('numbers the client\'s keys in the descriptor\'s order', () => {
    expect(defaultKeyNames(TRIO)).toEqual({
      '73c5da0a': 'Key 1',
      aabbccdd: 'Key 2',
      '21c0c051': 'Key 3',
    });
  });

  it('never numbers a key of ours: those name themselves by their role', () => {
    expect(defaultKeyNames(TRIO, { providerFps: new Set(['21c0c051']) })).toEqual({
      '73c5da0a': 'Key 1',
      aabbccdd: 'Key 2',
    });
  });

  it('takes the provider check as the predicate the policy screens hold', () => {
    expect(defaultKeyNames(TRIO, { providerFps: (fp) => fp === '21c0c051' })).toEqual({
      '73c5da0a': 'Key 1',
      aabbccdd: 'Key 2',
    });
  });

  it('keeps a name the source file already carried, and keeps its POSITION', () => {
    // A Sparrow export names its keystores after the devices; another Talia
    // carries the owner's own names. Both beat a number, and the named key
    // still holds slot 1, so naming one key never renumbers the others
    // (decided 2026-09-26).
    expect(
      defaultKeyNames(TRIO, {
        providerFps: ['21C0C051'],
        known: { '73c5da0a': 'BitBox of Toni' },
      }),
    ).toEqual({ aabbccdd: 'Key 2' });
  });

  it('gives a key the same number before and after a sibling is renamed', () => {
    const before = defaultKeyNames(TRIO, { providerFps: ['21c0c051'] });
    const after = defaultKeyNames(TRIO, {
      providerFps: ['21c0c051'],
      known: { '73c5da0a': 'Office' },
    });
    expect(before.aabbccdd).toBe('Key 2');
    expect(after.aabbccdd).toBe('Key 2');
  });

  it('ignores an empty name that was stored', () => {
    expect(
      defaultKeyNames(TRIO, { providerFps: ['21c0c051'], known: { '73c5da0a': '  ' } }),
    ).toEqual({ '73c5da0a': 'Key 1', aabbccdd: 'Key 2' });
  });

  it('leaves a ONE-key vault unnumbered: its own name identifies its key', () => {
    // The Sign screen shows the vault's name for a single-key vault with no
    // key label (decided 2026-07-19), and a number would replace it with nothing
    // anybody needs. The device names that key at registration instead.
    expect(defaultKeyNames(`wpkh([73c5da0a/84'/1'/0']${A}/<0;1>/*)`)).toEqual({});
  });

  it('says nothing about a descriptor it cannot read, or a key with no fingerprint', () => {
    expect(defaultKeyNames('not a descriptor')).toEqual({});
    expect(defaultKeyNames(undefined)).toEqual({});
    expect(defaultKeyNames(`wpkh(${A}/<0;1>/*)`)).toEqual({});
  });
});

describe('a name Talia gave itself', () => {
  it('knows its own numbering', () => {
    expect(isDefaultKeyName('Key 1')).toBe(true);
    expect(isDefaultKeyName('key 12')).toBe(true);
    expect(isDefaultKeyName(' Key 3 ')).toBe(true);
  });

  it('never claims a name a person chose', () => {
    expect(isDefaultKeyName('Key of Toni')).toBe(false);
    expect(isDefaultKeyName('Nano X')).toBe(false);
    expect(isDefaultKeyName('Key')).toBe(false);
    expect(isDefaultKeyName('')).toBe(false);
    expect(isDefaultKeyName(undefined)).toBe(false);
  });
});

describe('the name a registration offers', () => {
  it('offers the device its own name when the key is still a number', () => {
    expect(keyNameTemplate('Key 2', 'Nano X of Toni')).toBe('Nano X of Toni');
  });

  it('keeps a name the owner chose', () => {
    expect(keyNameTemplate('Toni\'s BitBox', 'BitBox02')).toBe('Toni\'s BitBox');
  });

  it('falls back to what the key has when the device has no name', () => {
    expect(keyNameTemplate('Key 2', '')).toBe('Key 2');
    expect(keyNameTemplate('Key 2', undefined)).toBe('Key 2');
  });

  it('never offers an empty field for a key with no name at all', () => {
    expect(keyNameTemplate(undefined, 'Ledger')).toBe('Ledger');
    expect(keyNameTemplate('', '')).toBe('');
  });
});

/**
 * The answer for a vault imported BEFORE the names existed, which is most of
 * them: five screens ask this instead of printing a fingerprint.
 */
describe('the name a screen shows', () => {
  const old = { descriptor: TRIO };
  const ours = ['21c0c051'];

  it('numbers a vault that carries no names at all', () => {
    expect(keyDisplayName(old, '73c5da0a', ours)).toBe('Key 1');
    expect(keyDisplayName(old, 'aabbccdd', ours)).toBe('Key 2');
  });

  it('says nothing for a key of ours: the caller names it by its holder', () => {
    expect(keyDisplayName(old, '21c0c051', ours)).toBeNull();
  });

  it('prefers the name the vault carries', () => {
    expect(
      keyDisplayName({ descriptor: TRIO, keyLabels: { '73c5da0a': 'Nano X of Toni' } }, '73c5da0a', ours),
    ).toBe('Nano X of Toni');
  });

  it('reads a fingerprint in any case, and trims what it stores', () => {
    expect(keyDisplayName({ descriptor: TRIO, keyLabels: { aabbccdd: '  Office  ' } }, 'AABBCCDD', ours)).toBe(
      'Office',
    );
  });

  it('gives the same answer whichever way the caller names our keys', () => {
    expect(keyDisplayName(old, 'aabbccdd', new Set(ours))).toBe('Key 2');
    expect(keyDisplayName(old, 'aabbccdd', (fp) => fp === '21c0c051')).toBe('Key 2');
  });

  it('says nothing about a key that is not in the vault, or no vault at all', () => {
    expect(keyDisplayName(old, 'ffffffff', ours)).toBeNull();
    expect(keyDisplayName(old, undefined, ours)).toBeNull();
    expect(keyDisplayName(null, '73c5da0a', ours)).toBeNull();
  });

  it('says nothing for a ONE-key vault: the vault names it', () => {
    expect(keyDisplayName({ descriptor: `wpkh([73c5da0a/84'/1'/0']${A}/<0;1>/*)` }, '73c5da0a')).toBeNull();
  });
});

describe('the questions an import asks', () => {
  const source = readFileSync(join(SCREENS, 'ImportScreen.tsx'), 'utf8');

  it('never asks what a key is called', () => {
    // Decided 2026-09-26: the name comes from the file, or from the device at
    // registration; the owner is asked for the VAULT's name and nothing else.
    expect(source).not.toMatch(/Name key/);
    expect(source).not.toMatch(/keylabel/);
  });

  it('names every key it takes in', () => {
    expect(source).toContain('defaultKeyNames(');
  });
});

describe('whether a registration asks for the name at all (decided 2026-10-15)', () => {
  it('never for a vault built in Talia: the builder already asked', () => {
    expect(registrationAsksKeyName({ transport: 'created' }, undefined)).toBe(false);
    expect(registrationAsksKeyName({ transport: 'created' }, 'Key 2')).toBe(false);
    expect(registrationAsksKeyName({ transport: 'created' }, 'Your key 1')).toBe(false);
  });

  it('for an imported key with no name of its own, the import\'s number included', () => {
    for (const transport of ['qr', 'file', 'paste']) {
      expect(registrationAsksKeyName({ transport }, undefined)).toBe(true);
      expect(registrationAsksKeyName({ transport }, '')).toBe(true);
      expect(registrationAsksKeyName({ transport }, 'Key 2')).toBe(true);
    }
  });

  it('never when the import brought the name, or the owner gave one', () => {
    expect(registrationAsksKeyName({ transport: 'file' }, 'Ledger Flex')).toBe(false);
    expect(registrationAsksKeyName({ transport: 'qr' }, 'Safe at home')).toBe(false);
  });

  it('never without a vault', () => {
    expect(registrationAsksKeyName(null, undefined)).toBe(false);
  });
});

describe('the name a registration offers, on the screen that offers it', () => {
  const source = readFileSync(join(SCREENS, 'RegisterHardwareScreen.tsx'), 'utf8');

  it('asks with the device name as the template, and only when the name is unknown', () => {
    expect(source).toContain('keyNameTemplate(');
    expect(source).toMatch(/if \(!registrationAsksKeyName\(vault, current\)\) return;/);
    expect(source).toContain('Name this key');
    // Every way that screen can finish goes through the same door: the only
    // other `setDone` is the one that clears it for the next device.
    expect(source.match(/setDone\(/g) ?? []).toHaveLength(2);
    expect(source).toContain('setDone(null)');
    expect((source.match(/\bfinish\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
