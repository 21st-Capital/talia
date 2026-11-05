/**
 * Send, Refresh, Speed up, Cancel, the refresh session and rescue builds go
 * through the independent address check's gate (decided 2026-10-15 and
 * 2026-10-17: "when the independent check disagrees on the change
 * side, Send, Refresh and Cancel pause for that vault too", with the title
 * "Sending is paused for this vault", title and buttons only).
 *
 * Structural, like receiveShownAddress.test: the repo has no component tests,
 * and each rule below is a line a later edit could quietly drop. The gate
 * itself (guardedEngine refusing ADDRESS_CHECK_FAILED on a mismatch of EITHER
 * keychain, before the engine builds) is tested in
 * wallet/__tests__/addressCheckStore.test.ts, and the words in
 * bitcoin/engine/__tests__/preflightAndAddressCheck.test.ts. The change-side
 * disagreement only a BUILD can see (its change sits past the 0..9 sweep) is
 * driven through each entry point's own code in sendPausedChange.test.ts.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');
const code = (rel: string) =>
  readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== '__fixtures__') out.push(...files(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(relative(SRC, p));
    }
  }
  return out;
}

describe('every engine a screen builds with is the guarded one', () => {
  it('getEngine wraps each vault\'s engine in the gate (all but the fake engine)', () => {
    const provider = code('wallet/WalletProvider.tsx');
    expect(provider).toMatch(/engine = guardedEngine\(created, checked\);/);
    expect(provider).toMatch(/if \(!USE_FAKE_ENGINE\) \{/);
    const store = code('wallet/addressCheckStore.ts');
    expect(store).toMatch(/if \(prop === 'buildPsbt' \|\| prop === 'buildRescuePsbt'\) \{/);
    expect(store).toMatch(
      /if \(blocksBuilding\(verdict\) \|\| blocksBuilding\(settled\.get\(wallet\.id\)\)\) \{\s*throw new EngineError\('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE\);/,
    );
    // A build the engine refuses for its own output pauses the vault from then on
    // (decided 2026-10-17; behaviour in sendPausedChange.test.ts).
    expect(store).toMatch(/const at = buildMismatchOf\(e\);\s*if \(at\) announce\(wallet, \{ kind: 'mismatch', keychain: at\.keychain, index: at\.index \}, 'scure\.output'\);\s*throw e;/);
    expect(code('bitcoin/engine/bdkWalletEngine.ts')).toMatch(
      /if \(problem\?\.kind === 'mismatch'\) \{[\s\S]*?throw new EngineError\('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE, \{/,
    );
  });

  it('nothing outside the provider makes an engine of its own (screens, wallet code, services)', () => {
    const makers = /getEngineFactory\(|new BdkWalletEngineV3\b|BdkWalletEngineV3\.create\(/;
    const offenders = ['ui', 'wallet', 'services']
      .flatMap((d) => files(join(SRC, d)))
      .filter((f) => f !== join('wallet', 'WalletProvider.tsx') && f !== join('wallet', 'engineProvider.ts'))
      .filter((f) => makers.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('each build entry point takes its engine from getEngine or syncWallet', () => {
    // Send and Refresh (one payment, a coin each: the refresh session's legs).
    expect(code('ui/screens/SendScreen.tsx')).toMatch(/const engine = await syncWallet\(wallet\);\s*const built = await buildUnsignedPsbt\(engine, request\);/);
    expect(code('ui/screens/SendScreen.tsx')).toMatch(/const engine = await syncWallet\(wallet, \{ force: true \}\);/);
    // Speed up and Cancel.
    expect(code('ui/screens/TxDetailScreen.tsx')).toMatch(/const engine = await getEngine\(wallet\);\s*const result = await buildReplacement\(engine, orig, kind, rate\);/);
    // The signing page's rebuild for another key (an heir or recovery path).
    expect(code('ui/screens/SignPsbtScreen.tsx')).toMatch(/const engine = await getEngine\(wallet\);\s*const built = await engine\.buildPsbt\(\{ \.\.\.rebuild, branchFingerprint: fp \}\);/);
    // A rescue request's own PSBT.
    expect(code('ui/screens/RescueScreen.tsx')).toMatch(/const engine = await getEngine\(w\);\s*return engine\.buildRescuePsbt\(\{/);
  });
});

describe('what each one shows when the check pauses the vault: the title, a button, nothing else', () => {
  it('Send and Refresh: the dialog at once when this launch\'s check already disagrees, or when a build is refused', () => {
    const send = code('ui/screens/SendScreen.tsx');
    expect(send).toMatch(/useState\(\(\) => \(wallet \? blocksBuilding\(addressCheckVerdict\(wallet\.id\)\) : false\)\)/);
    expect(send).toMatch(/if \(id === wallet\.id && blocksBuilding\(v\)\) setPaused\(true\);/);
    expect(send).toMatch(/if \(isSendPaused\(e\)\) \{\s*setPaused\(true\);\s*return;\s*\}/);
    // A refresh of several coins stops whole, never as one coin "skipped".
    expect(send).toMatch(/if \(isSendPaused\(e\)\) throw e;/);
    expect(send).toMatch(
      /<AppDialog\s*visible=\{paused\}\s*title=\{SEND_PAUSED_TITLE\}\s*actions=\{\[\{ label: 'OK', variant: 'primary', onPress: \(\) => navigation\.goBack\(\) \}\]\}\s*onClose=\{\(\) => navigation\.goBack\(\)\}\s*\/>/,
    );
  });

  it('Speed up and Cancel: the notice is the same title', () => {
    expect(code('ui/screens/replacementSheet.ts')).toMatch(/if \(isSendPaused\(e\)\) return \{ title: SEND_PAUSED_TITLE \};/);
  });

  it('the signing page\'s rebuild: the same title, no message', () => {
    expect(code('ui/screens/SignPsbtScreen.tsx')).toMatch(/if \(isSendPaused\(e\)\) setDialog\(\{ title: SEND_PAUSED_TITLE \}\);/);
  });

  it('a rescue: its PSBT is refused like any build, and the request still goes without it (never blocked by the phone)', () => {
    const rescue = code('ui/screens/RescueScreen.tsx');
    // At the request: only coins that cannot pay the fee stop it.
    expect(rescue).toMatch(
      /requestPsbt = \(await buildRescue\(vault, avail\)\)\.psbtBase64;\s*\} catch \(e\) \{\s*if \(isInsufficientFunds\(e\)\) \{\s*refuseFee\(\);\s*return;\s*\}\s*requestPsbt = undefined;\s*\}/,
    );
    // Before the email: the same.
    expect(rescue).toMatch(
      /await buildRescue\(vault, avail\);\s*\} catch \(e\) \{\s*if \(isInsufficientFunds\(e\)\) \{\s*setBusy\(false\);\s*refuseFee\(\);\s*return;\s*\}\s*\}\s*await emailCode\(null\);/,
    );
    expect(rescue).not.toMatch(/SEND_PAUSED_TITLE|isSendPaused/);
  });
});
