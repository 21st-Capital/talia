/**
 * Talking to a BitBox02 Nova over Bluetooth. FIRST PART: the probe.
 *
 * The Nova is the only BitBox with a radio, and no BitBox SDK ships a
 * Bluetooth transport: their Rust crate speaks USB, WASM and simulator only,
 * and the official iOS app writes its own Bluetooth layer in Swift. So Talia
 * has to bring the transport, and the eventual shape is a Rust `bitbox-ffi`
 * built like the BDK fork, with this file feeding it bytes.
 *
 * Before any of that exists, this module answers the questions that would
 * otherwise be guessed at, and every one of them costs a native rebuild to get
 * wrong later:
 *
 *   - Are the GATT identifiers below right? They were read out of the
 *     vendor's Swift source, never confirmed against hardware.
 *   - Is the Nova discoverable by service UUID, and can we connect?
 *   - What MTU does iOS actually negotiate? That decides how many 64-byte
 *     frames may go in one write, and the device drops anything else without
 *     a word.
 *   - What firmware is on the device, for the >= 9.21 taproot gate?
 *   - Can our BleManager coexist with the Ledger stack's own?
 *
 * Nothing here writes to the device. It scans, connects, reads one
 * characteristic and disconnects.
 */
import { base64 } from '@scure/base';
import { slimPsbtBase64ForDevice } from '../bitcoin/psbt/slim';
import type { Device } from 'react-native-ble-plx';

import { bleManager, bluetoothBlocker } from './bleManager';
import { checkProduct, type ProductVerdict } from '../bitcoin/bitbox/product';
import { writeChunkSize } from '../bitcoin/bitbox/framing';

/** Nova GATT, from the official BitBoxApp's Bluetooth.swift. */
export const NOVA_SERVICE = 'e1511a45-f3db-44c0-82b8-6c880790d1f1';
export const NOVA_WRITE_CHAR = '799d485c-d354-4ed0-b577-f8ee79ec275a';
export const NOVA_READ_CHAR = '419572a5-9f53-4eb1-8db7-61bcab928867';
export const NOVA_PRODUCT_CHAR = '9d1c9a77-8b03-4e49-8053-3955cda7da93';

export interface FoundDevice {
  id: string;
  name: string;
}

/**
 * Scan for anything advertising the Nova service. Returns a stop function,
 * and the CALLER MUST CALL IT: a running scan drains the battery and, worse,
 * the next `startDeviceScan` anywhere in the app silently replaces it.
 */
export function scanForNova(
  onFound: (d: FoundDevice) => void,
  onError: (message: string) => void,
): () => void {
  let stopped = false;
  const seen = new Set<string>();

  void (async () => {
    const blocker = await bluetoothBlocker();
    if (blocker) {
      onError(blocker);
      return;
    }
    if (stopped) return;
    bleManager().startDeviceScan([NOVA_SERVICE], null, (err, device) => {
      if (stopped) return;
      if (err) {
        onError(err.message || 'The Bluetooth scan stopped unexpectedly.');
        return;
      }
      if (!device || seen.has(device.id)) return;
      seen.add(device.id);
      onFound({ id: device.id, name: device.name || device.localName || 'BitBox02 Nova' });
    });
  })();

  return () => {
    if (stopped) return;
    stopped = true;
    // Only stopDeviceScan actually powers the radio down; dropping the
    // callback leaves it running (the same trap as the Ledger's discovery).
    try {
      bleManager().stopDeviceScan();
    } catch {
      // Manager already gone: nothing to stop.
    }
  };
}

export interface ProbeResult {
  deviceId: string;
  name: string;
  /** Raw JSON from the product characteristic, shown as-is for diagnosis. */
  productJson: string;
  verdict: ProductVerdict;
  /** What iOS negotiated. Decides the write size. */
  mtu: number | null;
  /** Bytes per write this link allows, from the vendor's rule. */
  chunkSize: number;
  /** Every characteristic we could see, so a wrong UUID is visible rather
   *  than showing up as a silent failure. */
  characteristics: string[];
}

/**
 * Connect, read the product characteristic, disconnect.
 *
 * The product characteristic is also the vendor's pairing gate: iOS raises
 * the pairing prompt on first access to it, and the official app treats its
 * first value as "paired". So a first run is expected to show the system
 * pairing dialog.
 */
export async function probeNova(deviceId: string): Promise<ProbeResult> {
  const mgr = bleManager();
  let device: Device | null = null;
  try {
    device = await mgr.connectToDevice(deviceId, { timeout: 15000 });
    device = await device.discoverAllServicesAndCharacteristics();

    const services = await device.services();
    const nova = services.find((s) => s.uuid.toLowerCase() === NOVA_SERVICE);
    const chars = nova ? await nova.characteristics() : [];
    const characteristics = chars.map((c) => c.uuid.toLowerCase());

    const productJson = await readProduct(device);
    const mtu = typeof device.mtu === 'number' ? device.mtu : null;

    return {
      deviceId,
      name: device.name || device.localName || 'BitBox02 Nova',
      productJson,
      verdict: checkProduct(productJson),
      mtu,
      chunkSize: writeChunkSize(mtu),
      characteristics,
    };
  } finally {
    if (device) {
      try {
        await mgr.cancelDeviceConnection(device.id);
      } catch {
        // Already gone; nothing useful to report from a teardown.
      }
    }
  }
}

/** The characteristic may be readable, or notify-only. Try the plain read
 *  first and fall back to a single notification, because the vendor's own
 *  client treats the first notification as the value. */
async function readProduct(device: Device): Promise<string> {
  try {
    const c = await device.readCharacteristicForService(NOVA_SERVICE, NOVA_PRODUCT_CHAR);
    if (c.value) return decode(c.value);
  } catch {
    // Fall through to the notification path.
  }
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('The BitBox did not report what it is within 10 seconds.'));
    }, 10000);
    const sub = device.monitorCharacteristicForService(
      NOVA_SERVICE,
      NOVA_PRODUCT_CHAR,
      (err, c) => {
        if (err) {
          clearTimeout(timer);
          sub.remove();
          reject(new Error(err.message || 'The BitBox stopped responding.'));
          return;
        }
        if (!c?.value) return;
        clearTimeout(timer);
        sub.remove();
        resolve(decode(c.value));
      },
    );
  });
}

/** ble-plx hands every value across as base64, in both directions. */
function decode(b64: string): string {
  const bytes = base64.decode(b64);
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

// ─── SECOND PART: the protocol session ───────────────────────────────────────
//
// The Rust side (bitbox-ffi, behind the BitboxModule native module) owns the
// protocol: U2F-HID command framing, the Noise encryption, pairing, the BTC
// calls. This side owns the radio, and the seam is frames: every 64-byte
// frame Rust wants sent arrives as a 'bitboxFrame' event and goes out through
// ble-plx; every notification from the read characteristic is reassembled to
// whole frames and fed back with feedFrame.
//
// THREADING: a protocol call blocks its native queue until the device
// answers, and the answer arrives through this pump. The pump must therefore
// never wait on a protocol call, which is why writes are chained on their own
// promise queue rather than awaited inline in the event handler.

import { NativeEventEmitter, NativeModules } from 'react-native';
import { FrameReader, chunkForWrite } from '../bitcoin/bitbox/framing';
import type { BitboxPolicy } from '../bitcoin/bitbox/policy';

const Native = NativeModules.BitboxModule as {
  createClient(noiseConfigJson: string | null): Promise<number>;
  feedFrame(handle: number, frameB64: string): void;
  open(handle: number): Promise<void>;
  unlockAndPair(handle: number): Promise<string | null>;
  confirmPairing(handle: number): Promise<void>;
  noiseConfigJson(handle: number): Promise<string>;
  deviceInfo(handle: number): Promise<{
    name: string;
    version: string;
    initialized: boolean;
    mnemonicPassphraseEnabled: boolean;
  }>;
  rootFingerprint(handle: number): Promise<string>;
  xpub(
    handle: number,
    keypath: string,
    xpubType: 'tpub' | 'xpub' | 'zpub' | 'vpub',
    display: boolean,
  ): Promise<string>;
  isPolicyRegistered(
    handle: number,
    testnet: boolean,
    policy: string,
    keys: NativePolicyKey[],
    keypathAccount: string,
  ): Promise<boolean>;
  registerPolicy(
    handle: number,
    testnet: boolean,
    policy: string,
    keys: NativePolicyKey[],
    keypathAccount: string,
    name: string,
  ): Promise<void>;
  policyAddress(
    handle: number,
    testnet: boolean,
    policy: string,
    keys: NativePolicyKey[],
    keypath: string,
    display: boolean,
  ): Promise<string>;
  signPsbt(
    handle: number,
    testnet: boolean,
    psbtB64: string,
    policy: string | null,
    keys: NativePolicyKey[],
    keypathAccount: string | null,
  ): Promise<string>;
  close(handle: number): void;
};

interface NativePolicyKey {
  rootFingerprintHex: string | null;
  keypath: string | null;
  xpub: string;
}

/** Live facts about the link, for the screen to show when something stalls.
 *  The first hang on hardware was mute (device idle, app on "Connecting"),
 *  and mute failures on a Bluetooth link are undebuggable from a screenshot.
 *  These counters make the next one name itself. */
export interface NovaDiagnostics {
  framesOut: number;
  framesIn: number;
  writeErrors: string[];
  /** First 16 bytes of the first frame we sent, hex: lets the U2F-HID header
   *  (cid ff00ff00, cmd, length) be eyeballed from the screen. */
  firstFrameHex: string | null;
  /** The whole conversation, newest last: direction + first 12 bytes of each
   *  frame, capped. When the library says only "unknown error", this is the
   *  wire saying exactly what happened (added after the third mystery
   *  failure in one day, 2026-08-31). */
  trace: string[];
  /** The vendor's ready gate: their backend opens the protocol only after
   *  the product characteristic notifies on THIS connection. */
  productNotified: boolean;
}

export interface NovaSession {
  readonly diag: NovaDiagnostics;
  /** Starts the Noise handshake. Resolves with the pairing code to show, or
   *  null when this phone is already noise-paired with this device. */
  unlockAndPair(): Promise<string | null>;
  /** Resolves once the user confirms the code ON THE DEVICE. */
  confirmPairing(): Promise<void>;
  /** Persist this (Keychain) and pass it to the next connectNova: it is what
   *  makes the next pairing codeless. */
  noiseConfig(): Promise<string>;
  deviceInfo(): Promise<{ name: string; version: string; initialized: boolean }>;
  rootFingerprint(): Promise<string>;
  xpub(keypath: string, xpubType: 'tpub' | 'xpub' | 'zpub' | 'vpub', display: boolean): Promise<string>;
  /** Is this wallet policy already on the device? */
  isPolicyRegistered(testnet: boolean, p: BitboxPolicy, keypathAccount: string): Promise<boolean>;
  /** Register the policy; the device shows `p.name` and asks for approval. */
  registerPolicy(testnet: boolean, p: BitboxPolicy, keypathAccount: string): Promise<void>;
  /** Derive an address under the policy; display=true shows it on the device. */
  policyAddress(
    testnet: boolean,
    p: BitboxPolicy,
    keypath: string,
    display: boolean,
  ): Promise<string>;
  /** Sign. Policy null = plain single-sig, inferred from the PSBT's origins.
   *  The device never finalizes; completePsbt stays in charge. */
  signPsbt(
    testnet: boolean,
    psbtB64: string,
    p: BitboxPolicy | null,
    keypathAccount: string | null,
  ): Promise<string>;
  /** Tear down: unsubscribes, disconnects, frees the Rust client. Safe twice. */
  close(): Promise<void>;
}

/**
 * Connect and stand up the frame pump. The caller gets a session whose calls
 * map 1:1 onto the Rust ops; everything Bluetooth is private in here.
 */
export async function connectNova(
  deviceId: string,
  storedNoiseConfig: string | null,
): Promise<NovaSession> {
  const mgr = bleManager();
  let device = await mgr.connectToDevice(deviceId, { timeout: 15000 });
  device = await device.discoverAllServicesAndCharacteristics();
  const mtu = typeof device.mtu === 'number' ? device.mtu : null;

  // THE PUMP MUST EXIST BEFORE THE CLIENT. createClient itself talks to the
  // device (the protocol-info query runs inside it), so its first frames fire
  // while the createClient promise is still pending. On the first device test
  // the listener was registered after the await: the frames were dropped, the
  // device never heard from us, and it sat on "See the BitBoxApp" while the
  // app sat on "Connecting" -- a deadlock caught on hardware within the
  // hour (2026-08-31). Both directions are wired first now, and inbound
  // frames that arrive before the handle exists are buffered, not lost.
  const emitter = new NativeEventEmitter(NativeModules.BitboxModule);
  const reader = new FrameReader();
  let closed = false;
  let handleRef: number | null = null;
  const inboundBeforeHandle: string[] = [];
  const diag: NovaDiagnostics = {
    framesOut: 0,
    framesIn: 0,
    writeErrors: [],
    firstFrameHex: null,
    trace: [],
    productNotified: false,
  };
  const trace = (dir: '>' | '<', bytes: Uint8Array) => {
    const hex = [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
    diag.trace.push(`${dir}${hex}`);
    if (diag.trace.length > 8) diag.trace.shift();
  };

  // VENDOR PARITY (Bluetooth.swift, read 2026-08-31): the official app
  // subscribes to the PRODUCT characteristic on every connection and its
  // backend opens the protocol only after that notification arrives -- it is
  // the device's "an app is attached" gate. Skipping it is the difference
  // between our ceremony and theirs, so we subscribe first and give the
  // notification a moment to land before the first protocol frame.
  const productSub = device.monitorCharacteristicForService(
    NOVA_SERVICE,
    NOVA_PRODUCT_CHAR,
    (err, c) => {
      if (!err && c?.value) diag.productNotified = true;
    },
  );
  const productWait = Date.now() + 8000;
  while (!diag.productNotified && Date.now() < productWait) {
    await new Promise((r) => setTimeout(r, 150));
  }

  // Outgoing frames, in order. ble-plx writes are async; the chain keeps two
  // rapid frames from racing each other onto the characteristic.
  let writeChain: Promise<unknown> = Promise.resolve();
  const outgoing = emitter.addListener('bitboxFrame', (frameB64: string) => {
    if (closed) return;
    const bytes = base64.decode(frameB64);
    if (!diag.firstFrameHex) {
      diag.firstFrameHex = [...bytes.slice(0, 16)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    trace('>', bytes);
    for (const chunk of chunkForWrite(bytes, mtu)) {
      const b64 = base64.encode(chunk);
      writeChain = writeChain
        .then(() =>
          mgr.writeCharacteristicWithResponseForDevice(deviceId, NOVA_SERVICE, NOVA_WRITE_CHAR, b64),
        )
        .then(() => {
          diag.framesOut += chunk.length / 64;
        })
        .catch((e: Error) => {
          // Surfaced, never swallowed: the first hang hid a possible write
          // failure behind an empty catch and cost a device-test cycle.
          diag.writeErrors.push(e.message || 'write failed');
        });
    }
  });

  const incoming = device.monitorCharacteristicForService(
    NOVA_SERVICE,
    NOVA_READ_CHAR,
    (err, c) => {
      if (closed || err || !c?.value) return;
      for (const frame of reader.push(base64.decode(c.value))) {
        diag.framesIn += 1;
        trace('<', frame);
        const b64 = base64.encode(frame);
        if (handleRef == null) inboundBeforeHandle.push(b64);
        else Native.feedFrame(handleRef, b64);
      }
    },
  );

  // Registration first (instant, no I/O), so the handle exists before the
  // first byte moves and every response frame can be routed the moment it
  // lands. The first on-device run proved why this order is load-bearing:
  // creation used to do the protocol-info query itself, its answer arrived
  // while the handle was still unknown, and the buffer below held back the
  // exact frame creation was blocked on. "sent 1 frame, received 1", both
  // sides waiting (decided 2026-08-31).
  const handle = await Native.createClient(storedNoiseConfig);
  handleRef = handle;
  for (const b64 of inboundBeforeHandle.splice(0)) Native.feedFrame(handle, b64);

  // NOW first contact. The JS side gives up long before Rust's generous 180s
  // read timeout, and the failure carries the counters: no frames out means
  // the pump or the emitter, write errors name the GATT failure, frames out
  // with silence back means the device is not listening to this connection.
  try {
    await Promise.race([
      Native.open(handle),
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(new Error(`The BitBox did not answer. ${describeDiag(diag)}`)),
          25000,
        ),
      ),
    ]);
  } catch (e) {
    // Tear the link down so the abandoned Rust call fails fast instead of
    // holding its read for the full 180s, and so a retry starts clean.
    closed = true;
    outgoing.remove();
    incoming.remove();
    productSub.remove();
    Native.close(handle);
    try {
      await mgr.cancelDeviceConnection(deviceId);
    } catch {
      // Already gone.
    }
    throw e;
  }

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    outgoing.remove();
    incoming.remove();
    productSub.remove();
    Native.close(handle);
    try {
      await mgr.cancelDeviceConnection(deviceId);
    } catch {
      // Already disconnected.
    }
  };

  const nativeKeys = (p: BitboxPolicy): NativePolicyKey[] =>
    p.keys.map((k) => ({
      rootFingerprintHex: k.rootFingerprintHex,
      keypath: k.keypath,
      xpub: k.xpub,
    }));

  return {
    diag,
    unlockAndPair: () => Native.unlockAndPair(handle),
    confirmPairing: () => Native.confirmPairing(handle),
    noiseConfig: () => Native.noiseConfigJson(handle),
    deviceInfo: () => Native.deviceInfo(handle),
    rootFingerprint: () => Native.rootFingerprint(handle),
    xpub: (keypath, xpubType, display) => Native.xpub(handle, keypath, xpubType, display),
    isPolicyRegistered: (testnet, p, keypathAccount) =>
      Native.isPolicyRegistered(handle, testnet, p.policy, nativeKeys(p), keypathAccount),
    registerPolicy: (testnet, p, keypathAccount) =>
      Native.registerPolicy(handle, testnet, p.policy, nativeKeys(p), keypathAccount, p.name),
    policyAddress: (testnet, p, keypath, display) =>
      Native.policyAddress(handle, testnet, p.policy, nativeKeys(p), keypath, display),
    signPsbt: (testnet, psbtB64, p, keypathAccount) =>
      // Prune taproot parents (see bitcoin/psbt/slim.ts): a many-coin
      // spend must stream in kilobytes, not the sum of its parents.
      Native.signPsbt(
        handle,
        testnet,
        slimPsbtBase64ForDevice(psbtB64).psbt,
        p ? p.policy : null,
        p ? nativeKeys(p) : [],
        keypathAccount,
      ),
    close,
  };
}

/** One line a person can read off a screenshot. */
export function describeDiag(d: NovaDiagnostics): string {
  const parts = [
    `sent ${d.framesOut} frame${d.framesOut === 1 ? '' : 's'}`,
    `received ${d.framesIn}`,
    d.productNotified ? 'ready signal seen' : 'NO ready signal from the device',
  ];
  if (d.writeErrors.length) parts.push(`write errors: ${d.writeErrors[0]}`);
  if (d.trace.length) parts.push(`wire: ${d.trace.join(' ')}`);
  return parts.join(' · ');
}
