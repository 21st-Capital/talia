/**
 * Share a portfolio (decided 2026-09-12: "using the same method we use for
 * on-chain vault heirs", synced for every participant).
 *
 * OWNER: Start sharing mints the portfolio key and the share on this phone
 * (services/sharedPortfolio.ts), then invites are sealed exactly like a
 * keyless heir invite: a TALIA-P code generated here, a card the code opens,
 * ciphertext on the server, the invite email composed in the owner's own
 * mail app. The screen then lists who has access (members, pending
 * invites, a claim from an unexpected address) with Remove / Revoke, and
 * Stop sharing.
 *
 * MEMBER: the same list, and Leave this portfolio.
 *
 * Dialogs are a title and buttons; the reasoning sits behind the info dot.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import {
  ShareRow,
  AppDialog,
  AuthSheet,
  Button,
  Card,
  CopyIcon,
  DrawnIcon,
  InfoHeading,
  Screen,
  StepTransition,
  TextField,
} from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets } from '../../wallet';
import { copySecret } from '../../platform/clipboard';
import { shareVia } from '../../platform/files';
import { SUPPORT } from '../../config';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { newPortfolioInviteCode, newShareId, newShareKey } from '../../crypto/sharedPortfolio';
import { loadManualEntries } from '../../wallet/manualEntries';
import { entryTombstonesFor } from '../../services/virtualVaultSync';
import {
  createShare,
  createShareInvite,
  deleteShare,
  fetchMyShares,
  leaveShare,
  loadShareKey,
  removeMember,
  removeShareKey,
  revokeShareInvite,
  storeShareKey,
} from '../../services/sharedPortfolio';
import type { MyShare, ShareInvite, ShareMember } from '../../services/sharedPortfolio';

type Props = NativeStackScreenProps<VirtualStackParamList, 'SharePortfolio'>;

type Step = 'list' | 'invite' | 'code';

const SHARING_EXPLAINED =
  // Read by members too, through the info dot on "Shared with you": say who
  // the owner is rather than "you" (decided 2026-09-14).
  'Everyone in a shared portfolio sees every entry in it. Only its owner can add or change entries. ' +
  'The portfolio is encrypted on the phones with a key only the participants hold, so 21st Capital cannot read it. ' +
  'Anyone removed, and everyone once sharing stops, keeps the copy they have but sees nothing new.';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function inviteStatusLine(inv: ShareInvite): string {
  switch (inv.status) {
    case 'pending':
      return `Waiting to be used, expires ${fmtDate(inv.expiresAt)}`;
    case 'claimed':
      // A mismatch is not an error: an invite is claimed by CODE. It is the
      // only visible sign that someone else got hold of the code, and the
      // owner is the one person who can tell (the heir-invite lesson,
      // 2026-08-30). Unlike an heir, a member can simply be removed.
      return inv.emailMismatch
        ? `Used${inv.claimedAt ? ` on ${fmtDate(inv.claimedAt)}` : ''} by ${inv.claimedByEmail || 'a different account'}, which is not the address you invited. If you did not expect that, remove them from the list above.`
        : `Used${inv.claimedAt ? ` on ${fmtDate(inv.claimedAt)}` : ''}`;
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired. Send a new invite if needed';
  }
}

export function SharePortfolioScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, updateWallet, syncVirtualVaults, touchManualVault } = useWallets();
  const wallet = getWallet(route.params.walletId);
  const share = wallet?.sharedPortfolio;
  const active = !!share && !share.ended;

  const [step, setStep] = useState<Step>('list');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [myShare, setMyShare] = useState<MyShare | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | undefined>();
  const [needsLogin, setNeedsLogin] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const pendingAfterAuth = useRef<'share' | 'invite' | null>(null);

  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [removing, setRemoving] = useState<ShareMember | null>(null);
  const [revoking, setRevoking] = useState<ShareInvite | null>(null);
  const [stopping, setStopping] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /** The server's view of this share: members, and the owner's invites. */
  const refresh = useCallback(async () => {
    if (!share || share.ended) return;
    try {
      const session = await loadSession();
      setNeedsLogin(!session);
      if (!session) return;
      setSessionEmail(session.email?.toLowerCase());
      const mine = (await fetchMyShares(session)).find((s) => s.shareId === share.shareId) ?? null;
      setMyShare(mine);
      setLoadedOnce(true);
    } catch {
      // offline or an expired session: the list simply does not refresh
    }
  }, [share]);

  useEffect(() => {
    void refresh();
  }, [refresh, step]);

  useEffect(() => {
    // Header back steps one wizard step, not out of the screen.
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      if (step === 'invite' || step === 'code') {
        e.preventDefault();
        setStep('list');
      }
    });
    return sub;
  }, [navigation, step]);

  if (!wallet) {
    return (
      <Screen scroll style={styles.content}>
        <Text style={styles.body}>This portfolio is no longer on this phone.</Text>
      </Screen>
    );
  }

  const withSession = async (
    what: 'share' | 'invite',
    run: (session: CompanySession) => Promise<void>,
  ): Promise<void> => {
    const session = await loadSession();
    if (!session) {
      pendingAfterAuth.current = what;
      setAuthOpen(true);
      return;
    }
    await run(session);
  };

  /** Owner: mint the key and the share id here, seal the portfolio's current
   *  state under the key, and store it as the share's first version. */
  const startSharing = async (): Promise<void> => {
    setNotice(undefined);
    setBusy(true);
    try {
      await withSession('share', async (session) => {
        const key = newShareKey();
        const shareId = newShareId();
        // The key goes to the Keychain FIRST: a share whose key was lost
        // between the server and the Keychain would be unopenable by anyone.
        await storeShareKey(shareId, key);
        let version: number;
        try {
          const created = await createShare(session, {
            shareId,
            key,
            vault: {
              id: wallet.id,
              label: wallet.label,
              icon: wallet.icon,
              entries: await loadManualEntries(wallet.id),
              deletedEntries: await entryTombstonesFor(wallet.id),
              updatedAt: wallet.manualUpdatedAt ?? wallet.createdAt,
            },
          });
          version = created.version;
        } catch (e) {
          await removeShareKey(shareId);
          throw e;
        }
        await updateWallet(wallet.id, {
          sharedPortfolio: { shareId, role: 'owner', since: Date.now(), version, lastSyncAt: Date.now() },
        });
        setMyShare(null);
        setLoadedOnce(false);
        setNameDraft('');
        setEmailDraft('');
        setStep('invite');
      });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start sharing.');
    } finally {
      setBusy(false);
    }
  };

  const createInvite = async (): Promise<void> => {
    if (!share) return;
    const name = nameDraft.trim();
    const email = emailDraft.trim() || undefined;
    if (!name) {
      setNotice('Give the person a name, so you can tell invites apart.');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice('That does not look like a complete email address.');
      return;
    }
    setNotice(undefined);
    setBusy(true);
    try {
      await withSession('invite', async (session) => {
        const key = await loadShareKey(share.shareId);
        if (!key) {
          throw new Error('The key for this portfolio is not on this phone, so it cannot invite anyone.');
        }
        const freshCode = newPortfolioInviteCode();
        await createShareInvite(session, {
          shareId: share.shareId,
          code: freshCode,
          key,
          portfolioId: wallet.id,
          label: wallet.label,
          icon: wallet.icon,
          ownerName: session.firstName?.trim() || undefined,
          inviteeLabel: name,
          inviteeEmail: email,
        });
        setCode(freshCode);
        setCopied(false);
        setStep('code');
      });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  };

  const onCopyCode = (): void => {
    if (!code) return;
    copySecret(code, 'inviteCode');
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  // The message behind the share row: the same https link as the email (a
  // custom scheme dies as plain text in most apps), with the code in the
  // fragment, which never reaches a server. The page hands off to Talia,
  // which lands on the join page with the code filled in.
  const inviteMessage = (): string =>
    `Hello ${nameDraft.trim() || 'there'}, I am sharing the Bitcoin portfolio "${wallet.label}" with you in the Talia app by 21st Capital.\n\n` +
    `Open this link on your phone and Talia does the rest:\n${SUPPORT.websiteUrl}/invite#${code}\n\n` +
    `If Talia is not on your phone yet, install it, create an account, then open the link again. ` +
    `The link opens the portfolio for you, so please keep it to yourself. It expires in 6 months.`;

  const emailInvite = async (): Promise<void> => {
    const email = emailDraft.trim();
    if (!code || !email) return;
    const session = await loadSession();
    const owner = session?.firstName?.trim() || 'Someone';
    const subject = `${owner} shared the portfolio “${wallet.label}” with you`;
    // Short on purpose, like the page it links to (reported 2026-09-14: "nobody is
    // gonna read all that"): what it is, the link, the code, one line of care.
    const body =
      `Hello ${nameDraft.trim()},\n\n` +
      `${owner} shared a Bitcoin portfolio ("${wallet.label}") with you in Talia by 21st Capital.\n\n` +
      `Open this link on your phone and Talia does the rest. No Talia yet? Install it, create an account, then open the link again.\n\n` +
      // An https link, not talia://, because Gmail leaves a custom scheme as
      // dead plain text (decided 2026-08-30). The code sits in the FRAGMENT: a
      // fragment is never sent in a request, so it never reaches a 21st
      // Capital server. The page hands off to the app.
      `    ${SUPPORT.websiteUrl}/invite#${code}\n\n` +
      `Your code, if you prefer to type it: ${code}\n\n` +
      `Anyone who has this code can open the portfolio, so please do not forward this email. It expires six months after it was sent.\n`;
    const url =
      `mailto:${encodeURIComponent(email)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
    try {
      await Linking.openURL(url);
      setStep('list');
    } catch {
      setNotice('No mail app is set up. Copy the code instead and pass it on another way.');
    }
  };

  const doRemove = async (member: ShareMember): Promise<void> => {
    if (!share) return;
    setRemoving(null);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) throw new Error('Please log in to your 21st Capital account first.');
      await removeMember(session, share.shareId, member.userId);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not remove this person.');
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (inv: ShareInvite): Promise<void> => {
    if (!share) return;
    setRevoking(null);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) throw new Error('Please log in to your 21st Capital account first.');
      await revokeShareInvite(session, share.shareId, inv.id);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not revoke the invite.');
    } finally {
      setBusy(false);
    }
  };

  const doStop = async (): Promise<void> => {
    if (!share) return;
    setStopping(false);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) throw new Error('Please log in to your 21st Capital account first.');
      await deleteShare(session, share.shareId);
      await removeShareKey(share.shareId);
      await updateWallet(wallet.id, { sharedPortfolio: { ...share, ended: 'stopped', lastError: undefined } });
      touchManualVault(wallet.id);
      setMyShare(null);
      setNotice('Sharing has stopped. Everyone keeps the copy they have.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not stop sharing.');
    } finally {
      setBusy(false);
    }
  };

  const doLeave = async (): Promise<void> => {
    if (!share) return;
    setLeaving(false);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) throw new Error('Please log in to your 21st Capital account first.');
      await leaveShare(session, share.shareId);
      await removeShareKey(share.shareId);
      await updateWallet(wallet.id, { sharedPortfolio: { ...share, ended: 'removed', lastError: undefined } });
      // The copy is this phone's own from here: a fresh stamp so it rejoins
      // the account sync ahead of any older tombstone under its id, which
      // would otherwise delete it on the next round (decided 2026-09-14).
      touchManualVault(wallet.id);
      setMyShare(null);
      setNotice('You have left. Your copy stays on this phone.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not leave the portfolio.');
    } finally {
      setBusy(false);
    }
  };

  const isOwner = share?.role === 'owner';
  const members = myShare?.members ?? [];
  const invites = myShare?.invites ?? [];
  const others = members.filter((m) => m.email.toLowerCase() !== sessionEmail);

  // The page's actions sit in the pinned footer (decided 2026-10-05), chosen per
  // step OUTSIDE the transition so they never slide with it. In every step
  // the primary comes first and Back and the ways out last. Remove and
  // Revoke stay on their rows. A code with no address to email it to has no
  // footer: the share row in the content is the way to pass it on.
  const footer =
    step === 'list' && !active ? (
      <Button
        // "Again" only for the owner who stopped: a member who left never shared it.
        title={busy ? 'Starting…' : share?.ended && share.role === 'owner' ? 'Share it again' : 'Start sharing'}
        onPress={() => void startSharing()}
        loading={busy}
        disabled={busy}
      />
    ) : step === 'list' && active ? (
      <>
        {isOwner && (
          <Button
            title="Invite someone"
            onPress={() => {
              setNotice(undefined);
              setNameDraft('');
              setEmailDraft('');
              setStep('invite');
            }}
            disabled={busy}
          />
        )}
        {needsLogin && <Button title="Log in" variant="ghost" onPress={() => setAuthOpen(true)} />}
        {isOwner ? (
          <Button title="Stop sharing" variant="ghost" onPress={() => setStopping(true)} disabled={busy} />
        ) : (
          <Button title="Leave this portfolio" variant="ghost" onPress={() => setLeaving(true)} disabled={busy} />
        )}
      </>
    ) : step === 'invite' ? (
      <>
        <Button
          title={busy ? 'Sealing the invite…' : 'Create the invite'}
          onPress={() => void createInvite()}
          loading={busy}
          disabled={busy}
        />
        <Button title="Back" variant="ghost" onPress={() => setStep('list')} disabled={busy} />
      </>
    ) : step === 'code' && code && emailDraft.trim() ? (
      <Button title={`Email the invite to ${emailDraft.trim()}`} onPress={() => void emailInvite()} />
    ) : undefined;

  return (
    <Screen scroll style={styles.content} footer={footer}>
      <StepTransition stepKey={step} order={['list', 'invite', 'code']} style={styles.stepWrap}>
        {step === 'list' && !active && (
          <>
            <InfoHeading title="How sharing works" text={SHARING_EXPLAINED} style={styles.title}>
              Share this portfolio
            </InfoHeading>
            <Text style={styles.body}>
              {share?.ended === 'removed'
                ? 'You are no longer part of the shared portfolio. This copy is yours.'
                : share?.ended === 'stopped'
                  ? // A member reaches this when the owner stopped sharing OR removed
                    // them: the server says only that the share is gone (decided
                    // 2026-09-14), so say what is true either way.
                    share.role === 'owner'
                    ? 'Sharing has stopped. This copy is yours.'
                    : 'You are no longer part of this shared portfolio. This copy is yours.'
                  : 'Everyone you invite can see this portfolio. Only you can add or change entries.'}
            </Text>
          </>
        )}

        {step === 'list' && active && (
          <>
            <InfoHeading style={styles.title} title="How sharing works" text={SHARING_EXPLAINED}>
              Shared with
            </InfoHeading>
            {needsLogin && (
              <Card style={styles.card}>
                <Text style={styles.body}>Log in to see who has access.</Text>
              </Card>
            )}
            <Card style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>You</Text>
                <Text style={styles.muted}>
                  {isOwner ? 'Started sharing' : 'Joined'} {new Date(share.since).toLocaleDateString()}
                </Text>
              </View>
            </Card>
            {others.map((m) => (
              <Card key={m.userId} style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {m.email || 'A member'}
                  </Text>
                  <Text style={styles.muted}>
                    {m.role === 'owner' ? 'Owner' : 'Joined'}
                    {m.joinedAt ? ` ${fmtDate(m.joinedAt)}` : ''}
                  </Text>
                </View>
                {isOwner && m.role !== 'owner' && (
                  <Button title="Remove" variant="ghost" onPress={() => setRemoving(m)} disabled={busy} />
                )}
              </Card>
            ))}
            {loadedOnce && others.length === 0 && !needsLogin && (
              <Text style={styles.muted}>Nobody has joined yet.</Text>
            )}
            {!loadedOnce && !needsLogin && <Text style={styles.muted}>Checking who has access…</Text>}

            {isOwner && invites.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>INVITES</Text>
                {invites.map((inv) => (
                  <Card key={inv.id} style={styles.row}>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{inv.inviteeLabel || inv.inviteeEmail || 'Invite'}</Text>
                      {!!inv.inviteeEmail && inv.inviteeLabel ? (
                        <Text style={styles.muted}>{inv.inviteeEmail}</Text>
                      ) : null}
                      <Text style={[styles.muted, inv.emailMismatch && styles.warnText]}>
                        {inviteStatusLine(inv)}
                      </Text>
                    </View>
                    {inv.status === 'pending' && (
                      <Button title="Revoke" variant="ghost" onPress={() => setRevoking(inv)} disabled={busy} />
                    )}
                  </Card>
                ))}
              </>
            )}
          </>
        )}

        {step === 'invite' && (
          <>
            <Text style={styles.title}>Invite someone</Text>
            <TextField
              label="Their name"
              value={nameDraft}
              onChangeText={setNameDraft}
              autoCapitalize="sentences"
              placeholder="e.g. Toni"
            />
            <TextField
              label="Their email (optional)"
              value={emailDraft}
              onChangeText={setEmailDraft}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="toni@example.com"
            />
            <Text style={styles.muted}>
              With an address you can email the invite, and a claim from any other
              account is flagged to you. Without one you hand the code over yourself.
            </Text>
          </>
        )}

        {step === 'code' && code && (
          <>
            <View style={styles.doneHead}>
              <DrawnIcon kind="tick" size={30} strokeWidth={5} />
              <Text style={styles.title}>The invite is ready</Text>
            </View>
            <Text style={styles.body}>
              This code opens the portfolio for {nameDraft.trim() || 'them'}, so hand it over
              the way you would hand over a key.
            </Text>
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
            {/* The same share row as Receive, carrying a link that opens Talia
                on the join page (decided 2026-09-14). */}
            <ShareRow onShare={(target) => void shareVia(target, inviteMessage())} />
          </>
        )}
      </StepTransition>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      <AuthSheet
        visible={authOpen}
        defaultMode="signin"
        onClose={() => {
          setAuthOpen(false);
          pendingAfterAuth.current = null;
        }}
        onAuthed={() => {
          setAuthOpen(false);
          const what = pendingAfterAuth.current;
          pendingAfterAuth.current = null;
          if (what === 'share') void startSharing();
          else if (what === 'invite') void createInvite();
          else {
            void refresh();
            void syncVirtualVaults();
          }
        }}
      />

      <AppDialog
        visible={removing != null}
        title={removing ? `Remove ${removing.email || 'this person'}?` : ''}
        actions={[
          { label: 'Remove', destructive: true, onPress: () => removing && void doRemove(removing) },
          { label: 'Cancel', variant: 'ghost', onPress: () => setRemoving(null) },
        ]}
        onClose={() => setRemoving(null)}
      />
      <AppDialog
        visible={revoking != null}
        title={revoking ? `Revoke the invite for ${revoking.inviteeLabel || revoking.inviteeEmail || 'this person'}?` : ''}
        actions={[
          { label: 'Revoke', destructive: true, onPress: () => revoking && void doRevoke(revoking) },
          { label: 'Keep it', variant: 'ghost', onPress: () => setRevoking(null) },
        ]}
        onClose={() => setRevoking(null)}
      />
      <AppDialog
        visible={stopping}
        title="Stop sharing for everyone?"
        actions={[
          { label: 'Stop sharing', destructive: true, onPress: () => void doStop() },
          { label: 'Cancel', variant: 'ghost', onPress: () => setStopping(false) },
        ]}
        onClose={() => setStopping(false)}
      />
      <AppDialog
        visible={leaving}
        title="Leave this portfolio?"
        actions={[
          { label: 'Leave', destructive: true, onPress: () => void doLeave() },
          { label: 'Cancel', variant: 'ghost', onPress: () => setLeaving(false) },
        ]}
        onClose={() => setLeaving(false)}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // No bottom padding of its own: the Screen pads for its footer, or the
    // safe area when a step has none.
    content: { gap: theme.spacing.md },
    stepWrap: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite, flexShrink: 1 },
    body: { ...theme.typography.body, color: theme.colors.slate },
    muted: { ...theme.typography.caption, color: theme.colors.slate },
    warnText: { color: theme.colors.gold },
    card: { gap: theme.spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    sectionLabel: {
      ...theme.typography.label,
      color: theme.colors.slate,
      letterSpacing: 1,
      marginTop: theme.spacing.md,
    },
    codeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.lg,
    },
    // A code is a code: the mono token, like every key in the app, and the
    // same style as the heir invite's code card.
    codeText: { ...theme.typography.mono, color: theme.colors.offWhite, flex: 1 },
    copyBtn: { padding: theme.spacing.sm },
    copiedText: { ...theme.typography.caption, color: theme.colors.accentText },
    doneHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    notice: { ...theme.typography.caption, color: theme.colors.slate },
  }),
);
