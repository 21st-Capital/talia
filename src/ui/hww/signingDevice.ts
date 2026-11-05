/**
 * The device in the client's hand, as the signing ceremony draws it (design
 * A "The courier", decided 2026-10-03). Pure: no React Native, tested in
 * `__tests__/signingDevice.test.ts`.
 *
 *   - which drawing, from the model the device reports at discovery;
 *   - the pages the drawing steps through on the client's turn, per model
 *     and vault kind, in the device firmware's own words;
 *   - what the client does on that device (the gesture line);
 *   - the card to compare against the device's screen;
 *   - every sentence the three screens say.
 *
 * THE PAGE TOUR IS A GUIDE ON A TIMER. The phone cannot see which page the
 * device is on, so the drawing steps through the review at a reading pace,
 * holds the last page as long as the longest, and starts again from the
 * first, for as long as the client's turn lasts (decided 2026-10-03: "repeat the
 * whole signing process for each screen so the user can keep looking on
 * screen and see each screen again if he missed any"). No sentence on the
 * screen ever says the drawing shows the device's current page.
 */
import type { Network } from '../../bitcoin/descriptor/types';
import { descriptorToLedgerPolicy, isDefaultPolicy, ledgerPolicyBlocker } from '../../bitcoin/ledger/policy';
import { psbtLockTime } from '../../bitcoin/psbt/parse';
import type { ParsedPsbt } from '../../bitcoin/psbt/parse';
import { deviceName, modelFromKit } from '../../wallet/deviceKinds';
import type { DeviceModel } from '../../wallet/deviceKinds';
import type { BitboxRegistration } from '../../wallet/types';
import { novaScrollTravel } from '../components/deviceScreenLayout';
import { shortId } from '../components/sentPageModel';
import type { SentRow } from '../components/sentPageModel';
import type { BatchPosition, CeremonyState, SigningBrand } from './signingCeremony';
import { JOB_STEP, SIGN_JOB, stepTitle } from './deviceSteps';

// ─── Which drawing ───────────────────────────────────────────────────────────

/** Every device Talia draws. `slab` is a Ledger whose model it does not know. */
export type DeviceDrawing = 'gen5' | 'flex' | 'stax' | 'nanoX' | 'nova' | 'slab';

export const DEVICE_DRAWINGS: readonly DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX', 'nova', 'slab'];

/** Every model id the Ledger kit can report (its DeviceModelId values). The
 *  Nano S and S Plus have no Bluetooth and never reach a phone, but a model
 *  the app has no drawing for still gets one: the plain slab. */
export const LEDGER_MODEL_IDS = ['nanoS', 'nanoSP', 'nanoX', 'stax', 'flex', 'apexp'] as const;

/** The drawing of a listed model: its own id, since the registry names the
 *  models by the drawings (`wallet/deviceKinds.ts`); the Passport, drawn
 *  nowhere yet, is null. */
export function drawingOfModel(model: DeviceModel | null | undefined): DeviceDrawing | null {
  if (model == null || model === 'passport') return null;
  return model;
}

/**
 * The drawing for the device that answered: the model the registry reads
 * off the kit's id at discovery ('apexp' is the Nano Gen5; a BitBox over
 * Bluetooth is always a Nova), and the plain slab for a model Talia does not
 * list.
 */
export function drawingFor(brand: SigningBrand, ledgerModel?: string | null): DeviceDrawing {
  return drawingOfModel(modelFromKit(brand, ledgerModel)) ?? 'slab';
}

/** The Ledgers with a touchscreen: they share one set of review pages. */
export function isTouchscreen(d: DeviceDrawing): boolean {
  return d === 'gen5' || d === 'flex' || d === 'stax';
}

export function brandOf(d: DeviceDrawing): SigningBrand {
  return d === 'nova' ? 'bitbox' : 'ledger';
}

// ─── The words a device prints ───────────────────────────────────────────────

/** The unit a device prints amounts in. The Ledger's "Bitcoin Test" app says
 *  TEST; the BitBox says TBTC (the photos) off the main network. */
export function deviceUnit(brand: SigningBrand, network: Network): string {
  if (network === 'bitcoin') return 'BTC';
  return brand === 'bitbox' ? 'TBTC' : 'TEST';
}

/** An amount as the devices print it: up to eight decimals, no trailing zeros. */
export function deviceAmount(sats: number, unit: string): string {
  const whole = Math.floor(sats / 1e8);
  const frac = String(sats % 1e8)
    .padStart(8, '0')
    .replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} ${unit}`;
}

/** The BitBox's coin name on its first page ("2-of-3\nBTC Testnet multisig"). */
export function bitboxCoin(network: Network): string {
  return network === 'bitcoin' ? 'BTC' : 'BTC Testnet';
}

/** The whole address in groups of four, as the Nova prints it: ONE line it
 *  scrolls along its bottom edge (the video of the address check: its first
 *  17 characters at the edge, the thumb under it; the signing review's output page
 *  prints the same line under the amount, decided 2026-10-05), never cut to its
 *  first groups. */
export function novaAddressGroups(address: string): string {
  return (address.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * What the BitBox says it spends from, decided from the DESCRIPTOR exactly
 * as the BitBox bridge decides what to register (bitbox-ffi `script_config`):
 * a `wsh(sortedmulti(k, @i/**…))` is the device's classic multisig and reads
 * "2-of-3 BTC multisig" then "Spend from <name>" (the photos); any other
 * shared vault is a wallet policy and reads "BTC policy with N keys" then
 * "Name <name>"; a plain one-key vault has no such page. Null when the
 * device cannot take the vault at all.
 */
export type BitboxVaultKind =
  | { kind: 'single' }
  | { kind: 'multisig'; threshold: number; keys: number }
  | { kind: 'policy'; keys: number };

export function bitboxVaultKind(descriptor: string, label: string): BitboxVaultKind | null {
  if (ledgerPolicyBlocker(descriptor)) return null;
  let policy;
  try {
    policy = descriptorToLedgerPolicy(descriptor, label);
  } catch {
    return null;
  }
  if (isDefaultPolicy(policy)) return { kind: 'single' };
  const m = /^wsh\(sortedmulti\((\d+),(.+)\)\)$/.exec(policy.descriptorTemplate);
  if (m) {
    const slots = m[2].split(',').map((x) => x.trim());
    if (slots.every((x) => /^@\d+(\/\*\*|\/<0;1>\/\*)$/.test(x))) {
      return { kind: 'multisig', threshold: Number(m[1]), keys: slots.length };
    }
  }
  return { kind: 'policy', keys: policy.keys.length };
}

/**
 * The name a BitBox stored for this vault, read from Talia's record of the
 * registration (`WalletMeta.bitboxRegistrations`). The device matches a
 * registered policy by its script alone, so a vault renamed since keeps its
 * OLD name there, and one registered by another app has a name Talia never
 * saw: null then, never today's label.
 */
export function bitboxRegisteredName(
  registrations: Readonly<Record<string, BitboxRegistration>> | null | undefined,
  fingerprint: string,
): string | null {
  const fp = fingerprint.toLowerCase();
  for (const [k, r] of Object.entries(registrations ?? {})) {
    if (k.toLowerCase() === fp && typeof r?.name === 'string' && r.name.length > 0) return r.name;
  }
  return null;
}

// ─── What the device is shown ────────────────────────────────────────────────

export interface ShownOutput {
  address: string | null;
  amountSats: number;
}

/** What the drawing and the compare card are made from. */
export interface TourFacts {
  brand: SigningBrand;
  network: Network;
  /** The vault's name as the device knows it: the name it was registered
   *  under, from Talia's own record of the registration (a Ledger's
   *  registration triple, the name stored beside a BitBox registration).
   *  Null for a plain one-key vault, which the device signs as an account,
   *  and for a BitBox vault registered elsewhere or before the name was
   *  kept: never guessed from the vault's label, which can have changed. */
  registeredName: string | null;
  /** Bitcoin app 2.2.1 to 2.4.1 (`asksNameFirst`): the name is asked on its
   *  own page before the review, so the review names no account. */
  nameFirst: boolean;
  /** The BitBox's first page (null on a Ledger). */
  bitboxKind: BitboxVaultKind | null;
  /** The outputs the device lists. */
  outputs: ShownOutput[];
  feeSats: number | null;
  /** The transaction's lock time and replacement signal (the BitBox prints both). */
  lockTime: { lockTime: number; rbf: boolean } | null;
}

/** The outputs a device lists: those leaving the vault, and only those. A
 *  transaction that pays only the vault (a refresh, a cancel) is built to
 *  the vault's CHANGE branch on purpose, so the registered device sees a
 *  self-transfer and prints no recipient: nothing to draw or compare, and
 *  the Nova's Total is the fee alone. */
export function shownOutputs(
  outputs: ReadonlyArray<{ address: string | null; amountSats: number; isOwn?: boolean }>,
): ShownOutput[] {
  return outputs.filter((o) => !o.isOwn).map((o) => ({ address: o.address, amountSats: o.amountSats }));
}

/** Where the facts of a transaction come from: the vault, the device's
 *  knowledge of it, and the transaction as read. */
export interface TourSource {
  brand: SigningBrand;
  network: Network;
  /** The vault's descriptor and label: the BitBox's first page is decided
   *  from them, as the BitBox bridge decides what to register. */
  descriptor: string;
  label: string;
  /** See `TourFacts.registeredName`. */
  registeredName: string | null;
  nameFirst: boolean;
  /** The transaction as read (`ParsedPsbt`, or just what the facts need of
   *  it), every output's `isOwn` from BDK (`wallet/ownOutputs.markOwnOutputs`);
   *  null when it could not be read, which leaves the card with nothing to
   *  compare rather than a guess. */
  parsed: { outputs: ReadonlyArray<{ address: string | null; amountSats: number; isOwn?: boolean }>; feeSats: ParsedPsbt['feeSats'] } | null;
  /** The transaction itself, for its lock time. */
  psbt: string;
}

/**
 * The facts the drawing and the card are made from, the same way for every
 * screen that signs (the signing screen, the refresh session): what the
 * transaction pays outside the vault, its fee and lock time, and the name the
 * device knows the vault by. Pure, so a leg of a batch is read exactly as a
 * single payment is.
 */
export function tourFactsFor(src: TourSource): TourFacts {
  return {
    brand: src.brand,
    network: src.network,
    registeredName: src.registeredName,
    nameFirst: src.nameFirst,
    bitboxKind: src.brand === 'bitbox' ? bitboxVaultKind(src.descriptor, src.label) : null,
    outputs: shownOutputs(src.parsed?.outputs ?? []),
    feeSats: src.parsed?.feeSats ?? null,
    lockTime: psbtLockTime(src.psbt),
  };
}

// ─── The review pages, per model and vault kind ──────────────────────────────

export type ReviewPage =
  /** Gen5, Flex, Stax: "Review transaction to send bitcoin", "Swipe to review". */
  | { kind: 'touch-intro' }
  /** The account (a registered vault only), the amount and the address. */
  | { kind: 'touch-output'; account: string | null; name: string | null; amount: string; to: string }
  /** The fee; on a self-transfer (no recipient page) it also carries the
   *  account line, which the device lists before the fee. */
  | { kind: 'touch-fees'; account: string | null; name: string | null; fee: string }
  /** "Sign transaction to send bitcoin?", "Hold to sign". */
  | { kind: 'touch-sign' }
  /** Nano X: one item per page, white on black. */
  | { kind: 'nano-intro' }
  | { kind: 'nano-item'; title: string; value: string; long?: boolean }
  | { kind: 'nano-sign' }
  /** Nova: a titled page, an amount over its address, a plain text page, the total. */
  | { kind: 'nova-item'; title: string; body: string }
  | { kind: 'nova-output'; amount: string; to: string }
  | { kind: 'nova-text'; body: string }
  | { kind: 'nova-total'; total: string; fee: string | null }
  /** A Ledger of unknown model: one page in the words every model starts with. */
  | { kind: 'slab-review' }
  /**
   * Registering the vault (the three videos of 2026-10-04, built in
   * `ui/hww/vaultRegistration.ts`): the touchscreens' five kinds of page
   * ("n of 7" in the footer), the Nano X's three of its own (its name, its
   * policy and its key pages are 'nano-item'), the Nova's one scrolling
   * line under a title (a key, or a policy), `hold` on the last, where the
   * device wants both edges held as on Total; the slab's one page in the
   * words every model starts with.
   */
  | { kind: 'touch-register-intro' }
  | { kind: 'touch-register-account'; name: string; policy: string }
  | { kind: 'touch-register-keys' }
  | { kind: 'touch-register-key'; title: string; key: string }
  | { kind: 'touch-register-approve' }
  | { kind: 'nano-register-intro' }
  | { kind: 'nano-register-keys' }
  | { kind: 'nano-register-approve' }
  | { kind: 'nova-scroll'; title: string; body: string; hold: boolean }
  | { kind: 'slab-register' }
  /**
   * The address check (the three videos of 2026-10-04, built in
   * `ui/hww/addressCheck.ts`): the touchscreens' "Verify bitcoin address"
   * intro and their one address page (the address, the account name, the QR
   * button beside the dark Confirm); the Nano X's intro and its tick over
   * "Confirm" (its address and name pages are 'nano-item'); the Nova's
   * address as one scrolling line under "Receive to" with a tick in place of
   * the ">" (its kind and name pages are 'nova-item'); the slab's one page.
   */
  | { kind: 'touch-address-intro' }
  | { kind: 'touch-address'; address: string; name: string | null }
  | { kind: 'nano-address-intro' }
  | { kind: 'nano-address-confirm' }
  | { kind: 'nova-address'; title: string; body: string }
  | { kind: 'slab-address' };

/** A page of the registration, as opposed to the signing review. */
export function isRegistrationPage(p: ReviewPage): boolean {
  return p.kind.includes('register') || p.kind === 'nova-scroll';
}

/** A page of the address check's own (its shared item pages are not). */
export function isAddressPage(p: ReviewPage): boolean {
  return p.kind.includes('address');
}

/** The touchscreens' account line for a registered vault. */
export const TOUCH_ACCOUNT = 'From registered account';

export function reviewPages(d: DeviceDrawing, f: TourFacts): ReviewPage[] {
  const unit = deviceUnit(brandOf(d), f.network);
  const fee = f.feeSats != null ? deviceAmount(f.feeSats, unit) : null;
  // The newer apps name a registered vault inside the review; the apps that
  // ask for the name first (its own page) do not name it again.
  const reviewName = f.nameFirst ? null : f.registeredName;
  if (isTouchscreen(d)) {
    return [
      { kind: 'touch-intro' },
      ...f.outputs.map(
        (o, i): ReviewPage => ({
          kind: 'touch-output',
          account: i === 0 && reviewName ? TOUCH_ACCOUNT : null,
          name: i === 0 ? reviewName : null,
          amount: deviceAmount(o.amountSats, unit),
          to: o.address ?? '',
        }),
      ),
      ...(fee != null
        ? [
            {
              kind: 'touch-fees',
              account: f.outputs.length === 0 && reviewName ? TOUCH_ACCOUNT : null,
              name: f.outputs.length === 0 ? reviewName : null,
              fee,
            } as const,
          ]
        : []),
      { kind: 'touch-sign' },
    ];
  }
  if (d === 'nanoX') {
    return [
      { kind: 'nano-intro' },
      ...(reviewName ? [{ kind: 'nano-item', title: 'From account', value: reviewName } as const] : []),
      ...f.outputs.flatMap((o): ReviewPage[] => [
        { kind: 'nano-item', title: 'Amount', value: deviceAmount(o.amountSats, unit) },
        { kind: 'nano-item', title: 'To', value: o.address ?? '', long: true },
      ]),
      ...(fee != null ? [{ kind: 'nano-item', title: 'Fees', value: fee } as const] : []),
      { kind: 'nano-sign' },
    ];
  }
  if (d === 'nova') {
    const coin = bitboxCoin(f.network);
    // The name page only when Talia knows the name the BitBox stored: an
    // empty page or today's label would both disagree with the device.
    const named = (title: string): ReviewPage[] =>
      f.registeredName ? [{ kind: 'nova-item', title, body: f.registeredName }] : [];
    const head: ReviewPage[] =
      f.bitboxKind?.kind === 'multisig'
        ? [
            { kind: 'nova-item', title: 'Spend from', body: `${f.bitboxKind.threshold}-of-${f.bitboxKind.keys}\n${coin} multisig` },
            ...named('Spend from'),
          ]
        : f.bitboxKind?.kind === 'policy'
          ? [
              {
                kind: 'nova-item',
                title: 'Spend from',
                body: `${coin}\npolicy with\n${f.bitboxKind.keys} key${f.bitboxKind.keys === 1 ? '' : 's'}`,
              },
              ...named('Name'),
            ]
          : [];
    const sum = f.outputs.reduce((s, o) => s + o.amountSats, 0) + (f.feeSats ?? 0);
    const lock = f.lockTime;
    return [
      ...head,
      ...f.outputs.map(
        (o): ReviewPage => ({ kind: 'nova-output', amount: deviceAmount(o.amountSats, unit), to: novaAddressGroups(o.address ?? '') }),
      ),
      ...(lock && lock.lockTime > 0
        ? [
            {
              kind: 'nova-text',
              body: `Locktime on block:\n${lock.lockTime}\n${lock.rbf ? 'Transaction is RBF' : 'Transaction is not RBF'}`,
            } as const,
          ]
        : []),
      { kind: 'nova-total', total: deviceAmount(sum, unit), fee },
    ];
  }
  return [{ kind: 'slab-review' }];
}

/**
 * The last page stays at least this long on every device, so the press hint
 * has room to show the client what signs: the touchscreens' hold, the Nano
 * X's press of both buttons (its sign page was 1.6 s, too short to see), the
 * Nova's two-edge hold (`NOVA_TOTAL_MS`, longer still).
 */
export const HOLD_PAGE_MS = 2600;

/**
 * The Nova's Total page, as the drawing plays it on the client's turn (decided
 * 2026-10-03: "the user has to press the upper arrow and hold it, and after
 * that the lower right arrow appears and he has to hold that one while
 * holding the upper right button as well until it confirms"; "while the user
 * holds both, the arrows go towards each other and then the transaction
 * confirmation appears on the device"). A demonstration on a timer, at a pace
 * a grandfather can follow, never the device's live state.
 */
export const NOVA_TOTAL_MS = {
  /** The page read before the top right edge is held (the hint lights it half way). */
  read: 850,
  /** The top right edge held alone, the down arrow alone on the screen. */
  top: 1000,
  /** The up arrow shown at the bottom right, the bottom right edge held too. */
  both: 1000,
  /** Both held: the two arrows slide together until they meet. */
  meet: 1200,
  /** "Transaction confirmed", before the tour starts again. */
  confirmed: 1000,
} as const;

/** The whole of the Nova's Total page. */
export const NOVA_TOTAL_PAGE_MS = Object.values(NOVA_TOTAL_MS).reduce((a, b) => a + b, 0);

/**
 * The Nova's one scrolling line, swiped along its lower edge from right to
 * left: the address of the address check (decided 2026-10-04: "the user can scroll
 * through the address by swiping from the right to the left on the lower edge
 * of the bitbox. The display is not big enough to show the entire address")
 * and the address under each amount of the signing review (decided 2026-10-05:
 * "the only way to [fully verify the address] is to swipe through the entire
 * address ... add the same swipe through the address until the end, make a
 * short pause and then press the next icon"). ONE sequence for both pages:
 * the line read `read`; then each stroke, the light at the right end of the
 * edge `lead` before the finger touches, one `stroke` to the left end carrying
 * the line along, the finger off `lift` before the next, the light gone `fade`
 * after; then the end of the line read `settle` before the page turns, the
 * top right edge lighting inside that pause (`HINT_MS.tap.lead` before the
 * turn). Two strokes carry the whole line: how far ONE stroke carries it on
 * the device was not filmed (the video shows no swipe), so nothing claims
 * a count. A demonstration on a timer, at a pace a grandfather can follow.
 */
export const NOVA_SWIPE_MS = { read: 900, lead: 350, stroke: 1100, lift: 500, fade: 300, settle: 1500, strokes: 2 } as const;

/** How many strokes carry this line: `strokes` for one that runs past the
 *  screen (every real address), none for one that fits. */
export function novaSwipeStrokesFor(body: string): number {
  return novaScrollTravel(body) > 0 ? NOVA_SWIPE_MS.strokes : 0;
}

/** From the first stroke's light to the end of the last one's; 0 with no stroke. */
export function novaSwipesMs(strokes: number): number {
  if (strokes <= 0) return 0;
  const sw = NOVA_SWIPE_MS;
  return strokes * (sw.lead + sw.stroke) + (strokes - 1) * sw.lift + sw.fade;
}

/** A swiped page from its start to its turn: the line read, the strokes, its end read. */
export function novaSwipePageMs(strokes: number): number {
  return NOVA_SWIPE_MS.read + novaSwipesMs(strokes) + NOVA_SWIPE_MS.settle;
}

/**
 * The touchscreen Ledgers' last page, as the drawing plays it (decided 2026-10-04,
 * the recording of a Gen5 signing): the page read, the tile pressed, the
 * hold while a THIN DARK LINE fills left to right along the top edge of the
 * "Hold to sign" row (the device draws no ring round the tile), then the page
 * ghosts into "Signing transaction" with the jumping corner, before the tour
 * starts again. A demonstration on a timer, never the device's live state.
 */
export const TOUCH_SIGN_MS = {
  /** The page read before the tile is pressed (the hint lights it first). */
  read: 500,
  /** The tile lit and pulsing before the press. */
  press: 350,
  /** The hold: the line fills along the row's top edge. */
  hold: 1500,
  /** The page ghosts into "Signing transaction", before the tour starts again. */
  signing: 900,
} as const;

/** The whole of the touchscreens' last page. */
export const TOUCH_SIGN_PAGE_MS = Object.values(TOUCH_SIGN_MS).reduce((a, b) => a + b, 0);

/** How long each page stays before the next (the harness's reading pace). */
function dwellOf(p: ReviewPage): number {
  switch (p.kind) {
    case 'touch-intro':
      return 1800;
    case 'touch-output':
      return 2600;
    case 'touch-fees':
      return 1600;
    case 'touch-sign':
      return TOUCH_SIGN_PAGE_MS;
    case 'nano-intro':
    case 'nano-item':
      return 1600;
    case 'nova-item':
    case 'nova-text':
      return 1800;
    case 'nova-output': {
      // The address swiped to its end before the tap (decided 2026-10-05), as on
      // the address check; a line that fits the screen is simply read.
      const strokes = novaSwipeStrokesFor(p.to);
      return strokes > 0 ? novaSwipePageMs(strokes) : 2200;
    }
    case 'nova-total':
      return NOVA_TOTAL_PAGE_MS;
    default:
      return 1600;
  }
}

/** A page that plays a sequence of its own (the Nova's two-edge hold), so
 *  the tour goes round even when it is the only page. */
function hasOwnSequence(p: ReviewPage): boolean {
  return p.kind === 'nova-total';
}

/** When each page shows, in ms after the client's turn opens (the first pass). */
export function tourStarts(pages: readonly ReviewPage[]): number[] {
  let t = 0;
  return pages.map((p) => {
    const at = t;
    t += dwellOf(p);
    return at;
  });
}

/**
 * One pass of the tour, in ms: every page at its reading pace, and the last
 * page (the one the client signs on) held as long as the longest page, and at
 * least `HOLD_PAGE_MS`, before the tour starts again from the first. A single
 * page never moves (0), unless it plays a sequence of its own: a Nova whose
 * only page is Total still shows the hold, round and round.
 */
export function tourCycle(pages: readonly ReviewPage[]): number {
  if (pages.length === 0) return 0;
  if (pages.length < 2 && !hasOwnSequence(pages[0])) return 0;
  const starts = tourStarts(pages);
  return starts[starts.length - 1] + Math.max(HOLD_PAGE_MS, ...pages.map(dwellOf));
}

/** The page on show `elapsed` ms into the turn: round and round, a pass
 *  every `cycle` ms (none when `cycle` is 0). */
export function tourPageAt(starts: readonly number[], elapsed: number, cycle: number): number {
  const t = cycle > 0 ? elapsed % cycle : elapsed;
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t) index = i;
  return index;
}

/** How long until the tour turns its next page, `elapsed` ms into the turn
 *  (from the last page, that is back to the first). Null when it never does. */
export function tourNextTurnIn(starts: readonly number[], elapsed: number, cycle: number): number | null {
  if (cycle <= 0) return null;
  const t = elapsed % cycle;
  const next = starts.find((at) => at > t) ?? cycle;
  return Math.max(1, next - t);
}

/** What the drawn device's screen shows outside the tour. `blank` is a
 *  device the phone has lost (it cannot say what is on it), or, in the
 *  guides before the transaction, a page that has just gone. */
export type DeviceScreen =
  | { kind: 'loading' | 'signing' | 'signed' | 'rejected' | 'blank' }
  /** Bitcoin app 2.2.1 to 2.4.1: "Spend from known wallet", before the review. */
  | { kind: 'name'; name: string }
  | { kind: 'review'; page: ReviewPage; index: number; total: number }
  /**
   * The device locked, asking for its PIN (`ui/hww/deviceTurns.ts`):
   * `entered` digits in; on the Nano X `cursor` is the row's active key (0 to
   * 9 a digit, `NANO_PIN_TICK` the tick at its right end); on a touchscreen
   * `pad` is the keypad's ten digits in cell order, a new order every time
   * the device asks.
   */
  | { kind: 'pin'; entered: number; cursor: number; pad: string }
  /** "Open app?" with the app's name ("Bitcoin", or "Bitcoin Test" off the main network). */
  | { kind: 'open-app'; app: string }
  /**
   * The BitBox after it is plugged in (`ui/hww/deviceTurns.ts`, the photos
   * and the recording of 2026-10-04): "Tap this side" twice round the turning
   * arrow; the password entry with its groups along the bottom (`groups` as
   * the device shows them, split one level deep, `depth`), `entered`
   * characters in and the `last` one still readable; the confirmation with
   * both arrows at once; the lock, which the clock opens; the splash.
   */
  | { kind: 'nova-side' }
  | { kind: 'nova-password'; entered: number; last: string | null; groups: readonly string[]; depth: number }
  | { kind: 'nova-confirm'; entered: number; last: string }
  | { kind: 'nova-lock' }
  | { kind: 'nova-splash' }
  /**
   * The device's own word once it has approved something: the vault
   * ("Account registered" on a Ledger, "Multisig account registered" on the
   * BitBox) or the address ("Address verified" on every Ledger; the videos
   * of 2026-10-04), and the Ledgers' app home where "Open app?" lands and
   * where the address check ends (the videos: the touchscreens' title, the
   * note under it and "Quit app"; the Nano X's title over "app is ready").
   */
  | { kind: 'registered'; text: string }
  | { kind: 'app-home'; app: string; note: string };

/** The drawn screen for a leg; 'tour' means the review pages, stepped by the
 *  screen's own clock. */
export function screenFor(s: CeremonyState, f: TourFacts): DeviceScreen | 'tour' {
  switch (s.leg) {
    case 'send':
      return { kind: 'loading' };
    case 'approve':
      return s.asks === 'name' ? { kind: 'name', name: f.registeredName ?? '' } : 'tour';
    case 'return':
      return { kind: s.signed ? 'signed' : 'signing' };
    case 'declined':
      return { kind: 'rejected' };
    default:
      return { kind: 'blank' };
  }
}

// ─── The card to compare against ─────────────────────────────────────────────

/**
 * What the client checks on the device, in the DEVICE's own print (its unit
 * and decimals, so the two read alike): the amount and the address of each
 * output it lists, shortened, and for a registered vault the name it was
 * registered under. A single-sig vault has no Vault row: the device signs it
 * as a plain account and shows no name. Neither has a review that follows
 * the name's own page (`nameFirst`).
 *
 * A transaction that pays only the vault (a refresh, a cancel) is built to
 * the vault's change branch, so the device prints no amount and no address:
 * the fee is the one figure it shows, and the one check the client has
 * (the refresh session has always said "it shows only the network fee"). The
 * card then asks for the fee, after the name, in the order the device prints
 * them. A payment's card keeps to the amount and the address, which are what
 * a payment is checked by.
 */
export function compareRows(f: TourFacts): SentRow[] {
  const unit = deviceUnit(f.brand, f.network);
  const many = f.outputs.length > 1;
  const rows: SentRow[] = [];
  f.outputs.forEach((o, i) => {
    const n = many ? ` ${i + 1}` : '';
    rows.push({ label: `Amount${n}`, value: deviceAmount(o.amountSats, unit) });
    if (o.address) rows.push({ label: `Address${n}`, value: shortId(o.address), mono: true });
  });
  // The apps that ask for the name first (`nameFirst`) compared it on its own
  // page and do not name it in the review, so the review's card does not ask.
  if (f.registeredName && !f.nameFirst) rows.push({ label: 'Vault', value: f.registeredName });
  if (f.outputs.length === 0 && f.feeSats != null) rows.push({ label: 'Fee', value: deviceAmount(f.feeSats, unit) });
  return rows;
}

/** The card while the device asks for the vault's name first: the name alone. */
export function nameRows(f: TourFacts): SentRow[] {
  return f.registeredName ? [{ label: 'Vault', value: f.registeredName }] : [];
}

// ─── What the screens say ────────────────────────────────────────────────────

/** What the client does on THIS device: true for the model, or for every
 *  Ledger when the model is unknown, and for this vault's own pages. */
export function gestureLine(d: DeviceDrawing, f: TourFacts): string {
  switch (d) {
    case 'nova': {
      // The firmware's own controls: ">" at the top right moves on; on Total
      // the client holds the top right edge, then the bottom right edge too
      // (decided 2026-10-03, the photo of the hold, nova-7).
      const pages = reviewPages(d, f);
      const hold = 'On the Total page, hold the top right edge, then the bottom right edge too.';
      // An address runs past the screen and is swiped along the lower edge to
      // its end (decided 2026-10-05): said only where a page is swiped, and for
      // one address or for each, so the line holds for every vault shape.
      const swiped = pages.filter((p) => p.kind === 'nova-output' && novaSwipeStrokesFor(p.to) > 0).length;
      const swipe = swiped === 0 ? '' : swiped === 1 ? 'Swipe along the lower edge to see the whole address. ' : 'Swipe along the lower edge to see each address in full. ';
      // A one-key vault refreshing with no lock time shows Total alone:
      // nothing to move through (decided 2026-10-04).
      return pages.length > 1 ? `Tap the top right edge to move through its pages. ${swipe}${hold}` : hold;
    }
    case 'nanoX':
      return 'Press the right button to move through the pages. On “Sign transaction”, press both buttons.';
    case 'gen5':
    case 'flex':
    case 'stax':
      // The press hint lights the footer's own ">" (a swipe has no control to
      // light), so the line names it (decided 2026-10-03, design C).
      return 'Tap the arrow at the bottom to move through the pages. On the last page, hold to sign.';
    default:
      return `Move through the pages on the ${deviceName('ledger')}. Approve on the last page.`;
  }
}

/** How to stop: on the device, never on the phone. */
export function stopLine(brand: SigningBrand): string {
  return brand === 'bitbox'
    ? `To stop, tap the × on the ${deviceName('bitbox')}.`
    : `To stop, reject on the ${deviceName('ledger')}.`;
}

export interface CourierWords {
  title: string;
  /** The line under the picture (screens 1 and 3, the endings). */
  line: string | null;
  /** The card's heading on the client's turn. */
  compareTitle: string | null;
  /** The gesture line on the client's turn. */
  body: string | null;
  /** The stop line on the client's turn. */
  caption: string | null;
}

/** "Transaction 2 of 3", the count of a batch signed in one visit. */
export function batchCount(b: BatchPosition): string {
  return `Transaction ${b.index} of ${b.count}`;
}

/**
 * Every sentence of the courier, true for every device and vault: the key's
 * name heads the travelling screens, the client's turn is step 3 of the
 * device's plan, numbered as every turn page is ("3. Sign the transaction",
 * decided 2026-10-05; `deviceSteps.ts`), with what to do on the device for this
 * vault's pages (`f`), and a failure is "Not signed" with what happened. `failure` is the connection flow's own
 * sentence (the existing disconnect sentence, say), which wins over the
 * ceremony's copy of it.
 *
 * A transaction of a batch (`s.batch`, the refresh session) is counted where
 * the line names it: "Sending transaction 2 of 3 to the Ledger.", and on the
 * client's turn the count opens the line under the card, where the session's
 * own step line always carried it ("Transaction 2 of 3. Tap the arrow..."),
 * so the client knows which transaction the device asks about and that
 * another follows. The title stays "3. Sign the transaction" on every one
 * (decided 2026-10-05: "keep 3"): the number is the device's step, not a count.
 */
export function courierWords(
  d: DeviceDrawing,
  keyName: string,
  s: CeremonyState,
  f: TourFacts,
  failure?: string | null,
): CourierWords {
  const brand = brandOf(d);
  const name = deviceName(brand);
  const none = { compareTitle: null, body: null, caption: null };
  const b = s.batch;
  /** "transaction 2 of 3", or "the transaction" for a payment of one. */
  const which = b ? batchCount(b).toLowerCase() : 'the transaction';
  switch (s.leg) {
    case 'send':
      return {
        title: keyName,
        line:
          brand === 'bitbox'
            ? `Handing ${which} to the ${name}.`
            : s.restarted
              ? `The ${name} needs the full transaction. Sending it again.`
              : `Sending ${which} to the ${name}.`,
        ...none,
      };
    case 'approve': {
      const gesture =
        s.asks === 'name'
          ? `The ${name} asks about this vault first. Check its name, then approve it there.`
          : gestureLine(d, f);
      return {
        title: stepTitle(JOB_STEP, SIGN_JOB),
        line: null,
        compareTitle: `Compare on the ${name}`,
        body: b ? `${batchCount(b)}. ${gesture}` : gesture,
        caption: stopLine(brand),
      };
    }
    case 'return':
      return {
        title: keyName,
        line:
          // The same moment reads the same on every device: once the send has
          // started, the signature is in and it is on its way.
          s.sending
            ? 'Signed. Sending it to the network.'
            : brand === 'bitbox'
              ? b
                ? `${batchCount(b)} signed on the ${name}.`
                : `Signed on the ${name}.`
              : b
                ? `Receiving signed ${which}.`
                : 'Receiving the signed transaction.',
        ...none,
      };
    case 'declined':
      return { title: 'Not signed', line: `You declined on the ${name}. Nothing was sent.`, ...none };
    default:
      return { title: 'Not signed', line: failure || s.failure || `The ${name} did not sign.`, ...none };
  }
}
