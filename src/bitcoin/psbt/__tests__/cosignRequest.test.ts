import { buildCosignRequest } from '../cosignRequest';
import { parsePsbt, Reader, readMap, parseTx } from '../parse';
import { decodeBase64 } from '../export';

// Fixture: a full bdk-style spend PSBT of a layered taproot vault
//   tr(NUMS, { multi_a(2, client, 21C), older(65535)+rescue })
// spending the PRIMARY path — with BOTH leaf scripts, client+21C+rescue
// derivations, a change output carrying a derivation, and a GLOBAL_XPUB.
// Written by scripts/cosign-request-fixture.mjs, from made-up keys and the
// placeholder fingerprints below; run it to check or rebuild the fixture.
const FULL_B64 =
  'cHNidP8BAH0CAAAAATMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzAAAAAAD/////ApDQAwAAAAAAFgAUdR526BmRltRUlBxF0bOjI/FDO9ZovwAAAAAAACJRIECAURn9DOwvW7pj0OJeKwK3eWKtH1pg8eF1WWnH8Sg4AAAAAE8Bq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urHMHBwcEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEr4JMEAAAAAAAiUSBAgFEZ/QzsL1u6Y9DiXisCt3lirR9aYPHhdVlpx/EoOEIVwVCSm3TBoElUt4tLYDXpel4HiloPKOyW1Ue/7prOgDrAp6N9Gwz+FmnmOB+5Ht5eBFjMPlsZBPG/ngVj5z6ZSi5HIKh8I7fmIFMWlM9Q6H4l1HIQVmmI3gHwxKr5Yu12dmcerCBslCzcdrnf5DhRnr+n/NIdGftMqwvSxfqr8H2e/X692LpSnMBCFcFQkpt0waBJVLeLS2A16XpeB4paDyjsltVHv+6azoA6wM7IB/vyDjKgQmhWIEBB+XHc2ygcM6MgMMXsGtDJZJFXKQP//wCydSDVIRYJw2TkbYe8C5s67kdGA52LP9uhP5eYns8b9jtlA6zAIRZslCzcdrnf5DhRnr+n/NIdGftMqwvSxfqr8H2e/X692D0BzsgH+/IOMqBCaFYgQEH5cdzbKBwzoyAwxewa0MlkkVfAwMDAMAAAgAEAAIAAAACAAgAAgAAAAAAAAAAAIRaofCO35iBTFpTPUOh+JdRyEFZpiN4B8MSq+WLtdnZnHj0BzsgH+/IOMqBCaFYgQEH5cdzbKBwzoyAwxewa0MlkkVfBwcHBMAAAgAEAAIAAAACAAgAAgAAAAAAAAAAAIRbVIRYJw2TkbYe8C5s67kdGA52LP9uhP5eYns8b9jtlAz0Bp6N9Gwz+FmnmOB+5Ht5eBFjMPlsZBPG/ngVj5z6ZSi7e3t7eMAAAgAEAAIAAAACAAgAAgAAAAAAAAAAAARcgUJKbdMGgSVS3i0tgNel6XgeKWg8o7JbVR7/ums6AOsABGCAhz8svLkHCaM4Si/tl6D0dUyeS1AzkIdbRWmEAH8VNNgAAAQUgUJKbdMGgSVS3i0tgNel6XgeKWg8o7JbVR7/ums6AOsAhB2yULNx2ud/kOFGev6f80h0Z+0yrC9LF+qvwfZ79fr3YHQDAwMDAMAAAgAEAAIAAAACAAgAAgAAAAAAAAAAAAA==';
const COSIGN_FP = 'c0c0c0c0';
const RESCUE_LEAF_HEX = '03ffff00b27520d5211609c364e46d87bc0b9b3aee4746039d8b3fdba13f97989ecf1bf63b6503ac';
const CLIENT_FP_HEX = 'c1c1c1c1';
const RESCUE_FP_HEX = 'dededede';
const REAL_PATH_HEX = '300000800100008000000080020000800000000000000000'; // 48'/1'/0'/2'/0/0
const ZEROED_PATH_HEX = '0000000000000000';
const XPUB_FILLER_HEX = 'abababababab';
const PAYMENT_ADDR = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const inPsbt = (base64: string, hex: string): boolean => {
  const bytes = decodeBase64(base64);
  return bytes ? toHex(bytes).includes(hex) : false;
};

/** Every TAP_BIP32_DERIVATION on input 0, decoded. Substring matching cannot
 *  answer these questions: all three keys share one path in the fixture, so
 *  "is the path gone" is only meaningful per key. */
const derivations = (base64: string): { pubkey: string; fp: string; path: string }[] => {
  const bytes = decodeBase64(base64)!;
  const r = new Reader(bytes, 5);
  const global = readMap(r);
  const { ins } = parseTx(new Reader(global.find((e) => e.keyType === 0x00)!.value));
  const entries = ins.map(() => readMap(r))[0];
  return entries
    .filter((e) => e.keyType === 0x16)
    .map((e) => {
      const n = e.value[0];
      return {
        pubkey: toHex(e.keyData).slice(0, 16),
        fp: toHex(e.value.slice(1 + 32 * n, 5 + 32 * n)),
        path: toHex(e.value.slice(5 + 32 * n)),
      };
    });
};

describe('buildCosignRequest', () => {
  const { psbtBase64: req, ratio } = buildCosignRequest(FULL_B64, COSIGN_FP);

  it('drops the rescue leaf script (present in the source, gone in the request)', () => {
    expect(inPsbt(FULL_B64, RESCUE_LEAF_HEX)).toBe(true);
    expect(inPsbt(req, RESCUE_LEAF_HEX)).toBe(false);
  });

  it('drops the global xpub', () => {
    expect(inPsbt(FULL_B64, XPUB_FILLER_HEX)).toBe(true);
    expect(inPsbt(req, XPUB_FILLER_HEX)).toBe(false);
  });

  it('keeps a derivation for every key in OUR leaf, and drops the rescue key', () => {
    // Krux refuses a multi_a leaf whose other key has no origin ("Not a
    // miniscript PSBT", proven on device 2026-09-05). The rescue key lives in
    // a different leaf, so it still goes.
    expect(derivations(FULL_B64).map((d) => d.fp).sort()).toEqual(
      [CLIENT_FP_HEX, COSIGN_FP, RESCUE_FP_HEX].sort(),
    );
    expect(derivations(req).map((d) => d.fp).sort()).toEqual([CLIENT_FP_HEX, COSIGN_FP].sort());
    expect(inPsbt(req, RESCUE_FP_HEX)).toBe(false);
  });

  it("keeps the client's FINGERPRINT but zeroes their PATH", () => {
    // The fingerprint lets the backend check the key against the client's
    // Estate Plan (decided 2026-09-05); 21C already knows whose request this is.
    // The path would only reveal how far through its addresses the wallet has
    // run, and is worth nothing to that check.
    const client = derivations(req).find((d) => d.fp === CLIENT_FP_HEX)!;
    expect(client.path).toBe(ZEROED_PATH_HEX);
    expect(derivations(FULL_B64).find((d) => d.fp === CLIENT_FP_HEX)!.path).toBe(REAL_PATH_HEX);
  });

  it('keeps OUR full derivation path — the signer needs it', () => {
    expect(derivations(req).find((d) => d.fp === COSIGN_FP)!.path).toBe(REAL_PATH_HEX);
  });

  it('keeps our co-sign fingerprint', () => {
    expect(inPsbt(req, COSIGN_FP)).toBe(true);
  });

  it('is a valid PSBT that still shows the payment output and no change derivation', () => {
    const parsed = parsePsbt(req, 'testnet');
    expect(parsed.numInputs).toBe(1);
    expect(parsed.outputs.map((o) => o.address)).toContain(PAYMENT_ADDR);
    expect(parsed.outputs.every((o) => o.hasDerivation === false)).toBe(true);
  });

  // The request is blind (no output maps), so the change output is named
  // BESIDE it: without this the co-signing limit counted change as money
  // leaving the vault (decided 2026-09-22).
  it('names the change output as the vault\'s own, and the payment as leaving', () => {
    const { derivationHintOutputs: ownOutputs } = buildCosignRequest(FULL_B64, COSIGN_FP);
    const full = parsePsbt(FULL_B64, 'testnet');
    expect(ownOutputs).toEqual(full.outputs.flatMap((o, i) => (o.hasDerivation ? [i] : [])));
    expect(ownOutputs).toHaveLength(1);
    expect(full.outputs[ownOutputs[0]].address).not.toBe(PAYMENT_ADDR);
  });

  it('is much smaller than the full PSBT', () => {
    expect(ratio).toBeLessThan(0.6);
  });

  it('throws when our co-sign key is not in the PSBT', () => {
    expect(() => buildCosignRequest(FULL_B64, 'deadbeef')).toThrow(/No co-sign key/);
  });
});
