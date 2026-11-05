/**
 * Signing on the hardware, design A "The courier" (decided 2026-10-03: "yes,
 * build it"). Structural, like sentPage and speedUpAndCancel: the repo has no
 * component tests, and each rule below is a line a later edit could quietly
 * drop. The behaviour itself is pinned in ui/hww/__tests__.
 *
 *   - the drawings' colours live in ONE module, the device-art palette;
 *     everything else in them, and in the courier, is a theme token;
 *   - no progress bar on the BitBox or on the client's turn;
 *   - motion is opacity and transforms on the native driver, never a layout
 *     value, and nothing is dimmed with an opacity style;
 *   - no em dash in anything a client reads;
 *   - a device that signs a finished spend lands on the Sent page after the
 *     broadcast, through the screen's one broadcast;
 *   - only SIGNING draws the courier, and through ONE hook
 *     (`hooks/useSigningCourier`): the signing screen and the refresh session
 *     (decided 2026-10-05: "build the courier for refresh session too"), leg after
 *     leg for a batch; registration and the address check never get it;
 *   - a drawn screen prints in the device's own size, never the phone's text
 *     size, and from the places `deviceScreenLayout.ts` gives it (where
 *     `components/__tests__/deviceScreenLayout.test.ts` measures every page);
 *   - the review tour goes round again for as long as the client's turn lasts;
 *   - the press hint (design C, decided 2026-10-03) moves on the tour's one clock,
 *     never on a layout value, never draws over the device's words, prints
 *     its pills in the picture's own size, and the gesture line says what it
 *     shows (`components/__tests__/pressHintScript.test.ts`,
 *     `pressHintPlacement.test.tsx`, `signingTour.test.tsx`), and the
 *     drawings draw what its clock gives them (`deviceProgress.test.tsx`).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const ROOT = join(UI, '..', '..');
/** The public note on hardware signing; the tests below hold it to the code. */
const DOC = join(ROOT, 'docs', 'hardware-signing.md');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The source from `from` up to the next `to` after it. Both must exist. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect({ from, found: a >= 0 }).toEqual({ from, found: true });
  const b = src.indexOf(to, a + from.length);
  expect({ to, found: b >= 0 }).toEqual({ to, found: true });
  return src.slice(a, b);
}

/** Where each `useMemo(` call opens and closes in `src` (its parentheses
 *  balanced; the drawings put no parenthesis in a string). */
function memoBodies(src: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of src.matchAll(/useMemo\(/g)) {
    const from = m.index ?? 0;
    let depth = 0;
    for (let i = from + 'useMemo'.length; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) {
        spans.push([from, i]);
        break;
      }
    }
  }
  return spans;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const PALETTE = 'components/deviceArtPalette.ts';
const DRAWINGS = [
  'components/DeviceArt.tsx',
  'components/DeviceArtParts.tsx',
  'components/LedgerTouchArt.tsx',
  'components/NanoXArt.tsx',
  'components/NovaArt.tsx',
  'components/LedgerSlabArt.tsx',
  'components/deviceScreenLayout.ts',
];
const COURIER = 'components/SigningCourier.tsx';
/** The one hook that wires the courier for every screen that signs. */
const HOOK = 'hooks/useSigningCourier.tsx';
const SIGN = 'screens/SignPsbtScreen.tsx';
const SESSION = 'screens/RefreshSessionScreen.tsx';
const TOUR = 'components/SigningTour.tsx';
const TURN = 'components/DeviceTurn.tsx';
const SLIDE = 'components/TurnSlide.tsx';
const HINT = 'components/PressHint.tsx';
const HINT_SCRIPT = 'components/pressHintScript.ts';
const PURE = ['hww/signingCeremony.ts', 'hww/signingDevice.ts', 'hww/deviceTurns.ts', 'hww/deviceSteps.ts', 'hww/vaultRegistration.ts', 'hww/addressCheck.ts', 'hww/nanoFont.ts', HINT_SCRIPT];

describe('the drawings’ colours live in one place', () => {
  it('no colour literal in a drawing, the courier or the hint: the palette, or a theme token', () => {
    for (const rel of [...DRAWINGS, COURIER, TOUR, TURN, SLIDE, HINT, ...PURE]) {
      const src = code(read(rel));
      expect({ rel, hex: src.match(/['"]#[0-9a-fA-F]{3,8}['"]/g) ?? [] }).toEqual({ rel, hex: [] });
      expect({ rel, rgb: src.match(/\brgba?\(/g) ?? [] }).toEqual({ rel, rgb: [] });
      // No CSS colour words either ("white", "black", "orange"): only 'none'
      // and 'transparent' are no colour at all.
      const named = (src.match(/(?:fill|stroke|stopColor|color|backgroundColor|borderColor)=?:?\s*\{?['"]([a-z]+)['"]/g) ?? []).filter(
        (m) => !/['"](none|transparent)['"]/.test(m),
      );
      expect({ rel, named }).toEqual({ rel, named: [] });
    }
  });

  it('the palette holds the products’ colours and nothing else imports a hex', () => {
    const palette = code(read(PALETTE));
    expect(palette).toMatch(/export const EINK = /);
    expect(palette).toMatch(/export const NANO_X = /);
    expect(palette).toMatch(/export const NOVA = /);
    // The drawings take their paint from it.
    for (const rel of ['components/LedgerTouchArt.tsx', 'components/NanoXArt.tsx', 'components/NovaArt.tsx']) {
      expect(read(rel)).toMatch(/from '\.\/deviceArtPalette'/);
    }
    // The palette is the drawings' alone: no screen paints with it.
    const users = sources(UI)
      .filter((f) => /deviceArtPalette/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(UI.length + 1))
      .filter((f) => f !== PALETTE)
      .sort();
    expect(users).toEqual(['components/LedgerTouchArt.tsx', 'components/NanoXArt.tsx', 'components/NovaArt.tsx']);
  });

  it('the hardware-signing doc names the exception', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/deviceArtPalette\.ts/);
    expect(doc).toMatch(/sanctioned exception/i);
  });
});

describe('no bar on the BitBox, none on the client’s turn', () => {
  it('the courier draws a bar only where the path says bar', () => {
    const src = code(read(COURIER));
    const bars = src.match(/<Bar\b/g) ?? [];
    expect(bars).toHaveLength(1);
    expect(src).toMatch(/\{path\.kind === 'bar' && <Bar /);
    expect(src).toMatch(/const path = pathFor\(brandOf\(drawing\), state\.leg\);/);
    // The old pair of bars is not used by signing any more.
    expect(code(read('screens/SignPsbtScreen.tsx'))).not.toMatch(/setProgress\(/);
  });

  it('the BitBox run counts no messages and starts no clock', () => {
    const hook = code(read(HOOK));
    const bitbox = between(hook, 'const signOnBitbox = useCallback(', 'return useMemo(');
    expect(bitbox).not.toMatch(/watchLedgerActivity|setInterval|type: 'tick'/);
    expect(bitbox).toMatch(/feed\.start\(\{ brand: 'bitbox', readEstimate: 0, signEstimate: 0, nameFirst: false, batch: job\.batch \?\? null \}, Date\.now\(\)\);/);
    expect(bitbox).toMatch(/setTimeout\(\(\) => feed\.push\(\{ type: 'handedOver' \}\), HANDOVER_MS\)/);
    // The Ledger run reads the conversation and the clock; the BitBox's is the only other run.
    const ledger = between(hook, 'const signOnLedger = useCallback(', 'const signOnBitbox = useCallback(');
    expect(ledger).toMatch(/watchLedgerActivity\(\(n\) => feed\.push\(\{ type: 'messages', count: n, at: Date\.now\(\) \}\)\)/);
    expect(ledger).toMatch(/setInterval\(\(\) => feed\.push\(\{ type: 'tick', at: Date\.now\(\) \}\), TICK_MS\)/);
    expect(hook.match(/useCallback\(\s*async \(ctx:/g)).toHaveLength(2);
    // No screen signs on a device, counts a message or starts a feed itself.
    for (const rel of [SIGN, SESSION]) {
      const src = code(read(rel));
      expect({ rel, own: /feed\.start\(|watchLedgerActivity|signLedgerPsbt\(|session\.signPsbt\(|mergeLedgerSignatures\(|<SigningCourier\b/.test(src) }).toEqual({ rel, own: false });
      // The line that is no longer true ("key by key") is gone from signing.
      expect({ rel, keyByKey: /key by key/.test(src) }).toEqual({ rel, keyByKey: false });
    }
  });
});

describe('motion on the native driver, colour never opacity', () => {
  it('every animation runs on the native driver and moves only opacity and transforms', () => {
    for (const rel of [...DRAWINGS, COURIER, TOUR, TURN, SLIDE, HINT]) {
      const src = code(read(rel));
      expect({ rel, js: /useNativeDriver:\s*false/.test(src) }).toEqual({ rel, js: false });
      const timings = src.match(/Animated\.timing\([^)]*\{[^}]*\}/g) ?? [];
      for (const t of timings) expect({ rel, t, native: /useNativeDriver:\s*true/.test(t) }).toEqual({ rel, t, native: true });
      // An Animated value is bound only to opacity or a transform, never a
      // layout value (width, height, a margin, a position).
      const bound = src.match(/(width|height|left|top|right|bottom|margin\w*|padding\w*):\s*(v|vals|rot|fill|x)\b(?!\w)/g) ?? [];
      expect({ rel, bound }).toEqual({ rel, bound: [] });
    }
  });

  it('themed, wrapped sheets; no style dims anything with opacity', () => {
    for (const rel of [...DRAWINGS, COURIER, TOUR, TURN, SLIDE, HINT]) {
      const src = code(read(rel));
      expect({ rel, bare: /=\s*StyleSheet\.create\(/.test(src) }).toEqual({ rel, bare: false });
      if (/StyleSheet\.create/.test(src)) expect(src).toMatch(/themedStyles\(/);
      // `opacity` appears only as an animated binding ({ opacity: v }), never a fixed dim.
      const fixed = src.match(/\bopacity:\s*[0-9.]+/g) ?? [];
      expect({ rel, fixed }).toEqual({ rel, fixed: [] });
    }
    // The greyed phone on the client's turn is a colour.
    expect(code(read(COURIER))).toMatch(/const stroke = muted \? theme\.colors\.faint : theme\.colors\.offWhite;/);
  });
});

describe('no em dash in anything a client reads', () => {
  it('the courier, its hook, the turn page, the drawings, the hint and the pure modules', () => {
    for (const rel of [...DRAWINGS, COURIER, HOOK, TOUR, TURN, SLIDE, HINT, ...PURE, PALETTE]) {
      const strings = code(read(rel)).match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect({ rel, dashes: strings.filter((s) => /[—–]/.test(s)) }).toEqual({ rel, dashes: [] });
    }
  });
});

describe('the Sent page after the broadcast', () => {
  const sign = code(read('screens/SignPsbtScreen.tsx'));

  it('a device that finishes the spend sends it from the ceremony, through the one broadcast', () => {
    const finish = between(sign, 'const finishFromDevice = async', 'const recordFor');
    // Merged as before, then sent only when it completes the spend and the
    // client is still there; the bar holds (sending) until the network answers.
    expect(finish).toMatch(/await acceptSignedPsbt\(bytes, \{/);
    expect(finish).toMatch(/if \(got\.final == null \|\| !alive\(\)\) return;/);
    expect(finish.indexOf("feed.push({ type: 'sending' })")).toBeLessThan(finish.indexOf('await onBroadcast(false, got.final)'));
    // Anything that stops the send lands on the review page with its Send button.
    expect(finish).toMatch(/if \(!sent\) setPhase\('ready'\);/);
    // The broadcast itself still ends on the Sent page (sentPage.test pins it too).
    const broadcast = between(sign, 'const onBroadcast = async', 'const sentKind');
    expect(broadcast.indexOf("setPhase('done')")).toBeGreaterThan(broadcast.search(/\.broadcast(Psbt|RawTx)\(/));
    expect(broadcast).toMatch(/const final = given \?\? completed;/);
    // A fee confirmation sends the same transaction it was asked about.
    expect(broadcast).toMatch(/onPress: \(\) => void onBroadcast\(true, given\)/);
  });

  it('both brands finish through it, and never on the review page by themselves', () => {
    const ledger = between(sign, 'ledgerTask={async (ctx) => {', 'bitboxTask={async (ctx) => {');
    const bitbox = between(sign, 'bitboxTask={async (ctx) => {', '/>\n');
    // The signing screen hands its broadcast to the run as the follow-up,
    // which runs inside the run's try: a send that fails lands on Not signed.
    expect(ledger).toMatch(/await signing\.signOnLedger\(\s*ctx,\s*spec\.spec,\s*\{ psbt: workingPsbtRef\.current, parsed, keyName: courierKeyName \},\s*\(signed\) => finishFromDevice\(signed\.bytes, ctx\.alive\),\s*\);/);
    expect(bitbox).toMatch(/await signing\.signOnBitbox\(\s*ctx,\s*bitboxSpec,\s*\{ psbt: workingPsbtRef\.current, parsed, keyName: courierKeyName \},\s*\(signed\) => finishFromDevice\(signed\.bytes, ctx\.alive\),\s*\);/);
    for (const task of [ledger, bitbox]) expect(task).not.toMatch(/acceptSignedPsbt\(/);
    // In the one hook, both runs: the signed page stays a beat, the follow-up
    // comes after it, and a failure lands on Not signed.
    const hook = code(read(HOOK));
    const runs = [
      between(hook, 'const signOnLedger = useCallback(', 'const signOnBitbox = useCallback('),
      between(hook, 'const signOnBitbox = useCallback(', 'return useMemo('),
    ];
    for (const run of runs) {
      expect(run).toMatch(/feed\.push\(\{ type: 'signed' \}\);/);
      expect(run).toMatch(/await wait\(SIGNED_HOLD_MS\);\s*if \(!ctx\.alive\(\)\) return null;\s*const signed = \{ base64: \w+, bytes \};\s*await after\?\.\(signed\);\s*return signed;/);
      expect(run).toMatch(/feed\.push\(failureSignal\(e\)\);\s*throw e;/);
      // A client who left mid-way commits nothing.
      expect(run).toMatch(/if \(!ctx\.alive\(\)\) return null;\s*feed\.push\(\{ type: 'signed' \}\);/);
    }
    // QR and file signing keep their review page.
    expect(between(sign, 'const acceptSignedPsbt = async', 'const acceptRawTx')).toMatch(/else setPhase\('ready'\);/);
  });

  it('leaving cannot strand a transaction on its way: Back is held and the header waits', () => {
    expect(sign).toMatch(/if \(phase === 'bluetooth' && feed\.get\(\)\?\.sending\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
    expect(code(read(COURIER))).toMatch(/disabled=\{back === 'held'\}/);
  });
});

describe('the turns are the flows\u2019 own, for every purpose; only signing adds the courier', () => {
  it('the courier is mounted by the one hook alone, which the two signing screens use; the turn page by the two flows alone; no screen passes one', () => {
    const courier = sources(UI)
      .filter((f) => /<SigningCourier\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(UI.length + 1));
    expect(courier).toEqual([HOOK]);
    // The ceremony page travels from the hook through the step to the flows:
    // the two screens pass what the hook gives them, nothing of their own.
    const passers = sources(UI)
      .filter((f) => /\bceremony=\{/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(UI.length + 1))
      .sort();
    expect(passers).toEqual(['components/HardwareConnect.tsx', 'components/HwwConnectFlow.tsx', SESSION, SIGN]);
    const users = sources(UI)
      .filter((f) => /useSigningCourier\(wallet\)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(UI.length + 1))
      .sort();
    expect(users).toEqual([SESSION, SIGN]);
    for (const rel of [SESSION, SIGN]) {
      const src = code(read(rel));
      expect({ rel, locked: /locked=\{signing\.courier != null\}/.test(src) }).toEqual({ rel, locked: true });
      expect({ rel, page: /ceremony=\{signing\.ceremony\}/.test(src) }).toEqual({ rel, page: true });
      // The courier's buttons are the page footer's, through the same hook
      // (decided 2026-10-05: every page's actions at the bottom).
      expect({ rel, foot: /signing\.footer\(/.test(src) }).toEqual({ rel, foot: true });
      // Leaving the step clears the courier and its feed through the hook.
      expect({ rel, reset: /const \{ (feed, )?reset: resetSigning \} = signing;/.test(src) && /resetSigning\(\);/.test(src) }).toEqual({ rel, reset: true });
    }
    // Decided 2026-10-04, device first: "show him all the animations we built for
    // each device both during SETUP and during signing". The flows draw the
    // turns themselves, so setup, import, replacement, registration, the
    // address check, the refresh session and signing get the same pages.
    const turn = sources(UI)
      .filter((f) => /<DeviceTurn\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(UI.length + 1))
      .sort();
    expect(turn).toEqual(['components/HwwConnectFlow.tsx', 'components/LedgerConnectFlow.tsx']);
    const passed = sources(UI)
      .filter((f) => /\bdeviceTurn=\{|\bbitboxTurn=\{|\bsearchTurn=\{/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(UI.length + 1));
    expect(passed).toEqual([]);
  });

  it('the flows draw the turns on the device expected or found, and say so only when a page is drawn', () => {
    const ledger = code(read('components/LedgerConnectFlow.tsx'));
    expect(ledger).toMatch(/if \(ceremony && \(state\.kind === 'working' \|\| state\.kind === 'done' \|\| state\.kind === 'error'\)\)/);
    // The PIN, the app to open and the vault's approval, on the device the kit found.
    expect(ledger).toMatch(/if \(state\.kind === 'working' && state\.ask != null && deviceRef\.current != null\)/);
    expect(ledger).toMatch(/<DeviceTurn drawing=\{drawingFor\('ledger', deviceRef\.current\.model\)\} ask=\{state\.ask\} network=\{network\} register=\{state\.register\} address=\{state\.address\} \/>/);
    // A ceremony on its way keeps its pages even when the device locks again mid-way.
    expect(ledger.indexOf('if (ceremony && (state.kind')).toBeLessThan(ledger.indexOf("if (state.kind === 'working' && state.ask != null"));
    // Only an ask with a page is a turn, and only then is the screen told;
    // the vault's facts come with the device layer's step and serve the
    // kit's own 'confirm-register' prompt after it.
    expect(ledger).toMatch(/if \(register\) registerRef\.current = register;\s*if \(address\) addressRef\.current = address;\s*const facts = ask === 'register' \? registerRef\.current : null;/);
    // The address check's facts travel the same way (decided 2026-10-04, three phone test videos).
    expect(ledger).toMatch(/if \(address\) addressRef\.current = address;\s*const facts = ask === 'register' \? registerRef\.current : null;\s*const shown = ask === 'address' \? addressRef\.current : null;/);
    expect(ledger).toMatch(/let page = ask != null && hasTurnPage\(drawing, ask, facts, shown\) \? ask : null;/);
    // The search's unlock page stays while the device connects and the app
    // opens (decided 2026-10-04: a pairing line flashed during the PIN entry); the
    // pairing line joins it only once the connection runs slow.
    expect(ledger).toMatch(/if \(page == null && ask == null && text === OPENING_APP && carriedRef\.current != null\) page = carriedRef\.current;/);
    expect(ledger).toMatch(/carriedRef\.current = hasTurnPage\(drawing, 'unlock', null\) \? 'unlock' : null;/);
    expect(ledger).toMatch(/if \(state\.kind === 'connecting' && connectingDrawing != null && hasTurnPage\(connectingDrawing, 'unlock', null\)\)/);
    expect(ledger).toMatch(/\{pairingSlow && \(/);
    expect(ledger).toMatch(/export const PAIRING_LINE_AFTER_MS = 1500;/);
    // The search reports only an open page; its close is the cleanup's, so the
    // Ledger flow's own page, reported as it mounts, is never overwritten.
    const hwwFlow = code(read('components/HwwConnectFlow.tsx'));
    expect(hwwFlow).toMatch(/if \(turnAsk != null\) onDeviceTurnRef\.current\?\.\(turnAsk\);/);
    expect(ledger).toMatch(/setState\(\{ kind: 'working', step: text, ask: page, register: facts \?\? undefined, address: shown \?\? undefined \}\);\s*onDeviceTurnRef\.current\?\.\(page\);/);
    // The PIN, the app, the vault shown for approval ('register') and the address shown for comparison ('address').
    expect(ledger).toMatch(/const askOf = \(p: LedgerPrompt\): DeviceAsk \| null =>\s*p === 'unlock' \|\| p === 'open-app' \? p : p === 'confirm-register' \? 'register' : p === 'verify-address' \? 'address' : null;/);
    // After the PIN the link is rebuilt: the PIN page goes and the flow says so.
    expect(ledger).toMatch(/openBitcoinAppReady\(device, sessionId, network, onPrompt, \(\) =>\s*setStep\('Connecting to the Ledger again…'\),?\s*\)/);
    const platform = readFileSync(join(UI, '..', 'platform', 'ledger.ts'), 'utf8');
    expect(platform).toMatch(/onPrompt\?\.\(null\);\s*onReconnect\?\.\(\);[\s\S]{0,400}fresh = await connectLedger\(device\);/);
    // The flow's own lines for the prompts with no page.
    expect(ledger).toMatch(/unlock: 'Enter the PIN on the Ledger\.'/);
    // No scan of its own: the search hands it the device (decided 2026-09-22).
    expect(ledger).not.toMatch(/startLedgerScan|kind: 'scanning'/);
    const hww = code(read('components/HwwConnectFlow.tsx'));
    // The ceremony takes over from the first pairing's code screen as well.
    expect(hww).toMatch(/ceremony &&\s*\(state\.kind === 'bitbox-step' \|\| state\.kind === 'bitbox-code' \|\| \(state\.kind === 'error' && state\.bitbox\)\)/);
    expect(hww).toMatch(/ceremony=\{ceremony\}/);
    expect(hww).toMatch(/onDeviceTurn=\{onDeviceTurn\}/);
    // The expected device unlocking WHILE the search runs (decided 2026-10-04: a
    // device is found only once it is unlocked), the BitBox's side first;
    // the BitBox's password once found, until the unlock and pairing answered.
    expect(hww).toMatch(/const searchDrawing = drawingOfModel\(expect\);/);
    expect(hww).toMatch(/const searchAsk: DeviceAsk = searchDrawing === 'nova' \? 'side' : 'unlock';/);
    expect(hww).toMatch(/const searchPage = searchDrawing != null && hasTurnPage\(searchDrawing, searchAsk\);/);
    expect(hww).toMatch(/const searchTurnUp = state\.kind === 'scanning' && searchPage;/);
    expect(hww).toMatch(/const bitboxTurnUp = state\.kind === 'bitbox-step' && state\.turn != null && hasTurnPage\('nova', state\.turn, state\.register, state\.address\);/);
    expect(hww).toMatch(/onDeviceTurnRef\.current\?\.\(turnAsk\);/);
    expect(hww).toMatch(/<DeviceTurn drawing=\{searchDrawing\} ask=\{searchAsk\} network=\{network\} \/>/);
    expect(hww).toMatch(/<DeviceTurn drawing="nova" ask=\{state\.turn\} network=\{network\} register=\{state\.register\} address=\{state\.address\} \/>/);
    expect(hww).toMatch(/setState\(\{ kind: 'bitbox-step', message: 'Connecting…', turn: 'unlock' \}\)/);
    expect(hww).toMatch(/if \(code\) setState\(\{ kind: 'bitbox-code', code \}\);/);
    // A step's ask reaches the flow's state with the vault's facts, so a turn with a page is drawn.
    expect(hww).toMatch(/setState\(\{ kind: 'bitbox-step', message, turn: ask, register, address \}\)/);
    // The screens drop their own heading while a turn's page carries one,
    // and the two that sign while the courier draws the page.
    for (const rel of [SIGN, SESSION]) {
      const src = code(read(rel));
      expect({ rel, hides: /\{signing\.courier == null && turn == null && \(/.test(src) && /onTurn=\{setTurn\}/.test(src) }).toEqual({ rel, hides: true });
    }
    for (const rel of ['screens/RegisterHardwareScreen.tsx', 'screens/ReplaceDeviceScreen.tsx']) {
      const src = code(read(rel));
      expect({ rel, hides: /\{turn == null && \(/.test(src) && /onTurn=\{setTurn\}/.test(src) }).toEqual({ rel, hides: true });
    }
  });

  it('the drawing comes from the model the kit reports at discovery', () => {
    const platform = readFileSync(join(ROOT, 'src/platform/ledger.ts'), 'utf8');
    expect(platform).toMatch(/model: d\.deviceModel\.model,/);
    expect(code(read(HOOK))).toMatch(/drawing: drawingFor\('ledger', ctx\.device\.model\),/);
    expect(code(read(HOOK))).toMatch(/drawing: drawingFor\('bitbox'\),/);
  });
});

describe('the card and the drawing say what the device says', () => {
  it('the BitBox names the vault by the name it stored, never by today’s label', () => {
    // What a BitBox signs with is read off the registration's answer in ONE
    // place for every screen (`bitboxSigningSpec`), the stored name with it.
    const hook = code(read(HOOK));
    const spec = between(hook, 'export function bitboxSigningSpec(', 'export interface SigningCourierHandle');
    expect(spec).toMatch(/const storedName = reg\.alreadyRegistered \? bitboxRegisteredName\(wallet\.bitboxRegistrations, fingerprint\) : policy\.name;/);
    expect(spec).toMatch(/if \(reg\.standard\) return \{ policy: null, account: null, storedName: null \};/);
    const bitbox = between(hook, 'const signOnBitbox = useCallback(', 'return useMemo(');
    expect(bitbox).toMatch(/registeredName: spec\.storedName,/);
    expect(bitbox).not.toMatch(/registeredName: [^,]*(policy\.name|label)/);
    for (const rel of [SIGN, SESSION]) {
      const src = code(read(rel));
      expect({ rel, through: /const bitboxSpec = bitboxSigningSpec\(wallet, ctx\.fingerprint, reg\);/.test(src) }).toEqual({ rel, through: true });
      expect({ rel, own: /descriptorToBitboxPolicy\(|bitboxAccountKeypath\(|bitboxRegisteredName\(/.test(src) }).toEqual({ rel, own: false });
    }
  });

  it('every registration goes through the one device layer, which keeps the name the BitBox stored', () => {
    // 2026-10-04: the inline registrations of the signing screen, the address
    // check and the refresh session went through `registerVault`, so the
    // moment the device asks for the vault's approval reaches the flows from
    // ONE place (the Ledger kit's 'confirm-register', the BitBox's
    // setStep(…, 'register')), ready for the page that will draw it.
    const registers = sources(UI)
      .filter((f) => /\.registerPolicy\(|\.isPolicyRegistered\(|registerLedgerPolicy\(/.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(UI.length + 1));
    expect(registers).toEqual(['hww/connectedDevice.ts']);
    const device = code(read('hww/connectedDevice.ts'));
    // A marker without the name is how the label crept onto the card.
    expect(device).not.toMatch(/\]: \{ registeredAt: Date\.now\(\) \}/);
    expect(device).toMatch(/const name = already \? bitboxRegisteredName\(wallet\.bitboxRegistrations, fp\) : policy\.name;/);
    // Each brand's turn for the approval is reported with the step AND the
    // facts its pages are drawn from (phone test videos, 2026-10-04); the Ledger's
    // kit prompt that follows reaches the flow through askOf and keeps them.
    expect(device).toMatch(/ctx\.setStep\('Check the vault on the device’s screen and approve it there\.', 'register', registerFacts\(wallet, fp\) \?\? undefined\);/);
    expect(device).toMatch(/ctx\.setStep\('Check each key on the device’s screen and approve it there\.', 'register', registerFacts\(wallet, fp\) \?\? undefined\);/);
    expect(device).toMatch(/registerLedgerPolicy\(ctx\.sessionId, policy, ctx\.onPrompt\)/);
    expect(device.indexOf("'register', registerFacts(wallet, fp)")).toBeLessThan(device.indexOf('registerLedgerPolicy(ctx.sessionId'));
    expect(device.lastIndexOf("'register', registerFacts(wallet, fp)")).toBeLessThan(device.indexOf('ctx.session.registerPolicy('));
    const ledger = code(read('components/LedgerConnectFlow.tsx'));
    expect(ledger).toMatch(/p === 'confirm-register' \? 'register' : p === 'verify-address' \? 'address' : null/);
    const hww = code(read('components/HwwConnectFlow.tsx'));
    expect(hww).toMatch(/setStep: \(message: string, ask\?: DeviceAsk, register\?: RegisterFacts, address\?: AddressFacts\) => void;/);
    // The facts are built in the device layer alone: no screen draws its own.
    const builders = sources(UI)
      .filter((f) => /registerFacts\(/.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(UI.length + 1))
      .sort();
    expect(builders).toEqual(['hww/connectedDevice.ts', 'hww/vaultRegistration.ts']);
    // The screens read what the device layer answered, never register by hand.
    for (const rel of ['screens/SignPsbtScreen.tsx', 'screens/VerifyAddressScreen.tsx', 'screens/RefreshSessionScreen.tsx']) {
      expect({ rel, through: /\.registerVault\(wallet\)/.test(code(read(rel))) }).toEqual({ rel, through: true });
    }
  });

  it('each brand is refused by its OWN blocker before it is asked anything (decided 2026-10-17)', () => {
    // The BitBox adapter asked the Ledger's blocker, which takes a bare
    // sh(multi), so a BitBox met that vault's refusal only at signing time.
    const device = code(read('hww/connectedDevice.ts'));
    const ledger = between(device, 'export function ledgerDevice(', 'export function bitboxDevice(');
    const bitbox = device.slice(device.indexOf('export function bitboxDevice('));
    expect(ledger).toMatch(/const blocker = ledgerPolicyBlocker\(wallet\.descriptor\);\s*if \(blocker\) throw new Error\(blocker\);/);
    expect(bitbox).toMatch(/const blocker = bitboxPolicyBlocker\(wallet\.descriptor\);\s*if \(blocker\) throw new Error\(blocker\);/);
    expect(bitbox).not.toMatch(/ledgerPolicyBlocker\(/);
    expect(bitbox.indexOf('bitboxPolicyBlocker(')).toBeLessThan(bitbox.indexOf('ctx.session.isPolicyRegistered('));
    // The screens that drive a BitBox themselves ask the same one first.
    for (const rel of ['screens/SignPsbtScreen.tsx', 'screens/VerifyAddressScreen.tsx', 'screens/RefreshSessionScreen.tsx']) {
      const src = code(read(rel));
      const task = src.slice(src.indexOf('bitboxTask'));
      expect({ rel, asks: task.indexOf('bitboxPolicyBlocker(wallet.descriptor)') >= 0 && task.indexOf('bitboxPolicyBlocker(wallet.descriptor)') < task.indexOf('.registerVault(wallet)') }).toEqual({ rel, asks: true });
    }
  });

  it('the Ledger tour knows when the app asked the name first, and reads the facts the one way', () => {
    const ledger = between(code(read(HOOK)), 'const signOnLedger = useCallback(', 'const signOnBitbox = useCallback(');
    expect(ledger).toMatch(/nameFirst: asksNameFirst\(ctx\.appVersion, registered\),/);
    expect(ledger).toMatch(/registeredName: spec\.kind === 'registered' \? spec\.name : null,\s*nameFirst: cfg\.nameFirst,\s*parsed: job\.parsed,\s*psbt: job\.psbt,/);
    // The facts are built by the pure module for both brands; no screen builds its own.
    expect((code(read(HOOK)).match(/facts: tourFactsFor\(\{/g) ?? []).length).toBe(2);
    for (const rel of [SIGN, SESSION]) expect({ rel, facts: /tourFactsFor\(|shownOutputs\(|psbtLockTime\(/.test(code(read(rel))) }).toEqual({ rel, facts: false });
  });

  it('nothing to compare draws no card', () => {
    expect(code(read(COURIER))).toMatch(/\{rows\.length > 0 && <SentCard /);
  });
});

describe('the drawn screens hold what they print', () => {
  const TSX = DRAWINGS.filter((f) => f.endsWith('.tsx'));

  it('every word on a drawn screen is in the device’s own size, never the phone’s text size', () => {
    // A test phone reads one step larger than standard: a bare Text grew with
    // it, the Nova cut its last line and the Nano X ran into its arrows.
    for (const rel of TSX) {
      const src = code(read(rel));
      const bare = (src.match(/<Text\b/g) ?? []).length;
      expect({ rel, bare }).toEqual({ rel, bare: rel === 'components/DeviceArtParts.tsx' ? 1 : 0 });
    }
    const parts = code(read('components/DeviceArtParts.tsx'));
    // The one Text: ScreenText's own, the switch after the spread so no
    // caller can turn it back on.
    expect(parts).toMatch(/export function ScreenText\(props: TextProps\): React\.JSX\.Element \{\s*return <Text \{\.\.\.props\} allowFontScaling=\{false\} \/>;/);
  });

  it('the Nova and the Nano X take their words’ places from the layout the tests measure', () => {
    const nova = code(read('components/NovaArt.tsx'));
    // Every line comes from novaRows, one line each, at its row's size.
    expect(nova).toMatch(/\{rows\(novaRows\(page\)\)\}/);
    expect(nova).toMatch(/\{rows\(novaRows\(\{ kind: 'done', ok \}\)\)\}/);
    expect(nova).toMatch(/numberOfLines=\{1\}/);
    expect(nova).toMatch(/fontSize: px\(r\.size\)/);
    // No page text typed in the drawing itself (the × is a mark).
    const literals = (nova.match(/>\{?['"][^'"]+['"]\}?</g) ?? []).filter((m) => !/×/.test(m));
    expect(literals).toEqual([]);

    const nanoX = code(read('components/NanoXArt.tsx'));
    expect(nanoX).toMatch(/const \{ rows, glyph, arrows, pin \} = nanoXLayout\(page\);/);
    expect(nanoX).toMatch(/numberOfLines=\{r\.lines\}/);
    expect(nanoX).toMatch(/left: px\(r\.left\),\s*right: px\(r\.right\),/);
    // The arrows are drawn from NANO_X_ARROW at the very edges, never an
    // icon placed beside the words.
    expect(nanoX).not.toMatch(/Chevron(Left|Right)Icon/);
    expect(nanoX).toMatch(/const a = NANO_X_ARROW;/);
  });

  it('the touchscreens show the jumping corner while they work; the Nano X keeps its dotted ring', () => {
    const touch = code(read('components/LedgerTouchArt.tsx'));
    const working = between(touch, 'const working = (words: string) =>', 'switch (screen.kind)');
    expect(working).toMatch(/<CornerMark /);
    expect(between(touch, "case 'loading':", "case 'signed':")).toMatch(/return working\(screen\.kind === 'loading' \? 'Loading transaction' : 'Signing transaction'\);/);
    expect(touch).not.toMatch(/\bSpinning\b/);
    expect(code(read('components/NanoXArt.tsx'))).toMatch(/<OledSpinner /);
    // One clock, opacity steps: the corners jump, nothing turns or glides.
    const mark = between(code(read('components/DeviceArtParts.tsx')), 'export function CornerMark(', '\n}\n');
    expect(mark).toMatch(/clock\.interpolate\(\{ \.\.\.cornerShown\(i\), extrapolate: 'clamp' \}\)/);
    expect(mark).toMatch(/opacity: shown\[i\]/);
    expect(mark).not.toMatch(/rotate/);
  });

  it('a mark builds its interpolations once, never on each redraw (decided 2026-10-03)', () => {
    // Screen 1 redraws the drawing with every message, about twelve a second.
    const parts = code(read('components/DeviceArtParts.tsx'));
    const mark = between(parts, 'export function CornerMark(', '\n}\n');
    expect(mark).toMatch(/const shown = useMemo\(\s*\(\) => WORKING_CORNERS\.map\([^]*?clock\.interpolate\([^]*?\),\s*\[clock\],?\s*\);/);
    expect((mark.match(/\.interpolate\(/g) ?? []).length).toBe(1);
    const spin = between(parts, 'export function Spinning(', '\n}\n');
    expect(spin).toMatch(/const spin = useMemo\(\(\) => rot\.interpolate\([^]*?\), \[rot\]\);/);
    // Every drawing, the tour and the hint: EACH interpolation sits inside a
    // memo (the hint's in its one builder). Counted per file, one memoised
    // interpolation used to let any number of others through (decided 2026-10-04).
    for (const rel of [...DRAWINGS, TOUR, TURN, HINT].filter((f) => f.endsWith('.tsx'))) {
      const src = code(read(rel));
      const bodies = memoBodies(src);
      const loose = [...src.matchAll(/\.interpolate\(/g)]
        .map((m) => m.index ?? 0)
        .filter((i) => !bodies.some(([a, b]) => a < i && i < b))
        .map((i) => src.slice(Math.max(0, i - 40), i + 12));
      expect({ rel, loose }).toEqual({ rel, loose: [] });
    }
    // The check itself: an interpolation outside the memo beside one inside it is found.
    const probe = 'const a = useMemo(() => v.interpolate({ x: [0] }), [v]);\nconst b = v.interpolate({ x: [1] });';
    expect(memoBodies(probe)).toHaveLength(1);
    expect([...probe.matchAll(/\.interpolate\(/g)].filter((m) => !memoBodies(probe).some(([a, b]) => a < m.index! && m.index! < b))).toHaveLength(1);
  });
});

describe('the tour goes round again', () => {
  it('the courier steps the pages on the pass’s own clock and starts again after the last', () => {
    const loop = between(code(read(TOUR)), 'export function DeviceLoop(', '\n}\n');
    const tour = between(code(read(TOUR)), 'export function SigningTour(', '\n}\n');
    expect(tour).toMatch(/const cycle = tourCycle\(pages\);/);
    expect(tour).toMatch(/return <DeviceLoop drawing=\{drawing\} width=\{width\} script=\{script\} \/>;/);
    expect(loop).toMatch(/tourNextTurnIn\(starts, elapsed, cycle\)/);
    expect(loop).toMatch(/setIndex\(tourPageAt\(starts, now, cycle\)\)/);
    // screen 2 draws the tour, keyed by the turn, and nothing else draws it.
    expect(code(read(COURIER))).toMatch(/screen === 'tour' \? \(\s*<SigningTour key=\{state\.turn\}/);
  });

  it('the hint loops with the guide: its plan is the pass’s, its clock starts again with every pass', () => {
    const loop = between(code(read(TOUR)), 'export function DeviceLoop(', '\n}\n');
    const tour = between(code(read(TOUR)), 'export function SigningTour(', '\n}\n');
    expect(tour).toMatch(/const plan = hintPlan\(drawing, pages, starts, cycle\);/);
    // Each pass's frames and hint come from the script (a turn's keypad changes with the pass).
    expect(loop).toMatch(/const \{ screens, plan \} = useMemo\(\(\) => script\.pass\(pass\), \[script, pass\]\);/);
    expect(loop).toMatch(/setPass\(Math\.floor\(now \/ cycle\)\);/);
    // One timing per pass, from where the pass stands, on the native driver.
    expect(loop).toMatch(/const from = \(Date\.now\(\) - t0\.current\) % cycle;/);
    expect(loop).toMatch(/Animated\.timing\(clock, \{ toValue: cycle, duration: Math\.max\(1, cycle - from\), easing: Easing\.linear, useNativeDriver: true \}\)/);
    expect(loop).toMatch(/\}, \[pass, reduce, cycle, plan, clock\]\);/);
    // Reduce Motion: no clock, the hint still for the frame on show; asked
    // once, and an answer after the turn closed sets nothing (askOnce).
    expect(loop).toMatch(/if \(reduce \|\| cycle <= 0 \|\| plan == null\) return;/);
    expect(code(read(TOUR))).toMatch(/useEffect\(\(\) => askOnce\(\(\) => AccessibilityInfo\.isReduceMotionEnabled\(\), setReduce\), \[\]\);/);
    expect(loop).toMatch(/useHintMotion\(plan, clock, drawing, width, reduce, at >= stillFrom\)/);
    // No second clock anywhere in the hint or the turn page.
    expect(code(read(HINT))).not.toMatch(/Animated\.(timing|loop|spring|decay)\(/);
    expect(code(read(TURN))).not.toMatch(/Animated\./);
  });

  it('nothing says the tour shows the page the device is on, and nothing says it stops', () => {
    for (const rel of [COURIER, ...PURE]) {
      const strings = code(read(rel)).match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect({ rel, claims: strings.filter((x) => /\b(now showing|is showing|on this page|current page)\b/i.test(x)) }).toEqual({ rel, claims: [] });
    }
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).not.toMatch(/review pages ONCE on a timer and stays on the last/);
    expect(doc).toMatch(/starts again from the first/);
  });
});

describe('the press hint (design C, decided 2026-10-03: "lets go with C")', () => {
  const hint = code(read(HINT));

  it('every value of the clock is built in one place, once, and bound only to an opacity or a translation', () => {
    // The one builder, in a memo: the overlay and the drawings take its values.
    const builder = between(hint, 'export function useHintMotion(', '\n}\n');
    expect(builder).toMatch(/return useMemo\(\(\) => \{/);
    expect(builder).toMatch(/clock\.interpolate\(\{ inputRange: c\.inputRange, outputRange: [^}]*extrapolate: 'clamp' \}\)/);
    expect((hint.match(/\.interpolate\(/g) ?? []).length).toBe(1);
    // The overlay binds its values to opacity and translateY, nothing else.
    for (const name of ['ring', 'fill', 'opacity', 'rise']) {
      const uses = hint.match(new RegExp(`\\w+: ${name}\\b(?!\\w)`, 'g')) ?? [];
      expect({ name, bound: uses.filter((u) => !/^(opacity|translateY): /.test(u)) }).toEqual({ name, bound: [] });
    }
    // The drawings bind the device's own progress the same way (a turn in
    // degrees is a transform too: the Nova's side arrow and its shackle).
    const nova = code(read('components/NovaArt.tsx'));
    const novaUses = nova.match(/\w+: (progress|unlock|scroll)\??\.\w+/g) ?? [];
    expect(novaUses.length).toBeGreaterThanOrEqual(13);
    expect(novaUses.filter((u) => !/^(opacity|translateY|translateX|rotate): /.test(u))).toEqual([]);
    expect(novaUses.filter((u) => /^rotate: /.test(u)).sort()).toEqual(['rotate: unlock.shackle', 'rotate: unlock.turn', 'rotate: unlock.turn']);
    // The swiped address: the line and the thumb carried sideways, nothing else (decided 2026-10-04).
    expect(novaUses.filter((u) => /^translateX: /.test(u)).sort()).toEqual(['translateX: scroll.line', 'translateX: scroll.thumb']);
    // The travelling light of the swipe is a translation too.
    expect(hint).toMatch(/transform: \[\{ translateX: along \}\]/);
    const touch = code(read('components/LedgerTouchArt.tsx'));
    expect(touch).toMatch(/transform: \[\{ scaleX: progress\.line \}\]/);
    expect(touch).toMatch(/\{ opacity: progress\.page \}/);
    expect(touch).toMatch(/\{ opacity: progress\.signing \}/);
    expect(touch.match(/progress\.\w+/g)?.filter((u) => !/^progress\.(line|page|signing)$/.test(u))).toEqual([]);
  });

  it('it is part of the picture: no touches, hidden from VoiceOver, its words never grow with the phone’s text size', () => {
    expect(hint).toMatch(/<View style=\{styles\.layer\} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">/);
    expect(hint).not.toMatch(/<Text\b/);
    expect(hint).toMatch(/<ScreenText style=\{styles\.pillText\}/);
    // The one green, its ink on the pill (white on the light palette's deeper green).
    expect(hint).toMatch(/backgroundColor: theme\.colors\.accent,/);
    expect(hint).toMatch(/color: theme\.colors\.accentInk/);
  });

  it('a pure script, no React Native: what to press per device, and when', () => {
    const script = read(HINT_SCRIPT);
    expect(script).not.toMatch(/from 'react-native'|from 'react'|require\(/);
    expect(code(script)).toMatch(/import \{ NOVA_SWIPE_MS, NOVA_TOTAL_MS, TOUCH_SIGN_MS, isTouchscreen, novaSwipeStrokesFor \} from '\.\.\/hww\/signingDevice';/);
    const turns = read('hww/deviceTurns.ts');
    expect(turns).not.toMatch(/from 'react-native'|from 'react'|require\(/);
  });

  it('the courier leaves the hint its room, so no pill reaches the title or the card', () => {
    const courier = code(read(COURIER));
    // The device's width, as pressHintPlacement.test lays the row out.
    // The row's own width once laid out (the turn pages sit inside sheets
    // padded wider than a page, decided 2026-10-04), the page's until then.
    expect(courier).toMatch(/const avail = rowW \?\? windowW - 2 \* theme\.spacing\.lg;/);
    expect(courier).toMatch(/const room = avail - PHONE_W - 2 \* theme\.spacing\.md - MIN_PATH;/);
    expect(courier).toMatch(/const PHONE_W = 36;/);
    expect(courier).toMatch(/const MIN_PATH = 64;/);
    expect(courier).toMatch(/row: \{ flexDirection: 'row', alignItems: 'center', gap: theme\.spacing\.md, paddingVertical: theme\.spacing\.sm \}/);
    expect(courier).toMatch(/inner: \{ gap: theme\.spacing\.md \}/);
    expect(courier).toMatch(/const reach = hintReach\(drawing, w, box\.h\);/);
    expect(courier).toMatch(/const slack = theme\.spacing\.sm \+ theme\.spacing\.md \+ Math\.max\(0, \(PHONE_H - box\.h\) \/ 2\);/);
    expect(courier).toMatch(/const above = Math\.max\(box\.rise, extraRoom\(reach\.above, slack, HINT_CLEAR\)\);/);
    expect(courier).toMatch(/const below = extraRoom\(reach\.below, slack, HINT_CLEAR\);/);
  });

  it('the hardware-signing doc names the hint and the Nova’s two-edge hold', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/design C, "Lit control, one word" \(decided 2026-10-03: "lets go with C"\)/);
    expect(doc).toMatch(/hold the top right edge, then the bottom right edge too/);
    expect(doc).not.toMatch(/until the arrows meet/);
  });
});

describe('the fixes of 2026-10-04 and the two turns before the transaction', () => {
  const touch = code(read('components/LedgerTouchArt.tsx'));
  const parts = code(read('components/DeviceArtParts.tsx'));

  it('the Gen5’s and the Flex’s mark is four corners round an L, the L centred between them', () => {
    const mark = between(parts, 'export function bracketMarkPath(', '\n}\n');
    expect(mark).toMatch(/const l = MARK_L;/);
    expect(mark).toMatch(/\$\{corner\(-1, -1\)\} \$\{corner\(1, -1\)\} \$\{corner\(1, 1\)\} \$\{corner\(-1, 1\)\} \$\{ell\}/);
    expect(touch.match(/bracketMarkPath\(m, u\)/g)).toHaveLength(2);
    // After a phone test on 2026-10-04: "the 'L' is not centered. There is less distance to the
    // edge on the right side than on the left." The stem sits as far left of
    // the centre as the foot reaches right, the top as far up as the foot is
    // down: with the square caps the L's box is on the centre.
    const l = parts.match(/export const MARK_L = \{ stem: ([\d.]+), top: ([\d.]+), foot: ([\d.]+), right: ([\d.]+) \} as const;/);
    expect(l).not.toBeNull();
    const [stem, top, foot, right] = l!.slice(1).map(Number);
    expect(stem).toBe(right);
    expect(top).toBe(foot);
    expect(stem).toBeGreaterThan(0.15);
  });

  it('the touchscreens’ hold is the thin line along the row’s top edge, then the ghost; no ring of the device’s own', () => {
    expect(touch).not.toMatch(/HoldRing|TOUCH_RING|RING_SEGMENTS|segments/);
    expect(touch).not.toMatch(/ A\$\{r\}/);
    const sign = between(touch, "case 'touch-sign':", "default:\n      return null;");
    expect(sign).toMatch(/transformOrigin: 'left',\s*transform: \[\{ scaleX: progress\.line \}\]/);
    expect(sign).toMatch(/top: s\.rule \* H - lineH \/ 2,/);
    expect(sign).toMatch(/\{working\('Signing transaction'\)\}/);
    expect(code(read(HINT_SCRIPT))).not.toMatch(/ownRing|RING_SEGMENTS/);
    expect(code(read(HINT))).not.toMatch(/ownRing/);
  });

  it('signed and rejected are an outlined circle, never a filled disc, on the touchscreens', () => {
    const done = between(touch, "case 'signed':", "case 'pin':");
    expect(done).toMatch(/<OutlinedDone size=\{f\(T\.doneDisc\)\} stroke=\{f\(T\.doneStroke\)\} ok=\{screen\.kind === 'signed'\} color=\{EINK\.ink\} \/>/);
    expect(done).not.toMatch(/backgroundColor/);
    const ring = between(parts, 'export function OutlinedDone(', '\n}\n');
    expect(ring).toMatch(/<Circle [^>]*fill="none" \/>/);
  });

  it('every Ledger family draws the PIN page and "Open app?"; the Nova draws neither', () => {
    for (const rel of ['components/LedgerTouchArt.tsx', 'components/NanoXArt.tsx', 'components/LedgerSlabArt.tsx']) {
      const src = code(read(rel));
      expect({ rel, pin: /case 'pin':/.test(src), open: /case 'open-app':/.test(src) }).toEqual({ rel, pin: true, open: true });
    }
    const nova = between(code(read('components/NovaArt.tsx')), "case 'pin':", 'default:');
    expect(nova).toMatch(/return null;/);
    // The touchscreens' keypad digits come from the pass's order, never typed in the drawing.
    expect(touch).toMatch(/padDigitAt\(screen\.pad, i\)/);
    expect(touch).toMatch(/Enter your PIN/);
    expect(touch).toMatch(/Open app\?/);
    expect(touch).toMatch(/Don't open/);
    // The Nano X lays its PIN row out from the measured layout.
    expect(code(read('components/NanoXArt.tsx'))).toMatch(/pin\.keys\.map\(/);
  });

  it('the turn page: the courier’s row and loop, the turn’s own words, no bar, no clock of its own', () => {
    const turn = code(read(TURN));
    expect(turn).toMatch(/<DeviceRow drawing=\{drawing\} path=\{\{ kind: 'chevrons', towardPhone: false \}\} there>/);
    expect(turn).toMatch(/<DeviceLoop key=\{ask\} drawing=\{drawing\} width=\{w\} script=\{script\} \/>/);
    expect(turn).toMatch(/const words = turnWords\(drawing, ask, network\);/);
    expect(turn).toMatch(/planFromCues\(hint, p\.cues, p\.words, p\.progress, turn\.cycle, \[\], p\.scrolls\)/);
    expect(turn).not.toMatch(/<Bar\b|useRef|setInterval|setTimeout/);
    // No sentence of its own: the words are the pure module's.
    expect(turn.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g)?.filter((x) => /[a-z]{3,} [a-z]{3,}/.test(x))).toEqual([]);
  });

  it('the hardware-signing doc names the turns and the hold line', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/2026-10-04/);
    expect(doc).toMatch(/thin dark line/i);
    expect(doc).toMatch(/deviceTurns\.ts/);
    expect(doc).toMatch(/outlined circle/i);
  });
});

describe('the BitBox after it is plugged in (decided 2026-10-04: "add two more screens for the moment the device is plugged in")', () => {
  const nova = code(read('components/NovaArt.tsx'));
  const layout = code(read('components/deviceScreenLayout.ts'));

  it('the Nova draws its five pages; every Ledger family draws none of them', () => {
    for (const k of ['nova-side', 'nova-password', 'nova-confirm', 'nova-lock', 'nova-splash']) {
      expect({ k, nova: nova.includes(`case '${k}':`) }).toEqual({ k, nova: true });
    }
    for (const rel of ['components/LedgerTouchArt.tsx', 'components/NanoXArt.tsx']) {
      const dark = between(code(read(rel)), "case 'nova-side':", 'return null;');
      expect({ rel, all: ['nova-password', 'nova-confirm', 'nova-lock', 'nova-splash'].every((k) => dark.includes(`case '${k}':`)) }).toEqual({ rel, all: true });
    }
    // The slab prints nothing for them (its words switch answers '' by default).
    expect(code(read('components/LedgerSlabArt.tsx'))).not.toMatch(/nova-/);
  });

  it('its words come from the measured layout, never typed in the drawing; no edition line', () => {
    for (const w of ['Tap this side', 'Enter password', 'abc', 'BitBox02 Nova']) {
      expect({ w, layout: layout.includes(`'${w}'`), drawing: nova.includes(w) }).toEqual({ w, layout: true, drawing: false });
    }
    expect(layout).not.toMatch(/edition/);
    expect(nova).not.toMatch(/edition/);
    // The groups along the bottom are the device's own, from the pure module.
    expect(code(read('hww/deviceTurns.ts'))).toMatch(/export const NOVA_GROUPS: readonly string\[\] = \['012', '345', '6789'\];/);
  });

  it('the side arrow turns and the shackle swings on the clock, a rotation on the native driver; the confirmation’s arrows slide as Total’s do', () => {
    const side = between(nova, "case 'nova-side':", "case 'nova-password':");
    expect(side).toMatch(/opacity: unlock\.ccw, transform: \[\{ rotate: unlock\.turn \}\]/);
    expect(side).toMatch(/opacity: unlock\.cw, transform: \[\{ rotate: unlock\.turn \}\]/);
    const confirm = between(nova, "case 'nova-confirm':", "case 'nova-lock':");
    expect(confirm).toMatch(/top: px\(arrows\.downTop\), transform: \[\{ translateY: unlock\?\.downY \?\? 0 \}\]/);
    expect(confirm).toMatch(/top: px\(arrows\.upTop\), transform: \[\{ translateY: unlock\?\.upY \?\? 0 \}\]/);
    const lock = between(nova, "case 'nova-lock':", "case 'nova-splash':");
    expect(lock).toMatch(/transformOrigin: 'left bottom', transform: \[\{ rotate: unlock\.shackle \}\]/);
    // Degrees are made in the hint's one builder, like every other value of the clock.
    const hint = code(read(HINT));
    expect(hint).toMatch(/turn: D\(p\.turn, 1\),/);
    expect(hint).toMatch(/shackle: D\(p\.shackle, NOVA_LOCK\.openTurn\),/);
    expect(hint).toMatch(/downY: N\(p\.slide, travel\),\s*upY: N\(p\.slide, -travel\),\s*shackle:/);
  });

  it('the pure guide: nobody’s password, a different pair every pass, the device’s own pace', () => {
    const turns = code(read('hww/deviceTurns.ts'));
    expect(turns).toMatch(/export const NOVA_TYPED/);
    expect(turns).toMatch(/export const NOVA_UNLOCK_MS = \{/);
    expect(turns).toMatch(/if \(d === 'nova'\) return ask === 'side' \? novaSide\(\) : ask === 'unlock' \? novaUnlock\(\) : null;/);
    expect(turns).toMatch(/const step = turnStep\(d, ask\);/);
  });

  it('the hardware-signing doc names it', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/Tap this side/);
    expect(doc).toMatch(/device first/);
    expect(doc).toMatch(/while the search runs/);
    expect(doc).not.toMatch(/are the next designer pass/);
  });
});

describe('registering the vault is drawn on every device, in every flow that registers (three phone test videos, 2026-10-04)', () => {
  it('a page is drawn only from the facts the device layer hands over; without them the flows keep their line', () => {
    const turns = code(read('hww/deviceTurns.ts'));
    expect(turns).toMatch(/if \(ask === 'register'\) return register \? registerTurn\(d, register\) : null;/);
    expect(turns).toMatch(/export function hasTurnPage\(d: DeviceDrawing, ask: DeviceAsk, register\?: RegisterFacts \| null, address\?: AddressFacts \| null\): boolean/);
    // The turn page hands the facts down, and nothing else about it changed.
    const turn = code(read(TURN));
    expect(turn).toMatch(/const turn = deviceTurn\(drawing, ask, network, register, address\);/);
    expect(turn).toMatch(/\}, \[drawing, ask, network, register, address\]\);/);
  });

  it('every drawing draws the registration’s pages and the device’s word; the touchscreens their app’s home too', () => {
    const touch = code(read('components/LedgerTouchArt.tsx'));
    for (const k of ['touch-register-intro', 'touch-register-account', 'touch-register-keys', 'touch-register-key', 'touch-register-approve', 'registered', 'app-home']) {
      expect({ k, touch: touch.includes(`case '${k}':`) }).toEqual({ k, touch: true });
    }
    // Its Approve button is the hint's control, anchored where the page draws it.
    expect(touch).toMatch(/approve: at\(a\.approve\)/);
    expect(code(read('components/deviceScreenLayout.ts'))).toMatch(/approve: \{ x: W \/ 2, y: \(ab\.top \+ ab\.h \/ 2\) \* H/);
    expect(code(read(HINT))).toMatch(/c === 'approve' \? a\.a\.approve/);
    const nano = code(read('components/NanoXArt.tsx'));
    for (const k of ['nano-register-intro', 'nano-register-keys', 'nano-register-approve', 'registered']) {
      expect({ k, nano: nano.includes(`case '${k}':`) }).toEqual({ k, nano: true });
    }
    const nova = code(read('components/NovaArt.tsx'));
    for (const k of ['nova-scroll', 'registered']) expect({ k, nova: nova.includes(`case '${k}':`) }).toEqual({ k, nova: true });
    // The Nova's last page slides its arrows as Total does, from the same values of the clock.
    const scroll = between(nova, "case 'nova-scroll':", "case 'nova-item':");
    expect(scroll).toMatch(/transform: \[\{ translateY: progress\?\.downY \?\? 0 \}\]/);
    expect(scroll).toMatch(/transform: \[\{ translateY: progress\.upY \}\]/);
    expect(scroll).toMatch(/opacity: progress\.up, transform: \[\{ translateY: progress\.upRise \}\]/);
    expect(scroll).not.toMatch(/progress\.(page|confirmed)/);
    // A scrolling line is clipped, never ellipsised; its words come from the layout.
    expect(nova).toMatch(/ellipsizeMode=\{r\.clip \? 'clip' : undefined\}/);
    expect(nova).not.toMatch(/Cosigner|Register/);
    // The slab prints the words every model starts with.
    expect(code(read('components/LedgerSlabArt.tsx'))).toMatch(/Review account\\nto register/);
  });

  it('the hardware-signing doc names the pages and never says the registration is not drawn', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).not.toMatch(/NOT drawn yet/);
    expect(doc).toMatch(/Review account to register/);
    expect(doc).toMatch(/Cosigner 1\/3 \(this device\)/);
    expect(doc).toMatch(/Account registered/);
    expect(doc).toMatch(/vaultRegistration\.ts/);
    expect(doc).toMatch(/unconfirmed/i);
  });
});

describe('the address check on a screen of its own, drawn on every device (decided 2026-10-04: "open a temporary new verification screen and jump back once its done")', () => {
  const receive = code(read('screens/ReceiveScreen.tsx'));
  const verify = code(read('screens/VerifyAddressScreen.tsx'));

  it('Receive keeps one "Verify on Hardware" button, which opens the check with the exact address and index; no device step under the QR', () => {
    expect(receive.match(/Verify on Hardware/g)).toHaveLength(1);
    expect(receive).toMatch(/navigation\.navigate\('VerifyAddress', \{ walletId: wallet\.id, address: addr\.address, index: addr\.index \}\)/);
    expect(receive).not.toMatch(/<HardwareConnect\b|ledgerTask|bitboxTask|getLedgerVerifiedAddress|policyAddress|registerVault|HwwConnectFlow|AFTER_SCAN/);
    // The route is on the root stack under the same gate as the button.
    const nav = code(readFileSync(join(UI, 'navigation', 'RootNavigator.tsx'), 'utf8'));
    expect(nav).toMatch(/\{\(SIGNING_ENABLED \|\| \(LEDGER_PREVIEW && HWW_ENABLED\)\) && \(\s*<RootStack\.Screen name="VerifyAddress" component=\{VerifyAddressScreen\}/);
    // The button waits until this screen can no longer swap the address under
    // the check (the first address confirmed through the engine, no scramble
    // in flight), and a verdict for ANOTHER address never hides it (decided
    // 2026-10-04: `verdict == null` left a fresh address with no way to check it).
    expect(receive).toMatch(
      /\(SIGNING_ENABLED \|\| \(LEDGER_PREVIEW && HWW_ENABLED\)\) && canVerifyOnHardware && addr\.index >= 0 && confirmed && !asking && !scrambling && verdict\?\.address !== addr\.address && \(/,
    );
    expect(receive).not.toMatch(/verdict == null/);
  });

  it('the verdict comes back in the params, is read once; the match is shown for the address it judged only, a mismatch blocks whatever address is on show', () => {
    expect(receive).toMatch(/const v = route\.params\.verdict;\s*if \(!v\) return;\s*setVerdict\(v\);\s*navigation\.setParams\(\{ verdict: undefined \}\);/);
    expect(receive).toMatch(/\{verdict\?\.kind === 'match' && verdict\.address === addr\.address && \(/);
    // A device that derived differently condemns the VAULT, not one address
    // (decided 2026-10-04): the warning and the dialog never wait on equality.
    expect(receive).toMatch(/\{verdict\?\.kind === 'mismatch' && \(/);
    expect(receive).not.toMatch(/'mismatch' && verdict\.address === addr\.address/);
    expect(receive).toMatch(/title="Do not use this address"/);
    // The green sentence, unchanged, names the device that answered.
    expect(receive).toMatch(/shows the same address\. It belongs to this vault and is safe to use\./);
    // The check pops back with it, pinned to the address it was given.
    expect(verify).toMatch(/navigation\.popTo\('Receive', \{ walletId, verdict \}, \{ merge: true \}\);/);
    expect(verify.match(/finish\(\{ kind: shown === address \? 'match' : 'mismatch', address, device: '(ledger|bitbox)' \}\);/g)).toHaveLength(2);
  });

  it('the address cannot change while the check runs: the ↻ holds while Receive is not focused, the button waits for the first address to be confirmed, and a new address clears the verdict', () => {
    expect(receive).toMatch(/const focused = useIsFocused\(\);/);
    const regenerate = between(receive, 'const onRegenerate = useCallback(async () => {', 'useLayoutEffect(');
    expect(regenerate).toMatch(/if \(!focused\) return;/);
    expect(regenerate).toMatch(/setVerdict\(null\);/);
    // A saved address shown after too long a wait can still be swapped by
    // the engine's answer: the button is held until that answer (decided
    // 2026-10-04), and a pinned address needs no confirming.
    expect(receive).toMatch(/const \[confirmed, setConfirmed\] = useState\(false\);/);
    const firstLoad = between(receive, 'const pinned = route.params.address;', 'const onRegenerate = useCallback(');
    expect(firstLoad).toMatch(/if \(pinned\) \{[\s\S]*?setConfirmed\(true\);\s*return;\s*\}/);
    expect(firstLoad).toMatch(/const first = await derive\('lastUnused'\);\s*clearTimeout\(patience\);\s*if \(cancelled\) return;\s*setConfirmed\(true\);/);
    // The slow refresh path waits on a sync BEFORE any scramble (decided
    // 2026-10-30: the scramble is a beat, never a wait), and `asking` holds
    // the button from the tap, so nothing can be tapped before that address
    // lands.
    expect(regenerate).toMatch(/setAsking\(true\);\s*next = await anotherAddress\(\);\s*setAsking\(false\);\s*if \(!next\) return;/);
    expect(regenerate.indexOf('setAsking(true)')).toBeLessThan(regenerate.indexOf('setScrambling(true)'));
    // The architecture note says what the code does, no more.
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/a mismatch condemns the vault/);
    expect(doc).not.toMatch(/so the check's address cannot be swapped under it/);
    // And the check re-derives the pair fresh before the device is asked, on both brands.
    expect(verify).toMatch(/const fresh = await engine\.getReceiveAddress\(index\);\s*if \(fresh\.address !== address\) \{/);
    expect(verify.match(/await confirmFresh\(\);/g)).toHaveLength(2);
  });

  it('the check: the one hardware step lists the owner\u2019s own keys with their devices (one known device skips the list), the address is the second page, drawn from the facts the tasks hand the flow', () => {
    expect(verify).toMatch(/<HardwareConnect[\s\S]*?purpose="address"[\s\S]*?keys=\{ownKeys\}[\s\S]*?question="Which device are you using\?"[\s\S]*?onPick=\{setPick\}[\s\S]*?onFooterBack=\{setStepBack\}/);
    // The owner's keys, never ours (decided 2026-10-04: "the address verification should only list KNOWN keys from the user"),
    // and only those a device can show the address for (decided 2026-10-04: a Ledger key of a shared vault never registered on it).
    expect(verify).toMatch(/const ownKeyIds = useMemo\(\(\) => \(wallet \? ownKeysOnThisPhone\(wallet, known21C\) : \[\]\), \[wallet, known21C\]\);/);
    expect(verify).toMatch(/const ownKeys = useMemo\(\(\) => \(wallet \? stepKeysOf\(wallet, addressCheckKeysOf\(wallet, checkKeyIds\), known21C\) : \[\]\), \[wallet, checkKeyIds, known21C\]\);/);
    expect(verify).toMatch(/\{pick != null && \(\s*<View style=\{styles\.addressBlock\}>[\s\S]*?<AddressChunks address=\{address\} \/>/);
    // The step tells the screen where it starts, so a recorded device skips the question and the address shows at once.
    const connect = code(read('components/HardwareConnect.tsx'));
    expect(connect).toMatch(/useEffect\(\(\) => \{\s*onPickRef\.current\?\.\(pick\);/);
    // Each brand's turn for the address is reported with the step AND the facts its pages are drawn from.
    expect(verify).toMatch(/ctx\.setStep\('Check the address on the BitBox’s screen against the one above, then tap the top right edge\.', 'address', undefined, addressFacts\(wallet, address, storedName, 'bitbox'\)\);/);
    expect(verify).toMatch(/ctx\.setStep\('Check the address on the Ledger’s screen against the one above, then confirm there\.', 'address', undefined, addressFacts\(wallet, address, name, 'ledger'\)\);/);
    // The Ledger's name is the registration's, the BitBox's the one it STORED.
    expect(verify).toMatch(/const name = spec\.spec\.kind === 'registered' \? spec\.spec\.name : null;/);
    expect(verify).toMatch(/const storedName = reg\.alreadyRegistered \? bitboxRegisteredName\(wallet\.bitboxRegistrations, ctx\.fingerprint\) : policy\.name;/);
    expect(verify.indexOf("'address', undefined, addressFacts(wallet, address, storedName")).toBeLessThan(verify.indexOf('ctx.session.policyAddress('));
    expect(verify.indexOf("'address', undefined, addressFacts(wallet, address, name")).toBeLessThan(verify.indexOf('getLedgerVerifiedAddress('));
    // ONE button at the foot (decided 2026-10-05, from a screenshot of this page):
    // the step's Back while there is a list inside the screen to return to,
    // otherwise Cancel, which goes back without a verdict; never both.
    expect(verify).toMatch(/footer=\{stepBack != null \? <Button title="Back" variant="ghost" onPress=\{stepBack\.onPress\} \/> : <Button title="Cancel" variant="ghost" onPress=\{\(\) => navigation\.goBack\(\)\} \/>\}/);
    expect(verify).toMatch(/onFooterBack=\{setStepBack\}/);
    expect(verify).not.toMatch(/AFTER_SCAN/);
  });

  it('the address is grouped exactly as Receive’s: one component, one sheet', () => {
    for (const rel of ['screens/ReceiveScreen.tsx', 'screens/VerifyAddressScreen.tsx']) {
      const src = code(read(rel));
      expect({ rel, chunks: /<AddressChunks address=\{/.test(src) }).toEqual({ rel, chunks: true });
      expect({ rel, own: /chunkAlt|fontFamily: 'Menlo'/.test(src) }).toEqual({ rel, own: false });
    }
    const chunks = code(read('components/AddressChunks.tsx'));
    expect(chunks).toMatch(/chunkAddress\(address\)/);
    expect(chunks).toMatch(/themedStyles\(/);
  });

  it('every drawing draws the check’s pages: the touchscreens’ intro and address page with Confirm as the hint’s control, the Nano X’s intro, confirm and home, the Nova’s address with its tick', () => {
    const touch = code(read('components/LedgerTouchArt.tsx'));
    for (const k of ['touch-address-intro', 'touch-address']) expect({ k, touch: touch.includes(`case '${k}':`) }).toEqual({ k, touch: true });
    expect(touch).toMatch(/confirm: at\(a\.confirm\)/);
    expect(touch).toMatch(/footer\(n, total, 'Cancel'\)/);
    expect(touch).toMatch(/<QrGlyph /);
    expect(code(read('components/deviceScreenLayout.ts'))).toMatch(/confirm: \{ x: row\.confirm\.left \+ row\.confirm\.w \/ 2, y: row\.top \+ row\.h \/ 2/);
    expect(code(read(HINT))).toMatch(/c === 'confirm' \? a\.a\.confirm/);
    const nano = code(read('components/NanoXArt.tsx'));
    for (const k of ['nano-address-intro', 'nano-address-confirm']) expect({ k, nano: nano.includes(`case '${k}':`) }).toEqual({ k, nano: true });
    expect(between(nano, "case 'app-home':", 'default:')).toMatch(/return \{ kind: 'app-home', app: screen\.app \};/);
    const nova = code(read('components/NovaArt.tsx'));
    const address = between(nova, "case 'nova-address':", "case 'nova-scroll':");
    expect(address).toMatch(/<TickGlyph /);
    expect(address).toMatch(/const \[title, body\] = novaRows\(page\);/);
    expect(address).toMatch(/\{rows\(\[title\]\)\}/);
    // The line and the thumb through the ONE renderer every scrolled line
    // takes (the review's amount page too, decided 2026-10-05).
    expect(address).toMatch(/\{scrolled\(body\)\}\s*\{thumb\}/);
    expect(address).not.toMatch(/\{next\}/);
    const scrolled = between(nova, 'const scroll = scrolls?.find((s) => s.page === index);', 'switch (page.kind) {');
    // Without the clock the line and the thumb stand at their start, as the video's frame shows them.
    expect(scrolled).toMatch(/\) : \(\s*rows\(\[body\]\)\s*\)/);
    expect(scrolled).toMatch(/\) : \(\s*<View style=\{\{ position: 'absolute', left: px\(t\.x\), top: px\(t\.top\), width: px\(t\.w\), height: 1, backgroundColor: NOVA\.oled \}\} \/>\s*\)/);
    // The line in its window at its measured width, carried by the clock; the thumb along its track (decided 2026-10-04).
    expect(scrolled).toMatch(/overflow: 'hidden' \}\}>\s*<Animated\.View style=\{\{ width: px\(novaScrollWidth\(body\.text\)\) \+ 2, transform: \[\{ translateX: scroll\.line \}\] \}\}>/);
    expect(scrolled).toMatch(/transform: \[\{ translateX: scroll\.thumb \}\]/);
    // The amount page (decided 2026-10-05): the ">" to move on, the amount, the
    // arrow, then the same scrolled line and thumb; no tick.
    const output = between(nova, "case 'nova-output':", "case 'nova-total':");
    expect(output).toMatch(/\{next\}/);
    expect(output).toMatch(/const \[amount, to\] = novaRows\(page\);/);
    expect(output).toMatch(/\{rows\(\[amount\]\)\}/);
    expect(output).toMatch(/\{scrolled\(to\)\}\s*\{thumb\}/);
    expect(output).not.toMatch(/TickGlyph/);
    // The guide: two strokes along the lower edge, the device's own gain per
    // stroke unfilmed and never claimed; the strokes, the cue, the word and
    // the carried line come from ONE builder in the hint script, which both
    // guides call (decided 2026-10-05: "the same swipe").
    const script = code(read(HINT_SCRIPT));
    expect(code(read('hww/signingDevice.ts'))).toMatch(/export const NOVA_SWIPE_MS = \{ read: 900, lead: 350, stroke: 1100, lift: 500, fade: 300, settle: 1500, strokes: 2 \} as const;/);
    expect(script).toMatch(/return \{ controls: \['edgeAlong'\], in: s\.in, presses: \[\{ down: s\.down, at: s\.at \}\], out: s\.out, swipe: \{ from: s\.down, to: s\.at \} \};/);
    expect(script).toMatch(/cues\.push\(swipeCue\(b\)\);\s*words\.push\(swipeWord\(b\)\);/);
    expect(script).toMatch(/scroll: ch\(0, scrollSegs\(strokes, starts\[i \+ 1\]\), \[0, 0\]\), travel: novaScrollTravel\(page\.to\)/);
    const guide = code(read('hww/deviceTurns.ts'));
    expect(guide).toMatch(/const strokesAt = swipeStrokes\(L \+ NOVA_SWIPE_MS\.read, strokes\);\s*cues\.push\(\.\.\.strokesAt\.map\(swipeCue\)\);\s*words\.push\(\.\.\.strokesAt\.map\(swipeWord\)\);/);
    expect(guide).toMatch(/scroll: channel\(0, scrollSegs\(strokesAt, confirmedAt\), cycle, \[0, 0\]\)/);
    expect(guide).not.toMatch(/NOVA_SWIPE_MS = /);
    for (const rel of [...PURE, ...DRAWINGS, HINT, TOUR, TURN]) {
      expect({ rel, swipes: (code(read(rel)).match(/swipe: \{ from/g) ?? []).length }).toEqual({ rel, swipes: rel === HINT_SCRIPT ? 1 : 0 });
    }
    // The tour hands the hint its pages (which ones swipe) and the drawing
    // the swiped frames; only the Nova takes them.
    const tour = code(read(TOUR));
    expect(tour).toMatch(/const plan = hintPlan\(drawing, pages, starts, cycle\);/);
    expect(tour).toMatch(/progress=\{motion\?\.progress\} scrolls=\{motion\?\.scrolls\}/);
    expect(code(read('components/DeviceArt.tsx')).match(/scrolls=\{scrolls\}/g)).toHaveLength(1);
    expect(code(read(TURN))).toMatch(/planFromCues\(hint, p\.cues, p\.words, p\.progress, turn\.cycle, \[\], p\.scrolls\)/);
    expect(nova).not.toMatch(/Receive to/);
    expect(code(read('components/LedgerSlabArt.tsx'))).toMatch(/Verify bitcoin\\naddress/);
    // The pure guide: a page only from the facts, the words the module's.
    const turns = code(read('hww/deviceTurns.ts'));
    expect(turns).toMatch(/if \(ask === 'address'\) return address \? addressTurn\(d, address\) : null;/);
    expect(turns).toMatch(/export function hasTurnPage\(d: DeviceDrawing, ask: DeviceAsk, register\?: RegisterFacts \| null, address\?: AddressFacts \| null\): boolean/);
  });

  it('the hardware-signing doc names it', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/addressCheck\.ts/);
    expect(doc).toMatch(/VerifyAddress/);
    expect(doc).toMatch(/Address verified/);
    expect(doc).toMatch(/Receive to/);
    // And the review's amount page swiped the same way (decided 2026-10-05).
    expect(doc).toMatch(/swipe through the entire address/);
    expect(doc).toMatch(/novaSwipePageMs/);
  });
});

describe('the device’s steps, numbered, and the slide between them (reported 2026-10-05: "its not always clear that the user needs to now press something again on the ledger")', () => {
  const ledger = code(read('components/LedgerConnectFlow.tsx'));
  const hww = code(read('components/HwwConnectFlow.tsx'));
  const slide = code(read(SLIDE));
  const turn = code(read(TURN));

  it('one plan module: the step is the ask’s, the title is the chosen form, and the courier’s turn is the same step 3', () => {
    const steps = code(read('hww/deviceSteps.ts'));
    expect(steps).toMatch(/export function turnStep\(d: DeviceDrawing, ask: DeviceAsk\): TurnStep/);
    expect(steps).toMatch(/export function stepTitle\(step: TurnStep, text: string\): string/);
    expect(steps).toMatch(/export const JOB_STEP: TurnStep = 3;/);
    // The slide's key: the step, and for the job which job (decided
    // 2026-10-05: a registration followed by the address check on the same
    // device must slide, both being "3.").
    expect(steps).toMatch(/export function slideKey\(step: TurnStep, ask: DeviceAsk\): string/);
    expect(steps).toMatch(/return step === JOB_STEP \? `\$\{JOB_STEP\}:\$\{ask\}` : String\(step\);/);
    // Pure: no React Native, nothing of the flows'.
    expect(steps).not.toMatch(/react-native|useState|useRef/);
    // The turn pages and the courier take their titles from it, nowhere else.
    const turns = code(read('hww/deviceTurns.ts'));
    expect(turns).toMatch(/const step = turnStep\(d, ask\);/);
    expect(turns).toMatch(/title: stepTitle\(step, text\)/);
    expect(code(read('hww/signingDevice.ts'))).toMatch(/title: stepTitle\(JOB_STEP, SIGN_JOB\),/);
    // "Your turn on the ..." is gone from every screen a client sees.
    const yourTurn = sources(UI)
      .filter((f) => /Your turn on/.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(UI.length + 1));
    expect(yourTurn).toEqual([]);
  });

  it('the turn page draws the step’s title, starts the drawing afresh on a new step, and draws a line only where the step has one', () => {
    expect(turn).toMatch(/const words = turnWords\(drawing, ask, network\);/);
    expect(turn).toMatch(/<DeviceLoop key=\{ask\} drawing=\{drawing\} width=\{w\} script=\{script\} \/>/);
    expect(turn).toMatch(/\{words\.line != null && <Text style=\{styles\.body\}>\{words\.line\}<\/Text>\}/);
    // The slide is not the page's: it is the flow's, round every page it draws.
    expect(turn).not.toMatch(/StepTransition|TurnSlide/);
  });

  it('the slide: the app’s own StepTransition on the native driver, keyed by the page shown last (the step, and which job), in the plan’s order', () => {
    expect(slide).toMatch(/import \{ StepTransition \} from '\.\/StepTransition';/);
    expect(slide).toMatch(/import \{ STEP_ORDER, slideKey \} from '\.\.\/hww\/deviceSteps';/);
    // A page with no step of its own (a line, the pairing code) holds the
    // last key, so it swaps in place; only a NEW page slides, the second job
    // on the same device included.
    expect(slide).toMatch(/if \(step != null && ask != null\) held\.current = slideKey\(step, ask\);/);
    expect(slide).toMatch(/<StepTransition stepKey=\{held\.current\} order=\{STEP_ORDER\} style=\{style\}>/);
    // No clock, no counter, no sentence of its own.
    expect(slide).not.toMatch(/Animated\.|setTimeout|setInterval|\+ 1|\+\+/);
    expect(slide.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g)?.filter((x) => /[a-z]{3,} [a-z]{3,}/.test(x))).toEqual([]);
    expect(code(read('components/StepTransition.tsx'))).toMatch(/useLayoutEffect/);
    expect(code(read('components/StepTransition.tsx'))).not.toMatch(/useNativeDriver:\s*false/);
  });

  it('both flows wrap every page they draw in the slide, the step read off the ask alone; the hand-over to the Ledger flow and the courier are not wrapped (the courier slides itself)', () => {
    for (const [rel, src, box] of [
      ['LedgerConnectFlow', ledger, 'box'],
      ['HwwConnectFlow', hww, 'wrap'],
    ] as const) {
      expect({ rel, imports: /import \{ TurnSlide \} from '\.\/TurnSlide';/.test(src) }).toEqual({ rel, imports: true });
      expect({ rel, step: /import \{ turnStep \} from '\.\.\/hww\/deviceSteps';/.test(src) }).toEqual({ rel, step: true });
      // Every DeviceTurn sits inside the slide, never in a bare View; the
      // slide is handed the ask too, which tells the job's two pages apart.
      const wrapped = src.match(new RegExp(`<TurnSlide step=\\{step\\} ask=\\{turnAsk\\} style=\\{styles\\.${box}\\}>`, 'g')) ?? [];
      expect({ rel, wrapped: wrapped.length }).toEqual({ rel, wrapped: rel === 'LedgerConnectFlow' ? 3 : 2 });
      expect({ rel, bare: new RegExp(`<View style=\\{styles\\.${box}\\}>\\s*<DeviceTurn`).test(src) }).toEqual({ rel, bare: false });
      // The number is never counted: no step arithmetic anywhere.
      expect({ rel, counted: /step \+ 1|step\+\+|step - 1|steps\.length/.test(src) }).toEqual({ rel, counted: false });
    }
    // The Ledger flow: the step of the page on show, the unlock page carried
    // through the connection being step 1 of the same plan.
    expect(ledger).toMatch(/turnStep\(drawingFor\('ledger', deviceRef\.current\.model\), state\.ask\)/);
    expect(ledger).toMatch(/turnStep\(connectingDrawing, 'unlock'\)/);
    expect(ledger).toMatch(/const turnAsk: DeviceAsk \| null = state\.kind === 'working' && deviceRef\.current != null \? state\.ask : carriedUnlock \? 'unlock' : null;/);
    // The search: the expected device's first step; the BitBox once found: its own.
    expect(hww).toMatch(/const turnDrawing = searchTurnUp \? searchDrawing : bitboxTurnUp \? 'nova' : null;/);
    expect(hww).toMatch(/const step = turnAsk != null && turnDrawing != null \? turnStep\(turnDrawing, turnAsk\) : null;/);
    // The courier's pages are its own slide (LEG_ORDER), not wrapped again;
    // the Ledger flow is handed over bare, so its own slide is the only one.
    expect(hww).toMatch(/if \(state\.kind === 'ledger'\) \{\s*return \(\s*<LedgerConnectFlow/);
    expect(hww).toMatch(/<View style=\{styles\.wrap\}>\{ceremony\(/);
    expect(ledger).toMatch(/<View style=\{styles\.box\}>\{ceremony\(/);
    // Keyed by the transaction's place in its batch and the leg, so the next
    // transaction of a refresh session slides in as a new page (decided 2026-10-05).
    expect(code(read(COURIER))).toMatch(/<StepTransition stepKey=\{legKey\(state\)\} order=\{legOrder\(state\)\} style=\{styles\.inner\}>/);
  });

  it('the hardware-signing doc names the numbered steps and the slide', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/deviceSteps\.ts/);
    expect(doc).toMatch(/TurnSlide/);
    expect(doc).toMatch(/1\. Enter your PIN on the Ledger/);
    expect(doc).toMatch(/1\. Tap the side facing you/);
    expect(doc).toMatch(/3\. Sign the transaction/);
  });
});

describe('the refresh session signs with the courier, leg after leg (decided 2026-10-05: "keep 3 and build the courier for refresh session too")', () => {
  const session = code(read(SESSION));
  const hook = code(read(HOOK));

  it('one hook wires the courier for both screens; the session runs it once per transaction with its place in the pass', () => {
    const ledger = between(session, 'ledgerTask={async (ctx) => {', 'bitboxTask={async (ctx) => {');
    const bitbox = between(session, 'bitboxTask={async (ctx) => {', '/>\n');
    for (const [brand, task, call] of [
      ['ledger', ledger, 'signing.signOnLedger(ctx, spec.spec, await legJob(engine, i, keyName), legDone(pass, i, ctx.deviceFingerprint))'],
      ['bitbox', bitbox, 'signing.signOnBitbox(ctx, bitboxSpec, await legJob(engine, i, keyName), legDone(pass, i, ctx.fingerprint))'],
    ] as const) {
      expect({ brand, call: task.includes(`const signed = await ${call};`) }).toEqual({ brand, call: true });
      // A client who left mid-way: nothing absorbed.
      expect({ brand, left: /if \(signed == null\) return;/.test(task) }).toEqual({ brand, left: true });
      // The spinner lines are gone: no step line of the session's own during signing.
      expect({ brand, line: /ctx\.setStep\(|Transaction \$\{i \+ 1\} of/.test(task) }).toEqual({ brand, line: false });
      // Nothing of the task's own follows the loop: the pass is collected
      // and absorbed as the last leg's follow-up, inside the run's try
      // (decided 2026-10-05, next test). Absorbed here, after the loop, a
      // failure reached no feed and the courier stayed on "Receiving signed
      // transaction 3 of 3." with nothing to tap.
      expect({ brand, outside: /absorbPass\(|collected\(|passRef\.current = null/.test(task) }).toEqual({ brand, outside: false });
    }
    // The count is the leg's place, counted from 1; the signing screen passes none (a payment of one).
    expect(session).toMatch(/return \{ psbt, parsed, keyName, batch: \{ index: i \+ 1, count: legs\.length \} \};/);
    expect(code(read(SIGN))).not.toMatch(/batch:/);
    // The key's name on the travelling screens is the one every screen gives the key.
    expect(session).toMatch(/const keyName = keyDisplayName\(wallet, ctx\.(deviceFingerprint|fingerprint), providerFps\) \?\? wallet\.label;/);
  });

  it('the card is true for a refresh: every output’s isOwn from BDK, so the device’s print decides (the fee alone, and the name where the device prints one)', () => {
    expect(session).toMatch(/parsed = markOwnOutputs\(parsePsbt\(psbt, wallet!\.network\), await ownOutputIndices\(engine, psbt\)\);/);
    // Unreadable: nothing to compare, never a guess.
    expect(between(session, 'const legJob = async', 'const collected =')).toMatch(/catch \{/);
    // The pure card asks for the fee where nothing leaves the vault.
    expect(code(read('hww/signingDevice.ts'))).toMatch(/if \(f\.outputs\.length === 0 && f\.feeSats != null\) rows\.push\(\{ label: 'Fee', value: deviceAmount\(f\.feeSats, unit\) \}\);/);
  });

  it('a failed absorb lands on Not signed with its sentence and Try again: the pass is absorbed as the LAST leg’s follow-up, inside the run’s try (decided 2026-10-05)', () => {
    const done = between(session, 'const legDone =', 'const sendAll = async');
    expect(done).toMatch(
      /\(pass: \{ signed: \(string \| undefined\)\[\] \}, i: number, fp: string\) =>\s*async \(signed: SignedCopy\): Promise<void> => \{\s*pass\.signed\[i\] = signed\.base64;\s*if \(i < legs\.length - 1\) return;\s*const copies = collected\(pass\);\s*passRef\.current = null;\s*await absorbPass\(copies, fp\);\s*\};/,
    );
    // The one absorb of the session, and the one place a leg's copy is kept.
    expect((session.match(/await absorbPass\(/g) ?? []).length).toBe(1);
    expect((session.match(/pass\.signed\[i\] = /g) ?? []).length).toBe(1);
    // In the hook the follow-up runs inside the try, after the alive check
    // and the signed page's beat, and a failure lands on the feed (pinned on
    // both runs under "the Sent page after the broadcast"); the courier
    // offers Try again on the failed leg alone, never on the way back.
    // (The courier's buttons sit in the page's footer since 2026-10-05,
    // `SigningCourierFooter`, pinned in pageFooter.test.)
    const courier = code(read(COURIER));
    const foot = courier.slice(courier.indexOf('export function SigningCourierFooter('));
    expect(foot).toMatch(/const ended = state\.leg === 'declined' \|\| state\.leg === 'failed';/);
    expect(foot).toMatch(/\{ended && <Button title="Try again" onPress=\{onRetry\} \/>\}/);
  });

  it('Try again keeps the device AND the legs it already signed: a decline on the third transaction never asks for the first two again', () => {
    expect(session).toMatch(/const passRef = useRef<\{ fp: string; signed: \(string \| undefined\)\[\] \} \| null>\(null\);/);
    expect(session).toMatch(/if \(passRef\.current\?\.fp !== fp\) passRef\.current = \{ fp, signed: \[\] \};/);
    expect((session.match(/if \(pass\.signed\[i\] != null\) continue;/g) ?? []).length).toBe(2);
    // Leaving the step drops the pass and the courier together.
    expect(session).toMatch(/if \(phase === 'sign'\) return;\s*passRef\.current = null;\s*resetSigning\(\);/);
    // The info text says so, and no longer that the approvals start over.
    expect(session).toMatch(/the transactions already approved are kept, and nothing has been sent/);
    expect(session).not.toMatch(/approvals simply start over/);
  });

  it('the count is said where the lines name the transaction; the client’s turn is "3." on every one', () => {
    const device = code(read('hww/signingDevice.ts'));
    expect(device).toMatch(/export function batchCount\(b: BatchPosition\): string \{\s*return `Transaction \$\{b\.index\} of \$\{b\.count\}`;/);
    // The title of the client's turn is the step, never a count.
    expect(between(device, "case 'approve': {", "case 'return':")).toMatch(/title: stepTitle\(JOB_STEP, SIGN_JOB\),/);
    expect(between(device, "case 'approve': {", "case 'return':")).not.toMatch(/title: [^,]*batch/);
    // The place rides in the ceremony's state, so one signal moves the leg and the count together.
    const ceremony = code(read('hww/signingCeremony.ts'));
    expect(ceremony).toMatch(/set\(startCeremony\(at, c\.batch \?\? null\)\);/);
    expect(ceremony).toMatch(/a\.batch\?\.index !== b\.batch\?\.index \|\|\s*a\.batch\?\.count !== b\.batch\?\.count \|\|/);
    // The hook hands the place to the feed, and the words first, then the signal.
    expect(hook).toMatch(/batch: job\.batch \?\? null,/);
    const ledger = between(hook, 'const signOnLedger = useCallback(', 'const signOnBitbox = useCallback(');
    expect(ledger.indexOf('setCourier({')).toBeLessThan(ledger.indexOf('feed.start(cfg, Date.now());'));
  });

  it('the session keeps everything else: its Back, its heading hidden under a page, its own keys, its Sent page', () => {
    expect(session).toMatch(/onBack=\{\(\) => setPhase\('summary'\)\}/);
    expect(session).toMatch(/ceremony=\{signing\.ceremony\}/);
    // The courier's Back is the summary too, in the page's footer.
    expect(session).toMatch(/if \(signing\.courier != null\) return signing\.footer\(\(\) => setPhase\('summary'\)\);/);
    expect(session).toMatch(/keys=\{stepKeysOf\(wallet, \[\.\.\.cast\.customerFps\]\.filter\(\(fp\) => !signedFps\.includes\(fp\)\), providerFps\)\}/);
    expect(session).toMatch(/<SentPage\b/);
    // The co-signing part is untouched: the client's own key first, 21st Capital second, never forced.
    expect(session).toMatch(/<Button title="Sign with another key" onPress=\{\(\) => setPhase\('sign'\)\} \/>/);
    expect(session).toMatch(/title="Ask 21st Capital to co-sign"/);
    expect(session).toMatch(/refreshPlan\(\{/);
  });

  it('the hardware-signing doc records the two decisions of 2026-10-05', () => {
    const doc = readFileSync(DOC, 'utf8');
    expect(doc).toMatch(/keep 3/);
    expect(doc).toMatch(/useSigningCourier/);
    expect(doc).not.toMatch(/giving `RefreshSessionScreen` the courier is a follow-up/);
    expect(doc).not.toMatch(/open since the review of 2026-10-05/);
  });
});
