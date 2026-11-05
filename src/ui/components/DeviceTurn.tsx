/**
 * The client's turn on the device BEFORE the transaction (decided 2026-10-04:
 * "Pin entry on the ledgers", "Opening the bitcoin app: instead of a simple
 * text ... show an animated ledger for each device", "add two more screens
 * for the moment the device is plugged in"): a Ledger's two moments the kit
 * reports exactly, the device locked ('unlock') and the app to open
 * ('open-app'), the BitBox's wait for its unlock and pairing, and the vault
 * shown to the device for its approval ('register', decided 2026-10-04: "do we
 * have the process of registering a vault animated and built for each
 * device?"; three phone-test videos), drawn in the courier's look. The title is the
 * device's step, numbered (decided 2026-10-05: "1. Insert your pin on your ledger
 * (instead of 'your turn on the ledger') 2. Open the bitcoin app 3. verify
 * the address or register the vault"; the plan in `ui/hww/deviceSteps.ts`),
 * the drawn phone greyed on the left, the chevrons toward the device, the
 * device lit and the hero, stepping round and round through its own pages on
 * the same one-clock loop with the press hint on the control to press
 * (`ui/hww/deviceTurns.ts`, pure), started afresh with every step so the
 * next prompt is on it as the flow's slide lands (`TurnSlide`, the flows'),
 * and one true line under it where the step has one.
 *
 * The connection flows draw it themselves for EVERY purpose (decided 2026-10-04,
 * device first: "show him all the animations we built for each device both
 * during SETUP and during signing"): `HwwConnectFlow` while the search runs
 * and for the BitBox once found, `LedgerConnectFlow` for the Ledger's PIN and
 * app, and both for the registration, from the facts the device layer hands
 * them (`register`), so setup, import, replacement, registration, the address
 * check, the refresh session and signing all show the same pages. A turn with
 * no page (`hasTurnPage`) is never drawn and never reported.
 */
import React, { useEffect, useMemo } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { DeviceRow } from './SigningCourier';
import { DeviceLoop } from './SigningTour';
import type { LoopScript } from './SigningTour';
import { deviceHint, planFromCues } from './pressHintScript';
import { deviceTurn, turnWords } from '../hww/deviceTurns';
import type { DeviceAsk } from '../hww/deviceTurns';
import type { DeviceDrawing } from '../hww/signingDevice';
import type { RegisterFacts } from '../hww/vaultRegistration';
import type { AddressFacts } from '../hww/addressCheck';
import type { Network } from '../../bitcoin/descriptor/types';

export function DeviceTurn({
  drawing,
  ask,
  network,
  register,
  address,
}: {
  drawing: DeviceDrawing;
  ask: DeviceAsk;
  network: Network;
  /** The vault as the device is shown it, for the 'register' ask alone. */
  register?: RegisterFacts | null;
  /** The address as the device shows it, for the 'address' ask alone. */
  address?: AddressFacts | null;
}): React.JSX.Element | null {
  const words = turnWords(drawing, ask, network);
  const script = useMemo((): LoopScript | null => {
    const turn = deviceTurn(drawing, ask, network, register, address);
    if (turn == null) return null;
    const hint = deviceHint(drawing);
    return {
      starts: turn.starts,
      cycle: turn.cycle,
      stillFrom: turn.stillFrom,
      pass: (n) => {
        const p = turn.pass(n);
        return { screens: p.screens, plan: hint != null && p.cues.length > 0 ? planFromCues(hint, p.cues, p.words, p.progress, turn.cycle, [], p.scrolls) : null };
      },
    };
  }, [drawing, ask, network, register, address]);
  // VoiceOver hears the step and what the device asks, as they come.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility([words.title, words.line].filter((x): x is string => x != null).join('. '));
  }, [words.title, words.line]);
  if (script == null) return null;
  return (
    <View style={styles.inner}>
      <Text style={styles.title} accessibilityRole="header">
        {words.title}
      </Text>
      <DeviceRow drawing={drawing} path={{ kind: 'chevrons', towardPhone: false }} there>
        {(w) => <DeviceLoop key={ask} drawing={drawing} width={w} script={script} />}
      </DeviceRow>
      {words.line != null && <Text style={styles.body}>{words.line}</Text>}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    inner: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite, flexShrink: 1 },
    body: { ...theme.typography.body, color: theme.colors.offWhite },
  }),
);
