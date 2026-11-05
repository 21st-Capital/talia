/**
 * A waiting payment shows since when it waits, on the vault's list and on
 * its own page (decided 2026-10-29). Words in txStatusModel `waitingLine`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const vault = read('screens/WalletDetailScreen.tsx');
const page = read('screens/TxDetailScreen.tsx');

describe('a waiting payment and its time', () => {
  it('the list stamps what it shows waiting and draws the line from waitingLine', () => {
    expect(vault).toContain('noteWaiting(walletId, pendingKey.split');
    expect(vault).toContain('waitingText={waitingLine(waitingTimes[item.txid])}');
    expect(vault).not.toContain("'Waiting for confirmation'");
    // the rows re-render when the times arrive
    expect(vault).toMatch(/listExtra = useMemo\(\(\) => \(\{ masked, rowWords, waitingTimes \}\)/);
  });

  it('the page says "First seen" when it has neither a block time nor a send stamp', () => {
    expect(page).toContain('`First seen ${moment(firstSeenAt)}`');
    expect(page).toContain('noteWaiting(walletId, [txid])');
  });
});
