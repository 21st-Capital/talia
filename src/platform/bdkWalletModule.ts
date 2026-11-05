/**
 * This build's wallet library module (TaliaBdkWalletModule, BDK upgrade,
 * decided 2026-10-15), or undefined when the build does not link it
 * (any build but iOS's: it opens no vault (decided 2026-10-28), since the
 * old engine went, and Talia ships for iPhone only, decided
 * 2026-11-04). The engine layer never reads React Native itself: the wallet
 * layer hands it this.
 */
import { NativeModules } from 'react-native';
import type { BdkWalletNative } from '../bitcoin/engine/bdkWalletNative';

export function nativeBdkWallet(): BdkWalletNative | undefined {
  return (NativeModules as Record<string, unknown> | undefined)?.TaliaBdkWalletModule as BdkWalletNative | undefined;
}
