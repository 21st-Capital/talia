/**
 * Vault registration wizard (decided 2026-07-18): a multisig/miniscript vault must
 * be REGISTERED on every hardware device that holds one of its keys, or the
 * device will refuse to sign. Users don't know it's the same descriptor for
 * all devices — so this walks them through it key by key, one confirmation
 * per device, with "skip for later" always available.
 *
 * Reached automatically after creating a multi-key vault, and any time from
 * the wallet menu ("Register on hardware").
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { landOverTab } from '../navigation/landOverTab';
import type { RootStackParamList } from '../navigation/types';
import {
  AnimatedQr,
  Button,
  Card,
  DrawnIcon,
  FOOTER_ROOM,
  KeyIcon,
  PageFooter,
  QrImage,
  StepTransition,
} from '../components';
import { theme, themedStyles } from '../theme';
import { keyDisplayName, useWallets } from '../../wallet';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import {
  parsePolicy,
  coldcardMultisigConfig,
  coldcardNamedImport,
} from '../../bitcoin/descriptor';
import { encodeBbqr, utf8ToBytes } from '../../bitcoin/bbqr';
import { exportTextToFile } from '../../platform/files';
import {
  emailDescriptorToSelf,
  shareDescriptor as shareVaultDescriptor,
} from '../../services/vaultBackup';

type Props = NativeStackScreenProps<RootStackParamList, 'RegisterVault'>;

export function RegisterVaultScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, updateWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  /** The CUSTOMER's own keys across all spending paths — 21st Capital's
   *  issued co-signer/rescue keys are excluded: the customer can't (and
   *  needn't) register the descriptor on 21C's hardware (decided 2026-07-20). */
  // HEIR keys are excluded on the OWNER's device too (decided 2026-07-27):
  // registering the descriptor on an heir's hardware would show them the
  // vault — exactly what a strict invite is meant to prevent. An heir's
  // device learns the vault when their invite unseals (their own
  // registration prompt lives there).
  const heirFps = useMemo(
    () =>
      new Set(
        wallet?.heirVault
          ? [] // the HEIR runs this wizard for their own key — exclude nothing
          : (wallet?.heirs ?? [])
              .map((h) => h.fingerprint?.toLowerCase())
              .filter((f): f is string => !!f),
      ),
    [wallet],
  );
  const { providerFps: allProviderFps } = useProviderFingerprints(wallet);
  const signers = useMemo(() => {
    if (!wallet) return [];
    try {
      // Live set + the vault's tag: an imported vault may carry no tag at
      // all, and legacy/archived 21C keys predate it — registering the
      // descriptor on OUR hardware is impossible, so they must be excluded
      // however old they are (decided 2026-07-27).
      const providerFps = allProviderFps;
      const policy = parsePolicy(wallet.descriptor);
      const label = (fp: string) => keyDisplayName(wallet, fp, providerFps) ?? fp.toUpperCase();

      // HEIR'S OWN DEVICE ONLY (decided 2026-07-27): an heir holds exactly one key
      // of this vault. Asking them to register the OWNER's key is nonsense —
      // that device isn't theirs and isn't in the room.
      if (wallet.heirVault) {
        const own = wallet.heirKeyFingerprint?.toLowerCase();
        if (own) return [{ fp: own, label: label(own) }];
        // Vaults unsealed before we recorded it: the heir's key is the one
        // behind a timelock that isn't 21st Capital's. Only safe when the
        // vault leaves exactly one candidate.
        const timelocked = new Set<string>();
        for (const path of policy.paths) {
          if (path.olderBlocks == null) continue;
          for (const group of path.groups) {
            for (const k of group.keys) {
              const fp = k.fingerprint?.toLowerCase();
              if (fp && !providerFps.has(fp)) timelocked.add(fp);
            }
          }
        }
        if (timelocked.size === 1) {
          const fp = [...timelocked][0];
          return [{ fp, label: label(fp) }];
        }
      }

      const seen = new Map<string, string>();
      for (const path of policy.paths) {
        for (const group of path.groups) {
          for (const k of group.keys) {
            const fp = k.fingerprint?.toLowerCase();
            if (fp && !providerFps.has(fp) && !heirFps.has(fp) && !seen.has(fp)) {
              seen.set(fp, label(fp));
            }
          }
        }
      }
      return [...seen.entries()].map(([fp, l]) => ({ fp, label: l }));
    } catch {
      return [];
    }
  }, [wallet, heirFps, allProviderFps]);

  const registration = useMemo(() => {
    if (!wallet) return null;
    const config = coldcardMultisigConfig(wallet.label, wallet.descriptor);
    if (config) {
      const descriptor = wallet.changeDescriptor
        ? `${wallet.descriptor}\n${wallet.changeDescriptor}`
        : wallet.descriptor;
      void descriptor; // the file carries the classic text; the QR carries JSON
      return {
        qrPayload: coldcardNamedImport(wallet.label, wallet.descriptor),
        filePayload: config,
        kind: 'multisig' as const,
        menu: 'Settings → Multisig Wallets → Import from QR',
        filename: 'register.txt',
      };
    }
    const json = coldcardNamedImport(wallet.label, wallet.descriptor);
    return {
      qrPayload: json,
      filePayload: json,
      kind: 'miniscript' as const,
      menu: 'Settings → Miniscript → Import from QR (Edge firmware)',
      filename: 'register.json',
    };
  }, [wallet]);
  // Multisig descriptors fit a single static QR (like Export Vault) unless
  // oversized; miniscript JSON stays BBQr — the flow the COLDCARD accepts.
  const staticQr =
    registration?.kind === 'multisig' && registration.qrPayload.length <= 1000
      ? registration.qrPayload
      : null;
  const frames = useMemo(
    () =>
      registration && !(registration.kind === 'multisig' && registration.qrPayload.length <= 1000)
        ? encodeBbqr(utf8ToBytes(registration.qrPayload), 'U')
        : [],
    [registration],
  );

  const finish = () => {
    // The sign ceremony's "is this vault on your hardware?" warning keys off
    // this — completing the wizard silences it (decided 2026-07-27).
    if (wallet && done) void updateWallet(wallet.id, { vaultRegisteredAt: Date.now() });
    if (route.params.fresh) {
      // Fresh creation: land inside the vault with Home beneath it.
      landOverTab('VaultsTab', [
        { name: 'WalletDetail', params: { walletId: wallet!.id } },
      ]);
    } else {
      navigation.goBack();
    }
  };


  // Keep a copy of the descriptor (decided 2026-07-21): both actions go through
  // services/vaultBackup — ONE body builder app-wide. (This screen briefly
  // had its own mailto builder; it missed the CRLF fix, so iOS Mail collapsed
  // its paragraphs into the jumble seen in a phone test 2026-07-26.)
  const emailBackupToSelf = async () => {
    if (!wallet) return;
    try {
      await emailDescriptorToSelf(wallet);
    } catch {
      // no mail app — the share sheet below still works
    }
  };

  const shareDescriptor = () => {
    if (!wallet) return;
    void shareVaultDescriptor(wallet).catch(() => {});
  };

  if (!wallet || signers.length === 0) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.muted}>Nothing to register for this vault.</Text>
      </View>
    );
  }

  const current = signers[step];
  // The natural last step of configuration: the Estate Plan, then the
  // invites. Decided 2026-09-21: invites go out only after the plan is filed,
  // "and by that time, we ALWAYS have the heirs names!". This button used to
  // open the invites directly, before any plan, so the email could only
  // greet "Hello,". The plan's success page offers the invites once it is
  // filed. Skippable: the vault page's "Secure your legacy" card asks again.
  const offersEstatePlan =
    (wallet.heirs?.length ?? 0) > 0 && (wallet.providerKeyFingerprints?.length ?? 0) > 0;

  // Device N → device N+1 → done all render through ONE StepTransition so each
  // advance slides like a screen push (decided 2026-07-24). The step's actions sit
  // in the page's pinned footer, outside the slide (decided 2026-10-05).
  const renderBody = (): React.JSX.Element => {

  if (done) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <DrawnIcon kind="tick" size={30} strokeWidth={5} />
          <Text style={styles.title}>All devices registered</Text>
        </View>
        <Text style={styles.sub}>
          Do a small test transaction before storing real funds.
        </Text>
        {/* The backup is the card's own: its line and its two ways to keep a
            copy stay together. */}
        <Card style={styles.card}>
          <Text style={styles.cardLine}>
            Keep a copy of your vault descriptor.
          </Text>
          <Button title="Email a backup to myself" variant="ghost" onPress={() => void emailBackupToSelf()} />
          <Button title="Share vault descriptor" variant="ghost" onPress={shareDescriptor} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>
        Device {step + 1} of {signers.length}
      </Text>
      <Text style={styles.title}>
        Register on “{current.label}”
      </Text>
      <Text style={styles.sub}>
        Import this vault on the device holding the “{current.label}” key. On a
        COLDCARD: {registration?.menu} (or save the file to its SD card).
      </Text>

      <Card style={styles.card}>
        {signers.map((s, i) => (
          <View key={s.fp} style={styles.signerRow}>
            <KeyIcon
              size={20}
              color={
                i < step
                  ? theme.colors.accent
                  : i === step
                    ? theme.colors.gold
                    : theme.colors.faint
              }
            />
            <Text style={styles.signerName}>{s.label}</Text>
            <Text style={[styles.signerState, i < step && styles.signerStateDone]}>
              {i < step ? 'Registered' : i === step ? 'This device' : 'Waiting'}
            </Text>
          </View>
        ))}
      </Card>

      {heirFps.size > 0 && (
        <Text style={styles.hint}>
          Your heirs&apos; keys are left out on purpose.
        </Text>
      )}

      {staticQr ? (
        <View style={styles.qrWrap}>
          <QrImage value={staticQr} size={QR_SIZE} />
        </View>
      ) : (
        <AnimatedQr frames={frames} size={QR_SIZE} />
      )}

      <Text style={styles.warn}>
        Unregistered devices will refuse to sign. You can return here any time
        from the vault menu, under Tools.
      </Text>
    </ScrollView>
  );
  };

  return (
    <View style={styles.flexOne}>
      <StepTransition
        stepKey={done ? 'done' : `device-${step}`}
        order={[...signers.map((_, i) => `device-${i}`), 'done']}
        style={styles.flexOne}>
        {renderBody()}
      </StepTransition>
      {/* Primary first, the quiet ways out last, as in every footer. */}
      <PageFooter>
        {done ? (
          offersEstatePlan ? (
            <Button
              title="Set up my Estate Plan"
              onPress={() => {
                // This exit REPLACES the screen, so finish() never runs — and
                // the vault would go on being asked "is this on your hardware?"
                // forever despite the wizard having been completed. Record it
                // here too (decided 2026-07-29).
                if (done) void updateWallet(wallet.id, { vaultRegisteredAt: Date.now() });
                navigation.replace('InheritanceSetup', {
                  walletId: wallet.id,
                  account: wallet.accountNumber,
                });
              }}
            />
          ) : (
            <Button title="Done" onPress={finish} />
          )
        ) : (
          <Button
            title={`I registered it on “${current.label}”`}
            onPress={() => {
              if (step + 1 >= signers.length) setDone(true);
              else setStep(step + 1);
            }}
          />
        )}
        {done && offersEstatePlan && <Button title="Skip for now" variant="ghost" onPress={finish} />}
        {!done && (
          <Button
            title="Export as file instead"
            variant="ghost"
            onPress={() => {
              if (!registration) return;
              const slug = wallet.label.replace(/[^A-Za-z0-9_-]+/g, '_') || 'vault';
              void exportTextToFile(`${slug}-${registration.filename}`, registration.filePayload).catch(
                () => {},
              );
            }}
          />
        )}
        {!done && <Button title="Do this later" variant="ghost" onPress={finish} />}
      </PageFooter>
    </View>
  );
}

/** The registration QR's side. */
const QR_SIZE = 240;

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  // Above the pinned footer the content ends at the footer's fade.
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: FOOTER_ROOM },
  flexOne: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  kicker: { ...theme.typography.label, color: theme.colors.slate },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  sub: { ...theme.typography.body, color: theme.colors.slate },
  hint: { ...theme.typography.caption, color: theme.colors.faint },
  cardLine: { ...theme.typography.body, color: theme.colors.slate },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  card: { gap: theme.spacing.sm },
  signerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
  signerName: { ...theme.typography.body, color: theme.colors.offWhite, flex: 1 },
  // The label sits level with the body name beside it: the body's leading,
  // written against the token (the "level with a neighbour" exception).
  signerState: { ...theme.typography.label, lineHeight: theme.typography.body.lineHeight, color: theme.colors.faint },
  signerStateDone: { color: theme.colors.accentText },
  warn: { ...theme.typography.caption, color: theme.colors.gold },
  qrWrap: { alignItems: 'center' },
}));
