/**
 * What the owner sees, after the lock, when the vault list cannot be opened
 * (decided 2026-09-26, follow-up). The app itself is not
 * mounted: nothing can show an empty list, and nothing can save one over the
 * real list (wallet/storage refuses too).
 *
 *   'waiting'  the Keychain has not answered for a while: Try again (the
 *              app also asks by itself, and whenever it comes to the front).
 *   otherwise  the key for the saved data is not on this phone, or did not
 *              seal it (wallet/sealedStore). Try again, or start fresh: the
 *              unreadable data is set aside, never deleted, and comes back
 *              by itself if its key ever returns.
 *
 * Title and buttons only (decided 2026-09-02); the why sits behind the info dot.
 * The buttons sit in the page's pinned footer (decided 2026-10-05), the title
 * centred above them as a hero block is.
 * Imports its parts from their own files, never the components barrel.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { AppDialog } from '../components/AppDialog';
import { InfoHeading } from '../components/InfoDot';
import { PageFooter } from '../components/PageFooter';
import { PageGlow } from '../components/PageGlow';
import { TaliaLogo } from '../components/TaliaLogo';
import { theme, themedStyles } from '../theme';
import type { StoreProblem } from '../../wallet/WalletProvider';

export const STORE_PROBLEM_TEXT = {
  waitingTitle: 'Talia cannot open its saved data right now',
  lostTitle: 'Talia cannot open the data saved on this phone',
  lostInfo:
    'The key that opens it is not on this phone. This can happen after moving to a new phone from a backup. ' +
    'Your coins are safe on your keys. Starting fresh keeps the old data aside, and Talia brings it back if the key returns. ' +
    'You can import your vaults again from their backup files.',
  retry: 'Try again',
  startFresh: 'Start fresh',
  confirmTitle: 'Start fresh on this phone?',
  cancel: 'Cancel',
} as const;

export function StoreProblemScreen({
  problem,
  onRetry,
  onStartFresh,
}: {
  problem: StoreProblem;
  onRetry: () => void;
  onStartFresh: () => Promise<void>;
}): React.JSX.Element {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const waiting = problem === 'waiting';
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <PageGlow />
      <View style={styles.body}>
        <TaliaLogo size={64} />
        {waiting ? (
          <InfoHeading style={styles.title} title={STORE_PROBLEM_TEXT.waitingTitle} text="Unlock the phone and try again.">
            {STORE_PROBLEM_TEXT.waitingTitle}
          </InfoHeading>
        ) : (
          <InfoHeading style={styles.title} title={STORE_PROBLEM_TEXT.lostTitle} text={STORE_PROBLEM_TEXT.lostInfo}>
            {STORE_PROBLEM_TEXT.lostTitle}
          </InfoHeading>
        )}
      </View>
      <PageFooter>
        <Button title={STORE_PROBLEM_TEXT.retry} onPress={onRetry} disabled={busy} />
        {!waiting && (
          <Button
            title={STORE_PROBLEM_TEXT.startFresh}
            variant="ghost"
            onPress={() => setConfirm(true)}
            disabled={busy}
            loading={busy}
          />
        )}
      </PageFooter>
      <AppDialog
        visible={confirm}
        title={STORE_PROBLEM_TEXT.confirmTitle}
        actions={[
          { label: STORE_PROBLEM_TEXT.cancel, variant: 'ghost', onPress: () => setConfirm(false) },
          {
            label: STORE_PROBLEM_TEXT.startFresh,
            destructive: true,
            onPress: () => {
              setConfirm(false);
              setBusy(true);
              void onStartFresh()
                .catch(() => undefined) // the Keychain did not answer: nothing changed, Try again stays
                .finally(() => setBusy(false));
            },
          },
        ]}
        onClose={() => setConfirm(false)}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.hull },
  // The logo and the title: a hero block, centred, with the room above and
  // below it; the footer takes the safe area.
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  title: { ...theme.typography.title, color: theme.colors.offWhite, textAlign: 'center' },
}));
