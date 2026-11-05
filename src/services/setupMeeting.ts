/**
 * The setup meeting of a vault somebody else pays for (decided 2026-09-21: "You
 * can build the setup meeting inside the app").
 *
 * A family member whose vault is not built yet books their own setup meeting
 * from their own login, through the same public shareable link the payer is
 * sent to after payment. The backend hands the link per holding
 * (`setup_meeting` on each entry of the entitlement's `holdings`), so the app
 * only has to decide whether there is anything to book, where the button
 * belongs and what the line reads once a meeting stands. All of that is here,
 * pure and tested, and the screens only ask and draw.
 *
 * An older backend sends no `setup_meeting` at all: every answer here is then
 * "nothing to book", and the app looks exactly as it did before.
 */
import { isUpcomingSession } from './booking';
import type { KeyEntitlement } from './companyAuth';

export type { SetupMeetingInfo } from './companyAuth';

/** The words. "Meeting", never "call" (the company rule). */
export const SETUP_MEETING_COPY = {
  /** The quiet second button of the first-run state. */
  button: 'Book your setup meeting',
  /** The Settings row and the booking sheet. */
  title: 'Setup meeting',
  settingsSub: 'Book the meeting for the vault that is yours',
  sheetSubtitle: 'We set your vault up together, step by step.',
} as const;

/** What a screen needs to draw the button, or the line. */
export interface SetupMeetingOffer {
  vaultNumber: number;
  /** Server-controlled booking link; "" once there is nothing to book. */
  bookingUrl: string;
  /** The shareable-link token: the last segment of the booking url. Null
   *  when the url is not a booking link (a contact page, say), and the tap
   *  then opens the url itself, exactly as the vault testing banner does. */
  token: string | null;
  /** The meeting that already stands, in milliseconds; null when none. */
  bookedAtMs: number | null;
}

// The page the backend serves a shareable link on, and the link's token. The
// path matters as much as the shape: the setting is typed by hand, and any
// other page of ours whose last segment happens to be a uuid (a client's own
// vault page, say) is NOT something the booking endpoints can answer for.
// The same expression reads the testing and rescue links elsewhere in the app.
const BOOKING_LINK = /\/book-appointment\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

/**
 * The shareable-link token of a booking url: the uuid of its book-appointment
 * page, with any query, fragment or trailing slash ignored. Null for anything
 * that is not a booking link, so the caller can open it in the browser
 * instead.
 */
export function bookingToken(url: string | null | undefined): string | null {
  const raw = (url ?? '').trim();
  if (!raw) return null;
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, '');
  const m = BOOKING_LINK.exec(path);
  return m ? m[1] : null;
}

/**
 * Is there a setup meeting to offer, and for which vault?
 *
 * Only for a vault that is somebody else's to pay for, before and after it
 * is built: the vault page has no booking banner any more (decided 2026-09-21),
 * and the server stops offering the link once the vault is tested, which
 * is what the setup meeting is for. There is one place on screen for one vault, so a vault that still needs a
 * meeting comes before one whose meeting already stands, and the lowest vault
 * number decides between equals. `vaultNumber` narrows the question to one
 * holding.
 *
 * A meeting that already stands is reported until two hours after its start
 * (the app's rule for every booked session); after that, and for a meeting
 * that was cancelled or missed, the backend sends no date and the button
 * comes back.
 */
export function setupMeetingFor(
  ent: Pick<KeyEntitlement, 'holdings'> | null | undefined,
  opts: { vaultNumber?: number; now?: number } = {},
): SetupMeetingOffer | null {
  if (!ent) return null;
  const now = opts.now ?? Date.now();
  const offers: SetupMeetingOffer[] = [];
  for (const h of ent.holdings) {
    if (opts.vaultNumber != null && h.vaultNumber !== opts.vaultNumber) continue;
    if (!h.setupMeeting) continue;
    const parsed = h.setupMeeting.bookedAt ? Date.parse(h.setupMeeting.bookedAt) : Number.NaN;
    const bookedAtMs = isUpcomingSession(parsed, now) ? parsed : null;
    const bookingUrl = h.setupMeeting.bookingUrl;
    // Nothing to book and no meeting to name: say nothing at all.
    if (!bookingUrl && bookedAtMs == null) continue;
    offers.push({
      vaultNumber: h.vaultNumber,
      bookingUrl,
      token: bookingToken(bookingUrl),
      bookedAtMs,
    });
  }
  if (offers.length === 0) return null;
  const needsBooking = (o: SetupMeetingOffer): number =>
    o.bookedAtMs == null && !!o.bookingUrl ? 0 : 1;
  return offers.sort(
    (a, b) => needsBooking(a) - needsBooking(b) || a.vaultNumber - b.vaultNumber,
  )[0];
}

/**
 * The moment to name for this offer: a meeting booked right here wins over
 * the answer the screen was drawn from, but only for the vault it was booked
 * for and only while it still stands. Without both of those a booking made
 * earlier in the same session would put another vault's date on screen and
 * leave the button dead, because a tab root stays mounted for days.
 */
export function bookedMomentFor(
  offer: Pick<SetupMeetingOffer, 'vaultNumber' | 'bookedAtMs'> | null | undefined,
  justBooked: { vaultNumber: number; ms: number } | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!offer) return null;
  if (
    justBooked &&
    justBooked.vaultNumber === offer.vaultNumber &&
    isUpcomingSession(justBooked.ms, now)
  ) {
    return justBooked.ms;
  }
  return offer.bookedAtMs;
}

/** The app's usual wording for a moment: "Friday, 3 October at 14:30". */
export function meetingWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The plain line that replaces the button once a meeting stands. Nothing
 *  about who pays (decided 2026-09-20, answer 10). */
export function setupMeetingBookedLine(
  bookedAtMs: number,
  when: (ms: number) => string = meetingWhen,
): string {
  return `Setup meeting booked for ${when(bookedAtMs)}`;
}

/** What the booking carries for our team, so the meeting is not a mystery. */
export function setupMeetingDetails(vaultNumber: number): string {
  return `Setup meeting for vault ${vaultNumber} (booked in-app)`;
}

/**
 * Does the vault list show its first-run card right now? Both screens judge
 * it the same way, so the setup meeting button has exactly ONE home at a
 * time: that card while it is on screen, the Settings row otherwise.
 */
export function firstRunCardShows(input: {
  /** This build can build vaults at all. */
  canBuild: boolean;
  /** Vaults on this phone, the hand-kept ones aside. */
  vaultsOnPhone: number;
  /** Sealed heir invites, which fill the empty list instead. */
  sealedInvites: number;
  /** This build shows the heir surface. */
  heirSurface: boolean;
}): boolean {
  if (!input.canBuild || input.vaultsOnPhone > 0) return false;
  return !(input.heirSurface && input.sealedInvites > 0);
}
