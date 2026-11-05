/**
 * Register on your hardware: the ONE place a vault is shown to a signing
 * device, or a one-key vault is linked to its device (decided 2026-09-22: "we need
 * our hardware search to always be for all currently adopted hardware").
 *
 * It replaced two brand screens, the Ledger's and the BitBox's, which every
 * registration used to be routed to by a guess: a key with no device on
 * record was taken for a Ledger, so an heir holding a BitBox was searched for
 * with a Ledger-only scan. Now the device the vault recorded for the key is
 * connected straight, or the owner is asked WHICH device they are using
 * (HardwareConnect, decided 2026-10-04: device first), the search finds every
 * adopted device with the chosen one drawn unlocking, and the device layer
 * (ui/hww/connectedDevice.ts) does the brand's own ceremony.
 *
 * A device holding a different key is refused by name; one holding any key
 * of the vault is registered for that key, whichever row the owner came from.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AppDialog, AppModal, BbqrScanner, Button, HardwareConnect, Screen } from '../components';
import type { HardwarePick, StepBack } from '../components/HardwareConnect';
import type { DeviceAsk } from '../hww/deviceTurns';
import { theme, themedStyles } from '../theme';
import {
  deviceHoldsKey,
  hardwareRegistrationChecklist,
  isSingleSigVault,
  keyNameTemplate,
  registrationAsksKeyName,
  ownKeysOnThisPhone,
  ownKeysToRegister,
  singleSigKeyId,
  standardOriginPath,
  stepKeyOf,
  stepKeysOf,
  useWallets,
  vaultShapeOf,
  withKeyOrigin,
} from '../../wallet';
import type { WalletMeta } from '../../wallet/types';
import { deviceKindInfo, deviceName, modelInfo, recordFromDiscovery, recordedDevice, registeredFingerprintsOf } from '../../wallet/deviceKinds';
import type { StepKey } from '../../wallet/deviceKinds';
import { parseKeyOrigins, stripChecksum } from '../../bitcoin/descriptor';
import type { ConnectedDevice } from '../hww/connectedDevice';
import { PASSPORT_EXPORT_HINT, passportBinding } from '../hww/passportBinding';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';

type Props = NativeStackScreenProps<RootStackParamList, 'RegisterHardware'>;

type Done = { title: string; message: string };

/** The key a device has just proved, and the name to offer for it. */
type Naming = { fingerprint: string; template: string };

/** The step is on a QR device's page (the Passport's code), whose Scan the
 *  code is the page's action and sits in the footer (decided 2026-10-05). */
const onQrPage = (pick: HardwarePick): boolean =>
  pick != null && pick !== 'another' && !!deviceKindInfo(modelInfo(pick).kind)?.methods.includes('qr');

export function RegisterHardwareScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId } = route.params;
  const { getWallet, updateWallet, upgradeDescriptor } = useWallets();
  const wallet = getWallet(walletId);
  const { providerFps, settled: fpsSettled } = useProviderFingerprints(wallet);
  const [done, setDone] = useState<Done | null>(null);
  /** A turn page on the drawn device is up: the heading gives way to its. */
  const [turn, setTurn] = useState<DeviceAsk | null>(null);
  /**
   * The keys this screen can meet, each with what the vault recorded for it
   * (decided 2026-10-04, device first): the key the owner came for when a row
   * named one, else every key of theirs still to register. One known device
   * connects straight; several are listed with their devices; a vault whose
   * hardware was never connected here (an import) is asked which device
   * they are using, once.
   */
  const keys = useMemo((): StepKey[] => {
    if (!wallet) return [];
    const came = route.params.fingerprint?.toLowerCase();
    if (came) return [stepKeyOf(wallet, came, providerFps)];
    if (isSingleSigVault(wallet)) {
      const id = singleSigKeyId(wallet);
      return id ? [stepKeyOf(wallet, id, providerFps)] : [];
    }
    return stepKeysOf(wallet, ownKeysToRegister(wallet, providerFps), providerFps);
  }, [wallet, route.params.fingerprint, providerFps]);
  /**
   * The name question, asked once a device has proved a key (decided 2026-09-26:
   * "latest by the time when the user registers the vault with his hardware
   * wallet, we will know the name of the device and will use that name as the
   * template for the name. He should still be asked if he would like to
   * change the name of the key"). It sits over the finished state, so the
   * ceremony reads as done and the name is the last touch.
   */
  const [naming, setNaming] = useState<Naming | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrNote, setQrNote] = useState<{ title: string; message?: string } | null>(null);
  /** Remounts the connect step for "Register the next device". */
  const [round, setRound] = useState(0);
  /** Where the connect step is, told by the step itself. */
  const [pick, setPick] = useState<HardwarePick>(null);
  /** The step's one Back (to the device list), while the step has one: the
   *  page's footer draws it (decided 2026-10-05). */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);
  /** Devices registered on this visit: the next round lists them as done
   *  and never connects to one by itself (decided 2026-09-22: the device
   *  just registered was still advertising and was picked again). */
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());

  /** Every key fingerprint the vault's descriptor names, lowercase. */
  /**
   * Finish a connection: show what happened and ask what this key is called,
   * with the DEVICE's own name offered. A name the owner chose earlier is
   * offered instead of the device's, so a rename is never undone by a
   * re-registration.
   */
  const finish = useCallback(
    (
      keyId: string,
      deviceOwnName: string,
      outcome: Done,
      /** Milliseconds to hold the name QUESTION back, for a path that comes
       *  out of a modal: iOS swallows a dialog opened while one is closing.
       *  The finished state itself always shows at once. */
      askAfter = 0,
    ) => {
      setDone(outcome);
      // Only a key with a FINGERPRINT can be named: that is the id every
      // screen reads a key's name by. A vault imported as a bare xpub has
      // none until a device writes its origin in, which the two paths that
      // do so hand over here (decided 2026-09-26).
      const fingerprint = /^[0-9a-f]{8}$/i.test(keyId) ? keyId.toLowerCase() : null;
      if (!fingerprint) return;
      const vault = getWallet(walletId);
      const current = vault?.keyLabels?.[fingerprint];
      // Asked once, and only when the name is unknown (decided 2026-10-15): a
      // vault built here, or an import that brought its names, skips it.
      if (!registrationAsksKeyName(vault, current)) return;
      const ask = () => setNaming({ fingerprint, template: keyNameTemplate(current, deviceOwnName) });
      if (askAfter > 0) setTimeout(ask, askAfter);
      else ask();
    },
    [getWallet, walletId],
  );

  const vaultFps = useCallback((w: WalletMeta): Set<string> => {
    try {
      return new Set(
        parseKeyOrigins(stripChecksum(w.descriptor).body).flatMap((k) =>
          k.fingerprint ? [k.fingerprint.toLowerCase()] : [],
        ),
      );
    } catch {
      return new Set();
    }
  }, []);

  const deviceTask = useCallback(
    async (device: ConnectedDevice) => {
      // Read the vault fresh: another screen may have written to it since.
      const w = getWallet(walletId);
      if (!w) throw new Error('This vault is no longer on this phone.');
      const fp = device.fingerprint;
      const brand = device.brandName;

      if (isSingleSigVault(w)) {
        // A one-key vault is never registered (decided 2026-09-08): the device
        // signs its own standard account. Knowing the key lives here is the
        // whole link.
        if (singleSigKeyId(w) === fp) {
          // The fingerprint only names a seed; the KEY must be proven
          // (decided 2026-09-26). A descriptor can carry the
          // client's real fingerprint over somebody else's xpub.
          const [own] = parseKeyOrigins(stripChecksum(w.descriptor).body);
          device.setStep('Checking the key on the device…');
          const standard = Array.from({ length: 5 }, (_, account) =>
            standardOriginPath(w.descriptor, w.network, account),
          ).filter((p): p is string => p != null);
          const holds = own ? await deviceHoldsKey(device, own, w.network, standard) : false;
          if (!device.alive()) return;
          if (!holds) throw new Error(`This ${brand} holds a different key (${fp.toUpperCase()}).`);
          const rec = recordFromDiscovery(recordedDevice(w, fp), device.record);
          if (rec) await updateWallet(w.id, { keyDevices: { ...(w.keyDevices ?? {}), [fp]: rec } });
          if (!device.alive()) return;
          finish(fp, device.name, {
            title: `Linked to your ${brand}`,
            message: `"${w.label}" can now send with it.`,
          });
          return;
        }
        // A vault imported from a bare xpub has no fingerprint to match: ask
        // the device for the key at the standard account paths, and a match
        // fills the missing origin in (decided 2026-09-08).
        const [key] = parseKeyOrigins(stripChecksum(w.descriptor).body);
        if (key && !key.fingerprint) {
          device.setStep('Looking for this key on the device…');
          for (let account = 0; account < 5; account += 1) {
            const path = standardOriginPath(w.descriptor, w.network, account);
            if (!path) break;
            const xpub = await device.xpub(path, w.network);
            if (!device.alive()) return;
            if (xpub !== key.xpub) continue;
            await upgradeDescriptor(w.id, withKeyOrigin(w.descriptor, xpub, fp, path), { [fp]: device.record });
            finish(fp, device.name, {
              title: `Linked to your ${brand}`,
              message: `"${w.label}" can now send with it.`,
            });
            return;
          }
        }
        throw new Error(`This ${brand} holds a different key (${fp.toUpperCase()}).`);
      }

      if (!vaultFps(w).has(fp)) {
        throw new Error(
          vaultFps(w).size === 0
            ? 'This vault was added without the details of which keys built it, so Talia cannot match it to a device. Import it again with the full vault description.'
            : `This ${brand} holds a different key (${fp.toUpperCase()}). Connect the one holding a key of this vault; if it uses a passphrase, use the same one.`,
        );
      }
      const reg = await device.registerVault(w);
      if (!device.alive()) return;
      const rec = recordFromDiscovery(recordedDevice(w, fp), device.record);
      const next = { ...w, ...reg.patch, keyDevices: rec ? { ...(w.keyDevices ?? {}), [fp]: rec } : w.keyDevices };
      // The vault is registered once EVERY key of the phone's owner is, on
      // whichever devices (never one brand's records alone).
      const registered = registeredFingerprintsOf(next);
      const own = ownKeysOnThisPhone(next, providerFps);
      const allDone = own.length > 0 && own.every((k) => registered.has(k));
      await updateWallet(w.id, {
        ...reg.patch,
        keyDevices: next.keyDevices,
        ...(allDone ? { vaultRegisteredAt: Date.now() } : {}),
      });
      if (device.deviceId) setDoneIds((ids) => new Set([...ids, device.deviceId]));
      finish(fp, device.name, {
        title: reg.alreadyRegistered ? `Your ${brand} already knows this vault` : `Registered on your ${brand}`,
        message: `It will show "${w.label}" and its keys when it signs.`,
      });
    },
    [getWallet, walletId, updateWallet, upgradeDescriptor, providerFps, vaultFps, finish],
  );

  if (!wallet) {
    return (
      <Screen scroll>
        <Text style={styles.body}>This vault is no longer on this phone.</Text>
      </Screen>
    );
  }

  // The step waits for 21st Capital's fingerprints (decided 2026-10-04):
  // until they load, the checklist counts our co-signer as a key with no
  // record, so the step asked "Which device?" for a device the vault had
  // recorded, and the first pick is the one HardwareConnect keeps. The same
  // wait, in the same words, as Replace signing device.
  if (!fpsSettled) {
    return (
      <Screen scroll>
        <Text style={styles.body}>Reading this vault&apos;s keys…</Text>
      </Screen>
    );
  }

  const single = isSingleSigVault(wallet);
  // Anything left to register after this device? Offer the next one.
  const left = done
    ? hardwareRegistrationChecklist(wallet, providerFps).filter((i) => !i.registered && !i.heir).length
    : 0;

  const nameThisKey = naming && (
    <AppDialog
      visible
      title="Name this key"
      input={{
        label: 'Key name',
        placeholder: 'Key name',
        autoCapitalize: 'sentences',
        defaultValue: naming.template,
      }}
      actions={[
        {
          label: 'Save',
          variant: 'primary',
          requiresInput: true,
          onPress: (value) => {
            const w = getWallet(walletId);
            const name = value.trim();
            if (w && name) {
              void updateWallet(w.id, {
                keyLabels: { ...(w.keyLabels ?? {}), [naming.fingerprint]: name },
              });
            }
            setNaming(null);
          },
        },
        { label: 'Not now', variant: 'ghost', onPress: () => setNaming(null) },
      ]}
      onClose={() => setNaming(null)}
    />
  );

  if (done) {
    // The finished page's actions, pinned (decided 2026-10-05): the next device
    // first, Done last and quiet while there is a next one.
    return (
      <Screen
        scroll
        footer={
          <>
            {left > 0 && (
              <Button
                title="Register the next device"
                onPress={() => {
                  // Sent here for ONE key from the vault page's checklist: back to
                  // that list, which re-opens with this device's tick (decided
                  // 2026-10-05: "After a device is registered, the app must jump
                  // back to the checklist of all registered devices"; the next
                  // round here met the same key again).
                  if (route.params.fingerprint) {
                    navigation.goBack();
                    return;
                  }
                  setDone(null);
                  setRound((r) => r + 1);
                }}
              />
            )}
            <Button title="Done" variant={left > 0 ? 'ghost' : undefined} onPress={() => navigation.goBack()} />
          </>
        }>
        <View style={styles.block}>
          <Text style={styles.title}>{done.title}</Text>
          <Text style={styles.body}>{done.message}</Text>
        </View>
        {nameThisKey}
      </Screen>
    );
  }

  // The page's actions at the foot (decided 2026-10-05): the Passport page's Scan
  // the code, then ONE button for the way out, on every page of the step:
  // the step's Back while there is a list inside this screen to return to
  // (the keys, the devices), otherwise Cancel, which leaves as the header's
  // back does (a straight connection from the checklist, the key list, the
  // device list: decided 2026-10-05, they ended without a button while the
  // address check showed Cancel on the same page). Never both for one move.
  const scanCode = single && onQrPage(pick);
  const stepFooter = (
    <>
      {scanCode && <Button title="Scan the code" onPress={() => setQrOpen(true)} />}
      {stepBack != null ? <Button title="Back" variant="ghost" onPress={stepBack.onPress} /> : <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}
    </>
  );

  return (
    <Screen scroll footer={stepFooter}>
      <View style={styles.block}>
        {/* The heading gives way while a turn page carries its own. */}
        {turn == null && (
          <>
            <Text style={styles.title}>{single ? 'Connect your hardware' : 'Register on your hardware'}</Text>
            <Text style={styles.body}>
              {single
                ? `Link "${wallet.label}" to the device holding its key.`
                : `Each device holding a key of "${wallet.label}" has to see it once before it can sign.`}
            </Text>
          </>
        )}
        <HardwareConnect
          key={round}
          shape={vaultShapeOf(wallet)}
          purpose="register"
          network={wallet.network}
          descriptor={wallet.descriptor}
          keys={keys}
          question="Which device are you using?"
          deviceTask={deviceTask}
          usedDeviceIds={doneIds}
          usedLabel="Registered just now"
          onTurn={setTurn}
          onPick={setPick}
          onFooterBack={setStepBack}
          // The Passport's page: its line alone; Scan the code and the
          // step's Back are the footer's.
          renderQr={single ? () => <Text style={styles.body}>{PASSPORT_EXPORT_HINT}.</Text> : undefined}
        />
      </View>

      <AppModal visible={qrOpen} animationType="slide" onRequestClose={() => setQrOpen(false)}>
        <BbqrScanner
          hint={PASSPORT_EXPORT_HINT}
          onCancel={() => setQrOpen(false)}
          onComplete={(result) => {
            setQrOpen(false);
            const w = getWallet(walletId);
            if (!w) return;
            const outcome = passportBinding(w, result);
            if (outcome.kind === 'refused') {
              setTimeout(() => setQrNote({ title: outcome.title, message: outcome.message }), 450);
              return;
            }
            if (outcome.kind === 'upgrade') void upgradeDescriptor(w.id, outcome.descriptor, outcome.keyDevices);
            else void updateWallet(w.id, { keyDevices: outcome.keyDevices });
            // The finished state at once, as before; the name question after
            // the scanner's own modal has gone, since iOS cannot stack two
            // (the same 450 ms the refusal note waits).
            finish(
              outcome.keyId,
              deviceName('passport'),
              {
                title: 'Linked to your Passport',
                message: `"${w.label}" can now send. The Passport signs by QR.`,
              },
              450,
            );
          }}
        />
      </AppModal>
      {qrNote && (
        <View style={styles.block}>
          <Text style={styles.error}>{qrNote.title}</Text>
          {!!qrNote.message && <Text style={styles.body}>{qrNote.message}</Text>}
        </View>
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    block: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite },
    body: { ...theme.typography.body, color: theme.colors.slate },
    error: { ...theme.typography.heading, color: theme.colors.negative },
  }),
);
