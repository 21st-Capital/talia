/**
 * Replace signing device (decided 2026-09-08).
 *
 * A device broke, was lost, or the owner moved their seed words onto
 * different hardware. The vault is unchanged: the same key, in a new box.
 * This screen points Talia at that box, for one key of the vault the owner
 * came from.
 *
 * The whole safety of the feature is one comparison. The new device is
 * asked for the key at the SAME derivation path the vault records, and
 * unless the answer is the same extended key, nothing is saved and the
 * screen says which key the device actually holds. A different key is not
 * a replacement: the coins live at addresses built from the original key,
 * so a swap would describe a wallet with no coins in it while the coins
 * stay where they are.
 *
 * On a match the owner names the key (the device's own name is offered),
 * the binding is rewritten for THIS vault only and everything the OLD box
 * had proven about it is forgotten (see wallet/replaceDevice.ts). A shared
 * vault is then taken straight into the new Ledger's or BitBox's
 * registration ceremony, nobody is asked; a single-key vault or a Passport
 * just ends the flow. Other vaults holding the same key keep their own
 * binding and label (decided 2026-09-19).
 */
import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal, Gloss, cardGlow } from '../components';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import {
  AppDialog,
  BbqrScanner,
  Button,
  ChevronRightIcon,
  InfoHeading,
  HardwareConnect,
  Screen,
  parseKeyInput,
} from '../components';
import type { HardwarePick, StepBack } from '../components/HardwareConnect';
import { KeyDeviceTile } from '../components/KeyDeviceTile';
import { keyRowSub } from '../components/devicePickerModel';
import { deviceKindInfo, modelInfo, modelOfRecord } from '../../wallet/deviceKinds';
import type { DeviceAsk } from '../hww/deviceTurns';
import type { BbqrScanResult } from '../components';
import { theme, themedStyles } from '../theme';
import {
  deviceReplacementPatch,
  isSingleSigVault,
  registersAfterReplacement,
  replaceableKeys,
  sameExtendedKey,
  standardOriginPath,
  useWallets,
  withKeyOrigin,
  keyDisplayName,
} from '../../wallet';
import { deviceSuitsVault } from '../../wallet/deviceKinds';
import type { KeyDevice } from '../../wallet/types';
import type { ReplaceableKey } from '../../wallet/replaceDevice';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { parseColdcardExport } from '../../bitcoin/descriptor';

type Props = NativeStackScreenProps<RootStackParamList, 'ReplaceDevice'>;

/** Said on BOTH steps: a one-key vault never sees the picker, and that is
 *  the shape most clients hold (decided 2026-09-08). */
const WHAT_THIS_CHANGES =
  'Only where Talia looks for the key. The vault, its addresses and its coins are unchanged, because they come from the key itself, not from the box it sits in.\n\n' +
  'So the new device must hold the SAME key: the same seed words, and the same passphrase if you use one. Talia asks the device for the key and compares it before saving anything.\n\n' +
  'The old device is not touched. If it still holds the seed words it can still sign, so wipe it if you do not want that.';

/** What the row says about where a key lives today. The brand comes from
 *  the device registry, so a brand added later is named right here too. */
/** The device the vault knows for the key, in the words of every key list
 *  (decided 2026-10-04): the model, the brand alone, or not connected yet. */
function deviceLine(device: KeyDevice | null, fingerprint?: string | null): string {
  return keyRowSub({ model: modelOfRecord(device), kind: device?.kind ?? null, id: fingerprint });
}

/** The step is on a QR device's page (the Passport's code), whose Scan the
 *  code is the page's action and sits in the footer (decided 2026-10-05). */
const onQrPage = (pick: HardwarePick): boolean =>
  pick != null && pick !== 'another' && !!deviceKindInfo(modelInfo(pick).kind)?.methods.includes('qr');

export function ReplaceDeviceScreen({ navigation, route }: Props): React.JSX.Element {
  const { getWallet, updateWallet, upgradeDescriptor } = useWallets();
  const wallet = getWallet(route.params.walletId);
  // Wait for the list of OUR fingerprints before drawing anything: until it
  // settles the set is empty, and an empty set excludes none of our keys, so
  // the client was briefly offered ours to replace (decided 2026-09-18).
  const { providerFps, settled: fpsSettled } = useProviderFingerprints(wallet);
  const shared = wallet ? !isSingleSigVault(wallet) : false;

  const keys = useMemo(
    () => (wallet ? replaceableKeys(wallet, providerFps) : []),
    [wallet, providerFps],
  );
  /** The key being moved. One key needs no list. */
  const [picked, setPicked] = useState<string | null>(null);
  const key = keys.find((k) => k.id === picked) ?? (keys.length === 1 ? keys[0] : null);
  /** Remounts the connect step after an outcome, back to "Which device?"
   *  (decided 2026-09-19: a rejected scan used to leave a screen with only
   *  "Back"). */
  const [connectRound, setConnectRound] = useState(0);
  /** A turn page on the drawn device is up: the question gives way to its. */
  const [turn, setTurn] = useState<DeviceAsk | null>(null);
  /** Where the connect step is, told by the step itself. */
  const [pick, setPick] = useState<HardwarePick>(null);
  /** The step's one Back (to the device list), while the step has one: the
   *  page's footer draws it (decided 2026-10-05). */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);
  const resetConnect = () => setConnectRound((r) => r + 1);
  const [scanning, setScanning] = useState(false);
  /** Between Save key and the ceremony: nothing on this screen is tappable
   *  (decided 2026-09-19: the device rows came back for half a second and a
   *  tap there started a second Bluetooth search under the navigation). */
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ title: string; message?: string } | null>(null);
  /** A device has proven it holds the key; the owner names it before
   *  anything is saved (the same step a new vault uses, decided 2026-09-19). */
  const [pendingLabel, setPendingLabel] = useState<{
    row: ReplaceableKey;
    device: KeyDevice;
    proof: { fingerprint?: string; path?: string };
    /** The device's own name, the default for the label. */
    deviceName: string;
  } | null>(null);

  /**
   * The new device proved it holds this key. Before anything is saved the
   * owner names the key, exactly as a new vault asks: the device's own name
   * is the default and can be kept or changed (reported 2026-09-19: "once you
   * replace the key, the user is not shown the device name").
   */
  const askLabel = (
    row: ReplaceableKey,
    device: KeyDevice,
    proof: { fingerprint?: string; path?: string },
    deviceName: string,
  ) => {
    resetConnect();
    setScanning(false);
    // The connect flow is unmounting: let it settle before the dialog.
    setTimeout(() => setPendingLabel({ row, device, proof, deviceName }), 450);
  };

  /**
   * Bind THIS vault's key to the new hardware under the name the owner just
   * gave it, forget what the old box had proven, and fill in the origin if
   * the vault was imported as a bare key (the device just told us its
   * fingerprint and path).
   *
   * ONLY this vault (decided 2026-09-19: "maybe the user wants to use a BitBox
   * with the same key for one vault and a Ledger with the same key for
   * another vault"). Other vaults holding the key keep their own binding.
   *
   * Then, with no question asked, the vault is shown to the new device: a
   * box with the same seed almost never has the descriptor registered, so
   * the registration is assumed missing and simply done (decided 2026-09-19). A
   * single-key vault and a Passport have nothing to register, so the flow
   * just ends.
   */
  const accept = async (
    row: ReplaceableKey,
    device: KeyDevice,
    proof: { fingerprint?: string; path?: string },
    label: string,
  ) => {
    if (!wallet) return;
    setPendingLabel(null);
    setSaving(true);
    const learnsOrigin = !row.fingerprint && !!proof.fingerprint && !!proof.path;
    const newId = learnsOrigin ? proof.fingerprint!.toLowerCase() : undefined;
    if (learnsOrigin) {
      await upgradeDescriptor(wallet.id, withKeyOrigin(wallet.descriptor, row.xpub, newId!, proof.path!));
    }
    await updateWallet(
      wallet.id,
      deviceReplacementPatch(wallet, row.id, device, { sharedVault: shared, newId, label }),
    );
    // The dialog is dismissing; navigating under it is swallowed (the
    // repo's iOS modal-stacking rule), so both exits wait. A stale timer
    // must not act on whatever screen is focused by then (decided
    // 2026-09-19: a back tap inside the wait replaced or popped the vault
    // screen underneath), so each checks this screen is still in front.
    if (registersAfterReplacement(wallet, device)) {
      // The one registration screen, whatever the brand (decided 2026-09-22).
      // Replace, so Done there lands back on the vault, not here; it is told
      // the key just bound, so it connects to the device just named instead
      // of asking again.
      const bound = newId ?? row.fingerprint ?? undefined;
      setTimeout(() => {
        if (navigation.isFocused()) navigation.replace('RegisterHardware', { walletId: wallet.id, fingerprint: bound });
      }, 450);
      return;
    }
    // Only a single-key vault reaches here (a shared vault went into the
    // ceremony above), and it has exactly one key: out of the flow.
    setTimeout(() => {
      if (navigation.isFocused()) navigation.goBack();
    }, 450);
  };

  /**
   * The device did not return this vault's key. Three different situations,
   * and only one of them means the seed is wrong: a device with the SAME
   * master fingerprint holds the right seed at another account, and telling
   * that owner to restore different words would send them chasing a problem
   * they do not have (decided 2026-09-08).
   */
  const refuse = (row: ReplaceableKey, theirs: string | null) => {
    resetConnect();
    const ours = row.fingerprint;
    if (theirs && ours && theirs.toLowerCase() === ours.toLowerCase()) {
      setNote({
        title: 'Right seed, wrong account',
        message:
          'That device holds the right seed but gave the key from another account. Check that it is set up the same way it was before, including any passphrase.',
      });
      return;
    }
    setNote({
      title: 'That device holds a different key',
      message:
        (theirs
          ? `It holds ${theirs.toUpperCase()}.` +
            (ours ? ` This key is ${ours.toUpperCase()}.` : ' That is not this vault’s key.')
          : 'It does not hold this key.') +
        '\n\nThis vault only works with the key it was built with. Restore the right seed words on the device, with the passphrase if you use one.',
    });
  };

  /** The Passport shows its key export; the same parsers the import uses. */
  const onPassportScan = (row: ReplaceableKey) => (result: BbqrScanResult) => {
    setScanning(false);
    // Every outcome of a scan ends with the device chooser back (decided
    // 2026-09-19: a rejected scan used to leave a screen with only "Back").
    resetConnect();
    // A Passport speaks BC-UR, and only a BC-UR payload binds one (decided
    // 2026-09-18). A flat printed QR, another app's plain xpub code or
    // Talia's own export used to pass as "the device showed its key".
    if (result.kind !== 'text' || result.via !== 'ur') {
      setTimeout(
        () =>
          setNote({
            title: 'That did not come from a Passport',
            message: 'On the Passport: Manage Account, Connect Wallet, Sparrow, Single-sig, QR Code. It shows a moving code.',
          }),
        450,
      );
      return;
    }
    const text = result.text;
    let scanned: { xpub: string; fingerprint?: string; originPath?: string } | null = null;
    const parsed = parseKeyInput(text);
    if (parsed) {
      scanned = parsed.key;
    } else {
      const cc = parseColdcardExport(text);
      if (cc) {
        // The export carries every standard account. Take the one that IS
        // this vault's key rather than guessing from the script prefix,
        // which would refuse a legacy or nested vault out of hand.
        const acct =
          [cc.bip84, cc.bip86, cc.bip49, cc.bip44, cc.bip48_2].find(
            (a) => a != null && sameExtendedKey(a.xpub, row.xpub),
          ) ?? (wallet?.descriptor.trim().startsWith('tr(') ? cc.bip86 : cc.bip84);
        if (acct) scanned = { xpub: acct.xpub, fingerprint: cc.fingerprint, originPath: acct.originPath };
      }
    }
    setTimeout(() => {
      if (!scanned) {
        setNote({ title: 'That is not a key export' });
        return;
      }
      if (!sameExtendedKey(scanned.xpub, row.xpub)) {
        refuse(row, scanned.fingerprint ?? null);
        return;
      }
      // Right key, wrong device for this vault: a Passport speaks standard
      // scripts only, and Talia composes taproot miniscript for every
      // layered vault and every vault holding a 21st Capital key (decided
      // 2026-09-24). Replacing a Ledger with one here would leave the vault
      // unspendable, and the owner would find out at Send.
      if (!deviceSuitsVault('passport', wallet?.descriptor)) {
        setNote({
          title: 'A Passport cannot sign this vault',
          message:
            'This vault uses a recovery path or a 21st Capital key, which a Passport cannot sign. Use a Ledger or a BitBox instead.',
        });
        return;
      }
      // The scanner modal has closed by now: straight to the naming step.
      const proof = { fingerprint: scanned.fingerprint, path: scanned.originPath };
      if (!row.fingerprint && !scanned.fingerprint) {
        // Labels are filed by fingerprint, and this key has none to file a
        // name under: bind the device and ask nothing that would be thrown
        // away (decided 2026-09-19).
        void accept(row, { kind: 'passport' }, proof, '');
        return;
      }
      setPendingLabel({ row, device: { kind: 'passport' }, proof, deviceName: 'Passport' });
    }, 450);
  };

  if (wallet && !fpsSettled) {
    return (
      <Screen scroll>
        <Text style={styles.body}>Reading this vault&apos;s keys…</Text>
      </Screen>
    );
  }

  if (!wallet || keys.length === 0) {
    return (
      <Screen scroll>
        <Text style={styles.body}>This vault has no key you can move to other hardware.</Text>
      </Screen>
    );
  }

  // Step 1: which key moved. A single-key vault has nothing to choose. The
  // first list of the screen: nothing inside it to return to, so its one
  // button is Cancel, as the address check's key list (decided 2026-10-05).
  if (!key) {
    return (
      <Screen scroll footer={<Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}>
        <InfoHeading
          style={styles.question}
          title="What this changes"
          text={WHAT_THIS_CHANGES}>
          Which key moved to new hardware?
        </InfoHeading>
        {keys.map((k) => (
          <TouchableOpacity
            key={k.id}
            style={styles.keyRow}
            activeOpacity={0.85}
            onPress={() => setPicked(k.id)}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            {/* The device the key sits on now, as the device list draws it
                (decided 2026-10-04); a key on no recorded device keeps the key. */}
            <KeyDeviceTile record={k.device} />
            <View style={styles.rowBody}>
              {/* The name every other screen gives this key, so the picker
                  and the vault agree; the raw position counts our keys too
                  (decided 2026-09-26). */}
              <Text style={styles.rowTitle}>
                {k.label ?? keyDisplayName(wallet, k.fingerprint, providerFps) ?? `Key ${k.position}`}
              </Text>
              <Text style={styles.rowSub}>
                {/* Never an xpub slice: a piece of an extended key is not a
                    name, and reads like a fingerprint without being one. */}
                {deviceLine(k.device, k.fingerprint)}
              </Text>
            </View>
            <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
          </TouchableOpacity>
        ))}
      </Screen>
    );
  }

  /**
   * Where to ask the device to look. The vault's own recorded path when it
   * has one. When it does not (imported as a bare key), only a ONE-key
   * vault has a standard place to look, and the account is unknown, so the
   * standard accounts 0 to 4 are tried in turn, exactly as connecting a
   * device does. A shared vault's key has no standard path to guess, so
   * nothing is guessed and the screen says so: asking the wrong path and
   * then telling the owner of a good backup that their device holds a
   * different key is the worst answer available (decided 2026-09-08).
   */
  const recorded = key.originPath?.replace(/^m\//, '') ?? null;
  const askPaths: string[] = recorded
    ? [recorded]
    : isSingleSigVault(wallet)
      ? Array.from({ length: 5 }, (_, account) =>
          standardOriginPath(wallet.descriptor, wallet.network, account),
        ).filter((p): p is string => p != null)
      : [];

  // Step 2: which hardware it moved to, then the ceremony.
  const connecting = !saving && askPaths.length > 0;
  // The page's actions at the foot (decided 2026-10-05): the Passport page's Scan
  // the code, then ONE button for the way out while the step is on the page:
  // the step's Back while there is a list inside this screen to return to
  // (the devices, or the key picker of a vault with several keys), otherwise
  // Cancel, which leaves as the header's back does (decided 2026-10-05: the
  // device list ended without a button). Never both for one move. While the
  // key is being saved nothing is tappable (decided 2026-09-19), so no footer.
  const scanCode = connecting && onQrPage(pick);
  const stepFooter = connecting ? (
    <>
      {scanCode && <Button title="Scan the code" onPress={() => setScanning(true)} />}
      {stepBack != null ? <Button title="Back" variant="ghost" onPress={stepBack.onPress} /> : <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}
    </>
  ) : undefined;
  return (
    <Screen scroll footer={stepFooter}>
      {/* The question gives way while a turn page carries its own heading. */}
      {turn == null && (
        <>
          <InfoHeading style={styles.question} title="What this changes" text={WHAT_THIS_CHANGES}>
            Where is this key now?
          </InfoHeading>
          <Text style={styles.body}>
            {key.label ?? 'This key'}
            {key.fingerprint ? ` · ${key.fingerprint.toUpperCase()}` : ''}
          </Text>
        </>
      )}

      {askPaths.length === 0 && (
        <Text style={styles.body}>
          This vault was added without the details of which keys built it, so Talia cannot ask a
          device for the right key. Add the vault again with its full description first.
        </Text>
      )}

      {saving && <Text style={styles.body}>Saving the key…</Text>}

      {/* Which device the key moved to, from the models that can sign THIS
          vault (decided 2026-10-04, device first; a Passport only where the
          vault's script is standard), then a search for every adopted
          device with the chosen one drawn. A new box is always asked:
          nothing recorded names it yet. */}
      {connecting && (
        <HardwareConnect
          key={connectRound}
          shape={shared ? 'multi' : 'single'}
          purpose={shared ? 'register' : 'sign'}
          network={wallet.network}
          descriptor={wallet.descriptor}
          keys={[]}
          onTurn={setTurn}
          onPick={setPick}
          onFooterBack={setStepBack}
          // Several keys: the key picker is a step inside this screen, so
          // the device list's Back returns to it; one key never saw the
          // picker, so the list's one button is Cancel (decided 2026-10-05).
          onBack={keys.length > 1 ? () => setPicked(null) : undefined}
          deviceTask={async (device) => {
            device.setStep('Reading the key from the device…');
            for (const p of askPaths) {
              const xpub = await device.xpub(p, wallet.network);
              if (!device.alive()) return;
              if (!sameExtendedKey(xpub, key.xpub)) continue;
              askLabel(key, device.record, { fingerprint: device.fingerprint, path: p }, device.name);
              return;
            }
            refuse(key, device.fingerprint);
          }}
          // The Passport's page: its line alone; Scan the code and the
          // step's Back are the footer's.
          renderQr={shared ? undefined : () => <Text style={styles.body}>On the Passport: Manage Account, Connect Wallet, Sparrow, Single-sig, QR Code.</Text>}
        />
      )}

      <AppModal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <BbqrScanner
          onComplete={onPassportScan(key)}
          onCancel={() => setScanning(false)}
          hint="On the Passport: Manage Account, Connect Wallet, Sparrow, Single-sig, QR Code"
        />
      </AppModal>

      {/* Mandatory key label, the same step a new vault uses: the device's
          own name is offered and can be kept or changed (decided 2026-09-19). */}
      <AppDialog
        visible={pendingLabel != null}
        title="Name this key"
        message={
          pendingLabel
            ? `Fingerprint ${(pendingLabel.proof.fingerprint ?? pendingLabel.row.fingerprint ?? 'unknown').toUpperCase()}. Pick a name you'll recognise when signing, like "Office device".`
            : ''
        }
        input={{
          label: 'Key label (required)',
          placeholder: 'e.g. Office device',
          autoCapitalize: 'sentences',
          // The device's own name, else the name this key already carries
          // (decided 2026-09-26: the device is the template).
          defaultValue:
            pendingLabel?.deviceName ||
            (pendingLabel ? keyDisplayName(wallet, pendingLabel.row.fingerprint, providerFps) ?? '' : ''),
        }}
        actions={[
          {
            label: 'Save key',
            variant: 'primary',
            requiresInput: true,
            onPress: (label) => {
              if (pendingLabel) void accept(pendingLabel.row, pendingLabel.device, pendingLabel.proof, label);
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setPendingLabel(null) },
        ]}
        onClose={() => setPendingLabel(null)}
      />

      <AppDialog
        visible={note != null}
        title={note?.title ?? ''}
        message={note?.message}
        actions={[{ label: 'OK', onPress: () => {} }]}
        onClose={() => setNote(null)}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    question: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.md },
    body: { ...theme.typography.body, color: theme.colors.slate, marginBottom: theme.spacing.lg },
    keyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    rowSub: { ...theme.typography.caption, color: theme.colors.slate },
  }),
);
