/**
 * In-app meeting scheduler (decided 2026-07-24) — books against the backend's
 * PUBLIC shareable-calendar-link endpoints (the same ones the website's
 * book-appointment page uses), so nothing leaves the app. Reused by the
 * rescue protocol today and support meetings tomorrow.
 */
import { COMPANY_API, authHeaders, clearSession, loadSession } from './companyAuth';

const DAYS_URL = (token: string) =>
  `${COMPANY_API}/api/appointments/public/shareable-links/${token}/availability-days/`;
const SLOTS_URL = (token: string) =>
  `${COMPANY_API}/api/appointments/public/shareable-links/${token}/time-slots/`;
const BOOK_URL = (token: string) =>
  `${COMPANY_API}/api/appointments/public/shareable-links/${token}/book/`;

export interface TimeSlot {
  /** UTC instant to send back when booking. */
  startUtc: string;
  /** Pretty local time for the picker ("02:30 PM"). */
  displayTime: string;
}

/** The device's IANA timezone (Hermes ships Intl on iOS). */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A booked session still counts until this long after its start. */
export const SESSION_GRACE_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a booked session is still ahead (or under way): the banner shows
 * its date until two hours after the start, then offers to book again if
 * the vault is still untested. Guards against a bad timestamp.
 */
export function isUpcomingSession(
  startMs: number | undefined | null,
  nowMs: number = Date.now(),
): boolean {
  return typeof startMs === 'number' && Number.isFinite(startMs) && startMs + SESSION_GRACE_MS > nowMs;
}

/** Days with at least one free slot, from today up to `horizonDays` ahead. */
export async function fetchAvailableDays(
  token: string,
  horizonDays = 30,
): Promise<string[]> {
  const start = new Date();
  const end = new Date(Date.now() + horizonDays * 24 * 3600 * 1000);
  const res = await fetch(
    `${DAYS_URL(token)}?start_date=${iso(start)}&end_date=${iso(end)}`,
  );
  if (!res.ok) throw new Error('Could not load available days.');
  const body = (await res.json()) as { available_days?: string[] };
  return body.available_days ?? [];
}

/** Free slots on one day, in the device's timezone. */
export async function fetchTimeSlots(token: string, date: string): Promise<TimeSlot[]> {
  const tz = encodeURIComponent(deviceTimezone());
  const res = await fetch(`${SLOTS_URL(token)}?date=${date}&timezone=${tz}`);
  if (!res.ok) throw new Error('Could not load times for that day.');
  const body = (await res.json()) as {
    time_slots?: Array<{ start_utc: string; display_time: string }>;
  };
  return (body.time_slots ?? []).map((s) => ({
    startUtc: s.start_utc,
    displayTime: s.display_time,
  }));
}

/** What a meeting that must be booked signed in says when it cannot be. */
export const SIGN_IN_AGAIN_TO_BOOK = 'Please sign in again to book this meeting.';

/**
 * Book the slot.
 *
 * The endpoint is public and the identity in the body is the given name and
 * email, but the backend attaches a family member's free setup meeting to
 * their booking only when it can see who is signed in, so the session's
 * Authorization header goes along whenever there is one. It is never
 * required: a person who is not signed in books exactly as before, and a
 * request refused as unauthorised (a token that has gone stale) is sent once
 * more without the header, so an expired login can never stop somebody
 * booking a meeting. A login the server itself refuses is dropped on the way,
 * so the person is asked to sign in again instead of carrying a dead token
 * from screen to screen.
 *
 * `signedInOnly` is for a vault's setup (testing) meeting. The backend counts
 * a booking as that vault's meeting only when it is made signed in as the
 * account (decided 2026-09-26: an anonymous booking belongs to no
 * account). Booked anonymously, it would reach staff but never the vault:
 * the app would keep offering the meeting and the free meeting it should
 * have used would stay open. So for that meeting nothing is ever sent
 * without a working login: no session, or a login the server refuses,
 * ends with "Please sign in again" and no booking.
 */
export async function bookAppointment(
  token: string,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    scheduledAtUtc: string;
    details?: string;
  },
  options: { signedInOnly?: boolean } = {},
): Promise<void> {
  const body = JSON.stringify({
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    scheduled_at: input.scheduledAtUtc,
    meeting_details: input.details ?? '',
  });
  const post = (extra?: Record<string, string>) =>
    fetch(BOOK_URL(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extra ?? {}) },
      body,
    });

  // A Keychain read or a refresh that fails must not block the booking,
  // except a meeting that only counts when booked signed in.
  const session = await loadSession().catch(() => null);
  if (options.signedInOnly && !session) throw new Error(SIGN_IN_AGAIN_TO_BOOK);
  let res = session ? await post(authHeaders(session)) : await post();
  if (options.signedInOnly && session && res.status === 401) {
    // The login was ended elsewhere. Drop it and ask for a new one: an
    // anonymous retry would book a meeting the vault never sees.
    await clearSession().catch(() => {});
    throw new Error(SIGN_IN_AGAIN_TO_BOOK);
  }
  if (!options.signedInOnly && session && (res.status === 401 || res.status === 403)) {
    // 401 means the server refused a token loadSession believed was live,
    // which is a login that was ended elsewhere. Drop it, so the next screen
    // asks the person to sign in again and their next booking carries a
    // working header: this one goes through as an anonymous booking, and the
    // free setup meeting it should have used stays open. A 403 is about what
    // the account may do, not about the token, so the session stays.
    if (res.status === 401) await clearSession().catch(() => {});
    res = await post();
  }
  if (!res.ok) {
    let message = 'Could not book the meeting.';
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
}
