/**
 * Vault owners (decided 2026-09-20): "This is NOT a shared vault. The owners are
 * different individuals with different keys. Only the payment and billing is
 * shared. It is a voucher that is allocated to someone else."
 *
 * The PAYER's screen, and only theirs: one card listing every vault the plan
 * paid for and who each is for. A free slot nobody has built can be assigned
 * to someone else ONCE, by email. After that the row carries no button, ever:
 * only our team changes an allocation (and nobody can, once its owner built
 * the vault). The other person needs no code: they sign in with that email
 * and the vault is theirs to build.
 *
 * The route keeps its first name, `VaultHolders`; the words on screen come
 * from `OWNERS_COPY` and the rows from `ownerSlotRows` (both pure, tested).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AppDialog, Button, Card, InfoHeading, Screen, TextField } from '../components';
import { theme, themedStyles } from '../theme';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import {
  OWNERS_COPY,
  TwoFactorRequiredError,
  assignActionLabel,
  assignConfirmTitle,
  emailLooksValid,
  fetchVaultHolders,
  inviteVaultHolder,
  ownerSlotRows,
} from '../../services/vaultHolders';
import type { PayerVault } from '../../services/vaultHolders';
import { useWallets } from '../../wallet';

type Props = NativeStackScreenProps<RootStackParamList, 'VaultHolders'>;

export function VaultHoldersScreen({ navigation }: Props): React.JSX.Element {
  const [session, setSession] = useState<CompanySession | null | undefined>(undefined);
  const [vaults, setVaults] = useState<PayerVault[] | null>(null);
  const { wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message?: string } | null>(null);
  /** Assigning was refused for want of two-factor: a title and the way on. */
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  /** The free slot whose email field is open, and what was typed into it. */
  const [assigning, setAssigning] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  /** The slot waiting for the yes of the confirm dialog. */
  const [confirmFor, setConfirmFor] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      ownerSlotRows(
        vaults ?? [],
        // A vault somebody else pays for is not a slot of this plan.
        (n) => wallets.find((w) => w.vaultNumber === n && !w.heldOf)?.label,
      ),
    [vaults, wallets],
  );

  const load = useCallback(async (s: CompanySession) => {
    try {
      const page = await fetchVaultHolders(s);
      setVaults(page.vaults);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await loadSession();
      setSession(s);
      if (s) await load(s);
    })();
  }, [load]);

  const assign = async (vaultNumber: number) => {
    if (!session) return;
    setBusy(true);
    try {
      await inviteVaultHolder(session, vaultNumber, email);
      setAssigning(null);
      setEmail('');
      await load(session);
    } catch (e) {
      if (e instanceof TwoFactorRequiredError) {
        // The typed email and the open row stay, so Assign is one tap away
        // when the payer comes back from the setup.
        setNeedsTwoFactor(true);
      } else {
        setDialog({ title: OWNERS_COPY.assignFailed, message: (e as Error).message });
      }
    } finally {
      setBusy(false);
    }
  };

  // The page's actions at its foot (decided 2026-10-05): Assign for the slot
  // whose email field is open, Try again when the list could not load, and
  // that slot's Cancel last. The slot keeps its field and the button that
  // opens it, which belong to the row.
  const footed = error != null || assigning != null;

  return (
    <Screen
      scroll
      style={styles.content}
      footer={
        footed ? (
          <>
            {assigning != null && (
              <Button
                title={OWNERS_COPY.assign}
                accessibilityLabel={`Assign vault ${assigning}`}
                onPress={() => setConfirmFor(assigning)}
                disabled={busy || !emailLooksValid(email)}
              />
            )}
            {error && (
              <Button title="Try again" variant="ghost" onPress={() => session && void load(session)} />
            )}
            {assigning != null && (
              <Button
                title={OWNERS_COPY.cancel}
                variant="ghost"
                disabled={busy}
                onPress={() => setAssigning(null)}
              />
            )}
          </>
        ) : undefined
      }>
      <Text style={styles.intro}>{OWNERS_COPY.intro}</Text>

      {session === null && (
        <Card style={styles.card}>
          <Text style={styles.body}>{OWNERS_COPY.signInFirst}</Text>
        </Card>
      )}

      {session && vaults == null && !error && (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.gold} size="small" />
        </View>
      )}
      {error && (
        <Card style={styles.card}>
          <Text style={styles.body}>{error}</Text>
        </Card>
      )}

      {session && vaults != null && (
        <Card style={styles.card}>
          <InfoHeading style={styles.cardTitle} title={OWNERS_COPY.title} text={OWNERS_COPY.teamOnly}>
            {OWNERS_COPY.cardTitle}
          </InfoHeading>
          {rows.length === 0 && <Text style={styles.body}>{OWNERS_COPY.noSlots}</Text>}
          {rows.map((row, i) => (
            <View key={row.vaultNumber} style={[styles.slot, i > 0 && styles.slotDivider]}>
              <Text style={styles.line}>{row.title}</Text>
              {row.sub != null && <Text style={styles.sub}>{row.sub}</Text>}
              {row.canAssign && assigning !== row.vaultNumber && (
                <Button
                  title={OWNERS_COPY.assignAction}
                  accessibilityLabel={assignActionLabel(row.vaultNumber)}
                  variant="ghost"
                  disabled={busy}
                  onPress={() => {
                    setAssigning(row.vaultNumber);
                    setEmail('');
                  }}
                />
              )}
              {row.canAssign && assigning === row.vaultNumber && (
                <View style={styles.assignBlock}>
                  <TextField
                    label={OWNERS_COPY.emailLabel}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholder="name@example.com"
                  />
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {/* A title and two buttons, nothing to read (decided 2026-09-02). */}
      <AppDialog
        visible={confirmFor != null}
        title={confirmFor != null ? assignConfirmTitle(confirmFor, email) : ''}
        actions={[
          {
            label: OWNERS_COPY.assign,
            variant: 'primary',
            onPress: () => {
              if (confirmFor != null) void assign(confirmFor);
            },
          },
          { label: OWNERS_COPY.cancel, variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setConfirmFor(null)}
      />
      <AppDialog
        visible={needsTwoFactor}
        title={OWNERS_COPY.twoFactorTitle}
        actions={[
          {
            label: OWNERS_COPY.twoFactorSetUp,
            variant: 'primary',
            onPress: () => navigation.navigate('TwoFactor', { gate: true }),
          },
          { label: OWNERS_COPY.cancel, variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setNeedsTwoFactor(false)}
      />
      <AppDialog
        visible={dialog != null}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        actions={[{ label: 'OK', onPress: () => {} }]}
        onClose={() => setDialog(null)}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.lg },
    intro: { ...theme.typography.body, color: theme.colors.slate },
    card: { gap: theme.spacing.sm },
    cardTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    body: { ...theme.typography.body, color: theme.colors.slate },
    line: { ...theme.typography.body, color: theme.colors.offWhite },
    sub: { ...theme.typography.caption, color: theme.colors.slate },
    loading: { paddingVertical: theme.spacing.lg, alignItems: 'center' },
    slot: { gap: theme.spacing.xs, paddingVertical: theme.spacing.sm },
    slotDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.hairline },
    assignBlock: { marginTop: theme.spacing.sm },
  }),
);
