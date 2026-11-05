/**
 * Claim an heir invite (design settled 2026-07-24).
 *
 * The heir enters the code from their invite email (or arrives via the
 * talia://invite/CODE deep link). Claiming binds the invite to their 21C
 * account and opens the SEALED CARD — vault name, their role, which key
 * unlocks it, and (strict mode) the countdown. Nothing else: the descriptor
 * is not on the device.
 *
 * Activation = scanning their own hardware key. Decrypting the descriptor
 * with a key derived from their xpub IS the proof of possession — wrong key,
 * no vault. On success the vault installs as an ordinary watch-only wallet
 * with full rights ("everything or nothing", decided 2026-07-24). In strict mode
 * the descriptor blob only exists here after the server releases it at the
 * heir timelock — until then this screen shows the countdown and polls.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { landOverTab } from '../navigation/landOverTab';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import {
  Screen,
  Card,
  Button,
  TextField,
  AppDialog,
  AuthSheet,
  InfoHeading,
  KeyIcon,
} from '../components';
import { KeyEntrySheet, parseKeyInput } from '../components/KeyEntrySheet';
import { isSingleSigOnlyExport } from '../components/hwwDevices';
import type { DialogAction } from '../components';
import { theme, themedStyles } from '../theme';
import { knownDevicesFor, useWallets } from '../../wallet';
import { heirSideKeyLabels } from '../../wallet/heirKeyLabels';
import { deviceCan } from '../../wallet/deviceKinds';
import type { KeyDevice } from '../../wallet/types';
import { parseColdcardExport, validateForImport } from '../../bitcoin/descriptor';
import { claimedMessage, notReleasedLine } from '../../wallet/sealedInviteCopy';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { normalizeInviteCode, openCard, openDescriptor } from '../../crypto/envelope';
import type { DescriptorPayload, InviteCard } from '../../crypto/envelope';
import {
  claimInvite,
  fetchClaimedInvites,
  loadInviteCode,
  loadVisibleClaimedInvites,
  reconcileClaimedInvites,
  removeClaimedInvite,
  saveClaimedInvite,
  storeInviteCode,
} from '../../services/heirInvite';
import type { ClaimedInviteRecord } from '../../services/heirInvite';
import { knownNetwork, UNKNOWN_NETWORK_REFUSED } from '../../bitcoin/network';
import { HWW_ENABLED, SIGNING_ENABLED } from '../../config';

type Props = NativeStackScreenProps<RootStackParamList, 'ClaimInvite'>;

/** The dialog for a released vault that could not be opened. A network
 *  Talia does not know is said in the title, with nothing under it: a
 *  dialog is a title and buttons (decided 2026-09-02). */
function openFailed(e: unknown): { title: string; message?: string } {
  const message = (e as Error).message;
  return message === UNKNOWN_NETWORK_REFUSED
    ? { title: UNKNOWN_NETWORK_REFUSED }
    : { title: 'Could not open the vault', message };
}

export function ClaimInviteScreen({ route, navigation }: Props): React.JSX.Element {
  const { addWallet, wallets } = useWallets();

  const [codeInput, setCodeInput] = useState(route.params?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<ClaimedInviteRecord[]>([]);
  const [released, setReleased] = useState<Record<string, string>>({}); // inviteId → descriptor ct
  const [releaseAts, setReleaseAts] = useState<Record<string, string | null>>({});
  const [scanFor, setScanFor] = useState<ClaimedInviteRecord | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [removing, setRemoving] = useState<ClaimedInviteRecord | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message?: string; actions?: DialogAction[] } | null>(null);

  const refresh = useCallback(async (sessionArg?: CompanySession | null) => {
    const session = sessionArg ?? (await loadSession());
    // Only THIS account's sealed cards, ever — a phone hosts several
    // accounts in turn (decided 2026-07-26).
    setClaimed(await loadVisibleClaimedInvites(session?.email));
    try {
      // A claimed strict invite is useless without a live session at release
      // time — surface the login instead of silently never delivering.
      setNeedsLogin(!session);
      if (!session) return;
      // Rebuilds cards lost to storage, stamps legacy ones, drops the gone.
      setClaimed(await reconcileClaimedInvites(session));
      const server = await fetchClaimedInvites(session);
      const rel: Record<string, string> = {};
      const ras: Record<string, string | null> = {};
      for (const s of server) {
        ras[s.id] = s.releaseAt;
        if (s.descriptorReleased && s.descriptorCiphertext) rel[s.id] = s.descriptorCiphertext;
      }
      setReleased(rel);
      setReleaseAts(ras);
    } catch {
      // offline — the local sealed cards still show
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = navigation.addListener('focus', () => void refresh());
    return unsub;
  }, [navigation, refresh]);

  // Deep-link arrivals while the screen is open.
  useEffect(() => {
    if (route.params?.code) setCodeInput(route.params.code);
  }, [route.params?.code]);

  /** The device that proved the heir's key in this activation, if any. */
  const provenDeviceRef = useRef<{ fp: string; device: KeyDevice } | null>(null);
  const heirKeyDevices = (expected: string | undefined): Record<string, KeyDevice> | undefined => {
    const fp = expected?.toLowerCase();
    if (!fp) return undefined;
    const proven = provenDeviceRef.current;
    if (proven && proven.fp === fp) return { [fp]: proven.device };
    const known = knownDevicesFor([fp], wallets);
    return Object.keys(known).length > 0 ? known : undefined;
  };

  /**
   * A taproot vault whose internal key is not proven unspendable: one key
   * spends it alone (decided 2026-09-26). The same question the
   * Import screen asks, same title and buttons; dismissing it is a no.
   * AppDialog fires onClose before an action's onPress, so a dismissal is
   * settled a tick later, after any action has answered.
   */
  const keyPathAnswerRef = useRef<((go: boolean) => void) | null>(null);
  const askKeyPathSpender = () =>
    new Promise<boolean>((resolve) => {
      keyPathAnswerRef.current = (go) => {
        keyPathAnswerRef.current = null;
        resolve(go);
      };
      setDialog({
        title: 'One key can spend this vault alone',
        actions: [
          {
            label: 'Import anyway',
            variant: 'primary',
            destructive: true,
            onPress: () => keyPathAnswerRef.current?.(true),
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => keyPathAnswerRef.current?.(false) },
        ],
      });
    });

  /** Validate + install the released vault; shared by every activation path. */
  const installVault = async (payload: DescriptorPayload, rec: ClaimedInviteRecord) => {
    // A network the phone does not know is refused, never guessed. An
    // invite sealed while the owner's vault was on Signet reads as Testnet4,
    // where that vault moved (knownNetwork).
    const network = knownNetwork(payload.network);
    if (!network) throw new Error(UNKNOWN_NETWORK_REFUSED);
    const validated = validateForImport(payload.descriptor, { network });
    if (!validated.ok) {
      throw new Error(validated.message ?? 'The released vault could not be read.');
    }

    // Re-activation (e.g. a re-claim after the vault was installed) must
    // not create a twin on the home screen.
    const existing = wallets.find((w) => w.descriptor === validated.parsed.raw);
    let installedId = existing?.id;
    if (!existing && validated.keyPathSpender && !(await askKeyPathSpender())) {
      // Not installed; the invite stays claimed, so it can be opened later.
      return;
    }
    if (!existing) {
      const added = await addWallet({
        label: payload.vaultLabel,
        descriptor: validated.parsed.raw,
        changeDescriptor: payload.changeDescriptor,
        network: validated.network,
        kind: validated.parsed.kind,
        source: validated.source,
        transport: 'qr',
        // Invites sent before the owner's phone renamed them.
        keyLabels: heirSideKeyLabels(payload.keyLabels),
        providerKeyFingerprints: payload.providerKeyFingerprints,
        heirVault: true,
        // Their OWN key — the only device they'll ever be asked to register.
        heirKeyFingerprint: rec.expectedFingerprint?.toLowerCase(),
        // The device that just proved the key over Bluetooth, else one this
        // phone already knows for it (decided 2026-09-22: it used to be thrown
        // away, and every later step took the key for a Ledger).
        keyDevices: heirKeyDevices(rec.expectedFingerprint),
      });
      installedId = added.id;
    }
    await removeClaimedInvite(rec.inviteId);
    await refresh();
    // Registration is offered only for a key a supported device just proved
    // (or one this phone already knows). A key handed over by QR, paste or
    // file from other hardware has nothing the search could ever find
    // (decided 2026-09-22); the vault page still offers it later.
    const heirFp = rec.expectedFingerprint?.toLowerCase();
    const heirDevice = heirFp ? heirKeyDevices(heirFp)?.[heirFp] : undefined;
    const canRegister = heirDevice != null && deviceCan(heirDevice.kind, 'multi', 'register');
    // Title and buttons only (decided 2026-09-22). "Your key's path opens
    // after a waiting period" was false for a sealed invite, released only
    // once a path had opened, and said whose key a path holds; the vault
    // page's recovery-path notice states the real state instead (found
    // 2026-09-22 before that: an heir on the everyday path of a 2-of-3 was
    // told to wait for a timelock).
    setDialog({
      title: existing ? 'This vault is already on your home screen' : 'The vault is on your home screen',
      actions:
        // Without the signing-device screen there is nowhere to send them
        // (App Store build), so the vault simply lands on the home screen.
        !existing && rec.access === 'key' && canRegister && (SIGNING_ENABLED || HWW_ENABLED)
          ? [
              {
                label: 'Register on my hardware',
                variant: 'primary',
                onPress: () => {
                  const w = installedId;
                  // The one registration screen: it searches for EVERY
                  // adopted device (decided 2026-09-22), never a Ledger alone.
                  if (w) {
                    navigation.replace('RegisterHardware', {
                      walletId: w,
                      fingerprint: rec.expectedFingerprint?.toLowerCase(),
                    });
                  } else {
                    navigation.goBack();
                  }
                },
              },
              { label: 'Skip for now', variant: 'ghost', onPress: goHome },
            ]
          : [{ label: 'Done', variant: 'primary', onPress: goHome }],
    });
  };

  /** Keyless (access 'code'): the code alone opens the vault — no scan. */
  const openKeyless = async (rec: ClaimedInviteRecord, code: string, descriptorCt: string) => {
    const card: InviteCard = {
      v: 1,
      access: 'code',
      vaultLabel: rec.vaultLabel,
      heirName: rec.heirName,
      network: rec.network,
      mode: rec.mode,
    };
    await installVault(openDescriptor(code, card, null, descriptorCt), rec);
  };

  const openKeylessFromList = async (rec: ClaimedInviteRecord) => {
    setBusy(true);
    try {
      const code = await loadInviteCode(rec.inviteId);
      if (!code) {
        throw new Error(
          'The invite code is no longer on this device. Claim the invite again with the code from your email.',
        );
      }
      const descriptorCt = released[rec.inviteId];
      if (!descriptorCt) throw new Error('The vault has not been released yet.');
      await openKeyless(rec, code, descriptorCt);
    } catch (e) {
      setDialog(openFailed(e));
    } finally {
      setBusy(false);
    }
  };

  /** The home screen, where every vault and every sealed invite card
   *  lives. A reset, not a goBack: this screen can be the deep-link entry
   *  point with nothing underneath it. */
  const goHome = () =>
    landOverTab('VaultsTab');

  const doClaim = async (session?: CompanySession | null) => {
    const normalized = normalizeInviteCode(codeInput);
    if (!normalized) {
      setDialog({
        title: 'That code doesn’t look right',
        message: 'An invite code looks like TALIA-XXXXX-XXXXX-XXXXX-XXXXX. Check the email again.',
      });
      return;
    }
    setBusy(true);
    try {
      const s = session ?? (await loadSession());
      if (!s) {
        setAuthOpen(true);
        return;
      }
      const result = await claimInvite(s, codeInput);
      const card: InviteCard = openCard(codeInput, result.cardCiphertext);
      const record: ClaimedInviteRecord = {
        inviteId: result.id,
        claimedByEmail: s.email?.toLowerCase(),
        access: card.access === 'code' ? 'code' : 'key',
        vaultLabel: card.vaultLabel,
        heirName: card.heirName,
        expectedFingerprint: card.expectedFingerprint?.toLowerCase(),
        heirOriginPath: card.heirOriginPath,
        network: card.network,
        mode: card.mode,
        innerSaltB64: card.innerSaltB64,
        cardCiphertext: result.cardCiphertext,
        releaseAt: result.releaseAt,
        claimedAt: Date.now(),
      };
      await saveClaimedInvite(record);
      await storeInviteCode(result.id, codeInput);
      const enteredCode = codeInput;
      setCodeInput('');
      if (result.descriptorReleased && result.descriptorCiphertext) {
        setReleased((r) => ({ ...r, [result.id]: result.descriptorCiphertext as string }));
        if (record.access === 'code') {
          // Keyless: there is nothing more to prove — open it right away.
          try {
            await openKeyless(record, enteredCode, result.descriptorCiphertext);
            return;
          } catch (e) {
            setDialog(openFailed(e));
            return;
          }
        }
      }
      await refresh();
      // The claim WORKED and deserves saying so, then home, where the
      // sealed vault card now sits (decided 2026-09-01).
      setDialog({
        title: 'Invite claimed',
        // A waiting period only for a countdown invite (decided 2026-09-22).
        message: claimedMessage(record),
        actions: [{ label: 'OK', variant: 'primary', onPress: goHome }],
      });
    } catch (e) {
      // Expired, mistyped, or already-used codes all land here with the
      // server's plain reason.
      setDialog({ title: 'This invite could not be claimed', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** The heir scanned their key export — try to open the vault with it. */
  const onKeyScanned = async (rec: ClaimedInviteRecord, raw: string) => {
    setScanFor(null);
    setBusy(true);
    try {
      const code = await loadInviteCode(rec.inviteId);
      if (!code) {
        throw new Error(
          'The invite code is no longer on this device. Claim the invite again with the code from your email.',
        );
      }
      const descriptorCt = released[rec.inviteId];
      if (!descriptorCt) throw new Error('The vault has not been released yet.');
      const expectedFp = (rec.expectedFingerprint ?? '').toLowerCase();
      if (!expectedFp) throw new Error('This invite is not locked to a key.');

      // Which xpub? A Coldcard export carries several. Fingerprint mismatch
      // gets a precise message BEFORE any crypto; slot choice is NOT trusted
      // to a string compare: decrypting decides (it proves the right PUBLIC
      // key, not the device; crypto/envelope.ts), so every plausible
      // account gets a try (notation differs across devices: 86h vs 86').
      const canonPath = (p?: string) =>
        (p ?? '').trim().toLowerCase().replace(/h/g, "'").replace(/^m\//, '');
      let candidates: string[] = [];
      let fromColdcard = false;
      let singleSigOnly = false;
      const cc = parseColdcardExport(raw);
      if (cc) {
        fromColdcard = true;
        singleSigOnly = isSingleSigOnlyExport(cc);
        if (cc.fingerprint.toLowerCase() !== expectedFp) {
          throw new Error(
            `This is the wrong device. The invite is locked to the key with fingerprint ${expectedFp.toUpperCase()}.`,
          );
        }
        const accounts = [cc.bip48_2, cc.bip86, cc.bip84].filter(
          (a): a is NonNullable<typeof a> => !!a,
        );
        const named = accounts.filter(
          (a) => rec.heirOriginPath && canonPath(a.originPath) === canonPath(rec.heirOriginPath),
        );
        const rest = accounts.filter((a) => !named.includes(a));
        candidates = [...named, ...rest].map((a) => a.xpub);
      } else {
        const parsed = parseKeyInput(raw);
        if (parsed) {
          if (parsed.key.fingerprint && parsed.key.fingerprint.toLowerCase() !== expectedFp) {
            throw new Error(
              `This is the wrong key. The invite is locked to fingerprint ${expectedFp.toUpperCase()}.`,
            );
          }
          candidates = [parsed.key.xpub];
        }
      }
      if (candidates.length === 0) {
        throw new Error("That doesn't contain a usable public key export.");
      }

      const card: InviteCard = {
        v: 1,
        access: 'key',
        vaultLabel: rec.vaultLabel,
        heirName: rec.heirName,
        expectedFingerprint: rec.expectedFingerprint,
        heirOriginPath: rec.heirOriginPath,
        network: rec.network,
        mode: rec.mode,
        innerSaltB64: rec.innerSaltB64,
      };
      let payload: DescriptorPayload | null = null;
      let lastError: Error | null = null;
      for (const xpub of candidates) {
        try {
          payload = openDescriptor(code, card, xpub, descriptorCt);
          break;
        } catch (e) {
          lastError = e as Error;
        }
      }
      if (!payload) {
        // The device already proved its fingerprint — this is the classic
        // wrong-menu-item export (decided 2026-07-27): the obvious "Export
        // Wallet" gives the SINGLE-SIGNATURE key. Name the exact menu path
        // instead of a vague "wrong key".
        if (fromColdcard) {
          throw new Error(
            singleSigOnly
              ? 'This is the single-signature export. The vault needs the ' +
                'multi-key one, so export the multisig account key on your ' +
                'device and bring that one here.'
              : 'Your device is right, but this export does not contain the ' +
                'account this vault uses. Export the multisig account key ' +
                'from your device and use that export.',
          );
        }
        throw lastError ?? new Error('This key does not open the vault.');
      }

      await installVault(payload, rec);
    } catch (e) {
      setDialog(openFailed(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      style={styles.content}
      // The page's actions at its foot (decided 2026-10-05): the claim, and the
      // login the sealed cards wait on. Each sealed card keeps its own
      // buttons: with several cards, "Activate" and "Remove" name ONE vault.
      footer={
        <>
          <Button
            title={busy ? 'Claiming…' : 'Claim the invite'}
            onPress={() => void doClaim()}
            loading={busy}
            disabled={busy || codeInput.trim().length === 0}
          />
          {claimed.length > 0 && needsLogin && (
            <Button title="Log in" variant="ghost" onPress={() => setAuthOpen(true)} />
          )}
        </>
      }>
      {/* Not every invite is sealed: a keyless one opens at once
          (decided 2026-09-22). */}
      <InfoHeading
        title="What claiming does"
        text="It shows you the vault you were invited to: its name, your role, and a countdown where one applies. Opening the vault itself takes the hardware key you hold, unless your invite was sent without one."
        style={styles.title}>
        Heir invite
      </InfoHeading>
      <Text style={styles.body}>Enter the code from your invite email.</Text>
      <TextField
        label="Invite code"
        value={codeInput}
        onChangeText={setCodeInput}
        autoCapitalize="characters"
        monospace
        placeholder="TALIA-XXXXX-XXXXX-XXXXX-XXXXX"
      />

      {claimed.length > 0 && <Text style={styles.sectionLabel}>YOUR SEALED VAULTS</Text>}
      {claimed.length > 0 && needsLogin && (
        <Card style={styles.sealedCard}>
          <Text style={styles.body}>
            Log in to check whether your vault is ready.
          </Text>
        </Card>
      )}
      {claimed.map((rec) => {
        const isReleased = !!released[rec.inviteId];
        const releaseAt = releaseAts[rec.inviteId] ?? rec.releaseAt;
        return (
          <Card key={rec.inviteId} style={styles.sealedCard}>
            <View style={styles.sealedHead}>
              <KeyIcon size={20} color={theme.colors.gold} />
              <Text style={styles.sealedTitle}>{rec.vaultLabel}</Text>
            </View>
            {rec.access === 'key' ? (
              <Text style={styles.body}>
                You are named as an heir. This vault opens with the key{' '}
                <Text style={styles.mono}>{(rec.expectedFingerprint ?? '').toUpperCase()}</Text>.
              </Text>
            ) : (
              <Text style={styles.body}>
                You are named as an heir. Your invite alone opens this vault, with
                no hardware key needed.
              </Text>
            )}
            {isReleased ? (
              rec.access === 'key' ? (
                <>
                  <Text style={styles.body}>
                    Your vault is ready. Talia needs the public key from that device.
                    Your seed words are never needed and must never be typed anywhere.
                  </Text>
                  <Button
                    title="Activate with your key"
                    onPress={() => {
                      provenDeviceRef.current = null;
                      setScanFor(rec);
                    }}
                    disabled={busy}
                  />
                </>
              ) : (
                <Button
                  title="Open the vault"
                  onPress={() => void openKeylessFromList(rec)}
                  disabled={busy}
                />
              )
            ) : (
              <Text style={styles.countdown}>{notReleasedLine({ ...rec, releaseAt }, Date.now())}</Text>
            )}
            <Button
              title="Remove from this phone"
              variant="ghost"
              onPress={() => setRemoving(rec)}
              disabled={busy}
            />
          </Card>
        );
      })}

      {/* Activation accepts the heir's key ANY way they have it — scanned,
          pasted, or from an export file (decided 2026-07-26:
          a QR-only path is not acceptable for an heir). The raw payload
          comes back so every account in an export can be tried; only the
          public key is ever needed. */}
      <KeyEntrySheet
        visible={!!scanFor}
        coldcardAccount="bip48_2"
        network={knownNetwork(scanFor?.network) ?? 'bitcoin'}
        // The heir's key already sits on a device: which one (decided 2026-10-04,
        // device first), or "Another device" for hardware Talia cannot reach.
        question="Which device holds your key?"
        guideOriginPath={scanFor?.heirOriginPath}
        intro={
          scanFor
            ? `We'll show you exactly where to find it. Talia needs only the PUBLIC key of the device holding ${(scanFor.expectedFingerprint ?? '').toUpperCase()}, never your seed words.`
            : undefined
        }
        onLedgerKey={(fp, device) => {
          // Any adopted Bluetooth device that read the key: remembered so the
          // vault starts out knowing where the heir's key lives.
          provenDeviceRef.current = { fp: fp.toLowerCase(), device };
        }}
        onRaw={(raw) => {
          const rec = scanFor;
          setScanFor(null);
          if (rec) void onKeyScanned(rec, raw);
        }}
        onAdd={(key) => {
          const rec = scanFor;
          setScanFor(null);
          if (rec && key.xpub) void onKeyScanned(rec, key.xpub);
        }}
        onClose={() => setScanFor(null)}
        onError={(message) => {
          setScanFor(null);
          setDialog({ title: 'Could not read that key', message });
        }}
      />

      <AuthSheet
        visible={authOpen}
        defaultMode="signup"
        onClose={() => setAuthOpen(false)}
        onAuthed={(s) => {
          setAuthOpen(false);
          // Mid-claim → continue the claim; otherwise it was the
          // check-your-invites login.
          if (normalizeInviteCode(codeInput)) void doClaim(s);
          else void refresh(s);
        }}
      />

      {removing && (
        <AppDialog
          visible
          title="Remove this sealed vault?"
          message={`“${removing.vaultLabel}” disappears from this phone, along with the invite code stored here. Nothing is revoked. If you still have the code in your email you can claim it again.`}
          actions={[
            { label: 'Keep it', variant: 'ghost', onPress: () => {} },
            {
              label: 'Remove',
              variant: 'primary',
              onPress: () => {
                const id = removing.inviteId;
                void removeClaimedInvite(id).then(() => refresh());
              },
            },
          ]}
          onClose={() => setRemoving(null)}
        />
      )}

      {dialog && (
        <AppDialog
          visible
          title={dialog.title}
          message={dialog.message}
          actions={dialog.actions ?? [{ label: 'OK', variant: 'primary', onPress: () => {} }]}
          onClose={() => {
            setDialog(null);
            // A question dismissed without an answer is a no (decided 2026-09-26).
            setTimeout(() => keyPathAnswerRef.current?.(false), 0);
          }}
        />
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite },
    body: { ...theme.typography.body, color: theme.colors.slate },
    sectionLabel: {
      ...theme.typography.label,
      color: theme.colors.slate,
      marginTop: theme.spacing.md,
    },
    sealedCard: { gap: theme.spacing.sm },
    sealedHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
    sealedTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flex: 1 },
    mono: { ...theme.typography.mono },
    countdown: { ...theme.typography.body, color: theme.colors.gold },
  }),
);
