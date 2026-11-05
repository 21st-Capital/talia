/**
 * Ledger over Bluetooth — the ONE module that talks to @ledgerhq (decided
 * 2026-08-25: BLE is the transport; NFC on Ledger is a dead end for
 * third-party apps).
 *
 * Facts this module encodes (verified against the INSTALLED kits — DMK
 * 1.8.0, RN-BLE transport 1.3.2, signer-kit-bitcoin 1.3.3):
 *
 *  - The DMK is built ONCE, lazily. The BLE transport factory news up its
 *    own BleManager and registers a state listener it can never remove — a
 *    second build would leak managers and double every event.
 *  - Discovery goes through `listenToAvailableDevices`; the transport's
 *    `startDiscovering` is a dead stub returning an empty observable.
 *    Unsubscribing does NOT stop the radio — only `stopDiscovering()` does,
 *    so `startLedgerScan`'s stop handle calls it explicitly.
 *  - Every signer call returns a PLAIN (non-replay) rxjs Subject behind a
 *    per-session FIFO queue: subscribe in the SAME tick or emissions are
 *    lost. `runAction` does call-and-subscribe in one expression.
 *  - The signer kit auto-opens the MAINNET "Bitcoin" app (hardcoded); every
 *    call here passes `skipOpenApp: true` and `openBitcoinApp` opens the
 *    right app for the vault's network itself, then enforces the ≥2.2.1
 *    version gate (2.1.2–2.2.0 sign taproot WRONG — see bitcoin/ledger/
 *    version.ts).
 *  - The ONLY DMK logger attached is the counting tap below: the register
 *    task logs each vault's registration HMAC at Debug level, so no log
 *    CONTENT may ever be stored — the tap counts markers and drops the
 *    line.
 *
 * Layering: this is platform I/O (imported only by ui). The pure,
 * unit-tested pieces live in src/bitcoin/ledger (policy transform, version
 * gate, error translation).
 */
import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  DeviceSessionStateType,
  DeviceStatus,
  GetAppAndVersionCommand,
  OpenAppDeviceAction,
  isSuccessCommandResult,
  type DeviceManagementKit,
  type DeviceSessionId,
  type DiscoveredDevice,
} from '@ledgerhq/device-management-kit';
import { RNBleTransportFactory } from '@ledgerhq/device-transport-kit-react-native-ble';
import {
  DefaultDescriptorTemplate,
  DefaultWallet,
  RegisteredWallet,
  SignerBtcBuilder,
  WalletPolicy,
  type SignerBtc,
} from '@ledgerhq/device-signer-kit-bitcoin';
import type { Observable } from 'rxjs';

import {
  APP_MISSING_MESSAGE,
  DECLINED_ON_LEDGER,
  bitcoinAppBlocker,
  bitcoinAppFor,
  bitcoinAppMissingMessage,
  ledgerErrorMessage,
  type LedgerPolicy,
  type LedgerSig,
  type LedgerWalletSpec,
} from '../bitcoin/ledger';
import type { Network } from '../bitcoin/descriptor/types';
import { slimPsbtBase64ForDevice, slimPsbtBase64ForLedgerPolicy } from '../bitcoin/psbt/slim';

// ─── The kit singleton ───────────────────────────────────────────────────────

let dmk: DeviceManagementKit | null = null;

/** Set when a discovery stream ERRORED (Bluetooth off, permission denied).
 *  The transport's stream is dead for good after that — every later
 *  subscribe replays the same error instantly, which made every "Try
 *  again" a dead button (decided 2026-08-27: Bluetooth back on, taps did
 *  nothing). The next getDmk() rebuilds the whole stack instead; any
 *  session on the old kit was dead anyway — the radio was off. */
let scanDied = false;

/** Force the next scan onto a REBUILT stack. The universal Connect Hardware
 *  search calls this when a Ledger scan runs dry: DMK discovery has been seen
 *  to come back silent after a stop/re-listen cycle, and a fresh kit (fresh
 *  BleManager) is the reliable restart (a stuck search in a phone test, 2026-08-31). */
export function flagLedgerScanDead(): void {
  scanDied = true;
}

/**
 * A counting tap on the kit's own logs — the diagnostic that sized the
 * 7-input signing stall (decided 2026-08-31). It stores NOTHING of the log
 * content (the register task logs vault HMACs at Debug level, and payload
 * hex must never sit in memory): only how many exchanges happened and
 * when, so a slow ceremony can show motion and the exchange count tells
 * us whether the time goes into round-trip COUNT or per-trip overhead.
 */
let apduCount = 0;
let apduListener: ((count: number) => void) | null = null;
const ringLogger = {
  log: (_level: unknown, message: unknown) => {
    // The kit logs '[exchange] => <hex>' once per APDU sent — count the
    // marker, never touch the hex.
    if (typeof message === 'string' && message.startsWith('[exchange] =>')) {
      apduCount += 1;
      apduListener?.(apduCount);
    }
  },
};

/** Watch device chatter (exchange count) while a ceremony runs. Returns
 *  unsubscribe. One listener at a time — last caller wins. */
export function watchLedgerActivity(onCount: (count: number) => void): () => void {
  apduCount = 0;
  apduListener = onCount;
  return () => {
    if (apduListener === onCount) apduListener = null;
  };
}

function getDmk(): DeviceManagementKit {
  if (scanDied) {
    scanDied = false;
    const old = dmk;
    dmk = null;
    try {
      old?.close();
    } catch {
      // Best-effort — the old kit may already be dead.
    }
  }
  if (dmk == null) {
    dmk = new DeviceManagementKitBuilder()
      .addTransport(RNBleTransportFactory)
      .addLogger(ringLogger)
      .build();
  }
  return dmk;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/** What the connect screen renders per found device. */
export interface FoundLedger {
  id: string;
  /** Advertised name, falling back to the model's product name. */
  name: string;
  /** The model the kit reports at discovery, its own id: 'apexp' (the Nano
   *  Gen5), 'flex', 'stax', 'nanoX' (and the USB-only 'nanoS'/'nanoSP'). The
   *  registry names the model from it (`wallet/deviceKinds.ts` modelFromKit)
   *  and every drawing and record follows. */
  model: string;
  raw: DiscoveredDevice;
}

/**
 * Start scanning for Ledgers. `onError` receives a plain-language message
 * (Bluetooth off, permission denied, …) — the errored stream is DEAD for
 * good, so the module flags the whole stack for a rebuild and the next
 * startLedgerScan (a retry from any screen) gets a fresh kit. The stop
 * handle must be called on unmount: dropping the subscription alone leaves
 * the radio scanning forever.
 */
export function startLedgerScan(
  onDevices: (devices: FoundLedger[]) => void,
  onError: (message: string) => void,
): () => void {
  const kit = getDmk();
  const sub = kit.listenToAvailableDevices({}).subscribe({
    next: (devices) => {
      onDevices(
        devices.map((d) => ({
          id: d.id,
          name: d.name || d.deviceModel.name,
          model: d.deviceModel.model,
          raw: d,
        })),
      );
    },
    error: (e) => {
      // The stream is unrecoverable from here — flag the stack for a
      // rebuild so the next scan (any screen's retry) starts fresh.
      scanDied = true;
      onError(ledgerErrorMessage(e));
    },
  });
  return () => {
    sub.unsubscribe();
    void kit.stopDiscovering().catch(() => {});
  };
}

// ─── Connection & session ────────────────────────────────────────────────────

export type LedgerSessionId = DeviceSessionId;

/** Connect (pairing on first contact). Throws plain-language messages. */
export async function connectLedger(device: FoundLedger): Promise<LedgerSessionId> {
  try {
    return await getDmk().connect({ device: device.raw });
  } catch (e) {
    throw new Error(ledgerErrorMessage(e));
  }
}

/** Best-effort disconnect — the session may already be gone. */
export async function disconnectLedger(sessionId: LedgerSessionId): Promise<void> {
  try {
    await getDmk().disconnect({ sessionId });
  } catch {
    // Already disconnected — nothing to do.
  }
}

export interface LedgerSessionView {
  /** 'locked' → owner must enter the PIN; 'gone' → session died. */
  status: 'ready' | 'locked' | 'busy' | 'gone';
  /** Open app, when the session knows it (refresher-polled). */
  appName?: string;
  appVersion?: string;
}

/** Watch a session's coarse state for the UI. Returns unsubscribe. */
export function watchLedgerSession(
  sessionId: LedgerSessionId,
  onState: (view: LedgerSessionView) => void,
): () => void {
  // A REMOVED session (terminal disconnect) makes getDeviceSessionState
  // THROW synchronously rather than hand back an erroring observable —
  // report it as 'gone' like every other death, never crash the caller.
  let sub;
  try {
    sub = getDmk().getDeviceSessionState({ sessionId }).subscribe({
      next: (state) => {
        const status =
          state.deviceStatus === DeviceStatus.LOCKED
            ? 'locked'
            : state.deviceStatus === DeviceStatus.BUSY
              ? 'busy'
              : state.deviceStatus === DeviceStatus.NOT_CONNECTED
                ? 'gone'
                : 'ready';
        const view: LedgerSessionView = { status };
        if (state.sessionStateType !== DeviceSessionStateType.Connected) {
          view.appName = state.currentApp?.name;
          view.appVersion = state.currentApp?.version;
        }
        onState(view);
      },
      error: () => onState({ status: 'gone' }),
      complete: () => onState({ status: 'gone' }),
    });
  } catch {
    onState({ status: 'gone' });
    return () => {};
  }
  return () => sub.unsubscribe();
}

// ─── Device-action plumbing ──────────────────────────────────────────────────

/** What the device is waiting on, for on-screen guidance. */
export type LedgerPrompt =
  | 'unlock'
  | 'open-app'
  | 'confirm-register'
  | 'confirm-sign'
  | 'verify-address'
  | null;

function promptOf(interaction: unknown): LedgerPrompt {
  switch (interaction) {
    case 'unlock-device':
      return 'unlock';
    case 'confirm-open-app':
      return 'open-app';
    case 'register-wallet':
      return 'confirm-register';
    case 'sign-transaction':
      return 'confirm-sign';
    case 'verify-address':
      return 'verify-address';
    default:
      return null;
  }
}

interface ActionHandle<Output, IntermediateValue> {
  observable: Observable<
    | { status: DeviceActionStatus.NotStarted }
    | { status: DeviceActionStatus.Pending; intermediateValue: IntermediateValue }
    | { status: DeviceActionStatus.Stopped }
    | { status: DeviceActionStatus.Completed; output: Output }
    | { status: DeviceActionStatus.Error; error: unknown }
  >;
  cancel(): void;
}

/**
 * Run one device action to completion. Subscribes synchronously (the
 * underlying Subject does not replay), surfaces Pending interactions to the
 * UI, and maps every failure shape — an Error-status emission, a hard
 * observable error, or a Stopped cancellation — to a readable rejection.
 */
function runAction<Output, IntermediateValue extends { requiredUserInteraction?: unknown }>(
  makeHandle: () => ActionHandle<Output, IntermediateValue>,
  onPrompt?: (prompt: LedgerPrompt) => void,
): Promise<Output> {
  return new Promise<Output>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    // Built INSIDE the executor: a removed session makes the kit throw
    // synchronously at construction, and that too must arrive as a plain
    // sentence, not a raw internal object with no message.
    let handle: ActionHandle<Output, IntermediateValue>;
    try {
      handle = makeHandle();
    } catch (e) {
      done(() => reject(new Error(ledgerErrorMessage(e))));
      return;
    }
    handle.observable.subscribe({
      next: (state) => {
        if (state.status === DeviceActionStatus.Pending) {
          onPrompt?.(promptOf(state.intermediateValue?.requiredUserInteraction));
        } else if (state.status === DeviceActionStatus.Completed) {
          done(() => resolve(state.output));
        } else if (state.status === DeviceActionStatus.Error) {
          done(() => reject(new Error(ledgerErrorMessage(state.error))));
        } else if (state.status === DeviceActionStatus.Stopped) {
          done(() => reject(new Error('Cancelled.')));
        }
      },
      error: (e) => done(() => reject(new Error(ledgerErrorMessage(e)))),
      complete: () =>
        done(() => reject(new Error(ledgerErrorMessage(new Error('ended unexpectedly'))))),
    });
  });
}

function signerFor(sessionId: LedgerSessionId): SignerBtc {
  // Cheap to build; a signer is bound to one sessionId, and sessions die on
  // disconnect — so build per call rather than caching a dead binding.
  return new SignerBtcBuilder({ dmk: getDmk(), sessionId }).build();
}

// ─── Operations ──────────────────────────────────────────────────────────────

/**
 * Open the app that serves `network` ("Bitcoin" / "Bitcoin Test") and
 * enforce the tapleaf-safe minimum version. Returns the app version.
 * MUST run before any signer operation — they are all called with
 * `skipOpenApp: true` so the device stays in the app verified here.
 */
export async function openBitcoinApp(
  sessionId: LedgerSessionId,
  network: Network,
  onPrompt?: (prompt: LedgerPrompt) => void,
): Promise<string> {
  const kit = getDmk();
  try {
    await runAction(
      () =>
        kit.executeDeviceAction({
          sessionId,
          deviceAction: new OpenAppDeviceAction({ input: { appName: bitcoinAppFor(network) } }),
        }),
      onPrompt,
    );
  } catch (e) {
    // "App missing" deserves the network-specific install steps — the
    // testnet app is hidden in Ledger Live until Developer mode is on.
    if ((e as Error).message === APP_MISSING_MESSAGE) {
      throw new Error(bitcoinAppMissingMessage(network));
    }
    throw e;
  }
  let res;
  try {
    res = await kit.sendCommand({ sessionId, command: new GetAppAndVersionCommand() });
  } catch (e) {
    throw new Error(ledgerErrorMessage(e));
  }
  if (!isSuccessCommandResult(res)) {
    throw new Error(ledgerErrorMessage(res.error));
  }
  const blocker = bitcoinAppBlocker(res.data.name, res.data.version, network);
  if (blocker) throw new Error(blocker);
  return res.data.version;
}

/**
 * Open the Bitcoin app, surviving the PIN. Entering the PIN makes a locked
 * Ledger drop its Bluetooth link, which kills the kit's own once-a-second
 * unlock poll: the first attempt then hangs toward its 60-second timeout,
 * and the owner's only way through was cancel + retry while unlocked (found
 * 2026-08-31). This wrapper watches the session while the unlock prompt is
 * up; the moment the session dies — or the attempt fails after the prompt
 * was shown — it reconnects to the same device ONCE and opens the app on a
 * fresh session. Returns the session that actually holds the open app: the
 * caller MUST adopt it, since the one passed in may be dead.
 */
export async function openBitcoinAppReady(
  device: FoundLedger,
  sessionId: LedgerSessionId,
  network: Network,
  onPrompt?: (prompt: LedgerPrompt) => void,
  /** Called as the link is rebuilt after the PIN: the PIN is in, so the
   *  caller takes down its PIN page and says it is connecting again (decided
   *  2026-10-04: the drawn keypad stayed up through the reconnect, inviting
   *  the PIN a second time). */
  onReconnect?: () => void,
): Promise<{ sessionId: LedgerSessionId; appVersion: string }> {
  let unlockSeen = false;
  /** The open went silent on a device no longer locked: retried on a fresh link. */
  let stalled = false;
  const prompt = (p: LedgerPrompt) => {
    if (p === 'unlock') unlockSeen = true;
    onPrompt?.(p);
  };
  const attempt = (sid: LedgerSessionId) =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      // The watchdog (reported 2026-10-04, a Nano X while signing: "After I put the
      // pin, it doesnt prompt the app opening. Only on the second try it
      // does"): a device that keeps its link through the PIN but leaves the
      // kit's open hanging never died, so the reconnect below never ran and
      // the owner faced a silent wait toward the kit's 60-second timeout. Now
      // an open that, with the device NOT locked, neither asks for anything
      // nor answers within OPEN_STALL_MS gives up on this link and the open
      // runs again on a fresh one. While the device is locked (the PIN being
      // typed) it waits as long as it takes.
      let lastStatus: LedgerSessionView['status'] | null = null;
      let progressed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (!progressed && lastStatus !== 'locked') {
            stalled = true;
            done(() => reject(new Error('The Ledger stopped answering after the PIN.')));
          } else if (!progressed) {
            arm();
          }
        }, OPEN_STALL_MS);
      };
      const done = (fn: () => void) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          unwatch();
          fn();
        }
      };
      const unwatch = watchLedgerSession(sid, (view) => {
        const was = lastStatus;
        lastStatus = view.status;
        // Only in the unlock context: an ordinary death mid-open must keep
        // its own error message and take no silent second attempt.
        if (view.status === 'gone' && unlockSeen) {
          done(() => reject(new Error('The Ledger restarted its connection after the PIN.')));
          return;
        }
        // Unlocked just now: the watchdog's clock starts from here.
        if (was === 'locked' && view.status !== 'locked') arm();
      });
      openBitcoinApp(sid, network, (p) => {
        // Anything the device asks beyond its PIN ("Open app?") is progress:
        // the owner's answer may take as long as it takes.
        if (p != null && p !== 'unlock') progressed = true;
        prompt(p);
      }).then(
        (v) => done(() => resolve(v)),
        (e) => done(() => reject(e)),
      );
      arm();
    });
  try {
    const appVersion = await attempt(sessionId);
    return { sessionId, appVersion };
  } catch (e) {
    if (!unlockSeen && !stalled) throw e;
    await disconnectLedger(sessionId);
    onPrompt?.(null);
    onReconnect?.();
    // A device that just restarted its Bluetooth after the PIN can need a
    // moment before it takes a connection again.
    let fresh: LedgerSessionId | null = null;
    let lastError: unknown = null;
    for (let i = 0; i < RECONNECT_TRIES && fresh == null; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, RECONNECT_GAP_MS));
      try {
        fresh = await connectLedger(device);
      } catch (err) {
        lastError = err;
      }
    }
    if (fresh == null) throw lastError instanceof Error ? lastError : new Error(ledgerErrorMessage(lastError));
    const appVersion = await attempt(fresh);
    return { sessionId: fresh, appVersion };
  }
}

/** How long an open may stay silent on an unlocked device before it is run
 *  again on a fresh link (the device's own "Open app?" comes within a second
 *  or two; an app already open answers at once). */
export const OPEN_STALL_MS = 6000;
/** Connections tried after the PIN, and the gap between them. */
export const RECONNECT_TRIES = 3;
export const RECONNECT_GAP_MS = 1500;

/** The device's BIP-32 master fingerprint, lowercase hex. */
export async function getLedgerMasterFingerprint(
  sessionId: LedgerSessionId,
  onPrompt?: (prompt: LedgerPrompt) => void,
): Promise<string> {
  const out = await runAction(
    () => signerFor(sessionId).getMasterFingerprint({ skipOpenApp: true }),
    onPrompt,
  );
  return Array.from(out.masterFingerprint)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * An xpub at `path` — apostrophe-hardened, NO leading "m/" (the kit's path
 * parser throws on "m/" and silently un-hardens "84h").
 */
export async function getLedgerXpub(
  sessionId: LedgerSessionId,
  path: string,
  onPrompt?: (prompt: LedgerPrompt) => void,
): Promise<string> {
  // The kit's path parser throws on a leading "m/" and SILENTLY un-hardens
  // "84h" (apostrophes only) — normalize both instead of trusting callers.
  const normalized = path.replace(/^m\//, '').replace(/(\d+)[hH](?=\/|$)/g, "$1'");
  const out = await runAction(
    () =>
      signerFor(sessionId).getExtendedPublicKey(normalized, {
        checkOnDevice: false,
        skipOpenApp: true,
      }),
    onPrompt,
  );
  return out.extendedPublicKey;
}

/**
 * The registration ceremony: the device walks the owner through the policy
 * on its own screen and returns the HMAC signing will present later.
 */
export async function registerLedgerPolicy(
  sessionId: LedgerSessionId,
  policy: LedgerPolicy,
  onPrompt?: (prompt: LedgerPrompt) => void,
): Promise<{ hmacHex: string }> {
  const registered = await runAction(
    () =>
      signerFor(sessionId).registerWallet(
        new WalletPolicy(policy.name, policy.descriptorTemplate, policy.keys),
        { skipOpenApp: true },
      ),
    onPrompt,
  );
  const hmacHex = Array.from(registered.hmac)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { hmacHex };
}

// ─── Acting on a vault (verify address, sign) ────────────────────────────────

const TEMPLATE_MAP: Record<string, DefaultDescriptorTemplate> = {
  pkh: DefaultDescriptorTemplate.LEGACY,
  'sh-wpkh': DefaultDescriptorTemplate.NESTED_SEGWIT,
  wpkh: DefaultDescriptorTemplate.NATIVE_SEGWIT,
  tr: DefaultDescriptorTemplate.TAPROOT,
};

function hexToBytes(hexStr: string): Uint8Array {
  const out = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// The kit's public barrel exports the wallet CLASSES but neither the Wallet
// union, the signature types, nor the isPartialSignature guard — declare
// structural equivalents locally (musig variants carry participantPubkey
// instead of pubkey and are filtered out; Talia does not do musig).
type SignerWallet = DefaultWallet | RegisteredWallet;

interface PlainSignature {
  inputIndex: number;
  pubkey: Uint8Array;
  signature: Uint8Array;
  tapleafHash?: Uint8Array;
}

function isPlainSignature(s: unknown): s is PlainSignature {
  return typeof s === 'object' && s != null && 'pubkey' in s && 'signature' in s;
}

/** The signer kit's view of a vault, from the pure spec. */
function toSignerWallet(spec: LedgerWalletSpec): SignerWallet {
  if (spec.kind === 'default') {
    return new DefaultWallet(spec.derivationPath, TEMPLATE_MAP[spec.template]);
  }
  return new RegisteredWallet(spec.name, spec.descriptorTemplate, spec.keys, hexToBytes(spec.hmacHex));
}

/**
 * Have the Ledger derive and DISPLAY the address at `index`, returning what
 * it computed. The caller MUST compare it to the app's own address — the
 * whole point is two independent derivations agreeing.
 */
export async function getLedgerVerifiedAddress(
  sessionId: LedgerSessionId,
  spec: LedgerWalletSpec,
  index: number,
  change: boolean,
  onPrompt?: (prompt: LedgerPrompt) => void,
): Promise<string> {
  const out = await runAction(
    () =>
      signerFor(sessionId).getWalletAddress(toSignerWallet(spec), index, {
        checkOnDevice: true,
        change,
        skipOpenApp: true,
      }),
    onPrompt,
  );
  return out.address;
}

/**
 * Sign a PSBT on the Ledger. Returns the bare signatures the device
 * yielded (merging them back into the PSBT is bitcoin/ledger/merge.ts —
 * pure and tested). Runs AFTER openBitcoinApp, like every signer call.
 */
export async function signLedgerPsbt(
  sessionId: LedgerSessionId,
  spec: LedgerWalletSpec,
  psbtBase64: string,
  onPrompt?: (prompt: LedgerPrompt) => void,
  /** The connected device's master fingerprint: unlocks the tighter
   *  policy-only PSBT cut (kept derivation entry = this device's). */
  deviceFingerprint?: string,
  /** Fired when the tighter form failed and the fuller one is starting —
   *  the ceremony can say so, and the exchange counter's story stays
   *  honest. */
  onFallback?: () => void,
): Promise<LedgerSig[]> {
  const attempt = async (psbt: string): Promise<LedgerSig[]> => {
    const yielded = await runAction(
      () => signerFor(sessionId).signPsbt(toSignerWallet(spec), psbt, { skipOpenApp: true }),
      onPrompt,
    );
    return yielded.filter(isPlainSignature).map((s) => ({
      inputIndex: s.inputIndex,
      pubkey: s.pubkey,
      signature: s.signature,
      tapleafHash: s.tapleafHash,
    }));
  };
  // The engine packs every input's whole parent transaction into the PSBT;
  // over Bluetooth that stalled a 7-input spend on "Loading transaction"
  // until the device gave up (decided 2026-08-31). Taproot inputs don't need the
  // parents — prune them so a spend of ANY number of coins stays kilobytes.
  //
  // Policy vaults go further: the device re-derives scripts and tree from
  // the registered policy, so the leaf scripts, internal key, tree root and
  // the co-signers' derivation entries are exchanges for nothing (890+ at
  // ~84ms each on the 7-coin spend). If the tighter form comes back short
  // or broken, the proven fuller form runs automatically — EXCEPT after a
  // decline on the device: asking again after a "no" is not a retry, it is
  // nagging.
  if (spec.kind === 'registered' && deviceFingerprint) {
    try {
      const sigs = await attempt(slimPsbtBase64ForLedgerPolicy(psbtBase64, deviceFingerprint));
      if (sigs.length > 0) return sigs;
    } catch (e) {
      if ((e as Error).message === DECLINED_ON_LEDGER) throw e;
    }
    onFallback?.();
    onPrompt?.(null);
  }
  const sigs = await attempt(slimPsbtBase64ForDevice(psbtBase64).psbt);
  if (sigs.length === 0) {
    throw new Error('The Ledger returned no signature. Please try again.');
  }
  return sigs;
}
