import { unspendableInternalKey } from '../unspendable';

/**
 * GOLDEN VECTOR: a published Liana testnet taproot descriptor (expanding
 * multisig, gist jdlcdl/c38e1b80cd814e48e1d158a98cf704f6). Its tap tree is
 *   {and_v(v:multi_a(2,K1/<2;3>,K2/<2;3>,K3/<0;1>),older(36)),
 *    multi_a(2,K1/<0;1>,K2/<0;1>)}
 * so the chain code commits to K1,K2,K3,K1,K2 — per occurrence, in tree
 * order. Liana verifies exactly this on import; matching it byte-for-byte
 * is what makes Talia taproot vaults Liana-compatible.
 */
const K1 =
  'tpubDDvFWduSiwhW7hUbL1oMyUfcNgeSyZgHbooe1WjHyRaXYH3uUjm1xdxWXAGbQFn8QGScDg4b4a6WMGNiEAq2uQdmPDhDKPE5Dr8DX24mwd5';
const K2 =
  'tpubDEHRt73d4guqR5BLGQud4XMW8vDCGHUj54qDTFtsdFstF6PAYx1oAy3jfKg1PffqLUWuSsXmnetKeTJFKfKLXeJR97yUuqvvojnoBcUDHg5';
const K3 =
  'tpubDEzdWp7365AFAExeUsHiwRmkZN5it3sSAZsd6GKUXvUiJBytXnZrRKMAt9UgCkWB2mP3K9WujLuTjrRLBn51Y18pMVyg2v18un4ivqWSAk2';
const LIANA_INTERNAL_KEY =
  'tpubD6NzVbkrYhZ4X6BRkDMxFyZxfUCQdjpK27dNgqwDqsQ2PUbMmjjPPFxfcTJiGEjeNz2zLbZ1PRmgCAzXn4pE6tEuQPScXyUbuAgdcec6pMN';

const key = (xpub: string) => ({ xpub });

describe('unspendableInternalKey (Liana scheme)', () => {
  it('reproduces the published Liana internal key byte-for-byte', () => {
    expect(
      unspendableInternalKey([key(K1), key(K2), key(K3), key(K1), key(K2)]),
    ).toBe(LIANA_INTERNAL_KEY);
  });

  it('commits to the key ORDER (tap-tree order matters)', () => {
    expect(
      unspendableInternalKey([key(K2), key(K1), key(K3), key(K1), key(K2)]),
    ).not.toBe(LIANA_INTERNAL_KEY);
  });

  it('rejects garbage keys and empty input', () => {
    expect(() => unspendableInternalKey([])).toThrow('needs the vault keys');
    expect(() => unspendableInternalKey([key('tpubJunk')])).toThrow();
  });
});
