/**
 * Join a shared portfolio (decided 2026-09-12), the mirror of ClaimInviteScreen.
 *
 * The person enters the TALIA-P code from their invite (or arrives through
 * the talia://invite/CODE link, which the website hands off). Claiming binds
 * the invite to their 21st Capital account and returns the sealed card and
 * the share's current blob; the code opens the card, the card's key opens
 * the blob, and the portfolio lands on the Portfolio tab under the owner's
 * own id so entries line up on every phone. From then on the provider's
 * sync loop keeps it in step.
 *
 * Works in the watch-only build: sharing a portfolio is not signing.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { AppDialog, AuthSheet, Button, InfoHeading, Screen, TextField } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, clearManualEntries, saveManualEntries } from '../../wallet';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { isPortfolioInviteCode } from '../../crypto/sharedPortfolio';
import { recordEntryTombstones } from '../../services/virtualVaultSync';
import { claimShareInvite, removeShareKey, storeShareKey } from '../../services/sharedPortfolio';
import { clearKrakenCredentials } from '../../services/krakenSync';
import { clearCoinbaseCredentials } from '../../services/coinbaseSync';

type Props = NativeStackScreenProps<VirtualStackParamList, 'ClaimSharedPortfolio'>;

export function ClaimSharedPortfolioScreen({ route, navigation }: Props): React.JSX.Element {
  const { wallets, addWallet, updateWallet, syncVirtualVaults } = useWallets();

  const [codeInput, setCodeInput] = useState(route.params?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [authOpen, setAuthOpen] = useState(false);
  const [joined, setJoined] = useState<{ walletId: string; label: string; already: boolean } | null>(null);

  // Deep-link arrivals while the screen is open.
  useEffect(() => {
    if (route.params?.code) setCodeInput(route.params.code);
  }, [route.params?.code]);

  const doClaim = async (session?: CompanySession | null): Promise<void> => {
    if (!isPortfolioInviteCode(codeInput)) {
      setNotice('A portfolio invite code looks like TALIA-P-XXXXX-XXXXX-XXXXX-XXXXX. Check it and try again.');
      return;
    }
    setNotice(undefined);
    setBusy(true);
    try {
      const s = session ?? (await loadSession());
      if (!s) {
        setAuthOpen(true);
        return;
      }
      const result = await claimShareInvite(s, codeInput);
      const { card, vault } = result;
      const shareMeta = {
        shareId: result.shareId,
        role: result.role,
        since: Date.now(),
        version: result.version,
      };

      const existing = wallets.find((w) => w.id === card.portfolioId);
      if (existing) {
        if (!existing.manual) {
          setNotice('Something on this phone already uses this portfolio id. The invite cannot be used here.');
          return;
        }
        const current = existing.sharedPortfolio;
        if (current && !current.ended && current.shareId !== result.shareId) {
          setNotice('This portfolio is already on this phone as part of another share.');
          return;
        }
        // The same share claimed again, or a copy that arrived without the
        // key (through account sync, or after sharing had stopped): attach
        // the key and the share, and let the sync loop merge the two copies.
        await storeShareKey(result.shareId, card.key);
        // A copy that was this phone's own may carry sources: an exchange key
        // in the Keychain, a vault feeding it. A MEMBER mirrors the owner and
        // has no way to disconnect either, so they go now (decided 2026-09-14).
        // The OWNER tapping their own invite link keeps everything: that API
        // secret lives nowhere but this Keychain and cannot be minted again.
        const joiningAsMember = result.role === 'member';
        if (joiningAsMember) {
          await clearKrakenCredentials(existing.id);
          await clearCoinbaseCredentials(existing.id);
          for (const v of wallets.filter((w) => !w.manual && w.linkedPortfolioId === existing.id)) {
            await updateWallet(v.id, { linkedPortfolioId: undefined });
          }
        }
        await updateWallet(existing.id, {
          ...(joiningAsMember ? { exchangeLink: undefined, exchangeLinks: [] } : {}),
          sharedPortfolio:
            current && current.shareId === result.shareId
              ? { ...current, ended: undefined, lastError: undefined, version: result.version }
              : shareMeta,
        });
        setCodeInput('');
        setJoined({ walletId: existing.id, label: existing.label, already: true });
        void syncVirtualVaults();
        return;
      }

      await storeShareKey(result.shareId, card.key);
      // Entries first: if that write fails there is nothing to clean up.
      await saveManualEntries(card.portfolioId, vault.entries);
      await recordEntryTombstones(card.portfolioId, vault.deletedEntries ?? []);
      let walletId: string;
      const label = vault.label || card.label;
      try {
        const added = await addWallet({
          id: card.portfolioId,
          label,
          icon: vault.icon ?? card.icon,
          descriptor: '',
          network: 'bitcoin',
          kind: 'unknown',
          source: 'generic',
          transport: 'created',
          manual: true,
          // The blob's own stamp, not "now": the first sync then finds this
          // copy identical to the share and pushes nothing.
          manualUpdatedAt: vault.updatedAt,
          sharedPortfolio: shareMeta,
        });
        walletId = added.id;
      } catch (e) {
        await clearManualEntries(card.portfolioId);
        await removeShareKey(result.shareId);
        throw e;
      }
      setCodeInput('');
      setJoined({ walletId, label, already: false });
      void syncVirtualVaults();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not join the portfolio.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      style={styles.content}
      // The page's one action, pinned at the foot (decided 2026-10-05); it waits
      // on the code in colour, never opacity.
      footer={
        <Button
          title={busy ? 'Joining…' : 'Join'}
          onPress={() => void doClaim()}
          loading={busy}
          disabled={busy || codeInput.trim().length === 0}
        />
      }>
      <InfoHeading
        title="What joining does"
        text="You get a copy of the portfolio on this phone. It shows every entry and stays up to date. Only the owner adds or changes entries. The copy is encrypted with a key only the participants hold, so 21st Capital cannot read it. Your own portfolios are not shared."
        style={styles.title}>
        Join a shared portfolio
      </InfoHeading>
      <Text style={styles.body}>Enter the code you were given.</Text>
      <TextField
        label="Invite code"
        value={codeInput}
        onChangeText={setCodeInput}
        autoCapitalize="characters"
        monospace
        placeholder="TALIA-P-XXXXX-XXXXX-XXXXX-XXXXX"
      />
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <AuthSheet
        visible={authOpen}
        defaultMode="signup"
        onClose={() => setAuthOpen(false)}
        onAuthed={(s) => {
          setAuthOpen(false);
          if (isPortfolioInviteCode(codeInput)) void doClaim(s);
        }}
      />

      <AppDialog
        visible={joined != null}
        title={joined ? (joined.already ? `“${joined.label}” is already on this phone` : `You joined “${joined.label}”`) : ''}
        actions={[
          {
            label: 'Open the portfolio',
            variant: 'primary',
            onPress: () => {
              const id = joined?.walletId;
              setJoined(null);
              // replace, not navigate: back must not return to a used code.
              if (id) navigation.replace('ManualWallet', { walletId: id });
            },
          },
        ]}
        onClose={() => {
          const id = joined?.walletId;
          setJoined(null);
          if (id) navigation.replace('ManualWallet', { walletId: id });
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // The Screen keeps the footer's room clear; no bottom padding of its own.
    content: { gap: theme.spacing.md },
    title: { ...theme.typography.title, color: theme.colors.offWhite },
    body: { ...theme.typography.body, color: theme.colors.slate },
    notice: { ...theme.typography.caption, color: theme.colors.slate },
  }),
);
