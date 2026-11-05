/**
 * Subscriptions — native management (decided 2026-07-21). List plans, toggle
 * auto-renewal (card plans), cancel with typed confirmation. Bitcoin-paid
 * plans have no auto-renew (mirrors the website).
 *
 * In the builds that sell nothing (PURCHASES_ENABLED off: the watch-only App
 * Store app and the signing TestFlight app) the page is "Membership" and every
 * card is read-only: the plan's name and a plain status, with no price,
 * renewal, auto-renewal switch, cancellation or penalty footer. Apple
 * photographed all of those here (guideline 2.1(b), letter of 2026-09-11). A
 * Lifetime Elite row shows none of them in any build: there is no billing
 * behind it (2026-09-12).
 *
 * Every card is drawn like a vault card (decided 2026-09-21): a tile whose icon is
 * the plan (billing.planIcon), the name, a line under it, and the status over
 * the date the plan runs to. "Until <date>" is information and shows in every
 * build; "Renews" only where purchases are on (billing.planDeadline).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SettingsStackParamList } from '../navigation/types';
import { AppDialog, Button, Gloss, WalletIconTile, cardGlow } from '../components';
import { theme, themedStyles } from '../theme';
import { PURCHASES_ENABLED } from '../../config';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import {
  fetchSubscriptions,
  heldPlanStatus,
  membershipState,
  planDeadline,
  planIcon,
  planSubtitle,
  planTitle,
  withLifetimeMembership,
} from '../../services/billing';
import type { Subscription } from '../../services/billing';
import { cancelSubscription, fetchProfile, toggleAutoRenew } from '../../services/settingsApi';
import { STORE_COPY } from './storeCopy';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Subscriptions'>;

export function SubscriptionsScreen({ navigation }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<CompanySession | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<Subscription | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async (s: CompanySession) => {
    // The server adds its Lifetime Elite row only when a member has no other
    // rows, so the profile's flag supplies it. A failed profile read leaves
    // the list exactly as the server sent it.
    const [list, profile] = await Promise.all([
      fetchSubscriptions(s),
      fetchProfile(s).catch(() => null),
    ]);
    setSubs(withLifetimeMembership(list, profile?.lifetimeElite === true));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await loadSession();
        if (!s) {
          navigation.goBack();
          return;
        }
        setSession(s);
        await reload(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [navigation, reload]);

  /** The word at the top right: whether the plan runs. The date sits under
   *  it (planDeadline). The full app keeps the billing status of the
   *  client's own plans ("Cancelled", "Pending"). */
  const statusWord = (sub: Subscription): { text: string; active: boolean } => {
    if (sub.held) {
      const active = heldPlanStatus(sub) === 'Active';
      return { text: active ? STORE_COPY.statusActive : STORE_COPY.statusInactive, active };
    }
    if (PURCHASES_ENABLED && !sub.lifetime) {
      const raw = sub.status.toLowerCase();
      return { text: raw.charAt(0).toUpperCase() + raw.slice(1), active: raw === 'active' };
    }
    const active = membershipState(sub).kind === 'active';
    return { text: active ? STORE_COPY.statusActive : STORE_COPY.statusInactive, active };
  };

  const onToggleRenew = async (sub: Subscription) => {
    if (!session) return;
    setBusyId(sub.id);
    setError(null);
    try {
      await toggleAutoRenew(session, sub.id, !(sub.autoRenew === true));
      await reload(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const onCancel = async () => {
    if (!session || !cancelFor) return;
    setBusyId(cancelFor.id);
    setError(null);
    try {
      await cancelSubscription(session, cancelFor.id);
      await reload(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
      setCancelFor(null);
    }
  };

  return (
    // No action of the page's own ("Cancel subscription" is a plan card's), so
    // no footer: the content ends at the safe area, as a Screen's does.
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
      {loading ? (
        <Text style={styles.muted}>Loading your plans…</Text>
      ) : subs.length === 0 ? (
        <Text style={styles.muted}>
          {PURCHASES_ENABLED ? 'No subscriptions on this account yet.' : STORE_COPY.membershipEmpty}
        </Text>
      ) : (
        subs.map((s) => {
          const active = s.status.toLowerCase() === 'active';
          const isBtc = (s.provider ?? '').toUpperCase() === 'BTC';
          // Price, renewal and cancellation: the full app only, and never on
          // a Lifetime Elite row, which has no billing behind it.
          // Nor on a plan somebody else pays for (decided 2026-09-20): the row
          // says "paid for by Toni" and whether it runs, and the billing is
          // the payer's alone: no price, no switch, no cancellation.
          const billing = PURCHASES_ENABLED && !s.lifetime && !s.held;
          const status = statusWord(s);
          const deadline = planDeadline(s, { purchases: PURCHASES_ENABLED });
          const subtitle = planSubtitle(s);
          return (
            // The vault card (decided 2026-09-21: "make them match our vault
            // containers"): the glossy tile, the name and a line under it,
            // and on the right the status over the date.
            <View key={s.id} style={styles.card}>
              <Gloss radius={theme.radius.lg} strength={cardGlow()} />
              <View style={styles.cardRow}>
                <WalletIconTile icon={planIcon(s)} />
                <View style={styles.cardLeft}>
                  <Text style={styles.cardName} numberOfLines={2}>
                    {planTitle(s, PURCHASES_ENABLED ? 'Subscription' : STORE_COPY.planFallback)}
                  </Text>
                  {!!subtitle && (
                    <Text style={styles.cardSub} numberOfLines={2}>
                      {subtitle}
                    </Text>
                  )}
                </View>
                <View style={styles.cardRight}>
                  <Text style={[styles.status, status.active && styles.statusActive]}>{status.text}</Text>
                  {!!deadline && <Text style={styles.cardDate}>{deadline}</Text>}
                </View>
              </View>
              {billing && s.amount != null && (
                <Text style={styles.metaLine}>${s.amount} / year</Text>
              )}
              {billing && !isBtc && active && (
                <View style={styles.renewRow}>
                  <Text style={styles.renewLabel}>Auto-renewal</Text>
                  <Switch
                    value={s.autoRenew === true}
                    onValueChange={() => void onToggleRenew(s)}
                    disabled={busyId === s.id}
                    trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
                    ios_backgroundColor={theme.colors.switchOff}
                    thumbColor={theme.colors.switchThumb}
                  />
                </View>
              )}
              {billing && isBtc && active && (
                <Text style={styles.btcNote}>
                  Paid with Bitcoin. We email you a renewal link before it ends.
                </Text>
              )}
              {billing && active && (
                <Button
                  title="Cancel subscription"
                  variant="ghost"
                  onPress={() => setCancelFor(s)}
                />
              )}
            </View>
          );
        })
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {/* Somebody whose only plan is paid for by another person has nothing
          to cancel, so the note about cancelling is not theirs to read. */}
      {PURCHASES_ENABLED && !(subs.length > 0 && subs.every((x) => x.held)) && (
        <Text style={styles.note}>
          Cancelling never locks your vault. Without an active plan, using
          21st Capital keys or services carries a 10% penalty under our terms.
        </Text>
      )}

      {/* No cancellation exists at all where nothing is sold. */}
      {PURCHASES_ENABLED && cancelFor && (
        <AppDialog
          visible
          title="Cancel this subscription?"
          message={`"${cancelFor.planName ?? 'Your plan'}" stays active until the end of the paid period, then will not renew. Your vault remains fully usable either way.`}
          actions={[
            { label: 'Cancel subscription', destructive: true, onPress: () => void onCancel() },
            { label: 'Keep my plan', variant: 'ghost', onPress: () => setCancelFor(null) },
          ]}
          onClose={() => setCancelFor(null)}
        />
      )}
    </ScrollView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  // The home screen's vault card, token for token (WalletListScreen card,
  // cardLeft, cardName, cardTicker, cardRight, cardFiat): the same ground,
  // corners, padding and finish, so the two read as one family.
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  cardLeft: { flex: 1, gap: 2, minWidth: 0 },
  cardName: { ...theme.typography.heading, color: theme.colors.offWhite },
  cardSub: { ...theme.typography.caption, color: theme.colors.slate },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  cardDate: { ...theme.typography.caption, color: theme.colors.slate },
  status: { ...theme.typography.heading, color: theme.colors.slate },
  statusActive: { color: theme.colors.positive },
  metaLine: { ...theme.typography.caption, color: theme.colors.slate },
  renewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  renewLabel: { ...theme.typography.body, color: theme.colors.offWhite },
  btcNote: { ...theme.typography.caption, color: theme.colors.slate },
  note: { ...theme.typography.caption, color: theme.colors.faint },
  error: { ...theme.typography.caption, color: theme.colors.negative },
}));
