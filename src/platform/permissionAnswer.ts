/**
 * What a permission stands at, and how iOS's camera answer is read.
 *
 * Pure, so it can be tested in plain Node: the trap it exists for is that the
 * camera library types its answer `boolean` and returns -1 for "never asked",
 * which is TRUTHY (decided 2026-09-26). Read as a boolean, a phone that has never
 * been asked reads as one that said yes, the system is never asked, and the
 * client is shown a camera that never starts.
 */
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';

/** iOS: true = authorized, -1 = never asked, anything else = refused. */
export function readIosAnswer(answer: boolean | number): PermissionState {
  if (answer === true) return 'granted';
  if (answer === -1) return 'undetermined';
  return 'denied';
}
