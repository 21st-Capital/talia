import {
  MIN_NOVA_FIRMWARE,
  checkProduct,
  isNova,
  parseProduct,
  versionAtLeast,
} from '../product';

const nova = (version: string, product = 'bb02p-btconly') =>
  JSON.stringify({ p: product, v: version });

/** VERBATIM from a real Nova over Bluetooth, 2026-08-31. The first probe
 *  refused this device twice over: the product check looked for "nova" (the
 *  vendor says "bb02p"), and the version parser read "v9.26.5" as zero. A
 *  golden vector from the real hardware pins both. */
const REAL_DEVICE_BLOB = '{"p":"bb02p-btconly","v":"v9.26.5"}';

describe('the real device', () => {
  it('passes the exact blob the real Nova sent', () => {
    const v = checkProduct(REAL_DEVICE_BLOB);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.product.product).toBe('bb02p-btconly');
      expect(v.product.version).toBe('v9.26.5');
    }
  });

  it('strips the v prefix for comparison, keeps it for display', () => {
    expect(versionAtLeast('v9.26.5', MIN_NOVA_FIRMWARE)).toBe(true);
    expect(versionAtLeast('v9.20.0', MIN_NOVA_FIRMWARE)).toBe(false);
  });

  it('accepts the multi edition of the same platform', () => {
    expect(checkProduct(nova('v9.26.5', 'bb02p-multi')).ok).toBe(true);
  });
});

describe('versionAtLeast', () => {
  it('compares numerically, not alphabetically', () => {
    // The trap: "9.9.0" beats "9.21.0" as a string.
    expect(versionAtLeast('9.21.0', MIN_NOVA_FIRMWARE)).toBe(true);
    expect(versionAtLeast('9.9.0', MIN_NOVA_FIRMWARE)).toBe(false);
  });

  it('accepts newer majors and minors', () => {
    expect(versionAtLeast('10.0.0', '9.21.0')).toBe(true);
    expect(versionAtLeast('9.23.1', '9.21.0')).toBe(true);
  });

  it('treats an equal version as passing', () => {
    expect(versionAtLeast('9.21.0', '9.21.0')).toBe(true);
  });

  it('ignores a prerelease suffix', () => {
    expect(versionAtLeast('9.21.0-rc1', '9.21.0')).toBe(true);
  });

  it('treats a missing part as zero', () => {
    expect(versionAtLeast('9.21', '9.21.0')).toBe(true);
    expect(versionAtLeast('9.20', '9.21.0')).toBe(false);
  });
});

describe('parseProduct', () => {
  it('reads the vendor blob', () => {
    expect(parseProduct(nova('v9.26.5'))).toEqual({
      product: 'bb02p-btconly',
      version: 'v9.26.5',
    });
  });

  it.each([
    ['not json', 'hello'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a missing product', JSON.stringify({ v: '9.23.1' })],
    ['a missing version', JSON.stringify({ p: 'bitbox02-nova' })],
    ['blank strings', JSON.stringify({ p: '  ', v: '  ' })],
    ['numbers where strings belong', JSON.stringify({ p: 1, v: 2 })],
  ])('returns null for %s', (_label, json) => {
    expect(parseProduct(json)).toBeNull();
  });
});

describe('isNova', () => {
  it('accepts the real platform name in either casing', () => {
    expect(isNova('bb02p-btconly')).toBe(true);
    expect(isNova('BB02P-MULTI')).toBe(true);
  });

  it('still accepts a hypothetical string that says nova outright', () => {
    expect(isNova('bitbox02-nova-btconly')).toBe(true);
  });

  it('rejects the Bluetooth-less BitBox02 platform', () => {
    expect(isNova('bitbox02-btconly')).toBe(false);
    expect(isNova('bb02-btconly')).toBe(false);
  });
});

describe('checkProduct', () => {
  it('passes a Nova on current firmware', () => {
    const v = checkProduct(nova('9.23.1'));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.product.version).toBe('9.23.1');
  });

  it('passes a Nova exactly at the taproot floor', () => {
    expect(checkProduct(nova('9.21.0')).ok).toBe(true);
  });

  it('refuses firmware below the taproot floor, naming the version', () => {
    // Every 21C vault is taproot, so this is not a degraded experience: the
    // device simply cannot hold the key.
    const v = checkProduct(nova('9.20.0'));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain('9.20.0');
      expect(v.reason).toContain(MIN_NOVA_FIRMWARE);
    }
  });

  it('refuses a non-Nova BitBox and says why it cannot work', () => {
    const v = checkProduct(nova('9.23.1', 'bb02-btconly'));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('Bluetooth');
  });

  it('refuses an answer it cannot parse rather than guessing', () => {
    expect(checkProduct('garbage').ok).toBe(false);
  });

  it('never says an em dash to the client', () => {
    for (const json of ['garbage', nova('9.20.0'), nova('9.23.1', 'bb02-btconly')]) {
      const v = checkProduct(json);
      if (!v.ok) expect(v.reason).not.toMatch(/[—–]/);
    }
  });
});
