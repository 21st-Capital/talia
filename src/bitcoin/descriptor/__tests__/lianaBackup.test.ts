/**
 * Liana's plain wallet backup (decided 2026-11-05: an import from Liana brings
 * the vault's name, its key names and its labels, not only the descriptor).
 *
 * The fixtures are written by `scripts/liana-wallet-backup-fixture/` with the
 * types and BIP-329 library Liana v16.0 writes them with, for a testnet vault
 * whose keys come from BIP-32 test vectors 1, 2 and 3 (no real device's key).
 * The transaction ids are made up.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseBip329Jsonl, txLabelsOf } from '../../bip329';
import { extractImportPayload } from '../importFile';
import { parseLianaWalletBackup } from '../lianaBackup';
import { validateForImport } from '../validate';

const FIXTURES = join(__dirname, '__fixtures__');
const BACKUP = readFileSync(join(FIXTURES, 'liana_test_wallet_backup.json'), 'utf8');
const LABELS = readFileSync(join(FIXTURES, 'liana_test_labels.jsonl'), 'utf8');

/** The fixture vault (the generator's VAULT_DESCRIPTOR). */
const VAULT_DESCRIPTOR =
  "tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*),older(65535))})#ffpaesuq";

const TX_PAID_IN = '1'.repeat(64);
const TX_PAID_OUT = '2'.repeat(64);

/** The fixture as an object, to change one field at a time. */
function backupWith(change: (b: Record<string, any>) => void): string {
  const b = JSON.parse(BACKUP);
  change(b);
  return JSON.stringify(b);
}

describe("Liana's wallet backup, as Liana v16 writes it", () => {
  const read = parseLianaWalletBackup(BACKUP);

  it('gives the whole vault: descriptor, name, key names and notes', () => {
    expect(read).toEqual({
      descriptor: VAULT_DESCRIPTOR,
      name: 'Savings test',
      keyLabels: {
        '3442193e': 'Ledger test',
        bd16bee5: 'BitBox test',
        '41d63b50': 'Recovery test',
      },
      txNotes: { [TX_PAID_IN]: 'Salary November', [TX_PAID_OUT]: 'Rent' },
    });
  });

  it('leaves out the address and coin labels, and a record with no label', () => {
    expect(Object.keys(read?.txNotes ?? {})).toHaveLength(2);
    expect(Object.values(read?.txNotes ?? {})).not.toContain('Shop address');
    expect(Object.values(read?.txNotes ?? {})).not.toContain('Salary coin');
  });

  it('goes through the import whole, and the descriptor validates', () => {
    const payload = extractImportPayload(BACKUP);
    expect(payload.descriptor).toBe(VAULT_DESCRIPTOR);
    expect(payload.name).toBe('Savings test');
    expect(payload.keyLabels).toEqual(read?.keyLabels);
    expect(payload.txNotes).toEqual(read?.txNotes);
    expect(payload.warnings).toEqual([]);
    const v = validateForImport(payload.descriptor, { network: 'testnet' });
    expect(v.ok).toBe(true);
  });
});

describe('the name Talia offers', () => {
  it("is the alias the owner typed, before Liana's own Liana-<checksum> name", () => {
    expect(parseLianaWalletBackup(BACKUP)?.name).toBe('Savings test');
  });

  it("falls back to Liana's name when the owner typed none, then to the account's", () => {
    expect(parseLianaWalletBackup(backupWith((b) => delete b.alias))?.name).toBe('Liana-ffpaesuq');
    expect(
      parseLianaWalletBackup(
        backupWith((b) => {
          delete b.alias;
          delete b.name;
          b.accounts[0].name = 'Account name';
        }),
      )?.name,
    ).toBe('Account name');
    expect(
      parseLianaWalletBackup(
        backupWith((b) => {
          delete b.alias;
          delete b.name;
          delete b.accounts[0].name;
        }),
      )?.name,
    ).toBeNull();
  });

  it('skips a blank alias', () => {
    expect(parseLianaWalletBackup(backupWith((b) => (b.alias = '   ')))?.name).toBe('Liana-ffpaesuq');
  });
});

describe('key names', () => {
  it('names only the keys the descriptor holds, by lowercase fingerprint', () => {
    const read = parseLianaWalletBackup(
      backupWith((b) => {
        b.accounts[0].keys['41D63B50'] = b.accounts[0].keys['41d63b50'];
        delete b.accounts[0].keys['41d63b50'];
        b.accounts[0].keys.deadbeef = { key: 'deadbeef', alias: 'Not in this vault' };
      }),
    );
    expect(read?.keyLabels['41d63b50']).toBe('Recovery test');
    expect(read?.keyLabels.deadbeef).toBeUndefined();
  });

  it('leaves a key with no alias unnamed, so Talia numbers it', () => {
    const read = parseLianaWalletBackup(backupWith((b) => delete b.accounts[0].keys.bd16bee5.alias));
    expect(read?.keyLabels.bd16bee5).toBeUndefined();
    expect(read?.keyLabels['3442193e']).toBe('Ledger test');
  });

  it('carries no names and no notes from a backup that has none', () => {
    const read = parseLianaWalletBackup(
      backupWith((b) => {
        delete b.accounts[0].keys;
        delete b.accounts[0].labels;
      }),
    );
    expect(read?.keyLabels).toEqual({});
    expect(read?.txNotes).toEqual({});
  });
});

describe('what is refused', () => {
  it('a backup with no wallet, or with several, as Liana refuses them', () => {
    expect(() => extractImportPayload(backupWith((b) => (b.accounts = [])))).toThrow(
      'This Liana backup holds no wallet.',
    );
    expect(() =>
      extractImportPayload(backupWith((b) => (b.accounts = [b.accounts[0], b.accounts[0]]))),
    ).toThrow(/holds 2 wallets\. Back up each wallet on its own/);
  });

  it('a wallet with no descriptor', () => {
    expect(() => extractImportPayload(backupWith((b) => delete b.accounts[0].descriptor))).toThrow(
      'This Liana backup holds no descriptor.',
    );
  });

  it('a Bitcoin backup whose keys are test keys', () => {
    expect(() => extractImportPayload(backupWith((b) => (b.network = 'bitcoin')))).toThrow(
      /says Bitcoin, but its keys are test keys/,
    );
  });

  it('a test backup whose keys are Bitcoin keys', () => {
    // BIP-32 test vector 1's master xpub: public test material.
    const xpub =
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
    const mainnet = backupWith((b) => (b.accounts[0].descriptor = `wpkh([3442193e]${xpub}/<0;1>/*)`));
    expect(() => extractImportPayload(mainnet)).toThrow(/says it is a test wallet, but its keys are Bitcoin keys/);
    const fine = JSON.parse(mainnet);
    fine.network = 'bitcoin';
    expect(parseLianaWalletBackup(JSON.stringify(fine))?.descriptor).toContain(xpub);
  });

  it('a network Talia does not know', () => {
    expect(() => extractImportPayload(backupWith((b) => (b.network = 'liquid')))).toThrow(
      /a network Talia does not know/,
    );
  });

  it('takes every test network Liana writes for test keys', () => {
    for (const network of ['testnet', 'testnet4', 'signet', 'regtest']) {
      expect(parseLianaWalletBackup(backupWith((b) => (b.network = network)))?.descriptor).toBe(VAULT_DESCRIPTOR);
    }
  });
});

describe('what is not a Liana backup', () => {
  it('is left to the other readers', () => {
    expect(parseLianaWalletBackup(VAULT_DESCRIPTOR)).toBeNull();
    expect(parseLianaWalletBackup('{"keystore":{"xpub":"x"},"wallet_type":"standard"}')).toBeNull();
    expect(parseLianaWalletBackup('{"accounts":[]}')).toBeNull();
    expect(parseLianaWalletBackup('[1,2]')).toBeNull();
    expect(extractImportPayload(VAULT_DESCRIPTOR).name).toBeUndefined();
  });
});

describe("Liana's labels file (BIP-329 JSONL)", () => {
  it('holds the same transaction labels as the backup', () => {
    const records = parseBip329Jsonl(LABELS);
    expect(records).toHaveLength(5);
    expect(txLabelsOf(records ?? [])).toEqual(parseLianaWalletBackup(BACKUP)?.txNotes);
  });

  it('is never confused with another file', () => {
    expect(parseBip329Jsonl('')).toBeNull();
    expect(parseBip329Jsonl(VAULT_DESCRIPTOR)).toBeNull();
    expect(parseBip329Jsonl(BACKUP)).toBeNull();
    expect(parseBip329Jsonl(`${LABELS}\nnot json`)).toBeNull();
    expect(parseBip329Jsonl('{"type":"tx"}')).toBeNull();
  });

  it('reads Windows line ends and blank lines', () => {
    expect(parseBip329Jsonl(`\r\n${LABELS.split('\n').join('\r\n')}\r\n\r\n`)).toHaveLength(5);
  });

  it("makes a coin's label its transaction's note when the transaction has none", () => {
    // Decided 2026-11-05 after a phone test: Liana keeps a payment's label
    // on its coin (`output`), so a backup can carry no `tx` label at all.
    expect(
      txLabelsOf([
        { type: 'output', ref: `${TX_PAID_IN}:0`, label: 'Test Payment 1' },
        { type: 'output', ref: `${TX_PAID_OUT.toUpperCase()}:2`, label: 'Bob' },
        { type: 'output', ref: `${TX_PAID_OUT}:0`, label: 'Alice' },
        { type: 'output', ref: `${TX_PAID_OUT}:1`, label: 'Alice' },
      ]),
    ).toEqual({ [TX_PAID_IN]: 'Test Payment 1', [TX_PAID_OUT]: 'Alice, Bob' });
  });

  it("keeps a transaction's own label over its coins', the later label for one coin, and skips what is not a coin", () => {
    expect(
      txLabelsOf([
        { type: 'output', ref: `${TX_PAID_IN}:0`, label: 'Coin' },
        { type: 'tx', ref: TX_PAID_IN, label: 'Salary' },
        { type: 'output', ref: `${TX_PAID_OUT}:0`, label: 'First' },
        { type: 'output', ref: `${TX_PAID_OUT}:0`, label: 'Second' },
        { type: 'output', ref: TX_PAID_OUT, label: 'No index' },
        { type: 'output', ref: `${TX_PAID_OUT}:x`, label: 'Bad index' },
        { type: 'output', ref: `${TX_PAID_OUT}:1`, label: '  ' },
        { type: 'input', ref: `${TX_PAID_OUT}:3`, label: 'Spent coin' },
        { type: 'addr', ref: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', label: 'Shop' },
      ]),
    ).toEqual({ [TX_PAID_IN]: 'Salary', [TX_PAID_OUT]: 'Second' });
  });

  it('keeps the later label when one transaction has two, and skips what is not a transaction id', () => {
    expect(
      txLabelsOf([
        { type: 'tx', ref: TX_PAID_IN.toUpperCase(), label: 'First' },
        { type: 'tx', ref: TX_PAID_IN, label: ' Second ' },
        { type: 'tx', ref: 'abc', label: 'Too short' },
        { type: 'tx', ref: TX_PAID_OUT, label: '   ' },
        { type: 'tx', ref: TX_PAID_OUT, label: 7 },
        null,
        'tx',
      ]),
    ).toEqual({ [TX_PAID_IN]: 'Second' });
  });
});
