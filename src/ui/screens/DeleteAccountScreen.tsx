/**
 * Delete account — native flow (decided 2026-07-21). Same safety model as the
 * website: we send a confirmation EMAIL; the link in it finishes the
 * deletion. Nothing is deleted from inside the app directly. Vaults are
 * watch-only descriptors — deleting the ACCOUNT never touches funds.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { AppDialog, Button, DrawnIcon, InfoHeading, Screen } from '../components';
import { theme, themedStyles } from '../theme';
import { loadSession } from '../../services/companyAuth';
import { requestAccountDeletion } from '../../services/settingsApi';

type Props = NativeStackScreenProps<SettingsStackParamList, 'DeleteAccount'>;

/** The consent box, and the offset that centres the first caption line on it. */
const CHECK = 24;
const CHECK_TEXT_TOP = (CHECK - theme.typography.caption.lineHeight) / 2;

export function DeleteAccountScreen({ navigation }: Props): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const request = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) throw new Error('Please sign in again first.');
      await requestAccountDeletion(session);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      underHeader
      style={styles.content}
      // The page's two actions at its foot (decided 2026-10-05): the request,
      // then the way out.
      footer={
        <>
          <Button
            title={busy ? 'Sending…' : 'Send confirmation email'}
            onPress={() => void request()}
            loading={busy}
            disabled={!checked || busy}
          />
          <Button title="Keep my account" variant="ghost" onPress={() => navigation.goBack()} />
        </>
      }>
      <InfoHeading
        style={styles.title}
        title="What gets deleted"
        // Decided 2026-09-22: "keep working watch only" was true only in the
        // watch-only build, and a keyless heir has no keys on hardware.
        text="Deleting the account removes your plan, your Estate Plan and your 21st Capital services. It does not touch your bitcoin: your vaults are on-chain, not in the account, and they stay in this app.">
        Delete your 21st Capital account
      </InfoHeading>
      <Text style={styles.body}>
        This deletes your account, your plan and your Estate Plan. Your bitcoin
        is not touched.
      </Text>
      <Text style={styles.body}>
        We email you a link. The deletion happens only when you open it, and the
        link expires in 24 hours.
      </Text>
      <TouchableOpacity style={styles.consentRow} onPress={() => setChecked(!checked)}>
        <View style={[styles.checkbox, checked && styles.checkboxOn]}>
          {checked && <DrawnIcon kind="tick" size={13} strokeWidth={4} color={theme.colors.accentInk} />}
        </View>
        <Text style={styles.consentText}>
          I understand my account, plan and Estate Plan will be
          deleted, and that my on-chain funds are unaffected.
        </Text>
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}

      {sent && (
        <AppDialog
          visible
          title="Confirmation email sent"
          message="Check your inbox and open the link to finish deleting your account. The link expires in 24 hours. If you change your mind, just ignore it."
          actions={[{ label: 'Done', onPress: () => navigation.goBack() }]}
          onClose={() => setSent(false)}
        />
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.md },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  body: { ...theme.typography.body, color: theme.colors.slate },
  consentRow: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  checkbox: {
    width: CHECK,
    height: CHECK,
    borderRadius: theme.radius.sm,
    borderWidth: 1.5,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  consentText: { ...theme.typography.caption, color: theme.colors.slate, flex: 1, paddingTop: CHECK_TEXT_TOP },
  error: { ...theme.typography.caption, color: theme.colors.negative },
}));
