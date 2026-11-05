/**
 * The hardware registry (decided 2026-09-22: "every part of the app needs to
 * automatically use the same library and look for all available hardware we
 * have adopted"). Every chooser, search, list and hint reads these answers,
 * so a brand or a method added to the registry reaches every screen.
 */
import {
  DEVICE_KINDS,
  DEVICE_MODELS,
  brandNamesOf,
  deviceCan,
  deviceName,
  deviceSuitsVault,
  keyStep,
  devicesFor,
  isDeviceModel,
  modelFromKit,
  modelName,
  modelOfRecord,
  modelsFor,
  modelsOfKind,
  recordFromDiscovery,
  recordOf,
  recordedDevice,
  registeredFingerprintsOf,
} from '../deviceKinds';
import type { DeviceModel, StepKey } from '../deviceKinds';
import { parseTaliaVaultExport } from '../taliaVaultExport';
import type { KeyDevice } from '../types';

/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const K = 'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';
/** LAYERED's internal key: the unspendable one Liana derives from its two keys (K twice). */
const NUMS = 'tpubD6NzVbkrYhZ4Yewv29FkSvqy94Uw724yyCqZzZnMndNzijRMZdjZr5u4ewutcEbsZDq4Mc5PBDDXVL7zHKZfyC3vTTU67MQwgAVcpWUEzRY';
const PLAIN_SINGLE = `wpkh([73c5da0a/84'/0'/0']${K}/<0;1>/*)`;
const PLAIN_MULTI = `wsh(sortedmulti(2,[73c5da0a/48'/0'/0'/2']${K}/<0;1>/*,[3442193e/48'/0'/0'/2']${K}/<0;1>/*))`;
const LAYERED = `tr(${NUMS}/<0;1>/*,{pk([73c5da0a/48'/0'/0'/2']${K}/<0;1>/*),and_v(v:pk([cc000008/48'/0'/0'/2']${K}/<0;1>/*),older(52596))})`;
const ALL: DeviceModel[] = ['gen5', 'flex', 'stax', 'nanoX', 'nova', 'passport'];
const LEDGERS: DeviceModel[] = ['gen5', 'flex', 'stax', 'nanoX'];
const ON = { hardwareSurface: true };

describe('which devices do what', () => {
  it('every Bluetooth brand registers a shared vault; the Passport never does', () => {
    expect(devicesFor('multi', 'register').map((d) => d.kind)).toEqual(['ledger', 'bitbox']);
    expect(deviceCan('passport', 'multi', 'register')).toBe(false);
    expect(deviceCan('passport', 'single', 'sign')).toBe(true);
  });

  it('filters by method', () => {
    expect(devicesFor('single', 'key', 'qr').map((d) => d.kind)).toEqual(['passport']);
    expect(devicesFor('single', 'key', 'bluetooth').map((d) => d.kind)).toEqual(['ledger', 'bitbox']);
  });

  it('a BitBox shows a shared vault address but not a one-key one yet', () => {
    expect(deviceCan('bitbox', 'multi', 'address')).toBe(true);
    expect(deviceCan('bitbox', 'single', 'address')).toBe(false);
    expect(deviceCan('ledger', 'single', 'address')).toBe(true);
  });

  it('no Coinkite product is ever adopted (decided 2026-08-27)', () => {
    expect(DEVICE_KINDS.map((d) => d.name.toLowerCase()).join(' ')).not.toMatch(/coldcard|tapsigner|coinkite/);
  });
});

describe('names', () => {
  it('names a brand once it is known, and "your hardware" before', () => {
    expect(deviceName('bitbox')).toBe('BitBox');
    expect(deviceName('ledger')).toBe('Ledger');
    expect(deviceName(undefined)).toBe('your hardware');
    expect(deviceName(null)).toBe('your hardware');
  });

  it('names the brands behind a list of models, for a sentence', () => {
    expect(brandNamesOf(['gen5', 'flex', 'nova'])).toBe('Ledger or BitBox');
    expect(brandNamesOf(['nova', 'gen5', 'passport'])).toBe('Ledger, BitBox or Passport');
    expect(brandNamesOf(['stax'])).toBe('Ledger');
    expect(brandNamesOf([])).toBe('');
  });

  it('the CREATION wizard never offers a Passport, whatever the shape', () => {
    // A vault Talia is building can gain a rescue key or a timelocked heir
    // key on a later step, and a Passport can sign neither, which is why it
    // carries no `build` purpose. The key step once asked for 'key' instead
    // and so promised one in its own sentence (decided 2026-09-26: "passport
    // cant be used to at the 'creation' wizard").
    for (const shape of ['single', 'multi'] as const) {
      const sentence = brandNamesOf(modelsFor(shape, 'build', ON));
      expect(sentence).toBe('Ledger or BitBox');
      expect(sentence).not.toMatch(/Passport|QR/);
    }
  });

  it('no dash a client can see', () => {
    const text = [...DEVICE_KINDS.map((d) => d.name), ...DEVICE_MODELS.map((m) => m.fullName), brandNamesOf(ALL)].join(' ');
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('registeredFingerprintsOf', () => {
  it('reads every brand’s own registration record, lowercased', () => {
    const got = registeredFingerprintsOf({
      ledgerRegistrations: { AAAAAAAA: {} as never },
      bitboxRegistrations: { bbbbbbbb: { registeredAt: 1 } },
    });
    expect([...got].sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('is empty for a vault no device has seen', () => {
    expect(registeredFingerprintsOf({}).size).toBe(0);
  });
});

describe('a vault moved between phones keeps every adopted kind', () => {
  // The export's device list is read off the registry, so a brand added
  // there travels with no change in the format's reader.
  const descriptor =
    "wpkh([73c5da0a/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/<0;1>/*)";
  it.each(DEVICE_KINDS.map((d) => d.kind))('%s', (kind) => {
    const parsed = parseTaliaVaultExport(
      JSON.stringify({
        type: 'talia-vault',
        version: 1,
        name: 'Test',
        descriptor,
        keyDevices: { '73c5da0a': { kind } },
      }),
    );
    expect(parsed?.keyDevices?.['73c5da0a']?.kind).toBe(kind);
  });
});

describe('the models (decided 2026-10-04: "we simply ASK him which device he will be using for each key")', () => {
  it('lists every product in order, each of an adopted brand, named once, no Coinkite, no USB-only model', () => {
    expect(DEVICE_MODELS.map((m) => m.id)).toEqual(ALL);
    for (const m of DEVICE_MODELS) {
      expect(DEVICE_KINDS.some((d) => d.kind === m.kind)).toBe(true);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.fullName).toContain(m.name);
    }
    expect(new Set(DEVICE_MODELS.map((m) => m.fullName)).size).toBe(DEVICE_MODELS.length);
    const text = DEVICE_MODELS.map((m) => `${m.name} ${m.fullName} ${m.kitIds.join(' ')}`).join(' ');
    expect(text.toLowerCase()).not.toMatch(/coldcard|tapsigner|coinkite/);
    // No Nano S or S Plus, no BitBox02 without the Nova: they have no Bluetooth and never reach a phone.
    expect(text).not.toMatch(/nanoS\b|nanoSP|Nano S\b|Nano S Plus/);
    expect(DEVICE_MODELS.filter((m) => m.kind === 'bitbox').map((m) => m.id)).toEqual(['nova']);
    // The Passport is the one whose QR flow Talia adopted; the Prime is not checked.
    expect(text).not.toMatch(/Prime|Core\b/);
    expect(text).not.toMatch(/[–—]/);
    expect(modelsOfKind('ledger')).toEqual(LEDGERS);
    expect(modelName('flex')).toBe('Ledger Flex');
    expect(modelName('nova')).toBe('BitBox02 Nova');
    expect(isDeviceModel('gen5')).toBe(true);
    expect(isDeviceModel('nanoSP')).toBe(false);
    expect(isDeviceModel(7)).toBe(false);
  });

  it('a found device is read off its kit: apexp is the Gen5, a BitBox is the Nova, a Passport the Passport', () => {
    expect(modelFromKit('ledger', 'apexp')).toBe('gen5');
    expect(modelFromKit('ledger', 'flex')).toBe('flex');
    expect(modelFromKit('ledger', 'stax')).toBe('stax');
    expect(modelFromKit('ledger', 'nanoX')).toBe('nanoX');
    expect(modelFromKit('ledger', 'nanoSP')).toBeNull();
    expect(modelFromKit('ledger', null)).toBeNull();
    expect(modelFromKit('bitbox', null)).toBe('nova');
    expect(modelFromKit('bitbox', 'anything')).toBe('nova');
    expect(modelFromKit('passport')).toBe('passport');
    expect(recordOf('gen5')).toEqual({ kind: 'ledger', model: 'gen5' });
    expect(recordOf('nova')).toEqual({ kind: 'bitbox', model: 'nova' });
  });

  it('a record names its model when it is a listed one of that brand; a bare BitBox is the Nova; a bare Ledger none', () => {
    expect(modelOfRecord({ kind: 'ledger', model: 'stax' })).toBe('stax');
    expect(modelOfRecord({ kind: 'ledger' })).toBeNull();
    expect(modelOfRecord({ kind: 'bitbox' })).toBe('nova');
    expect(modelOfRecord({ kind: 'passport' })).toBe('passport');
    // A model of another brand, or one not listed, is not believed.
    expect(modelOfRecord({ kind: 'ledger', model: 'nova' })).toBeNull();
    expect(modelOfRecord({ kind: 'bitbox', model: 'gen5' })).toBe('nova');
    expect(modelOfRecord({ kind: 'toaster' as never })).toBeNull();
    expect(modelOfRecord(null)).toBeNull();
    expect(recordedDevice({ keyDevices: { AABBCCDD: { kind: 'ledger', model: 'flex' } } }, 'aabbccdd')).toEqual({ kind: 'ledger', model: 'flex' });
    expect(recordedDevice({ keyDevices: {} }, 'aabbccdd')).toBeNull();
    expect(recordedDevice(null, null)).toBeNull();
  });
});

describe('which models a step offers', () => {
  it('building a vault: the Ledgers and the Nova, never the Passport, for either shape', () => {
    for (const shape of ['single', 'multi'] as const) {
      expect(modelsFor(shape, 'build', ON)).toEqual([...LEDGERS, 'nova']);
      expect(brandNamesOf(modelsFor(shape, 'build', ON))).toBe('Ledger or BitBox');
    }
  });

  it('an existing vault: the Passport only where its script is standard', () => {
    expect(modelsFor('single', 'sign', { ...ON, descriptor: PLAIN_SINGLE })).toEqual(ALL);
    expect(modelsFor('single', 'register', { ...ON, descriptor: PLAIN_SINGLE })).toEqual(ALL);
    expect(modelsFor('single', 'sign', { ...ON, descriptor: LAYERED })).toEqual([...LEDGERS, 'nova']);
    expect(modelsFor('multi', 'sign', { ...ON, descriptor: PLAIN_MULTI })).toEqual([...LEDGERS, 'nova']);
    expect(modelsFor('multi', 'register', { ...ON, descriptor: PLAIN_MULTI })).toEqual([...LEDGERS, 'nova']);
    // A vault not yet known (importing): every device that can hold a key.
    expect(modelsFor('single', 'key', ON)).toEqual(ALL);
    // An unreadable descriptor keeps the Passport out, never in.
    expect(modelsFor('single', 'key', { ...ON, descriptor: '' })).toEqual([...LEDGERS, 'nova']);
  });

  it('the address check: a one-key vault has no Nova (no plain-account address call yet)', () => {
    expect(modelsFor('single', 'address', { ...ON, descriptor: PLAIN_SINGLE })).toEqual(LEDGERS);
    expect(modelsFor('multi', 'address', { ...ON, descriptor: PLAIN_MULTI })).toEqual([...LEDGERS, 'nova']);
  });

  it('a bare sh(multi) (legacy P2SH multisig): the Ledgers only, never the Nova, which cannot sign it', () => {
    // Decided 2026-10-17: bitbox-api refuses it
    // (UnknownOutputType) at signing, so the BitBox is never offered for it.
    const keys = `[73c5da0a/48'/0'/0'/1']${K}/<0;1>/*,[3442193e/48'/0'/0'/1']${K}/<0;1>/*`;
    for (const d of [`sh(multi(2,${keys}))`, `sh(sortedmulti(2,${keys}))`]) {
      for (const purpose of ['register', 'sign', 'address'] as const) {
        expect({ d, purpose, models: modelsFor('multi', purpose, { ...ON, descriptor: d }) }).toEqual({ d, purpose, models: LEDGERS });
      }
      expect(deviceSuitsVault('bitbox', d)).toBe(false);
      expect(deviceSuitsVault('ledger', d)).toBe(true);
    }
    // P2SH around a single key stays the BitBox's.
    expect(deviceSuitsVault('bitbox', `sh(wpkh([73c5da0a/49'/0'/0']${K}/<0;1>/*))`)).toBe(true);
  });

  it('a P2SH-wrapped wsh: the Ledgers only, never the Nova, which cannot register it (decided 2026-10-17)', () => {
    // A BitBox02 simulator run: the BitBox bridge sends any
    // vault but a top-level wsh(sortedmulti) as a policy, and the device takes
    // no sh-wrapped policy, so registration was refused with "invalid input".
    const keys = `[73c5da0a/48'/0'/0'/1']${K}/<0;1>/*,[3442193e/48'/0'/0'/1']${K}/<0;1>/*`;
    for (const d of [`sh(wsh(sortedmulti(2,${keys})))`, `sh(wsh(multi(2,${keys})))`]) {
      for (const purpose of ['register', 'sign', 'address'] as const) {
        expect({ d, purpose, models: modelsFor('multi', purpose, { ...ON, descriptor: d }) }).toEqual({ d, purpose, models: LEDGERS });
      }
      expect(deviceSuitsVault('bitbox', d)).toBe(false);
      expect(deviceSuitsVault('ledger', d)).toBe(true);
    }
    // The same keys unwrapped stay the Nova's.
    expect(deviceSuitsVault('bitbox', `wsh(sortedmulti(2,${keys}))`)).toBe(true);
    expect(modelsFor('multi', 'register', { ...ON, descriptor: `wsh(sortedmulti(2,${keys}))` })).toEqual([...LEDGERS, 'nova']);
  });

  it('a non-ranged vault (one fixed address): never a Ledger or the Nova, for any purpose (decided 2026-10-17)', () => {
    // No BIP-388 template can carry it, so neither brand can be shown it,
    // link a key to it or sign it: the device list says so before the
    // owner builds a spend, never after the device is unlocked.
    const fixedSingle = `wpkh([73c5da0a/84'/1'/0']${K}/0/7)`;
    const fixedMulti = `wsh(multi(2,[73c5da0a/48'/1'/0'/2']${K}/0/5,[3442193e/48'/1'/0'/2']${K}/0/5))`;
    const bareSingle = `wpkh([73c5da0a/84'/1'/0']${K})`;
    for (const d of [fixedSingle, fixedMulti, bareSingle]) {
      expect(deviceSuitsVault('ledger', d)).toBe(false);
      expect(deviceSuitsVault('bitbox', d)).toBe(false);
      for (const shape of ['single', 'multi'] as const) {
        for (const purpose of ['register', 'sign', 'key', 'build', 'address'] as const) {
          const models = modelsFor(shape, purpose, { ...ON, descriptor: d });
          expect({ d, shape, purpose, hw: models.filter((m) => m !== 'passport') }).toEqual({ d, shape, purpose, hw: [] });
        }
      }
    }
    // The ranged vaults stay every Bluetooth brand's.
    expect(deviceSuitsVault('ledger', PLAIN_SINGLE)).toBe(true);
    expect(deviceSuitsVault('bitbox', PLAIN_MULTI)).toBe(true);
    // A two-list import keeps its own re-import sentence at connect time.
    expect(deviceSuitsVault('ledger', `wpkh([73c5da0a/84'/0'/0']${K}/0/*)`)).toBe(true);
  });

  it('the App Store build lists no Bluetooth device, and keeps the Passport', () => {
    expect(modelsFor('single', 'key', { hardwareSurface: false })).toEqual(['passport']);
    expect(modelsFor('multi', 'key', { hardwareSurface: false })).toEqual([]);
    expect(modelsFor('single', 'build', { hardwareSurface: false })).toEqual([]);
  });

  it('every brand adopted is behind at least one model', () => {
    for (const d of DEVICE_KINDS) expect(modelsOfKind(d.kind).length).toBeGreaterThan(0);
  });
});

describe('how a step starts: straight to the known device, the vault\u2019s own keys, or the bare list (decided 2026-10-04)', () => {
  const suited = modelsFor('multi', 'sign', { ...ON, descriptor: PLAIN_MULTI });
  const key = (id: string, record: KeyDevice | null | undefined, name = `Key ${id}`): StepKey => ({ id, name, record });
  const GEN5 = key('1', { kind: 'ledger', model: 'gen5' }, 'Office');
  const NOVA = key('2', { kind: 'bitbox', model: 'nova' }, 'Bank');
  const BARE = key('3', { kind: 'ledger' }, 'Old Ledger');
  const NONE = key('4', null, 'Key 4');

  it('a recorded model connects straight; a BitBox is the Nova whether its record says so or not; two keys on one model are one answer', () => {
    expect(keyStep([GEN5], suited)).toEqual({ kind: 'connect', model: 'gen5' });
    expect(keyStep([key('2', { kind: 'bitbox' })], suited)).toEqual({ kind: 'connect', model: 'nova' });
    expect(keyStep([NOVA], suited)).toEqual({ kind: 'connect', model: 'nova' });
    expect(keyStep([key('a', { kind: 'ledger', model: 'flex' }), key('b', { kind: 'ledger', model: 'flex' })], suited)).toEqual({ kind: 'connect', model: 'flex' });
  });

  it('the bare list only for a new box (no keys), or a vault nothing was ever recorded for', () => {
    expect(keyStep([], suited)).toEqual({ kind: 'ask', models: suited });
    expect(keyStep([], ['passport'])).toEqual({ kind: 'ask', models: ['passport'] });
    expect(keyStep([NONE], suited)).toEqual({ kind: 'ask', models: suited });
    expect(keyStep([key('x', undefined)], suited)).toEqual({ kind: 'ask', models: suited });
    expect(keyStep([NONE, key('5', null)], suited)).toEqual({ kind: 'ask', models: suited });
  });

  it('a single Ledger whose model was never kept asks among the Ledgers only; two such keys ask the same question at once', () => {
    expect(keyStep([BARE], suited)).toEqual({ kind: 'ask', models: LEDGERS });
    expect(keyStep([BARE, key('9', { kind: 'ledger' })], suited)).toEqual({ kind: 'ask', models: LEDGERS });
  });

  it('a bare Ledger beside a key never connected: the vault knows something, so it lists its keys, never the bare list (decided 2026-10-04)', () => {
    // A phone test's screenshot: a 2-of-3 registered on a Ledger before models were
    // kept, its other key never connected here, was shown "Which device are
    // you using?" over Ledger / BitBox at the address check.
    expect(keyStep([BARE, NONE], suited)).toEqual({
      kind: 'keys',
      rows: [
        { id: '3', name: 'Old Ledger', model: null, kind: 'ledger', ask: LEDGERS },
        { id: '4', name: 'Key 4', model: null, kind: null, ask: suited },
      ],
    });
    // Where the step offers the Ledgers alone (a one-key vault's address
    // check), both rows ask the same list and one question covers both.
    expect(keyStep([BARE, NONE], LEDGERS)).toEqual({ kind: 'ask', models: LEDGERS });
  });

  it('two keys on two devices: the vault KNOWS, so it lists them with their devices, never the bare list', () => {
    expect(keyStep([NOVA, GEN5], suited)).toEqual({
      kind: 'keys',
      rows: [
        { id: '2', name: 'Bank', model: 'nova', kind: null, ask: ['nova'] },
        { id: '1', name: 'Office', model: 'gen5', kind: null, ask: ['gen5'] },
      ],
    });
  });

  it('inside a known vault a key whose device was never recorded is a row that asks once when tapped (the one exception)', () => {
    expect(keyStep([GEN5, NONE], suited)).toEqual({
      kind: 'keys',
      rows: [
        { id: '1', name: 'Office', model: 'gen5', kind: null, ask: ['gen5'] },
        { id: '4', name: 'Key 4', model: null, kind: null, ask: suited },
      ],
    });
    // A Ledger kept as a bare brand asks among the Ledgers from its row.
    expect(keyStep([GEN5, BARE], suited)).toEqual({
      kind: 'keys',
      rows: [
        { id: '1', name: 'Office', model: 'gen5', kind: null, ask: ['gen5'] },
        { id: '3', name: 'Old Ledger', model: null, kind: 'ledger', ask: LEDGERS },
      ],
    });
  });

  it('a recorded device that cannot do this job is left out; with none left there is nothing to offer', () => {
    expect(keyStep([key('p', { kind: 'passport' })], suited)).toEqual({ kind: 'ask', models: [] });
    expect(keyStep([key('b', { kind: 'bitbox' })], modelsFor('single', 'address', { ...ON, descriptor: PLAIN_SINGLE }))).toEqual({ kind: 'ask', models: [] });
    // Beside a key that can: the one that cannot is simply not a row.
    expect(keyStep([GEN5, key('p', { kind: 'passport' })], suited)).toEqual({ kind: 'connect', model: 'gen5' });
  });

  it('the rows keep the keys\u2019 own order and names; nothing in a row is a fingerprint', () => {
    const step = keyStep([NOVA, NONE, GEN5], suited);
    if (step.kind !== 'keys') throw new Error('keys');
    expect(step.rows.map((r) => r.name)).toEqual(['Bank', 'Key 4', 'Office']);
    for (const r of step.rows) expect(r.name).not.toMatch(/^[0-9a-f]{8}$/i);
  });
});

describe('what a device that proved a key writes over its record', () => {
  const gen5: KeyDevice = { kind: 'ledger', model: 'gen5' };
  it('a new key, a new brand or a new model is written; a record that already says it is left alone', () => {
    expect(recordFromDiscovery(undefined, gen5)).toEqual(gen5);
    expect(recordFromDiscovery(null, gen5)).toEqual(gen5);
    expect(recordFromDiscovery({ kind: 'bitbox', model: 'nova' }, gen5)).toEqual(gen5);
    expect(recordFromDiscovery({ kind: 'ledger' }, gen5)).toEqual(gen5);
    expect(recordFromDiscovery({ kind: 'ledger', model: 'flex' }, gen5)).toEqual(gen5);
    expect(recordFromDiscovery({ kind: 'ledger', model: 'gen5' }, gen5)).toBeNull();
    expect(recordFromDiscovery({ kind: 'bitbox', model: 'nova' }, { kind: 'bitbox', model: 'nova' })).toBeNull();
    // A device whose model Talia does not list never erases a model kept.
    expect(recordFromDiscovery({ kind: 'ledger', model: 'gen5' }, { kind: 'ledger' })).toBeNull();
    expect(recordFromDiscovery({ kind: 'ledger' }, { kind: 'ledger' })).toBeNull();
  });
});

describe('a vault moved between phones keeps only models the registry lists', () => {
  const descriptor =
    "wpkh([73c5da0a/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/<0;1>/*)";
  const back = (device: unknown) =>
    parseTaliaVaultExport(
      JSON.stringify({ type: 'talia-vault', version: 1, name: 'Test', descriptor, keyDevices: { '73c5da0a': device } }),
    )?.keyDevices?.['73c5da0a'];
  it('keeps a listed model of the brand, drops a foreign or unknown one', () => {
    expect(back({ kind: 'ledger', model: 'stax' })).toEqual({ kind: 'ledger', model: 'stax' });
    expect(back({ kind: 'ledger', model: 'nova' })).toEqual({ kind: 'ledger' });
    expect(back({ kind: 'ledger', model: 'nanoSP' })).toEqual({ kind: 'ledger' });
    expect(back({ kind: 'bitbox', model: 'nova' })).toEqual({ kind: 'bitbox', model: 'nova' });
  });
});
