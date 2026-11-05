/**
 * Root navigation (native tabs trial, 2026-09-15).
 *
 * ONE native stack at the root. Its first screen is Apple's own tab bar
 * (`createNativeBottomTabNavigator`, backed by react-native-screens: the
 * Liquid Glass lens that lifts and follows the finger, press-and-slide
 * between tabs, the fold on scroll) with three tabs: Vaults, Portfolios,
 * Settings. Each tab holds its root screen alone, on a one-screen stack of
 * its own; every other screen is pushed on the root stack, over the tab
 * bar. That is React Navigation's documented way to show a tab bar on some
 * screens only, and it is how the bar shows on the three roots and nowhere
 * else.
 *
 * Nothing above the tab bar can reach a tab root by name: a flow that ends
 * on a tab's list lands there through `resetOverTab` (./overTab).
 */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import type {
  RootStackParamList,
  RootTabParamList,
  SettingsTabParamList,
  VaultsTabParamList,
  VirtualTabParamList,
} from './types';
import { landOverTab, navigationRef } from './landOverTab';
import { theme, themedStyles, getColorScheme } from '../theme';
import { PageGlow, StackHeader, STACK_HEADER_H, UnderHeaderContext } from '../components';
import { tabSwitchTick } from '../../platform/haptics';
import { WalletListScreen } from '../screens/WalletListScreen';
import { ImportScreen } from '../screens/ImportScreen';
import { AddWalletScreen } from '../screens/AddWalletScreen';
import { CreateVaultScreen } from '../screens/CreateVaultScreen';
import { VaultBuilderScreen } from '../screens/VaultBuilderScreen';
import { VaultBuiltScreen } from '../screens/VaultBuiltScreen';
import { LayeredVaultScreen } from '../screens/LayeredVaultScreen';
import { WalletDetailScreen } from '../screens/WalletDetailScreen';
import { ReceiveScreen } from '../screens/ReceiveScreen';
import { VerifyAddressScreen } from '../screens/VerifyAddressScreen';
import { AddressBookScreen } from '../screens/AddressBookScreen';
import { AddAddressScreen } from '../screens/AddAddressScreen';
import { ADDRESS_BOOK_WORDS } from '../../wallet/addressBookWords';
import { SendScreen } from '../screens/SendScreen';
import { AddressesScreen } from '../screens/AddressesScreen';
import { ManualWalletSetupScreen } from '../screens/ManualWalletSetupScreen';
import { ManualWalletScreen } from '../screens/ManualWalletScreen';
import { ManualEntryScreen } from '../screens/ManualEntryScreen';
import { ManualEntryDetailScreen } from '../screens/ManualEntryDetailScreen';
import { EntrySourceScreen } from '../screens/EntrySourceScreen';
import { KrakenConnectScreen } from '../screens/KrakenConnectScreen';
import { PortfolioSyncScreen } from '../screens/PortfolioSyncScreen';
import { CoinbaseConnectScreen } from '../screens/CoinbaseConnectScreen';
import { PortfolioStatementScreen } from '../screens/PortfolioStatementScreen';
import { VirtualVaultsListScreen } from '../screens/VirtualVaultsListScreen';
import { UtxosScreen } from '../screens/UtxosScreen';
import { TxDetailScreen } from '../screens/TxDetailScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { PsbtReviewScreen } from '../screens/PsbtReviewScreen';
import { SignPsbtScreen } from '../screens/SignPsbtScreen';
import { RefreshSessionScreen } from '../screens/RefreshSessionScreen';
import { RegisterVaultScreen } from '../screens/RegisterVaultScreen';
import { InheritanceSetupScreen } from '../screens/InheritanceSetupScreen';
import { GeneralInfoScreen } from '../screens/GeneralInfoScreen';
import { SubscriptionsScreen } from '../screens/SubscriptionsScreen';
import { DeleteAccountScreen } from '../screens/DeleteAccountScreen';
import { TwoFactorScreen } from '../screens/TwoFactorScreen';
import { PolicyScreen } from '../screens/PolicyScreen';
import { VerifyExternalKeysScreen } from '../screens/VerifyExternalKeysScreen';
import { ReplaceDeviceScreen } from '../screens/ReplaceDeviceScreen';
import { StatementScreen } from '../screens/StatementScreen';
import { PendingCosignScreen } from '../screens/PendingCosignScreen';
import { PriceHistoryScreen } from '../screens/PriceHistoryScreen';
import { ContactScreen } from '../screens/ContactScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { NetworkSettingsScreen } from '../screens/NetworkSettingsScreen';
import { DisplaySettingsScreen } from '../screens/DisplaySettingsScreen';
import { NotificationsSettingsScreen } from '../screens/NotificationsSettingsScreen';
import { VaultSyncSettingsScreen } from '../screens/VaultSyncSettingsScreen';
import { RegisterHardwareScreen } from '../screens/RegisterHardwareScreen';
import { SecuritySettingsScreen } from '../screens/SecuritySettingsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { InheritanceScreen } from '../screens/InheritanceScreen';
import { CosignLimitsScreen } from '../screens/CosignLimitsScreen';
import { EliteServicesScreen } from '../screens/EliteServicesScreen';
import { VaultHoldersScreen } from '../screens/VaultHoldersScreen';
import { RescueScreen } from '../screens/RescueScreen';
import { InviteHeirScreen } from '../screens/InviteHeirScreen';
import { ClaimInviteScreen } from '../screens/ClaimInviteScreen';
import { SharePortfolioScreen } from '../screens/SharePortfolioScreen';
import { ClaimSharedPortfolioScreen } from '../screens/ClaimSharedPortfolioScreen';
import { inviteCodeFromUrl } from '../../services/heirInvite';
import { isPortfolioInviteCode } from '../../crypto/sharedPortfolio';
import { HWW_ENABLED, LEDGER_PREVIEW, PURCHASES_ENABLED, SIGNING_ENABLED } from '../../config';
import { STORE_COPY } from '../screens/storeCopy';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const VaultsTabStack = createNativeStackNavigator<VaultsTabParamList>();
const VirtualTabStack = createNativeStackNavigator<VirtualTabParamList>();
const SettingsTabStack = createNativeStackNavigator<SettingsTabParamList>();
const Tabs = createNativeBottomTabNavigator<RootTabParamList>();

// Evaluated per render so a theme change (which remounts the navigator)
// picks up the active palette.
/**
 * The navigation theme follows Talia's own light or dark mode. Its `dark`
 * flag is not decoration: Apple's native tab bar takes its light or dark
 * glass from it (react-native-screens forces the bar's interface style) and
 * its default blur from it too. Built on DarkTheme alone, the flag was always
 * on, and the bar came out as dark grey glass with white labels on Talia's
 * light pages (2026-09-15, set beside Apple's Files app on the same
 * simulator). The JS dock never read it, which is why nothing showed before.
 */
const makeNavTheme = () => {
  const base = getColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.accent,
      background: theme.colors.hull,
      card: theme.colors.hull,
      text: theme.colors.offWhite,
      border: theme.colors.hairline,
    },
  };
};

/**
 * The ground under EVERY stack screen: the page colour with the glow that
 * starts at the top of the window (decided 2026-09-12: "make the glossy colour
 * start from the top of the screen ... apply the same wherever else
 * visible"). Laid once here, so a screen cannot forget it; screens draw on
 * a transparent root and never paint an opaque ground of their own. Under
 * the shared header the glow's centre sits the bar's height above this
 * view (the bar draws that slice itself); a screen with its own bar starts
 * at the top of the window.
 *
 * The same `headerShown` tells the page's Screen that the bar has already
 * taken the status bar (UnderHeaderContext, decided 2026-10-05), so every
 * page under the shared header starts at one height below it.
 */
function StackPageLayout({
  headerShown,
  children,
}: {
  headerShown: boolean | undefined;
  children: React.ReactElement;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={pageStyles.ground}>
      <PageGlow offsetTop={headerShown === false ? 0 : insets.top + STACK_HEADER_H} />
      <UnderHeaderContext.Provider value={headerShown !== false}>{children}</UnderHeaderContext.Provider>
    </View>
  );
}

// themedStyles, not a plain sheet: a plain one froze the dark ground at
// startup and light mode drew light cards on it (decided 2026-09-12 18:50).
const pageStyles = themedStyles(() => StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.colors.hull },
}));

const stackPageLayout = ({
  options,
  children,
}: {
  options: { headerShown?: boolean };
  children: React.ReactElement;
}) => <StackPageLayout headerShown={options.headerShown}>{children}</StackPageLayout>;

/** The tab bar itself is not wrapped in a page ground: each tab root lays
 *  its own on its one-screen stack, and a second ground and glow behind the
 *  bar would only be painted over. */
const bareLayout = ({ children }: { children: React.ReactElement }) => children;

const makeStackScreenOptions = () => ({
  // Every push slides in from the right (the iOS default) — pin it explicitly so
  // heavy screens (Sign, Inheritance) can't drift to a no-animation feel and so
  // the intent is immune to react-navigation default changes.
  animation: 'slide_from_right' as const,
  // Our OWN header (not the native one): iOS 26 wraps native bar items in
  // liquid-glass circles, which fought the bare-chevron design. A JS header
  // gives every screen the identical minimal back button.
  header: ({ options, route, navigation }: NativeStackHeaderProps) => (
    <StackHeader
      title={options.title ?? route.name}
      canGoBack={navigation.canGoBack()}
      // Screens may still contribute a right-side action via headerRight
      // (e.g. Receive's fresh-address generator) — honour it.
      right={options.headerRight?.({ canGoBack: navigation.canGoBack() })}
    />
  ),
  contentStyle: { backgroundColor: theme.colors.hull },
});

/*
 * Each tab is its root screen alone, on a one-screen stack. The stack gives
 * the root the page ground and (Settings) the shared header exactly as
 * before, and the roots still find their tab through getParent() for the
 * jump to the top on a tab press. Everything a root opens is pushed on the
 * ROOT stack, over the tab bar.
 */
function VaultsTabScreen(): React.JSX.Element {
  return (
    <VaultsTabStack.Navigator screenOptions={makeStackScreenOptions()} screenLayout={stackPageLayout}>
      <VaultsTabStack.Screen name="WalletList" component={WalletListScreen} options={{ headerShown: false }} />
    </VaultsTabStack.Navigator>
  );
}

function VirtualTabScreen(): React.JSX.Element {
  return (
    <VirtualTabStack.Navigator screenOptions={makeStackScreenOptions()} screenLayout={stackPageLayout}>
      <VirtualTabStack.Screen name="VirtualList" component={VirtualVaultsListScreen} options={{ headerShown: false }} />
    </VirtualTabStack.Navigator>
  );
}

function SettingsTabScreen(): React.JSX.Element {
  return (
    <SettingsTabStack.Navigator screenOptions={makeStackScreenOptions()} screenLayout={stackPageLayout}>
      <SettingsTabStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </SettingsTabStack.Navigator>
  );
}

/**
 * Apple's tab bar. The icons are our own drawings (VaultIcon, and Tabler's
 * report-analytics and menu-2 from TablerIcons), rendered to PNG from
 * assets/tabs/*.svg because the native bar takes images, not components.
 * They are TEMPLATE images (`tinted` defaults to true): the bar reads their
 * alpha only and paints them itself.
 */
function TabBar(): React.JSX.Element {
  return (
    <Tabs.Navigator
      // The lightest tick iOS has, on a change of tab only (decided 2026-09-15:
      // "a tiny vibration when user switches between the menu"). The native
      // bar reports every tap, the current tab's included, and a hold and
      // slide as one selection when the finger lifts.
      screenListeners={({ navigation }) => ({
        tabPress: () => {
          if (!navigation.isFocused()) tabSwitchTick();
        },
      })}
      screenOptions={{
        headerShown: false,
        // accentText, not accent: lime is unreadable on the light glass.
        tabBarActiveTintColor: theme.colors.accentText,
        // Documented for Android, but on iOS React Navigation hands it to
        // the bar items' normal appearance too (icon and title).
        tabBarInactiveTintColor: theme.colors.slate,
        // Apple's own fold on scroll, in place of the dock's folding names.
        tabBarMinimizeBehavior: 'onScrollDown',
        // Apple's own glass, untouched: React Navigation otherwise lays its own
        // blur material over the bar ('systemMaterial'), which the Files app
        // on the same simulator does not have. The point of this build is
        // Apple's bar exactly as Apple draws it.
        tabBarBlurEffect: 'systemDefault',
        // A tab loads on its first visit, as the old tab bar did. The native
        // one loads all three at launch by default, which puts the live price
        // feed and a second session read on the boot path (the 12-second boot
        // of 2026-08-27 came from work near there; decided 2026-09-15).
        lazy: true,
        // The tab roots pad themselves: the status bar at the top and 140pt
        // at the bottom of each list, which clears the bar. iOS adding its
        // own insets on top would move each list down by the status bar a
        // second time.
        overrideScrollViewContentInsetAdjustmentBehavior: false,
      }}>
      <Tabs.Screen
        name="VaultsTab"
        component={VaultsTabScreen}
        options={{
          tabBarLabel: 'Vaults',
          tabBarIcon: { type: 'image', source: require('../../../assets/tabs/vault.png') },
        }}
      />
      {/* Hand-kept portfolios live on their OWN tab (decided 2026-08-26): typed
          numbers and verified coins never share a screen. */}
      <Tabs.Screen
        name="VirtualTab"
        component={VirtualTabScreen}
        options={{
          tabBarLabel: 'Portfolios',
          tabBarIcon: { type: 'image', source: require('../../../assets/tabs/report-analytics.png') },
        }}
      />
      <Tabs.Screen
        name="SettingsTab"
        component={SettingsTabScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: { type: 'image', source: require('../../../assets/tabs/menu.png') },
        }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  // The one container ref, shared with every landing (./landOverTab): an
  // action built from a screen's own state is undone at a cold launch.
  const navRef = navigationRef;
  // A cold-start invite link can arrive before the container is ready —
  // park it and deliver in onReady (same reason companyAuth checks
  // getInitialURL). Auth-callback and checkout links pass through untouched:
  // inviteCodeFromUrl only matches talia://invite/… (tiam:// kept as alias).
  const pendingInvite = React.useRef<string | null>(null);

  // An invite lands on its claim screen with its tab beneath it: a
  // portfolio invite over the Portfolios tab, an heir invite over the Vaults
  // tab. The root stack is reset to exactly that, so Back from the claim, and
  // the claim's own `replace` onward, end on that tab's list. The list must
  // exist beneath: when a deep link once left a tab with no list at all,
  // claiming left no way to add a portfolio and Back fell out to the Vaults
  // tab (decided 2026-09-14, after a phone test that joined a first shared
  // portfolio).
  const landOnInvite = React.useCallback(
    (code: string) => {
      const portfolio = isPortfolioInviteCode(code);
      const root = navRef.getRootState();
      // Nothing open above the bar (a cold start, or a tab's list showing):
      // land on the right tab with the claim on top. That reset removes no
      // screen, so no leave guard can cancel it.
      if (root.routes.length === 1 && root.routes[0]?.name === 'Tabs') {
        landOverTab(portfolio ? 'VirtualTab' : 'VaultsTab', [
          portfolio
            ? { name: 'ClaimSharedPortfolio', params: { code } }
            : { name: 'ClaimInvite', params: { code } },
        ]);
        return;
      }
      // Something is open (an Estate Plan mid-questionnaire, a refresh session
      // mid-signing, a vault being configured, a typed Send): put the claim on
      // top of it. A reset would have to remove those screens, so their leave
      // guards would cancel it and the link would do nothing, or it would throw
      // the half-done work away without a word (decided 2026-09-15). Back from
      // the claim returns to what was open.
      if (portfolio) navRef.navigate('ClaimSharedPortfolio', { code });
      else navRef.navigate('ClaimInvite', { code });
    },
    [navRef],
  );

  const openInvite = React.useCallback(
    (url: string | null) => {
      const code = inviteCodeFromUrl(url);
      if (!code) return;
      // A portfolio invite (TALIA-P-...) lands on the Portfolio tab in EVERY
      // build: sharing a portfolio has nothing to do with signing, so it sits
      // in front of the flag gate below.
      if (isPortfolioInviteCode(code)) {
        if (navRef.isReady()) {
          landOnInvite(code);
        } else {
          pendingInvite.current = code;
        }
        return;
      }
      // Watch-only v1 has no ClaimInvite route, so an heir invite link must
      // not be routed anywhere: swallowing it lands the user on their vault
      // list instead of crashing on an unregistered screen. Auth and
      // checkout links are untouched — they never reach this handler.
      if (!SIGNING_ENABLED && !LEDGER_PREVIEW) return;
      if (navRef.isReady()) {
        landOnInvite(code);
      } else {
        pendingInvite.current = code;
      }
    },
    [navRef, landOnInvite],
  );

  React.useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => openInvite(url));
    void Linking.getInitialURL().then(openInvite);
    return () => sub.remove();
  }, [openInvite]);

  return (
    <NavigationContainer
      ref={navRef}
      theme={makeNavTheme()}
      onReady={() => {
        if (pendingInvite.current) {
          const code = pendingInvite.current;
          pendingInvite.current = null;
          landOnInvite(code);
        }
      }}>
      <RootStack.Navigator screenOptions={makeStackScreenOptions()} screenLayout={stackPageLayout}>
        {/* The tab bar and the three tab roots: always the bottom of the stack. */}
        <RootStack.Screen name="Tabs" component={TabBar} options={{ headerShown: false }} layout={bareLayout} />

        {/* ---- Reached from the Vaults tab. ---- */}
        <RootStack.Screen name="AddWallet" component={AddWalletScreen} options={{ title: 'Add a vault' }} />
        {/* Watch-only v1: the spend/creation half of the stack is not registered
            at all, so a stray navigate() is inert rather than a hidden door.
            React Navigation drops falsy children, so flipping the flag brings
            every route back exactly as it was. */}
        {(SIGNING_ENABLED || HWW_ENABLED) && (
          <RootStack.Screen name="CreateVault" component={CreateVaultScreen} options={{ title: 'New vault' }} />
        )}
        {(SIGNING_ENABLED || HWW_ENABLED) && (
          <RootStack.Screen name="VaultBuilder" component={VaultBuilderScreen} options={{ title: 'Build your vault' }} />
        )}
        {(SIGNING_ENABLED || HWW_ENABLED) && (
          <RootStack.Screen name="LayeredVault" component={LayeredVaultScreen} options={{ title: 'Vault Configuration', gestureEnabled: false }} />
        )}
        {/* Where both builders land (decided 2026-10-02): no header bar, and no
            way back from it, only the button forward; the vault exists. It
            arrives by landOverTab's RESET, which replaces the wizard with the
            vault page and this page above it. react-native-screens animates
            a replace's default 'push' with UIKit's setViewControllers, and
            that pushes FROM the screen the reset puts beneath: the vault page
            showed full-screen for a frame and then slid away under this page
            (simulator, 2026-10-02). With animationTypeForReplace 'pop' the
            wizard's last step is kept on top and popped, so the client sees
            the wizard slide away and "Vault built" beneath it, and never a
            frame of the vault page. The clock starts at that pop's end. */}
        {(SIGNING_ENABLED || HWW_ENABLED) && (
          <RootStack.Screen name="VaultBuilt" component={VaultBuiltScreen} options={{ headerShown: false, gestureEnabled: false, animationTypeForReplace: 'pop' }} />
        )}
        <RootStack.Screen name="Import" component={ImportScreen} options={{ title: 'Add existing vault' }} />
        <RootStack.Screen name="WalletDetail" component={WalletDetailScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="Receive" component={ReceiveScreen} options={{ title: 'Receive' }} />
        {/* The address check on its own screen (decided 2026-10-04), under the
            same gate as Receive's "Verify on Hardware" button. */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="VerifyAddress" component={VerifyAddressScreen} options={{ title: 'Verify on hardware' }} />
        )}
        {/* Ledger preview: Send + the ceremony are reachable, but ONLY the
            WalletDetail Send button offers them, per Ledger-bound vault. */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="Send" component={SendScreen} options={{ headerShown: false, gestureEnabled: false }} />
        )}
        {/* The address book is opened from Send and answers Send, so both of
            its pages sit behind Send's own gate (decided 2026-11-05;
            routeReachability pins the three together). */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="AddressBook" component={AddressBookScreen} options={{ title: ADDRESS_BOOK_WORDS.addressBook }} />
        )}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="AddAddress" component={AddAddressScreen} options={{ title: ADDRESS_BOOK_WORDS.addAddress }} />
        )}
        <RootStack.Screen name="Addresses" component={AddressesScreen} options={{ title: 'Addresses' }} />
        <RootStack.Screen name="Utxos" component={UtxosScreen} options={{ title: 'Coins' }} />
        {/* Draws its own head (kind + moment beside the back button, BlueWallet-style). */}
        <RootStack.Screen name="TxDetail" component={TxDetailScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan' }} />
        {/* PsbtReview is the on-ramp to the ceremony ("Sign with device"), so it
            goes with it — a watch-only build has nothing to do with a PSBT. */}
        {SIGNING_ENABLED && (
          <RootStack.Screen name="PsbtReview" component={PsbtReviewScreen} options={{ title: 'Sign PSBT' }} />
        )}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <>
            <RootStack.Screen name="SignPsbt" component={SignPsbtScreen} options={{ title: 'Sign', gestureEnabled: false }} />
            <RootStack.Screen name="RefreshSession" component={RefreshSessionScreen} options={{ title: 'Refresh session', gestureEnabled: false }} />
          </>
        )}
        {SIGNING_ENABLED && (
          <RootStack.Screen name="RegisterVault" component={RegisterVaultScreen} options={{ title: 'Register vault' }} />
        )}
        {/* The Estate Plan questionnaire, from a vault's banner and from the
            Estate Plan hub in Settings. Its success page sends the client on
            to invite their heirs, so InviteHeir goes with it under the same
            gate (the 2026-08-30 dead button; routeReachability pins the pair). */}
        {(SIGNING_ENABLED || LEDGER_PREVIEW) && (
          <RootStack.Screen name="InheritanceSetup" component={InheritanceSetupScreen} options={{ title: 'Estate Plan' }} />
        )}
        <RootStack.Screen name="TwoFactor" component={TwoFactorScreen} options={{ title: 'Two-factor' }} />
        <RootStack.Screen name="Policy" component={PolicyScreen} options={{ title: 'Spending policy' }} />
        {/* The key check on the testing call: full app only, like the rest of
            the hardware surface (decided 2026-09-07). */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="VerifyExternalKeys" component={VerifyExternalKeysScreen} options={{ title: 'Verify external keys' }} />
        )}
        {/* Replacing the hardware behind a key: full app only, like every
            other screen that talks to a device. */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="ReplaceDevice" component={ReplaceDeviceScreen} options={{ title: 'Replace signing device' }} />
        )}
        <RootStack.Screen name="Statement" component={StatementScreen} options={{ title: 'Create a statement' }} />
        {/* Both halves of the heir-invite pair go together: sealing an invite a
            v1 app can never claim would be a dead end for the heir. */}
        {(SIGNING_ENABLED || LEDGER_PREVIEW) && (
          <RootStack.Screen name="InviteHeir" component={InviteHeirScreen} options={{ title: 'Invite an heir' }} />
        )}
        {/* Every registration and every "Connect to hardware", for every
            adopted device (decided 2026-09-22). */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen
            name="RegisterHardware"
            component={RegisterHardwareScreen}
            options={{ title: 'Your hardware' }}
          />
        )}
        {(SIGNING_ENABLED || LEDGER_PREVIEW) && (
          <RootStack.Screen name="ClaimInvite" component={ClaimInviteScreen} options={{ title: 'Heir invite' }} />
        )}
        {/* Parked partials + the 21C co-sign round-trip must stay completable
            for preview-signed Ledger vaults; they end in finalise + broadcast. */}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && (
          <RootStack.Screen name="PendingCosign" component={PendingCosignScreen} options={{ title: 'Pending transactions' }} />
        )}
        <RootStack.Screen name="PriceHistory" component={PriceHistoryScreen} options={{ headerShown: false, gestureEnabled: false }} />

        {/* ---- Reached from the Portfolios tab. ---- */}
        <RootStack.Screen name="ManualWalletSetup" component={ManualWalletSetupScreen} options={{ title: 'New Portfolio' }} />
        <RootStack.Screen name="ManualWallet" component={ManualWalletScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="ManualEntry" component={ManualEntryScreen} options={{ title: 'Buy or sell' }} />
        {/* An entry's own page draws its head as a transaction's does. */}
        <RootStack.Screen name="ManualEntryDetail" component={ManualEntryDetailScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="EntrySource" component={EntrySourceScreen} options={{ title: 'Source' }} />
        <RootStack.Screen name="PortfolioStatement" component={PortfolioStatementScreen} options={{ title: 'Create a statement' }} />
        <RootStack.Screen name="KrakenConnect" component={KrakenConnectScreen} options={{ title: 'Connect Kraken' }} />
        <RootStack.Screen name="PortfolioSync" component={PortfolioSyncScreen} options={{ title: 'Sync portfolio' }} />
        <RootStack.Screen name="CoinbaseConnect" component={CoinbaseConnectScreen} options={{ title: 'Connect Coinbase' }} />
        {/* Shared portfolios (decided 2026-09-12) are a portfolio feature, not a
            signing one: both halves ship in the watch-only build, never behind
            SIGNING_ENABLED or LEDGER_PREVIEW (routeReachability pins it). */}
        <RootStack.Screen name="SharePortfolio" component={SharePortfolioScreen} options={{ title: 'Share portfolio' }} />
        <RootStack.Screen name="ClaimSharedPortfolio" component={ClaimSharedPortfolioScreen} options={{ title: 'Shared portfolio' }} />

        {/* ---- Reached from Settings. ---- */}
        <RootStack.Screen name="NetworkSettings" component={NetworkSettingsScreen} options={{ title: 'Network' }} />
        <RootStack.Screen name="DisplaySettings" component={DisplaySettingsScreen} options={{ title: 'General' }} />
        <RootStack.Screen name="SecuritySettings" component={SecuritySettingsScreen} options={{ title: 'Security' }} />
        {/* The wallet engine and its report (BDK upgrade, decided 2026-10-15):
            the phone app and TestFlight, never the App Store's watch-only app. */}
        {HWW_ENABLED && (
          <RootStack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: 'Diagnostics' }} />
        )}
        {/* Not gated by SIGNING_ENABLED: reminders are a watch-only feature. */}
        <RootStack.Screen name="NotificationSettings" component={NotificationsSettingsScreen} options={{ title: 'Notifications' }} />
        <RootStack.Screen name="VaultSync" component={VaultSyncSettingsScreen} options={{ title: 'Portfolio Sync' }} />
        <RootStack.Screen name="Inheritance" component={InheritanceScreen} options={{ title: 'Estate Plan' }} />
        <RootStack.Screen name="EliteServices" component={EliteServicesScreen} options={{ title: 'Elite Services' }} />
        <RootStack.Screen name="CosignLimits" component={CosignLimitsScreen} options={{ title: 'Co-signing limits' }} />
        <RootStack.Screen name="VaultHolders" component={VaultHoldersScreen} options={{ title: 'Vault owners' }} />
        <RootStack.Screen name="Support" component={ContactScreen} options={{ title: 'Support' }} />
        {/* The rescue ceremony finalises and broadcasts a spend. */}
        {(SIGNING_ENABLED || LEDGER_PREVIEW) && (
          <RootStack.Screen name="Rescue" component={RescueScreen} options={{ title: 'Rescue' }} />
        )}
        <RootStack.Screen name="GeneralInfo" component={GeneralInfoScreen} options={{ title: 'Profile' }} />
        {/* "Membership" where nothing is sold (Apple's letter of 2026-09-11). */}
        <RootStack.Screen name="Subscriptions" component={SubscriptionsScreen} options={{ title: PURCHASES_ENABLED ? 'Subscriptions' : STORE_COPY.membershipLabel }} />
        <RootStack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ title: 'Delete account' }} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
