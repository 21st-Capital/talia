/**
 * A released heir vault names its network, and the heir's phone installs it
 * there. A name the phone does not know used to be read as Testnet4: a tb1
 * address is the same on every test chain, so such a vault would have
 * installed on the wrong chain and shown a zero balance with no error. It is
 * refused instead, and the invite stays claimed so it can be opened later.
 * An invite sealed while the owner's vault was on Signet reads as Testnet4,
 * because the owner's vault moved there at start (decided 2026-10-18).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { NETWORKS, UNKNOWN_NETWORK_REFUSED, knownNetwork } from '../network';

/** ClaimInviteScreen's code without its comments. */
const claim = readFileSync(join(__dirname, '../../ui/screens/ClaimInviteScreen.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('knownNetwork', () => {
  it('names every network Talia runs on, and reads Signet as Testnet4, where the owner\'s vault moved', () => {
    for (const n of NETWORKS) expect(knownNetwork(n)).toBe(n);
    expect(knownNetwork('signet')).toBe('testnet');
  });

  it('names nothing for anything else, and never guesses Testnet4', () => {
    for (const odd of ['mainnet', 'testnet4', 'Testnet', 'SIGNET', '', null, undefined, 3, {}, ['bitcoin']]) {
      expect(knownNetwork(odd)).toBeUndefined();
    }
  });

  it('says so plainly, as a title', () => {
    expect(UNKNOWN_NETWORK_REFUSED).toBe('This vault is on a network Talia does not support');
    expect(UNKNOWN_NETWORK_REFUSED).not.toMatch(/[—–]/);
  });
});

describe('claiming an heir invite', () => {
  const install = claim.slice(claim.indexOf('const installVault'), claim.indexOf('removeClaimedInvite(rec.inviteId)'));

  it('asks knownNetwork and refuses before anything is installed or the claim is removed', () => {
    expect(install).toMatch(
      /const network = knownNetwork\(payload\.network\);\s*if \(!network\) throw new Error\(UNKNOWN_NETWORK_REFUSED\);\s*const validated = validateForImport\(payload\.descriptor, \{ network \}\);/,
    );
    expect(install.indexOf('throw new Error(UNKNOWN_NETWORK_REFUSED)')).toBeLessThan(install.indexOf('addWallet('));
  });

  it('shows the refusal as the dialog\'s title with nothing under it', () => {
    // A dialog is a title and buttons (decided 2026-09-02).
    expect(claim).toMatch(
      /return message === UNKNOWN_NETWORK_REFUSED\s*\? \{ title: UNKNOWN_NETWORK_REFUSED \}\s*: \{ title: 'Could not open the vault', message \};/,
    );
    // Every place an open can fail goes through it: the keyless open from
    // the list, the keyless open right after claiming, and the key sheet.
    expect(claim.match(/setDialog\(openFailed\(e\)\);/g)).toHaveLength(3);
    expect(claim).not.toMatch(/title: 'Could not open the vault', message: \(e as Error\)\.message/);
  });

  it('has no fallback to Testnet4 and no list of networks of its own', () => {
    expect(claim).not.toMatch(/\?\? 'testnet'/);
    expect(claim).not.toMatch(/knownNetworks/);
  });

  it('reads the heir key sheet\'s network the same way, never by a cast', () => {
    expect(claim).toMatch(/network=\{knownNetwork\(scanFor\?\.network\) \?\? 'bitcoin'\}/);
    expect(claim).not.toMatch(/as Network\b/);
  });
});
