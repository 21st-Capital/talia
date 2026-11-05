/**
 * Decided 2026-10-18: "remove signet, keep only bitcoin and testnet4". A vault is
 * built on Bitcoin or Testnet4 and nothing else, and a Signet value that old
 * data still names reads as Testnet4 in every table, so it can never sync,
 * show or link to Signet. Settings → Network edits the Bitcoin server alone
 * (the same day: "remove the testnet settings completely").
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_ELECTRUM,
  DEFAULT_ESPLORA,
  NETWORK_LABELS,
  NETWORK_TICKERS,
  NETWORKS,
  OFFERED_NETWORKS,
  defaultElectrumBackend,
  testNetworkFor,
  TESTNET4_ELECTRUM_SERVERS,
} from '../network';
import { SUGGESTED_ELECTRUM_SERVERS } from '../electrumTls';

/** The screen's code without its comments. */
const screen = readFileSync(join(__dirname, '../../ui/screens/NetworkSettingsScreen.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the networks a vault can be on', () => {
  it('are Bitcoin and Testnet4 only, and the real one is never called mainnet', () => {
    expect(OFFERED_NETWORKS).toEqual(['bitcoin', 'testnet']);
    expect(OFFERED_NETWORKS.map((n) => NETWORK_LABELS[n])).toEqual(['Bitcoin', 'Testnet4']);
    expect(Object.values(NETWORK_LABELS).join(' ')).not.toMatch(/mainnet|signet/i);
  });

  it('a test key lands on Testnet4 whatever the saved choice, regtest only by hand', () => {
    expect(NETWORKS).toEqual(['bitcoin', 'testnet', 'regtest']);
    for (const chosen of ['bitcoin', 'testnet', 'signet', undefined, null] as const) {
      expect(testNetworkFor(chosen)).toBe('testnet');
    }
    expect(testNetworkFor('regtest')).toBe('regtest');
  });

  it('Settings → Network draws no network rows at all: it edits Bitcoin\'s server alone', () => {
    expect(screen).not.toMatch(/OFFERED_NETWORKS|SELECTABLE_NETWORKS|NETWORK_LABELS/);
    expect(screen).not.toMatch(/signet|testnet/i);
    expect(screen).toMatch(/const NETWORK = 'bitcoin' as const;/);
  });

  it('a Signet value from old data reads as Testnet4 in every table', () => {
    expect(NETWORK_LABELS.signet).toBe('Testnet4');
    expect(NETWORK_TICKERS.signet).toBe(NETWORK_TICKERS.testnet);
    expect(DEFAULT_ELECTRUM.signet).toBe(DEFAULT_ELECTRUM.testnet);
    expect(DEFAULT_ESPLORA.signet).toBe(DEFAULT_ESPLORA.testnet);
    expect(DEFAULT_ESPLORA.testnet).toBe('https://mempool.space/testnet4/api');
    expect(defaultElectrumBackend('signet').url).toBe(DEFAULT_ELECTRUM.testnet);
    const everyValue = JSON.stringify([
      ...[DEFAULT_ELECTRUM, DEFAULT_ESPLORA].map((table) => Object.values(table)),
      SUGGESTED_ELECTRUM_SERVERS,
      TESTNET4_ELECTRUM_SERVERS,
    ]);
    expect(everyValue).not.toMatch(/signet|60602/i);
  });
});
