/**
 * The courier's runs, mounted: what a caller hands a run as the follow-up
 * (the refresh session's absorb of the pass, the signing screen's broadcast)
 * runs INSIDE the run, after the device signed, and a follow-up that throws
 * lands on the 'failed' leg with its own sentence, where the courier offers
 * Try again; the run rethrows for the flow. Decided 2026-10-05: the refresh
 * session absorbed its pass AFTER the run, so an engine that could not read
 * a device's copy back left the courier on "Receiving signed transaction 3
 * of 3." with no sentence and nothing to tap. The drawing is not under test:
 * the feed is, on both brands.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useSigningCourier } from '../useSigningCourier';
import type { SigningCourierHandle } from '../useSigningCourier';
import type { LedgerTaskContext } from '../../components/LedgerConnectFlow';
import type { BitboxTaskContext } from '../../components/HwwConnectFlow';
import type { LedgerWalletSpec } from '../../../bitcoin/ledger';
import type { WalletMeta } from '../../../wallet/types';
import { MULTISIG_2_OF_3 } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);
jest.mock('react-native-svg', () => require('../../__tests__/rnStub').svg);
/** The drawing is not under test, nor the footer's buttons (pinned in pageFooter.test). */
jest.mock('../../components/SigningCourier', () => ({ SigningCourier: () => null, SigningCourierFooter: () => null, courierFootShown: () => false }));
/** The Ledger answers at once with nothing to merge; the merge hands the copy back. */
jest.mock('../../../platform/ledger', () => ({
  signLedgerPsbt: jest.fn(async () => []),
  watchLedgerActivity: jest.fn(() => () => undefined),
}));
jest.mock('../../../bitcoin/ledger', () => ({
  ...jest.requireActual('../../../bitcoin/ledger'),
  mergeLedgerSignatures: (psbt: string) => psbt,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

/** Valid base64 (the copy must read back); no transaction inside, so there is nothing to compare. */
const PSBT = 'cHNidP8=';
const UNREADABLE = 'The signed transaction could not be combined. Please try again.';

const wallet = {
  id: 'vault-1',
  label: 'Family vault',
  descriptor: MULTISIG_2_OF_3,
  network: 'testnet',
  kind: 'multisig',
  source: 'generic',
  transport: 'created',
  createdAt: 0,
} as WalletMeta;

const SPEC: LedgerWalletSpec = { kind: 'default', derivationPath: "84'/1'/0'", template: 'wpkh' };

const ledgerCtx = (): LedgerTaskContext =>
  ({
    sessionId: 'session',
    device: { id: 'd', name: 'Nano X', model: 'nanoX', raw: {} },
    deviceFingerprint: '73c5da0a',
    appVersion: '2.4.2',
    setStep: () => undefined,
    onPrompt: () => undefined,
    alive: () => true,
  }) as unknown as LedgerTaskContext;

const bitboxCtx = (): BitboxTaskContext =>
  ({
    session: { signPsbt: async () => PSBT },
    fingerprint: '73c5da0a',
    deviceId: 'd',
    deviceName: 'BitBox02 Nova',
    setStep: () => undefined,
    alive: () => true,
  }) as unknown as BitboxTaskContext;

const job = (index: number) => ({ psbt: PSBT, parsed: null, keyName: 'Key 1', batch: { index, count: 3 } });

let handle!: SigningCourierHandle;
function Probe(): null {
  handle = useSigningCourier(wallet);
  return null;
}
beforeEach(() => {
  act(() => {
    TestRenderer.create(<Probe />);
  });
});

/** The runs hold the device's signed page a beat (SIGNED_HOLD_MS) before the follow-up. */
jest.setTimeout(15000);

it('the Ledger run: a follow-up that throws lands on the failed leg with its sentence, and the run rethrows', async () => {
  const absorb = jest.fn(async () => {
    throw new Error(UNREADABLE);
  });
  await act(async () => {
    await expect(handle.signOnLedger(ledgerCtx(), SPEC, job(3), absorb)).rejects.toThrow(UNREADABLE);
  });
  // The follow-up got the copy once the device had signed.
  expect(absorb).toHaveBeenCalledTimes(1);
  expect(absorb).toHaveBeenCalledWith(expect.objectContaining({ base64: PSBT }));
  const s = handle.feed.get();
  expect(s?.leg).toBe('failed');
  expect(s?.failure).toBe(UNREADABLE);
  expect(s?.batch).toEqual({ index: 3, count: 3 });
  // The courier is up, so the flow's error state draws its Not signed page.
  expect(handle.courier?.keyName).toBe('Key 1');
});

it('the BitBox run: the same', async () => {
  const absorb = jest.fn(async () => {
    throw new Error(UNREADABLE);
  });
  await act(async () => {
    await expect(handle.signOnBitbox(bitboxCtx(), { policy: null, account: null, storedName: null }, job(3), absorb)).rejects.toThrow(UNREADABLE);
  });
  expect(absorb).toHaveBeenCalledTimes(1);
  const s = handle.feed.get();
  expect(s?.leg).toBe('failed');
  expect(s?.failure).toBe(UNREADABLE);
  expect(s?.batch).toEqual({ index: 3, count: 3 });
});

it('a follow-up that finishes leaves the signed copy on the way back, and the run hands it back', async () => {
  const absorb = jest.fn(async () => undefined);
  let signed: unknown;
  await act(async () => {
    signed = await handle.signOnLedger(ledgerCtx(), SPEC, job(3), absorb);
  });
  expect(absorb).toHaveBeenCalledTimes(1);
  expect(signed).toMatchObject({ base64: PSBT });
  const s = handle.feed.get();
  expect(s?.leg).toBe('return');
  expect(s?.signed).toBe(true);
  expect(s?.failure).toBeNull();
});
