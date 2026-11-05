/**
 * Create a VIRTUAL VAULT (the chosen name, 2026-08-25: "it's not a wallet"): a
 * holding Talia does not watch on-chain, whose balance the owner keeps by
 * hand. Code identifiers keep the `manual` naming; user-facing copy always
 * says "virtual vault".
 *
 * The only thing asked for is a name. Everything else about a normal wallet —
 * descriptor, network, keys — is meaningless here, and asking for any of it
 * would suggest this wallet is something it is not.
 */
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppModal, Gloss, cardGlow } from '../components';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { AppDialog, BbqrScanner, Button, Screen, TextField } from '../components';
import { bytesToUtf8 } from '../../bitcoin/bbqr';
import { useWallets, parseManualVault, saveManualEntries } from '../../wallet';
import { MAX_NAME_LENGTH } from '../../wallet';
import { pickTextFile } from '../../platform/files';

type Props = NativeStackScreenProps<VirtualStackParamList, 'ManualWalletSetup'>;

export function ManualWalletSetupScreen({ navigation }: Props): React.JSX.Element {
  const { addWallet, removeWallet, touchManualVault } = useWallets();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [dropNote, setDropNote] = useState<{ walletId: string; dropped: number } | null>(null);
  const [scanning, setScanning] = useState(false);

  /** Shared import path (file and QR): parse → new vault + entries. Entries
   *  are written BEFORE navigating; if that write fails the half-made vault
   *  is removed rather than left sitting empty. */
  const importContent = async (content: string, transport: 'file' | 'qr'): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const parsed = parseManualVault(content);
      const wallet = await addWallet({
        label: name.trim() || parsed.name,
        descriptor: '',
        network: 'bitcoin',
        kind: 'unknown',
        source: 'generic',
        transport,
        manual: true,
        icon: parsed.icon,
      });
      try {
        await saveManualEntries(wallet.id, parsed.entries);
        touchManualVault(wallet.id);
      } catch (e) {
        await removeWallet(wallet.id);
        throw e;
      }
      if (parsed.droppedEntries > 0) {
        // Imperfect source: land on the vault, but say what was lost.
        setDropNote({ walletId: wallet.id, dropped: parsed.droppedEntries });
        setBusy(false);
        return;
      }
      navigation.replace('ManualWallet', { walletId: wallet.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import this.');
      setBusy(false);
    }
  };

  const importFromFile = async (): Promise<void> => {
    setError(undefined);
    try {
      const file = await pickTextFile();
      if (!file) return; // user cancelled
      await importContent(file.content, 'file');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const wallet = await addWallet({
        label: name.trim() || 'Portfolio',
        // No descriptor: nothing is watched. `manual` is what every other
        // layer checks — see WalletMeta.manual.
        descriptor: '',
        // Mainnet as a formality; a manual wallet never touches a network.
        network: 'bitcoin',
        kind: 'unknown',
        source: 'generic',
        transport: 'created',
        manual: true,
        // No category: a new portfolio lands under "Other" on the Portfolio
        // tab until the owner files it under a section in Arrange.
      });
      // replace, not navigate: going "back" to the setup form after the
      // wallet exists would offer to create a second one.
      navigation.replace('ManualWallet', { walletId: wallet.id });
    } catch {
      setError('Could not create the portfolio. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      // The page's actions, pinned at the foot (decided 2026-10-05): create
      // first, then the three other ways in as quiet choices.
      footer={
        <>
          <Button title="Create portfolio" onPress={() => void create()} loading={busy} disabled={busy} />
          <Button
            title="Scan a portfolio QR"
            variant="ghost"
            onPress={() => setScanning(true)}
            disabled={busy}
          />
          <Button
            title="Import from a file"
            variant="ghost"
            onPress={() => void importFromFile()}
            disabled={busy}
          />
          {/* A portfolio someone else shared (decided 2026-09-12): join by code. */}
          <Button
            title="Join a shared portfolio"
            variant="ghost"
            onPress={() => navigation.navigate('ClaimSharedPortfolio')}
            disabled={busy}
          />
        </>
      }>
      <View style={styles.body}>
        <Text style={styles.title}>
          New portfolio
        </Text>
        <Text style={styles.lede}>
          All your buys and sells in one place, from any exchange or wallet.
        </Text>

        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="My portfolio"
          autoCapitalize="sentences"
          error={error}
          maxLength={MAX_NAME_LENGTH}
          hint={name.length >= MAX_NAME_LENGTH ? `Up to ${MAX_NAME_LENGTH} characters` : undefined}
        />

        <View style={styles.note}>
          <Gloss radius={theme.radius.md} strength={cardGlow()} />
          <Text style={styles.noteTitle}>
            A portfolio does not update itself
          </Text>
          <Text style={styles.noteText}>
            You record each buy and sell. A vault or an exchange can fill it in
            for you, from the menu once it is made.
          </Text>
        </View>
      </View>

      <AppModal
        visible={scanning}
        animationType="slide"
        onRequestClose={() => setScanning(false)}>
        <BbqrScanner
          hint="Point the camera at the QR on the other phone. Animated codes are read frame by frame."
          onCancel={() => setScanning(false)}
          onComplete={(result) => {
            setScanning(false);
            const content =
              result.kind === 'bbqr' ? bytesToUtf8(result.bytes) : result.text;
            void importContent(content, 'qr');
          }}
        />
      </AppModal>

      <AppDialog
        visible={dropNote != null}
        title="Imported with gaps"
        message={
          dropNote
            ? `${dropNote.dropped === 1 ? 'One entry' : `${dropNote.dropped} entries`} in the file ${dropNote.dropped === 1 ? 'was' : 'were'} damaged and could not be imported. Everything else is in. Check the history against your records.`
            : ''
        }
        actions={[
          {
            label: 'Open the portfolio',
            onPress: () => {
              const id = dropNote!.walletId;
              setDropNote(null);
              navigation.replace('ManualWallet', { walletId: id });
            },
          },
        ]}
        onClose={() => {
          if (dropNote) {
            const id = dropNote.walletId;
            setDropNote(null);
            navigation.replace('ManualWallet', { walletId: id });
          }
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // The Screen keeps the footer's room clear; no bottom padding of its own.
  body: { gap: theme.spacing.lg },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  lede: { ...theme.typography.body, color: theme.colors.slate },
  note: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  noteTitle: { ...theme.typography.heading, color: theme.colors.gold },
  noteText: { ...theme.typography.caption, color: theme.colors.slate },
}));
