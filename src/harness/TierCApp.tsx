/**
 * What a TALIA_HARNESS build shows instead of the app: one line saying what
 * the tier C runner is doing (harness/tierC.ts). Simulator only; never in a
 * phone or store build (index.js mounts it only when the flag is on).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { nativeBdkWallet } from '../platform/bdkWalletModule';
import { TIER_C_MARKER, tierCLoop } from './tierC';

export function TierCApp(): React.JSX.Element {
  const [status, setStatus] = useState('Tier C runner: starting');
  useEffect(() => {
    void tierCLoop(nativeBdkWallet(), setStatus).catch((e) => setStatus(`Tier C runner stopped: ${String(e)}`));
  }, []);
  return (
    <View style={styles.page} accessibilityLabel={TIER_C_MARKER}>
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

// Plain colours on purpose: the harness never draws the app's theme.
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#062B24', justifyContent: 'center', padding: 24 },
  text: { color: '#F4F1E8', fontSize: 16 },
});
