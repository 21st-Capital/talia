/**
 * Receive checks the exact address it is about to show (decided 2026-10-15 and
 * 2026-10-17: the background sweep covers indexes 0..9, a used vault shows,
 * say, 37, and a vault opened straight into Receive showed its QR and Copy
 * before the sweep reported). Structural, like the screen's other rules in
 * hwwSigning.test.ts: the repo has no component tests, and each rule below
 * is a line a later edit could quietly drop. The derivation itself is held
 * to scure in bitcoin/engine/__tests__/preflightAndAddressCheck.test.ts.
 *
 * Decided 2026-10-17: an address Receive is opened ON with no index
 * (the coin list's "Show coin address") is checked too: its keychain and index
 * are found among the vault's own addresses first, then it is derived there.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const receive = readFileSync(join(__dirname, '..', 'screens', 'ReceiveScreen.tsx'), 'utf8');

describe('Receive shows an address only once scure derived the same one at its index', () => {
  it('derives the shown address again, at its own index, after the paint', () => {
    expect(receive).toMatch(
      /const params = \{ descriptor: wallet\.descriptor, changeDescriptor: wallet\.changeDescriptor, network: wallet\.network \};/,
    );
    expect(receive).toMatch(/InteractionManager\.runAfterInteractions\(\(\) => \{/);
    expect(receive).toMatch(/settle\(verifyShownAddress\(params, keychain \?\? 'external', addr\.index, addr\.address\)\);/);
    // The route's keychain speaks for the address the page was opened on.
    expect(receive).toMatch(/const keychain = addr\.address === route\.params\.address \? route\.params\.keychain : undefined;/);
    // The verdict belongs to the address it judged.
    expect(receive).toMatch(/const shownResult = addr && shownCheck\?\.address === addr\.address \? shownCheck\.result : null;/);
    expect(receive).toMatch(/const shownVerified = shownCheckShows\(shownResult\) \|\| shownUnchecked;/);
  });

  it('no QR, no address, no Share until then; no Copy either', () => {
    expect(receive).toMatch(/\) : !addr \|\| !shownVerified \? \(\s*<ActivityIndicator/);
    expect(receive).toMatch(/if \(!addr \|\| scrambling \|\| !shownVerified\) return;\s*copyToClipboard\(addr\.address\);/);
    expect(receive).toMatch(/addr != null && shownVerified && \(SIGNING_ENABLED/);
  });

  it('a mismatch pauses the vault and blocks the screen like the sweep\'s', () => {
    expect(receive).toMatch(/if \(blocksReceive\(scureVerdict\) \|\| shownResult\?\.kind === 'mismatch'\) \{\s*return \(\s*<Screen scroll style=\{styles\.content\}>\s*<AppDialog\s*visible\s*title=\{RECEIVE_PAUSED_TITLE\}/);
    // The title is true: the vault IS paused (Send and every build too).
    expect(receive).toMatch(/if \(result\.kind === 'mismatch'\) reportAddressMismatch\(\{ id: wallet\.id, \.\.\.params \}, result\.keychain, result\.index\);/);
  });

  it('not found, or nothing checked: shown as before, never closed, never the vault-wide title (decided 2026-10-22)', () => {
    expect(receive).toMatch(/const shownUnchecked = shownResult\?\.kind === 'not-found' \|\| shownResult\?\.kind === 'error';/);
    expect(receive).toMatch(/const shownVerified = shownCheckShows\(shownResult\) \|\| shownUnchecked;/);
    // Nothing disagreed: the screen never leaves by itself.
    expect(receive).not.toMatch(/if \(shownUnchecked\) navigation\.goBack\(\);/);
    // The pause dialog opens on a mismatch alone.
    expect(receive).not.toMatch(/shownResult\?\.kind === 'not-found'[^;]*RECEIVE_PAUSED_TITLE/);
  });

  it('the search for a coin\'s address stops when the screen goes', () => {
    expect(receive).toMatch(/const signal = \{ aborted: false \};/);
    expect(receive).toMatch(/verifyPinnedAddress\(params, engine, addr\.address, route\.params\.keychain, \{ signal \}\)/);
    expect(receive).toMatch(/cancelled = true;\s*signal\.aborted = true;\s*task\.cancel\(\);/);
  });

  it('an address with no index (a coin\'s, from the coin list) is found in the vault and checked before it is shown (decided 2026-10-17)', () => {
    // Never waved through unchecked any more.
    expect(receive).not.toMatch(/if \(addr\.index < 0\) \{\s*setShownCheck\(\{ address: addr\.address, result: 'not-covered' \}\)/);
    expect(receive).toMatch(/if \(addr\.index < 0\) \{/);
    expect(receive).toMatch(/result = await verifyPinnedAddress\(params, engine, addr\.address, route\.params\.keychain, \{ signal \}\);/);
    // Anything that goes wrong on the way keeps it hidden (never the QR).
    expect(receive).toMatch(/let result: ShownAddressCheck = \{ kind: 'error' \};/);
  });

  it('the coin list hands Receive the coin\'s keychain, where the search looks first', () => {
    const utxos = readFileSync(join(__dirname, '..', 'screens', 'UtxosScreen.tsx'), 'utf8');
    expect(utxos).toMatch(/const keychain = coinMenu\.keychain;/);
    expect(utxos).toMatch(/navigation\.navigate\('Receive', \{\s*walletId: wallet\.id,\s*address,\s*keychain,\s*\}\)/);
  });
});
