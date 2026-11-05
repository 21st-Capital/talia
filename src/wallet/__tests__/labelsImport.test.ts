/**
 * Labels for a vault already in Talia (decided 2026-11-05): Liana's labels
 * file, or its wallet backup of THIS vault. Fixtures from
 * `scripts/liana-wallet-backup-fixture/` (BIP-32 test vector keys, made-up
 * transaction ids).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { labelsImportTitle, notesForHistory, readLabelsFile } from '../labelsImport';
import type { WalletMeta } from '../types';

const FIXTURES = join(__dirname, '../../bitcoin/descriptor/__tests__/__fixtures__');
const BACKUP = readFileSync(join(FIXTURES, 'liana_test_wallet_backup.json'), 'utf8');
const LABELS = readFileSync(join(FIXTURES, 'liana_test_labels.jsonl'), 'utf8');
const DESCRIPTOR: string = JSON.parse(BACKUP).accounts[0].descriptor;

const TX_PAID_IN = '1'.repeat(64);
const TX_PAID_OUT = '2'.repeat(64);
const NOTES = { [TX_PAID_IN]: 'Salary November', [TX_PAID_OUT]: 'Rent' };

function vault(descriptor: string): WalletMeta {
  return { id: 'v1', label: 'Savings test', descriptor, network: 'testnet' } as WalletMeta;
}

describe('readLabelsFile', () => {
  it("reads Liana's labels file for any vault: it names none", () => {
    expect(readLabelsFile(LABELS, vault(DESCRIPTOR))).toEqual({ kind: 'notes', notes: NOTES });
  });

  it("reads Liana's wallet backup of this vault, also written without its checksum", () => {
    expect(readLabelsFile(BACKUP, vault(DESCRIPTOR))).toEqual({ kind: 'notes', notes: NOTES });
    expect(readLabelsFile(BACKUP, vault(DESCRIPTOR.replace(/#.*$/, '')))).toEqual({ kind: 'notes', notes: NOTES });
  });

  it("refuses Liana's wallet backup of another vault", () => {
    const another = DESCRIPTOR.replace('older(65535)', 'older(52596)').replace(/#.*$/, '');
    expect(readLabelsFile(BACKUP, vault(another))).toEqual({ kind: 'otherVault' });
  });

  it('says so when a backup cannot be read or a file holds no labels', () => {
    const several = JSON.parse(BACKUP);
    several.accounts.push(several.accounts[0]);
    expect(readLabelsFile(JSON.stringify(several), vault(DESCRIPTOR))).toEqual({ kind: 'unreadable' });
    expect(readLabelsFile(DESCRIPTOR, vault(DESCRIPTOR))).toEqual({ kind: 'none' });
    expect(readLabelsFile('{"type":"addr","ref":"tb1q","label":"Shop"}', vault(DESCRIPTOR))).toEqual({
      kind: 'none',
    });
  });
});

describe('notesForHistory', () => {
  it("keeps only the notes for this vault's transactions", () => {
    expect(notesForHistory(NOTES, [TX_PAID_OUT.toUpperCase(), 'f'.repeat(64)])).toEqual({ [TX_PAID_OUT]: 'Rent' });
    expect(notesForHistory(NOTES, [])).toEqual({});
    expect(notesForHistory(NOTES, null)).toEqual({});
  });
});

describe('labelsImportTitle', () => {
  it('is one short sentence for every answer, with no em dash', () => {
    const titles = [
      labelsImportTitle({ kind: 'added', count: 1 }),
      labelsImportTitle({ kind: 'added', count: 3 }),
      labelsImportTitle({ kind: 'nothingNew' }),
      labelsImportTitle({ kind: 'noMatch' }),
      labelsImportTitle({ kind: 'historyNotRead' }),
      labelsImportTitle({ kind: 'otherVault' }),
      labelsImportTitle({ kind: 'unreadable' }),
      labelsImportTitle({ kind: 'none' }),
    ];
    expect(titles.slice(0, 2)).toEqual(['1 note added', '3 notes added']);
    for (const t of titles) {
      expect(t).not.toMatch(/\u2014/);
      expect(t.length).toBeLessThan(50);
    }
  });
});
