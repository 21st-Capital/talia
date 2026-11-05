/**
 * Once a transaction is on the network, its Sent page comes first, and the
 * server bookkeeping after it (2026-10-19: a rescue went out, the
 * staff dashboard read Completed, and the phone kept spinning with no
 * success message, held by a report whose reply never came). Structural,
 * like sentPage.test: each rule is a line a later edit could quietly undo.
 * The rescue itself is also mounted (screens/__tests__/rescueBroadcast).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The source from `from` up to the next `to` after it. Both must exist. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect({ from, found: a >= 0 }).toEqual({ from, found: true });
  const b = src.indexOf(to, a + from.length);
  expect({ to, found: b >= 0 }).toEqual({ to, found: true });
  return src.slice(a, b);
}

describe('the Sent page comes before the bookkeeping', () => {
  it('the rescue: nothing after the broadcast is awaited before its page', () => {
    const rescue = code(read('ui/screens/RescueScreen.tsx'));
    const broadcast = between(rescue, 'const broadcast = async', 'const landOnSent =');
    const after = broadcast.slice(broadcast.indexOf('engine.broadcastRescue('));
    expect(after).not.toMatch(/await (completeRescue|settleSentRescue|reportSentRescues|loadSession|removePendingRescue|refreshActive)\(/);
    expect(after).toMatch(/landOnSent\(item, w, sent, facts\)/);
    // landOnSent shows the page first and awaits nothing.
    const land = between(rescue, 'const landOnSent =', 'const askedFor =');
    expect(land).not.toMatch(/\bawait\b/);
    expect(land.indexOf("setStep('sent')")).toBeLessThan(land.indexOf('settleSentRescue('));
    expect(land).toMatch(/void settleSentRescue\(/);
  });

  it('Pending transactions, one co-signed spend: setSent before the report', () => {
    const pending = code(read('ui/screens/PendingCosignScreen.tsx'));
    const one = between(pending, 'const send = async', 'const sendBatch');
    const after = one.slice(one.search(/\.broadcastPsbt\(/));
    const sentAt = after.indexOf('setSent({ walletId: wallet.id, facts })');
    expect(sentAt).toBeGreaterThan(0);
    expect(after.slice(0, sentAt)).not.toMatch(/await (completeCosign|loadSession|removePendingCosign)/);
    expect(after.indexOf('completeCosign(')).toBeGreaterThan(sentAt);
  });

  it('Pending transactions, Send all: each report runs beside the next coin, read once the page is up', () => {
    const pending = code(read('ui/screens/PendingCosignScreen.tsx'));
    const all = between(pending, 'const sendBatch = async', 'const askCancelBatch');
    expect(all).toMatch(/bookkeeping\.push\(/);
    const loop = between(all, 'for (let i = 0; i < batchRows.length; i++) {', 'setSentBatch({');
    // Inside the loop the report is only ever awaited inside its own task.
    const task = between(loop, 'bookkeeping.push(', '})(),');
    expect(loop.replace(task, '')).not.toMatch(/await completeCosign\(/);
    // Read once the page is up, never awaited by the run (decided 2026-10-19).
    expect(all.indexOf('Promise.all(bookkeeping)')).toBeGreaterThan(all.indexOf('setSentBatch({'));
    expect(all).not.toMatch(/await Promise\.all\(bookkeeping\)/);
    // The session is the reports' alone: never awaited before the coins go.
    const setup = between(all, 'const engine = await getEngine(wallet);', 'for (let i = 0; i < batchRows.length; i++) {');
    expect(setup).not.toMatch(/await loadSession\(/);
  });

  it('the signing screen already showed its page first, and still does', () => {
    const sign = code(read('ui/screens/SignPsbtScreen.tsx'));
    const on = between(sign, 'const onBroadcast = async', 'const sentKind');
    expect(on.indexOf("setPhase('done')")).toBeLessThan(on.indexOf('completeCosign('));
  });
});

describe('the calls that follow a broadcast cannot wait for ever', () => {
  const body = (src: string, fn: string) => between(src, `export async function ${fn}(`, '\n}\n');

  it.each([
    ['services/rescue.ts', 'completeRescue'],
    ['services/rescue.ts', 'fetchMyRescues'],
    ['services/cosign.ts', 'completeCosign'],
    ['services/cosign.ts', 'fetchMyCosigns'],
  ])('%s %s goes through fetchWithin', (file, fn) => {
    const b = body(code(read(file)), fn);
    expect(b).toMatch(/fetchWithin\(/);
    expect(b).not.toMatch(/(^|[^.\w])fetch\(/);
  });

  it('only the rescue gives its broadcast a watchdog (decided 2026-10-19)', () => {
    const servers = code(read('wallet/chainServers.ts'));
    // The plain broadcast waits for the native answer: a JavaScript timeout
    // cannot stop the native call, and a payment it gave up on still goes out.
    const plain = between(servers, 'export function broadcastThroughChainServers', '\n}\n');
    expect(plain).not.toMatch(/attemptMs/);
    const watched = between(servers, 'export function broadcastWithWatchdog', '\n}\n');
    expect(watched).toMatch(/attemptMs: usesBuiltInServers\(network\) \? TESTNET4_BROADCAST_ATTEMPT_MS : BROADCAST_WATCHDOG_MS/);
    // The rescue asks the chain and listens for the late answer; the
    // screens that do not, keep the plain broadcast.
    expect(code(read('ui/screens/RescueScreen.tsx'))).toMatch(/broadcastWithWatchdog\(/);
    for (const screen of ['SignPsbtScreen', 'PendingCosignScreen', 'RefreshSessionScreen']) {
      const src = code(read(`ui/screens/${screen}.tsx`));
      expect({ screen, watchdog: /broadcastWithWatchdog/.test(src) }).toEqual({ screen, watchdog: false });
      expect(src).toMatch(/broadcastThroughChainServers\(/);
    }
  });
});
