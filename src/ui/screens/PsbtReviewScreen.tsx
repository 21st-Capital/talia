/**
 * Review/export a PSBT that arrived from OUTSIDE the app (scanned QR) —
 * the same "final page" the send flow ends on: summary card + export
 * (file / QR / copy) so the user can sign on their hardware device.
 * Routed here by the global scanner once a wallet's fingerprints match.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Button, Card, DrawnIcon, FitText, Screen, WalletIconTile, walletIconFor } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, formatAmount, formatSats } from '../../wallet';
import { parsePsbt, makePsbtExport } from '../../bitcoin/psbt';
import type { ParsedPsbt, PsbtExport } from '../../bitcoin/psbt';
import { exportPsbtToFile } from '../../platform/files';
import { markOwnOutputs, ownOutputIndices } from '../../wallet/ownOutputs';

type Props = NativeStackScreenProps<RootStackParamList, 'PsbtReview'>;

export function PsbtReviewScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, getEngine, settings } = useWallets();
  const wallet = getWallet(route.params.walletId);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which outputs pay this vault: BDK against the vault's descriptor. This
   * PSBT came from OUTSIDE the app, so its derivation entries prove nothing
   * (decided 2026-09-26); until the answer is in, every output
   * reads as leaving.
   */
  const [own, setOwn] = useState<number[]>([]);
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    void getEngine(wallet)
      .then((engine) => ownOutputIndices(engine, route.params.psbtBase64))
      .then((idx) => {
        if (live) setOwn(idx);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.psbtBase64, wallet?.id]);

  const parsed: ParsedPsbt | null = useMemo(() => {
    try {
      return markOwnOutputs(parsePsbt(route.params.psbtBase64, wallet?.network), own);
    } catch {
      return null;
    }
  }, [route.params.psbtBase64, wallet?.network, own]);

  const psbtExport: PsbtExport | null = useMemo(() => {
    if (!wallet) return null;
    try {
      return makePsbtExport(route.params.psbtBase64, wallet.label);
    } catch {
      return null;
    }
  }, [route.params.psbtBase64, wallet]);

  if (!wallet || !parsed || !psbtExport) {
    return (
      <Screen scroll underHeader>
        <Text style={styles.muted}>Could not read this transaction.</Text>
      </Screen>
    );
  }

  const externalOuts = parsed.outputs.filter((o) => !o.isOwn);
  const changeOuts = parsed.outputs.filter((o) => o.isOwn);

  return (
    <Screen
      scroll
      underHeader
      style={styles.content}
      // Only two actions (decided 2026-07-18): the signing ceremony shows its own
      // QR, so a bare PSBT QR here has no use case. Pinned at the foot (decided
      // 2026-10-05): the device first, the file as the second choice.
      footer={
        <>
          <Button
            title="Sign with device"
            onPress={() =>
              navigation.navigate('SignPsbt', {
                walletId: wallet.id,
                psbtBase64: route.params.psbtBase64,
              })
            }
          />
          <Button
            title="Export file"
            variant="ghost"
            onPress={() =>
              void exportPsbtToFile(psbtExport.filename, psbtExport.base64).catch((e) =>
                setError(String(e)),
              )
            }
          />
        </>
      }>
      <View style={styles.walletRow}>
        <WalletIconTile
          icon={walletIconFor(wallet)}
          size={46}
        />
        <View style={styles.walletBody}>
          <Text style={styles.walletName} numberOfLines={1}>
            {wallet.label}
          </Text>
          <Text style={styles.walletSub}>signs this transaction</Text>
        </View>
      </View>

      <Card style={styles.card}>
        {externalOuts.map((o, i) => (
          <View key={`${o.address ?? 'script'}-${i}`} style={styles.row}>
            <Text style={styles.label}>To</Text>
            <View style={styles.valueCol}>
              <FitText style={[styles.value, styles.mono]}>
                {o.address ? `${o.address.slice(0, 12)}…${o.address.slice(-6)}` : 'unrecognised destination'}
              </FitText>
              <Text style={styles.valueSub}>{formatAmount(o.amountSats, settings.unit)}</Text>
            </View>
          </View>
        ))}
        {changeOuts.length > 0 && (
          <View style={styles.row}>
            <Text style={styles.label}>Change</Text>
            <Text style={styles.value}>
              {formatAmount(changeOuts.reduce((s, o) => s + o.amountSats, 0), settings.unit)} back to this wallet
            </Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.label}>Fee</Text>
          <Text style={styles.value}>
            {parsed.feeSats != null ? formatSats(parsed.feeSats) : 'unknown'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Coins spent</Text>
          <Text style={styles.value}>{parsed.numInputs}</Text>
        </View>
      </Card>

      <Card style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <DrawnIcon kind="tick" size={22} strokeWidth={5} />
          <Text style={styles.resultTitle}>Ready to sign</Text>
        </View>
        <Text style={styles.hint}>
          Sign with your device, or export the file to sign elsewhere.
        </Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  muted: { ...theme.typography.body, color: theme.colors.slate },
  // The page gutter and the safe area are the Screen's; `lg` between the cards.
  content: { gap: theme.spacing.lg },
  // Family and size from the token, but NOT its leading: this style is
  // layered over `value`, whose lineHeight keeps the label and the address on
  // one baseline.
  mono: {
    fontFamily: theme.typography.mono.fontFamily,
    fontSize: theme.typography.mono.fontSize,
  },

  walletRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  walletBody: { flex: 1, minWidth: 0 },
  // A card headline beside the vault tile, not a page title.
  walletName: { ...theme.typography.heading, color: theme.colors.offWhite },
  walletSub: { ...theme.typography.body, color: theme.colors.slate, marginTop: 1 },

  card: { paddingVertical: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Label sits on the FIRST line of its value, not centred against the
    // block (decided 2026-08-28): the "To" value is always two lines (address +
    // amount) and Change wraps. Mirrors SendScreen infoRow and
    // CosignRequestPanel row.
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  label: { ...theme.typography.body, color: theme.colors.slate },
  value: {
    ...theme.typography.heading,
    color: theme.colors.offWhite,
    flexShrink: 1,
    textAlign: 'right',
  },
  valueCol: { alignItems: 'flex-end', flexShrink: 1 },
  valueSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },

  resultCard: { gap: theme.spacing.sm },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  resultTitle: { ...theme.typography.heading, color: theme.colors.positive },
  hint: { ...theme.typography.caption, color: theme.colors.slate },
  errorText: { ...theme.typography.body, color: theme.colors.negative },
}));
