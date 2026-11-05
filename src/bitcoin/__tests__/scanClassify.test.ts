import { classifyScan } from '../scanClassify';
import {
  MAINNET_SINGLE_SIG,
  MULTISIG_2_OF_3,
  XPUB_A,
} from '../descriptor/__fixtures__/descriptors';
import { buildTestPsbtBase64 } from '../psbt/__tests__/parse.test';
import { decodeBase64 } from '../psbt/export';
import { SIGNING_ENABLED } from '../../config';

describe('classifyScan', () => {
  it('addresses (raw and BIP-21) → address', () => {
    expect(classifyScan('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4').kind).toBe('address');
    const uri = classifyScan('bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.5');
    expect(uri.kind).toBe('address');
  });

  it('a link with a second address after it picks neither', () => {
    const first = 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.5';
    const second = 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=1';
    expect(classifyScan(`${first}\n${second}`).kind).toBe('unknown');
  });

  it('descriptors and bare xpubs → descriptor', () => {
    expect(classifyScan(MAINNET_SINGLE_SIG).kind).toBe('descriptor');
    expect(classifyScan(MULTISIG_2_OF_3).kind).toBe('descriptor');
    expect(classifyScan(XPUB_A).kind).toBe('descriptor');
  });

  // Both encodings are recognised either way; what changes with the build
  // flag is whether the payload comes back out. Watch-only withholds it so
  // no caller can route a PSBT into the signing ceremony.
  const psbtResult = (base64: string) =>
    SIGNING_ENABLED ? { kind: 'psbt', base64 } : { kind: 'psbtUnsupported' };

  it('base64 and hex PSBTs → psbt', () => {
    const base64 = buildTestPsbtBase64();
    expect(classifyScan(base64)).toEqual(psbtResult(base64));
    const hexPayload = Array.from(decodeBase64(base64)!, (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const fromHex = classifyScan(hexPayload);
    // Hex round-trips to the same canonical base64.
    expect(fromHex).toEqual(psbtResult(base64));
    // A PSBT is never mistaken for something importable or unknown.
    expect(fromHex.kind).not.toBe('descriptor');
    expect(fromHex.kind).not.toBe('unknown');
  });

  it('garbage → unknown', () => {
    expect(classifyScan('hello world').kind).toBe('unknown');
    expect(classifyScan('').kind).toBe('unknown');
  });
});
