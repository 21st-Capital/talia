/**
 * What the address book may never do (decided 2026-11-05). Its check asks
 * the vault's own server through the server rule and nothing else: no
 * fetch(), no block explorer, no web address, in any address book file,
 * the screens built on it included (any file named for the address book).
 * And every word a client reads is in the one words module, with no em or
 * en dash and no wallet jargon.
 */
import * as fs from 'fs';
import * as path from 'path';

import { ADDRESS_BOOK_WORDS, categoryName, removeTitle } from '../addressBookWords';

const SRC = path.join(__dirname, '..', '..');

/** Every source file under src, tests left out. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === '__fixtures__' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** The code alone: comments say what the code never does, and may name it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CORE = [
  'wallet/addressBook.ts',
  'wallet/addressBookWords.ts',
  'wallet/addressBookCheck.ts',
  'wallet/addressBookLookup.ts',
  'ui/hooks/useAddressBookCheck.ts',
];

const bookFiles = () => {
  const named = sourceFiles(SRC).filter((f) => /address ?book|addaddress/i.test(path.basename(f)));
  return [...new Set([...CORE.map((f) => path.join(SRC, f)), ...named])];
};

const FORBIDDEN: Array<[string, RegExp]> = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['a web address', /https?:\/\//],
  ['the explorer', /from\s+['"][^'"]*(explorer|txPrevouts|mempool|blockstream|esplora)[^'"]*['"]/i],
  ['an explorer link', /\b(mempoolTxUrl|explorerTxUrl|othersMayBeAsked)\b/],
  ['the wallet library itself', /nativeBdkWallet|bdkWalletModule|NativeModules/],
];

describe('the address book asks only the vault\'s own server', () => {
  it('its files exist and the screens\' files are found by name', () => {
    for (const f of CORE) expect([f, fs.existsSync(path.join(SRC, f))]).toEqual([f, true]);
    expect(bookFiles().length).toBeGreaterThanOrEqual(CORE.length);
  });

  it('no fetch(), no explorer, no web address in any address book file', () => {
    const offences = bookFiles().flatMap((f) => {
      const text = code(fs.readFileSync(f, 'utf8'));
      return FORBIDDEN.filter(([, re]) => re.test(text)).map(([what]) => `${path.relative(SRC, f)}: ${what}`);
    });
    expect(offences).toEqual([]);
  });

  it('the lookup goes through the server rule and the engine provider alone', () => {
    const lookup = code(fs.readFileSync(path.join(SRC, 'wallet/addressBookLookup.ts'), 'utf8'));
    expect(lookup).toMatch(/lookupThroughChainServers\(/);
    expect(lookup).toMatch(/from '\.\/engineProvider'/);
    const chain = fs.readFileSync(path.join(SRC, 'wallet/chainServers.ts'), 'utf8');
    const rule = chain.slice(chain.indexOf('export function lookupThroughChainServers'));
    const body = rule.slice(0, rule.indexOf('\n}\n') + 2);
    expect(body).toMatch(/return throughChainServers\(/);
    expect(code(body)).not.toMatch(/fetch|explorer|https?:/i);
  });
});

describe('the words a client reads', () => {
  const all = [
    ...Object.values(ADDRESS_BOOK_WORDS),
    categoryName('private'),
    categoryName('exchange'),
    removeTitle('Kraken'),
  ];

  it('never an em or en dash', () => {
    for (const s of all) expect([s, /[–—]/.test(s)]).toEqual([s, false]);
    const file = fs.readFileSync(path.join(SRC, 'wallet/addressBookWords.ts'), 'utf8');
    expect(/[–—]/.test(file)).toBe(false);
  });

  it('plain words: coins, never inputs, outputs or UTXO', () => {
    for (const s of all) expect([s, /\b(inputs?|outputs?|utxos?|outpoints?|scripthash)\b/i.test(s)]).toEqual([s, false]);
  });

  it('one wording for the spent mark, tag or line', () => {
    expect(ADDRESS_BOOK_WORDS.hasSpentCoins).toBe('Has spent coins before');
    expect(ADDRESS_BOOK_WORDS.spentReasonTitle).toBe(ADDRESS_BOOK_WORDS.hasSpentCoins);
  });
});
