/**
 * Connect a Coinbase read-only CDP key to a portfolio (decided 2026-09-07, the
 * second exchange). Same two rules as Kraken: the key lives only on this
 * phone, and 21st Capital never holds it.
 *
 * Coinbase's key is two strings: a name (organizations/…/apiKeys/…) and a
 * private key block. The portal also offers the pair as one downloadable
 * file; pasting that file, or both values together, into either field fills
 * both. The one trap Coinbase set: the portal recommends Ed25519 keys and
 * this API refuses them, so the guide and the key check both say ECDSA.
 *
 * The flow was proven on Coinbase's sandbox (static sample trades, no key)
 * from a build-time button removed before 1.0.2 shipped; the service
 * still understands a sandbox link, so a phone that made one can disconnect
 * it, and "Test the connection" with empty fields still reaches the sandbox.
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
import { coinbaseKeyProblemMessage, coinbaseSigningKey, parseCoinbaseKeyInput } from '../../exchanges';
import {
  clearCoinbaseCredentials,
  probeCoinbase,
  saveCoinbaseCredentials,
  assertCoinbaseKeyReadOnly,
  syncCoinbasePortfolio,
} from '../../services/coinbaseSync';

type Props = NativeStackScreenProps<VirtualStackParamList, 'CoinbaseConnect'>;

const COINBASE_STEPS = [
  'On a computer, open portal.cdp.coinbase.com and sign in with your Coinbase account.',
  'Open API keys, then the Secret API keys tab, and tap Create API key.',
  'Name it Talia. Under permissions tick View only. Leave the IP allowlist empty, because the address of a phone keeps changing and a list would block Talia. Talia refuses a key that can trade or move funds.',
  'Under signature algorithm choose ECDSA. Coinbase suggests Ed25519, but that kind cannot read your history here.',
  'Tap Create. Copy the key name and the private key, or download the key file and paste its contents. Coinbase shows the private key once.',
];

export function CoinbaseConnectScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId } = route.params;
  const { getWallet, settings, updateWallet, touchManualVault } = useWallets();
  const wallet = getWallet(walletId);
  const [keyName, setKeyName] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<number | null>(null);
  const [probe, setProbe] = useState<string | undefined>();
  const [probing, setProbing] = useState(false);
  const [scanning, setScanning] = useState<'key' | 'secret' | null>(null);
  const [scanNote, setScanNote] = useState<string | undefined>();
  const [guideOpen, setGuideOpen] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  /** A paste or scan may carry the key file, both values, or one; whatever
   *  it holds lands in the right field. */
  const absorb = (text: string, into: 'key' | 'secret'): void => {
    const found = parseCoinbaseKeyInput(text);
    if (found.keyName) setKeyName(found.keyName);
    if (found.secret) setSecret(found.secret);
    if (!found.keyName && !found.secret) {
      if (into === 'key') setKeyName(text);
      else setSecret(text);
    }
  };

  const connect = async (): Promise<void> => {
    setError(undefined);
    // Either field may have received the whole key file.
    const merged = { ...parseCoinbaseKeyInput(secret), ...parseCoinbaseKeyInput(keyName) };
    const creds = {
      keyName: (merged.keyName ?? keyName).trim(),
      secret: (merged.secret ?? secret).trim(),
      sandbox: false,
    };
    if (!/organizations\/.+\/apiKeys\/.+/.test(creds.keyName)) {
      setError('Paste the key name. It starts with organizations/ and contains apiKeys/.');
      return;
    }
    const key = coinbaseSigningKey(creds.secret);
    if (!('scalar' in key)) {
      setError(coinbaseKeyProblemMessage(key.problem));
      return;
    }
    setBusy(true);
    setProgress('Connecting');
    // Unreachable for a member (the Sync screen offers no sources), kept as
    // the backstop before the first write (decided 2026-09-14).
    if (isSharedViewer(getWallet(walletId))) {
      setProgress('Only the owner of this shared portfolio can add a source.');
      return;
    }
    try {
      // A key that can trade or move funds is refused before it is kept
      // (decided 2026-09-26).
      await assertCoinbaseKeyReadOnly(creds, true);
      await saveCoinbaseCredentials(walletId, creds);
      const result = await syncCoinbasePortfolio(walletId, {
        fiat: settings.fiat,
        btcOnly: settings.btcOnly,
        onProgress: (m) => {
          if (alive.current) setProgress(m);
        },
      });
      await updateWallet(walletId, {
        exchangeLinks: withExchangeLink(wallet ?? {}, {
          exchange: 'coinbase',
          connectedAt: Date.now(),
          lastSyncAt: Date.now(),
          syncedThroughSecs: result.syncedThroughSecs,
        }),
        exchangeLink: undefined,
      });
      if (result.added > 0) touchManualVault(walletId);
      if (alive.current) setDone(result.added);
    } catch (e) {
      await clearCoinbaseCredentials(walletId);
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not connect to Coinbase.');
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress(undefined);
      }
    }
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
      accessibilityLabel={target === 'key' ? 'Scan the key name' : 'Scan the private key'}>
      <ScanIcon size={22} color={theme.colors.accent} />
    </TouchableOpacity>
  );

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
            title="Test the connection to Coinbase"
            variant="ghost"
            loading={probing}
            disabled={probing || busy}
            onPress={() => {
              setProbing(true);
              setProbe(undefined);
              const merged = { ...parseCoinbaseKeyInput(secret), ...parseCoinbaseKeyInput(keyName) };
              const creds =
                merged.keyName && merged.secret ? { keyName: merged.keyName, secret: merged.secret, sandbox: false } : null;
              void probeCoinbase(creds)
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
          text="With the View permission only, the key can read your balances and trades and never trade or move anything. It is kept on this phone only; 21st Capital never sees it. Coinbase shows the private key once, so copy it straight away.">
          Make a read-only key on Coinbase, then paste it here.
        </InfoHeading>

        <View style={styles.guide}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <TouchableOpacity
            style={styles.guideHeader}
            onPress={() => setGuideOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel="How to make the key on Coinbase">
            <Text style={styles.guideTitle}>How to make the key on Coinbase</Text>
            <View style={guideOpen ? styles.guideChevronOpen : styles.guideChevron}>
              <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
            </View>
          </TouchableOpacity>
          {guideOpen &&
            COINBASE_STEPS.map((step, i) => (
              <View key={step} style={styles.step}>
                <View style={styles.stepBubble}>
                  <Text style={styles.stepNumber}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
        </View>

        <TextField
          label="Key name"
          value={keyName}
          onChangeText={(t) => absorb(t, 'key')}
          placeholder="organizations/…/apiKeys/…"
          monospace
          trailing={scanButton('key')}
        />
        <TextField
          label="Private key"
          value={secret}
          onChangeText={(t) => absorb(t, 'secret')}
          placeholder="Paste the private key block"
          secure
          trailing={scanButton('secret')}
        />
        {secret.trim().length > 0 && (
          <Text style={styles.progress}>{`Private key: ${secret.trim().length} characters entered.`}</Text>
        )}
        {scanNote && <Text style={styles.progress}>{scanNote}</Text>}

        {progress && <Text style={styles.progress}>{progress}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        {probe && <Text style={styles.progress}>{probe}</Text>}
        <InfoHeading
          title="What gets imported"
          style={styles.hint}
          text="Every trade with bitcoin on one side, added to this portfolio as buys and sells with the price and fee from Coinbase. Trades against another coin have no price on Coinbase's side, so Talia fills in that day's market rate and says so in the note. Coins sent to or from Coinbase are not read yet. After this, the portfolio checks Coinbase for new trades when you open it.">
          Trades, kept up to date.
        </InfoHeading>
      </View>

      <AppModal visible={scanning != null} animationType="slide" onRequestClose={() => setScanning(null)}>
        <BbqrScanner
          hint={scanning === 'secret' ? 'Point the camera at a QR code holding the private key.' : 'Point the camera at a QR code holding the key name, or the whole key file.'}
          onCancel={() => setScanning(null)}
          onComplete={(result) => {
            const target = scanning ?? 'key';
            setScanning(null);
            const text = result.kind === 'bbqr' ? bytesToUtf8(result.bytes) : result.text;
            const found = parseCoinbaseKeyInput(text);
            absorb(text, target);
            setScanNote(
              found.keyName && found.secret
                ? 'Scanned both values.'
                : found.keyName
                  ? 'Scanned the key name.'
                  : found.secret
                    ? 'Scanned the private key.'
                    : 'That code did not hold a Coinbase key.',
            );
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
