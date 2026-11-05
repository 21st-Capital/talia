/**
 * The embeddable Ledger-over-Bluetooth ceremony (decided 2026-08-26):
 * pair → open the right Bitcoin app (version-gated) → read the device's key
 * ID → run ONE task against the live session, narrating every step the
 * Ledger asks for. Reached only from the universal search (`HwwConnectFlow`),
 * which hands it the device it found; it has no scan of its own (decided
 * 2026-09-22: one search for every adopted device).
 *
 * The device's turns before the task, its PIN and the app to open, are
 * drawn here as the client's turn on the device the kit found (`DeviceTurn`,
 * every screen, decided 2026-10-04), and so is the vault shown for its approval,
 * from the facts the device layer hands the step (`RegisterFacts`, the
 * videos of 2026-10-04); a prompt with no page keeps its line. Each page is
 * a numbered step of the device's plan, and a new step slides its page in
 * (`TurnSlide`, decided 2026-10-05); a line between two steps holds the slide.
 *
 * Session lifetime is component lifetime: unmounting drops the connection.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme, themedStyles } from '../theme';
import { DeviceTurn } from './DeviceTurn';
import { TurnSlide } from './TurnSlide';
import { InfoDot } from './InfoDot';
import { infoDotTop, lineHeightOf } from './infoRowStyle';
import { hasTurnPage } from '../hww/deviceTurns';
import { turnStep } from '../hww/deviceSteps';
import type { DeviceAsk } from '../hww/deviceTurns';
import { drawingFor } from '../hww/signingDevice';
import type { RegisterFacts } from '../hww/vaultRegistration';
import type { AddressFacts } from '../hww/addressCheck';
import type { Network } from '../../bitcoin/descriptor/types';
import {
  connectLedger,
  disconnectLedger,
  openBitcoinAppReady,
  getLedgerMasterFingerprint,
  type FoundLedger,
  type LedgerPrompt,
  type LedgerSessionId,
} from '../../platform/ledger';

const PROMPT_TEXT: Record<Exclude<LedgerPrompt, null>, string> = {
  unlock: 'Enter the PIN on the Ledger.',
  'open-app': 'Approve opening the app on the Ledger.',
  'confirm-register': 'Check each key on the Ledger’s screen and approve it there.',
  'confirm-sign': 'Check the amount and address on the Ledger’s screen and approve there.',
  'verify-address': 'Compare the address on the Ledger’s screen.',
};

export interface LedgerTaskContext {
  sessionId: LedgerSessionId;
  /** The device this session talks to (name, Gen5 flag). */
  device: FoundLedger;
  /** The connected device's key ID (master fingerprint), lowercase hex. */
  deviceFingerprint: string;
  appVersion: string;
  /** Narrate a step of the task on the flow's status line; with `ask`, the
   *  device's turn the step waits on, drawn as a page where one exists, and
   *  for the vault's approval the facts its pages are made from (`register`),
   *  for the address check the address's (`address`). */
  setStep: (text: string, ask?: DeviceAsk, register?: RegisterFacts, address?: AddressFacts) => void;
  /** Pass as onPrompt to platform calls — maps device asks to sentences. */
  onPrompt: (prompt: LedgerPrompt) => void;
  /** False once the flow unmounted (user backed out) — a task must check
   *  this before committing results, or an approval given on the device
   *  AFTER the user left would mutate an abandoned ceremony. */
  alive: () => boolean;
}

interface Props {
  network: Network;
  /** Runs once connected, app open + version-checked, key read. Throw a
   *  plain-language Error to land in the retryable error state. */
  task: (ctx: LedgerTaskContext) => Promise<void>;
  /** The task finished without throwing. */
  onDone?: () => void;
  /** The device the universal search found: the ceremony connects to it. */
  initialDevice: FoundLedger;
  /** Where Try again goes: back to the search for every device, never a
   *  Ledger-only scan (decided 2026-09-22). */
  onRetry: () => void;
  /**
   * The signing ceremony's own pages (design A "The courier", decided
   * 2026-10-03). Set only while the signing screen's task has the
   * transaction on its way: the flow then draws them in place of its step
   * line, and a failure lands on their Not signed page with the flow's own
   * sentence and a Try again that connects to the same device. Registration
   * and the address check never pass it, so they keep the flow's own lines.
   */
  ceremony?: CeremonyPage;
  /** Told whenever a turn page opens or closes (the PIN, the app to open,
   *  drawn on the device the kit found), so the screen around the flow can
   *  drop its own heading while the page carries one. Fired only when a
   *  page is actually drawn. */
  onDeviceTurn?: (ask: DeviceAsk | null) => void;
}

/** What a ceremony page gets from the flow around it. */
export type CeremonyPage = (flow: { failure: string | null; retry: () => void }) => React.ReactNode;

type FlowState =
  | { kind: 'connecting'; device: FoundLedger }
  /** `ask`: the device's turn drawn as a page, or null for a line; for the
   *  vault's approval, the facts its pages are made from; for the address
   *  check, the address's. */
  | { kind: 'working'; step: string; ask: DeviceAsk | null; register?: RegisterFacts; address?: AddressFacts }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/** The asks that reach the flow as the device's turn: the PIN, the app to
 *  open, the vault shown for approval ('register', drawn from the facts the
 *  device layer handed the step) and the address shown for comparison
 *  ('address', from the facts the address check handed it); every other
 *  prompt is a line. */
const askOf = (p: LedgerPrompt): DeviceAsk | null =>
  p === 'unlock' || p === 'open-app' ? p : p === 'confirm-register' ? 'register' : p === 'verify-address' ? 'address' : null;

/** The flow's own step while it opens the Bitcoin app: brief, between the
 *  connection and the device's own prompt. */
const OPENING_APP = 'Opening the app on the Ledger\u2026';
/** How long a connection runs before its pairing line shows: an iPhone that
 *  already paired with the device connects well under it; a first pairing,
 *  whose code the client must compare, takes longer. */
export const PAIRING_LINE_AFTER_MS = 1500;

export function LedgerConnectFlow({ network, task, onDone, initialDevice, onRetry, ceremony, onDeviceTurn }: Props): React.JSX.Element {
  const [state, setState] = useState<FlowState>({ kind: 'connecting', device: initialDevice });
  const onDeviceTurnRef = useRef(onDeviceTurn);
  onDeviceTurnRef.current = onDeviceTurn;
  /** The device the last run connected to: a ceremony's Try again goes back to it. */
  const deviceRef = useRef<FoundLedger | null>(null);
  /** The vault as the device is shown it, from the device layer's step: the
   *  kit's own 'confirm-register' prompt, which follows, draws the same. */
  const registerRef = useRef<RegisterFacts | null>(null);
  /** The address as the device shows it, from the check's step: the kit's
   *  own 'verify-address' prompt, which follows, draws the same. */
  const addressRef = useRef<AddressFacts | null>(null);
  const sessionRef = useRef<LedgerSessionId | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  /** The page carried from the search into the connection (the device's
   *  unlock, found 2026-10-04: "during the pin entry, this screen quickly shows
   *  up and after half a second disappears again"): drawn while it connects
   *  and while the app opens, until the device asks for something else. */
  const carriedRef = useRef<DeviceAsk | null>(null);
  /** The connection has run past PAIRING_LINE_AFTER_MS: the pairing line shows. */
  const [pairingSlow, setPairingSlow] = useState(false);

  useEffect(() => {
    aliveRef.current = true;
    // The search found it; connecting is the next step.
    void run(initialDevice);
    return () => {
      aliveRef.current = false;
      if (sessionRef.current != null) void disconnectLedger(sessionRef.current);
      // A turn still open as the flow goes (a retry back to the search) is closed.
      onDeviceTurnRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(
    async (device: FoundLedger) => {
      if (busyRef.current) return;
      busyRef.current = true;
      deviceRef.current = device;
      registerRef.current = null;
      addressRef.current = null;
      // A turn is a page only where the drawing has one for it (the slab's
      // words count); the screen is told only then. The vault's facts arrive
      // with the device layer's step and serve the kit's own prompt after it;
      // the address's with the check's step, the same way.
      const drawing = drawingFor('ledger', device.model);
      const setStep = (text: string, ask: DeviceAsk | null = null, register?: RegisterFacts, address?: AddressFacts) => {
        if (!aliveRef.current) return;
        if (register) registerRef.current = register;
        if (address) addressRef.current = address;
        const facts = ask === 'register' ? registerRef.current : null;
        const shown = ask === 'address' ? addressRef.current : null;
        let page = ask != null && hasTurnPage(drawing, ask, facts, shown) ? ask : null;
        // The app opening is a step of the flow's, not a page of the device's:
        // the page carried from the search stays until the device asks.
        if (page == null && ask == null && text === OPENING_APP && carriedRef.current != null) page = carriedRef.current;
        else carriedRef.current = null;
        setState({ kind: 'working', step: text, ask: page, register: facts ?? undefined, address: shown ?? undefined });
        onDeviceTurnRef.current?.(page);
      };
      const leave = (next: FlowState) => {
        setState(next);
        onDeviceTurnRef.current?.(null);
      };
      try {
        // A retry after an error still owns the previous session — release
        // it first so the flow never holds two.
        if (sessionRef.current != null) {
          const stale = sessionRef.current;
          sessionRef.current = null;
          await disconnectLedger(stale);
        }
        setState({ kind: 'connecting', device });
        // The device's unlock, drawn by the search, stays drawn while it
        // connects; the pairing line joins it only if the connection is slow.
        carriedRef.current = hasTurnPage(drawing, 'unlock', null) ? 'unlock' : null;
        if (carriedRef.current != null) onDeviceTurnRef.current?.(carriedRef.current);
        setPairingSlow(false);
        const slowTimer = setTimeout(() => {
          if (aliveRef.current) setPairingSlow(true);
        }, PAIRING_LINE_AFTER_MS);
        const sessionId = await connectLedger(device).finally(() => clearTimeout(slowTimer));
        if (!aliveRef.current) {
          // Backed out during pairing: the cleanup already ran with no
          // session to release — release it here or it leaks until restart.
          void disconnectLedger(sessionId);
          return;
        }
        sessionRef.current = sessionId;
        const onPrompt = (p: LedgerPrompt) => {
          if (p != null) setStep(PROMPT_TEXT[p], askOf(p));
        };
        setStep(OPENING_APP);
        // The PIN can drop the Bluetooth link; the wrapper reconnects once
        // and may hand back a DIFFERENT session — adopt it.
        const ready = await openBitcoinAppReady(device, sessionId, network, onPrompt, () =>
          setStep('Connecting to the Ledger again…'),
        );
        sessionRef.current = ready.sessionId;
        const appVersion = ready.appVersion;
        if (!aliveRef.current) {
          // Backed out during the reconnect: the unmount cleanup ran on the
          // old session — release the fresh one or it leaks until restart.
          void disconnectLedger(ready.sessionId);
          return;
        }
        setStep('Reading which key this Ledger holds…');
        const deviceFingerprint = await getLedgerMasterFingerprint(ready.sessionId);
        if (!aliveRef.current) return;
        await task({
          sessionId: ready.sessionId,
          device,
          deviceFingerprint,
          appVersion,
          setStep,
          onPrompt,
          alive: () => aliveRef.current,
        });
        if (aliveRef.current) {
          leave({ kind: 'done' });
          onDone?.();
        }
      } catch (e) {
        if (aliveRef.current) leave({ kind: 'error', message: (e as Error).message });
      } finally {
        busyRef.current = false;
      }
    },
    [network, onDone, task],
  );

  // A signing ceremony on its way draws its own pages, its failures included
  // (and keeps them should the device lock again mid-way: the kit's 'unlock'
  // then is no turn of its own, the ceremony's pages stay).
  if (ceremony && (state.kind === 'working' || state.kind === 'done' || state.kind === 'error')) {
    const retrySame = () => {
      const d = deviceRef.current;
      if (d) void run(d);
      else onRetry();
    };
    return (
      <View style={styles.box}>{ceremony({ failure: state.kind === 'error' ? state.message : null, retry: retrySame })}</View>
    );
  }

  // The step of the device's plan the page on show belongs to (decided
  // 2026-10-05), with the ask that tells the job's pages apart: a new page
  // slides in (`TurnSlide`), and the unlock page the search drew counts as
  // step 1 of the same plan while the device connects, so the carried page
  // never slides. A page with no step (a line) is null: the slide holds.
  const connectingDrawing = state.kind === 'connecting' ? drawingFor('ledger', state.device.model) : null;
  const carriedUnlock = connectingDrawing != null && hasTurnPage(connectingDrawing, 'unlock', null);
  const turnAsk: DeviceAsk | null = state.kind === 'working' && deviceRef.current != null ? state.ask : carriedUnlock ? 'unlock' : null;
  const step =
    state.kind === 'working' && state.ask != null && deviceRef.current != null
      ? turnStep(drawingFor('ledger', deviceRef.current.model), state.ask)
      : connectingDrawing != null && carriedUnlock
        ? turnStep(connectingDrawing, 'unlock')
        : null;

  // The device asking for its PIN or the app to open, before the task, or
  // showing the vault for its approval or the address for comparison: the
  // client's turn, drawn on the device the kit found (every screen, decided
  // 2026-10-04).
  if (state.kind === 'working' && state.ask != null && deviceRef.current != null) {
    return (
      <TurnSlide step={step} ask={turnAsk} style={styles.box}>
        <DeviceTurn drawing={drawingFor('ledger', deviceRef.current.model)} ask={state.ask} network={network} register={state.register} address={state.address} />
      </TurnSlide>
    );
  }

  // Connecting to the device whose unlock the search drew: the same page
  // stays (no flash of a pairing line for a device already paired), the
  // pairing line joining it only once the connection runs slow.
  if (state.kind === 'connecting' && connectingDrawing != null && hasTurnPage(connectingDrawing, 'unlock', null)) {
    return (
      <TurnSlide step={step} ask={turnAsk} style={styles.box}>
        <DeviceTurn drawing={connectingDrawing} ask="unlock" network={network} />
        {pairingSlow && (
          <View style={styles.spinnerRow}>
            <ActivityIndicator color={theme.colors.gold} />
            <Text style={styles.stepText}>
              Pairing with {state.device.name}. Your Ledger shows a pairing code and iPhone
              asks you to confirm it. Check that the two match, then confirm.
            </Text>
          </View>
        )}
      </TurnSlide>
    );
  }

  return (
    <TurnSlide step={step} ask={turnAsk} style={styles.box}>
      {state.kind === 'connecting' && (
        <View style={styles.spinnerRow}>
          <ActivityIndicator color={theme.colors.gold} />
          <Text style={styles.stepText}>
            Pairing with {state.device.name}. Your Ledger shows a pairing code and iPhone
            asks you to confirm it. Check that the two match, then confirm.
          </Text>
          {/* Level with the FIRST line of the text, like every other dot. */}
          <View style={styles.dotLine}>
            <InfoDot
              title="Where the code appears"
              text={
                'On the first pairing your Ledger displays a code and iPhone shows the same code in its own Bluetooth request. You compare them and confirm there.\n\nTalia never sees that code. Bluetooth pairing is handled by iPhone itself, which is what stops another app from standing in the middle of it, so the code cannot be shown here.'
              }
            />
          </View>
        </View>
      )}

      {state.kind === 'working' && (
        <>
          <View style={styles.spinnerRow}>
            <ActivityIndicator color={theme.colors.gold} />
            <Text style={styles.stepText}>{state.step}</Text>
          </View>
        </>
      )}

      {state.kind === 'done' && (
        <Text style={styles.stepText}>Done.</Text>
      )}

      {state.kind === 'error' && (
        <>
          <Text style={styles.errorText}>{state.message}</Text>
          {/* A link under the line it answers, as the search's own Try again
              (the page's buttons live in its footer, decided 2026-10-05). */}
          <TouchableOpacity style={styles.retry} onPress={onRetry}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </>
      )}
    </TurnSlide>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    box: { gap: theme.spacing.md },
    spinnerRow: {
      flexDirection: 'row',
      // The spinner and the ⓘ sit on the FIRST line of the text, not centred
      // against a paragraph (the pairing step runs to three lines).
      alignItems: 'flex-start',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
    },
    stepText: { ...theme.typography.body, flex: 1, color: theme.colors.offWhite },
    dotLine: { marginTop: infoDotTop(lineHeightOf(theme.typography.body)) },
    // One colour for the flows' error line: the search's `negative`.
    errorText: { ...theme.typography.body, color: theme.colors.negative },
    retry: { alignSelf: 'flex-start' },
    retryText: { ...theme.typography.body, color: theme.colors.accentText },
  }),
);
