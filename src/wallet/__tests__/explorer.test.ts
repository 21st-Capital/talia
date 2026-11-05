import { mempoolTxUrl, explorerTxUrl } from '../explorer';
import type { Network } from '../../bitcoin/descriptor/types';

const TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

describe('mempoolTxUrl', () => {
  it('puts a mainnet transaction at the root', () => {
    expect(mempoolTxUrl('bitcoin', TXID)).toBe(`https://mempool.space/tx/${TXID}`);
  });

  // The app's 'testnet' slot IS testnet4 (bitcoin/network.ts): the plain
  // /testnet path is testnet3 and would show nothing.
  it('sends the testnet slot to testnet4', () => {
    expect(mempoolTxUrl('testnet', TXID)).toBe(`https://mempool.space/testnet4/tx/${TXID}`);
  });

  // Signet is retired (decided 2026-10-18): a value from old data reads as
  // Testnet4, where its vault moved (wallet/signetVaults.ts).
  it('sends a Signet value from old data to testnet4', () => {
    expect(mempoolTxUrl('signet', TXID)).toBe(`https://mempool.space/testnet4/tx/${TXID}`);
  });

  // A regtest chain runs on one machine, so no public explorer can see it:
  // /regtest was a 404 and the share button would have handed that dead link
  // to somebody else (decided 2026-09-21).
  it('has no link at all for regtest', () => {
    expect(mempoolTxUrl('regtest', TXID)).toBeNull();
  });

  it('falls back to the network name for anything else', () => {
    expect(mempoolTxUrl('mutinynet' as Network, TXID)).toBe(
      `https://mempool.space/mutinynet/tx/${TXID}`,
    );
  });
});

describe('explorerTxUrl: the link the client opens or shares (decided 2026-10-22)', () => {
  it('is the explorer link on every network that has one', () => {
    expect(explorerTxUrl('bitcoin', TXID)).toBe(`https://mempool.space/tx/${TXID}`);
    expect(explorerTxUrl('testnet', TXID)).toBe(`https://mempool.space/testnet4/tx/${TXID}`);
    expect(explorerTxUrl('regtest', TXID)).toBeNull();
  });

  it('takes no settings: a chosen Bitcoin server never hides what only a tap opens', () => {
    // The app's own lookups are the ones the chosen server governs
    // (services/txPrevouts.ts, othersMayBeAsked); a button the client taps is not.
    expect(explorerTxUrl.length).toBe(2);
  });

  it('every screen asks explorerTxUrl, never mempoolTxUrl itself', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (/\.tsx?$/.test(entry.name) && /mempoolTxUrl\s*\(/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(path.join(__dirname, '../..'), full));
        }
      }
    };
    walk(path.join(__dirname, '../../ui'));
    expect(offenders).toEqual([]);
  });
});
