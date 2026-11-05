/**
 * Network settings: the Bitcoin Electrum server, BlueWallet-style. The
 * status card (the pill, server and detail centred, no heading:
 * `StatusCard`), host / port / SSL fields, and Save (which live-tests the
 * connection). The certificate of every server on the internet is checked;
 * only a server on the user's own network or over Tor may carry its own
 * (decided 2026-09-26, bitcoin/electrumTls.ts).
 *
 * Bitcoin only (decided 2026-10-18: "remove the testnet settings completely and
 * just have testnet vaults sync automatically to public nodes"): Testnet4
 * vaults sync through the built-in public servers, with no setting, and the
 * old Bitcoin / Testnet4 rows are gone. A server saved here is the ONLY one
 * a Bitcoin vault talks to (wallet/chainServers.ts): never a fallback, never
 * a rewrite. One Talia once suggested that was renamed or retired keeps its
 * saved name and says so here and on the vault.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Screen, Button, Card, StatusCard, TextField, RadioMark } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, chainServerNote, serverHold } from '../../wallet';
import { DEFAULT_ELECTRUM } from '../../bitcoin/network';
import { testBackendConnection } from '../../bitcoin/engine';
import { withTimeout } from '../../wallet/withTimeout';
import {
  electrumMayFallBackToPlain,
  electrumUrlMayBeSaved,
  electrumValidatesCertificate,
  PLAIN_INTERNET_REFUSED,
  SUGGESTED_ELECTRUM_SERVERS,
} from '../../bitcoin/electrumTls';

type Props = NativeStackScreenProps<SettingsStackParamList, 'NetworkSettings'>;

type Status = 'unknown' | 'testing' | 'connected' | 'failed';

/** The one network this page edits. */
const NETWORK = 'bitcoin' as const;

/** The public default, used while no server is saved (none is saved until
 *  the client taps Save & test; Reset to default server unsaves it). */
const DEFAULT_URL = DEFAULT_ELECTRUM[NETWORK];

/** What Save says with no host typed: nothing is saved. */
const ENTER_A_SERVER = 'Enter the server\'s address first.';

/** Split "ssl://host:port" into fields. */
function parseElectrumUrl(url: string): { host: string; port: string; ssl: boolean } {
  const m = /^(ssl|tcp):\/\/([^:]+):(\d+)$/.exec(url.trim());
  if (!m) return { host: url.replace(/^\w+:\/\//, ''), port: '50002', ssl: true };
  return { host: m[2], port: m[3], ssl: m[1] === 'ssl' };
}

export function NetworkSettingsScreen(_props: Props): React.JSX.Element {
  const { settings, updateSettings } = useWallets();
  // Electrum only since 2026-07 (decided then); a saved Esplora server moved to
  // the default Electrum server at start (wallet/settingsMigration.ts).

  // A server held back (wallet/chainServers.ts `serverHold`) starts the
  // fields on that server's name (the client's own Esplora server from
  // before 2026-07) or empty (settings that could not be read), never on
  // the default: the vaults use no server until the client enters theirs,
  // and the note says so.
  const hold = serverHold(NETWORK, settings);
  const initial = hold
    ? { ...parseElectrumUrl(DEFAULT_URL), host: hold.reason === 'esplora' ? hold.host.replace(/:\d+$/, '') : '' }
    : parseElectrumUrl(settings.electrumUrls[NETWORK] ?? DEFAULT_URL);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [ssl, setSsl] = useState(initial.ssl);

  const [status, setStatus] = useState<Status>('unknown');
  const [statusDetail, setStatusDetail] = useState<string>('');

  /** A renamed or retired server Talia once suggested, saved here, or one
   *  held back. */
  const savedNote = chainServerNote(NETWORK, settings, { where: 'settings' });

  const currentUrl = `${ssl ? 'ssl' : 'tcp'}://${host.trim()}:${port.trim()}`;

  /** Returns the URL that actually connected (may differ from the input —
   *  see the plain-TCP fallback), or null on failure. */
  const test = useCallback(async (urlOverride?: string): Promise<string | null> => {
    // urlOverride: callers that just CHANGED the url pass it directly — the
    // closure's `currentUrl` still holds the pre-setState value.
    const url = urlOverride ?? currentUrl;
    setStatus('testing');
    setStatusDetail('');
    // 60s, not 25: behind a VPN (Tailscale et al) even public servers can
    // take 20s+ while the tunnel wakes: measured in a phone test 2026-07-19.
    try {
      const height = await withTimeout(testBackendConnection(
        { type: 'electrum', url, validateDomain: electrumValidatesCertificate(url), retry: 2, timeout: 10 },
      ), 60_000, 'Connection test');
      setStatus('connected');
      setStatusDetail(`block height ${height.toLocaleString('en-US')}`);
      return url;
    } catch (e) {
      // Personal nodes (bare electrs/Fulcrum ports) often speak PLAIN TCP —
      // dialing SSL at a plain socket doesn't error, it hangs. Before
      // declaring failure, try the same server without SSL, but ONLY for a
      // server on the user's own network or over Tor (decided
      // 2026-09-26): an internet server that fails TLS is refused, never
      // downgraded to an unencrypted connection.
      if (url.startsWith('ssl://') && electrumMayFallBackToPlain(url)) {
        const tcpUrl = url.replace('ssl://', 'tcp://');
        try {
          const height = await withTimeout(testBackendConnection(
            { type: 'electrum', url: tcpUrl, validateDomain: false, retry: 2, timeout: 10 },
          ), 30_000, 'Connection test');
          setSsl(false);
          setStatus('connected');
          setStatusDetail(
            `block height ${height.toLocaleString('en-US')}. This server has no SSL on this port, so SSL was switched off for it.`,
          );
          return tcpUrl;
        } catch {
          // fall through to the original failure
        }
      }
      setStatus('failed');
      const secureRefused = url.startsWith('ssl://') && electrumValidatesCertificate(url);
      setStatusDetail(
        `${(e as Error).message?.slice(0, 160) ?? 'Connection failed'}. ${
          secureRefused
            ? 'Talia checks the security certificate of every server on the internet and does not connect when it cannot be verified. '
            : ''
        }If this server sits behind a VPN, open the VPN app first and try again. Waking the tunnel can take a while.`,
      );
      return null;
    }
  }, [currentUrl]);

  // Probe the active server once on entry. None while one is held back:
  // its new address is not known yet, and the default is not the vaults'.
  useEffect(() => {
    if (!hold) test();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUsePublic = async () => {
    // Drop the saved server, restore the public default, and re-test. The
    // client's own choice, so it is the one way a Bitcoin vault ever moves
    // to the public server.
    const urls = { ...settings.electrumUrls };
    delete urls[NETWORK];
    await updateSettings({ backendType: 'electrum', electrumUrls: urls, bitcoinServerHold: undefined });
    const d = parseElectrumUrl(DEFAULT_URL);
    setHost(d.host);
    setPort(d.port);
    setSsl(d.ssl);
    setStatus('unknown');
    setStatusDetail('');
    void test(DEFAULT_URL);
  };

  const onSave = async () => {
    // Save FIRST — never let a hung test stop the user from fixing a bad
    // server — then verify the connection for the status pill. If the test
    // only connected after dropping SSL, persist THAT working form.
    // An unencrypted connection only inside the user's own network or over
    // Tor (decided 2026-09-26): refused here, in plain words.
    if (!host.trim()) {
      setStatus('failed');
      setStatusDetail(ENTER_A_SERVER);
      return;
    }
    if (!electrumUrlMayBeSaved(currentUrl)) {
      setStatus('failed');
      setStatusDetail(PLAIN_INTERNET_REFUSED);
      return;
    }
    // Saved as typed, the default server included: a server the client
    // picks is theirs, and is never swapped for another, not even when a
    // later release changes the default (wallet/chainServers.ts). Only
    // Reset to default server leaves the Bitcoin server unsaved. A server
    // held back is released: this is the one the client entered.
    await updateSettings({
      backendType: 'electrum',
      electrumUrls: { ...settings.electrumUrls, [NETWORK]: currentUrl },
      bitcoinServerHold: undefined,
    });
    const worked = await test();
    if (worked && worked !== currentUrl) {
      await updateSettings({ backendType: 'electrum', electrumUrls: { ...settings.electrumUrls, [NETWORK]: worked } });
    }
  };

  return (
    <Screen
      scroll
      style={styles.content}
      // The page's actions, pinned (decided 2026-10-05): save and test, then the
      // way back to the public server. The footer rises with the keyboard,
      // so the field being typed in and Save sit above the keys together.
      footer={
        <>
          <Button title={status === 'testing' ? 'Testing…' : 'Save & test'} onPress={onSave} loading={status === 'testing'} />
          <Button title="Reset to default server" variant="ghost" onPress={onUsePublic} />
        </>
      }>
      {/* The status alone, centred, no heading (decided 2026-10-05: "delete the
          word 'status' above 'connect'"). The look is StatusCard's, shared
          with every connection or sync status in the app. */}
      <StatusCard
        tone={status === 'connected' ? 'ok' : status === 'failed' ? 'bad' : 'idle'}
        state={
          status === 'connected'
            ? 'Connected'
            : status === 'failed'
              ? 'Not connected'
              : status === 'testing'
                ? 'Testing…'
                : 'Not tested'
        }
        subject={currentUrl}
        detail={statusDetail}
      />

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>
          Preferred server
        </Text>
        <Text style={styles.hint}>
          Your Bitcoin vaults use only this server. Make sure you trust the server you pick.
        </Text>
        {savedNote != null && <Text style={styles.note}>{savedNote}</Text>}
        <TextField label="Host" value={host} onChangeText={setHost} placeholder="electrum.example.com or 100.x.x.x" monospace />
        <View style={styles.portRow}>
          <View style={styles.portField}>
            <TextField label="Port" value={port} onChangeText={setPort} placeholder="50002" keyboardType="numeric" />
          </View>
          <View style={styles.sslBlock}>
            <Text style={styles.sslLabel}>Use SSL</Text>
            <Switch
              value={ssl}
              onValueChange={setSsl}
              trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
              ios_backgroundColor={theme.colors.switchOff}
              thumbColor={theme.colors.switchThumb}
            />
          </View>
        </View>
      </Card>

      {SUGGESTED_ELECTRUM_SERVERS.length > 0 && (
        <Card style={styles.group}>
          <Text style={styles.groupTitle}>Suggested servers</Text>
          <Text style={styles.hint}>
            Reliable public Electrum servers. Tap one to use it.
          </Text>
          {SUGGESTED_ELECTRUM_SERVERS.map((srv, i) => {
            const active = host === srv.host && port === srv.port;
            return (
              <TouchableOpacity
                key={srv.host}
                style={[styles.serverRow, i > 0 && styles.serverDivider]}
                activeOpacity={0.8}
                onPress={() => {
                  setHost(srv.host);
                  setPort(srv.port);
                  setSsl(true);
                  setStatus('unknown');
                  setStatusDetail('');
                }}>
                <View style={styles.serverBody}>
                  <Text style={styles.serverHost}>{srv.host}</Text>
                  <Text style={styles.serverPort}>SSL Port: {srv.port}</Text>
                </View>
                {/* Configurator-style circle selection (decided 2026-07-18). */}
                <RadioMark on={active} />
              </TouchableOpacity>
            );
          })}
          {/* No position word: the sentence holds wherever the button sits. */}
          <Text style={styles.hint}>Then tap Save & test.</Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.lg },
  // The status card is StatusCard's: nothing of its look lives here.

  group: { gap: theme.spacing.sm },
  groupTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  hint: { ...theme.typography.caption, color: theme.colors.slate },
  // A renamed or retired server: the warning colour, as hints of that kind are.
  note: { ...theme.typography.caption, color: theme.colors.gold },
  portRow: { flexDirection: 'row', gap: theme.spacing.lg, alignItems: 'flex-end' },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
  },
  serverDivider: { borderTopWidth: 1, borderTopColor: theme.colors.hairline },
  serverBody: { flex: 1 },
  serverHost: { ...theme.typography.body, color: theme.colors.offWhite },
  serverPort: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 1 },
  // Configurator-style circle selection (lime when active).
  portField: { flex: 1 },
  sslBlock: { alignItems: 'center', gap: theme.spacing.xs },
  sslLabel: { ...theme.typography.label, color: theme.colors.slate },
}));
