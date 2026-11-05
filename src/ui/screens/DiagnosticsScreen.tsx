/**
 * Settings > Diagnostics (BDK upgrade, decided 2026-10-15): the wallet
 * library's launch check, the connection test, the engine report, and, in
 * the phone app on testnet, the signing rounds to export.
 *
 * In the builds with hardware signing only (the phone app and TestFlight),
 * never the App Store's watch-only app.
 *
 * One engine since the old engine's removal (decided 2026-11-04): the engine line, this
 * phone's engine switches ("Use the previous engine", "Shadow checks off"),
 * "Answered by" under the connection test, and the preflight mismatches and
 * fallbacks are gone with the engine choice they reported on. In the phone
 * app "Checks in this build" now reads the independent address check's
 * checks and their mismatches from the engine report
 * (wallet/addressCheckStore.ts), the one check left that compares the
 * library with anything. Both are shown, so a 0 reads against the number of
 * checks behind it (decided 2026-11-04 after a phone test).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Button, Card, Screen } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, backendFor } from '../../wallet';
import { withTimeout } from '../../wallet/withTimeout';
import { NO_BITCOIN_SERVER } from '../../wallet/chainServers';
import { APP_BUILD, APP_VERSION, BUILD_FLAVOUR } from '../../config';
import {
  knownAnswerNow,
  lastConnectionAnswer,
  onConnectionAnswer,
  onKnownAnswer,
  onSigningRounds,
  signingRounds,
  signingRoundsFile,
  testBackendConnection,
} from '../../bitcoin/engine';
import type { ConnectionAnswer, KnownAnswerState } from '../../bitcoin/engine';
import { addressChecksOf, buildOf } from '../../wallet/engineReport';
import { readEngineReport, reportApp, shareEngineReport } from '../../platform/engineReportFile';
import { exportTextToFile } from '../../platform/files';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Diagnostics'>;

/**
 * The library's known-answer test, in a word or two. This page only shows
 * it: the first vault to open runs it (decided 2026-10-22: no screen starts
 * it).
 */
function knownAnswerWords(k: KnownAnswerState | null): string {
  if (k?.state === 'passed') return 'Passed';
  if (k?.state === 'failed') return 'Failed';
  if (k?.state === 'missing') return 'Not in this build';
  return 'Not run yet';
}

/** "Block 903,117 · 0.8 s", or why it failed. */
function answerLine(a: ConnectionAnswer | null): string {
  if (!a) return 'Not tested since the app opened.';
  const seconds = `${(a.ms / 1000).toFixed(1)} s`;
  if (a.height != null) return `Block ${a.height.toLocaleString('en-US')} · ${seconds}`;
  return `Failed after ${seconds}: ${(a.error ?? 'no answer').slice(0, 120)}`;
}

export function DiagnosticsScreen(_props: Props): React.JSX.Element {
  const { settings } = useWallets();
  const [answer, setAnswer] = useState<ConnectionAnswer | null>(lastConnectionAnswer());
  const [testing, setTesting] = useState(false);
  const [rounds, setRounds] = useState(signingRounds().length);
  const [problem, setProblem] = useState<string | null>(null);
  const [knownAnswer, setKnownAnswer] = useState<KnownAnswerState | null>(knownAnswerNow());
  /** This build's address checks and mismatches, from the engine report (the phone app only). */
  const [checks, setChecks] = useState<{ checks: number; mismatches: number } | null>(null);

  useEffect(() => {
    let live = true;
    // The library's launch-time check, as the
    // first vault ran it: this page never starts it.
    const offKnown = onKnownAnswer((k) => live && setKnownAnswer(k));
    setKnownAnswer(knownAnswerNow());
    // "Checks in this build" is the phone app's alone.
    if (BUILD_FLAVOUR === 'full') {
      void Promise.all([readEngineReport(), reportApp()])
        .then(([r, app]) => {
          if (live) setChecks(addressChecksOf(buildOf(r, app)));
        })
        .catch(() => {});
    }
    const offAnswer = onConnectionAnswer((a) => live && setAnswer(a));
    const offRounds = onSigningRounds(() => live && setRounds(signingRounds().length));
    return () => {
      live = false;
      offKnown();
      offAnswer();
      offRounds();
    };
  }, []);

  const test = useCallback(async () => {
    const network = settings.defaultNetwork ?? 'bitcoin';
    // None while the settings hold the Bitcoin server back
    // (wallet/chainServers.ts): nothing to test, and never the default.
    const backend = backendFor(network, settings);
    if (!backend) {
      setProblem(`${NO_BITCOIN_SERVER}.`);
      return;
    }
    setTesting(true);
    setProblem(null);
    try {
      await withTimeout(testBackendConnection(backend), 60_000, 'Connection test');
    } catch {
      // The answer, failed or not, arrives through onConnectionAnswer; a
      // timeout before any answer leaves the last one on screen.
    } finally {
      setTesting(false);
    }
  }, [settings]);

  const share = useCallback(async () => {
    setProblem(null);
    try {
      await shareEngineReport();
    } catch {
      setProblem('The report could not be shared.');
    }
  }, []);

  const exportRounds = useCallback(async () => {
    setProblem(null);
    try {
      const day = new Date().toISOString().slice(0, 10);
      await exportTextToFile(
        `talia-signing-rounds-${day}.json`,
        signingRoundsFile(signingRounds(), { version: APP_VERSION, build: APP_BUILD }),
      );
    } catch {
      setProblem('The signing rounds could not be exported.');
    }
  }, []);

  return (
    <Screen scroll style={styles.content}>
      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Wallet library</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Library check</Text>
          <Text style={styles.value}>{knownAnswerWords(knownAnswer)}</Text>
        </View>
        {knownAnswer?.state === 'failed' && <Text style={styles.hint}>No vault opens until the app opens again and the check passes.</Text>}
      </Card>

      {BUILD_FLAVOUR === 'full' && (
        <Card style={styles.group}>
          <Text style={styles.groupTitle}>Checks in this build</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Address checks</Text>
            <Text style={styles.value}>{checks?.checks ?? '-'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Address check mismatches</Text>
            <Text style={styles.value}>{checks?.mismatches ?? '-'}</Text>
          </View>
          <Text style={styles.hint}>Counted since this build was installed.</Text>
        </Card>
      )}

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Connection test</Text>
        <Text style={styles.hint}>{answerLine(answer)}</Text>
        <Button
          title="Test the connection"
          variant="ghost"
          loading={testing}
          disabled={testing}
          onPress={() => void test()}
          style={styles.cardAction}
        />
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Engine report</Text>
        <Text style={styles.hint}>Counts only. No vault, key or address is in it.</Text>
        <Button title="Share report" variant="ghost" onPress={() => void share()} style={styles.cardAction} />
      </Card>

      {BUILD_FLAVOUR === 'full' && (
        <Card style={styles.group}>
          <Text style={styles.groupTitle}>Signing rounds</Text>
          <Text style={styles.hint}>
            {rounds > 0
              ? `${rounds} on testnet since the app opened.`
              : 'None on testnet since the app opened. Sign a testnet payment first.'}
          </Text>
          <Button
            title="Export signing round"
            variant="ghost"
            disabled={rounds === 0}
            onPress={() => void exportRounds()}
            style={styles.cardAction}
          />
        </Card>
      )}

      {problem != null && <Text style={styles.problem}>{problem}</Text>}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.lg },
    group: { gap: theme.spacing.sm },
    groupTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
    },
    rowLabel: { ...theme.typography.body, color: theme.colors.offWhite, flexShrink: 1 },
    value: { ...theme.typography.mono, color: theme.colors.offWhite },
    hint: { ...theme.typography.caption, color: theme.colors.slate },
    cardAction: { marginTop: theme.spacing.sm },
    problem: { ...theme.typography.caption, color: theme.colors.negative },
  }),
);
