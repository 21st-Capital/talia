/**
 * Decided 2026-09-26: exported descriptors, PSBTs and
 * backups were left in Caches after the share sheet closed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { exportFolderName, isLegacyExportLeftover, safeExportName } from '../exportCleanup';

describe('export cleanup rules', () => {
  it('sweeps only the loose files the old helpers wrote', () => {
    for (const name of ['talia-backup-Main-2026.bed', 'vault.psbt', 'Main descriptor.txt', 'statement.csv', 'report.pdf', 'portfolio.json']) {
      expect(isLegacyExportLeftover(name, true)).toBe(true);
    }
    expect(isLegacyExportLeftover('com.hackemist.SDImageCache', false)).toBe(false);
    expect(isLegacyExportLeftover('fsCachedData', false)).toBe(false);
    expect(isLegacyExportLeftover('backup.bed', false)).toBe(false); // a folder, not ours
    expect(isLegacyExportLeftover('Cache.db', true)).toBe(false);
  });

  it('a file name can never climb out of its export folder', () => {
    expect(safeExportName('../../Documents/x.bed')).toBe('x.bed');
    expect(safeExportName('..')).toBe('export');
    expect(safeExportName('.hidden')).toBe('hidden');
    expect(safeExportName('Main vault.psbt')).toBe('Main vault.psbt');
  });

  it('two exports at once get two folders', () => {
    expect(exportFolderName(1, 0.1)).not.toBe(exportFolderName(1, 0.2));
  });
});

describe('platform/files.ts writes exports in ONE place, and deletes them', () => {
  const src = readFileSync(join(__dirname, '..', 'files.ts'), 'utf8');

  it('writeFile appears once, inside withExportFile, which unlinks in finally', () => {
    expect(src.match(/RNFS\.writeFile\(/g)?.length).toBe(1);
    const helper = src.slice(src.indexOf('async function withExportFile'), src.indexOf('export async function sweepExportLeftovers'));
    expect(helper).toMatch(/RNFS\.writeFile\(/);
    expect(helper).toMatch(/finally\s*\{\s*await RNFS\.unlink\(dir\)/);
  });

  it('every share helper that writes goes through it', () => {
    for (const fn of ['exportBase64ToFile', 'shareBase64File', 'exportTextToFile', 'exportPsbtToFile']) {
      const start = src.indexOf(`export async function ${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      expect(body).toMatch(/withExportFile\(/);
    }
  });

  it('the downloaded Estate Plan PDF is still deleted after sharing', () => {
    const start = src.indexOf('export async function downloadAndShareFile(');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toMatch(/finally\s*\{\s*await RNFS\.unlink\(path\)/);
  });
});
