/**
 * Connect your hardware: the ONE start of every hardware connection, device
 * first (decided 2026-10-04: "we simply ASK him which device he will be using for
 * each key. That will also replace the 'method' on how we connect because we
 * know which device connects how"; replacing the method-first rule of
 * 2026-09-22).
 *
 * Step 1: the device. What the vault knows for the keys this step can meet
 * decides (`keyStep`, decided 2026-10-04: "the bare list of all supported devices
 * should only be used if: 1. A vault has been imported and we dont know
 * which hardware is being used and the user wants to register the keys. 2.
 * we are building a brand new vault and we need to know which device the
 * user wants to use. 3. The user wants to replace a key with a new signing
 * device which we dont know about. Other than the above scenarios, the
 * Hardware and its associated key is KNOWN and we should list them instead
 * of guessing or asking"): one known device connects straight; a vault that
 * knows its keys' devices lists ITS OWN KEYS, each with its device
 * (`KeyDevicePicker`), and a key whose device was never recorded asks once
 * from its row; only a new box (no keys: building, replacing, importing) or
 * a vault nothing was ever recorded for asks "Which device?" among the
 * models the registry offers for this shape, purpose and vault
 * (`modelsFor`), as a list of brands and then a brand's models
 * (`DevicePicker`).
 * Step 2 follows from the device: a Bluetooth model mounts the universal
 * search (`HwwConnectFlow`), told which device to draw turning on and
 * unlocking while it looks (`expect`), which looks for that device alone
 * (`searchMatch.ts`); the Passport goes to the caller's scanner; "Another
 * device" to the caller's own ways in. The step's ONE Back (decided 2026-10-05,
 * replacing "Choose another device") returns to the list the step started
 * from (a question, or the vault's keys), and a straight connection from the
 * vault's own records offers no list: the vault knows. The search looks for
 * that device ALONE, so a record that went stale (the seed moved to another
 * box) would draw the old device unlocking for ever; wherever the step
 * followed a record (a straight connection, a key row) it offers no way back
 * to a list; every search offers Reconnect (decided 2026-10-05). The pick steers
 * the drawing and the search alone: only a device that proved a key is
 * recorded.
 *
 * The step draws NO button of its own (decided 2026-10-05: "move all the buttons
 * to the bottom of the page", and a screenshot of the address check with
 * Back and Cancel stacked mid-page): it decides where its Back goes and hands
 * it to the page through `onFooterBack`, and the page's ONE pinned footer (or
 * a sheet's foot) draws it, as "Back" while there is a step inside the screen
 * to return to and otherwise the screen's own "Cancel", never both for one
 * move. What stays in the content is what belongs to the drawing: the
 * Reconnect link and the hint over it.
 *
 * This is the only place `HwwConnectFlow` is mounted, so every screen gets
 * the same question, the same search and the same turn pages.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { DevicePicker } from './DevicePicker';
import { KeyDevicePicker } from './KeyDevicePicker';
import { reconnectHint } from './devicePickerModel';
import { HwwConnectFlow } from './HwwConnectFlow';
import { flagLedgerScanDead } from '../../platform/ledger';
import type { BitboxTaskContext } from './HwwConnectFlow';
import type { CeremonyPage, LedgerTaskContext } from './LedgerConnectFlow';
import type { ConnectedDevice } from '../hww/connectedDevice';
import type { DeviceAsk } from '../hww/deviceTurns';
import type { Network } from '../../bitcoin/descriptor';
import { HWW_ENABLED, SIGNING_ENABLED } from '../../config';
import { deviceKindInfo, keyStep, kindsOf, modelInfo, modelsFor } from '../../wallet/deviceKinds';
import type { DeviceModel, HardwarePurpose, KeyRow, KeyStep, StepKey, VaultShape } from '../../wallet/deviceKinds';

/** What the step is on: a device picked or recorded, the caller's own ways
 *  in, or the question. */
export type HardwarePick = DeviceModel | 'another' | null;

export interface HardwareConnectProps {
  shape: VaultShape;
  purpose: HardwarePurpose;
  network: Network;
  /** The vault's descriptor, which decides which devices suit it; leave it
   *  out for a vault that does not exist yet (building, importing). */
  descriptor?: string | null;
  /** The vault's own keys this step can meet, each with what the vault
   *  recorded for it (`stepKeysOf`): the step connects straight, lists them
   *  with their devices, or asks. Empty = a new box (building, replacing,
   *  importing, a backup to unlock): the bare list of every suited device.
   *  Never one of 21st Capital's keys. */
  keys: readonly StepKey[];
  /** A pick already made (the import's list, a row that named the device):
   *  connect to it straight. */
  model?: DeviceModel | null;
  /** The question over the list, and a line under it; no question where
   *  the screen asks it itself. */
  question?: string;
  intro?: string;
  /** Bluetooth: runs against whatever adopted device was found. */
  deviceTask?: (device: ConnectedDevice) => Promise<void>;
  /** Bluetooth: a brand's own ceremony where the step still needs one. */
  ledgerTask?: (ctx: LedgerTaskContext) => Promise<void>;
  bitboxTask?: (ctx: BitboxTaskContext) => Promise<void>;
  usedDeviceIds?: ReadonlySet<string>;
  usedLabel?: string;
  onDone?: () => void;
  /** The Passport's way in: the caller's scanner page. Without it the
   *  Passport is not listed. The page's Back to the list is the step's,
   *  handed to the footer like every other. */
  renderQr?: () => React.ReactNode;
  /** Hardware Talia cannot reach itself (an heir's own device, a wallet
   *  never adopted, the App Store build): the caller's own rows, behind an
   *  "Another device" row on the bare list. Without it the row is not
   *  offered; a known vault's key list never offers it. `back` is null when
   *  the rows are the whole step (no row to offer, so no question to return
   *  to): the caller then heads them itself. The rows draw no Back of their
   *  own: the step hands the footer its Back to the list they sat behind. */
  another?: (back: (() => void) | null) => React.ReactNode;
  /** The signing ceremony's pages (signing only), see LedgerConnectFlow. */
  ceremony?: CeremonyPage;
  /** Told whenever a turn page on the drawn device opens or closes, so the
   *  screen around this can drop its own heading while the page carries
   *  one; fired only when a page is actually drawn. */
  onTurn?: (ask: DeviceAsk | null) => void;
  /** The device is at work (a transaction on its way): no way back to the
   *  question until it answers. */
  locked?: boolean;
  /** Told what the step is on: where it starts (the device recorded or
   *  preset, or null for a list), then as it changes. */
  onPick?: (pick: HardwarePick) => void;
  /** The caller's own step back (the key list, the summary): with it, the
   *  step draws the screen's ONE Back (decided 2026-10-05: "remove the 'choose
   *  another hardware' and replace it with a back button instead"), which
   *  returns to the device list first when there is one, and to this
   *  otherwise; the caller then draws no Back of its own under the step. */
  onBack?: () => void;
  /** The page's pinned footer (or a sheet's foot) takes that ONE Back (decided
   *  2026-10-05: "move all the buttons to the bottom of the page"): told it
   *  whenever it comes or goes (none while the device is at work, none on a
   *  list with no step before it, none where the caller's rows are the
   *  whole step). Where it goes stays the step's: off the search, the
   *  scanner's page or the caller's rows to the device list when there is
   *  one, off a key's device question to the key list, else `onBack`. The
   *  page draws it as "Back", and its own "Cancel" only while there is
   *  none. Required: the step draws no button of its own, so a page without
   *  this would have no way back. */
  onFooterBack: (back: StepBack | null) => void;
}

/** The step's Back as a page's footer draws it: one press that always goes
 *  where the step's Back goes NOW, so the footer is told only when the Back
 *  comes or goes, never on every move inside the step. */
export interface StepBack {
  onPress: () => void;
}

export function HardwareConnect(props: HardwareConnectProps): React.JSX.Element {
  const { shape, purpose, network, descriptor, keys, model, question, intro, renderQr, another, ceremony, onTurn, locked, onPick, onBack, onFooterBack } = props;
  const hasBluetooth = props.deviceTask != null || props.ledgerTask != null || props.bitboxTask != null;
  // The models this step can serve: Bluetooth ones only with a task and the
  // hardware surface (the App Store build has none), the Passport only with
  // a scanner to show its code to.
  const suited = useMemo(
    () =>
      modelsFor(shape, purpose, { descriptor, hardwareSurface: hasBluetooth && (SIGNING_ENABLED || HWW_ENABLED) }).filter((m) =>
        deviceKindInfo(modelInfo(m).kind)?.methods.includes('qr') ? renderQr != null : true,
      ),
    [shape, purpose, descriptor, hasBluetooth, renderQr],
  );
  const step = useMemo(() => keyStep(keys, suited), [keys, suited]);
  const [pick, setPickState] = useState<HardwarePick>(model ?? (step.kind === 'connect' ? step.model : null));
  /** Each Reconnect starts the search and the connection afresh (decided
   *  2026-10-05: "there is still sometimes an issue to connect to the ledger
   *  X, which works immediately once the user goes back to the list of keys
   *  and comes back here again. Please replace the link 'replace signing
   *  device' with something like 'reconnect'"): the flow is mounted anew
   *  under a new key, so its sessions and scans are released as on Back, and
   *  the Ledger kit is rebuilt, the restart DMK discovery is known to need. */
  const [attempt, setAttempt] = useState(0);
  /** The turn page the flow draws now (the device unlocking, its app, its
   *  review...), kept here as well as handed to the caller. */
  const [ask, setAsk] = useState<DeviceAsk | null>(null);
  /** A Reconnect is under way: a spinner in the link's place (decided 2026-10-05:
   *  "show a loading circle so he knows its actually trying to reconnect")
   *  until the device moves the page on, or RECONNECT_SPIN_MS at most. */
  const [reconnecting, setReconnecting] = useState(false);
  /** The device has sat on its unlock page this long: the hint to Reconnect
   *  shows (decided 2026-10-05: "Show the hint only after like 10 seconds of
   *  waiting", then "add another 9 seconds of wait ... Lets count for the
   *  time a user needs to really put their pin and wait"). Counted afresh by
   *  every Reconnect. */
  const [stuck, setStuck] = useState(false);
  const reconnect = () => {
    flagLedgerScanDead();
    setStuck(false);
    setReconnecting(true);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    if (!reconnecting) return;
    const t = setTimeout(() => setReconnecting(false), RECONNECT_SPIN_MS);
    return () => clearTimeout(t);
  }, [reconnecting, attempt]);
  // The device answered (its page moved past the unlock): the reconnect is done.
  useEffect(() => {
    if (ask != null && !WAITING_ASKS.includes(ask)) setReconnecting(false);
  }, [ask]);
  useEffect(() => {
    setStuck(false);
    if (ask == null || !WAITING_ASKS.includes(ask)) return;
    const t = setTimeout(() => setStuck(true), RECONNECT_HINT_AFTER_MS);
    return () => clearTimeout(t);
  }, [ask, attempt]);
  const onFlowTurn = (a: DeviceAsk | null) => {
    setAsk(a);
    onTurn?.(a);
  };
  /** The one-time question inside a known vault: the key whose device was
   *  never recorded, tapped on the key list, asked which device holds it. */
  const [asking, setAsking] = useState<KeyRow | null>(null);
  const pickOf = (p: HardwarePick) => {
    setPickState(p);
    onPick?.(p);
  };
  // Where the step starts is told once, as it mounts (a screen that shows
  // something only once a device is picked needs to know the recorded one
  // skipped the question); the changes are told as they happen.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  useEffect(() => {
    onPickRef.current?.(pick);
    // The start alone: later picks report themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const back = () => {
    setAsking(null);
    pickOf(null);
  };
  // What the step's Back returns to: the list the step started from
  // (the vault's keys, or the question the step asks for these keys: a bare
  // Ledger's among the Ledgers, a key with no record's among every suited
  // model). A pick preset by the caller (the import's list, a signing row's
  // answer) came from that same question, so it returns there too (decided
  // 2026-10-04: it used to reopen every suited model for a key the vault
  // knew was a Ledger). A straight connection from the vault's own records
  // returns to no list: the vault knows which device holds the key, and the
  // bare list is for a new box alone (decided 2026-10-04); a device that moved is
  // Replace signing device's job, from the vault's menu.
  const list: KeyStep | null = step.kind !== 'connect' ? step : model ? { kind: 'ask', models: suited } : null;
  const shown: KeyStep = list ?? { kind: 'ask', models: suited };
  const qrPick = pick != null && pick !== 'another' && !!deviceKindInfo(modelInfo(pick).kind)?.methods.includes('qr') && renderQr != null;

  // The step's ONE Back and where it goes now, decided once for every page
  // the step is on: off the caller's rows or the scanner's page, to the list
  // they sat behind; off the search, to the device list when there is one,
  // else the caller's own step; off a key's device question, back to the key
  // list; off a list, the caller's own step. None while the device is at
  // work, and none where the caller's rows are the whole step (no question
  // was ever asked).
  const stepBack = ((): (() => void) | null => {
    if (pick === 'another' && another) return back;
    if (qrPick) return back;
    if (pick != null && pick !== 'another') return locked ? null : list != null ? back : (onBack ?? null);
    if (shown.kind === 'keys') return asking != null ? () => setAsking(null) : (onBack ?? null);
    if (shown.models.length === 0 && another) return null;
    return onBack ?? null;
  })();
  // Handed to the page's footer (`onFooterBack`): one stable press reading
  // the Back of the moment, told only as it comes and goes.
  const stepBackRef = useRef(stepBack);
  stepBackRef.current = stepBack;
  const onFooterBackRef = useRef(onFooterBack);
  onFooterBackRef.current = onFooterBack;
  const handedBack = useRef<StepBack>({ onPress: () => stepBackRef.current?.() }).current;
  const hasBack = stepBack != null;
  useEffect(() => {
    if (!hasBack) return;
    onFooterBackRef.current(handedBack);
    return () => onFooterBackRef.current(null);
  }, [hasBack, handedBack]);

  if (pick === 'another' && another) return <>{another(back)}</>;
  if (qrPick && renderQr) return <>{renderQr()}</>;
  if (pick != null && pick !== 'another') {
    // The search is told the device to draw and to look for; the brands it
    // may run are every Bluetooth brand this step can use.
    const kinds = kindsOf(suited).filter((k) => deviceKindInfo(k)?.methods.includes('bluetooth'));
    return (
      <View style={styles.wrap}>
        <HwwConnectFlow
          key={attempt}
          network={network}
          expect={pick}
          kinds={kinds}
          deviceTask={props.deviceTask}
          ledgerTask={props.ledgerTask}
          bitboxTask={props.bitboxTask}
          usedDeviceIds={props.usedDeviceIds}
          usedLabel={props.usedLabel}
          onDone={props.onDone}
          ceremony={ceremony}
          onDeviceTurn={onFlowTurn}
        />
        {/* Never while the device is at work on a transaction. */}
        {!locked && stuck && !reconnecting && (
          <Text style={styles.hint}>{reconnectHint(modelInfo(pick).kind)}</Text>
        )}
        {!locked &&
          (reconnecting ? (
            <View style={styles.reconnecting} accessibilityLabel={RECONNECTING} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.colors.gold} />
              <Text style={styles.reconnectingText}>{RECONNECTING}</Text>
            </View>
          ) : (
            <StepLink label={RECONNECT} onPress={reconnect} />
          ))}
      </View>
    );
  }
  if (shown.kind === 'keys') {
    if (asking != null) {
      // The key's device, asked once: the first connection records it.
      return <DevicePicker models={asking.ask} question={question} intro={intro} onPick={pickOf} back={{ name: asking.name, onBack: () => setAsking(null) }} />;
    }
    return <KeyDevicePicker rows={shown.rows} question={question} intro={intro} onPick={(row) => (row.model != null ? pickOf(row.model) : setAsking(row))} />;
  }
  // Nothing Talia reaches itself and the caller's own ways in: straight to
  // them, with no list of one row to tap first, and no way "back" to a
  // question that was never asked (decided 2026-10-04: the App Store build's
  // heir page ended on a "Choose another device" that did nothing).
  if (shown.models.length === 0 && another) return <>{another(null)}</>;
  return <DevicePicker models={shown.models} question={question} intro={intro} onPick={pickOf} another={another ? () => pickOf('another') : undefined} />;
}

/** Starts the search and the connection afresh, as leaving and coming back did. */
export const RECONNECT = 'Reconnect';
/** In the link's place while a Reconnect runs. */
export const RECONNECTING = 'Reconnecting\u2026';
/** The pages where the device is still being woken, unlocked or found. */
const WAITING_ASKS: readonly DeviceAsk[] = ['unlock', 'side'];

export const RECONNECT_HINT_AFTER_MS = 19000;
/** The spinner's longest stay when the device never moves the page on. */
export const RECONNECT_SPIN_MS = 8000;

/** One line of a way out under the search: a text link that belongs to the
 *  drawing it sits under, which is why it stays in the content while every
 *  button is the footer's (decided 2026-10-05). */
function StepLink({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.other} onPress={onPress} accessibilityRole="button">
      <Text style={styles.otherText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    other: { alignSelf: 'flex-start', marginTop: theme.spacing.sm },
    otherText: { ...theme.typography.body, color: theme.colors.accentText },
    // The search notes' own colour (decided 2026-10-05: "keep the orange color of the font").
    hint: { ...theme.typography.caption, color: theme.colors.gold, marginTop: theme.spacing.sm },
    reconnecting: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, alignSelf: 'flex-start', marginTop: theme.spacing.sm },
    reconnectingText: { ...theme.typography.body, color: theme.colors.slate },
  }),
);
