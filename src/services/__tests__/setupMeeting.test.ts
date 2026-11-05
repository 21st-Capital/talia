/**
 * The setup meeting a family member books from their own login (decided
 * 2026-09-21): when the button shows, what the line reads, and how the
 * shareable-link token is taken from the booking url.
 */
// companyAuth touches the iOS Keychain natively; the package ships
// untranspiled ESM that Jest cannot load, and these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import {
  SETUP_MEETING_COPY,
  bookedMomentFor,
  bookingToken,
  firstRunCardShows,
  meetingWhen,
  setupMeetingBookedLine,
  setupMeetingDetails,
  setupMeetingFor,
} from '../setupMeeting';
import { parseKeyEntitlement, parseSetupMeeting } from '../companyAuth';
import type { KeyEntitlement } from '../companyAuth';

const URL = 'https://21stcapital.com/book-appointment/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/';
const TOKEN = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

const NOW = Date.parse('2026-09-21T09:00:00Z');
const SOON = '2026-09-24T13:00:00Z';

function ent(holdings: unknown[]): KeyEntitlement {
  return parseKeyEntitlement({ entitled: true, own_plan: false, holdings });
}

function holding(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    payer_id: 7,
    payer_email: 'toni@example.com',
    payer_name: 'Toni Example',
    vault_number: 2,
    claimed: false,
    setup_meeting: { booking_url: URL, booked_at: null, vault_number: 2 },
    ...over,
  };
}

describe('the token comes from the booking url', () => {
  it('is the last segment, trailing slash or not', () => {
    expect(bookingToken(URL)).toBe(TOKEN);
    expect(bookingToken(URL.replace(/\/$/, ''))).toBe(TOKEN);
  });

  it('ignores a query and a fragment', () => {
    expect(bookingToken(`${URL}?lang=de`)).toBe(TOKEN);
    expect(bookingToken(`${URL.replace(/\/$/, '')}#pick`)).toBe(TOKEN);
  });

  it('is null for a page that is not a booking link', () => {
    expect(bookingToken('https://21stcapital.com/contact')).toBeNull();
    expect(bookingToken('')).toBeNull();
    expect(bookingToken(null)).toBeNull();
    expect(bookingToken(undefined)).toBeNull();
  });

  it('is null for another page of ours that happens to end in a uuid', () => {
    expect(
      bookingToken(`https://21stcapital.com/dashboard/vault/${TOKEN}/`),
    ).toBeNull();
  });
});

describe('the backend answer is read tolerantly', () => {
  it('an older backend sends no setup meeting at all', () => {
    const e = ent([holding({ setup_meeting: undefined })]);
    expect(e.holdings[0].setupMeeting).toBeUndefined();
    expect(setupMeetingFor(e, { now: NOW })).toBeNull();
  });

  it('a half-filled answer reads as nothing to book', () => {
    expect(parseSetupMeeting({}, 3)).toEqual({ bookingUrl: '', bookedAt: null, vaultNumber: 3 });
    expect(parseSetupMeeting({ booking_url: 5, booked_at: '' }, 3)).toEqual({
      bookingUrl: '',
      bookedAt: null,
      vaultNumber: 3,
    });
    expect(parseSetupMeeting(null, 3)).toBeUndefined();
    expect(parseSetupMeeting('nope', 3)).toBeUndefined();
  });

  it('keeps the vault number the backend names', () => {
    expect(parseSetupMeeting({ vault_number: 9 }, 3)?.vaultNumber).toBe(9);
  });
});

describe('when the button shows', () => {
  it('shows for a vault of somebody else that nobody has built', () => {
    const offer = setupMeetingFor(ent([holding()]), { now: NOW });
    expect(offer).toEqual({ vaultNumber: 2, bookingUrl: URL, token: TOKEN, bookedAtMs: null });
  });

  it('says nothing when there is no booking link and no meeting', () => {
    const e = ent([holding({ setup_meeting: { booking_url: '', booked_at: null } })]);
    expect(setupMeetingFor(e, { now: NOW })).toBeNull();
  });

  it('still shows once the owner has built the vault: the meeting is the testing session', () => {
    // Decided 2026-09-21: the vault page has no booking banner any more, so the
    // offer stays until the server withdraws the link (vault tested).
    expect(setupMeetingFor(ent([holding({ claimed: true })]), { now: NOW })?.vaultNumber).toBe(2);
  });

  it('takes the lowest vault number when several are open', () => {
    const e = ent([holding({ vault_number: 4 }), holding({ vault_number: 3 })]);
    expect(setupMeetingFor(e, { now: NOW })?.vaultNumber).toBe(3);
  });

  it('a vault that still needs a meeting comes before one that has one', () => {
    const e = ent([
      holding({ vault_number: 2, setup_meeting: { booking_url: URL, booked_at: SOON } }),
      holding({ vault_number: 3, setup_meeting: { booking_url: URL, booked_at: null } }),
    ]);
    const offer = setupMeetingFor(e, { now: NOW });
    expect(offer?.vaultNumber).toBe(3);
    expect(offer?.bookedAtMs).toBeNull();
  });

  it('answers about one vault when asked about one', () => {
    const e = ent([holding({ vault_number: 4 }), holding({ vault_number: 3 })]);
    expect(setupMeetingFor(e, { now: NOW, vaultNumber: 4 })?.vaultNumber).toBe(4);
    expect(setupMeetingFor(e, { now: NOW, vaultNumber: 9 })).toBeNull();
  });

  it('says nothing without an answer from the backend', () => {
    expect(setupMeetingFor(null, { now: NOW })).toBeNull();
    expect(setupMeetingFor(undefined, { now: NOW })).toBeNull();
  });

  it('opens the url itself when it is not a booking link', () => {
    const e = ent([holding({ setup_meeting: { booking_url: 'https://21stcapital.com/contact' } })]);
    const offer = setupMeetingFor(e, { now: NOW });
    expect(offer?.token).toBeNull();
    expect(offer?.bookingUrl).toBe('https://21stcapital.com/contact');
  });
});

describe('when a meeting already stands', () => {
  it('reports the meeting instead of the button', () => {
    const e = ent([holding({ setup_meeting: { booking_url: URL, booked_at: SOON } })]);
    expect(setupMeetingFor(e, { now: NOW })?.bookedAtMs).toBe(Date.parse(SOON));
  });

  it('a meeting that is over lets the person book again', () => {
    const e = ent([holding({ setup_meeting: { booking_url: URL, booked_at: SOON } })]);
    const later = Date.parse(SOON) + 3 * 60 * 60 * 1000;
    const offer = setupMeetingFor(e, { now: later });
    expect(offer?.bookedAtMs).toBeNull();
    expect(offer?.token).toBe(TOKEN);
  });

  it('an unreadable date is no meeting', () => {
    const e = ent([holding({ setup_meeting: { booking_url: URL, booked_at: 'whenever' } })]);
    expect(setupMeetingFor(e, { now: NOW })?.bookedAtMs).toBeNull();
  });

  it('a standing meeting is named even when there is nothing left to book', () => {
    const e = ent([holding({ setup_meeting: { booking_url: '', booked_at: SOON } })]);
    const offer = setupMeetingFor(e, { now: NOW });
    expect(offer?.bookedAtMs).toBe(Date.parse(SOON));
    expect(offer?.token).toBeNull();
  });

  it('a booking just made wins for its own vault, while it stands', () => {
    const offer = { vaultNumber: 2, bookedAtMs: null };
    const ms = Date.parse(SOON);
    expect(bookedMomentFor(offer, { vaultNumber: 2, ms }, NOW)).toBe(ms);
  });

  it('a booking just made says nothing about another vault', () => {
    const offer = { vaultNumber: 3, bookedAtMs: null };
    const ms = Date.parse(SOON);
    expect(bookedMomentFor(offer, { vaultNumber: 2, ms }, NOW)).toBeNull();
  });

  it('a booking just made gives way once its meeting is over', () => {
    const offer = { vaultNumber: 2, bookedAtMs: null };
    const ms = Date.parse(SOON);
    const later = ms + 3 * 60 * 60 * 1000;
    expect(bookedMomentFor(offer, { vaultNumber: 2, ms }, later)).toBeNull();
  });

  it('without a booking of its own it answers what the backend said', () => {
    const ms = Date.parse(SOON);
    expect(bookedMomentFor({ vaultNumber: 2, bookedAtMs: ms }, null, NOW)).toBe(ms);
    expect(bookedMomentFor(null, { vaultNumber: 2, ms }, NOW)).toBeNull();
  });

  it('the line names the moment and nobody else', () => {
    const line = setupMeetingBookedLine(Date.parse(SOON), () => 'Thursday, 24 September at 13:00');
    expect(line).toBe('Setup meeting booked for Thursday, 24 September at 13:00');
    expect(setupMeetingBookedLine(Date.parse(SOON))).toContain('Setup meeting booked for ');
    expect(meetingWhen(Date.parse(SOON))).toContain('September');
  });
});

describe('the button has one home at a time', () => {
  it('the first-run card, while the vault list has nothing else to show', () => {
    expect(
      firstRunCardShows({ canBuild: true, vaultsOnPhone: 0, sealedInvites: 0, heirSurface: true }),
    ).toBe(true);
  });

  it('not once a vault is on the phone, and not where nothing can be built', () => {
    expect(
      firstRunCardShows({ canBuild: true, vaultsOnPhone: 1, sealedInvites: 0, heirSurface: true }),
    ).toBe(false);
    expect(
      firstRunCardShows({ canBuild: false, vaultsOnPhone: 0, sealedInvites: 0, heirSurface: true }),
    ).toBe(false);
  });

  it('not while a sealed inheritance fills the empty list', () => {
    expect(
      firstRunCardShows({ canBuild: true, vaultsOnPhone: 0, sealedInvites: 1, heirSurface: true }),
    ).toBe(false);
    expect(
      firstRunCardShows({ canBuild: true, vaultsOnPhone: 0, sealedInvites: 1, heirSurface: false }),
    ).toBe(true);
  });
});

describe('the words', () => {
  it('say meeting, never call, and carry no dash', () => {
    const words = [
      ...Object.values(SETUP_MEETING_COPY),
      setupMeetingBookedLine(Date.parse(SOON), () => 'Thursday, 24 September at 13:00'),
      setupMeetingDetails(2),
    ];
    for (const w of words) {
      expect(w).not.toMatch(/[—–]/);
      expect(w).not.toMatch(/\bcalls?\b/i);
      expect(w).not.toMatch(/\b(hold|holder|holds|held|invitation)\b/i);
      expect(w).not.toMatch(/plan of/i);
    }
  });
});
