/**
 * Keel — a descriptor-native, watch-only mobile Bitcoin wallet (Phase 1).
 *
 * App shell: enable native screens, provide safe-area + wallet state, and mount
 * the navigator. All Bitcoin logic lives under `src/bitcoin` (BDK-backed); the
 * UI never touches native crypto directly.
 *
 * @format
 */
import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { WalletProvider, useWallets } from './src/wallet';
import { AuthGate } from './src/ui/auth/AuthGate';
import { SplashIntro } from './src/ui/components';
import { FirstVaultSecurity } from './src/ui/components/FirstVaultSecurity';
import { RootNavigator } from './src/ui/navigation/RootNavigator';
import { KeyboardEscape } from './src/ui/components/KeyboardEscape';
import { theme, setColorScheme } from './src/ui/theme';
import { configureEngineLaunch } from './src/wallet/engineLaunch';
import { runBdkWalletSmoke, smokeAskedAtLaunch, smokeLine } from './src/bitcoin/engine/bdkWalletSmoke';

enableScreens();
// Before the first engine: this build's wallet library module (BDK upgrade,
// decided 2026-10-15; one engine since 2026-11-04).
configureEngineLaunch();
// The wallet library is linked and answers (the library's smoke check; one
// log line, public test vectors only): every DEBUG build, and a Release build
// of a hardware-signing flavour launched with -TaliaBdkWalletSmoke YES.
if (smokeAskedAtLaunch()) {
  void runBdkWalletSmoke().then((r) => console.log(smokeLine(r)));
}

/**
 * Resolves the user's theme setting (system/light/dark) to a scheme, flips
 * the live palette, and remounts the tree via `key` so every themedStyles
 * sheet re-resolves. Runs INSIDE WalletProvider (needs settings).
 */
function ThemedApp(): React.JSX.Element {
  const { settings } = useWallets();
  const system = useColorScheme();
  const [splashDone, setSplashDone] = React.useState(false);
  const mode = settings.themeMode ?? 'system';
  const scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  setColorScheme(scheme); // before children render

  return (
    <React.Fragment key={scheme}>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.hull}
      />
      <AuthGate>
        {/* A tap outside the keyboard puts it away, on every screen. */}
        <KeyboardEscape>
          <RootNavigator />
        </KeyboardEscape>
      </AuthGate>
      {/* The first vault switches Face ID and both auth requirements on
          (decided 2026-09-08), from one place whatever screen added it. */}
      <FirstVaultSecurity />
      {!splashDone && <SplashIntro onDone={() => setSplashDone(true)} />}
    </React.Fragment>
  );
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <WalletProvider>
        <ThemedApp />
      </WalletProvider>
    </SafeAreaProvider>
  );
}

export default App;
