/**
 * Scan or type an address. Two modes:
 *  - verify (from a wallet's ⋯ menu): check the scanned address against THAT
 *    wallet only — "belongs" / "does not belong".
 *  - global (home scan icon): if any wallet owns the address, report which
 *    one; otherwise treat it as a payment destination — pick a wallet and go
 *    to Send with the address prefilled.
 *
 * The address can also be typed or pasted (reported 2026-09-12: "Address
 * verification with text is missing"): the scanner's keyboard button, or
 * `mode: 'type'` in the route params, opens a form whose Check button feeds
 * the SAME onScanned the camera uses, so both paths are judged alike. Checking
 * an address moves no coins, so the form stays; only a scanned address goes on
 * to Send (decided 2026-10-31 after a phone test: an address that moves coins
 * is pasted or scanned on Send's own step, never typed).
 *
 * Ownership is decided by BDK (`engine.ownsAddress` → wallet.isMine), never
 * by string comparison against derived lists.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import {
  ChevronRightIcon,
  ClipboardIcon,
  Button,
  DrawnIcon,
  Screen,
  TextField,
  WalletIconTile,
  walletIconFor,
  Gloss,
  cardGlow,
} from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, formatAmount, formatFiat, getBtcPrice } from '../../wallet';
import type { WalletMeta } from '../../wallet';
import { parseScannedAddress } from '../../bitcoin/scanParse';
import { classifyScan } from '../../bitcoin/scanClassify';
import { parsePsbt } from '../../bitcoin/psbt';
import { parseKeyOrigins, stripChecksum } from '../../bitcoin/descriptor';
import { QrScanner } from '../../platform/QrScanner';
import { readClipboard } from '../../platform/clipboard';
import { SIGNING_ENABLED } from '../../config';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

type Phase =
  | { kind: 'scanning' }
  | { kind: 'typing'; draft: string; error?: string } // typed or pasted, not yet checked
  | { kind: 'chooseAction'; address: string } // global mode: verify or send?
  | { kind: 'checking'; address: string }
  | { kind: 'owned'; address: string; wallet: WalletMeta }
  | { kind: 'notOwned'; address: string } // verify mode: this wallet doesn't own it
  | { kind: 'globalNotOwned'; address: string } // global verify: NO wallet owns it
  | { kind: 'pickSender'; address: string } // send: choose the source wallet
  | { kind: 'psbtNoMatch'; fingerprints: string[] } // PSBT, but no wallet here signs it
  | { kind: 'psbtReadOnly' } // a PSBT, but this build cannot sign anything
  | { kind: 'invalid'; raw: string };

export function ScanScreen({ navigation, route }: Props): React.JSX.Element {
  const { wallets, getWallet, getEngine } = useWallets();
  const verifyWalletId = route.params?.walletId;
  const verifyWallet = verifyWalletId ? getWallet(verifyWalletId) : undefined;

  const [phase, setPhase] = useState<Phase>(
    route.params?.mode === 'type' ? { kind: 'typing', draft: '' } : { kind: 'scanning' },
  );
  // The camera looks the same everywhere in the app (decided 2026-09-15: "the
  // scanner from the home screen shows a header while the scanner from the
  // send screen doesnt! they should all have the same format!"). Every other
  // scanner is a full-screen sheet with no header, so this one hides its bar
  // while the camera is up and brings it back for the result.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: phase.kind !== 'scanning' });
  }, [navigation, phase.kind]);
  /** How the value arrived, so every result card offers the same way back:
   *  "Scan again" after a scan, "Check another" after a typed address. */
  const [entry, setEntry] = useState<'scan' | 'type'>(
    route.params?.mode === 'type' ? 'type' : 'scan',
  );
  const maySend = SIGNING_ENABLED && entry === 'scan';
  /** A scanned payment request's own amount, carried into Send beside its
   *  address (decided 2026-11-04); every read sets it again. */
  const requestAmount = useRef<number | undefined>(undefined);

  const startScanning = useCallback(() => {
    setEntry('scan');
    setPhase({ kind: 'scanning' });
  }, []);

  const startTyping = useCallback((draft = '') => {
    setEntry('type');
    setPhase({ kind: 'typing', draft });
  }, []);

  /** The Paste button on the address field: an empty clipboard says so (the
   *  ImportScreen wording); anything else lands in the field unchecked. */
  const pasteAddress = useCallback(async () => {
    const text = ((await readClipboard()) ?? '').trim();
    setPhase((p) => {
      if (p.kind !== 'typing') return p;
      return text
        ? { kind: 'typing', draft: text }
        : { kind: 'typing', draft: p.draft, error: 'Nothing to paste. Copy the address first.' };
    });
  }, []);

  /** The "go again" action on a result card, back the way the value came. */
  const againButton = (scanLabel: string, variant?: 'ghost'): React.JSX.Element =>
    entry === 'type' ? (
      <Button title="Check another" variant={variant} onPress={() => startTyping()} />
    ) : (
      <Button title={scanLabel} variant={variant} onPress={startScanning} />
    );

  /** Global verify: check every wallet sequentially; first owner wins. */
  const runGlobalVerify = useCallback(
    async (address: string) => {
      setPhase({ kind: 'checking', address });
      for (const w of wallets) {
        try {
          const engine = await getEngine(w);
          if (await engine.ownsAddress(address)) {
            setPhase({ kind: 'owned', address, wallet: w });
            return;
          }
        } catch {
          // engine unavailable for this wallet — keep checking the rest
        }
      }
      setPhase({ kind: 'globalNotOwned', address });
    },
    [wallets, getEngine],
  );

  const onScanned = useCallback(
    async (raw: string) => {
      // Global mode understands more than addresses: descriptors/xpubs route
      // to Import, PSBTs route to the owning wallet's review page.
      if (!verifyWallet) {
        const classified = classifyScan(raw);
        if (classified.kind === 'descriptor') {
          navigation.replace('Import', { prefill: classified.payload });
          return;
        }
        // Watch-only v1: the classifier recognises the PSBT but hands back no
        // payload, so say so plainly instead of dead-ending on a missing route.
        if (classified.kind === 'psbtUnsupported') {
          setPhase({ kind: 'psbtReadOnly' });
          return;
        }
        if (classified.kind === 'psbt') {
          try {
            const psbt = parsePsbt(classified.base64);
            // A wallet "owns" the PSBT when its descriptor carries any master
            // fingerprint the PSBT's inputs want signatures from.
            const owner = wallets.find((w) => {
              const fps = new Set(
                parseKeyOrigins(stripChecksum(w.descriptor).body)
                  .map((k) => k.fingerprint)
                  .filter(Boolean),
              );
              return psbt.inputFingerprints.some((fp) => fps.has(fp));
            });
            if (owner) {
              navigation.replace('PsbtReview', {
                walletId: owner.id,
                psbtBase64: classified.base64,
              });
            } else {
              setPhase({ kind: 'psbtNoMatch', fingerprints: psbt.inputFingerprints });
            }
          } catch {
            setPhase({ kind: 'invalid', raw });
          }
          return;
        }
      }

      const parsed = parseScannedAddress(raw);
      if (!parsed) {
        setPhase({ kind: 'invalid', raw });
        return;
      }
      const { address } = parsed;
      requestAmount.current = parsed.amountSats;

      if (verifyWallet) {
        setPhase({ kind: 'checking', address });
        try {
          const engine = await getEngine(verifyWallet);
          const mine = await engine.ownsAddress(address);
          setPhase(
            mine
              ? { kind: 'owned', address, wallet: verifyWallet }
              : { kind: 'notOwned', address },
          );
        } catch {
          setPhase({ kind: 'notOwned', address });
        }
        return;
      }

      // Global: don't assume intent — the user picks verify vs send. With no
      // send to offer, verifying IS the intent, so skip the question.
      if (!maySend) {
        void runGlobalVerify(address);
        return;
      }
      setPhase({ kind: 'chooseAction', address });
    },
    [verifyWallet, wallets, getEngine, navigation, runGlobalVerify, maySend],
  );

  /** Send flow: single wallet goes straight in; otherwise pick the source. */
  const startSend = useCallback(
    (address: string) => {
      if (wallets.length === 1) {
        navigation.replace('Send', { walletId: wallets[0].id, address, amountSats: requestAmount.current });
      } else {
        setPhase({ kind: 'pickSender', address });
      }
    },
    [wallets, navigation],
  );

  if (phase.kind === 'scanning') {
    return (
      <QrScanner
        ground="page"
        onScanned={onScanned}
        onCancel={() => navigation.goBack()}
        onTypeInstead={() => startTyping()}
        hint={
          verifyWallet
            ? 'Scan a Bitcoin address'
            : 'Scan an address, vault descriptor or transaction'
        }
      />
    );
  }

  if (phase.kind === 'typing') {
    // Addresses arrive with line breaks and spaces from emails and chats;
    // none of that is part of the address.
    const text = phase.draft.replace(/\s+/g, '');
    // The page's actions in its pinned footer (decided 2026-10-05); the footer
    // rises with the keyboard, so the field and Check address stay above it.
    return (
      <Screen
        scroll
        underHeader
        style={styles.typing}
        footer={
          <>
            <Button
              title="Check address"
              disabled={text.length === 0}
              onPress={() => void onScanned(text)}
            />
            <Button title="Scan instead" variant="ghost" onPress={startScanning} />
            <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }>
        <Text style={styles.pickerTitle}>
          {verifyWallet ? 'Verify an address' : 'Check an address'}
        </Text>
        {verifyWallet && (
          <Text style={styles.pickerBody}>
            Checks whether it belongs to “{verifyWallet.label}”.
          </Text>
        )}
        <TextField
          label="Bitcoin address"
          value={phase.draft}
          onChangeText={(draft) => setPhase({ kind: 'typing', draft })}
          placeholder="Paste or type the address"
          multiline
          minHeight={72}
          monospace
          autoCapitalize="none"
          error={phase.error}
          trailing={
            <TouchableOpacity
              style={styles.pasteInField}
              onPress={() => void pasteAddress()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Paste from the clipboard">
              <ClipboardIcon size={22} color={theme.colors.accent} />
            </TouchableOpacity>
          }
        />
      </Screen>
    );
  }

  if (phase.kind === 'chooseAction') {
    return (
      <Screen
        underHeader
        style={styles.centered}
        footer={
          <>
            <Button
              title="Verify ownership"
              onPress={() => void runGlobalVerify(phase.address)}
            />
            {maySend && (
              <Button
                title="Send funds to this address"
                variant="ghost"
                onPress={() => startSend(phase.address)}
              />
            )}
            <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }>
        <Text style={styles.resultTitle}>Bitcoin address</Text>
        <Text style={styles.resultBody}>What would you like to do with it?</Text>
        <Text style={[styles.mono, styles.resultAddress]} numberOfLines={2}>
          {phase.address}
        </Text>
      </Screen>
    );
  }

  if (phase.kind === 'checking') {
    return (
      <Screen underHeader style={styles.centered}>
        <ActivityIndicator color={theme.colors.gold} />
        <Text style={styles.checkingText}>Checking address…</Text>
        <Text style={styles.mono} numberOfLines={2}>
          {phase.address}
        </Text>
      </Screen>
    );
  }

  if (phase.kind === 'psbtReadOnly') {
    return (
      <ResultCard
        kind="cross"
        title="Signing isn't available yet"
        body="That code holds a transaction waiting to be signed. This version of Talia cannot sign or send. Signing arrives in a later release."
        actions={
          <>
            {againButton('Scan again')}
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }
      />
    );
  }

  if (phase.kind === 'psbtNoMatch') {
    return (
      <ResultCard
        kind="cross"
        title="No matching wallet"
        body={`This is a transaction waiting to be signed, but none of your wallets hold its keys${
          phase.fingerprints.length > 0
            ? ` (signers: ${phase.fingerprints.join(', ')})`
            : ''
        }. Import the wallet's descriptor first.`}
        actions={
          <>
            {againButton('Scan again')}
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }
      />
    );
  }

  if (phase.kind === 'invalid') {
    if (entry === 'type') {
      return (
        <ResultCard
          kind="cross"
          title="Not recognised"
          body="That is not a Bitcoin address."
          actions={
            <>
              <Button title="Try again" onPress={() => startTyping(phase.raw)} />
              <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
            </>
          }
        />
      );
    }
    return (
      <ResultCard
        kind="cross"
        title="Unrecognised QR code"
        body={
          verifyWallet
            ? "This QR code doesn't contain a Bitcoin address."
            : "This QR code isn't a Bitcoin address, wallet descriptor, or PSBT."
        }
        actions={
          <>
            {againButton('Scan again')}
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }
      />
    );
  }

  if (phase.kind === 'owned') {
    return (
      <ResultCard
        kind="tick"
        title="Address verified"
        body="This address belongs to your wallet:"
        wallet={phase.wallet}
        address={phase.address}
        actions={
          <>
            <Button title="Done" onPress={() => navigation.goBack()} />
            {againButton('Scan another', 'ghost')}
          </>
        }
      />
    );
  }

  if (phase.kind === 'globalNotOwned') {
    return (
      <ResultCard
        kind="cross"
        title="Not verified"
        body="This address does NOT belong to any of your wallets. Do not send funds expecting them to arrive in your vault."
        address={phase.address}
        // The way back first (the page's primary), the second choice under
        // it, Close last: a footer's order (decided 2026-10-05).
        actions={
          <>
            {againButton('Scan again')}
            {maySend && (
              <Button
                title="Send funds to it anyway"
                variant="ghost"
                onPress={() => startSend(phase.address)}
              />
            )}
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }
      />
    );
  }

  if (phase.kind === 'notOwned') {
    return (
      <ResultCard
        kind="cross"
        title="Not from this wallet"
        body={`This address does NOT belong to “${verifyWallet?.label ?? 'this wallet'}”. Do not send funds expecting them to arrive here.`}
        address={phase.address}
        actions={
          <>
            {againButton('Scan again')}
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }
      />
    );
  }

  // pickSender — choose which wallet funds the send
  return (
    <Screen
      scroll
      underHeader
      style={styles.pickerContent}
      footer={<Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}>
      <Text style={styles.pickerTitle}>Send from</Text>
      <Text style={styles.pickerBody}>Which wallet pays this address?</Text>
      <Text style={[styles.mono, styles.pickerAddress]}>{phase.address}</Text>
      {wallets.map((w) => (
        <TouchableOpacity
          key={w.id}
          style={styles.walletRow}
          activeOpacity={0.85}
          onPress={() =>
            navigation.replace('Send', { walletId: w.id, address: phase.address, amountSats: requestAmount.current })
          }>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <WalletIconTile
            icon={walletIconFor(w)}
            size={38}
          />
          <Text style={styles.walletName} numberOfLines={1}>
            {w.label}
          </Text>
          <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
        </TouchableOpacity>
      ))}
    </Screen>
  );
}

function ResultCard({
  kind,
  title,
  body,
  address,
  wallet,
  actions,
}: {
  kind: 'tick' | 'cross';
  title: string;
  body: string;
  address?: string;
  wallet?: WalletMeta;
  actions: React.ReactNode;
}): React.JSX.Element {
  const { settings } = useWallets();
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (!wallet || settings.btcOnly) return;
    let cancelled = false;
    getBtcPrice(settings.fiat).then((r) => !cancelled && setRate(r));
    return () => {
      cancelled = true;
    };
  }, [wallet, settings.fiat, settings.btcOnly]);

  // A result is a page: its actions in the pinned footer, the primary first
  // and Close last, as every caller hands them over (decided 2026-10-05).
  return (
    <Screen underHeader style={styles.centered} footer={actions}>
      <DrawnIcon kind={kind} ring size={88} />
      <Text style={styles.resultTitle}>{title}</Text>
      <Text style={styles.resultBody}>{body}</Text>
      {wallet && (
        <View style={styles.walletCard}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <WalletIconTile
            icon={walletIconFor(wallet)}
            size={46}
          />
          <View style={styles.walletCardBody}>
            <Text style={styles.walletCardName} numberOfLines={1}>
              {wallet.label}
            </Text>
            <Text style={styles.walletCardBalance}>
              {settings.hideBalances || wallet.balanceHidden
                ? '•••••'
                : wallet.cachedBalanceSats != null
                  ? `${formatAmount(wallet.cachedBalanceSats, settings.unit)}${
                      rate ? ` · ${formatFiat(wallet.cachedBalanceSats, rate, settings.fiat)}` : ''
                    }`
                  : 'balance unknown'}
            </Text>
          </View>
        </View>
      )}
      {address && <Text style={[styles.mono, styles.resultAddress]}>{address}</Text>}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // A result page: centred, the one place a page is (the Screen pads the gutter).
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  checkingText: { ...theme.typography.body, color: theme.colors.slate },
  mono: { ...theme.typography.mono, color: theme.colors.slate, textAlign: 'center' },

  resultTitle: { ...theme.typography.title, color: theme.colors.offWhite, textAlign: 'center' },
  walletCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    alignSelf: 'stretch',
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  walletCardBody: { flex: 1, minWidth: 0 },
  walletCardName: { ...theme.typography.heading, color: theme.colors.offWhite },
  walletCardBalance: { ...theme.typography.body, color: theme.colors.slate, marginTop: 2 },
  resultBody: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
  },
  resultAddress: { marginTop: theme.spacing.xs },

  typing: { gap: theme.spacing.md },
  pasteInField: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  pickerContent: { gap: theme.spacing.md },
  pickerTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  pickerBody: { ...theme.typography.body, color: theme.colors.slate },
  pickerAddress: { textAlign: 'left', marginBottom: theme.spacing.sm },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  walletName: { ...theme.typography.heading, flex: 1, color: theme.colors.offWhite },
}));
