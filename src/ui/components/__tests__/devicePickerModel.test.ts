/**
 * "Which device?" is a LIST, two levels deep (decided 2026-10-04, on the grid of
 * tiles: "this looks terrible!! We have to use a list view with brands
 * instead. If the user selects 'Ledger' we show another list with all the
 * supported models. That is more scalable later!"; and "It doesnt look nice
 * to repeat the same logo repeatedly! try to avoid that").
 *
 * The rows come from the models a step offers, so these tests feed the pure
 * model the registry's own answers and check what the client would see.
 */
import { LINE_DOT, NOT_CONNECTED_YET, brandRows, keyRowSub, openingBrand, singleModelOf, withFingerprint } from '../devicePickerModel';
import { DEVICE_KINDS, DEVICE_MODELS, modelInfo, modelsFor } from '../../../wallet/deviceKinds';
import type { DeviceModel } from '../../../wallet/deviceKinds';

const ALL: DeviceModel[] = ['gen5', 'flex', 'stax', 'nanoX', 'nova', 'passport'];
const LEDGERS: DeviceModel[] = ['gen5', 'flex', 'stax', 'nanoX'];

describe('the brands list', () => {
  it('one row per brand behind the offered models, in the registry’s order, however many models the brand has', () => {
    const rows = brandRows(ALL);
    expect(rows.map((r) => r.kind)).toEqual(['ledger', 'bitbox', 'passport']);
    expect(rows.map((r) => r.name)).toEqual(DEVICE_KINDS.map((d) => d.name));
    // The brand's mark is drawn once, on its row: no brand appears twice.
    expect(new Set(rows.map((r) => r.kind)).size).toBe(rows.length);
    expect(rows[0].models).toEqual(LEDGERS);
    expect(rows[1].models).toEqual(['nova']);
    expect(rows[2].models).toEqual(['passport']);
  });

  it('the grey line names the brand’s models in THIS list, or its one product in full', () => {
    const rows = brandRows(ALL);
    expect(rows[0].sub).toBe('Nano Gen5, Flex, Stax, Nano X');
    expect(rows[1].sub).toBe('BitBox02 Nova');
    expect(rows[2].sub).toBe('Foundation Passport');
    // Two keys on two models (deviceStep's answer): each brand says the one
    // model it stands for here.
    expect(brandRows(['gen5', 'nova']).map((r) => r.sub)).toEqual(['Ledger Nano Gen5', 'BitBox02 Nova']);
  });

  it('follows the step: the builder’s list has no Passport row; the App Store build’s list is the Passport alone', () => {
    const build = brandRows(modelsFor('multi', 'build', { hardwareSurface: true }));
    expect(build.map((r) => r.kind)).toEqual(['ledger', 'bitbox']);
    const store = brandRows(modelsFor('single', 'key', { hardwareSurface: false }));
    expect(store.map((r) => r.kind)).toEqual(['passport']);
    expect(brandRows([])).toEqual([]);
  });

  it('keeps the list’s own order of models inside a brand', () => {
    expect(brandRows(['stax', 'gen5'])[0].models).toEqual(['stax', 'gen5']);
  });
});

describe('what tapping a brand does', () => {
  it('a brand with one model in the list goes straight on; one with several opens its models', () => {
    const rows = brandRows(ALL);
    expect(singleModelOf(rows[0])).toBeNull();
    expect(singleModelOf(rows[1])).toBe('nova');
    expect(singleModelOf(rows[2])).toBe('passport');
    // A Ledger that is the only Ledger offered goes straight on too.
    expect(singleModelOf(brandRows(['flex', 'nova'])[0])).toBe('flex');
  });
});

describe('where the list opens', () => {
  it('on the brands, whenever there is more than one row to choose from', () => {
    expect(openingBrand(brandRows(ALL), false)).toBeNull();
    expect(openingBrand(brandRows(['gen5', 'nova']), false)).toBeNull();
  });

  it('straight on one brand’s models when it is the only brand and has several (a Ledger kept as a bare brand)', () => {
    expect(openingBrand(brandRows(LEDGERS), false)?.kind).toBe('ledger');
  });

  it('on the brands when "Another device" sits in the list, or when the one brand has one model (its row is the choice)', () => {
    expect(openingBrand(brandRows(LEDGERS), true)).toBeNull();
    expect(openingBrand(brandRows(['nova']), false)).toBeNull();
    expect(openingBrand([], false)).toBeNull();
  });
});

describe('the registry feeds it', () => {
  it('every model has a brand row to live under, and every brand’s row names only models of that brand', () => {
    const rows = brandRows(DEVICE_MODELS.map((m) => m.id));
    for (const m of DEVICE_MODELS) {
      const row = rows.find((r) => r.kind === m.kind);
      expect(row?.models).toContain(m.id);
    }
    for (const r of rows) for (const m of r.models) expect(modelInfo(m).kind).toBe(r.kind);
  });
});

describe('the known-keys list\u2019s grey line (decided 2026-10-04: list the keys with their devices)', () => {
  it('the model in full, the brand alone when its model was never kept, else that the device was never connected here', () => {
    expect(keyRowSub({ model: 'gen5', kind: null })).toBe('Ledger Nano Gen5');
    expect(keyRowSub({ model: 'nova', kind: null })).toBe('BitBox02 Nova');
    expect(keyRowSub({ model: null, kind: 'ledger' })).toBe('Ledger');
    expect(keyRowSub({ model: null, kind: null })).toBe(NOT_CONNECTED_YET);
    // A model wins over a brand, and no line is a fingerprint or an em dash.
    expect(keyRowSub({ model: 'flex', kind: 'ledger' })).toBe('Ledger Flex');
    for (const m of DEVICE_MODELS) expect(keyRowSub({ model: m.id, kind: null })).toBe(m.fullName);
    expect(NOT_CONNECTED_YET).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('a key\u2019s second line: the device, then the fingerprint, joined like the vault cards (decided 2026-10-04)', () => {
  it('is "Ledger Nano Gen5 \u00b7 3442193E", with the vault cards\u2019 separator', () => {
    expect(LINE_DOT).toBe(' \u00b7 ');
    expect(keyRowSub({ id: '3442193e', model: 'gen5', kind: null })).toBe('Ledger Nano Gen5 \u00b7 3442193E');
    expect(keyRowSub({ id: '4a290600', model: 'nova', kind: null })).toBe('BitBox02 Nova \u00b7 4A290600');
    expect(keyRowSub({ id: 'abf931aa', model: null, kind: 'ledger' })).toBe('Ledger \u00b7 ABF931AA');
  });

  it('a key kept by a bare xpub has no fingerprint to show', () => {
    // A synthetic key: the placeholder XPUB_A's header and chain code with a
    // valid public key put in (descriptors.ts), nobody's wallet.
    expect(withFingerprint('Ledger Nano X', 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz')).toBe('Ledger Nano X');
    expect(withFingerprint('Ledger Nano X', null)).toBe('Ledger Nano X');
  });
});

