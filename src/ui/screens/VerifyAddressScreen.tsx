/**
 * The address check on a screen of its own (decided 2026-10-04: "the issue with
 * the current format is that because the QR is taking a lot of space, it
 * forces the user to scroll down to find his device etc. So why not open a
 * temporary new verification screen and jump back once its done?", and "It
 * should open another page asking which device the user wants to use and
 * show the address on a separate page for the user to compare using the
 * animated HWW address verification screens. After he confirms and verifies
 * it on his device, we jump back to the QR screen and show the usual green
 * confirmation sentence").
 *
 * Opened by Receive's "Verify on Hardware" with the exact address and index
 * on show. First the question, "Which device are you using?", through the
 * one hardware step (`HardwareConnect`, device first): a vault whose keys
 * are recorded on ONE device skips it and connects straight, because the
 * question would have one answer, and the search still corrects a wrong
 * pick by discovery. Then the address, large and grouped exactly as Receive
 * shows it (`AddressChunks`, the one component both draw), over the device
 * drawn stepping through ITS OWN address pages from the videos
 * (`ui/hww/addressCheck.ts`, drawn by the turn-page machinery with the
 * press hint of design C), the search, wake and PIN turns before it as in
 * every flow.
 *
 * Two independent machines deriving the same address is the whole check (decided
 * 2026-08-26): the device computes it from its own key and shows it on its
 * own screen, the client compares. The address the device shows must equal
 * the one this screen was given. Receive cannot change that address while
 * this screen is up: it offers the check only once its first address is
 * confirmed through the engine and no scramble is in flight (its other two
 * swaps), and its ↻ holds while it is unfocused (decided 2026-10-04); the
 * pair is re-derived fresh from the engine before the device is asked, so a
 * stale cache is never blessed. When the device confirms, this screen pops
 * back to Receive by itself with the verdict in Receive's params, pinned to
 * the address it judged: Receive shows the green sentence for THAT address
 * only; a mismatch condemns the vault and blocks whatever address is on
 * show. Back, Cancel or a failure return without a verdict.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AddressChunks, Button, HardwareConnect, Screen } from '../components';
import type { HardwarePick, StepBack } from '../components/HardwareConnect';
import type { BitboxTaskContext } from '../components/HwwConnectFlow';
import type { LedgerTaskContext } from '../components/LedgerConnectFlow';
import { bitboxDevice, ledgerDevice } from '../hww/connectedDevice';
import { addressFacts } from '../hww/addressCheck';
import type { AddressVerdict } from '../hww/addressCheck';
import { bitboxRegisteredName } from '../hww/signingDevice';
import { theme, themedStyles } from '../theme';
import { addressCheckKeysOf, ownKeysOnThisPhone, stepKeysOf, useWallets, vaultShapeOf } from '../../wallet';
import { recordFromDiscovery, recordedDevice } from '../../wallet/deviceKinds';
import type { KeyDevice } from '../../wallet/types';
import { parseKeyOrigins, stripChecksum } from '../../bitcoin/descriptor';
import { bitboxAccountKeypath, bitboxPolicyBlocker, descriptorToBitboxPolicy } from '../../bitcoin/bitbox/policy';
import { REGISTER_FIRST, ledgerWalletSpecFor } from '../../bitcoin/ledger';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { getLedgerVerifiedAddress } from '../../platform/ledger';

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyAddress'>;

export function VerifyAddressScreen({ navigation, route }: Props): React.JSX.Element {
  const { walletId, address, index } = route.params;
  const { getWallet, getEngine, updateWallet } = useWallets();
  const wallet = getWallet(walletId);
  /** 21C's keys from both the vault tag and the live endpoint. */
  const { providerFps: known21C, settled: fpsSettled } = useProviderFingerprints(wallet);
  /** What the hardware step is on: unknown until it says, null while it
   *  asks which device, else the device picked or recorded. The address is
   *  the second page (decided: "show the address on a separate page"): drawn once
   *  a device is on its way, never beside the question. */
  const [pick, setPick] = useState<HardwarePick | undefined>(undefined);
  /** The step's one Back (to the key list, or the device list), while the
   *  step has one; the footer draws it, or this screen's Cancel without it. */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);

  /** Every key the vault's own description names: a device holding one of
   *  them can show its addresses, whichever brand it is. */
  const vaultKeyIds = useMemo(() => {
    if (!wallet) return new Set<string>();
    try {
      return new Set(parseKeyOrigins(stripChecksum(wallet.descriptor).body).flatMap((k) => (k.fingerprint ? [k.fingerprint.toLowerCase()] : [])));
    } catch {
      return new Set<string>();
    }
  }, [wallet]);
  /** The owner's own keys with what the vault recorded for each (decided
   *  2026-10-04: "the address verification should only list KNOWN keys from
   *  the user"): one known device connects straight, several are listed
   *  with their devices, and only a vault nothing was ever recorded for is
   *  asked which device. Our keys are never among them, and neither is a
   *  key on a Ledger that cannot show this vault's addresses (a shared
   *  vault never registered on it, `addressCheckKeysOf`; decided
   *  2026-10-04: its row ended in "Register this vault first"). */
  const ownKeyIds = useMemo(() => (wallet ? ownKeysOnThisPhone(wallet, known21C) : []), [wallet, known21C]);
  /** Only keys whose hardware THIS phone recorded (decided 2026-10-04, a 2-of-2
   *  with our co-signer listing "Key 2 / Not connected yet": "Co-signers
   *  can't be listed here!!", and "if the user is left with only one key on
   *  the address verification list of devices, there is no point for a list
   *  to be displayed"): a key with no record may be ours before our
   *  fingerprints arrive, or an heir's, and none of those can show this
   *  vault's address on the owner's device. One such key = straight to its
   *  device. A vault with nothing recorded at all still asks which device. */
  const checkKeyIds = useMemo(() => {
    if (!wallet) return [];
    const recorded = ownKeyIds.filter((id) => recordedDevice(wallet, id) != null);
    return recorded.length > 0 ? recorded : ownKeyIds;
  }, [wallet, ownKeyIds]);
  const ownKeys = useMemo(() => (wallet ? stepKeysOf(wallet, addressCheckKeysOf(wallet, checkKeyIds), known21C) : []), [wallet, checkKeyIds, known21C]);
  /** Every key of the owner's sits on such a Ledger: the step would offer
   *  the bare list for a vault that is known and end in the same refusal. */
  const registerFirst = checkKeyIds.length > 0 && ownKeys.length === 0;

  /** The device just proved it holds this key: remember where the key
   *  lives, and which model it is (a record kept as a bare brand learns it). */
  const rememberDevice = useCallback(
    (fp: string, record: KeyDevice) => {
      const w = getWallet(walletId);
      if (!w) return;
      const rec = recordFromDiscovery(recordedDevice(w, fp), record);
      if (rec) void updateWallet(w.id, { keyDevices: { ...(w.keyDevices ?? {}), [fp]: rec } });
    },
    [getWallet, walletId, updateWallet],
  );

  /** The address this screen was given must still be the engine's at that
   *  index: re-derived fresh, because a stale cache shown as "verified"
   *  would be worse than no check at all. */
  const confirmFresh = useCallback(async () => {
    if (!wallet) throw new Error('This vault is no longer on this phone.');
    const engine = await getEngine(wallet);
    const fresh = await engine.getReceiveAddress(index);
    if (fresh.address !== address) {
      throw new Error('The shown address could not be confirmed. Go back and open this address again.');
    }
  }, [wallet, getEngine, index, address]);

  /** Back to Receive with the verdict, pinned to the address it judged. */
  const finish = useCallback(
    (verdict: AddressVerdict) => {
      navigation.popTo('Receive', { walletId, verdict }, { merge: true });
    },
    [navigation, walletId],
  );

  const bitboxTask = useCallback(
    async (ctx: BitboxTaskContext) => {
      if (!wallet) throw new Error('This vault is no longer on this phone.');
      // A device outside this vault must fail by name. Judged on the
      // vault's own keys, never on which brand a key was recorded on: a key
      // on no record is still this vault's.
      if (!vaultKeyIds.has(ctx.fingerprint)) {
        throw new Error(`This BitBox holds a different key (${ctx.fingerprint.toUpperCase()}). Connect the device holding a key of this vault.`);
      }
      await confirmFresh();
      const blocker = bitboxPolicyBlocker(wallet.descriptor);
      if (blocker) throw new Error(blocker);
      // Registered through the one device layer (2026-10-04), so the moment
      // the device asks for the vault's approval reaches the flow from one
      // place; the record of the ceremony is kept so the setup screen's
      // badge speaks the truth (keyDevices only says where the key lives).
      const reg = await bitboxDevice(ctx).registerVault(wallet);
      if (!ctx.alive()) return;
      // The simple single-sig shape has no policy to derive under; its
      // BitBox check comes with the simple-config FFI later. The registry
      // never offers it meanwhile.
      if (reg.standard) throw new Error('A BitBox cannot show the addresses of a one-key vault in Talia yet.');
      if (!reg.alreadyRegistered) void updateWallet(wallet.id, reg.patch);
      const policy = descriptorToBitboxPolicy(wallet.descriptor, wallet.label);
      const account = bitboxAccountKeypath(policy.keys, ctx.fingerprint);
      if (!account) throw new Error(`This BitBox holds a different key (${ctx.fingerprint.toUpperCase()}).`);
      const testnet = wallet.network !== 'bitcoin';
      // The device's turn: the address shown for the comparison, drawn from
      // these facts; the name is the one the BitBox STORED, never today's
      // label (it matches a registered policy by its script alone).
      const storedName = reg.alreadyRegistered ? bitboxRegisteredName(wallet.bitboxRegistrations, ctx.fingerprint) : policy.name;
      ctx.setStep('Check the address on the BitBox’s screen against the one above, then tap the top right edge.', 'address', undefined, addressFacts(wallet, address, storedName, 'bitbox'));
      const shown = await ctx.session.policyAddress(testnet, policy, `${account}/0/${index}`, true);
      if (!ctx.alive()) return;
      rememberDevice(ctx.fingerprint, bitboxDevice(ctx).record);
      finish({ kind: shown === address ? 'match' : 'mismatch', address, device: 'bitbox' });
    },
    [wallet, vaultKeyIds, confirmFresh, updateWallet, address, index, rememberDevice, finish],
  );

  const ledgerTask = useCallback(
    async (ctx: LedgerTaskContext) => {
      if (!wallet) throw new Error('This vault is no longer on this phone.');
      // The wrong Ledger of a household must fail by name.
      if (!vaultKeyIds.has(ctx.deviceFingerprint)) {
        throw new Error(
          `This Ledger holds a different key (${ctx.deviceFingerprint.toUpperCase()}). Connect the device holding a key of this vault. If it uses a passphrase, enter the same passphrase.`,
        );
      }
      await confirmFresh();
      const spec = ledgerWalletSpecFor(wallet.descriptor, wallet.label, wallet.ledgerRegistrations?.[ctx.deviceFingerprint]);
      if ('blocker' in spec) throw new Error(spec.blocker);
      // The device's turn: the address shown for the comparison, drawn from
      // these facts, with the name the vault was registered under on this
      // Ledger (none for a plain one-key vault); the kit's own
      // 'verify-address' prompt that follows draws the same.
      const name = spec.spec.kind === 'registered' ? spec.spec.name : null;
      ctx.setStep('Check the address on the Ledger’s screen against the one above, then confirm there.', 'address', undefined, addressFacts(wallet, address, name, 'ledger'));
      const shown = await getLedgerVerifiedAddress(ctx.sessionId, spec.spec, index, false, ctx.onPrompt);
      if (!ctx.alive()) return;
      rememberDevice(ctx.deviceFingerprint, ledgerDevice(ctx).record);
      finish({ kind: shown === address ? 'match' : 'mismatch', address, device: 'ledger' });
    },
    [wallet, vaultKeyIds, confirmFresh, address, index, rememberDevice, finish],
  );

  if (!wallet) {
    return (
      <Screen scroll>
        <Text style={styles.body}>This vault is no longer on this phone.</Text>
      </Screen>
    );
  }

  // The step waits for 21st Capital's fingerprints (decided 2026-10-04):
  // until they load, our co-signer counts as a key of the owner's with no
  // record, so the step would ask "Which device?" for a device the vault
  // had recorded, and HardwareConnect keeps its first pick. The same wait,
  // in the same words, as Register and Replace.
  if (!fpsSettled) {
    return (
      <Screen scroll>
        <Text style={styles.body}>Reading this vault&apos;s keys…</Text>
      </Screen>
    );
  }

  if (registerFirst) {
    return (
      <Screen scroll style={styles.content} footer={<Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}>
        <Text style={styles.body}>{REGISTER_FIRST}</Text>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      style={styles.content}
      // ONE button at the foot (decided 2026-10-05, a screenshot of this page
      // with Back and Cancel stacked mid-page): the step's Back while there
      // is a step inside this screen to return to (the key list, the device
      // list), otherwise Cancel, which leaves without a verdict as the
      // header's back does. Never both for one move.
      footer={stepBack != null ? <Button title="Back" variant="ghost" onPress={stepBack.onPress} /> : <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}>
      {/* The address to compare, once a device is on its way: large and
          grouped exactly as Receive shows it, ABOVE the device (the turn's
          line says "the one above"). */}
      {pick != null && (
        <View style={styles.addressBlock}>
          <Text style={styles.addressLabel}>YOUR ADDRESS</Text>
          <AddressChunks address={address} />
        </View>
      )}
      <HardwareConnect
        shape={vaultShapeOf(wallet)}
        purpose="address"
        network={wallet.network}
        descriptor={wallet.descriptor}
        // This vault's own keys with their devices: no question when the
        // vault knows (decided 2026-09-23, 2026-10-04: one device connects
        // straight, several are listed as the keys that sit on them), and
        // the device drawn unlocking while the search runs.
        keys={ownKeys}
        question="Which device are you using?"
        bitboxTask={bitboxTask}
        ledgerTask={ledgerTask}
        onPick={setPick}
        onFooterBack={setStepBack}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.lg },
    body: { ...theme.typography.body, color: theme.colors.slate },
    addressBlock: { gap: theme.spacing.xs },
    addressLabel: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.5 },
  }),
);
