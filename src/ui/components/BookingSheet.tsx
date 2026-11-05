/**
 * BookingSheet — the in-app meeting scheduler (decided 2026-07-24).
 *
 * A bottom sheet that books directly against the backend's public
 * shareable-link endpoints: pick a day → pick a time → confirm. No website
 * hand-off. Used by the rescue protocol; built to be reused for support
 * meetings (pass a different link token + title).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from './AppModal';
import { BlurView } from '@react-native-community/blur';
import { cardGlow, Gloss } from './Gloss';
import { getColorScheme, theme, themedStyles } from '../theme';
import { Button } from './Button';
import { StepTransition } from './StepTransition';
import { DrawnIcon } from './DrawnIcon';
import {
  bookAppointment,
  fetchAvailableDays,
  fetchTimeSlots,
  deviceTimezone,
} from '../../services/booking';
import type { TimeSlot } from '../../services/booking';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

interface Props {
  visible: boolean;
  /** Shareable-link token (the UUID from the booking URL). */
  token: string;
  title: string;
  /** Shown under the title — what this meeting is for. */
  subtitle?: string;
  /** Pre-filled from the 21C session; the booking is made in this name. */
  contact: { firstName: string; lastName: string; email: string };
  /** Free-text context sent with the booking (e.g. vault label). */
  details?: string;
  /** A vault's setup (testing) meeting: book only with a working login,
   *  never anonymously (see bookAppointment). */
  signedInOnly?: boolean;
  onClose: () => void;
  /** Fired AFTER a successful booking (with the chosen UTC instant). */
  onBooked: (scheduledAtUtc: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(isoDate: string): { top: string; big: string; month: string } {
  const d = new Date(`${isoDate}T12:00:00`);
  return {
    top: WEEKDAYS[d.getDay()],
    big: String(d.getDate()),
    month: MONTHS[d.getMonth()],
  };
}

export function BookingSheet({
  visible,
  token,
  title,
  subtitle,
  contact,
  details,
  signedInOnly,
  onClose,
  onBooked,
}: Props): React.JSX.Element {
  const kb = useKeyboardHeight();
  const [phase, setPhase] = useState<'days' | 'slots' | 'confirm' | 'booked'>('days');
  const [days, setDays] = useState<string[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<TimeSlot[] | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('days');
    setDays(null);
    setDay(null);
    setSlots(null);
    setSlot(null);
    setBusy(false);
    setError(null);
  }, []);

  // Load available days each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    reset();
    let cancelled = false;
    fetchAvailableDays(token)
      .then((d) => !cancelled && setDays(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [visible, token, reset]);

  const pickDay = (d: string) => {
    setDay(d);
    setSlots(null);
    setSlot(null);
    setError(null);
    setPhase('slots');
    fetchTimeSlots(token, d)
      .then(setSlots)
      .catch((e) => setError((e as Error).message));
  };

  const book = async () => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      await bookAppointment(token, {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        scheduledAtUtc: slot.startUtc,
        details,
      }, { signedInOnly });
      setPhase('booked');
      onBooked(slot.startUtc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDate = slot
    ? new Date(slot.startUtc).toLocaleString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The sheet stays on the bottom of the screen and its OWN glass runs on
   behind the keyboard (reported 2026-09-21: "sharp edges at the corner of the
   lower part of the screen every time the keyboard is active"). A
   KeyboardAvoidingView lifted the whole sheet, so its square bottom edge
   sat on the keyboard's rounded corners. The keyboard's height is padding
   INSIDE the sheet instead, the way the Send screen's Priority sheet does. */}
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: kb }]}>
          {/* Frosted (decided 2026-09-12): the page blurs through the sheet. */}
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
            blurAmount={24}
            reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
          />
          <View style={styles.glassTint} pointerEvents="none" />
          <Gloss radius={theme.radius.lg} />
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.handle} />
            <Text style={styles.title}>{title}</Text>
            {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}

            <StepTransition
              stepKey={phase}
              order={['days', 'slots', 'confirm', 'booked']}
              style={styles.stepWrap}>
              {phase === 'days' && (
                <>
                  <Text style={styles.label}>PICK A DAY</Text>
                  {days == null && !error && <ActivityIndicator color={theme.colors.gold} />}
                  {days != null && days.length === 0 && (
                    <Text style={styles.sub}>
                      No free days in the next month. Please email
                      recovery@21stcapital.com.
                    </Text>
                  )}
                  <View style={styles.dayGrid}>
                    {(days ?? []).map((d) => {
                      const l = dayLabel(d);
                      return (
                        <TouchableOpacity
                          key={d}
                          style={styles.dayCard}
                          activeOpacity={0.8}
                          onPress={() => pickDay(d)}>
                          <Gloss radius={theme.radius.md} strength={cardGlow()} />
                          <Text style={styles.dayTop}>{l.top}</Text>
                          <Text style={styles.dayBig}>{l.big}</Text>
                          <Text style={styles.dayTop}>{l.month}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {phase === 'slots' && (
                <>
                  <Text style={styles.label}>
                    PICK A TIME · {deviceTimezone().replace(/_/g, ' ')}
                  </Text>
                  {slots == null && !error && <ActivityIndicator color={theme.colors.gold} />}
                  {slots != null && slots.length === 0 && (
                    <Text style={styles.sub}>That day just filled up. Pick another.</Text>
                  )}
                  <View style={styles.slotGrid}>
                    {(slots ?? []).map((s) => (
                      <TouchableOpacity
                        key={s.startUtc}
                        style={[styles.slotChip, slot?.startUtc === s.startUtc && styles.slotChipOn]}
                        activeOpacity={0.8}
                        onPress={() => {
                          setSlot(s);
                          setPhase('confirm');
                        }}>
                        <Text
                          style={[
                            styles.slotText,
                            slot?.startUtc === s.startUtc && styles.slotTextOn,
                          ]}>
                          {s.displayTime}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Button title="Back" variant="ghost" onPress={() => setPhase('days')} />
                </>
              )}

              {phase === 'confirm' && slot && (
                <>
                  <Text style={styles.label}>CONFIRM</Text>
                  <Text style={styles.confirmWhen}>{confirmDate}</Text>
                  <Text style={styles.sub}>
                    Booked as {contact.firstName} {contact.lastName} ({contact.email}).
                    You&apos;ll get a confirmation email with the meeting link.
                  </Text>
                  <Button
                    title={busy ? 'Booking…' : 'Book this meeting'}
                    onPress={() => void book()}
                    loading={busy}
                    disabled={busy}
                  />
                  <Button title="Back" variant="ghost" onPress={() => setPhase('slots')} disabled={busy} />
                </>
              )}

              {phase === 'booked' && (
                <>
                  <View style={styles.doneHead}>
                    <DrawnIcon kind="tick" size={26} strokeWidth={5} />
                    <Text style={styles.doneTitle}>Meeting booked</Text>
                  </View>
                  <Text style={styles.sub}>
                    {confirmDate}. A confirmation email is on its way to {contact.email}.
                  </Text>
                  <Button title="Done" onPress={onClose} />
                </>
              )}
            </StepTransition>

            {error && <Text style={styles.error}>{error}</Text>}
            {phase !== 'booked' && <Button title="Cancel" variant="ghost" onPress={onClose} />}
          </ScrollView>
        </View>
      </View>
    </AppModal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.colors.scrim, justifyContent: 'flex-end' },
  glassTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '88%',
  },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.surfaceRaised,
  },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  sub: { ...theme.typography.body, color: theme.colors.slate },
  stepWrap: { gap: theme.spacing.md },
  label: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  dayCard: {
    width: 72,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    gap: 2,
  },
  dayTop: { ...theme.typography.caption, color: theme.colors.slate },
  dayBig: { ...theme.typography.heading, color: theme.colors.offWhite },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  slotChip: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceRaised,
  },
  slotChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  slotText: { ...theme.typography.body, color: theme.colors.offWhite },
  slotTextOn: { ...theme.typography.bodyStrong, color: theme.colors.accentInk },
  confirmWhen: { ...theme.typography.heading, color: theme.colors.offWhite },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  doneTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flex: 1 },
  error: { ...theme.typography.caption, color: theme.colors.negative },
}));
