/**
 * "Vault built" (decided 2026-10-02, design B "Keys into the lock", pace B2).
 *
 * Both vault builders land here, over the new vault's page, and nothing else
 * does: a vault BUILT in Talia (the wizard, and Build your vault, which makes
 * the new single-sig too). Never an import, a claimed heir vault, a portfolio
 * or a vault from another Talia (`ui/__tests__/vaultBuilt.test.ts`).
 *
 * The page is `VaultBuiltPage`; this screen gives it the vault as it was
 * built (read once: the page is one moment), starts its clock once the
 * transition that brought it is over (the wizard's last step popping away
 * over it: the route's `animationTypeForReplace`, see RootNavigator), and
 * takes the builders' own next step on the button:
 *   - a vault some device must be shown before it can sign (several keys, or
 *     a timelock: the vault page's own `registrationWalk`) goes on to the
 *     registration walk on the vault page, "Register on your hardware", one
 *     device at a time (the retired Coldcard wizard, `RegisterVault`, in a
 *     build that still has it);
 *   - anything else (a plain single key) opens the vault.
 *
 * The first-vault Face ID offer would otherwise land on top of the animation
 * at 3.5 s: it waits while the page shows and is let go when it is left,
 * except into the registration walk, which holds it until the walk is over
 * (as the single-sig import's hardware question does).
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LEDGER_PREVIEW, SIGNING_ENABLED } from '../../config';
import { isSingleSigVault, registrationWalk, useWallets } from '../../wallet';
import type { WalletMeta } from '../../wallet';
import { landOverTab } from '../navigation/landOverTab';
import type { RootStackParamList } from '../navigation/types';
import { Screen } from '../components/Screen';
import { VaultBuiltPage } from '../components/VaultBuiltPage';
import { deferFirstVaultSecurity, resumeFirstVaultSecurity } from '../components/FirstVaultSecurity';
import { vaultBuiltFacts, vaultBuiltWords } from '../components/vaultBuiltModel';
import type { VaultBuiltFacts, VaultBuiltNext } from '../components/vaultBuiltModel';
import { themedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'VaultBuilt'>;

/** If the transition never reports its end, the page starts anyway. */
const ARRIVE_FALLBACK_MS = 700;

/**
 * The builders' next step for this vault. The words follow it: "Register on
 * hardware" only when the walk has a device to ask for, so a vault whose
 * keys need no registration is never told to register. Our own keys are the
 * ones the builder tagged (a vault built moments ago carries every one).
 */
function nextStep(wallet: WalletMeta): VaultBuiltNext {
  if (SIGNING_ENABLED) return isSingleSigVault(wallet) ? 'open' : 'register';
  // The vault page runs its walk under the hardware preview only.
  if (!LEDGER_PREVIEW) return 'open';
  const ours = new Set((wallet.providerKeyFingerprints ?? []).map((f) => f.toLowerCase()));
  return registrationWalk(wallet, ours).length > 0 ? 'register' : 'open';
}

export function VaultBuiltScreen({ route, navigation }: Props): React.JSX.Element | null {
  const { walletId } = route.params;
  const { getWallet } = useWallets();
  // Read once: the keys and words of the vault as it was built. The vault
  // page beneath starts syncing it, and nothing it learns may change the
  // keys while they are flying.
  const [built] = useState<{ facts: VaultBuiltFacts; next: VaultBuiltNext } | null>(() => {
    const w = getWallet(walletId);
    return w ? { facts: vaultBuiltFacts(w), next: nextStep(w) } : null;
  });

  // No vault (only possible if it vanished in the instant before landing):
  // no page with no way out; the vault list.
  const missing = built == null;
  useEffect(() => {
    if (missing) landOverTab('VaultsTab');
  }, [missing]);

  // The clock starts once the transition that brought the page is over
  // (`transitionEnd` fires when this screen has appeared, however it came).
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const off = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) setArrived(true);
    });
    const t = setTimeout(() => setArrived(true), ARRIVE_FALLBACK_MS);
    return () => {
      off();
      clearTimeout(t);
    };
  }, [navigation]);

  // The Face ID offer waits for the page, and for the walk after it.
  const handedToWalk = useRef(false);
  useEffect(() => {
    deferFirstVaultSecurity();
    return () => {
      if (!handedToWalk.current) resumeFirstVaultSecurity();
    };
  }, []);

  const onNext = () => {
    if (!built) return;
    if (built.next === 'open') {
      navigation.popTo('WalletDetail', { walletId });
      return;
    }
    if (SIGNING_ENABLED) {
      navigation.replace('RegisterVault', { walletId, fresh: true });
      return;
    }
    // The vault page runs the walk, and lets the Face ID offer go when it ends.
    handedToWalk.current = true;
    navigation.popTo('WalletDetail', { walletId, promptHardwareRegistration: true });
  };

  if (!built) return null;
  return (
    <Screen scroll style={styles.content}>
      <VaultBuiltPage facts={built.facts} words={vaultBuiltWords(built.next)} arrived={arrived} onNext={onNext} />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // The page's flexible space pushes the sub line and the button to the foot.
    content: { flexGrow: 1 },
  }),
);
