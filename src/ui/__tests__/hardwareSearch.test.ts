/**
 * One hardware search for the whole app (decided 2026-09-22): "we need our
 * hardware search to always be for all currently adopted hardware ... every
 * part of the app needs to automatically use the same library", "always say
 * 'looking for your hardware'"; and since 2026-10-04 DEVICE FIRST ("we
 * simply ASK him which device he will be using for each key ... We no longer
 * need to ask how to connect!").
 *
 * An heir holding a BitBox was once sent to a Ledger-only search because a
 * screen started a brand's own flow. These scans keep that from coming back.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ui = join(__dirname, '..');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p);
    } else if (p.endsWith('.tsx') || p.endsWith('.ts')) files.push(p);
  }
};
walk(ui);
const rel = (f: string) => f.slice(ui.length + 1);
const read = (f: string) => readFileSync(f, 'utf8');
const find = (suffix: string) => files.find((x) => x.endsWith(suffix)) as string;
/** Comments out: the rules are about code. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('one search for every adopted device', () => {
  it('reads the whole ui tree', () => {
    expect(files.some((f) => f.endsWith('HwwConnectFlow.tsx'))).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it('only the universal search starts a Bluetooth scan', () => {
    const offenders = files
      .filter((f) => !f.endsWith('HwwConnectFlow.tsx') && !f.endsWith('LedgerConnectFlow.tsx'))
      .filter((f) => /\b(startLedgerScan|scanForNova|listenToAvailableDevices)\s*\(/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('only the universal search renders a brand ceremony', () => {
    const offenders = files
      .filter((f) => !f.endsWith('HwwConnectFlow.tsx'))
      .filter((f) => /<LedgerConnectFlow\b/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  // Every screen starts from HardwareConnect, which asks WHICH device (decided
  // 2026-10-04, device first) and is the only place the search is mounted.
  it('only HardwareConnect mounts the search, told which device to draw, from the registry\u2019s models', () => {
    const offenders = files
      .filter((f) => !f.endsWith('components/HardwareConnect.tsx'))
      .filter((f) => /<HwwConnectFlow\b/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
    const connect = code(read(find('components/HardwareConnect.tsx')));
    expect(connect).toMatch(/<HwwConnectFlow[\s\S]*?expect=\{pick\}/);
    // The models offered and whether to ask come from the registry, never a
    // list written here; the pick is never written (only discovery is).
    expect(connect).toMatch(/modelsFor\(/);
    expect(connect).toMatch(/keyStep\(/);
    expect(connect).toMatch(/<DevicePicker\b/);
    expect(connect).toMatch(/<KeyDevicePicker\b/);
    expect(connect).not.toMatch(/keyDevices|updateWallet/);
  });

  it('the question is which device, never how it connects', () => {
    const asks = files.filter((f) => /How does your (device|hardware) connect/.test(read(f))).map(rel);
    expect(asks).toEqual([]);
    const picker = code(read(find('components/DevicePicker.tsx')));
    // The rows are the models handed in, named by the registry: no brand or
    // model is written into the picker.
    expect(picker).not.toMatch(/['"`](ledger|bitbox|passport|gen5|flex|stax|nanoX|nova)['"`]/);
    expect(picker).toMatch(/modelInfo\(/);
    // No caller narrows the search to known brands or starts in a method.
    expect(files.filter((f) => /knownKinds|initialMethod|methodsFor\(|howDevicesConnect\(|kindsInVault\(/.test(read(f))).map(rel)).toEqual([]);
  });

  // Decided 2026-10-04, on the grid of device tiles: "this looks terrible!! We
  // have to use a list view with brands instead. If the user selects 'Ledger'
  // we show another list with all the supported models. That is more
  // scalable later!" And: "It doesnt look nice to repeat the same logo
  // repeatedly! try to avoid that".
  it('the device choice is a list of brands, then models: no grid of tiles, and no brand’s mark twice', () => {
    const picker = code(read(find('components/DevicePicker.tsx')));
    expect(picker).not.toMatch(/<ProductGrid\b|ProductTile|columns=/);
    // The two levels come from the pure model, fed the registry's models.
    expect(picker).toMatch(/brandRows\(/);
    expect(picker).toMatch(/singleModelOf\(/);
    expect(picker).toMatch(/openingBrand\(/);
    // The brand's mark is drawn exactly twice in the file: once on the brand
    // row, once as "Another device". A model row never carries it; it has the
    // model's own drawing.
    expect(picker.match(/<ProviderTile\b/g) ?? []).toHaveLength(2);
    expect(picker).toMatch(/<ModelTile\b/);
    const glyphs = code(read(find('components/DeviceModelGlyph.tsx')));
    expect(glyphs).not.toMatch(/ProviderTile|ProviderLogo/);
    // One outline per model, each its own: a model added to the registry
    // without a drawing does not compile (the record is exhaustive).
    expect(glyphs).toMatch(/Record<DeviceModel,/);
    // The rows are the app's glass rows, never tiles.
    expect(picker).toMatch(/<Gloss radius=\{theme\.radius\.lg\} strength=\{cardGlow\(\)\}/);
    expect(picker).toMatch(/<ChevronRightIcon\b/);
    // No screen keeps a grid of device models of its own: a `<ProductGrid`
    // never lists the registry's models (the window is the grid's props).
    const grids = files.flatMap((f) => {
      const src = code(read(f));
      return [...src.matchAll(/<ProductGrid\b/g)].map((m) => ({ f: rel(f), props: src.slice(m.index, (m.index ?? 0) + 400) }));
    });
    expect(grids.filter((g) => /modelInfo\(|modelsFor\(|hardware\b/.test(g.props)).map((g) => g.f)).toEqual([]);
  });

  it('every screen that connects hardware goes through HardwareConnect', () => {
    const users = files
      .filter((f) => /<HardwareConnect\b/.test(read(f)))
      .map(rel)
      .sort();
    expect(users).toEqual([
      'components/KeyEntrySheet.tsx',
      'screens/ImportScreen.tsx',
      'screens/RefreshSessionScreen.tsx',
      'screens/RegisterHardwareScreen.tsx',
      'screens/ReplaceDeviceScreen.tsx',
      'screens/SignPsbtScreen.tsx',
      'screens/VaultBuilderScreen.tsx',
      'screens/VerifyAddressScreen.tsx',
    ]);
    // Each hands over the vault's own keys with what it recorded for them
    // (or nothing, for a new box), so a known device connects straight.
    for (const u of users) expect({ u, keys: /\bkeys=\{/.test(read(find(u))) }).toEqual({ u, keys: true });
    expect(files.filter((f) => /\brecords=\{/.test(read(f))).map(rel)).toEqual([]);
  });

  // Decided 2026-10-04: "the bare list of all supported devices should only be
  // used if: 1. A vault has been imported and we dont know which hardware is
  // being used and the user wants to register the keys. 2. we are building
  // a brand new vault and we need to know which device the user wants to
  // use. 3. The user wants to replace a key with a new signing device which
  // we dont know about. Other than the above scenarios, the Hardware and its
  // associated key is KNOWN and we should list them instead of guessing or
  // asking."
  it('the bare list is for a new box alone; every known vault hands its own keys over, with their devices', () => {
    // Building (2), replacing (3), importing and unlocking a backup (1): no
    // key to list, so the step asks among every device Talia supports.
    const newBox = ['components/KeyEntrySheet.tsx', 'screens/VaultBuilderScreen.tsx', 'screens/ReplaceDeviceScreen.tsx', 'screens/ImportScreen.tsx'];
    for (const u of newBox) expect({ u, bare: /\bkeys=\{\[\]\}/.test(read(find(u))) }).toEqual({ u, bare: true });
    // The address check, the refresh session, registration and signing: the
    // vault's own keys, named as every screen names them, never a bare list.
    const known = ['screens/VerifyAddressScreen.tsx', 'screens/RefreshSessionScreen.tsx', 'screens/RegisterHardwareScreen.tsx', 'screens/SignPsbtScreen.tsx'];
    for (const u of known) {
      const src = code(read(find(u)));
      expect({ u, bare: /\bkeys=\{\[\]\}/.test(src) }).toEqual({ u, bare: false });
      expect({ u, own: /\b(stepKeysOf|stepKeyOf|stepKeyFor)\(/.test(src) }).toEqual({ u, own: true });
    }
    // Registration meets its keys one by one (the checklist's brand-neutral
    // row stands for several at once and cannot be listed as keys).
    expect(code(read(find('screens/RegisterHardwareScreen.tsx')))).toMatch(/stepKeysOf\(wallet, ownKeysToRegister\(wallet, providerFps\), providerFps\)/);
    // The registry decides which of the three the step is; the step draws
    // the keys with their devices through the one list, and a key whose
    // device was never recorded is asked once from its row (the one
    // exception inside a known vault).
    const connect = code(read(find('components/HardwareConnect.tsx')));
    expect(connect).toMatch(/const step = useMemo\(\(\) => keyStep\(keys, suited\), \[keys, suited\]\);/);
    expect(connect).toMatch(/<KeyDevicePicker rows=\{shown\.rows\}[^>]*onPick=\{\(row\) => \(row\.model != null \? pickOf\(row\.model\) : setAsking\(row\)\)\}/);
    expect(connect).toMatch(/<DevicePicker models=\{asking\.ask\}[^>]*back=\{\{ name: asking\.name/);
    // A straight connection from the vault's own records has no "Choose
    // another device": the vault knows (a moved device is Replace's job,
    // offered through `onMoved`, below). "Choose another device" returns to
    // the list the step started from, and a pick preset by the caller to the
    // question the step asks for that key (a bare Ledger's among the
    // Ledgers), never to every suited model (decided 2026-10-04).
    expect(connect).toMatch(/const list: KeyStep \| null = step\.kind !== 'connect' \? step : model \? \{ kind: 'ask', models: suited \} : null;/);
    expect(connect).toMatch(/if \(pick != null && pick !== 'another'\) return locked \? null : list != null \? back : \(onBack \?\? null\);/);
    // The step draws no Back of its own (decided 2026-10-05): it hands the page
    // the one it decided (`onFooterBack`, required), as one stable press told
    // only as it comes and goes, and the page's footer draws it;
    // pageFooter.test pins every host.
    expect(connect).toMatch(/onFooterBack: \(back: StepBack \| null\) => void;/);
    expect(connect).toMatch(/const handedBack = useRef<StepBack>\(\{ onPress: \(\) => stepBackRef\.current\?\.\(\) \}\)\.current;/);
    expect(connect).not.toMatch(/<Button\b|ChooseAnother|AFTER_SCAN/);
    // Off the caller's rows and the scanner's page too, to the list they sat behind.
    expect(connect).toMatch(/if \(pick === 'another' && another\) return back;\s*if \(qrPick\) return back;/);
    expect(connect).not.toMatch(/Choose another device"/);
    // A screen that hands its Back to the step draws none of its own under it.
    expect(code(read(find('screens/SignPsbtScreen.tsx')))).toMatch(/onBack=\{backFromDevice\}/);
    expect(code(read(find('screens/SignPsbtScreen.tsx')))).not.toMatch(/courier == null && <Button title="Back"/);
    expect(code(read(find('screens/RefreshSessionScreen.tsx')))).toMatch(/onBack=\{\(\) => setPhase\('summary'\)\}/);
    // The known-keys list: one row per key, the device's tile, its model's
    // name under the key's; no brand or model written into it.
    const picker = code(read(find('components/KeyDevicePicker.tsx')));
    expect(picker).toMatch(/<DeviceListRow\b/);
    expect(picker).toMatch(/mark=\{<KeyDeviceTile\b/);
    expect(picker).toMatch(/sub=\{keyRowSub\(r\)\}/);
    expect(picker).not.toMatch(/['"`](ledger|bitbox|passport|gen5|flex|stax|nanoX|nova)['"`]/);
    expect(picker).not.toMatch(/<ProviderTile\b|<ModelTile\b|<KeyIcon\b/);
    // Only three places mount the bare list: the one step, the import's own
    // product list, and the signing screen's one-time question for a key the
    // vault has no record of (which holds the ferries behind "Another device").
    expect(files.filter((f) => /<DevicePicker\b/.test(code(read(f)))).map(rel).sort()).toEqual(['components/HardwareConnect.tsx', 'screens/ImportScreen.tsx', 'screens/SignPsbtScreen.tsx']);
    expect(code(read(find('screens/SignPsbtScreen.tsx')))).toMatch(/keyStep\(stepKeyFor\(selectedKey\), signingModels\)/);
  });

  // Decided 2026-10-04: "since we now know which device the user is using, why
  // not use the same icons during the signing ceremony instead of a bare key
  // icon (except the cosigner, which cannot have a HWW icon)."
  it('a list of a vault\u2019s keys draws each key\u2019s recorded device, in the device list\u2019s own tile; the co-signer keeps the key', () => {
    const tile = code(read(find('components/KeyDeviceTile.tsx')));
    expect(tile).toMatch(/modelOfRecord\(record\)/);
    expect(tile).toMatch(/<ModelTile model=\{model\} color=\{color\} \/>/);
    expect(tile).toMatch(/<ProviderTile provider=\{record\.kind\} size=\{DEVICE_ROW_MARK\} \/>/);
    expect(tile).toMatch(/<KeyIcon size=\{KEY_GLYPH\} color=\{color\} \/>/);
    const sign = code(read(find('screens/SignPsbtScreen.tsx')));
    expect(sign).not.toMatch(/<KeyIcon\b/);
    expect(sign.match(/<KeyDeviceTile\b/g)).toHaveLength(2);
    expect(sign).toMatch(/<KeyDeviceTile record=\{isCoSigner \? null : recordFor\(fp \?\? id\)\}/);
    const replace = code(read(find('screens/ReplaceDeviceScreen.tsx')));
    expect(replace).not.toMatch(/<KeyIcon\b/);
    expect(replace).toMatch(/<KeyDeviceTile record=\{k\.device\} \/>/);
    expect(replace).toMatch(/keyRowSub\(\{ model: modelOfRecord\(device\), kind: device\?\.kind \?\? null, id: fingerprint \}\)/);
    // The address check lists only keys whose hardware this phone recorded (decided 2026-10-04: no co-signer row).
    const verifyScreen = read(find('screens/VerifyAddressScreen.tsx'));
    expect(verifyScreen).toMatch(/const recorded = ownKeyIds\.filter\(\(id\) => recordedDevice\(wallet, id\) != null\);\s*return recorded\.length > 0 \? recorded : ownKeyIds;/);
    // The signing rows read "model \u00b7 fingerprint" under the key's name.
    const signScreen = read(find('screens/SignPsbtScreen.tsx'));
    expect(signScreen).toMatch(/return keyRowSub\(\{ model: modelOfRecord\(rec\), kind: rec\.kind, id: fp \}\);/);
    expect((signScreen.match(/\? signLine\(fp\)/g) ?? []).length).toBe(2);
    // The tile is drawn in one file; a model's outline in one file.
    expect(files.filter((f) => /<KeyDeviceTile\b/.test(code(read(f)))).map(rel).sort()).toEqual(['components/KeyDevicePicker.tsx', 'screens/ReplaceDeviceScreen.tsx', 'screens/SignPsbtScreen.tsx']);
    expect(files.filter((f) => /<ModelTile\b/.test(code(read(f)))).map(rel).sort()).toEqual(['components/DevicePicker.tsx', 'components/KeyDeviceTile.tsx']);
  });

  it('the register screen waits for 21st Capital’s fingerprints before it asks which device', () => {
    // Decided 2026-10-04: its records come from the registration checklist,
    // which counts our co-signer as a key with no record until the known
    // fingerprints have loaded (an effect, so never on the first render).
    // The step mounted then asked "Which device?" for a device the vault
    // had recorded, and HardwareConnect takes its first pick once.
    const src = code(read(find('screens/RegisterHardwareScreen.tsx')));
    expect(src).toMatch(/const \{ providerFps, settled: fpsSettled \} = useProviderFingerprints\(wallet\);/);
    const gate = src.search(/if \(!fpsSettled\) \{/);
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(src.indexOf('<HardwareConnect'));
  });

  it('no route to a one-brand screen', () => {
    const offenders = files
      .filter((f) => /['"](LedgerSetup|BitboxProbe)['"]/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('no two-brand guess when naming the device', () => {
    const guess = /\?\s*['"`](BitBox|Ledger)['"`]\s*:\s*['"`](BitBox|Ledger)['"`]/;
    const offenders = files.filter((f) => guess.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the search never names a brand before one is found', () => {
    const offenders = files
      .filter((f) => /Looking for your (Ledger|BitBox|Passport)/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  // Decided 2026-09-23: "the only thing we need to be careful about is the
  // possibility that the user needs a very long time to put the pin etc.
  // Please make sure that the search just keeps going until it finds the
  // device and its not shortlived."
  it('the search keeps looking: the rotation closes on itself', () => {
    const src = read(files.find((f) => f.endsWith('HwwConnectFlow.tsx')) as string);
    // Each radio's window hands over to the other, and the second window
    // starts the first again, so the loop has no end of its own.
    expect(src).toMatch(/setTimeout\(\(\) => startLedgerWindow\(\), NOVA_WINDOW_MS\)/);
    expect(src).toMatch(/startNovaWindow\(\);\s*\n\s*\}, LEDGER_WINDOW_MS\)/);
    // And nothing turns the search off on a timer: only a person leaving,
    // a device being chosen, or a ceremony starting may stop it.
    const stops = [...src.matchAll(/scanningRef\.current = false/g)].length;
    expect(stops).toBe(2); // haltScanning, and the unmount cleanup
  });
});

describe('only a device that proved a key writes its record', () => {
  it('no isGen5 anywhere; no brand record written by hand outside the device layer; every writer over an existing record goes through recordFromDiscovery', () => {
    // isGen5 kept the Gen5's model and dropped every Flex, Stax and Nano X's.
    expect(files.filter((f) => /isGen5/.test(read(f))).map(rel)).toEqual([]);
    expect(readFileSync(join(ui, '..', 'platform', 'ledger.ts'), 'utf8')).not.toMatch(/isGen5/);
    // A Ledger's or BitBox's record comes from connectedDevice's `record`
    // (the registry's model from the kit's id), never typed into a screen.
    const literal = /\{\s*kind:\s*'(ledger|bitbox)'\s*(\}|,\s*model\b)/;
    const offenders = files
      .filter((f) => !f.endsWith('hww/connectedDevice.ts'))
      .filter((f) => literal.test(code(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
    for (const f of ['screens/VerifyAddressScreen.tsx', 'screens/RefreshSessionScreen.tsx', 'screens/SignPsbtScreen.tsx', 'screens/RegisterHardwareScreen.tsx']) {
      expect({ f, through: /recordFromDiscovery\(/.test(read(find(f))) }).toEqual({ f, through: true });
    }
  });
});

describe('decided 2026-10-04: the way out for a key that moved, and what the known vault’s screens still had wrong', () => {
  // The search looks for the recorded device ALONE, so a record that went
  // stale (the seed moved to another box) drew the old device unlocking for
  // ever, with Cancel as the only way out: a straight connection has no
  // "Choose another device", and a key row's leads back to the same row.
  it('Reconnect shows a spinner while it runs, and a hint after ten seconds on a waiting page (decided 2026-10-05)', () => {
    const connect = code(read(find('components/HardwareConnect.tsx')));
    expect(connect).toMatch(/reconnecting \? \(\s*<View style=\{styles\.reconnecting\}[\s\S]{0,200}<ActivityIndicator/);
    expect(connect).toMatch(/export const RECONNECTING = 'Reconnecting\\u2026';/);
    expect(connect).toMatch(/export const RECONNECT_HINT_AFTER_MS = 19000;/);
    expect(connect).toMatch(/const t = setTimeout\(\(\) => setStuck\(true\), RECONNECT_HINT_AFTER_MS\);/);
    expect(connect).toMatch(/const WAITING_ASKS: readonly DeviceAsk\[\] = \['unlock', 'side'\];/);
    expect(connect).toMatch(/\{!locked && stuck && !reconnecting && \(/);
    // The flow's turn is kept here and still handed to the caller.
    expect(connect).toMatch(/const onFlowTurn = \(a: DeviceAsk \| null\) => \{\s*setAsk\(a\);\s*onTurn\?\.\(a\);/);
    expect(connect).toMatch(/onDeviceTurn=\{onFlowTurn\}/);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { reconnectHint } = require('../components/devicePickerModel');
    expect(reconnectHint('ledger')).toBe('Still not connecting after typing your PIN? Tap Reconnect.');
    expect(reconnectHint('bitbox')).toBe(
      'Still not connecting after typing your password? Unplug the device, plug it back in, then tap Reconnect.',
    );
    // ONE sentence on a slow wait (decided 2026-10-15): the flows draw no slow line of their own.
    for (const f of ['components/HwwConnectFlow.tsx', 'components/LedgerConnectFlow.tsx']) {
      expect(read(find(f))).not.toMatch(/Still (working|not connecting)/);
    }
  });

  it('every search offers Reconnect, which starts the search and the connection afresh (decided 2026-10-05)', () => {
    const connect = code(read(find('components/HardwareConnect.tsx')));
    // A new key mounts the flow anew (its sessions and scans released as on
    // Back), and the Ledger kit is rebuilt for the new search.
    expect(connect).toMatch(/const reconnect = \(\) => \{\s*flagLedgerScanDead\(\);[\s\S]{0,80}setAttempt\(\(n\) => n \+ 1\);\s*\};/);
    expect(connect).toMatch(/<HwwConnectFlow\s*key=\{attempt\}/);
    // Never while the device is at work on a transaction.
    expect(connect).toMatch(/<StepLink label=\{RECONNECT\} onPress=\{reconnect\} \/>/);
    expect(connect).toMatch(/export const RECONNECT = 'Reconnect';/);
    // "Replace signing device" lives in the vault's menu, not under a search.
    expect(code(read(find('screens/WalletDetailScreen.tsx')))).toMatch(/label: 'Replace signing device'/);
    for (const u of ['components/HardwareConnect.tsx', 'screens/VerifyAddressScreen.tsx', 'screens/RegisterHardwareScreen.tsx', 'screens/SignPsbtScreen.tsx', 'screens/RefreshSessionScreen.tsx']) {
      expect({ u, moved: /onMoved|REPLACE_DEVICE/.test(read(find(u))) }).toEqual({ u, moved: false });
    }
  });

  it('the address check lists only keys a device can show it for, and says to register first when none is left', () => {
    const verify = code(read(find('screens/VerifyAddressScreen.tsx')));
    expect(verify).toMatch(/stepKeysOf\(wallet, addressCheckKeysOf\(wallet, checkKeyIds\), known21C\)/);
    expect(verify).toMatch(/const registerFirst = checkKeyIds\.length > 0 && ownKeys\.length === 0;/);
    // The refusal the task would have thrown, said before any search, from
    // the one place that sentence lives.
    expect(verify).toMatch(/<Text style=\{styles\.body\}>\{REGISTER_FIRST\}<\/Text>/);
    expect(verify).not.toMatch(/Register this vault on your hardware first/);
    // Receive offers the check only where a device can do it: one rule, tested
    // in the wallet layer (a single key kept by its bare xpub is never offered).
    const receive = code(read(find('screens/ReceiveScreen.tsx')));
    expect(receive).toMatch(/const canVerifyOnHardware = addressCheckOffered\(wallet, known21C\);/);
    expect(receive).not.toMatch(/vaultIsLedgerBound|singleSigDevice|deviceCan\(/);
  });

  it('a bare brand asked from a key row keeps the key’s name as the way back, over the brand', () => {
    const picker = code(read(find('components/DevicePicker.tsx')));
    expect(picker).toMatch(/auto != null && back \? \(\s*<>\s*<BrandHeader name=\{back\.name\} onBack=\{back\.onBack\} \/>\s*<BrandHeader name=\{open\.name\} \/>\s*<\/>/);
    expect(picker).not.toMatch(/back\?\.onBack/);
  });

  it('the signing screen waits for 21st Capital’s fingerprints before a key row can be tapped', () => {
    // Until the fetch lands, our key on an imported vault reads as a key of
    // the owner's with no record, and a tap on it asked "Which device?".
    const sign = code(read(find('screens/SignPsbtScreen.tsx')));
    expect(sign).toMatch(/const \{ providerFps, settled: fpsSettled \} = useProviderFingerprints\(wallet\);/);
    expect(sign).not.toMatch(/fetchKnown21CFingerprints/);
    expect(sign).toMatch(/\{!fpsSettled && <Text style=\{styles\.sub\}>Reading this vault&apos;s keys…<\/Text>\}/);
    expect(sign).toMatch(/\{fpsSettled && activeLayer != null && vaultPaths\?\.locked\[activeLayer\] && \(/);
    expect(sign).toMatch(/\{fpsSettled && activeLayer == null && \(vaultPaths\?\.keys \?\? \[\]\)\.map/);
    expect(sign.match(/\{fpsSettled && activeLayer == null && !replaces && /g)).toHaveLength(2);
    // The one-key vault's own jump onto the device waits the same way.
    expect(sign).toMatch(/if \(soloOpened\.current \|\| !fpsSettled \|\| entryJumping \|\| !soloKey \|\| phase !== 'choose'\) return;/);
  });

  it('a signed key on a brand-only record is marked in the state’s colour too', () => {
    const tile = code(read(find('components/KeyDeviceTile.tsx')));
    expect(tile).toMatch(/<ProviderTile provider=\{record\.kind\} size=\{DEVICE_ROW_MARK\} \/>\s*\{color != null && <View style=\{\[styles\.wash, \{ backgroundColor: color \}\]\} pointerEvents="none" \/>\}/);
    expect(tile).toMatch(/themedStyles\(/);
  });
});

describe('user-visible copy names no adopted brand outside the registry', () => {
  // A brand may be named once a device has ANSWERED (the live ceremony, an
  // error about the device in hand, a record of what was found). It may never
  // be named in a question, a list or an instruction the owner reads before
  // connecting: that is what the registry's own notes are for.
  const ALLOWED = [
    // The ceremony and its errors: a device is in hand by then.
    'components/HwwConnectFlow.tsx',
    'components/LedgerConnectFlow.tsx',
    'components/BitboxPairing.tsx',
    'hooks/useSigningCourier.tsx',
    'hww/passportBinding.ts',
    // Refusals naming the device the owner just connected.
    'screens/VerifyAddressScreen.tsx',
    'screens/RefreshSessionScreen.tsx',
    'screens/SignPsbtScreen.tsx',
    'screens/ReplaceDeviceScreen.tsx',
    'screens/RegisterHardwareScreen.tsx',
    'screens/WalletDetailScreen.tsx',
    'screens/LayeredVaultScreen.tsx',
    // The import catalogue: the owner is telling US which product they own.
    'screens/importProviders.ts',
    'screens/ImportScreen.tsx',
    'components/ProviderLogo.tsx',
  ];
  const BRANDS = /\b(Ledger|BitBox|Passport)\b/;

  it('lists every file that may still name one', () => {
    const offenders = files
      .filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      .filter((f) => {
        // Comments explain the code and are not read by clients.
        const code = read(f)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        return [...code.matchAll(/['"`]([^'"`\n]{4,})['"`]/g)].some((m) => BRANDS.test(m[1]));
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
