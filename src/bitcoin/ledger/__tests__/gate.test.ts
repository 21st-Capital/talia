import { ledgerErrorMessage, isUserDeclined } from '../errors';
import {
  MIN_BITCOIN_APP_VERSION,
  bitcoinAppBlocker,
  bitcoinAppFor,
  bitcoinAppMissingMessage,
  versionAtLeast,
} from '../version';

describe('versionAtLeast', () => {
  it('accepts the minimum itself and anything newer', () => {
    expect(versionAtLeast('2.2.1', '2.2.1')).toBe(true);
    expect(versionAtLeast('2.2.2', '2.2.1')).toBe(true);
    expect(versionAtLeast('2.3.0', '2.2.1')).toBe(true);
    expect(versionAtLeast('3.0.0', '2.2.1')).toBe(true);
    expect(versionAtLeast('10.0.0', '2.2.1')).toBe(true);
  });

  it('refuses every wrong-tapleaf-hash version (2.1.2–2.2.0)', () => {
    expect(versionAtLeast('2.1.2', MIN_BITCOIN_APP_VERSION)).toBe(false);
    expect(versionAtLeast('2.1.9', MIN_BITCOIN_APP_VERSION)).toBe(false);
    expect(versionAtLeast('2.2.0', MIN_BITCOIN_APP_VERSION)).toBe(false);
  });

  it('ignores a prerelease suffix instead of substring-matching', () => {
    expect(versionAtLeast('2.2.1-rc', '2.2.1')).toBe(true);
    expect(versionAtLeast('2.2.0-rc', '2.2.1')).toBe(false);
  });

  it('treats missing parts as zero', () => {
    expect(versionAtLeast('2.2', '2.2.1')).toBe(false);
    expect(versionAtLeast('2.3', '2.2.1')).toBe(true);
  });
});

describe('bitcoinAppBlocker', () => {
  it('passes the right app at the minimum version', () => {
    expect(bitcoinAppBlocker('Bitcoin', '2.2.1', 'bitcoin')).toBeNull();
    expect(bitcoinAppBlocker('Bitcoin Test', '2.3.0', 'testnet')).toBeNull();
    expect(bitcoinAppBlocker('Bitcoin Test', '2.2.1', 'signet')).toBeNull();
  });

  it('names the app the vault needs when the wrong one is open', () => {
    const msg = bitcoinAppBlocker('BOLOS', '1.0.0', 'testnet');
    expect(msg).toContain('"Bitcoin Test"');
    expect(bitcoinAppBlocker('Bitcoin Test', '2.2.1', 'bitcoin')).toContain('"Bitcoin"');
  });

  it('refuses the broken-tapleaf versions with an update message', () => {
    const msg = bitcoinAppBlocker('Bitcoin', '2.2.0', 'bitcoin');
    expect(msg).toContain('2.2.0');
    expect(msg).toContain(MIN_BITCOIN_APP_VERSION);
  });

  it('the missing-app message names Developer mode for the hidden Test app', () => {
    expect(bitcoinAppMissingMessage('testnet')).toContain('Developer mode');
    expect(bitcoinAppMissingMessage('signet')).toContain('Developer mode');
    expect(bitcoinAppMissingMessage('bitcoin')).not.toContain('Developer mode');
  });

  it('maps every network to its app', () => {
    expect(bitcoinAppFor('bitcoin')).toBe('Bitcoin');
    expect(bitcoinAppFor('testnet')).toBe('Bitcoin Test');
    expect(bitcoinAppFor('signet')).toBe('Bitcoin Test');
    expect(bitcoinAppFor('regtest')).toBe('Bitcoin Test');
  });
});

describe('ledgerErrorMessage', () => {
  it('maps typed transport errors by _tag', () => {
    expect(ledgerErrorMessage({ _tag: 'DeviceLockedError' })).toContain('locked');
    expect(ledgerErrorMessage({ _tag: 'PeerRemovedPairingError' })).toContain('Forget This Device');
    expect(ledgerErrorMessage({ _tag: 'BlePoweredOff' })).toContain('Bluetooth is off');
  });

  it('maps APDU codes: declined, locked, registration mismatch', () => {
    expect(ledgerErrorMessage({ _tag: 'BtcAppCommandError', errorCode: '6985' })).toBe(
      'Declined on the Ledger.',
    );
    expect(ledgerErrorMessage({ errorCode: '5515' })).toContain('locked');
    expect(ledgerErrorMessage({ errorCode: 'B008' })).toContain('Register the vault');
  });

  it('never leaks a foreign message, however readable it looks', () => {
    const fallback = ledgerErrorMessage(undefined);
    expect(fallback).toContain('unlocked');
    expect(ledgerErrorMessage(new Error('Unknown MTU'))).toBe(fallback);
    expect(ledgerErrorMessage(new Error('Device session not found in the internal registry'))).toBe(
      fallback,
    );
    expect(ledgerErrorMessage({ _tag: 'SomethingNew' })).toBe(fallback);
  });

  it('unwraps originalError one level', () => {
    expect(
      ledgerErrorMessage({ _tag: 'OpeningConnectionError', originalError: { _tag: 'BlePoweredOff' } }),
    ).toContain('Bluetooth is off');
  });

  it('isUserDeclined recognises both refusal codes only', () => {
    expect(isUserDeclined({ errorCode: '6985' })).toBe(true);
    expect(isUserDeclined({ errorCode: '5501' })).toBe(true);
    expect(isUserDeclined({ errorCode: 'b008' })).toBe(false);
    expect(isUserDeclined(new Error('x'))).toBe(false);
  });
});
