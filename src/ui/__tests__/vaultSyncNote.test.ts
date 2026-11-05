/**
 * The vault page says ONE thing about its server and its last sync (decided
 * 2026-10-29: a home node that could not be reached showed the plain
 * sentence AND the library's text under it). The words are decided in
 * wallet/chainServers.ts `syncProblemNote`, tested there.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { syncProblemNote } from '../../wallet/chainServers';
import { LIBRARY_CHECK_FAILED } from '../../bitcoin/engine/libraryProblem';

const vault = readFileSync(join(__dirname, '..', 'screens', 'WalletDetailScreen.tsx'), 'utf8');
const coins = readFileSync(join(__dirname, '..', 'screens', 'UtxosScreen.tsx'), 'utf8');

describe('the vault page and a failed sync', () => {
  it('shows the one line syncProblemNote gives, never the library text beside it', () => {
    expect(vault).toContain('syncProblemNote(wallet.network, settings, syncError)');
    expect(vault).not.toContain('Sync failed:');
    expect(vault).not.toMatch(/chainServerNote\(/);
  });

  it('keeps the failure itself, so the words can be decided from it, and a pull that worked clears it', () => {
    expect(vault).not.toMatch(/setSyncError\(`/);
    expect((vault.match(/setSyncError\(e\)/g) ?? []).length).toBe(2);
    expect((vault.match(/setSyncError\(null\)/g) ?? []).length).toBe(2);
  });

  it('a library that failed its self-check: the vault page\'s line is the approved sentence exactly, with nothing before it (decided 2026-11-04)', () => {
    const approved = "Talia's wallet library failed its self-check, so no vault opens. Please contact 21st Capital.";
    expect(LIBRARY_CHECK_FAILED).toBe(approved);
    for (const network of ['bitcoin', 'testnet'] as const) {
      expect(syncProblemNote(network, { electrumUrls: {} }, new Error(LIBRARY_CHECK_FAILED))?.text).toBe(approved);
    }
    // The page draws the note's text alone in its Text.
    expect(vault).toMatch(/>\{syncNote\.text\}<\/Text>/);
  });

  it('the coin list shows the library\'s sentence as written too, never after "Could not load coins:"', () => {
    expect(coins).toContain('setError(libraryProblem(e) ?? `Could not load coins: ');
  });
});
