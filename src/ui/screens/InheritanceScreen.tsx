/**
 * 21st Capital Account: Aqua-style client hub (redesign of 2026-07-16).
 *
 * One account for everything the app will offer logged-in users over time.
 * Logged out: branded sign-in (email → emailed 6-digit code; the code field
 * declares `oneTimeCode` so iOS offers it above the keyboard from Apple
 * Mail, plus a "Paste code" helper). Logged in: profile header + CLIENT
 * SERVICES list — the inheritance protocol appears ONLY for accounts that
 * actually have one (checked against the backend); everyone else gets a
 * become-a-client teaser instead. Sessions live in the Keychain for 24 h
 * (no refresh endpoint yet). 2FA accounts get a not-supported-yet message.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// react-native-webview 14's prop typings clash with React 19's JSX checker
// (every overload collapses to `props: never`). The runtime component is
// fine — alias it loosely and keep our own ref type.
const WebViewComponent = WebView as unknown as React.ComponentType<Record<string, unknown>>;
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { HeaderIconButton, Gloss, PageHead, ChevronLeftIcon, ChevronRightIcon, AppDialog, Button, Card, CodeField, FOOTER_ROOM, PageFooter, TextField, WalletIconGlyph, MailIcon, DeviceMobileIcon, IosShareIcon, cardGlow } from '../components';
import { StepTransition } from '../components/StepTransition';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import { keyboardInsets } from '../hooks/keyboardInsets';
import type { DialogAction } from '../components';
import { useWallets } from '../../wallet';
import { UserIcon } from '../components/TablerIcons';
import { theme, themedStyles, getColorScheme } from '../theme';
import { COMPANY_LINKS, PURCHASES_ENABLED } from '../../config';
import { STORE_COPY } from './storeCopy';
import { downloadAndShareFile } from '../../platform/files';
import {
  INHERITANCE_PDF_URL,
  authHeaders,
  clearSession,
  hasInheritanceProtocol,
  loadSession,
  requestOtp,
  verifyOtp,
  verifyMfa,
  recoverMfa,
} from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { loadOwnerInvites } from '../../services/heirInvite';
import type { OwnerInviteRecord } from '../../services/heirInvite';
import { fetchSubscriptions, activePlanTier, hasActiveSubscription } from '../../services/billing';
import { estatePlanPdfUrl, fetchEstatePlanOverview, fetchFiledPlanHeirs } from '../../services/inheritance';
import { heirName, heirTitle, withFiledNames } from '../../wallet/heirNames';
import type { EstatePlanOverview, EstatePlanVault } from '../../services/inheritance';
import { fetchProfile } from '../../services/settingsApi';
import { estateOwnerLine } from '../../services/vaultHolders';
import type { PlanTier } from '../../services/billing';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Inheritance'>;

type Stage =
  | { kind: 'restoring' } // checking Keychain on mount
  | { kind: 'login' }
  | { kind: 'sending' }
  | { kind: 'codeSent' } // OTP emailed — show the 6-digit input
  | { kind: 'verifying' }
  | { kind: 'mfa'; tempToken: string } // 2FA account — authenticator step
  | { kind: 'hub'; session: CompanySession }
  | { kind: 'pdf'; session: CompanySession; submissionId?: number; label?: string }
  | { kind: 'website' }; // in-app browser (register, explore services)


/** Membership badge look per tier (decided 2026-07-23): Premium orange, Elite gold,
 *  Elite Plus a diamond. Reads theme colours live (not captured at module load). */
function tierMeta(tier: PlanTier): { label: string; color: string; diamond?: boolean } {
  switch (tier) {
    case 'premium':
      return { label: 'Premium', color: theme.colors.bitcoinOrange };
    case 'elite':
      return { label: 'Elite', color: theme.colors.gold };
    case 'elite-plus':
      return { label: 'Elite Plus', color: theme.colors.info, diamond: true };
  }
}

export function InheritanceScreen({ navigation }: Props): React.JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: 'restoring' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The login and sign-in forms both scroll so the field being typed in and
  // the button under it stay above the keyboard (decided 2026-09-18).
  const revealScrollRef = useRef<ScrollView | null>(null);
  const revealOffsetY = useRef(0);
  // With a pinned footer the confirm rises above the keys on its own, so only
  // the field has to clear the footer's fade (decided 2026-10-05). The sign-in's
  // Continue and the authenticator step's Cancel (with the recovery code's
  // Verify) are footed; the emailed code submits itself and has no footer.
  const formFooted = stage.kind === 'login' || stage.kind === 'sending' || stage.kind === 'mfa';
  // `reveal` again when a stage's content grows under the keys: the line
  // saying why a code was refused arrives under the boxes after they were
  // lifted (decided 2026-10-18), on the emailed code and the authenticator
  // code alike.
  const { reveal } = useRevealFocusedField(revealScrollRef, revealOffsetY, true, { confirmPinned: formFooted });
  // Every stage draws its own ScrollView at the same place, so React keeps ONE
  // native scroll view across them, and each passes `keyboardInsets` for its
  // own footer: the emailed code's keyboard inset is never left under the
  // authenticator step's footer (decided 2026-10-18, hooks/keyboardInsets.ts).
  //
  // This page draws its own scroll views, so a stage without a footer pads
  // the safe area itself, as SignPsbt and TwoFactor do; with one, the safe
  // area is the footer's and the content ends at its fade.
  const insets = useSafeAreaInsets();
  const safeBottom = { paddingBottom: insets.bottom + theme.spacing.lg };

  /** null = still checking; drives whether the protocol row exists at all. */
  const [hasProtocol, setHasProtocol] = useState<boolean | null>(null);
  /** Every vault the backend knows, each with its plan or none (decided
   *  2026-09-04: one filed plan must never hide the way to file the next).
   *  null until loaded or when the backend has no vault rows for the
   *  account, in which case the single-plan view below stands in. */
  const [overview, setOverview] = useState<EstatePlanOverview | null>(null);
  /** Bumped on every focus so a plan filed a moment ago shows up. */
  const [refreshTick, setRefreshTick] = useState(0);
  const [planTier, setPlanTier] = useState<PlanTier | null>(null);
  /** null = still checking. The Estate Plan needs an ACTIVE plan, not just
   *  an account (decided 2026-07-27): offering the form to someone who cannot
   *  submit it wasted their whole walk through the wizard. */
  const [planActive, setPlanActive] = useState<boolean | null>(null);

  // Inheritance is only for vaults secured WITH 21st Capital keys (co-signer /
  // rescue) — never a purely self-custodial vault; `locked` = a pre-payment
  // vault. From Settings we must pick the vault (the in-vault entry already
  // knows it), so the wizard opens on a real vault and prefills from it.
  const { wallets, updateWallet } = useWallets();
  const eligibleVaults = useMemo(
    () =>
      wallets.filter(
        (w) =>
          (w.providerKeyFingerprints?.length ?? 0) > 0 &&
          !w.locked &&
          // The Estate Plan is the OWNER's document — never an inherited vault.
          !w.heirVault,
      ),
    [wallets],
  );

  // Every heir named across this phone's vaults + their invite state (decided
  // 2026-07-26). Names/emails come from the local wallet records; invite
  // state from the local owner-invite records — nothing fetched.
  const [ownerInviteRecords, setOwnerInviteRecords] = useState<OwnerInviteRecord[]>([]);
  useEffect(() => {
    const check = () => void loadOwnerInvites().then(setOwnerInviteRecords);
    const unsub = navigation.addListener('focus', check);
    check();
    return unsub;
  }, [navigation]);
  const heirRows = useMemo(() => {
    const rows: Array<{
      walletId: string;
      vaultLabel: string;
      id?: string;
      email?: string;
      fingerprint?: string;
      name: string;
      invited: boolean;
    }> = [];
    for (const w of wallets) {
      // Heir INVITES are a 21st Capital service (decided 2026-07-27): heirs of a
      // purely self-custodial vault are managed by the owner directly — no
      // invite rows, or a tap would dead-end in a 21C-only flow.
      if ((w.providerKeyFingerprints?.length ?? 0) === 0) continue;
      (w.heirs ?? []).forEach((h, idx) => {
        const fp = h.fingerprint?.toLowerCase();
        const email = h.email?.trim() || undefined;
        const invited = ownerInviteRecords.some((r) => {
          if (r.walletId !== w.id) return false;
          if (fp) return r.heirFingerprint === fp;
          if (h.id && r.heirId) return r.heirId === h.id;
          return !!email && (r.heirEmail ?? '') === email.toLowerCase();
        });
        rows.push({
          walletId: w.id,
          vaultLabel: w.label,
          id: h.id,
          email,
          fingerprint: fp,
          // The person, never the label of the key they hold (decided 2026-09-21).
          name: heirTitle(h, idx),
          invited,
        });
      });
    }
    return rows;
  }, [wallets, ownerInviteRecords]);
  // InviteHeir is on the root stack with this screen: it opens over the
  // hub, and Back returns here.
  const openInviteHeir = (walletId: string) => {
    navigation.navigate('InviteHeir', { walletId });
  };
  const [vaultPicker, setVaultPicker] = useState<{
    title: string;
    message?: string;
    actions: DialogAction[];
  } | null>(null);

  const startInheritance = () => {
    if (planActive === false) {
      setVaultPicker(
        PURCHASES_ENABLED
          ? {
              title: 'An active plan is needed',
              message:
                'Your Estate Plan is part of your 21st Capital plan. Activate your plan and we will write it together, here in the app.',
              actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
            }
          : {
              // The builds that sell nothing never ask the client to buy
              // (Apple 3.1.1): they offer a conversation instead.
              title: STORE_COPY.estateDialogTitle,
              actions: [
                { label: STORE_COPY.talkToUs, variant: 'primary', onPress: () => navigation.navigate('Support') },
                { label: 'OK', variant: 'ghost', onPress: () => {} },
              ],
            },
      );
      return;
    }
    if (eligibleVaults.length === 0) {
      setVaultPicker({
        title: 'A 21st Capital vault is needed',
        // "Create or activate" is a call to buy; the builds that sell
        // nothing keep the title alone.
        message: PURCHASES_ENABLED
          ? 'An Estate Plan is written for a vault secured with 21st Capital keys, not a self-custodial one. Create or activate such a vault first.'
          : undefined,
        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
      });
      return;
    }
    // Never the wizard with no vault behind it (decided 2026-09-24): every plan
    // is for one vault, and the wizard states which rather than asking. This
    // button only shows where the per-vault list could not be loaded, so it
    // names the vault itself when there is exactly one; with several the
    // wizard still asks, which is the only case left where it must.
    const only = eligibleVaults.length === 1 ? eligibleVaults[0] : undefined;
    navigation.navigate('InheritanceSetup', {
      walletId: only?.id ?? eligibleVaults[0].id,
      ...(only?.accountNumber != null ? { account: only.accountNumber } : {}),
    });
  };
  /** File the plan for ONE vault (decided 2026-09-04): the wizard opens with that
   *  vault's account preselected, prefilled from the local vault that holds
   *  the account number when this phone has it. */
  const startInheritanceFor = (v: EstatePlanVault) => {
    if (planActive === false) {
      startInheritance(); // shows the "active plan needed" dialog
      return;
    }
    const local = wallets.find((w) => w.accountNumber === v.account && !w.heirVault);
    navigation.navigate('InheritanceSetup', {
      walletId: local?.id ?? eligibleVaults[0]?.id,
      account: v.account,
    });
  };
  /** What to call a vault row: the phone's own name for it when known. */
  const vaultRowTitle = (v: EstatePlanVault) => {
    const local = wallets.find((w) => w.accountNumber === v.account);
    return local?.label ?? (v.vaultNumber != null ? `Vault ${v.vaultNumber}` : `Account ${v.account}`);
  };
  /** Vaults with our keys on this phone that the backend has no row for
   *  (built before per-vault keys, no account number): they cannot carry a
   *  plan of their own until they are activated with us. */
  const unregisteredLocalVaults = useMemo(
    () => eligibleVaults.filter((w) => w.accountNumber == null),
    [eligibleVaults],
  );

  useEffect(() => {
    void loadSession().then((session) => {
      setStage(session ? { kind: 'hub', session } : { kind: 'login' });
    });
  }, []);

  // Heirs of a plan filed before 2026-09-21 have no name on the vault yet:
  // read the names back from the filed plans, once per visit.
  const namesAskedRef = useRef(false);
  useEffect(() => {
    if (stage.kind !== 'hub' || namesAskedRef.current) return;
    const unnamed = wallets.filter((w) => (w.heirs ?? []).some((h) => !heirName(h)));
    if (unnamed.length === 0) return;
    namesAskedRef.current = true;
    void fetchFiledPlanHeirs(stage.session)
      .then(async (filed) => {
        for (const w of unnamed) {
          const named = withFiledNames(w.heirs ?? [], filed);
          if (named.changed) await updateWallet(w.id, { heirs: named.heirs });
        }
      })
      .catch(() => {});
  }, [stage, wallets, updateWallet]);

  // Whether this account is a protocol customer decides the hub's contents.
  useEffect(() => {
    if (stage.kind !== 'hub') return;
    let cancelled = false;
    setHasProtocol(null);
    void hasInheritanceProtocol(stage.session).then(
      (yes) => !cancelled && setHasProtocol(yes),
    );
    void fetchEstatePlanOverview(stage.session)
      .then((o) => !cancelled && setOverview(o.vaults.length > 0 ? o : null))
      .catch(() => !cancelled && setOverview(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind === 'hub' ? stage.session.accessToken : null, refreshTick]);
  useEffect(
    () => navigation.addListener('focus', () => setRefreshTick((t) => t + 1)),
    [navigation],
  );

  // Membership tier → profile badge (Premium / Elite / Elite Plus).
  useEffect(() => {
    if (stage.kind !== 'hub') {
      setPlanTier(null);
      setPlanActive(null);
      return;
    }
    let cancelled = false;
    // The backend accepts an estate plan from an ACTIVE subscriber or a
    // Lifetime Elite member (no subscription row): the same two here, so
    // the hub never turns away someone the backend would accept.
    void Promise.all([
      fetchSubscriptions(stage.session),
      fetchProfile(stage.session).catch(() => null),
    ])
      .then(([subs, profile]) => {
        if (cancelled) return;
        const tier = activePlanTier(subs);
        setPlanTier(tier ?? (profile?.lifetimeElite ? 'elite' : null));
        setPlanActive(hasActiveSubscription(subs) || profile?.lifetimeElite === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind === 'hub' ? stage.session.accessToken : null]);

  // No sign-in by link (decided 2026-09-26): a
  // tiam://auth/callback link could replace this phone's session with an
  // account the owner never chose. Sign-in is the emailed code alone.

  // The default header back on the PDF returns to the account hub instead of
  // leaving the whole screen: the in-page "< Account" pill is gone (decided
  // 2026-07-24: one back control, the standard one).
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (stage.kind !== 'pdf') return;
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      e.preventDefault();
      setStage({ kind: 'hub', session: stage.session });
    });
    return sub;
  }, [navigation, stage]);

  const onSendCode = async () => {
    setError(null);
    setStage({ kind: 'sending' });
    try {
      await requestOtp(email.trim());
      setCode('');
      setStage({ kind: 'codeSent' });
    } catch (e) {
      setError((e as Error).message);
      setStage({ kind: 'login' });
    }
  };

  const onVerifyCode = async (theCode: string) => {
    setError(null);
    setStage({ kind: 'verifying' });
    try {
      const result = await verifyOtp(email.trim(), theCode.trim());
      if (result.kind === 'mfaRequired') {
        setMfaCode('');
        setUseRecovery(false);
        setStage({ kind: 'mfa', tempToken: result.tempToken });
        return;
      }
      setStage({ kind: 'hub', session: result.session });
    } catch (e) {
      setError((e as Error).message);
      setStage({ kind: 'codeSent' });
    }
  };

  const onVerifyMfa = async (tempToken: string, codeOverride?: string) => {
    const c = (codeOverride ?? mfaCode).trim();
    setError(null);
    setStage({ kind: 'verifying' });
    try {
      const session = useRecovery
        ? await recoverMfa(email.trim(), tempToken, c)
        : await verifyMfa(email.trim(), tempToken, c);
      setStage({ kind: 'hub', session });
    } catch (e) {
      setError((e as Error).message);
      setStage({ kind: 'mfa', tempToken });
    }
  };

  // Log out moved to the Settings page (decided 2026-07-26): this hub is
  // purely inheritance now.

  // Export = authenticated download to the sandboxed cache → share sheet
  // (AirDrop, Files, print, …) → immediate delete. Nothing lingers on disk.
  const [exporting, setExporting] = useState(false);
  // The share action is the screen header's own right item while the
  // document is open (decided 2026-09-04: the standard white share glyph at the
  // very top right, never floating over the PDF). Reads the stage through
  // a ref so the header does not re-mount on every render.
  const stageRef = useRef(stage);
  stageRef.current = stage;
  useLayoutEffect(() => {
    if (stage.kind !== 'pdf') {
      navigation.setOptions({ headerRight: undefined });
      return;
    }
    navigation.setOptions({
      headerRight: () => (
        <HeaderIconButton
          label="Share this Estate Plan"
          disabled={exporting}
          onPress={() => {
            const s = stageRef.current;
            if (s.kind === 'pdf') void onExportPdf(s.session, s.submissionId, s.label);
          }}>
          {exporting ? (
            <ActivityIndicator size="small" color={theme.colors.offWhite} />
          ) : (
            <IosShareIcon size={20} strokeWidth={2.25} color={theme.colors.offWhite} />
          )}
        </HeaderIconButton>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, stage.kind, exporting]);
  const onExportPdf = async (session: CompanySession, submissionId?: number, label?: string) => {
    setError(null);
    setExporting(true);
    try {
      await downloadAndShareFile(
        submissionId != null ? estatePlanPdfUrl(submissionId) : INHERITANCE_PDF_URL,
        authHeaders(session),
        `estate-plan${label ? `-${label.replace(/[^A-Za-z0-9._-]+/g, '-')}` : ''}.pdf`,
        'application/pdf',
      );
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (msg.includes('session has expired')) {
        await clearSession();
        setStage({ kind: 'login' });
      }
    } finally {
      setExporting(false);
    }
  };

  // The hub's one page action, the Estate Plan teaser's button, sits in the
  // page's footer (decided 2026-10-05) when the teaser shows.
  const teaserOffered =
    stage.kind === 'hub' &&
    !overview &&
    hasProtocol === false &&
    planActive === true &&
    eligibleVaults.length > 0;

  // Every stage renders through ONE StepTransition (bottom of this component)
  // so each stage change slides like a screen push — the early-return chain
  // used to hard-swap the whole screen instantly (decided 2026-07-24).
  const renderStage = (): React.JSX.Element => {

  if (stage.kind === 'restoring' || stage.kind === 'verifying') {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator color={theme.colors.gold} />
        {stage.kind === 'verifying' && <Text style={styles.muted}>Confirming your login…</Text>}
      </View>
    );
  }

  if (stage.kind === 'website') {
    return <SiteBrowser onClose={() => setStage({ kind: 'login' })} />;
  }

  if (stage.kind === 'pdf') {
    return (
      <View style={styles.root}>
        <WebViewComponent
          source={{
            uri: stage.submissionId != null ? estatePlanPdfUrl(stage.submissionId) : INHERITANCE_PDF_URL,
            headers: authHeaders(stage.session),
          }}
          style={styles.web}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.gold} />
            </View>
          )}
          onHttpError={(e: { nativeEvent: { statusCode: number } }) => {
            const status = e.nativeEvent.statusCode;
            setError(
              status === 401
                ? 'Your session has expired. Please log in again.'
                : `Could not load your Estate Plan (${status}).`,
            );
            if (status === 401) {
              void clearSession();
              setStage({ kind: 'login' });
            } else {
              setStage({ kind: 'hub', session: stage.session });
            }
          }}
        />
        {/* Share lives in the screen header (standard iOS share glyph, top
            right), never floating over the document (decided 2026-09-04). */}
      </View>
    );
  }

  if (stage.kind === 'hub') {
    const { session } = stage;
    const name =
      [session.firstName, session.lastName].filter(Boolean).join(' ') ||
      session.email ||
      'Client';
    const initials =
      (session.firstName?.[0] ?? session.email?.[0] ?? 'C').toUpperCase() +
      (session.lastName?.[0]?.toUpperCase() ?? '');
    return (
      <ScrollView {...keyboardInsets(teaserOffered)} style={styles.root} contentContainerStyle={[styles.content, teaserOffered ? styles.contentFooted : safeBottom]}>
        {/* Profile header: the hub's hero block, the one block that stays centred. */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.profileName}>{name}</Text>
          {!!session.email && name !== session.email && (
            <Text style={styles.profileEmail}>{session.email}</Text>
          )}
          {planTier &&
            (() => {
              const m = tierMeta(planTier);
              return (
                <View style={[styles.tierBadge, { borderColor: m.color }]}>
                  {m.diamond && <View style={[styles.tierDiamond, { backgroundColor: m.color }]} />}
                  <Text style={[styles.tierText, { color: m.color }]}>{m.label}</Text>
                </View>
              );
            })()}
        </View>

        <View style={styles.section}>
        <Text style={styles.sectionLabel}>ESTATE PLANS</Text>
        <View style={styles.group}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          {hasProtocol === null && (
            <View style={styles.row}>
              <ActivityIndicator color={theme.colors.gold} size="small" />
              <Text style={styles.rowSub}>Loading your services…</Text>
            </View>
          )}
          {overview && (
            <>
              {overview.allVaultsPlan && (
                <>
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.8}
                    onPress={() =>
                      setStage({
                        kind: 'pdf',
                        session,
                        submissionId: overview.allVaultsPlan!.id,
                        label: 'all-vaults',
                      })
                    }>
                    <View style={styles.rowIcon}>
                      <Gloss size={ROW_ICON} radius={theme.radius.md} />
                      <WalletIconGlyph icon="users-group" size={20} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>Estate Plan for all vaults</Text>
                      <Text style={styles.rowSub}>Read your Estate Plan</Text>
                    </View>
                    <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                  </TouchableOpacity>
                  <View style={styles.divider} />
                </>
              )}
              {[...overview.vaults]
                .sort((a, b) => (a.vaultNumber ?? 99) - (b.vaultNumber ?? 99))
                .map((v, i) => {
                  const title = vaultRowTitle(v);
                  const readable = v.plan != null;
                  const fileable = !readable && v.canSubmit;
                  return (
                    <React.Fragment key={v.account}>
                      {i > 0 && <View style={styles.divider} />}
                      <TouchableOpacity
                        style={styles.row}
                        activeOpacity={0.8}
                        disabled={!readable && !fileable}
                        onPress={() =>
                          readable
                            ? setStage({ kind: 'pdf', session, submissionId: v.plan!.id, label: title })
                            : startInheritanceFor(v)
                        }>
                        <View style={styles.rowIcon}>
                          <Gloss size={ROW_ICON} radius={theme.radius.md} />
                          <WalletIconGlyph icon="users-group" size={20} />
                        </View>
                        <View style={styles.rowBody}>
                          <Text style={styles.rowTitle}>{title}</Text>
                          <Text style={[styles.rowSub, fileable && styles.rowSubAccent]}>
                            {/* The payer reads who the vault is for; its owner
                                reads nothing about who pays (decided 2026-09-20). */}
                            {v.heldBy
                              ? estateOwnerLine(v.heldBy)
                              : readable
                                ? v.coveredByAllPlan
                                  ? 'Covered by your plan for all vaults'
                                  : 'Estate Plan filed. Tap to read'
                                : fileable
                                  ? 'No plan yet. Tap to file one'
                                  : 'Waiting for 21st Capital'}
                          </Text>
                        </View>
                        {(readable || fileable) && (
                          <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                        )}
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              {unregisteredLocalVaults.map((w) => (
                <React.Fragment key={w.id}>
                  <View style={styles.divider} />
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.8}
                    onPress={() =>
                      setVaultPicker({
                        title: 'This vault has no account number with us yet',
                        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
                      })
                    }>
                    <View style={styles.rowIcon}>
                      <Gloss size={ROW_ICON} radius={theme.radius.md} />
                      <WalletIconGlyph icon="users-group" size={20} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{w.label}</Text>
                      <Text style={styles.rowSub}>No account number yet</Text>
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </>
          )}
          {!overview && hasProtocol === true && (
            <>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.8}
                onPress={() => setStage({ kind: 'pdf', session })}>
                <View style={styles.rowIcon}>
                  <Gloss size={ROW_ICON} radius={theme.radius.md} />
                  <WalletIconGlyph icon="users-group" size={20} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>Your Estate Plan</Text>
                  <Text style={styles.rowSub}>Read your Estate Plan</Text>
                </View>
                <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
              </TouchableOpacity>
            </>
          )}
          {teaserOffered && (
            <View style={styles.teaser}>
              <Text style={styles.teaserTitle}>Secure your legacy</Text>
              <Text style={styles.rowSub}>
                The document your family follows when they need access.
              </Text>
            </View>
          )}
          {/* Not eligible yet: say WHY here rather than let the client fill
              in the whole wizard and fail at submit (decided 2026-07-27). */}
          {!overview && hasProtocol === false && planActive !== null && (planActive === false || eligibleVaults.length === 0) && (
            <View style={styles.teaser}>
              <Text style={styles.teaserTitle}>Estate Plan</Text>
              <Text style={styles.rowSub}>
                {planActive === false
                  ? PURCHASES_ENABLED
                    ? 'Your Estate Plan comes with a 21st Capital plan. Activate your plan and set up your vault, then write it here.'
                    : STORE_COPY.estateTeaser
                  : 'Your Estate Plan is written for a vault secured with 21st Capital keys. Set that vault up first.'}
              </Text>
            </View>
          )}
          {/* Rescue/Support/Profile/Subscriptions moved to Settings
              (decided 2026-07-26: one page, no duplicates), and this hub keeps
              only what Settings doesn't have: the protocol, delete
              account, and log out. */}
        </View>
        </View>

        {vaultPicker && (
          <AppDialog
            visible
            title={vaultPicker.title}
            message={vaultPicker.message}
            actions={vaultPicker.actions}
            onClose={() => setVaultPicker(null)}
          />
        )}

        {/* YOUR HEIRS (decided 2026-07-26): every heir named across this
            phone's vaults, with their invite state — names and emails are
            already known locally; the server learns nothing new here. */}
        {heirRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>YOUR HEIRS</Text>
            <View style={styles.group}>
              <Gloss radius={theme.radius.lg} strength={cardGlow()} />
              {heirRows.map((h, i) => (
                <React.Fragment key={`${h.walletId}:${h.id ?? h.email ?? h.name}:${h.fingerprint ?? ''}`}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.8}
                    onPress={() => openInviteHeir(h.walletId)}>
                    <View style={styles.rowIcon}>
                      <Gloss size={ROW_ICON} radius={theme.radius.md} />
                      <UserIcon size={20} color={theme.colors.gold} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle}>{h.name}</Text>
                      <Text style={styles.rowSub}>
                        {h.email ? `${h.email} · ` : ''}{h.vaultLabel} ·{' '}
                        {h.invited ? 'Invite sent' : 'No invite yet'}
                      </Text>
                    </View>
                    <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.footnote}>
          Your inheritance, right here in Talia.
        </Text>

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    );
  }

  // Step 2b: two-factor — authenticator (or recovery) code.
  if (stage.kind === 'mfa') {
    const tempToken = stage.tempToken;
    return (
      <ScrollView
        ref={revealScrollRef}
        onScroll={(e) => {
          revealOffsetY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        onContentSizeChange={reveal}
        style={styles.root}
        // Footed on both paths (Cancel, and the recovery code's Verify): the
        // footer rises with the keys, so no inset on top of it.
        {...keyboardInsets(true)}
        contentContainerStyle={[styles.content, styles.contentFooted]}
        keyboardShouldPersistTaps="handled">
        <PageHead
          style={styles.loginHead}
          icon={
            <View style={styles.stepIcon}>
              <Gloss size={STEP_ICON} radius={theme.radius.pill} />
              <DeviceMobileIcon size={30} color={theme.colors.gold} />
            </View>
          }
          tag="AUTHENTICATOR CODE"
          title="Now a different code"
          line={
            useRecovery
              ? 'Enter one of your saved recovery codes.'
              : 'Not the emailed one. Enter the 6-digit code your authenticator app shows right now.'
          }
        />
        {useRecovery ? (
          <TextField
            label="Recovery code"
            value={mfaCode}
            onChangeText={setMfaCode}
            autoCapitalize="none"
            placeholder="xxxx-xxxx"
          />
        ) : (
          <CodeField
            label="Code from your authenticator app"
            value={mfaCode}
            onChange={setMfaCode}
            onComplete={(c) => void onVerifyMfa(tempToken, c)}
            oneTimeCode={false}
            error={error ?? undefined}
            onAlternative={() => {
              setUseRecovery(true);
              setMfaCode('');
              setError(null);
            }}
            alternativeLabel="Use a recovery code"
          />
        )}
        {/* A recovery code is free text, so it keeps its button, in the
            page's footer with Cancel. The 6-digit path submits itself. */}
        {useRecovery && error && <Text style={styles.errorText}>{error}</Text>}
        {/* Only the recovery branch needs this link now: the authenticator
            step carries its own under the prompt. */}
        {useRecovery && (
          <TouchableOpacity
            onPress={() => {
              setUseRecovery(false);
              setMfaCode('');
              setError(null);
            }}>
            <Text style={styles.linkOut}>Use my authenticator app</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // Step 2: the emailed 6-digit code.
  if (stage.kind === 'codeSent') {
    return (
      <ScrollView
        // The one native scroll view of every stage (above): with no ref here
        // React set it to null on this stage and the scroller lifted nothing,
        // so a refused code's line could sit under the keys (decided
        // 2026-10-18). The emailed code has no footer.
        ref={revealScrollRef}
        onScroll={(e) => {
          revealOffsetY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        onContentSizeChange={reveal}
        {...keyboardInsets(false)}
        style={styles.root}
        contentContainerStyle={[styles.content, safeBottom]}
        keyboardShouldPersistTaps="handled">
        <PageHead
          style={styles.loginHead}
          icon={
            <View style={styles.stepIcon}>
              <Gloss size={STEP_ICON} radius={theme.radius.pill} />
              <MailIcon size={30} color={theme.colors.gold} />
            </View>
          }
          tag="EMAIL CODE"
          title="Check your email"
          line={
            <>
              We sent a 6-digit code to{' '}
              <Text style={styles.bodyStrong}>{email.trim()}</Text> (valid 10
              minutes).
            </>
          }
        />
        <CodeField
          label="Enter the code we emailed you"
          value={code}
          onChange={setCode}
          onComplete={(c) => void onVerifyCode(c)}
          onAlternative={() => void onSendCode()}
          alternativeLabel="Send a new code"
          error={error ?? undefined}
        />
        <TouchableOpacity onPress={() => setStage({ kind: 'login' })}>
          <Text style={styles.linkOut}>Use a different email</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Step 1: branded sign-in.
  return (
    <ScrollView
      ref={revealScrollRef}
      onScroll={(e) => {
        revealOffsetY.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      style={styles.root}
      {...keyboardInsets(true)}
      contentContainerStyle={[styles.content, styles.contentFooted]}
      keyboardShouldPersistTaps="handled">
      {/* Centred, like every page head with an icon over its title (decided
          2026-10-05): PageHead is the one piece, on all three sign-in steps. */}
      <PageHead
        style={styles.loginHead}
        icon={
          <Image
            source={
              getColorScheme() === 'dark'
                ? require('../../../assets/21c_logo_white.png')
                : require('../../../assets/21c_logo_black.png')
            }
            style={styles.brandLogo}
            resizeMode="contain"
          />
        }
        title="Your 21st Capital account"
        line="We'll email you a 6-digit code. No password needed."
      />
      <Card style={styles.card}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
      </Card>

      {/* The website this opens leads to the configurator and its checkout,
          so the builds that sell nothing leave it out (Apple 3.1.1). */}
      {PURCHASES_ENABLED && (
        <TouchableOpacity onPress={() => setStage({ kind: 'website' })}>
          <Text style={styles.linkOut}>New to 21st Capital? Create an account</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
  };

  // 'sending' reuses the login JSX (same form, button in its loading state) —
  // sharing the key stops the form re-sliding on every Continue tap.
  const stageKey = stage.kind === 'sending' ? 'login' : stage.kind;
  return (
    <View style={styles.flexOne}>
      <StepTransition
        stepKey={stageKey}
        order={['restoring', 'login', 'codeSent', 'mfa', 'verifying', 'hub', 'pdf', 'website']}
        style={styles.flexOne}>
        {renderStage()}
      </StepTransition>
      {/* Each stage's action at the page's foot, outside the slide (decided
          2026-10-05): the hub's teaser, the authenticator step's Cancel
          (under the recovery code's Verify), the sign-in's Continue. The
          emailed code submits itself. */}
      {teaserOffered && (
        <PageFooter>
          <Button
            title="Set up your comprehensive Estate Plan"
            variant="accent"
            onPress={startInheritance}
          />
        </PageFooter>
      )}
      {stage.kind === 'mfa' && (
        <PageFooter>
          {useRecovery && (
            <Button
              title="Verify"
              variant="accent"
              onPress={() => void onVerifyMfa(stage.tempToken)}
              disabled={mfaCode.trim().length < 4}
            />
          )}
          <Button title="Cancel" variant="ghost" onPress={() => setStage({ kind: 'login' })} />
        </PageFooter>
      )}
      {(stage.kind === 'login' || stage.kind === 'sending') && (
        <PageFooter>
          <Button
            title={stage.kind === 'sending' ? 'Sending…' : 'Continue'}
            variant="accent"
            onPress={() => void onSendCode()}
            disabled={stage.kind === 'sending' || !/^\S+@\S+\.\S+$/.test(email.trim())}
            loading={stage.kind === 'sending'}
          />
        </PageFooter>
      )}
    </View>
  );
}

/** In-app browser of 21stcapital.com (registration, service pages). */
function SiteBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const webRef = useRef<{ goBack: () => void } | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  return (
    <View style={styles.root}>
      <WebViewComponent
        ref={webRef}
        source={{ uri: COMPANY_LINKS.website }}
        style={styles.web}
        onNavigationStateChange={(nav: { canGoBack: boolean }) => setCanGoBack(nav.canGoBack)}
        allowsBackForwardNavigationGestures
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.gold} />
          </View>
        )}
      />
      <TouchableOpacity
        style={styles.webBack}
        onPress={() => (canGoBack ? webRef.current?.goBack() : onClose())}
        accessibilityLabel="Back">
        <ChevronLeftIcon size={16} strokeWidth={2.75} color={theme.colors.offWhite} />
        <Text style={styles.webBackText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * The drawings' measures, named once: the avatar tile and its glyph, the
 * step badge, a row's icon tile and the brand mark on the sign-in.
 */
const AVATAR = 72;
const AVATAR_GLYPH = 26;
const STEP_ICON = 56;
const ROW_ICON = 38;
const LOGO = { width: 132, height: 56 };

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  // Above a pinned footer the content ends at the footer's fade.
  contentFooted: { paddingBottom: FOOTER_ROOM },
  card: { gap: theme.spacing.md },
  // The sign-in steps' title and line are PageHead's (centred, decided
  // 2026-10-05); only the bold email inside the line is this page's.
  bodyStrong: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  errorText: { ...theme.typography.body, color: theme.colors.negative },
  // A footnote under the last card: the one line that stays centred.
  footnote: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },
  // A text link under what it belongs to, in the link colour.
  linkOut: { ...theme.typography.body, color: theme.colors.accentText },

  // The head's room under the header; the head itself is PageHead's.
  loginHead: { marginTop: theme.spacing.lg },
  flexOne: { flex: 1 },
  rowSubAccent: { color: theme.colors.accentText },
  // Distinct badges for the two step-up codes — email vs authenticator — so
  // the second code screen can't be mistaken for the first (decided 2026-07-24).
  stepIcon: {
    width: STEP_ICON,
    height: STEP_ICON,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The head's gap spaces the logo from the title: no margin of its own.
  brandLogo: LOGO,

  // The hub's hero block: the avatar, the name, the tier. Centred, as a
  // hero block is; everything under it is left-aligned.
  profile: { alignItems: 'center', gap: theme.spacing.xs, marginTop: theme.spacing.md },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: theme.colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  // The avatar tile's initials: a sanctioned size of its own, in the display face.
  avatarText: {
    fontSize: AVATAR_GLYPH,
    fontWeight: '800',
    fontFamily: theme.typography.hero.fontFamily,
    color: theme.colors.hull,
  },
  profileName: { ...theme.typography.title, color: theme.colors.offWhite },
  profileEmail: { ...theme.typography.body, color: theme.colors.slate },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1.5,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  tierText: { ...theme.typography.label },
  tierDiamond: { width: 8, height: 8, transform: [{ rotate: '45deg' }], borderRadius: 1 },

  // A section: its eyebrow one `xs` above its group.
  section: { gap: theme.spacing.xs },
  sectionLabel: { ...theme.typography.label, color: theme.colors.slate },
  group: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
  },
  rowIcon: {
    width: ROW_ICON,
    height: ROW_ICON,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  rowSub: { ...theme.typography.caption, color: theme.colors.slate },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.hairline },
  teaser: { paddingVertical: theme.spacing.lg, gap: theme.spacing.md },
  teaserTitle: { ...theme.typography.heading, color: theme.colors.offWhite },

  web: { flex: 1 },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.hull,
  },
  // The in-app browser's floating Back pill: a dock of its own.
  webBack: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    left: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  webBackText: { ...theme.typography.heading, color: theme.colors.offWhite },
}));
