import { ownKeysFirst } from '../keyOrder';
import {
  PENDING_COSIGNER_FP,
  PENDING_PROVIDER_FPS,
  PENDING_RESCUE_FP,
  pendingProviderKey,
} from '../pendingProviderKeys';
import { composeLayeredVault, composeMultisig, monthsToBlocks } from '../../bitcoin/descriptor/compose';
import { parsePolicy } from '../../bitcoin/descriptor/policy';

const TPUB_VB =
  'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK';
const TPUB_VC =
  'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3';
const LEDGER = { fingerprint: 'cc000004', originPath: "48'/1'/0'/2'", xpub: TPUB_VB };
const BITBOX = { fingerprint: '4a290600', originPath: "48'/1'/0'/2'", xpub: TPUB_VC };

describe('ownKeysFirst', () => {
  it('puts 21st Capital keys last and keeps every other order', () => {
    const keys = ['ledger', '21c-cosigner', 'bitbox', '21c-rescue', 'heir'];
    expect(ownKeysFirst(keys, (k) => k.startsWith('21c'))).toEqual([
      'ledger', 'bitbox', 'heir', '21c-cosigner', '21c-rescue',
    ]);
  });

  it('leaves a list without our keys, or with only ours, as it is', () => {
    expect(ownKeysFirst(['a', 'b'], () => false)).toEqual(['a', 'b']);
    expect(ownKeysFirst(['x', 'y'], () => true)).toEqual(['x', 'y']);
    expect(ownKeysFirst([], () => true)).toEqual([]);
  });
});

describe('the stand-ins for our keys, drawn before they are fetched', () => {
  it('compose a standard 2-of-3 taproot vault the policy picture can read', () => {
    const coSigner = pendingProviderKey('cosigner', LEDGER);
    expect(coSigner.xpub.startsWith('tpub')).toBe(true);
    const d = composeMultisig(2, [LEDGER, BITBOX, coSigner], {
      script: 'tr',
      providerFingerprints: new Set(PENDING_PROVIDER_FPS),
    });
    const policy = parsePolicy(d);
    expect(policy.paths).toHaveLength(1);
    const fps = policy.paths[0].groups.flatMap((g) => g.keys.map((k) => k.fingerprint));
    expect(fps).toEqual(expect.arrayContaining(['cc000004', '4a290600', PENDING_COSIGNER_FP]));
  });

  it('compose a layered vault with a stand-in rescue key', () => {
    const d = composeLayeredVault(
      { threshold: 2, keys: [LEDGER, BITBOX, pendingProviderKey('cosigner', LEDGER)] },
      [{ threshold: 1, keys: [pendingProviderKey('rescue', LEDGER)], olderBlocks: monthsToBlocks(15) }],
    );
    const locked = parsePolicy(d).paths.filter((p) => p.olderBlocks !== undefined);
    expect(locked.flatMap((p) => p.groups.flatMap((g) => g.keys.map((k) => k.fingerprint)))).toEqual([
      PENDING_RESCUE_FP,
    ]);
  });

  it('are mainnet keys for a mainnet vault', () => {
    const mainnetKey = { ...LEDGER, xpub: 'xpub6DckRPb9yaKzPgiJgtdVyMvEJj3ceqDp59ond4NDsHxqLh3c6UXfC362jwTFWfsLiqHLRL1AiPrPgic5YmqQMQSkGzcDAeTHL9y8fjyKiRi' };
    expect(pendingProviderKey('rescue', mainnetKey).xpub.startsWith('xpub')).toBe(true);
    expect(pendingProviderKey('rescue', mainnetKey).originPath).toBe("48'/0'/0'/2'");
  });

  it('never share a fingerprint with each other', () => {
    expect(PENDING_COSIGNER_FP).not.toBe(PENDING_RESCUE_FP);
    expect([...PENDING_PROVIDER_FPS].every((fp) => /^[0-9a-f]{8}$/.test(fp))).toBe(true);
  });
});
