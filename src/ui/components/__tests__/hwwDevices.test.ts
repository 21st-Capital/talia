// A client must always have SOME way to hand a key to the app, whatever the
// release flags say. This test exists because the App Store build once had
// none: the hardware surface off hid Bluetooth's only transport, so the "add
// a key" sheet rendered instructions and nothing to tap. Vault creation
// dead-ended on the first-run path, which is a 2.1 rejection.
//
// Since 2026-10-04 the sheet asks WHICH device holds the key (device
// first), with the registry's brands and models as a list, and the ways in that need no
// adopted device sit behind "Another device". The brand lines come from the
// one device registry; nothing here names one.
import { readFileSync } from 'fs';
import { join } from 'path';
import { HWW_ENABLED, SIGNING_ENABLED } from '../../../config';
import { OTHER_DEVICE_STEPS, type KeyPurpose } from '../hwwDevices';
import { DEVICE_KINDS, modelsFor } from '../../../wallet/deviceKinds';

/** Comments out: the rules are about what the sheet shows. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SHEET = code(readFileSync(join(__dirname, '..', 'KeyEntrySheet.tsx'), 'utf8'));

describe('adding a key is possible in every build', () => {
  const purposes: KeyPurpose[] = ['single', 'multisig'];
  const hardware = SIGNING_ENABLED || HWW_ENABLED;

  it.each(purposes)('the "Another device" steps say what we need for a %s key, naming no brand', (purpose) => {
    const steps = OTHER_DEVICE_STEPS[purpose];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.join(' ')).toMatch(/PUBLIC/);
    expect(steps.join(' ')).toMatch(/xpub/);
    for (const step of steps) {
      for (const d of DEVICE_KINDS) expect(step).not.toContain(d.name);
      expect(step).not.toMatch(/[–—]/);
    }
    expect(OTHER_DEVICE_STEPS.multisig.join(' ')).toMatch(/multisig/i);
  });

  it('the key sheet offers "Another device" (a code, a paste, a file) whenever it is not building a vault', () => {
    // The rows behind that row are the three ways in that need no adopted
    // device, and the row is withheld only while building (decided 2026-09-24).
    expect(SHEET).toMatch(/another=\{\s*building\s*\?\s*undefined\s*:/);
    for (const row of ['Scan a key QR', 'Paste a key', 'Load the export file']) expect(SHEET).toContain(row);
    expect(SHEET).toMatch(/OTHER_DEVICE_STEPS\[guidePurpose\]/);
  });

  it('with the hardware surface off, no Bluetooth device is offered, so the sheet is the "Another device" rows alone', () => {
    expect(modelsFor('multi', 'key', { hardwareSurface: false })).toEqual([]);
    expect(modelsFor('single', 'key', { hardwareSurface: false })).toEqual(['passport']);
    if (hardware) {
      expect(modelsFor('multi', 'key', { hardwareSurface: true }).length).toBeGreaterThan(0);
    }
    // With no tile to offer, HardwareConnect hands the rows the whole step
    // (no way "back" to a question never asked), and the sheet heads them
    // with its question and intro, the line naming the heir's key included,
    // and draws no dead "Choose another device" (decided 2026-10-04: the App
    // Store build's heir page opened as "Another device" with a link that
    // did nothing and without the fingerprint).
    const connect = code(readFileSync(join(__dirname, '..', 'HardwareConnect.tsx'), 'utf8'));
    expect(connect).toMatch(/another\?: \(back: \(\(\) => void\) \| null\) => React\.ReactNode;/);
    expect(connect).toMatch(/if \(shown\.models\.length === 0 && another\) return <>\{another\(null\)\}<\/>;/);
    // The rows draw no Back of their own (decided 2026-10-05): the step hands the
    // sheet its Back to the list, drawn at the sheet's foot under the scroll area.
    expect(SHEET).not.toMatch(/ChooseAnother/);
    expect(SHEET).toMatch(/<\/ScrollView>\s*\{stepBack != null && \(/);
    expect(SHEET).toMatch(/\{back \? \(\s*<Text style=\{styles\.title\}>Another device<\/Text>/);
    expect(SHEET).toMatch(/\{!!question && <Text style=\{styles\.title\}>\{question\}<\/Text>\}/);
    expect(SHEET).toMatch(/\{!!intro && <Text style=\{styles\.intro\}>\{intro\}<\/Text>\}/);
  });
});

describe('the question is which device, never how it connects', () => {
  it('the sheet asks which device will hold the key, through the one HardwareConnect', () => {
    expect(SHEET).toContain('Which device will hold this key?');
    expect(SHEET).toMatch(/<HardwareConnect\b/);
    expect(SHEET).not.toMatch(/How does your (device|hardware) connect/);
    expect(SHEET).not.toMatch(/<HwwConnectFlow\b/);
    // No brand is picked by name here: the registry's list does the asking.
    for (const d of DEVICE_KINDS) expect(SHEET).not.toMatch(new RegExp(`['"\`]${d.name}['"\`]`));
  });
});
