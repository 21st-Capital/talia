/**
 * Connect a Kraken read-only API key to a portfolio (decided 2026-09-07, for the
 * client who asked). Two rules: the key lives only on this phone
 * (Keychain), and 21st Capital never holds it.
 *
 * The screen asks for the two strings Kraken shows when a key is made, checks
 * the private key is at least the right shape, stores both, and runs the
 * first import right here with progress, so a wrong key fails in front of
 * the client instead of silently later. A failed first import clears the
 * stored key again: nothing half-connected is left behind.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal, Gloss, cardGlow } from '../components';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { AppDialog, BbqrScanner, Button, ChevronRightIcon, InfoHeading, ScanIcon, Screen, TextField } from '../components';
import { bytesToUtf8 } from '../../bitcoin/bbqr';
import { isSharedViewer, useWallets, withExchangeLink } from '../../wallet';
import { looksLikeKrakenSecret, parseKrakenQr } from '../../exchanges';
import {
  clearKrakenCredentials,
  probeKraken,
  saveKrakenCredentials,
  assertKrakenKeyReadOnly,
  syncKrakenPortfolio,
} from '../../services/krakenSync';

type Props = NativeStackScreenProps<VirtualStackParamList, 'KrakenConnect'>;

const KRAKEN_STEPS = [
  'On Kraken, tap your profile picture at the top right, then Settings.',
  'Open Connections & API. Under Spot trading API, tap Create API key.',
  'Name it Talia. Tick only Query under Funds permissions, Query closed orders & trades under Orders and trades, and Query ledger entries under Data. Leave every switch off.',
  'Tap Generate key. Kraken shows the API key and the private key, each with a QR code.',
  'Back here, tap the scan icon in each field and point the camera at its QR code, or paste the two keys.',
];

export function KrakenConnectScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId } = route.params;
  const { getWallet, settings, updateWallet, touchManualVault } = useWallets();
  const wallet = getWallet(walletId);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<number | null>(null);
  const [probe, setProbe] = useState<string | undefined>();
  const [probing, setProbing] = useState(false);
  /** Which field's scan button opened the camera. A code holding the OTHER
   *  value still lands in its own field; nobody has to scan twice for a
   *  mix-up, and the note says what was read. */
  const [scanning, setScanning] = useState<'key' | 'secret' | null>(null);
  const [scanNote, setScanNote] = useState<string | undefined>();
  const [guideOpen, setGuideOpen] = useState(false);

  /** Kraken shows a QR beside each value (decided 2026-09-07: "I can also scan it
   *  to make sure it is pasted correctly"). Each scan fills whatever the
   *  code held; two codes, two scans. */
  const onScanned = (text: string, target: 'key' | 'secret'): void => {
    const found = parseKrakenQr(text);
    if (found.key) setApiKey(found.key);
    if (found.secret) setSecret(found.secret);
    if (found.key && found.secret) setScanNote('Scanned both keys.');
    else if (found.key) setScanNote(target === 'key' ? 'Scanned the API key.' : 'That code held the API key, so it went into the API key field.');
    else if (found.secret) setScanNote(target === 'secret' ? 'Scanned the private key.' : 'That code held the private key, so it went into the private key field.');
    else setScanNote('That code did not hold a Kraken key.');
  };
  const scanButton = (target: 'key' | 'secret'): React.JSX.Element => (
    <TouchableOpacity
      onPress={() => {
        setScanNote(undefined);
        setScanning(target);
      }}
      disabled={busy}
      style={styles.scanBtn}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={target === 'key' ? 'Scan the API key' : 'Scan the private key'}>
      <ScanIcon size={22} color={theme.colors.accent} />
    </TouchableOpacity>
  );
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const connect = async (): Promise<void> => {
    setError(undefined);
    const key = apiKey.trim();
    const sec = secret.trim();
    if (!key) {
      setError('Paste the API key.');
      return;
    }
    if (!looksLikeKrakenSecret(sec)) {
      setError('That does not look like a Kraken private key. Paste the long one Kraken shows once.');
      return;
    }
    setBusy(true);
    // What was pasted, in shape only: lengths and whether the private key
    // decodes. Never the values.
    setProgress(`Connecting. API key ${key.length} characters, private key ${sec.length} characters.`);
    // Unreachable for a member (the Sync screen offers no sources), kept as
    // the backstop before the first write (decided 2026-09-14).
    if (isSharedViewer(getWallet(walletId))) {
      setProgress('Only the owner of this shared portfolio can add a source.');
      return;
    }
    try {
      // A key that can trade or move funds is refused before it is kept
      // (decided 2026-09-26).
      await assertKrakenKeyReadOnly({ key, secret: sec }, true);
      await saveKrakenCredentials(walletId, { key, secret: sec });
      const result = await syncKrakenPortfolio(walletId, {
        fiat: settings.fiat,
        btcOnly: settings.btcOnly,
        onProgress: (m) => {
          if (alive.current) setProgress(m);
        },
      });
      await updateWallet(walletId, {
        exchangeLinks: withExchangeLink(wallet ?? {}, {
          exchange: 'kraken',
          connectedAt: Date.now(),
          lastSyncAt: Date.now(),
          syncedThroughSecs: result.syncedThroughSecs,
        }),
        exchangeLink: undefined,
      });
      if (result.added > 0) touchManualVault(walletId);
      if (alive.current) setDone(result.added);
    } catch (e) {
      // A key that could not read history is not kept: the next attempt
      // starts clean, and nothing looks connected that is not.
      await clearKrakenCredentials(walletId);
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not connect to Kraken.');
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress(undefined);
      }
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <Button
            title={busy ? 'Importing' : 'Connect and import'}
            onPress={() => void connect()}
            loading={busy}
            disabled={busy || !wallet}
          />
          <Button
            title="Test the connection to Kraken"
            variant="ghost"
            loading={probing}
            disabled={probing || busy}
            onPress={() => {
              setProbing(true);
              setProbe(undefined);
              void probeKraken()
                .then((m) => {
                  if (alive.current) setProbe(m);
                })
                .finally(() => {
                  if (alive.current) setProbing(false);
                });
            }}
          />
        </>
      }>
      <View style={styles.body}>
        <InfoHeading
          title="A read-only key"
          text="With only the three Query permissions, the key can look at your balances, trades and history and never trade, deposit or withdraw. It is kept on this phone only; 21st Capital never sees it. Kraken shows the private key once, so scan or copy it straight away.">
          Make a read-only key on Kraken, then scan or paste it here.
        </InfoHeading>

        {/* The walk through Kraken's settings, as laid out from a live
            account (2026-09-07). Folded by default: the heading says what to
            do, this says where the buttons are. */}
        <View style={styles.guide}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <TouchableOpacity
            style={styles.guideHeader}
            onPress={() => setGuideOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel="How to make the key on Kraken">
            <Text style={styles.guideTitle}>How to make the key on Kraken</Text>
            <View style={guideOpen ? styles.guideChevronOpen : styles.guideChevron}>
              <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
            </View>
          </TouchableOpacity>
          {guideOpen &&
            KRAKEN_STEPS.map((step, i) => (
              <View key={step} style={styles.step}>
                <View style={styles.stepBubble}>
                  <Text style={styles.stepNumber}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
        </View>

        <TextField
          label="API key"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="Scan or paste the API key"
          monospace
          trailing={scanButton('key')}
        />
        <TextField
          label="Private key"
          value={secret}
          onChangeText={setSecret}
          placeholder="Scan or paste the private key"
          secure
          trailing={scanButton('secret')}
        />
        {scanNote && <Text style={styles.progress}>{scanNote}</Text>}
        {/* The secure field shows nothing of what it holds, which twice read
            as "empty" when it was not (seen in screenshots, 2026-09-07). */}
        {secret.trim().length > 0 && (
          <Text style={styles.progress}>{`Private key: ${secret.trim().length} characters entered.`}</Text>
        )}

        {progress && <Text style={styles.progress}>{progress}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        {probe && <Text style={styles.progress}>{probe}</Text>}
        <InfoHeading
          title="What gets imported"
          style={styles.hint}
          text="Every trade with bitcoin on one side, and every bitcoin deposit and withdrawal, added to this portfolio as buys and sells with the price and fee from Kraken. Trades against another coin, and deposits and withdrawals, have no price on Kraken's side, so Talia fills in that day's market rate and says so in the note. A long history takes a minute or two, because Kraken limits how fast it can be read. After this, the portfolio checks Kraken for new activity when you open it.">
          Trades, deposits and withdrawals, kept up to date.
        </InfoHeading>
      </View>

      <AppModal visible={scanning != null} animationType="slide" onRequestClose={() => setScanning(null)}>
        <BbqrScanner
          hint={
            scanning === 'secret'
              ? 'Point the camera at the QR code Kraken shows for the private key.'
              : 'Point the camera at the QR code Kraken shows for the API key.'
          }
          onCancel={() => setScanning(null)}
          onComplete={(result) => {
            const target = scanning ?? 'key';
            setScanning(null);
            onScanned(result.kind === 'bbqr' ? bytesToUtf8(result.bytes) : result.text, target);
          }}
        />
      </AppModal>

      <AppDialog
        visible={done != null}
        title={done === 0 ? 'Connected. Nothing to import yet.' : `Connected. ${done} ${done === 1 ? 'entry' : 'entries'} added.`}
        actions={[
          {
            label: 'Done',
            variant: 'primary',
            onPress: () => {
              setDone(null);
              navigation.goBack();
            },
          },
        ]}
        onClose={() => {
          setDone(null);
          navigation.goBack();
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  body: { gap: theme.spacing.lg },
  guide: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.xs },
  guideTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  // The fold's chevron: down while closed, up once open.
  guideChevron: { transform: [{ rotate: '90deg' }] },
  guideChevronOpen: { transform: [{ rotate: '270deg' }] },
  step: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  stepBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumber: { ...theme.typography.label, color: theme.colors.accentInk },
  stepText: { ...theme.typography.body, color: theme.colors.offWhite, flex: 1 },
  scanBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  progress: { ...theme.typography.caption, color: theme.colors.slate },
  error: { ...theme.typography.caption, color: theme.colors.negative },
  hint: { ...theme.typography.caption, color: theme.colors.faint },
}));
