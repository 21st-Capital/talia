/**
 * No screen offers Signet, or names it (decided 2026-10-18: "remove signet, keep
 * only bitcoin and testnet4").
 *
 * A vault was built on Signet by mistake in a phone test: the builder's chip said
 * "Test network" and quietly followed Settings → Network, which still
 * offered Signet, and a Testnet4 payment to the vault's identical-looking
 * tb1 address never showed. Talia now runs on Bitcoin and Testnet4 only. A
 * Signet value can still arrive from old data (a stored vault, an invite,
 * an export), and it is read as Testnet4 below the screens (bitcoin/network.ts
 * `knownNetwork`, wallet/signetVaults.ts), so nothing in `src/ui` has any
 * reason to spell it.
 */
// companyAuth touches the iOS Keychain natively; these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { NETWORK_LABELS, NETWORK_TICKERS, OFFERED_NETWORKS } from '../../bitcoin/network';
import { fetchNextVaultKeys } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';

const UI = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Strip comments: the word belongs in an explanation, never on a screen.
 *  Their line breaks stay, so a finding names the line it is on. */
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/^[ \t]*\/\/.*$/gm, '');

const read = (rel: string) => withoutComments(readFileSync(join(UI, rel), 'utf8'));

describe('no screen offers Signet', () => {
  it('is nowhere in the code of a screen, as a choice, a label or a value', () => {
    const guilty = sources(UI)
      .filter((file) => {
        const code = withoutComments(readFileSync(file, 'utf8'));
        // Signet's old ticker is case-sensitive: `isBtc` is not it.
        return /signet/i.test(code) || /\bsBTC\b/.test(code);
      })
      .map((file) => file.slice(UI.length + 1));
    expect(guilty).toEqual([]);
  });

  it('a vault is on Bitcoin or Testnet4 alone, and Settings → Network shows Bitcoin alone', () => {
    expect(OFFERED_NETWORKS.map((n) => NETWORK_LABELS[n])).toEqual(['Bitcoin', 'Testnet4']);
    // Decided 2026-10-18, the same day: "remove the testnet settings completely".
    const screen = read('screens/NetworkSettingsScreen.tsx');
    expect(screen).not.toMatch(/OFFERED_NETWORKS|NETWORK_LABELS/);
    expect(screen).not.toMatch(/testnet/i);
  });

  it('every name and ticker a screen can show for a network reads Bitcoin, Testnet4 or Regtest', () => {
    expect([...new Set(Object.values(NETWORK_LABELS))].sort()).toEqual(['Bitcoin', 'Regtest', 'Testnet4']);
    expect([...new Set(Object.values(NETWORK_TICKERS))].sort()).toEqual(['BTC', 'rBTC', 'tBTC']);
  });

  it('the screens that name a vault\'s network take the shared names, with no table of their own', () => {
    for (const rel of ['components/AdvancedVaultDetails.tsx', 'screens/StatementScreen.tsx']) {
      const code = read(rel);
      expect(code).toMatch(/NETWORK_LABELS\[/);
      expect(code).not.toMatch(/NETWORK_LABEL\b/);
      expect(code).not.toMatch(/['"]Testnet['"]/);
    }
    const list = read('screens/WalletListScreen.tsx');
    expect(list).toMatch(/NETWORK_TICKERS\[wallet\.network\]/);
    expect(list).not.toMatch(/NETWORK_TICKER\b/);
  });

  it('the vault page names a test vault as its home card does, from the shared ticker', () => {
    // The line under the balance: "tBTC · Multisig" on both, never the
    // stored key ("testnet", which reads as the retired testnet3).
    const line = /\{wallet\.network === 'bitcoin'\s*\? sigTypeLabel\(wallet\.descriptor\)\s*: `\$\{NETWORK_TICKERS\[wallet\.network\]\} · \$\{sigTypeLabel\(wallet\.descriptor\)\}`\}/;
    expect(read('screens/WalletDetailScreen.tsx')).toMatch(line);
    expect(read('screens/WalletListScreen.tsx')).toMatch(line);
  });

  it('no screen puts a bare network value into its text', () => {
    // `${wallet.network}` in a string, or `{wallet.network}` as a child of a
    // Text, shows the stored key. A prop (`network={wallet.network}`) passes
    // it on, and a React key never shows.
    const bare: string[] = [];
    for (const file of sources(UI)) {
      const rel = file.slice(UI.length + 1);
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const inString = /\$\{\s*[\w?.]*\bnetwork\s*\}/.test(line) && !/\bkey=\{`/.test(line);
          const asChild =
            /(?<![=$]\s*)\{\s*\w+(?:\??\.\w+)*\??\.network\s*\}/.test(line) || />\s*\{\s*network\s*\}/.test(line);
          if (inString || asChild) bare.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bare).toEqual([]);
  });
});

describe('the vault builder', () => {
  const layered = read('screens/LayeredVaultScreen.tsx');

  it('names its two chips Bitcoin and Testnet4, from the shared names', () => {
    expect(layered).toMatch(/\{ key: 'bitcoin', label: NETWORK_LABELS\.bitcoin \}/);
    expect(layered).toMatch(/\{ key: 'test', label: NETWORK_LABELS\.testnet \}/);
    expect(layered).toMatch(/title=\{NETWORK_LABELS\.testnet\}/);
  });

  it('never says "test network", and its test chip is always Testnet4', () => {
    // companyAuth.ts writes the refusals the builder shows when the key
    // server says no.
    for (const rel of ['screens/LayeredVaultScreen.tsx', 'screens/VaultBuilderScreen.tsx', '../services/companyAuth.ts']) {
      expect(read(rel)).not.toMatch(/test network/i);
    }
    expect(layered).toMatch(/const testNetwork = testNetworkFor\(settings\.defaultNetwork\);/);
  });

  it('names its chips, Testnet4 and Bitcoin, when the key server refuses the network', async () => {
    const session = { accessToken: 't', email: 'test@example.com' } as unknown as CompanySession;
    const realFetch = global.fetch;
    const refusal = async (error: string): Promise<string> => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ status: 403, ok: false, json: async () => ({ error }) }) as unknown as typeof fetch;
      return ((await fetchNextVaultKeys(session, 'mainnet').catch((e: unknown) => e)) as Error).message;
    };
    try {
      const testAccount = await refusal('TEST_ACCOUNT');
      expect(testAccount).toBe(
        'This is a test account, so it gets test keys only. Go back and set this vault to Testnet4.',
      );
      const notFlagged = await refusal('TESTNET_NOT_PERMITTED');
      expect(notFlagged).toMatch(/, or build this vault on Bitcoin\.$/);
      for (const said of [testAccount, notFlagged]) expect(said).not.toMatch(/test network|mainnet|[—–]/i);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('every way a test key becomes a vault lands it on Testnet4 through one rule', () => {
    for (const rel of ['screens/LayeredVaultScreen.tsx', 'screens/VaultBuilderScreen.tsx', 'screens/ImportScreen.tsx']) {
      const code = read(rel);
      expect(code).toMatch(/testNetworkFor\(settings\.defaultNetwork\)/);
      // The old rule handed a saved Signet choice straight through.
      expect(code).not.toMatch(/settings\.defaultNetwork !== 'bitcoin'\s*\?\s*settings\.defaultNetwork/);
    }
  });
});
