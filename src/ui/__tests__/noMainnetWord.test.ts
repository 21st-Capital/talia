/**
 * A client never reads the word "mainnet".
 *
 * Decided 2026-09-23: "please mark the [testnet] vaults. No need to mark mainnet
 * vaults because they are the default", and "I dont want client to see
 * mainnet written anywhere."
 *
 * The real network is simply Bitcoin. Naming it is jargon that only makes a
 * client wonder what the other kind is, and it appeared on the rescue list
 * beside every vault. A REHEARSAL vault is always marked, because the same
 * vault number exists on both chains and a test vault reading like a real
 * one is the one dangerous confusion.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { isTestNetwork, networkNote, withNetworkNote } from '../../wallet/networkNote';

const UI = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Strip comments: the word belongs in an explanation, never on a screen. */
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the real network has no name on screen', () => {
  it('is nowhere in a string the app renders', () => {
    const guilty: string[] = [];
    for (const file of sources(UI)) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      // The VALUE `'mainnet'` is the rule itself, not words on a screen, so
      // a quoted string counts only when the word sits inside something
      // longer: `'Bitcoin (mainnet)'` shipped for weeks past a check that
      // looked for a capital M alone. A hostname is a hostname, not prose
      // about the network, so a quoted string with a dot in it is left be.
      const quoted = code.match(/['"`][^'"`\n]*[Mm]ainnet[^'"`\n]*['"`]/g) ?? [];
      const leaked = quoted.filter((text) => {
        const inner = text.slice(1, -1);
        return inner.toLowerCase() !== 'mainnet' && !inner.includes('.');
      });
      if (leaked.length > 0 || />[^<]*\bMainnet\b/.test(code)) {
        guilty.push(`${file.slice(UI.length + 1)}: ${leaked.join(', ')}`);
      }
    }
    expect(guilty).toEqual([]);
  });

  it('says nothing for the real network and marks every other one', () => {
    expect(networkNote('bitcoin')).toBe('');
    expect(networkNote('mainnet')).toBe('');
    expect(networkNote('testnet4')).toBe('Test network');
    expect(networkNote('signet')).toBe('Test network');
    expect(networkNote(undefined)).toBe('');
  });

  it('marks a name only when it needs marking', () => {
    expect(withNetworkNote('Vault 3', 'bitcoin')).toBe('Vault 3');
    expect(withNetworkNote('Vault 3', 'testnet4')).toBe('Vault 3 (test network)');
    expect(isTestNetwork('regtest')).toBe(true);
  });
});
