/**
 * Talk to us — chat, and schedule-a-call booked INSIDE the app through the
 * same BookingSheet as the rescue meeting (decided 2026-07-26: no website
 * bounce). Chat still opens the site, in the full app only: the site's
 * support page offers paid Priority Help, a purchase outside Apple's
 * (guideline 3.1.1), so the builds that sell nothing keep the call alone.
 * URLs live in src/config.ts.
 */
import React, {useState, useEffect, useRef, useMemo } from 'react';
import { ScrollView, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BookingSheet, ChevronRightIcon, Gloss, PageHead, Screen, TaliaLogo, cardGlow } from '../components';
import { theme, themedStyles } from '../theme';
import { MessageCircleIcon, PhoneIcon } from '../components/TablerIcons';
import { PURCHASES_ENABLED, SUPPORT } from '../../config';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { useNavigation } from '@react-navigation/native';

export function ContactScreen(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  // Tab icon press jumps to the top (decided 2026-07-18).
  const scrollRef = useRef<ScrollView | null>(null);
  const navigation = useNavigation();
  useEffect(() => {
    return navigation.addListener('tabPress' as never, () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [navigation]);

  // In-app scheduling needs the shareable-link token (last path segment of
  // the booking URL) and the account to book in. Without either we fall
  // back to opening the website, so support is never unreachable.
  const [session, setSession] = useState<CompanySession | null>(null);
  useEffect(() => {
    void loadSession().then(setSession);
  }, []);
  const [booking, setBooking] = useState(false);
  const [bookedAt, setBookedAt] = useState<string | null>(null);
  const bookingToken = useMemo(() => {
    const m = /\/book-appointment\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i.exec(
      SUPPORT.scheduleCallUrl,
    );
    return m ? m[1] : null;
  }, []);

  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // The website sentence stays out of the builds that sell nothing.
      setError(
        PURCHASES_ENABLED
          ? 'Could not open the link. Please visit 21stcapital.com directly.'
          : 'Could not open the link.',
      );
    }
  };

  const onScheduleCall = () => {
    if (bookingToken && session) {
      setBooking(true);
      return;
    }
    void open(SUPPORT.scheduleCallUrl);
  };

  return (
    <Screen scroll scrollRef={scrollRef} style={styles.content}>
      {/* Centred, like every page head with an icon over its title (decided
          2026-10-05): PageHead is the one piece. */}
      <PageHead
        icon={<TaliaLogo size={64} />}
        title="We're here to help"
        line="Talk to a real person at 21st Capital."
        style={styles.head}
      />

      {/* The website's support page leads to a paid checkout: full app only. */}
      {PURCHASES_ENABLED && (
        <TouchableOpacity style={styles.tile} onPress={() => open(SUPPORT.chatUrl)} activeOpacity={0.85}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <View style={styles.tileIcon}>
            <Gloss size={44} radius={theme.radius.md} />
            <MessageCircleIcon size={26} color={theme.colors.gold} />
          </View>
          <View style={styles.tileBody}>
            <Text style={styles.tileTitle}>Chat with us</Text>
            <Text style={styles.tileSub}>Start a conversation on our website</Text>
          </View>
          <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.tile} onPress={onScheduleCall} activeOpacity={0.85}>
        <Gloss radius={theme.radius.lg} strength={cardGlow()} />
        <View style={styles.tileIcon}>
          <Gloss size={44} radius={theme.radius.md} />
          <PhoneIcon size={26} color={theme.colors.gold} />
        </View>
        <View style={styles.tileBody}>
          <Text style={styles.tileTitle}>Schedule a meeting</Text>
          <Text style={styles.tileSub}>Pick a time that suits you</Text>
        </View>
        <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
      </TouchableOpacity>

      {!!bookedAt && (
        <Text style={styles.booked}>
          Your meeting is booked for {new Date(bookedAt).toLocaleString()}. You&apos;ll
          get a confirmation by email.
        </Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <BookingSheet
        visible={booking}
        token={bookingToken ?? ''}
        title="Talk to 21st Capital"
        subtitle="Pick a time and we'll send you the meeting link."
        contact={{
          firstName: session?.firstName || (session?.email ?? '').split('@')[0] || 'Talia',
          lastName: session?.lastName || '(Talia app)',
          email: session?.email ?? '',
        }}
        details="Support call booked in the Talia app"
        onClose={() => setBooking(false)}
        onBooked={(iso) => {
          setBooking(false);
          setBookedAt(iso);
        }}
      />

      <Text style={styles.footnote}>
        {/* Decided 2026-09-22: we cannot move a client's coins, and the rescue
            key needs the vault's descriptor, which we never have unless the
            client shares it in a rescue request. */}
        Talia is self-custodial. 21st Capital can help you use the app, but we
        never hold your keys or your vault’s descriptor, so we cannot move your
        funds. Only a rescue you request, sharing the descriptor with us, lets us
        help move them.
      </Text>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.md },
  // The head is PageHead's (centred, decided 2026-10-05); the page keeps only
  // the room under it before the first tile.
  head: { marginBottom: theme.spacing.lg },

  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { flex: 1 },
  tileTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  tileSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },

  error: { ...theme.typography.caption, color: theme.colors.negative },
  booked: { ...theme.typography.caption, color: theme.colors.accentText },
  footnote: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
}));
