/**
 * Booking the setup meeting in the app (decided 2026-09-21).
 *
 * One hook for the one sheet, so the vault list's first-run card and the
 * Settings row book the meeting exactly the same way the vault testing
 * banner does: the token is the last segment of the server's booking url,
 * the sheet books through the public shareable-link endpoints and shows its
 * own "Meeting booked" step, and the name and email come from the signed-in
 * session. A url that is not a booking link opens in the browser instead.
 */
import React, { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { BookingSheet } from '../components';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { SETUP_MEETING_COPY, setupMeetingDetails } from '../../services/setupMeeting';
import type { SetupMeetingOffer } from '../../services/setupMeeting';

interface Booking {
  offer: SetupMeetingOffer;
  session: CompanySession;
}

export function useSetupMeetingSheet(): {
  /** Open the sheet for this offer, or the booking page for a plain link. */
  open: (offer: SetupMeetingOffer) => void;
  /** A meeting booked right here, until the backend reports it itself. It
   *  carries the vault it was booked for, because a screen that stays
   *  mounted can be asked about another vault later; `bookedMomentFor` is
   *  what reads it. */
  justBooked: { vaultNumber: number; ms: number } | null;
  sheet: React.JSX.Element | null;
} {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [justBooked, setJustBooked] = useState<{ vaultNumber: number; ms: number } | null>(null);

  const open = useCallback((offer: SetupMeetingOffer) => {
    void (async () => {
      if (offer.token) {
        const session = await loadSession().catch(() => null);
        if (session) {
          setBooking({ offer, session });
          return;
        }
      }
      if (offer.bookingUrl) void Linking.openURL(offer.bookingUrl).catch(() => {});
    })();
  }, []);

  const sheet = booking ? (
    <BookingSheet
      visible
      token={booking.offer.token ?? ''}
      title={SETUP_MEETING_COPY.title}
      subtitle={SETUP_MEETING_COPY.sheetSubtitle}
      contact={{
        firstName:
          booking.session.firstName || (booking.session.email ?? '').split('@')[0] || 'Talia',
        lastName: booking.session.lastName || '(Talia app)',
        email: booking.session.email ?? '',
      }}
      details={setupMeetingDetails(booking.offer.vaultNumber)}
      signedInOnly
      onClose={() => setBooking(null)}
      onBooked={(iso) => {
        const ms = Date.parse(iso);
        if (Number.isFinite(ms)) setJustBooked({ vaultNumber: booking.offer.vaultNumber, ms });
      }}
    />
  ) : null;

  return { open, justBooked, sheet };
}
