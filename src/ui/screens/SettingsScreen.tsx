/** Settings — BlueWallet-style menu: logo on top, grouped rows, powered-by.
 *
 * ONE page, two states (decided 2026-07-26): logged out shows the app settings
 * plus a single log-in row; logged in surfaces every 21st Capital service
 * directly (rescue, support, profile, subscriptions, inheritance) instead
 * of hiding them behind the account hub. */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { SettingsTabParamList, TabRootScreenProps } from '../navigation/types';
import {
  Gloss,
  BellIcon,
  Screen,
  TaliaLogo,
  BroadcastIcon,
  FingerprintIcon,
  ReportAnalyticsIcon,
  SettingsGearIcon,
  cardGlow,
} from '../components';
import { theme, themedStyles, getColorScheme } from '../theme';
import {
  WorldIcon,
  XIcon,
  InstagramIcon,
  TelegramOutlineIcon,
  ParachuteIcon,
  HeadsetIcon,
  UserIcon,
  TrashIcon,
  LogoutIcon,
  StethoscopeIcon,
} from '../components/TablerIcons';
import { MenuDivider, MenuRow, WalletIconGlyph, dockFollowScroll, dockSyncScroll } from '../components';
import { useEliteServices } from '../hooks/useEliteServices';
import { ELITE_COPY } from './eliteServicesCopy';
import {
  APP_BUILD,
  APP_VERSION,
  COMPANY_LINKS,
  HWW_ENABLED,
  LEDGER_PREVIEW,
  PURCHASES_ENABLED,
  SIGNING_ENABLED,
} from '../../config';
import { STORE_COPY, appKindLabel, betaMark } from './storeCopy';
import { loadSession, signOut } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { cancelAllPendingCosigns } from '../../services/cosign';
import { notificationsAvailable } from '../../platform/notifications';
import { AppDialog, AuthSheet } from '../components';

type Props = TabRootScreenProps<SettingsTabParamList, 'Settings', 'SettingsTab'>;


export function SettingsScreen({ navigation }: Props): React.JSX.Element {

  // Tab icon press jumps to the top (decided 2026-07-18).
  const scrollRef = useRef<ScrollView | null>(null);
  const lastScrollY = useRef(0);
  // The dock's names fold once the page scrolls and return at the top; the
  // tab coming back into focus restates its own resting position.
  useEffect(() => {
    dockSyncScroll(lastScrollY.current);
    return navigation.addListener('focus', () => dockSyncScroll(lastScrollY.current));
  }, [navigation]);
  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    return parent.addListener('tabPress' as never, () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [navigation]);

  // Logged-in state drives which rows exist; refreshed every focus so a
  // login/logout elsewhere reflects here immediately.
  const [session, setSession] = useState<CompanySession | null>(null);
  /** Sign-in happens IN PLACE on this page (decided 2026-07-27): the row used to
   *  navigate into the Estate Plan screen, which is where the user landed
   *  after logging in instead of on their own settings. */
  const [authOpen, setAuthOpen] = useState(false);
  /** Log out asks first (decided 2026-10-05: "ask him to confirm the logout
   *  instead of immediately logging him out"): the row opens the dialog,
   *  only its "Log out" signs out. */
  const [logoutAsk, setLogoutAsk] = useState(false);
  /** What Elite Services holds for this client: whether the row shows, and
   *  its line (decided 2026-09-21: one row that opens its own page). */
  const elite = useEliteServices(navigation);
  useEffect(() => {
    let live = true;
    const check = () =>
      void loadSession().then((s) => {
        if (live) setSession(s);
      });
    const unsub = navigation.addListener('focus', check);
    check();
    return () => {
      live = false;
      unsub();
    };
  }, [navigation]);

  // Cancel in-flight co-sign requests while the session is still valid —
  // signed out the app can't fetch 21C's signature to finish them (decided
  // 2026-07-23) — then sign out, which asks the server to revoke the
  // refresh token before forgetting the session here. Best-effort on both:
  // being offline must not trap the user in a logged-in state.
  const onLogout = async () => {
    const s = await loadSession();
    if (s) {
      try {
        await cancelAllPendingCosigns(s);
      } catch {
        // offline — the requests get cancelled on the next login instead
      }
    }
    await signOut(s);
    setSession(null);
    elite.reload();
  };

  return (
    <View style={styles.page}>
    <Screen
      scroll
      scrollRef={scrollRef}
      style={styles.content}
      onScroll={(y) => {
        lastScrollY.current = y;
        dockFollowScroll(y);
      }}>
      <View style={styles.logoBlock}>
        <TaliaLogo size={56} variant="lockup" />
        <Text style={styles.tagline}>Descriptor-native Bitcoin wallet</Text>
      </View>

      <Text style={styles.sectionLabel}>APP</Text>
      <View style={styles.group}>
        <Gloss radius={theme.radius.lg} strength={cardGlow()} />
        <MenuRow
          icon={<SettingsGearIcon size={20} color={theme.colors.gold} />}
          label="General"
          sub="Units (BTC/sats) and fiat currency"
          onPress={() => navigation.navigate('DisplaySettings')}
        />
        <Divider />
        <MenuRow
          icon={<BroadcastIcon size={20} color={theme.colors.gold} />}
          label="Network"
          sub="Electrum server for your Bitcoin vaults"
          onPress={() => navigation.navigate('NetworkSettings')}
        />
        <Divider />
        <MenuRow
          icon={<FingerprintIcon size={20} color={theme.colors.gold} />}
          label="Security"
          sub="Face ID, PIN, two-factor, hidden categories"
          onPress={() => navigation.navigate('SecuritySettings')}
        />
        {notificationsAvailable() && (
          <>
            <Divider />
            <MenuRow
              icon={<BellIcon size={20} color={theme.colors.gold} />}
              label="Notifications"
              sub="Timelock reminders and alerts"
              onPress={() => navigation.navigate('NotificationSettings')}
            />
          </>
        )}
        <Divider />
        <MenuRow
          icon={<ReportAnalyticsIcon size={20} color={theme.colors.gold} />}
          label="Portfolio Sync"
          sub="Same portfolios on every phone, encrypted"
          onPress={() => navigation.navigate('VaultSync')}
        />
        {/* The wallet library's check, the connection test and the report
            (BDK upgrade, decided 2026-10-15): the builds with hardware signing,
            never the App Store app. Named as the Diagnostics page names its
            sections since the old engine's removal (decided 2026-11-04). */}
        {HWW_ENABLED && (
          <>
            <Divider />
            <MenuRow
              icon={<StethoscopeIcon size={20} color={theme.colors.gold} />}
              label="Diagnostics"
              sub="Wallet library, connection test, report"
              onPress={() => navigation.navigate('Diagnostics')}
            />
          </>
        )}
        {/* Hardware connects inside the vault flows now (decided 2026-09-01):
            keys are read during creation, registration runs from the vault,
            and Receive verifies addresses. No standalone device pages. */}
      </View>


      {session ? (
        <>
          <Text style={styles.sectionLabel}>
            21ST CAPITAL{session.email ? ` · ${session.email.toUpperCase()}` : ''}
          </Text>
          <View style={styles.group}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            {/* The order of the website's own settings (decided 2026-09-21: "starting
                with inheritance feels a bit wrong, I would start with
                profile; it should match the website"): Profile, the Estate
                Plan, the plan, then help. Rescue sits with the Estate Plan,
                the other vault service. */}
            <MenuRow
              icon={<UserIcon size={20} color={theme.colors.gold} />}
              label="Profile"
              sub="Name, phone, country"
              onPress={() => navigation.navigate('GeneralInfo')}
            />
            {/* Estate Plan questionnaire + rescue ceremony, restored to
                the Ledger preview (decided 2026-08-26). */}
            {(SIGNING_ENABLED || LEDGER_PREVIEW) && (
              <>
                <Divider />
                <MenuRow
                  icon={<WalletIconGlyph icon="users-group" size={20} />}
                  label="Estate Plan"
                  sub="Set up, read or export your plan"
                  onPress={() => navigation.navigate('Inheritance')}
                />
                <Divider />
                <MenuRow
                  icon={<ParachuteIcon size={20} color={theme.colors.gold} />}
                  label="Rescue"
                  sub="Recover a vault via its rescue key"
                  onPress={() => navigation.navigate('Rescue')}
                />
              </>
            )}
            <Divider />
            {/* The builds that sell nothing show the plan, never billing
                (guideline 3.1.1, Apple's letter of 2026-09-11). */}
            <MenuRow
              icon={<WalletIconGlyph icon={PURCHASES_ENABLED ? 'credit-card' : 'star'} size={20} />}
              label={PURCHASES_ENABLED ? 'Subscriptions' : STORE_COPY.membershipLabel}
              sub={PURCHASES_ENABLED ? 'Your plan, renewal, cancellation' : STORE_COPY.membershipSub}
              onPress={() => navigation.navigate('Subscriptions')}
            />
            {/* Elite Services: ONE row that opens its own page (decided 2026-09-21:
                "a menu among Profile, Estate Plan and other that would open
                another page with all the options, and not an entire separate
                section"). After the plan, as on the website. */}
            {elite.count > 0 && (
              <>
                <Divider />
                <MenuRow
                  icon={<WalletIconGlyph icon="crown" size={20} />}
                  label={ELITE_COPY.title}
                  sub={elite.summary}
                  onPress={() => navigation.navigate('EliteServices')}
                />
              </>
            )}
            <Divider />
            <MenuRow
              icon={<HeadsetIcon size={20} color={theme.colors.gold} />}
              label="Support"
              sub="Get help from the 21st Capital team"
              onPress={() => navigation.navigate('Support')}
            />
            <Divider />
            <MenuRow
              icon={<TrashIcon size={20} color={theme.colors.gold} />}
              label="Delete account"
              sub="Confirmed by email. Your funds are unaffected."
              onPress={() => navigation.navigate('DeleteAccount')}
            />
            <Divider />
            <MenuRow
              icon={<LogoutIcon size={20} color={theme.colors.gold} />}
              label="Log out"
              sub="Your vaults stay on this phone"
              onPress={() => setLogoutAsk(true)}
            />
          </View>
        </>
      ) : (
        <View style={styles.group}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <MenuRow
            icon={<WalletIconGlyph icon="shield" size={20} />}
            label="Log in to 21st Capital"
            sub="Co-signing, rescue, inheritance & support"
            onPress={() => setAuthOpen(true)}
          />
        </View>
      )}

      <View style={styles.group}>
        <Gloss radius={theme.radius.lg} strength={cardGlow()} />
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          {betaMark(HWW_ENABLED, PURCHASES_ENABLED) ? (
            <View style={styles.aboutValues}>
              <Text style={styles.aboutValue}>
                {APP_VERSION} ({APP_BUILD}) · {appKindLabel(HWW_ENABLED, PURCHASES_ENABLED)}
              </Text>
              <Text style={styles.betaMark}>{betaMark(HWW_ENABLED, PURCHASES_ENABLED)}</Text>
            </View>
          ) : (
            <Text style={styles.aboutValue}>
              {APP_VERSION} ({APP_BUILD}) · {appKindLabel(HWW_ENABLED, PURCHASES_ENABLED)}
            </Text>
          )}
        </View>
      </View>

      {/* 21st Capital footer (Aqua-style): logo, legal, official handles. */}
      <View style={styles.companyBlock}>
        <Image
          source={
            getColorScheme() === 'dark'
              ? require('../../../assets/21c_logo_white.png')
              : require('../../../assets/21c_logo_black.png')
          }
          style={styles.companyLogo}
          resizeMode="contain"
        />
        <Text style={styles.poweredBy}>TALIA by 21st Capital</Text>

        <TouchableOpacity onPress={() => Linking.openURL(COMPANY_LINKS.terms)}>
          <Text style={styles.legalLink}>Terms</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL(COMPANY_LINKS.privacy)}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
        </TouchableOpacity>

        <View style={styles.socialRow}>
          {/* The homepage leads to the vault configurator and its checkout,
              so the builds that sell nothing leave it out (App Review 3.1.1,
              2026-09-12). Terms, Privacy and the social links stay. */}
          {PURCHASES_ENABLED && (
            <TouchableOpacity onPress={() => Linking.openURL(COMPANY_LINKS.website)} accessibilityLabel="Website">
              <WorldIcon size={26} color={theme.colors.slate} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => Linking.openURL(COMPANY_LINKS.x)} accessibilityLabel="X">
            <XIcon size={26} color={theme.colors.slate} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(COMPANY_LINKS.instagram)} accessibilityLabel="Instagram">
            <InstagramIcon size={26} color={theme.colors.slate} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(COMPANY_LINKS.telegram)} accessibilityLabel="Telegram">
            <TelegramOutlineIcon size={26} color={theme.colors.slate} />
          </TouchableOpacity>
        </View>
      </View>
      <AuthSheet
        visible={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={(s) => {
          setAuthOpen(false);
          setSession(s); // the logged-in menu appears right here
          elite.reload();
        }}
      />
      {/* A title and its buttons, nothing to read (decided 2026-09-02). */}
      <AppDialog
        visible={logoutAsk}
        title="Log out?"
        actions={[
          {
            label: 'Log out',
            destructive: true,
            onPress: () => {
              setLogoutAsk(false);
              void onLogout();
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setLogoutAsk(false) },
        ]}
        onClose={() => setLogoutAsk(false)}
      />
    </Screen>
    </View>
  );
}

const Divider = MenuDivider;

const styles = themedStyles(() => StyleSheet.create({
  page: { flex: 1 },
  content: { gap: theme.spacing.lg, paddingBottom: 140 },
  logoBlock: { alignItems: 'center', gap: theme.spacing.xs, marginVertical: theme.spacing.md },
  tagline: { ...theme.typography.caption, color: theme.colors.slate },

  group: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
  },
  sectionLabel: {
    ...theme.typography.label,
    color: theme.colors.slate,
    letterSpacing: 1,
    marginBottom: -theme.spacing.sm,
    marginLeft: theme.spacing.sm,
  },

  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Top-aligned so a value that wraps can't drag its label to the middle of
    // the row (same fix as SendScreen infoRow / CosignRequestPanel row).
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  // The signing TestFlight app's BETA line sits under the version value.
  aboutValues: { flexShrink: 1, alignItems: 'flex-end' },
  // An eyebrow, spaced like the section labels above.
  betaMark: {
    ...theme.typography.label,
    color: theme.colors.gold,
    letterSpacing: 1,
    marginTop: 2,
  },
  aboutLabel: { ...theme.typography.heading, color: theme.colors.offWhite },
  aboutValue: {
    ...theme.typography.caption,
    color: theme.colors.slate,
    // Without flexShrink the value can never wrap: it overflows and is cut off
    // by the group's overflow:'hidden' at large text sizes.
    flexShrink: 1,
    textAlign: 'right',
    // The label's own line box, so the two sit on one line.
    lineHeight: theme.typography.heading.lineHeight,
  },

  companyBlock: { alignItems: 'center', gap: theme.spacing.md, marginTop: theme.spacing.xl },
  companyLogo: { width: 150, height: 44 },
  poweredBy: { ...theme.typography.caption, color: theme.colors.faint },
  legalLink: {
    ...theme.typography.body,
    color: theme.colors.accentText,
    textDecorationLine: 'underline',
  },
  socialRow: {
    flexDirection: 'row',
    gap: theme.spacing.xl,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
}));
