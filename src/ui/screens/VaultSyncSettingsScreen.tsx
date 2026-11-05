/**
 * Virtual-vault sync settings (decided 2026-08-26).
 *
 * The pitch, honestly stated on screen: portfolios sync through the 21C
 * account, encrypted on the phone with a password we never see — so the
 * server cannot read amounts, prices, dates or notes without that password
 * (a weak one could be guessed offline against the sealed copy, which is why
 * the FIRST phone must choose a strong one, decided 2026-09-26), and a forgotten
 * password means the SYNCED copy is unrecoverable (the phone's own data and
 * any exports are unaffected). A forgotten password is not a dead end
 * (decided 2026-09-30): when the password does not open the account's copy,
 * "Start over" deletes that copy and turns sync on with the new one.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme, themedStyles } from '../theme';
import { AppDialog, Button, Card, InfoHeading, Screen, StatusCard, TextField } from '../components';
import { useWallets } from '../../wallet';
import { loadSession } from '../../services/companyAuth';
import {
  disableSync,
  enableSync,
  isSyncEnabled,
  isSyncPasswordMismatch,
  lastSyncAt,
} from '../../services/virtualVaultSync';

export function VaultSyncSettingsScreen(): React.JSX.Element {
  const { syncVirtualVaults } = useWallets();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [lastAt, setLastAt] = useState<number | undefined>();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  /** The password did not open the synced copy: offer to start over. */
  const [mismatch, setMismatch] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const refresh = useCallback(async () => {
    const [session, on, at] = await Promise.all([loadSession(), isSyncEnabled(), lastSyncAt()]);
    setLoggedIn(session != null);
    setEnabled(on);
    setLastAt(at);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const turnOn = async (replaceExisting = false): Promise<void> => {
    setError(undefined);
    if (pw.length === 0) {
      setError('Type your sync password.');
      return;
    }
    if (pw !== pw2) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      // Checks the password: strong enough when this is the account's first
      // synced copy (or a fresh one after starting over), or the one that
      // opens the copy already there.
      await enableSync(pw, { replaceExisting });
      setPw('');
      setPw2('');
      setMismatch(false);
      const outcome = await syncVirtualVaults();
      if (outcome.kind === 'failed') {
        setError(`Enabled, but the first sync failed: ${outcome.message}`);
      }
      await refresh();
    } catch (e) {
      setMismatch(isSyncPasswordMismatch(e));
      setError(e instanceof Error ? e.message : 'Could not turn sync on. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const syncNow = () => {
    setError(undefined);
    setBusy(true);
    void syncVirtualVaults()
      .then((o) => {
        if (o.kind === 'failed') setError(o.message);
        if (o.kind === 'skipped' && o.reason === 'noPassword') {
          setError('The sync password is missing on this phone. Turn sync off and on again.');
        }
        if (o.kind === 'skipped' && o.reason === 'wrongAccount') {
          setError('Sync belongs to a different 21st Capital account than the one logged in.');
        }
        return refresh();
      })
      .finally(() => setBusy(false));
  };

  // The page's actions, pinned at the foot (decided 2026-10-05), per state: the
  // primary first, the quiet choice last. Logged out or still reading, the
  // page has no action and so no footer.
  const footer =
    loggedIn === true && !enabled ? (
      <>
        <Button title="Turn sync on" onPress={() => void turnOn()} loading={busy} disabled={busy} />
        {mismatch && (
          <Button
            title="Start over with this password"
            variant="ghost"
            onPress={() => setConfirmReplace(true)}
            disabled={busy}
          />
        )}
      </>
    ) : loggedIn === true && enabled ? (
      <>
        <Button title="Sync now" onPress={syncNow} loading={busy} disabled={busy} />
        <Button title="Turn sync off" variant="ghost" onPress={() => setConfirmOff(true)} disabled={busy} />
      </>
    ) : undefined;

  return (
    <Screen scroll footer={footer}>
      <View style={styles.body}>
        {/* No lede (reported 2026-09-21: "Its repeated and not necessary"): the
            title and the card below already say what sync does. */}
        <Card style={styles.note}>
          <InfoHeading
            style={styles.noteTitle}
            title="Private by construction"
            text="Everything is encrypted on this phone with your sync password before it leaves. 21st Capital stores only the sealed result and cannot read your amounts, prices, dates or notes without your sync password, which is why it has to be a strong one. That is also why nobody can recover the synced copy if you forget the password. Your data on this phone and your exports are unaffected. Turning sync on takes about ten seconds while your key is prepared, once on this phone.">
            Private by construction
          </InfoHeading>
          <Text style={styles.noteText}>
            Everything is encrypted on this phone before it leaves, so
            21st Capital cannot read it without your sync password. Forget your sync password and the
            synced copy is gone for good. This phone keeps its data either way.
          </Text>
        </Card>

        {loggedIn === false && (
          <Text style={styles.warn}>
            Sync needs your 21st Capital account. Log in under Settings first.
          </Text>
        )}

        {loggedIn === true && !enabled && (
          <View style={styles.form}>
            <TextField
              label="Sync password"
              value={pw}
              onChangeText={(t) => {
                setPw(t);
                setMismatch(false);
              }}
              secure
              placeholder="At least 12 characters"
            />
            <TextField
              label="Repeat it"
              value={pw2}
              onChangeText={setPw2}
              secure
              placeholder="Same password again"
              error={error}
            />
            <Text style={styles.hint}>
              Turning sync on takes about ten seconds. Use the same password on
              your other phones: it is what unlocks the data.
            </Text>
          </View>
        )}

        {loggedIn === true && enabled && (
          <>
            {/* The same status card as the Network page (decided 2026-10-05):
                the state and the last sync centred, no heading. */}
            <StatusCard
              tone="ok"
              state="Sync is on"
              detail={
                lastAt != null
                  ? `Last synced ${new Date(lastAt).toLocaleString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Not synced yet'
              }
            />
            {error && <Text style={styles.warn}>{error}</Text>}
          </>
        )}
      </View>

      <AppDialog
        visible={confirmReplace}
        title="Replace the synced copy?"
        actions={[
          { label: 'Cancel', variant: 'ghost', onPress: () => setConfirmReplace(false) },
          {
            label: 'Replace it',
            destructive: true,
            onPress: () => {
              setConfirmReplace(false);
              void turnOn(true);
            },
          },
        ]}
        onClose={() => setConfirmReplace(false)}
      />

      <AppDialog
        visible={confirmOff}
        title="Turn sync off?"
        message="Your portfolios stay on this phone either way. The synced copy is unreadable without your password, and you can remove it from your account as well."
        actions={[
          { label: 'Cancel', variant: 'ghost', onPress: () => setConfirmOff(false) },
          {
            label: 'Turn off on this phone',
            onPress: () => {
              setConfirmOff(false);
              void disableSync(false).then(refresh);
            },
          },
          {
            label: 'Turn off and remove from my account',
            destructive: true,
            onPress: () => {
              setConfirmOff(false);
              void disableSync(true).then((serverOk) => {
                if (!serverOk) {
                  setError(
                    'Sync is off on this phone, but the server copy could not be removed. Try again from Settings while online.',
                  );
                }
                return refresh();
              });
            },
          },
        ]}
        onClose={() => setConfirmOff(false)}
      />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // The Screen keeps the footer's room clear; no bottom padding of its own.
  body: { gap: theme.spacing.lg },
  form: { gap: theme.spacing.md },
  note: { gap: theme.spacing.sm },
  // The card heading token in the card heading colour, as every card's
  // (decided 2026-10-05: in accentText it sat green over the status card's
  // white "Status", two card headings in two colours on one page).
  noteTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  noteText: { ...theme.typography.caption, color: theme.colors.slate },
  warn: { ...theme.typography.caption, color: theme.colors.gold },
  hint: { ...theme.typography.caption, color: theme.colors.faint },
  // The status card is StatusCard's, as on the Network page.
}));
