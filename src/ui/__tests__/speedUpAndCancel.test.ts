/**
 * Speed up and Cancel, the wiring a render test cannot see (decided 2026-09-28,
 * design Option A). Structural, like routeReachability: the repo has no
 * component tests, and each rule below is a line of code a later edit could
 * quietly drop.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Speed up and Cancel', () => {
  it('one fee sheet: Send and the transaction page both open FeeSheet, and nobody draws their own', () => {
    expect(code(read('screens/SendScreen.tsx'))).toMatch(/<FeeSheet\b/);
    expect(code(read('screens/TxDetailScreen.tsx'))).toMatch(/<FeeSheet\b/);
    // The sheet's own row style lives in FeeSheet alone.
    const copies = sources(UI)
      .filter((p) => !p.endsWith(join('components', 'FeeSheet.tsx')))
      .filter((p) => /\b(priorityRow|customRateInput)\s*:/.test(code(readFileSync(p, 'utf8'))));
    expect(copies.map((p) => p.slice(UI.length + 1))).toEqual([]);
  });

  it('never rebuilds with BDK’s bump (no policy path: a layered vault fails)', () => {
    const offenders = sources(UI).filter((p) => /\.bumpFee\(/.test(code(readFileSync(p, 'utf8'))));
    expect(offenders.map((p) => p.slice(UI.length + 1))).toEqual([]);
  });

  it('offers Speed up and Cancel only where Send is, and never on an heir’s phone', () => {
    const src = code(read('screens/TxDetailScreen.tsx'));
    expect(src).toMatch(/SIGNING_ENABLED \|\| \(LEDGER_PREVIEW && HWW_ENABLED && sendAccess\(wallet, known21C\) === 'ready'\)/);
    expect(src).toMatch(/!wallet\.heirVault/);
    expect(src).toMatch(/txStatusView\(\{[\s\S]*canSend,/);
    // The verdict is the core's, never a gate of the screen's own.
    expect(src).toMatch(/replacementEligibility\(/);
    expect(src).not.toMatch(/hasTimelockedPath/);
  });

  it('a vanished transaction opens from Talia’s record, never "Loading..." forever', () => {
    const src = code(read('screens/TxDetailScreen.tsx'));
    expect(src).toMatch(/txRecordInfo\(/);
    expect(src).toMatch(/standInTx\(/);
    expect(src).toMatch(/This transaction is not in this vault\./);
  });

  it('says "not in this vault" only when a synced engine proves it', () => {
    const src = code(read('screens/TxDetailScreen.tsx'));
    // A cold engine, or a replacement the engine has not picked up yet, is still loading.
    expect(src).toMatch(/const unsure = engine\.getTipHeight\(\) == null \|\| info\.state\.kind === 'replacement';/);
    // The vault's last known copy stands in meanwhile.
    expect(src).toMatch(/if \(!found && unsure\) \{\s*const cached = await loadTxCache\(walletId\);/);
    expect(src).toMatch(/setLoaded\(!!found \|\| !unsure\);/);
    expect(src).not.toMatch(/setLoaded\(true\)/);
  });

  it('a replacement the phone has not picked up opens at once, and the page asks the network for it', () => {
    // Found 2026-09-28: "See the return" two minutes after the cancel went out
    // opened on "Loading..." and stayed there: the page only re-read the
    // phone's own copy, which nothing was syncing.
    const src = code(read('screens/TxDetailScreen.tsx'));
    expect(src).toMatch(/if \(!found && info\.standIn\) found = info\.standIn\.tx;/);
    expect(src).toMatch(/info\.state\.kind === 'replacement' && engine\.getTipHeight\(\) != null && ASK_AT_READS\.has\(n\)/);
    expect(src).toMatch(/if \(ask\) await syncWallet\(wallet, \{ force: true \}\)/);
    // It keeps looking while it shows the record, not only while it shows nothing.
    expect(src).toMatch(/if \(!listed && unsure && unsureRetries\.current < UNSURE_RETRIES\)/);
    // A page underneath reads again when the client comes back to it, and a
    // return that lost the race goes back to its original rather than stack a copy.
    expect(src).toMatch(/navigation\.addListener\('focus'/);
    expect(src).toMatch(/navigation\.pop\(\);/);
    // Only the page on top moves (a screen's pop acts on the top page), and
    // it looks below ITSELF.
    expect(src).toMatch(/if \(info\.showInstead\) \{\s*if \(!navigation\.isFocused\(\)\) return;/);
    expect(src).toMatch(/nav\.routes\.findIndex\(\(r\) => r\.key === route\.key\)/);
    // A cold engine's empty list never decides what the records say.
    expect(src).toMatch(/const known = engine\.getTipHeight\(\) == null \? \(await loadTxCache\(walletId\)\) \?\? txs : txs;/);
    expect(src).toMatch(/txRecordInfo\(list, walletId, txid, known\)/);
    // Advanced never counts coins it did not read.
    expect(src).not.toMatch(/\?\.inputs\.length \?\? 0|\?\.outputs\.length \?\? 0/);
  });

  it('records the replacement wherever it is broadcast, and words a lost race plainly', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    expect(sign).toMatch(/recordIfReplacement\(/);
    expect(sign).toMatch(/saveTxReplacement\(/);
    expect(sign).toMatch(/replacementBroadcastFailure\(/);
    const pending = code(read('screens/PendingCosignScreen.tsx'));
    expect(pending).toMatch(/recordIfReplacement\(/);
    expect(pending).toMatch(/replacementBroadcastFailure\(/);
    // And the plan is written when the replacement is built.
    expect(code(read('screens/TxDetailScreen.tsx'))).toMatch(/planTxReplacement\(/);
  });

  it('stamps every everyday broadcast with its time, and the page reads it', () => {
    for (const rel of ['screens/SignPsbtScreen.tsx', 'screens/PendingCosignScreen.tsx', 'screens/RefreshSessionScreen.tsx']) {
      const src = code(read(rel));
      const broadcasts = (src.match(/\.broadcast(Psbt|RawTx)\(/g) ?? []).length;
      const stamps = (src.match(/saveSentAt\(/g) ?? []).length;
      // One stamp per place that sends (SignPsbt's one send picks PSBT or raw).
      expect({ rel, stamped: stamps > 0 && stamps >= (rel.includes('SignPsbt') ? 1 : broadcasts) }).toEqual({ rel, stamped: true });
    }
    const detail = code(read('screens/TxDetailScreen.tsx'));
    expect(detail).toMatch(/getSentAt\(walletId, txid\)/);
    expect(detail).toMatch(/const sentAtMs = records\?\.sentAt \?\? stampedSentAt;/);
    expect(detail).toMatch(/sentAtMs \? \{ sentAt: Math\.floor\(sentAtMs \/ 1000\) \}/);
    expect(detail).toMatch(/const whenMs = tx\.timestamp \? tx\.timestamp \* 1000 : sentAtMs \?\? null;/);
  });

  it('a Speed up or a Cancel resumed from Pending keeps its words: rebuilt from the plan', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    expect(sign).toMatch(/plannedReplacement\(route\.params\.walletId, id\)/);
    expect(sign).toMatch(/replacementParamsFromPlan\(plan, sentMs\)/);
    expect(sign).toMatch(/const replaces = route\.params\.replaces \?\? fromPlan \?\? undefined;/);
    // Nothing else reads the route param directly: every word follows
    // `replaces`. The fourth read is `planSettled`'s start: with the param
    // given there is nothing to look up, so the words are known at once.
    expect(sign.match(/route\.params\.replaces/g)).toHaveLength(4);
    // And the refresh words wait for the lookup, so a resumed cancel never
    // opens on "Refresh these coins" (decided 2026-09-28).
    // (And only on a vault with a timelock, decided 2026-10-02: sentPage.test.)
    expect(sign).toMatch(/const refreshWording =\s*isSelfRefresh && planSettled && !replaces && /);
    expect(sign).not.toMatch(/isSelfRefresh \? 'Refresh these coins'/);
    // The plan carries what the original is called.
    expect(code(read('screens/TxDetailScreen.tsx'))).toMatch(/what: noun,\s*\};\s*await planTxReplacement\(record\)/);
  });

  it('a co-signed cancel leads with the payment’s amount, on the panel and in Pending (decided 2026-09-28)', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    // The rule itself (a cancel, and a sped-up return, lead with the
    // cancelled payment) is pinned case by case in cosignAmount.test.
    expect(sign).toMatch(
      /const cosignAmountSats = useMemo\(\s*\(\) => cosignAmount\(\{ replaces, returnSats, outputs: parsed\?\.outputs \?\? null \}\),/,
    );
    expect(sign).toMatch(/destinationLabel=\{replaces\?\.kind === 'cancel' \|\| spedUpReturn \? 'Back to this vault' : undefined\}/);
    const pending = code(read('screens/PendingCosignScreen.tsx'));
    expect(pending).toMatch(/cancelTxids\.has\(dRow\.pending\.txid\) \? 'Back to this vault' : 'To'/);
    expect(pending).toMatch(/label: toLabel,/);
    expect(pending).toMatch(/<Text style=\{styles\.detailLabel\}>\{toLabel\}<\/Text>/);
  });

  it('asks again right before a replacement goes out, and retires the other versions once one has', () => {
    const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
    const sites = [
      between(code(read('screens/SignPsbtScreen.tsx')), 'const onBroadcast = async', 'const sentKind'),
      between(code(read('screens/PendingCosignScreen.tsx')), 'const send = async', 'const sendBatch'),
    ];
    for (const src of sites) {
      const check = src.indexOf('replacementSendCheck(');
      const sendAt = src.search(/\.broadcast(Psbt|RawTx)\(/);
      expect(check).toBeGreaterThan(-1);
      expect(sendAt).toBeGreaterThan(check);
      // Synced first: the answer must be current.
      expect(src.slice(0, check)).toMatch(/syncWallet\(wallet, \{ force: true \}\)/);
      // After it is out: the siblings leave Pending, awaited, not fired and forgotten.
      const recorded = src.indexOf('await recordIfReplacement(');
      expect(recorded).toBeGreaterThan(sendAt);
      expect(src.slice(recorded)).toMatch(/await withdrawPendingForTxids\((siblings|others)\)/);
    }
  });

  it('a cancel never reads as a refresh on the signing screen, and no recovery layer is offered', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    // Everyday path only (decided 2026-09-28): the timelocked layers stay off.
    expect(sign).toMatch(/activeLayer == null && !replaces && \(vaultPaths\?\.locked \?\? \[\]\)\.map\(/);
    expect(sign).toMatch(/replaces\?\.kind === 'cancel'\s*\?\s*'Send the cancel'/);
    // The Sent page (decided 2026-10-02) takes its words from the one model: a
    // replacement's own kind, never the refresh wording.
    expect(sign).toMatch(/const sentKind: SentKind = replaces \? replaces\.kind : refreshWording \? 'refresh' : 'payment';/);
    expect(code(read('components/sentPageModel.ts'))).toMatch(/case 'cancel':\s*return \{ title: 'Cancel sent'/);
  });

  it('a failed rebuild is a title and OK: no paragraph, never the engine’s words', () => {
    const src = code(read('screens/TxDetailScreen.tsx'));
    expect(src).toMatch(/replacementBuildNotice\(e, kind\)/);
    expect(src).not.toMatch(/message=\{notice/);
    expect(src).not.toMatch(/String\(\(e as Error\)\?\.message/);
  });

  it('the Cancel link looks disabled whenever it is: muted in colour while either action works', () => {
    const card = code(read('components/TxStatusCard.tsx'));
    expect(card).toMatch(/disabled=\{busy != null\}[\s\S]*styles\.cancelText, busy != null && styles\.cancelTextMuted/);
    expect(card).toMatch(/cancelTextMuted:\s*\{\s*color: theme\.colors\.faint\s*\}/);
  });

  it('the new surfaces are themed, never dimmed with opacity, and never write an em dash', () => {
    for (const rel of [
      'components/FeeSheet.tsx',
      'components/TxStatusCard.tsx',
      'components/txStatusModel.ts',
      'screens/replacementSheet.ts',
    ]) {
      const src = code(read(rel));
      if (rel.endsWith('.tsx')) {
        expect(src).toMatch(/themedStyles\(/);
        // Wrapped, never a bare sheet that freezes the dark palette.
        expect(src).not.toMatch(/=\s*StyleSheet\.create\(/);
      }
      expect(src).not.toMatch(/\bopacity\s*:/);
      const strings = src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
      expect(strings.filter((s) => s.includes('—'))).toEqual([]);
    }
  });
});
