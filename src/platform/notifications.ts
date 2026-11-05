/**
 * Local notifications (Notifee) — currently only the timelock reminders.
 *
 * LOCAL, never push. Push needs Apple's paid Developer Program, which this
 * app does not have; notifications scheduled ON the device do not, so the
 * reminders work today. Nothing here talks to a server, and no address,
 * descriptor or balance ever leaves the phone.
 *
 * Loaded lazily: if the native module is absent (a JS-only
 * bundle, or pods not reinstalled after adding the dependency) every call
 * becomes a no-op instead of crashing the app at import time. Reminders are a
 * convenience — never let them take the wallet down.
 */
import type { TimelockReminder } from '../wallet/timelockReminders';

/**
 * iOS keeps at most 64 PENDING local notifications per app and silently drops
 * the rest, so we cap what we schedule and re-top-up on every sync. Well under
 * 64 because the ones we drop are always the most distant, and a sync will
 * schedule them long before they are due.
 */
export const MAX_PENDING = 48;

type NotifeeModule = typeof import('@notifee/react-native').default;

let cached: NotifeeModule | null | undefined;

/** The native module, or null when it isn't in this build. */
function mod(): NotifeeModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@notifee/react-native').default as NotifeeModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function notificationsAvailable(): boolean {
  return mod() != null;
}

/**
 * Ask once, at a moment the user understands why. iOS only ever shows the
 * system prompt once per install — asking at launch, before they have a vault
 * with a timelock, spends that single chance on a question they cannot yet
 * place.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const n = mod();
  if (!n) return false;
  try {
    const settings = await n.requestPermission();
    // 1 = AUTHORIZED, 2 = PROVISIONAL (quiet delivery) — both can post.
    return settings.authorizationStatus === 1 || settings.authorizationStatus === 2;
  } catch {
    return false;
  }
}

/** Whether we may post without prompting again. */
export async function hasNotificationPermission(): Promise<boolean> {
  const n = mod();
  if (!n) return false;
  try {
    const settings = await n.getNotificationSettings();
    return settings.authorizationStatus === 1 || settings.authorizationStatus === 2;
  } catch {
    return false;
  }
}

/**
 * Replace ALL scheduled timelock reminders with `reminders`.
 *
 * Whole-set replacement, not incremental: a timelock estimate moves every time
 * a block arrives, so yesterday's schedule is always slightly wrong. Cancelling
 * everything we own and rewriting from the current height is the only way the
 * estimate stays honest — and it is why `TimelockReminder.id` is stable per
 * vault+milestone (see timelockReminders.ts).
 */
export async function syncScheduledReminders(
  reminders: TimelockReminder[],
): Promise<{ scheduled: number; dropped: number }> {
  const n = mod();
  if (!n) return { scheduled: 0, dropped: 0 };

  try {
    // Only ever cancel OUR ids, so anything else scheduled later survives.
    const existing = await n.getTriggerNotificationIds();
    const ours = existing.filter((id) => id.startsWith(REMINDER_ID_PREFIX));
    if (ours.length > 0) await n.cancelTriggerNotifications(ours);

    const soonestFirst = [...reminders].sort(
      (a, b) => a.fireAt.getTime() - b.fireAt.getTime(),
    );
    const keep = soonestFirst.slice(0, MAX_PENDING);

    for (const r of keep) {
      await n.createTriggerNotification(
        {
          id: `${REMINDER_ID_PREFIX}${r.id}`,
          title: r.title,
          body: r.body,
          ios: { sound: 'default' },
          data: { walletId: r.walletId, kind: 'timelock', milestone: r.key },
        },
        {
          // TimestampTrigger === 0 in Notifee's TriggerType enum. Spelled
          // literally so this file never imports the native module at load.
          type: 0,
          timestamp: r.fireAt.getTime(),
        } as never,
      );
    }
    return { scheduled: keep.length, dropped: soonestFirst.length - keep.length };
  } catch {
    // A failed reminder must never break a sync.
    return { scheduled: 0, dropped: 0 };
  }
}

/** Namespaced so we only ever cancel notifications we created. */
const REMINDER_ID_PREFIX = 'timelock:';

/** Drop every reminder we own (e.g. the user turned them off). */
export async function cancelAllReminders(): Promise<void> {
  const n = mod();
  if (!n) return;
  try {
    const existing = await n.getTriggerNotificationIds();
    const ours = existing.filter((id) => id.startsWith(REMINDER_ID_PREFIX));
    if (ours.length > 0) await n.cancelTriggerNotifications(ours);
  } catch {
    /* ignore — see above */
  }
}

/**
 * Fire one reminder shortly, to prove delivery actually works.
 *
 * Worth having permanently, not just while developing: the real reminders are
 * invisible for months, so without this the first proof the pipeline works
 * would be a client's inheritance deadline. Uses the same TRIGGER mechanism as
 * the real ones — an immediate `displayNotification` would test a different
 * code path and prove nothing.
 *
 * Deliberately OUTSIDE the reminder id namespace so a sync landing in the next
 * few seconds cannot cancel it.
 */
export async function sendTestNotification(inSeconds = 15): Promise<boolean> {
  const n = mod();
  if (!n) return false;
  try {
    await n.createTriggerNotification(
      {
        id: 'talia-test-notification',
        title: 'Talia test notification',
        body: `Delivery works. A real reminder looks like this, ${inSeconds} seconds after scheduling.`,
        ios: { sound: 'default' },
        data: { kind: 'test' },
      },
      { type: 0, timestamp: Date.now() + inSeconds * 1000 } as never,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The answer to a co-signing request, the moment the app learns it
 * (decided 2026-08-29).
 *
 * LOCAL, like everything else here. Push would need Apple's paid Developer
 * Program, so this fires when the app itself sees the change: while the client
 * has Talia open, or the instant they come back to it. It is deliberately
 * immediate rather than scheduled, because the news is already true.
 *
 * The id is per REQUEST, so a batch that resolves at once shows one line per
 * transaction rather than one notification overwriting the last.
 */
export async function notifyCosignOutcome(
  requestId: string,
  outcome: 'signed' | 'rejected',
  amountSats?: number | null,
): Promise<void> {
  const n = mod();
  if (!n) return;
  const amount = amountSats != null ? ` (${(amountSats / 1e8).toFixed(8)} BTC)` : '';
  try {
    await n.displayNotification({
      id: `talia-cosign-${outcome}-${requestId}`,
      title:
        outcome === 'signed'
          ? 'Your transaction is co-signed'
          : 'Your co-signing request was not approved',
      body:
        outcome === 'signed'
          ? `21st Capital has co-signed your transaction${amount}. Open Talia to send it.`
          : `21st Capital did not approve your request${amount}. No money has moved. Open Talia to see why.`,
      ios: { sound: 'default' },
      data: { kind: 'cosign', outcome, requestId },
    });
  } catch {
    // A notification is a courtesy. Never let it break the flow that noticed.
  }
}
