/**
 * When the app locks again (decided 2026-09-26). Pure,
 * tested; AuthGate applies it.
 *
 * The lock used to run once per launch: after one unlock Talia stayed open
 * for as long as iOS kept the process alive, hours or days, to anyone who
 * picked up the phone. Now leaving the app starts a clock, and coming back
 * after `lockAfterSeconds` asks again. The owner picks the time in Security
 * settings; the choices are short on purpose.
 */
export const LOCK_AFTER_CHOICES = [0, 60, 300, 900] as const;
export type LockAfterSeconds = (typeof LOCK_AFTER_CHOICES)[number];
export const DEFAULT_LOCK_AFTER_SECONDS: LockAfterSeconds = 60;

/** The setting, read defensively: anything unknown is the default. */
export function lockAfterSeconds(settings: { lockAfterSeconds?: number }): LockAfterSeconds {
  const v = settings.lockAfterSeconds;
  return (LOCK_AFTER_CHOICES as readonly number[]).includes(v as number)
    ? (v as LockAfterSeconds)
    : DEFAULT_LOCK_AFTER_SECONDS;
}

/** The label a choice shows under "Lock again after". */
export function lockAfterLabel(seconds: LockAfterSeconds): string {
  if (seconds === 0) return 'At once';
  const m = seconds / 60;
  return `${m} min`;
}

/**
 * Should the app ask again on coming back? `leftAt` is when it went to the
 * background (null: it never left). A clock that went BACKWARDS (the owner
 * or someone else changed the phone's time) counts as time up.
 */
export function shouldRelock(leftAt: number | null, now: number, afterSeconds: number): boolean {
  if (leftAt == null) return false;
  const away = now - leftAt;
  if (away < 0) return true;
  return away >= afterSeconds * 1000;
}
