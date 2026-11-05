import {
  buildUnsignedPsbt,
  validateBuildRequest,
  looksLikeAddress,
  BuildValidationError,
  DUST_LIMIT,
} from '../build';
import { FakeWalletEngine, FAKE_PSBT_BASE64 } from '../../engine/fakeEngine';
import type { BuildPsbtRequest } from '../../engine/types';

const VALID_ADDR = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

function req(overrides: Partial<BuildPsbtRequest> = {}): BuildPsbtRequest {
  return {
    recipients: [{ address: VALID_ADDR, amountSats: 10_000 }],
    feeRate: 2,
    ...overrides,
  };
}

describe('looksLikeAddress', () => {
  it('accepts bech32 and base58 addresses', () => {
    expect(looksLikeAddress(VALID_ADDR)).toBe(true);
    expect(looksLikeAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
    expect(looksLikeAddress('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
  });
  it('rejects empty, whitespace, and junk', () => {
    expect(looksLikeAddress('')).toBe(false);
    expect(looksLikeAddress('not an address')).toBe(false);
    expect(looksLikeAddress('xyz')).toBe(false);
  });
});

describe('validateBuildRequest', () => {
  it('passes a well-formed request', () => {
    expect(validateBuildRequest(req())).toEqual([]);
  });

  it('requires at least one recipient', () => {
    const issues = validateBuildRequest(req({ recipients: [] }));
    expect(issues.some((i) => i.field === 'recipients')).toBe(true);
  });

  it('rejects dust amounts', () => {
    const issues = validateBuildRequest(
      req({ recipients: [{ address: VALID_ADDR, amountSats: DUST_LIMIT - 1 }] }),
    );
    expect(issues.some((i) => i.field === 'amount')).toBe(true);
  });

  it('rejects non-positive fee rates', () => {
    expect(validateBuildRequest(req({ feeRate: 0 })).some((i) => i.field === 'feeRate')).toBe(true);
  });

  it('accepts an absolute fee and rejects a non-positive one', () => {
    expect(validateBuildRequest(req({ feeAbsolute: 1_500 }))).toEqual([]);
    expect(validateBuildRequest(req({ feeAbsolute: 0 })).some((i) => i.field === 'feeRate')).toBe(true);
    expect(validateBuildRequest(req({ feeAbsolute: NaN })).some((i) => i.field === 'feeRate')).toBe(true);
  });

  it('rejects invalid addresses', () => {
    const issues = validateBuildRequest(
      req({ recipients: [{ address: 'nope', amountSats: 10_000 }] }),
    );
    expect(issues.some((i) => i.field === 'address')).toBe(true);
  });

  it('requires exactly one recipient when draining', () => {
    const issues = validateBuildRequest(
      req({
        drain: true,
        recipients: [
          { address: VALID_ADDR, amountSats: 0 },
          { address: VALID_ADDR, amountSats: 0 },
        ],
      }),
    );
    expect(issues.some((i) => i.field === 'drain')).toBe(true);
  });

  it('ignores amount when draining', () => {
    const issues = validateBuildRequest(
      req({ drain: true, recipients: [{ address: VALID_ADDR, amountSats: 0 }] }),
    );
    expect(issues).toEqual([]);
  });
});

describe('buildUnsignedPsbt', () => {
  const engine = new FakeWalletEngine('testnet');

  it('builds an unsigned PSBT for a valid request', async () => {
    const result = await buildUnsignedPsbt(engine, req());
    expect(result.psbtBase64).toBe(FAKE_PSBT_BASE64);
    expect(result.sentSats).toBe(10_000);
    expect(result.feeSats).toBeGreaterThan(0);
  });

  it('throws BuildValidationError on invalid input, without calling the engine', async () => {
    const spy = jest.spyOn(engine, 'buildPsbt');
    await expect(buildUnsignedPsbt(engine, req({ feeRate: -1 }))).rejects.toBeInstanceOf(
      BuildValidationError,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lets an absolute fee replace the rate (the fake honours it like BDK)', async () => {
    const plain = await buildUnsignedPsbt(engine, req());
    const fixed = await buildUnsignedPsbt(engine, req({ feeAbsolute: 4_321 }));
    expect(plain.feeSats).toBe(250);
    expect(fixed.feeSats).toBe(4_321);
    const drained = await buildUnsignedPsbt(
      engine,
      req({ drain: true, feeAbsolute: 1_000, recipients: [{ address: VALID_ADDR, amountSats: 0 }] }),
    );
    expect(drained.feeSats).toBe(1_000);
    expect(drained.sentSats).toBe(150_000 - 1_000);
  });

  it('propagates the engine result for a drain', async () => {
    const result = await buildUnsignedPsbt(
      engine,
      req({ drain: true, recipients: [{ address: VALID_ADDR, amountSats: 0 }] }),
    );
    expect(result.sentSats).toBeGreaterThan(0);
  });
});
