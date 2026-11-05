/**
 * Connect Hardware: ONE Bluetooth search for every signing device Talia
 * speaks (decided 2026-08-31: "a universal connect button... search for either a
 * BitBox or a Ledger"). The client should not have to know which radio
 * protocol their device uses; they turn it on and Talia names what it finds.
 *
 * Both scanners run at once. They cannot collide: the Ledger stack scans
 * through its own BleManager inside the device-management kit, and the
 * BitBox scan uses Talia's shared manager, so neither `startDeviceScan`
 * replaces the other. iOS merges concurrent scans at the radio.
 *
 * Tapping a result hands off to that brand's proven ceremony:
 *   - Ledger → LedgerConnectFlow with the found device (it skips its own
 *     scan), the flow that has run every Gen5 ceremony since 2026-08-26.
 *   - BitBox → the pairing ceremony proven on a Nova (2026-08-31),
 *     remembered via the Keychain so the code shows only once.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme, themedStyles } from '../theme';
import { cardGlow, Gloss } from './Gloss';
import { ChevronRightIcon } from './TablerIcons';
import { LedgerConnectFlow } from './LedgerConnectFlow';
import type { CeremonyPage, LedgerTaskContext } from './LedgerConnectFlow';
import { flagLedgerScanDead, startLedgerScan } from '../../platform/ledger';
import type { FoundLedger } from '../../platform/ledger';
import { connectNova, describeDiag, scanForNova } from '../../platform/bitbox';
import type { FoundDevice, NovaSession } from '../../platform/bitbox';
import { forgetPairing, loadNoiseConfig, saveNoiseConfig } from '../../services/bitboxPairing';
import type { Network } from '../../bitcoin/descriptor';
import { MIN_NOVA_FIRMWARE, versionAtLeast } from '../../bitcoin/bitbox/product';
import { deviceName, modelInfo } from '../../wallet/deviceKinds';
import type { DeviceKind, DeviceModel } from '../../wallet/deviceKinds';
import { bitboxDevice, ledgerDevice } from '../hww/connectedDevice';
import type { ConnectedDevice } from '../hww/connectedDevice';
import { DeviceTurn } from './DeviceTurn';
import { TurnSlide } from './TurnSlide';
import { hasTurnPage } from '../hww/deviceTurns';
import { turnStep } from '../hww/deviceSteps';
import type { DeviceAsk } from '../hww/deviceTurns';
import { drawingOfModel } from '../hww/signingDevice';
import type { RegisterFacts } from '../hww/vaultRegistration';
import type { AddressFacts } from '../hww/addressCheck';
import { foundModel, splitFound } from '../hww/searchMatch';
import type { FoundView } from '../hww/searchMatch';

/** How a search problem opens, so a second radio's note can replace it. */
/** A search rebuilds the Ledger kit after a window that found nothing, this
 *  many times at most (see the rotation). */
export const LEDGER_DRY_REBUILDS = 3;

const SEARCH_TROUBLE = 'The search hit a problem and will retry: ';

export interface BitboxTaskContext {
  session: NovaSession;
  /** Lowercase 8-hex master fingerprint, read after pairing. */
  fingerprint: string;
  /** The BLE id the session was opened on. */
  deviceId: string;
  /** The name the search showed for this device (decided 2026-09-09: "I do see
   *  the device name while the bluetooth search happens"), so a caller can
   *  name what it builds after the box the owner just tapped. */
  deviceName: string;
  /** Narrate a step; with `ask`, the device's turn the step waits on (the
   *  vault to approve, 'register'; the address to compare, 'address'),
   *  drawn as a page where one exists, from the facts the device layer
   *  hands over (`register`) or the address check does (`address`). */
  setStep: (message: string, ask?: DeviceAsk, register?: RegisterFacts, address?: AddressFacts) => void;
  alive: () => boolean;
}

interface Props {
  network: Network;
  /** THE way in for new code (decided 2026-09-22: one library for every adopted
   *  device): runs against whatever device was found, through the same
   *  calls for every brand. A brand added later needs no change here. */
  deviceTask?: (device: ConnectedDevice) => Promise<void>;
  /** A brand's own ceremony, for the tasks that still need one (signing,
   *  the address check). Wins over `deviceTask` for that brand. */
  ledgerTask?: (ctx: LedgerTaskContext) => Promise<void>;
  /** Runs against a paired BitBox session. The flow closes the session
   *  after the task returns or throws. Wins over `deviceTask`. */
  bitboxTask?: (ctx: BitboxTaskContext) => Promise<void>;
  /** BLE ids of devices already spent on this vault: their rows say so
   *  (decided 2026-08-31) instead of letting the same-key gate surprise at the
   *  end. Still tappable on purpose: the same physical device unlocked
   *  with a different passphrase is a legitimately different key. */
  usedDeviceIds?: ReadonlySet<string>;
  /** What a used device's row says; defaults to holding a key already. */
  usedLabel?: string;
  /** Only these brands are searched for: the registry's answer for the
   *  step (HardwareConnect passes it), so a device that cannot do the job
   *  is never found and never auto-connected. Unset = every brand. */
  kinds?: readonly DeviceKind[];
  /**
   * The device the client said they are using, or the vault recorded for
   * the key (decided 2026-10-04, device first): drawn turning on and unlocking
   * WHILE the search runs (decided 2026-10-04: "We have to place the unlock
   * animation before this screen because otherwise, its not helpful to the
   * user", and "the same thing is happening on the ledgers"), because a
   * device is found only once it is unlocked. It steers the drawing alone:
   * the search still finds every brand in `kinds`, and a found device is
   * drawn as what it is.
   */
  expect: DeviceModel;
  onDone?: () => void;
  /** The signing ceremony's own pages (design A, decided 2026-10-03), drawn in
   *  place of either brand's step line while the signing screen's task has
   *  the transaction on its way; see LedgerConnectFlow. Signing only. */
  ceremony?: CeremonyPage;
  /** Told whenever a turn page on the drawn device opens or closes (the
   *  search's, the BitBox's after it was found, the Ledger's PIN and app),
   *  so the screen around the flow can drop its own heading while the page
   *  carries one. Fired only when a page is actually drawn. */
  onDeviceTurn?: (ask: DeviceAsk | null) => void;
}

type Found =
  | { brand: 'ledger'; ledger: FoundLedger }
  | { brand: 'bitbox'; bitbox: FoundDevice };

/** What the search matches a found device by. */
const viewOf = (f: Found): FoundView =>
  f.brand === 'ledger' ? { brand: 'ledger', id: f.ledger.id, kitModel: f.ledger.model } : { brand: 'bitbox', id: f.bitbox.id };

/** A found device's own name ("Test ledger B"), else its brand's. */
const foundName = (f: Found): string =>
  f.brand === 'ledger' ? f.ledger.name || deviceName('ledger') : f.bitbox.name || deviceName('bitbox');

/** A found device's second line: its model when the kit says it ("Nano X"), else its brand. */
const foundLabel = (f: Found): string => {
  const m = foundModel(viewOf(f));
  return m ? modelInfo(m).name : deviceName(f.brand);
};

type FlowState =
  | { kind: 'scanning'; found: Found[] }
  | { kind: 'ledger'; device: FoundLedger }
  /** `turn`: the device's turn the step waits on (its unlock before the
   *  pairing answered, the vault to approve, the address to compare), drawn
   *  as a page where one exists; `register`: the vault as the device is
   *  shown it; `address`: the address as it shows it. */
  | { kind: 'bitbox-step'; message: string; turn?: DeviceAsk; register?: RegisterFacts; address?: AddressFacts }
  | { kind: 'bitbox-code'; code: string }
  | { kind: 'error'; message: string; bitbox?: boolean };

export function HwwConnectFlow({
  network,
  deviceTask,
  ledgerTask,
  bitboxTask,
  usedDeviceIds,
  usedLabel,
  kinds,
  expect,
  onDone,
  ceremony,
  onDeviceTurn,
}: Props): React.JSX.Element {
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const onDeviceTurnRef = useRef(onDeviceTurn);
  onDeviceTurnRef.current = onDeviceTurn;
  // Only the picked device's brand is searched for at all (decided 2026-10-04:
  // "after the user selects a Bitbox, the bluetooth search also lists any
  // found ledgers! Please filter based on what the user selected and do not
  // list anything else that is found!").
  const expectRef = useRef(expect);
  expectRef.current = expect;
  const searches = (kind: DeviceKind): boolean =>
    kind === modelInfo(expectRef.current).kind && (kindsRef.current == null || kindsRef.current.includes(kind));
  const runLedgerTask = (ctx: LedgerTaskContext): Promise<void> => {
    if (ledgerTask) return ledgerTask(ctx);
    if (deviceTask) return deviceTask(ledgerDevice(ctx));
    return Promise.reject(new Error('This step cannot use this device.'));
  };
  const runBitboxTask = (ctx: BitboxTaskContext): Promise<void> => {
    if (bitboxTask) return bitboxTask(ctx);
    if (deviceTask) return deviceTask(bitboxDevice(ctx));
    return Promise.reject(new Error('This step cannot use this device.'));
  };
  const [state, setState] = useState<FlowState>({ kind: 'scanning', found: [] });
  // The device the client expects, drawn WHILE the search runs: the BitBox
  // choosing its side (it is found once its side is chosen), a Ledger its
  // PIN (found once unlocked). Then the BitBox's own turns after it was
  // found, while the phone waits in unlockAndPair. A turn with no page keeps
  // the flow's line and tells the screen nothing.
  const searchDrawing = drawingOfModel(expect);
  const searchAsk: DeviceAsk = searchDrawing === 'nova' ? 'side' : 'unlock';
  const searchPage = searchDrawing != null && hasTurnPage(searchDrawing, searchAsk);
  const searchTurnUp = state.kind === 'scanning' && searchPage;
  const bitboxTurnUp = state.kind === 'bitbox-step' && state.turn != null && hasTurnPage('nova', state.turn, state.register, state.address);
  const turnAsk: DeviceAsk | null = searchTurnUp ? searchAsk : bitboxTurnUp && state.kind === 'bitbox-step' ? (state.turn ?? null) : null;
  // The step of the device's plan the page on show belongs to (decided
  // 2026-10-05): the expected device's first while the search runs, the
  // BitBox's own once found; a new step slides its page in (`TurnSlide`),
  // and a page with no step (a line, the pairing code) holds the slide.
  const turnDrawing = searchTurnUp ? searchDrawing : bitboxTurnUp ? 'nova' : null;
  const step = turnAsk != null && turnDrawing != null ? turnStep(turnDrawing, turnAsk) : null;
  useEffect(() => {
    // Only an open page is reported here; its close is the cleanup's, so a
    // Ledger flow taking over in the same commit (its own page, reported as
    // it mounts) is never overwritten with a null (decided 2026-10-04: the screen
    // between the search and the PIN flashed).
    if (turnAsk != null) onDeviceTurnRef.current?.(turnAsk);
    return () => {
      if (turnAsk != null) onDeviceTurnRef.current?.(null);
    };
  }, [turnAsk]);
  /** A note about the LEDGER half of the search, shown under the spinner.
   *  It must never hide the BitBox results: one radio's trouble is a
   *  footnote, not a verdict. */
  const [ledgerNote, setLedgerNote] = useState<string | null>(null);
  /** Same idea for the BitBox half: after a quiet spell, say what usually
   *  wakes it instead of spinning in silence. */
  const [bitboxNote, setBitboxNote] = useState<string | null>(null);
  /** Shown under a long-running connect, because a second connect can hang
   *  on a device that went to sleep after the first ceremony. */
  const stopLedgerRef = useRef<(() => void) | null>(null);
  const stopNovaRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<NovaSession | null>(null);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const ledgerSeenRef = useRef(false);
  const bitboxSeenRef = useRef(false);

  const stopScans = useCallback(() => {
    stopLedgerRef.current?.();
    stopLedgerRef.current = null;
    stopNovaRef.current?.();
    stopNovaRef.current = null;
  }, []);

  /**
   * THE ROTATION. Ledger's device kit and our BitBox scan both ride
   * react-native-ble-plx, whose native core is a singleton: starting any
   * scan SILENTLY stops the previous one, whichever JS manager asked. Run
   * both at once and the slower-starting stack steals the radio, which is
   * why the first search deterministically missed whichever brand scanned
   * first while a restarted search found it instantly (proven on each
   * brand in turn, 2026-08-31: "it actually never finds a bitbox unless I
   * restart the search").
   *
   * So the search takes turns: a few seconds hunting the BitBox, a few
   * hunting the Ledger, repeating. Found devices stay listed across windows,
   * so to the user it is one search that keeps filling in.
   */
  const NOVA_WINDOW_MS = 4000;
  const LEDGER_WINDOW_MS = 6000;
  const rotationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  /** How many times this search rebuilt the Ledger kit after a dry window. */
  const dryRebuildsRef = useRef(0);

  const startNovaWindow = useCallback(() => {
    if (!scanningRef.current || !aliveRef.current) return;
    if (!searches('bitbox')) {
      // Not wanted for this step: the Ledger window takes the turn.
      if (searches('ledger')) startLedgerWindow();
      return;
    }
    stopLedgerRef.current?.();
    stopLedgerRef.current = null;
    stopNovaRef.current?.();
    stopNovaRef.current = scanForNova(
      (bitbox) => {
        bitboxSeenRef.current = true;
        setBitboxNote(null);
        setState((s) =>
          s.kind === 'scanning' && !s.found.some((f) => f.brand === 'bitbox' && f.bitbox.id === bitbox.id)
            ? { kind: 'scanning', found: [...s.found, { brand: 'bitbox', bitbox }] }
            : s,
        );
      },
      // One radio's trouble is a footnote, never a verdict: it used to end
      // the whole search and hide every Ledger with it.
      (message) => setBitboxNote(message),
    );
    if (rotationRef.current) clearTimeout(rotationRef.current);
    rotationRef.current = setTimeout(() => startLedgerWindow(), NOVA_WINDOW_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLedgerWindow = useCallback(() => {
    if (!scanningRef.current || !aliveRef.current) return;
    if (searches('ledger')) {
      stopNovaRef.current?.();
      stopNovaRef.current = null;
    }
    stopLedgerRef.current?.();
    stopLedgerRef.current = null;
    // Not wanted for this step: the BitBox scan keeps running through the
    // Ledger's turn, and the turn still counts toward the rotation.
    if (searches('ledger')) stopLedgerRef.current = startLedgerScan(
      (devices) => {
        if (devices.length > 0) {
          ledgerSeenRef.current = true;
          setLedgerNote(null);
        }
        setState((s) =>
          s.kind === 'scanning'
            ? {
                kind: 'scanning',
                found: [
                  ...s.found.filter((f) => f.brand !== 'ledger'),
                  ...devices.map((ledger) => ({ brand: 'ledger', ledger }) as const),
                ],
              }
            : s,
        );
      },
      (message) => {
        // Its stream is unrecoverable from here: rebuild the kit so the NEXT
        // window starts fresh, and say what happened rather than spinning.
        flagLedgerScanDead();
        // No brand named (decided 2026-09-22): the owner is looking for "your
        // hardware", whichever it is.
        setLedgerNote(`${SEARCH_TROUBLE}${message}`);
      },
    );
    if (rotationRef.current) clearTimeout(rotationRef.current);
    rotationRef.current = setTimeout(() => {
      // A Ledger window that found nothing restarts the kit for the next one
      // (decided 2026-10-04: on every fresh install the first search never found
      // the Gen5, while a later one did at once). The kit made by the first
      // search is built while iOS is still asking for Bluetooth permission,
      // and DMK discovery has been seen to stay silent on a kit after a
      // stop and re-listen (2026-08-31); a kit built afterwards scans. At most
      // LEDGER_DRY_REBUILDS a search: each build leaves a BLE state listener behind.
      if (searches('ledger') && !ledgerSeenRef.current && dryRebuildsRef.current < LEDGER_DRY_REBUILDS) {
        dryRebuildsRef.current += 1;
        flagLedgerScanDead();
      }
      // THREE full turns each with nothing found earns the wake-up hints
      // (decided 2026-08-31): a hint during the first honest attempts reads as a
      // failure the search has not actually had yet.
      cyclesRef.current += 1;
      setCyclesDone(cyclesRef.current);
      // No "Nothing found yet" note any more (decided 2026-10-05: "now there are
      // two hints which basically say the same thing. Lets keep the shorter
      // version"): the step's own hint to Reconnect says it.
      startNovaWindow();
    }, LEDGER_WINDOW_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cyclesRef = useRef(0);
  /** Full rotations completed, in STATE: the sole-device auto-connect must
   *  wait until BOTH radios had one look, or a lone BitBox found in the
   *  first four seconds would steal a ceremony meant for a Ledger still
   *  being discovered. */
  const [cyclesDone, setCyclesDone] = useState(0);

  const beginScan = useCallback(() => {
    stopScans();
    if (rotationRef.current) clearTimeout(rotationRef.current);
    scanningRef.current = true;
    ledgerSeenRef.current = false;
    bitboxSeenRef.current = false;
    cyclesRef.current = 0;
    dryRebuildsRef.current = 0;
    setCyclesDone(0);
    setLedgerNote(null);
    setBitboxNote(null);
    setState({ kind: 'scanning', found: [] });
    // BitBox first: its scan starts fast, and the Ledger window follows in
    // four seconds. Whoever is on the table is found within one rotation.
    startNovaWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopScans]);

  const haltScanning = useCallback(() => {
    scanningRef.current = false;
    if (rotationRef.current) clearTimeout(rotationRef.current);
    rotationRef.current = null;
    stopScans();
  }, [stopScans]);

  useEffect(() => {
    aliveRef.current = true;
    beginScan();
    return () => {
      aliveRef.current = false;
      if (rotationRef.current) clearTimeout(rotationRef.current);
      scanningRef.current = false;
      stopScans();
      void sessionRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // As little tapping as possible (decided 2026-08-26, and 2026-10-04: "please
  // automatically select the unused ledger that is seen"): the search lists
  // the device the client picked and nothing else (the kit reports a Ledger's
  // model, a BitBox is a Nova; another brand is not even searched for), and
  // after a full rotation the ONE match not already spent on this vault
  // connects by itself, spent ones in sight or not. A client holding another
  // device goes back with "Choose another device".
  const split = splitFound(state.kind === 'scanning' ? state.found : [], viewOf, expect, usedDeviceIds);
  const sole = cyclesDone >= 1 && state.kind === 'scanning' ? split.auto : null;
  const soleId = sole == null ? null : sole.brand === 'ledger' ? sole.ledger.id : sole.bitbox.id;
  useEffect(() => {
    if (sole == null || soleId == null) return;
    if (usedDeviceIds?.has(soleId)) return;
    const t = setTimeout(() => {
      if (!aliveRef.current || busyRef.current) return;
      if (sole.brand === 'ledger') {
        haltScanning();
        setState({ kind: 'ledger', device: sole.ledger });
      } else {
        void runBitbox(sole.bitbox);
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleId, cyclesDone >= 1]);

  /** Connect a found device (a row's tap, or "Use it anyway"). */
  const take = (f: Found) => {
    if (f.brand === 'ledger') {
      haltScanning();
      setState({ kind: 'ledger', device: f.ledger });
    } else {
      void runBitbox(f.bitbox);
    }
  };

  /** The BitBox the last run connected to: a ceremony's Try again goes back to it. */
  const lastBitboxRef = useRef<FoundDevice | null>(null);

  const runBitbox = async (d: FoundDevice) => {
    if (busyRef.current) return;
    busyRef.current = true;
    lastBitboxRef.current = d;
    haltScanning();
    setState({ kind: 'bitbox-step', message: 'Connecting…', turn: 'unlock' });
    // A slow connection gets ONE sentence, the page's own hint over Reconnect
    // (HardwareConnect, reconnectHint; decided 2026-10-15: two sentences said the
    // same thing on every BitBox wait).
    try {
      const stored = await loadNoiseConfig();
      if (!aliveRef.current) return;
      const session = await connectNova(d.id, stored);
      if (!aliveRef.current) {
        // Backed out while connecting: the unmount cleanup ran before there
        // was a session to close, and a session left open keeps the BitBox
        // from advertising, so no later search could find it (decided
        // 2026-09-22).
        void session.close();
        return;
      }
      sessionRef.current = session;
      setState({
        kind: 'bitbox-step',
        message:
          'If the BitBox asks for its password, enter it on the device. Already unlocked? Then this takes just a moment.',
        turn: 'unlock',
      });
      const code = await session.unlockAndPair();
      if (!aliveRef.current) return;
      if (code) setState({ kind: 'bitbox-code', code });
      await session.confirmPairing();
      if (!aliveRef.current) return;
      await saveNoiseConfig(await session.noiseConfig());
      // The firmware gate every BitBox passes, whichever screen found it: a
      // Nova below MIN_NOVA_FIRMWARE cannot hold Talia's taproot keys. It
      // used to live on the BitBox setup screen alone.
      // An unreadable answer passes, as before this gate existed here: the
      // device itself refuses what its firmware cannot do.
      const info = await session.deviceInfo().catch(() => null);
      if (info && !versionAtLeast(info.version, MIN_NOVA_FIRMWARE)) {
        throw new Error(
          `This device runs firmware ${info.version}. Talia vaults need ${MIN_NOVA_FIRMWARE} or newer. Update it in the BitBoxApp and try again.`,
        );
      }
      const fingerprint = (await session.rootFingerprint()).toLowerCase();
      if (!aliveRef.current) return;
      await runBitboxTask({
        session,
        fingerprint,
        deviceId: d.id,
        // The name the OWNER set on the device, which is what every other
        // BitBox call site prefers and what a key's name is templated from
        // (decided 2026-09-26); the Bluetooth advertised name is the fallback.
        deviceName: info?.name || d.name,
        setStep: (message, ask, register, address) => {
          if (aliveRef.current) setState({ kind: 'bitbox-step', message, turn: ask, register, address });
        },
        alive: () => aliveRef.current,
      });
      await session.close();
      sessionRef.current = null;
      if (aliveRef.current) onDone?.();
    } catch (e) {
      const diag = sessionRef.current?.diag;
      await sessionRef.current?.close();
      sessionRef.current = null;
      busyRef.current = false;
      if (!aliveRef.current) return;
      const base = (e as Error).message || 'The BitBox ceremony failed.';
      setState({
        kind: 'error',
        message: diag ? `${base}\n${describeDiag(diag)}` : base,
        bitbox: true,
      });
      return;
    }
    busyRef.current = false;
  };

  if (state.kind === 'ledger') {
    return (
      <LedgerConnectFlow
        network={network}
        task={runLedgerTask}
        onDone={onDone}
        initialDevice={state.device}
        // Try again returns to the search for EVERY device, never a
        // Ledger-only one.
        onRetry={beginScan}
        ceremony={ceremony}
        onDeviceTurn={onDeviceTurn}
      />
    );
  }

  // A BitBox signing on its way draws the ceremony's pages, its failures
  // included; Try again connects to the same BitBox. The first pairing leaves
  // the state on its code screen, so the ceremony takes over from there too
  // (decided 2026-10-04: it showed the code, no pages and no Back to the end).
  if (
    ceremony &&
    (state.kind === 'bitbox-step' || state.kind === 'bitbox-code' || (state.kind === 'error' && state.bitbox))
  ) {
    const retrySame = () => {
      const d = lastBitboxRef.current;
      if (d) void runBitbox(d);
      else beginScan();
    };
    return (
      <View style={styles.wrap}>{ceremony({ failure: state.kind === 'error' ? state.message : null, retry: retrySame })}</View>
    );
  }

  // The BitBox from the moment it is taken from the search until it has
  // unlocked and paired: its password as the client's turn page (every
  // screen, decided 2026-10-04), with the slow note under it; the first pairing's
  // code screen follows as before; then the vault shown for its approval.
  // A step whose turn has no page keeps its line.
  if (bitboxTurnUp && state.kind === 'bitbox-step' && state.turn != null) {
    return (
      <TurnSlide step={step} ask={turnAsk} style={styles.wrap}>
        <DeviceTurn drawing="nova" ask={state.turn} network={network} register={state.register} address={state.address} />
      </TurnSlide>
    );
  }

  return (
    <TurnSlide step={step} ask={turnAsk} style={styles.wrap}>
      {state.kind === 'scanning' && searchPage && searchDrawing != null && (
        <>
          {/* The device the client expects, unlocking: it is found only once
              it is unlocked (decided 2026-10-04). */}
          {/* No search line under it (decided 2026-10-04: "Either keep it showing
              or dont show it at all but switching between the two is
              irritating"): the page is the same whether the phone is still
              looking or already connecting, so nothing flips. */}
          <DeviceTurn drawing={searchDrawing} ask={searchAsk} network={network} />
        </>
      )}
      {state.kind === 'scanning' && (
        <>
          {!searchPage && (
            <View style={styles.stepRow}>
              <ActivityIndicator color={theme.colors.gold} />
              <Text style={styles.stepText}>
                Looking for your hardware… Turn it on, unlock it, and keep it near
                the phone.
              </Text>
            </View>
          )}
          {/* Both radios report a Bluetooth that is off or missing: say it
              once, in the phone's own words. */}
          {ledgerNote && !(bitboxNote && ledgerNote.startsWith(SEARCH_TROUBLE)) && (
            <Text style={styles.noteText}>{ledgerNote}</Text>
          )}
          {bitboxNote && <Text style={styles.noteText}>{bitboxNote}</Text>}
          {/* No "Restart the search": the step's Reconnect starts the search
              and the connection afresh (decided 2026-10-05). */}
          {/* One match, already spent on this vault: said, not listed. */}
          {split.spentOnly != null && (
            <>
              <Text style={styles.noteText}>
                {`${foundName(split.spentOnly)} already holds a key of this vault. Turn on the other one.`}
              </Text>
              <TouchableOpacity style={styles.retry} onPress={() => take(split.spentOnly!)}>
                <Text style={styles.retryText}>Use it anyway</Text>
              </TouchableOpacity>
            </>
          )}
          {split.listed.map((f) => {
            const id = f.brand === 'ledger' ? f.ledger.id : f.bitbox.id;
            const name = f.brand === 'ledger' ? f.ledger.name || deviceName('ledger') : f.bitbox.name;
            const used = usedDeviceIds?.has(id) === true;
            return (
              <TouchableOpacity
                key={`${f.brand}:${id}`}
                style={styles.deviceRow}
                onPress={() => take(f)}>
                <Gloss radius={theme.radius.md} strength={cardGlow()} />
                <View style={styles.deviceBody}>
                  {/* Spent on this vault already: said in colour, never by dimming the row. */}
                  <Text style={[styles.deviceName, used && styles.deviceNameUsed]}>{name}</Text>
                  <Text style={styles.deviceSub}>
                    {used ? (usedLabel ?? 'Already holds a key of this vault') : foundLabel(f)}
                  </Text>
                </View>
                <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {state.kind === 'bitbox-step' && (
        <>
          <View style={styles.stepRow}>
            <ActivityIndicator color={theme.colors.gold} />
            <Text style={styles.stepText}>{state.message}</Text>
          </View>
        </>
      )}

      {state.kind === 'bitbox-code' && (
        <>
          <Text style={styles.stepText}>
            Check this code on your device, then confirm there. Talia remembers
            the pairing, so it appears only once.
          </Text>
          <Text style={styles.code}>{state.code}</Text>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <Text style={styles.errorText}>{state.message}</Text>
          <TouchableOpacity style={styles.retry} onPress={beginScan}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
          {state.bitbox && (
            <TouchableOpacity
              style={styles.retry}
              onPress={() => {
                // The escape hatch for a remembered pairing gone wrong: drop
                // it and take the fresh-pairing path, which shows the code
                // once and rebuilds the memory. Costs one code comparison,
                // recovers everything.
                void forgetPairing().then(beginScan);
              }}>
              <Text style={styles.retryText}>
                Forget the BitBox pairing and pair again
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </TurnSlide>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    stepRow: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' },
    stepText: { ...theme.typography.body, color: theme.colors.slate, flex: 1 },
    deviceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    deviceBody: { flex: 1, gap: 2 },
    deviceName: { ...theme.typography.heading, color: theme.colors.offWhite },
    deviceNameUsed: { color: theme.colors.faint },
    deviceSub: { ...theme.typography.caption, color: theme.colors.faint },
    code: {
      fontFamily: 'Menlo',
      fontSize: 22,
      lineHeight: 30,
      color: theme.colors.gold,
      textAlign: 'center',
    },
    errorText: { ...theme.typography.body, color: theme.colors.negative },
    noteText: { ...theme.typography.caption, color: theme.colors.gold },
    retry: { alignSelf: 'flex-start' },
    retryText: { ...theme.typography.body, color: theme.colors.accentText },
  }),
);
