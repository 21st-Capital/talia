/**
 * Elite Services (decided 2026-09-21): one row among Profile, the Estate Plan and
 * the rest that opens its own page with the services, never a section of its
 * own ("what I meant was a menu among Profile, Estate Plan and other that
 * would open another page with all the options"). Plain words and a pure
 * helper, so a test reads them.
 */
export const ELITE_COPY = {
  title: 'Elite Services',
  limits: 'Co-signing limits',
  limitsSub: 'What we co-sign per month and year',
} as const;

/** "Co-signing limits, vault owners and setup meeting": the Settings row's
 *  line, naming what the page holds for this client. */
export function eliteSummary(labels: ReadonlyArray<string>): string {
  const words = labels.map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1)));
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
