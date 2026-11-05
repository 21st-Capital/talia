/**
 * Invite an heir to their vault (design settled 2026-07-24).
 *
 * The owner picks an heir, supplies their email address if the vault does
 * not already hold one (an Estate Plan may name a child who has none yet),
 * chooses how much the heir sees, and the app does the rest ON DEVICE:
 * generates the invite code, seals the card and descriptor blobs
 * (crypto/envelope.ts), stores only ciphertext on the backend, and composes
 * the invite email from the owner's own mail account. The code — half of the
 * decryption secret — never touches 21st Capital's servers.
 *
 * Modes:
 *  - STRICT (default): the heir sees a sealed card and a countdown. The
 *    descriptor is mathematically undeliverable until the first coin's heir
 *    timelock opens (the server withholds the blob until `release_at`,
 *    which this app maintains on every sync).
 *  - FULL SHARE: the heir sees everything as soon as they claim and prove
 *    their key — and doubles as a live backup of the vault. Everything or
 *    nothing: no middle modes, no in-app restrictions.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Screen, Card, Button, AppDialog, ChevronRightIcon, DrawnIcon, InfoHeading, StepTransition, CopyIcon, TextField } from '../components';
import type { DialogAction } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, newHeirId } from '../../wallet';
import { heirSideKeyLabels } from '../../wallet/heirKeyLabels';
import { parseKeyOrigins } from '../../bitcoin/descriptor';
import { heirKeyCanSignNow, heirKeyTimelocked } from '../../wallet/heirRelease';
import { heirName, heirTitle, inviteGreeting, inviteHeirName, withFiledNames } from '../../wallet/heirNames';
import { fetchFiledPlanHeirs } from '../../services/inheritance';
import { copySecret } from '../../platform/clipboard';
import { SUPPORT } from '../../config';
import { loadSession } from '../../services/companyAuth';
import {
  buildInviteBlobs,
  generateInviteCode,
} from '../../crypto/envelope';
import {
  computeVaultReleaseAtIso,
  createInvite,
  fetchMyInvites,
  loadOwnerInvites,
  revokeInvite,
  vaultLocalIdFor,
} from '../../services/heirInvite';
import type { MyInvite, OwnerInviteRecord } from '../../services/heirInvite';

type Props = NativeStackScreenProps<RootStackParamList, 'InviteHeir'>;

type Step = 'pick' | 'mode' | 'code' | 'sent';

interface InviteableHeir {
  /** Position in wallet.heirs — the last-resort matcher for legacy entries
   *  with no id and no key (the array order is stable; entries are only
   *  ever patched in place, never reordered). */
  index: number;
  /** wallet.heirs id — present on vaults created after 2026-08-27. */
  id?: string;
  /** Optional since 2026-08-27: typed HERE (this screen) when missing. */
  email?: string;
  /** Absent = a keyless heir: their invite is code-only, full visibility. */
  fingerprint?: string;
  /** Row title: the person's name, else "Heir 2". Never a key's label. */
  name: string;
  /** The person's name from the Estate Plan, '' until a plan names them
   *  (decided 2026-09-21: the email greeted "Hello test bitbox,"). */
  person: string;
  /** The label of the key they hold, shown beside its fingerprint. */
  keyLabel?: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function inviteStatusLine(inv: MyInvite): string {
  // A strict invite with no reported timelock can never release — say so
  // where the owner can act (2026-07-26: a phone test hit it as a silent dead-end).
  const strictWarning =
    inv.mode === 'strict' && !inv.releaseAt && (inv.status === 'pending' || inv.status === 'claimed')
      ? ' · Timelock not reported yet. Fund the vault and keep it in your app'
      : '';
  switch (inv.status) {
    case 'pending':
      return `Waiting to be claimed, expires ${fmtDate(inv.expiresAt)}${strictWarning}`;
    case 'claimed':
      // A mismatch is not an error: an invite is claimed by CODE, so an heir
      // who signed up with a different address is the ordinary case. It is
      // also the ONLY visible sign that someone else got hold of the code,
      // and until now it was recorded and shown to nobody (decided 2026-08-30).
      // The copy does NOT offer a revoke: HeirInviteRevokeView refuses
      // anything past pending, on purpose, because the claimer may already
      // hold the card and no released descriptor can be recalled. Staff are
      // the only route, and a strict invite still has its timelock in hand.
      return (
        `Claimed${inv.claimedAt ? ` on ${fmtDate(inv.claimedAt)}` : ''}` +
        (inv.emailMismatch
          ? ` by ${inv.claimedByEmail || 'a different account'}, which is not the address you invited. Usually that just means they signed up with another mailbox. If you did not expect it, contact 21st Capital: a claimed invite can no longer be withdrawn from here`
          : '') +
        strictWarning
      );
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired. Send a new invite if needed';
  }
}

export function InviteHeirScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, syncWallet, updateWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);

  const [step, setStep] = useState<Step>('pick');
  const [heir, setHeir] = useState<InviteableHeir | null>(null);
  const [mode, setMode] = useState<'strict' | 'full'>('strict');
  /**
   * Seal the descriptor under the heir's KEY as well as the code
   * (decided 2026-08-30: a choice, defaulting to on). On means both are
   * needed to open the vault. The key's part is its PUBLIC xpub, so this is
   * not proof they hold the device (crypto/envelope.ts, decided 2026-09-26).
   * Off makes the code alone enough, which is the keyless envelope, and the
   * envelope refuses to pair that with a countdown it could never release.
   * Only offered where there is a key to seal with.
   */
  const [requireKey, setRequireKey] = useState(true);
  /** The heir's email, typed HERE now (decided 2026-08-27): prefilled when the
   *  vault already knows it. REQUIRED to create an invite (decided 2026-08-30) even
   *  though the Estate Plan may name an heir without one, because an invite is
   *  claimed from the heir's own 21st Capital account. A typed email is saved
   *  back onto wallet.heirs so the Estate Plan form finds it in its pick-list. */
  const [emailDraft, setEmailDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [myInvites, setMyInvites] = useState<MyInvite[] | null>(null);
  const [revoking, setRevoking] = useState<MyInvite | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; actions?: DialogAction[] } | null>(null);

  /** The server's view of THIS vault's invites (statuses live there only). */
  const repushedRef = useRef(false);
  const loadMyInvites = useCallback(async () => {
    if (!wallet) return;
    try {
      const session = await loadSession();
      if (!session) return;
      const vaultLocalId = await vaultLocalIdFor(wallet.id);
      const mine = (await fetchMyInvites(session)).filter((i) => i.vaultLocalId === vaultLocalId);
      setMyInvites(mine);
      // The owner is necessarily logged in HERE — if any strict invite still
      // has no reported timelock, force one sync now so the push fires
      // (2026-07-26 forensics: the upkeep must never rely on luck).
      if (
        !repushedRef.current &&
        mine.some((i) => i.mode === 'strict' && !i.releaseAt && i.status !== 'revoked' && i.status !== 'expired')
      ) {
        repushedRef.current = true;
        void syncWallet(wallet, { force: true }).catch(() => {});
      }
    } catch {
      // offline / expired session — the list simply doesn't show
    }
  }, [wallet, syncWallet]);

  useEffect(() => {
    void loadMyInvites();
  }, [loadMyInvites, step]);

  /** Every named heir can be invited. Keyed heirs get the code+key envelope;
   *  keyless heirs get a code-only, full-visibility invite (decided 2026-07-26).
   *
   *  An address is NOT required (decided 2026-08-30, settling it): a client must be
   *  able to name a child too young to have one, and that child's invite is
   *  handed over in person instead of emailed. What the address changes is
   *  DELIVERY, and one protection: the claim is checked against the invited
   *  address, so an invite with none can be claimed by any account holding
   *  the code with nothing to flag it. The delivery step says so. */
  const allHeirs = useMemo<InviteableHeir[]>(() => {
    if (!wallet) return [];
    return (wallet.heirs ?? []).map((h, i) => {
      const fp = h.fingerprint?.toLowerCase();
      return {
        index: i,
        id: h.id,
        email: h.email?.trim() || undefined,
        fingerprint: fp,
        name: heirTitle(h, i),
        person: heirName(h),
        keyLabel: (fp && wallet.keyLabels?.[fp]) || undefined,
      };
    });
  }, [wallet]);

  // A plan filed before 2026-09-21 never handed its heirs' names to the
  // vault: read them back from the owner's filed plans, once per visit.
  const namesAskedRef = useRef(false);
  useEffect(() => {
    if (!wallet || namesAskedRef.current) return;
    if (!(wallet.heirs ?? []).some((h) => !heirName(h))) return;
    namesAskedRef.current = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const named = withFiledNames(wallet.heirs ?? [], await fetchFiledPlanHeirs(session));
        if (named.changed) await updateWallet(wallet.id, { heirs: named.heirs });
      } catch {
        // offline: the rows keep "Heir 2" until the next visit
      }
    })();
  }, [wallet, updateWallet]);

  const inviteableHeirs = allHeirs;

  // Which heirs already have an invite from this device — drives the
  // "invite the next heir" loop (decided 2026-07-26: after emailing the first
  // invite the flow must NOT dump the owner back on the vault page while
  // heirs remain). Local records work offline; keyed heirs match by
  // fingerprint, keyless by email.
  const [ownerRecords, setOwnerRecords] = useState<OwnerInviteRecord[]>([]);
  useEffect(() => {
    if (!wallet) return;
    void loadOwnerInvites().then((rs) =>
      setOwnerRecords(rs.filter((r) => r.walletId === wallet.id)),
    );
  }, [wallet, step]);
  const uninvitedHeirs = useMemo(
    () =>
      inviteableHeirs.filter(
        (h) =>
          !ownerRecords.some((r) => {
            if (h.fingerprint) return r.heirFingerprint === h.fingerprint;
            if (h.id && r.heirId) return r.heirId === h.id;
            // Legacy keyless records (pre-2026-08-27) carry only the email.
            const em = (h.email ?? '').trim().toLowerCase();
            return !!em && (r.heirEmail ?? '') === em;
          }),
      ),
    [inviteableHeirs, ownerRecords],
  );

  useEffect(() => {
    // Header back steps one wizard step, not out of the screen.
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      if (step === 'mode') {
        e.preventDefault();
        setStep('pick');
      } else if (step === 'code') {
        // The invite exists server-side now — back can't undo it, so it
        // finishes the flow instead of being a dead control.
        e.preventDefault();
        setStep('sent');
      }
    });
    return sub;
  }, [navigation, step]);

  /** Strict mode: the vault-wide earliest heir unlock — the SAME value the
   *  sync hook PATCHes later, so create and upkeep can never disagree.
   *
   *  Declared ABOVE the missing-vault return with the rest of the hooks. Below
   *  it, a render where the vault has just been deleted runs fewer hooks than
   *  the one before and React throws instead of showing the message. */
  const estimateReleaseAt = useCallback(async (): Promise<string | null> => {
    if (!wallet) return null;
    try {
      const engine = await syncWallet(wallet);
      return await computeVaultReleaseAtIso(wallet, engine);
    } catch {
      return null; // strict + unknown → the server fails closed
    }
  }, [wallet, syncWallet]);

  /**
   * Can this heir's key anchor a countdown? The Estate Plan lets a client say
   * an heir has access to ANY key, an active primary one included (decided
   * 2026-08-30). Sealing the invite to such a key is exactly right; offering
   * "nothing until it matters" against it is not, because a primary key sits
   * on no timelocked path, the release date computes to null, and the server
   * then withholds the descriptor forever. So strict is offered only where
   * something can actually release it.
   */
  const canCountDown = useMemo(
    // A key that can ALSO sign today (on a path with no timelock) has
    // nothing to count down to (decided 2026-09-22).
    () =>
      wallet
        ? heirKeyTimelocked(wallet.descriptor, heir?.fingerprint) &&
          !heirKeyCanSignNow(wallet.descriptor, heir?.fingerprint)
        : false,
    [wallet, heir],
  );

  if (!wallet) {
    return (
      <Screen scroll style={styles.content}>
        <Text style={styles.body}>This vault is no longer on this device.</Text>
      </Screen>
    );
  }

  /** What the invite will actually use: the draft wins (it is prefilled
   *  from the vault when known). Empty = no email on file. */
  const effectiveEmail = emailDraft.trim() || undefined;

  /** The heir in a sentence: their name, else "your heir". Never a key. */
  const who = heir?.person || 'your heir';
  const Who = heir?.person || 'Your heir';

  /** Does the invite need the heir's key as well as the code? The ONE test
   *  for sealing, the code step and the email (decided 2026-09-22: a keyed
   *  heir sent a code-only invite was still told their key was needed). */
  const sealToKey = !!heir?.fingerprint && requireKey;

  const createAndStore = async () => {
    if (!heir) return;
    // An address is optional (decided 2026-08-30, settling it): without one the
    // invite is created and handed over IN PERSON, which is how a client names
    // a child too young to have an email. What is lost is the claim check
    // against the invited address, so nothing flags a claim by someone else;
    // the delivery step says so plainly rather than refusing.
    if (effectiveEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveEmail)) {
      setDialog({
        title: 'Check the email address',
        message: 'That does not look like a complete email address.',
      });
      return;
    }
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) {
        setDialog({
          title: 'Please log in',
          message: 'Log in to your 21st Capital account first (Settings → 21st Capital Account).',
        });
        return;
      }

      // Keyed heir: their xpub + origin path, straight from the descriptor.
      // Keyless heir: no key to lock to — the code alone seals the invite.
      let heirXpub: string | undefined;
      let heirOriginPath: string | undefined;
      if (heir.fingerprint) {
        const origin = parseKeyOrigins(wallet.descriptor).find(
          (k) => k.fingerprint?.toLowerCase() === heir.fingerprint,
        );
        if (!origin) {
          setDialog({
            title: 'Key not found',
            message: "This heir's key is not one of the keys in this vault.",
          });
          return;
        }
        // Looked up either way, so a stale fingerprint is caught before an
        // invite is minted; only USED when sealing to the key.
        if (sealToKey) {
          heirXpub = origin.xpub;
          heirOriginPath = origin.originPath;
        }
      }

      // A code-only invite cannot carry a countdown: the envelope throws, and
      // rightly so, since nothing would ever release it.
      const effectiveMode = sealToKey && canCountDown ? mode : 'full';
      const releaseAtIso = effectiveMode === 'strict' ? await estimateReleaseAt() : null;

      // A legacy heir (pre-2026-08-27 wallet) has no id — mint one NOW and
      // persist it, or the invite record can never be matched back to them
      // (decided 2026-08-27: clearing the prefilled email left such an heir
      // 'No invite yet' forever, looping the owner into duplicate invites).
      const heirId = heir.id ?? newHeirId();
      // The name the invite carries (the server's label for the owner's list,
      // and the sealed card): the person, never the key's label. With no
      // plan naming them yet, the address tells the owner's list apart.
      const inviteName = heir.person || effectiveEmail?.split('@')[0] || heir.name;

      const freshCode = generateInviteCode();
      const blobs = buildInviteBlobs({
        code: freshCode,
        heirXpub,
        card: {
          vaultLabel: wallet.label,
          heirName: inviteName,
          expectedFingerprint: heir.fingerprint,
          heirOriginPath,
          network: wallet.network,
          mode: effectiveMode,
        },
        descriptor: {
          v: 1,
          descriptor: wallet.descriptor,
          changeDescriptor: wallet.changeDescriptor,
          network: wallet.network,
          vaultLabel: wallet.label,
          // Named from the heir's side: "Your key" is the owner's key there.
          keyLabels: heirSideKeyLabels(wallet.keyLabels),
          providerKeyFingerprints: wallet.providerKeyFingerprints,
        },
      });

      await createInvite(session, {
        code: freshCode,
        walletId: wallet.id,
        vaultLocalId: await vaultLocalIdFor(wallet.id),
        heirName: inviteName,
        heirEmail: effectiveEmail,
        heirFingerprint: heir.fingerprint ?? '',
        heirId,
        mode: effectiveMode,
        cardCiphertextB64: blobs.cardCiphertextB64,
        descriptorCiphertextB64: blobs.descriptorCiphertextB64,
        releaseAtIso,
      });

      // Persist what the invite just established: a freshly-minted id, and a
      // typed email (Estate Plan pick-list fodder, decided 2026-08-27). Matched
      // by id, then key, then POSITION — never by email equality, which
      // rewrote every same-address twin on legacy wallets (review).
      if (wallet.heirs && (heirId !== heir.id || (effectiveEmail && effectiveEmail !== heir.email))) {
        const nextHeirs = wallet.heirs.map((h, idx) => {
          const isThisHeir = heir.id
            ? h.id === heir.id
            : heir.fingerprint
              ? h.fingerprint?.toLowerCase() === heir.fingerprint
              : idx === heir.index;
          if (!isThisHeir) return h;
          return { ...h, id: heirId, ...(effectiveEmail ? { email: effectiveEmail } : {}) };
        });
        void updateWallet(wallet.id, { heirs: nextHeirs });
      }

      setHeir({ ...heir, id: heirId, email: effectiveEmail ?? heir.email });
      setCode(freshCode);
      setStep('code');
    } catch (e) {
      setDialog({ title: 'Could not create the invite', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onCopyCode = () => {
    if (!code) return;
    copySecret(code, 'inviteCode');
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const doRevoke = async (inv: MyInvite) => {
    setRevoking(null);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) throw new Error('Please log in to your 21st Capital account first.');
      await revokeInvite(session, inv.id);
      await loadMyInvites();
    } catch (e) {
      setDialog({ title: 'Could not revoke the invite', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const emailInvite = async () => {
    if (!heir || !code || !effectiveEmail) return;
    const subject = `You are named as an heir on “${wallet.label}”`;
    // Short on purpose, like the page it links to (decided 2026-09-14): what it is,
    // the link, the code, one line of care.
    const body =
      `${inviteGreeting(heir.person)}\n\n` +
      `You have been named as an heir on a Bitcoin vault ("${wallet.label}") ` +
      `held with 21st Capital.\n\n` +
      `Open this link on your phone and Talia does the rest. No Talia yet? Install it, create an account, then open the link again.\n\n` +
      // An https link, not talia://, because Gmail leaves a custom scheme as
      // dead plain text and the heir has nothing to tap (decided 2026-08-30). The
      // code sits in the FRAGMENT: a fragment is never sent in a request, so
      // it still never reaches a 21st Capital server, nor a mail scanner that
      // follows links in the message. The page hands off to the app.
      `    ${SUPPORT.websiteUrl}/invite#${code}\n\n` +
      `Your code, if you prefer to type it: ${code}\n\n` +
      (sealToKey
        ? `On its own this code shows only the vault's name and your role. Opening anything more also needs the hardware key you hold. It expires six months after it was sent.\n`
        : `Anyone who has this code can view the vault, so please do not forward this email. It expires six months after it was sent.\n`);
    const url =
      `mailto:${encodeURIComponent(effectiveEmail)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
    try {
      await Linking.openURL(url);
      setStep('sent');
    } catch {
      setDialog({
        title: 'No mail app',
        message: 'Copy the code instead and pass it to your heir another way.',
      });
    }
  };

  return (
    <Screen
      scroll
      style={styles.content}
      // The step's actions, pinned at the foot and outside the slide (decided
      // 2026-10-05): primary first, Back last. The pick step has none: its
      // rows are the way on, and an invite row's Revoke belongs to the row.
      // The two kinds of mode step share one pair of buttons.
      footer={
        step === 'code' && heir && code ? (
          <>
            {effectiveEmail ? (
              <Button title={`Email the invite to ${effectiveEmail}`} onPress={() => void emailInvite()} />
            ) : null}
            <Button
              title="I'll pass it on myself"
              variant={effectiveEmail ? 'ghost' : undefined}
              onPress={() => setStep('sent')}
            />
          </>
        ) : step === 'sent' ? (
          <>
            {uninvitedHeirs.length > 0 && (
              <Button
                title={
                  uninvitedHeirs.length === 1
                    ? `Invite ${uninvitedHeirs[0].name} too`
                    : `Invite the next heir (${uninvitedHeirs.length} left)`
                }
                onPress={() => {
                  setHeir(null);
                  setEmailDraft('');
                  setCode(null);
                  setCopied(false);
                  setStep('pick');
                }}
              />
            )}
            <Button
              title="Done"
              variant={uninvitedHeirs.length > 0 ? 'ghost' : undefined}
              onPress={() => navigation.goBack()}
            />
          </>
        ) : step === 'mode' && heir ? (
          <>
            <Button
              title={busy ? 'Sealing the invite…' : 'Create the invite'}
              onPress={() => void createAndStore()}
              loading={busy}
              disabled={busy}
            />
            <Button title="Back" variant="ghost" onPress={() => setStep('pick')} disabled={busy} />
          </>
        ) : undefined
      }>
      <StepTransition stepKey={step} order={['pick', 'mode', 'code', 'sent']} style={styles.stepWrap}>
        {step === 'pick' && (
          <>
            <InfoHeading
              title="How invites work"
              // A keyed heir whose key has nothing to count down to can be
              // sent a code-only invite (decided 2026-09-22).
              text="An heir with their own hardware key needs both the code and the public key of that hardware key to see the vault, unless you choose code only for them. An heir without a key gets an open invite, where the code itself shows them the whole vault."
              style={styles.title}>
              Invite an heir
            </InfoHeading>
            {inviteableHeirs.length === 0 && (
              <Card style={styles.card}>
                <Text style={styles.body}>
                  This vault has no heirs recorded. Heirs are named when the vault
                  is created, or on your Estate Plan.
                </Text>
              </Card>
            )}
            {inviteableHeirs.map((h) => (
              <TouchableOpacity
                key={h.fingerprint ?? h.id ?? h.email ?? h.name}
                activeOpacity={0.7}
                onPress={() => {
                  setHeir(h);
                  setEmailDraft(h.email ?? '');
                  setMode(h.fingerprint ? 'strict' : 'full');
                  setRequireKey(true); // encrypted by default, every time
                  setRequireKey(true); // default on, per heir
                  setStep('mode');
                }}>
                <Card style={styles.heirRow}>
                  <View style={styles.heirBody}>
                    <Text style={styles.heirName}>{h.name}</Text>
                    <Text style={styles.muted}>
                      {h.email ?? 'No email address. Hand the code over in person.'}
                    </Text>
                    {h.fingerprint ? (
                      <Text style={styles.mono}>
                        key {h.keyLabel ? `${h.keyLabel} · ` : ''}{h.fingerprint.toUpperCase()}
                      </Text>
                    ) : (
                      <Text style={styles.muted}>Open invite (no key)</Text>
                    )}
                  </View>
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                </Card>
              </TouchableOpacity>
            ))}
            {myInvites && myInvites.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>INVITES FOR THIS VAULT</Text>
                {myInvites.map((inv) => (
                  <Card key={inv.id} style={styles.heirRow}>
                    <View style={styles.heirBody}>
                      <Text style={styles.heirName}>
                        {inviteHeirName(inv, ownerRecords, wallet.heirs ?? [], wallet.keyLabels)}
                      </Text>
                      <Text style={styles.muted}>{inviteStatusLine(inv)}</Text>
                    </View>
                    {inv.status === 'pending' && (
                      <Button
                        title="Revoke"
                        variant="ghost"
                        onPress={() => setRevoking(inv)}
                        disabled={busy}
                      />
                    )}
                  </Card>
                ))}
              </>
            )}
          </>
        )}

        {step === 'mode' && heir && !heir.fingerprint && (
          <>
            <Text style={styles.title}>An open invite for {who}</Text>
            <Card style={styles.card}>
              <Text style={styles.body}>
                {Who} holds no key of this vault, so the code alone opens it.
              </Text>
            </Card>
            {/* On 2026-08-30 this was read as the code being locked to the
                address below. It is not: the backend records a mismatch and
                lets the claim through (heir_views.HeirInviteClaimView, pinned
                by a test). Until that changes, the warning has to say what the
                code actually is, and say WHICH email it means. */}
            <Card style={styles.warnCard}>
              <Text style={styles.warnText}>
                This code is the key. Whoever holds it can claim the invite from any
                21st Capital account, not only from the address above, so treat it
                the way you would treat a spare key. If you send it in a message,
                anyone who can read that mailbox can use it, which is why handing it
                over in person is safer. You can revoke the invite any time before it
                is claimed.
              </Text>
            </Card>
            <TextField
              label="Heir's email (optional)"
              value={emailDraft}
              onChangeText={setEmailDraft}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="heir@example.com"
            />
            <Text style={styles.muted}>
              With an address you can email the invite, and a claim from any other
              account is flagged to you. Leave it empty for someone who has none, a
              young child for instance: you then hand them the code in person, and
              they claim it from whichever account they make.
            </Text>
          </>
        )}

        {step === 'mode' && heir && !!heir.fingerprint && (
          <>
            {/* Two of the three kinds of invite meet here, and they are not
                the same decision (decided 2026-08-30).

                A key on a TIMELOCKED path is a fact of the descriptor: this
                heir demonstrably holds a key of this vault, so the invite is
                always sealed to it and the only question is whether they wait
                for the countdown.

                A key named in the Estate Plan is an ASSERTION by the owner,
                and it may be an active primary key. It cannot anchor a
                countdown, and the owner may want the invite openable even if
                that person never receives the key. So there the question is
                whether to seal to the key at all. */}
            <Text style={styles.title}>
              {canCountDown
                ? `How much should ${who} see?`
                : `What should it take to open ${who}'s invite?`}
            </Text>
            {!canCountDown ? (
              <Card style={styles.card}>
                <Text style={styles.body}>
                  {Who} holds an active key of this vault, one that is not
                  waiting on a timelock. There is nothing for a countdown to wait
                  for, so they see the vault from the day they claim their invite.
                </Text>
              </Card>
            ) : (
            <>
            {/* One switch instead of two cards (decided 2026-09-21: "replace this
                selection with a toggle"), on by default. No recommended
                marking here: it was removed from this screen. */}
            <Card style={styles.modeCard}>
              <View style={styles.modeHead}>
                <Text style={styles.modeTitle}>Keep it sealed until it matters</Text>
                <Switch
                  value={mode === 'strict'}
                  onValueChange={(on) => setMode(on ? 'strict' : 'full')}
                  trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
                  ios_backgroundColor={theme.colors.switchOff}
                  thumbColor={theme.colors.switchThumb}
                  accessibilityLabel="Keep it sealed until it matters"
                />
              </View>
              {mode === 'strict' ? (
                <InfoHeading
                  title="The sealed card"
                  text="It carries the vault's name, their role and a countdown, nothing more. Even after the countdown ends, it takes both the code and the public key of their hardware key to open the vault."
                  style={styles.body}>
                  {/* The vault is released at the FIRST heir waiting period
                      of the vault, which with several heirs can come before
                      this heir's own (decided 2026-09-22): words true for any
                      number of heirs. */}
                  Your heir sees only a sealed card until the first waiting period for an heir ends.
                </InfoHeading>
              ) : (
                // The recovery-path words of timelockNotice, open per coin
                // (decided 2026-09-22): "its waiting period" read as one
                // lock per key, and the heir's phone says "path opens".
                <Text style={styles.body}>
                  After proving their key, your heir watches the vault like you do.
                  Their key can sign only on a recovery path, and only for coins
                  where that path is open.
                </Text>
              )}
            </Card>
            </>
            )}
            {/* Offered ONLY for a plan-asserted key. For a timelocked heir the
                key is in the descriptor and stripping it would weaken the
                invite of the one heir we can prove holds a key. */}
            {!canCountDown && (
            <>
            <InfoHeading
              title="Sealing to the key"
              text={`Locked to their key means the vault's details are encrypted twice over: once with the code, once with the public key of ${who}'s hardware key. Both are needed. That public key can be known to others, for instance anyone who has seen this vault's details, so keep the code private: the second lock is not proof that ${who} holds the device.\n\nCode only removes that second lock. Whoever holds the code can open the vault's details without any key at all, so send it that way only when you have a reason, for instance if ${who} may never receive the key you named for them.`}
              style={styles.sectionLabel}>
              WHAT IT TAKES TO OPEN IT
            </InfoHeading>
            <Card style={styles.modeCard}>
              <View style={styles.modeHead}>
                <Text style={styles.modeTitle}>Require their key</Text>
                <Switch
                  value={requireKey}
                  onValueChange={setRequireKey}
                  trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
                  ios_backgroundColor={theme.colors.switchOff}
                  thumbColor={theme.colors.switchThumb}
                  accessibilityLabel="Require their key"
                />
              </View>
              {requireKey ? (
                <Text style={styles.body}>
                  Encrypted to {who}&apos;s key. Losing the code is not enough
                  for anyone else to open the vault.
                </Text>
              ) : (
                <Text style={styles.body}>
                  Less private and less safe: anyone who gets the code can open the
                  vault&apos;s details. It also means full visibility from the day
                  they claim, because there is no key for a countdown to wait for.
                </Text>
              )}
            </Card>
            </>
            )}
            <TextField
              label="Heir's email (optional)"
              value={emailDraft}
              onChangeText={setEmailDraft}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="heir@example.com"
            />
            <Text style={styles.muted}>
              With an address you can email the invite, and a claim from any other
              account is flagged to you. Leave it empty for someone who has none, a
              young child for instance: you then hand them the code in person, and
              they claim it from whichever account they make.
            </Text>
          </>
        )}

        {step === 'code' && heir && code && (
          <>
            <Text style={styles.title}>The invite is sealed</Text>
            {sealToKey ? (
              <Text style={styles.body}>
                This code is {who}&apos;s half of the invite. Their key is the
                other half.
              </Text>
            ) : (
              <Text style={styles.body}>
                This code alone opens {who}&apos;s invite, so hand it over in
                person if you can.
              </Text>
            )}
            <Card style={styles.codeCard}>
              <Text style={styles.codeText}>{code}</Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={onCopyCode}
                accessibilityLabel="Copy the invite code">
                {copied ? (
                  <Text style={styles.copiedText}>Copied</Text>
                ) : (
                  <CopyIcon size={18} strokeWidth={2} color={theme.colors.slate} />
                )}
              </TouchableOpacity>
            </Card>
          </>
        )}

        {step === 'sent' && (
          <>
            <View style={styles.doneHead}>
              <DrawnIcon kind="tick" size={30} strokeWidth={5} />
              <Text style={styles.title}>Invite ready</Text>
            </View>
            <Text style={styles.body}>
              When {who} claims it, the invite locks to their
              account. You can revoke it any time before then from this vault.
            </Text>
          </>
        )}
      </StepTransition>

      {revoking && (
        <AppDialog
          visible
          title="Revoke this invite?"
          message={`The invite for ${inviteHeirName(revoking, ownerRecords, wallet.heirs ?? [], wallet.keyLabels)} stops working immediately, and the code in their email becomes useless. You can always send a new one.`}
          actions={[
            { label: 'Keep it', variant: 'ghost', onPress: () => {} },
            { label: 'Revoke', variant: 'primary', onPress: () => void doRevoke(revoking) },
          ]}
          onClose={() => setRevoking(null)}
        />
      )}

      {dialog && (
        <AppDialog
          visible
          title={dialog.title}
          message={dialog.message}
          actions={dialog.actions ?? [{ label: 'OK', variant: 'primary', onPress: () => {} }]}
          onClose={() => setDialog(null)}
        />
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.md },
    stepWrap: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite, flexShrink: 1 },
    body: { ...theme.typography.body, color: theme.colors.slate },
    muted: { ...theme.typography.caption, color: theme.colors.slate },
    mono: { ...theme.typography.mono, color: theme.colors.faint },
    card: { gap: theme.spacing.sm },
    heirRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    heirBody: { flex: 1, gap: theme.spacing.xs },
    heirName: { ...theme.typography.heading, color: theme.colors.offWhite },
    modeCard: { gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.hairline },
    modeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
    warnCard: { borderColor: theme.colors.gold },
    warnText: { ...theme.typography.body, color: theme.colors.gold },
    modeTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },
    codeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.lg,
    },
    // The invite code is a code: the mono token, like every key and address.
    codeText: { ...theme.typography.mono, color: theme.colors.offWhite, flex: 1 },
    copyBtn: { padding: theme.spacing.sm },
    copiedText: { ...theme.typography.caption, color: theme.colors.accentText },
    sectionLabel: {
      ...theme.typography.label,
      color: theme.colors.slate,
      marginTop: theme.spacing.md,
    },
    doneHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  }),
);
