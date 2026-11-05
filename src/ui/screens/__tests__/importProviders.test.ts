import {
  IMPORT_PROVIDERS,
  importKindMismatch,
  importProvider,
  providerVariant,
  providersFor,
} from '../importProviders';
import type { ImportVaultKind } from '../importProviders';

const KINDS: ImportVaultKind[] = ['single', 'multi'];

describe('import providers', () => {
  it('every product offers at least one shape, with a way in, and steps unless the search draws them', () => {
    for (const p of IMPORT_PROVIDERS) {
      const variants = KINDS.map((k) => providerVariant(p, k)).filter((v) => v != null);
      expect(variants.length).toBeGreaterThanOrEqual(1);
      expect(p.name.length).toBeGreaterThan(0);
      for (const v of variants) {
        expect(v!.methods.length).toBeGreaterThanOrEqual(1);
        if (!v!.methods.includes('ble')) expect(v!.steps.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('a hardware wallet hands over a key, never a shared vault', () => {
    for (const id of ['ledger', 'bitbox', 'passport'] as const) {
      expect(providerVariant(importProvider(id), 'multi')).toBeNull();
      expect(providerVariant(importProvider(id), 'single')).not.toBeNull();
    }
    expect(providersFor('multi', true).hardware).toEqual([]);
  });

  it('Liana is a shared vault only, and has no QR anywhere', () => {
    const liana = importProvider('liana');
    expect(providerVariant(liana, 'single')).toBeNull();
    const multi = providerVariant(liana, 'multi');
    expect(multi?.methods).toEqual(['paste', 'file']);
    expect(multi?.qrHint).toBeUndefined();
    expect(multi?.steps.join(' ')).toMatch(/no QR/i);
  });

  it('Sparrow and Talia serve both shapes, with their own words for each', () => {
    for (const id of ['sparrow', 'talia'] as const) {
      expect(providerVariant(importProvider(id), 'single')).not.toBeNull();
      expect(providerVariant(importProvider(id), 'multi')).not.toBeNull();
    }
    const sparrow = importProvider('sparrow');
    expect(providerVariant(sparrow, 'single')?.steps).not.toEqual(
      providerVariant(sparrow, 'multi')?.steps,
    );
    expect(providerVariant(sparrow, 'multi')?.pasteLabel).toBe('Vault descriptor');
  });

  it('Talia takes the export as a code or pasted text, never a file', () => {
    // Decided 2026-09-21: "Export Talia descriptor with text as well as QR!", then
    // "there is no longer any file export for Talia, remove it from the
    // import screen".
    for (const kind of ['single', 'multi'] as const) {
      const v = providerVariant(importProvider('talia'), kind);
      expect(v?.methods).toEqual(['qr', 'paste']);
      expect(v?.pasteLabel).toBe('Talia export');
      expect(v?.steps.join(' ')).toMatch(/paste the text/);
      expect(v?.steps.join(' ')).not.toMatch(/file/i);
    }
  });

  it('a paste field always has a label and a placeholder', () => {
    for (const p of IMPORT_PROVIDERS) {
      for (const k of KINDS) {
        const v = providerVariant(p, k);
        if (v?.methods.includes('paste')) {
          expect(v.pasteLabel).toBeTruthy();
          expect(v.placeholder).toBeTruthy();
        }
      }
    }
  });

  it('bare-key products say so, descriptor products do not', () => {
    expect(providerVariant(importProvider('bluewallet'), 'single')?.bareKey).toBe(true);
    expect(providerVariant(importProvider('electrum'), 'single')?.bareKey).toBe(true);
    expect(providerVariant(importProvider('sparrow'), 'single')?.bareKey).toBeUndefined();
  });

  it('never an em dash in text a client can see (decided 2026-08-28)', () => {
    const texts: string[] = [];
    for (const p of IMPORT_PROVIDERS) {
      texts.push(p.name, p.tagline);
      for (const k of KINDS) {
        const v = providerVariant(p, k);
        if (!v) continue;
        texts.push(...v.steps, v.qrHint ?? '', v.pasteLabel ?? '', v.placeholder ?? '');
      }
    }
    texts.push(importKindMismatch('multi', 1) ?? '', importKindMismatch('single', 3) ?? '');
    for (const t of texts) expect(t).not.toContain('—');
  });

  it('the hardware group is the registry\u2019s models (decided 2026-10-04, device first); the App Store build keeps only the Passport', () => {
    expect(providersFor('single', false).hardware).toEqual(['passport']);
    const on = providersFor('single', true);
    expect(on.hardware).toEqual(['gen5', 'flex', 'stax', 'nanoX', 'nova', 'passport']);
    expect(on.software.map((p) => p.id)).toEqual(['talia', 'sparrow', 'bluewallet', 'electrum']);
  });

  it('a device reached over Bluetooth has no steps: its turns are drawn by the search', () => {
    for (const id of ['ledger', 'bitbox'] as const) expect(providerVariant(importProvider(id), 'single')?.steps).toEqual([]);
    expect(providerVariant(importProvider('passport'), 'single')?.steps.length).toBeGreaterThan(0);
  });

  it('Talia is first everywhere (decided 2026-09-09)', () => {
    expect(providersFor('single', true).software[0].id).toBe('talia');
    expect(providersFor('multi', true).software[0].id).toBe('talia');
  });

  it('a shared vault lists the software that builds one, with a catch-all', () => {
    const multi = providersFor('multi', true);
    expect(multi.hardware).toEqual([]);
    expect(multi.software.map((p) => p.id)).toEqual(['talia', 'liana', 'sparrow', 'other']);
  });

  it('a multisig vault needs several keys; a single-sig vault exactly one', () => {
    expect(importKindMismatch('multi', 1)).toMatch(/single key/);
    expect(importKindMismatch('multi', 2)).toBeNull();
    expect(importKindMismatch('single', 1)).toBeNull();
    expect(importKindMismatch('single', 2)).toMatch(/several keys/);
    expect(importKindMismatch(undefined, 1)).toBeNull();
  });
});
