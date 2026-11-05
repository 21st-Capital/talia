/**
 * Decided 2026-09-26: certificate checks were off for
 * every server the user picked, and a failed ssl:// was silently retried
 * as plain tcp:// and saved.
 */
import {
  electrumHost,
  electrumMayFallBackToPlain,
  electrumValidatesCertificate,
} from '../electrumTls';
import { backendFor } from '../../wallet/engineProvider';

jest.mock('../../bitcoin', () => ({
  activeEngineFactory: () => ({}),
  fakeWalletEngineFactory: () => ({}),
}));

describe('electrumTls', () => {
  it('reads the host of every URL shape', () => {
    expect(electrumHost('ssl://Electrum.Example.com:50002')).toBe('electrum.example.com');
    expect(electrumHost('tcp://10.0.0.20:50001')).toBe('10.0.0.20');
    expect(electrumHost('ssl://[fd00::1]:50002')).toBe('fd00::1');
  });

  it('checks the certificate of every server on the internet, suggested ones included', () => {
    for (const url of [
      'ssl://electrum.blockstream.info:50002',
      'ssl://electrum1.bluewallet.io:443',
      'ssl://my-node.example.org:50002',
      'ssl://203.0.113.9:50002',
    ]) {
      expect(electrumValidatesCertificate(url)).toBe(true);
      expect(electrumMayFallBackToPlain(url)).toBe(false);
    }
  });

  it('a personal node at home or over Tor may carry its own certificate', () => {
    for (const url of [
      'ssl://10.0.0.20:50002',
      'ssl://10.0.0.5:50002',
      'ssl://172.20.1.1:50002',
      'ssl://100.101.102.103:50002',
      'ssl://127.0.0.1:50002',
      'ssl://localhost:50002',
      'ssl://mynode.local:50002',
      'ssl://abcdefghijklmnop.onion:50002',
      'ssl://[fd00::1]:50002',
    ]) {
      expect(electrumValidatesCertificate(url)).toBe(false);
      expect(electrumMayFallBackToPlain(url)).toBe(true);
    }
  });

  it('a saved internet server syncs with the certificate checked, a home node without', () => {
    const settings = (bitcoin: string) => ({ backendType: 'electrum', electrumUrls: { bitcoin } }) as never;
    expect(backendFor('bitcoin', settings('ssl://electrum.acinq.co:50002'))).toMatchObject({ validateDomain: true });
    expect(backendFor('bitcoin', settings('ssl://10.0.0.20:50002'))).toMatchObject({ validateDomain: false });
  });

  it('every built-in Testnet4 server is checked by its certificate (decided 2026-10-18: no Testnet4 setting)', () => {
    const settings = { backendType: 'electrum', electrumUrls: { testnet: 'ssl://10.0.0.20:50002' } } as never;
    expect(backendFor('testnet', settings)).toMatchObject({
      url: 'ssl://blackie.c3-soft.com:57010',
      validateDomain: true,
    });
  });
});

describe('the connection test follows the same rule', () => {
  const src = (require('fs') as typeof import('fs')).readFileSync(
    require('path').join(__dirname, '../../ui/screens/NetworkSettingsScreen.tsx'),
    'utf8',
  );
  it('asks the rule for the certificate check and for any plain retry', () => {
    expect(src).toMatch(/validateDomain: electrumValidatesCertificate\(url\)/);
    expect(src).toMatch(/url\.startsWith\('ssl:\/\/'\) && electrumMayFallBackToPlain\(url\)/);
  });
});

describe('the certificate checks: a plain internet server cannot be saved', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { electrumUrlMayBeSaved, PLAIN_INTERNET_REFUSED } = require('../electrumTls');
  it('tcp:// only at home or over Tor; ssl:// anywhere', () => {
    expect(electrumUrlMayBeSaved('tcp://electrum.example.com:50001')).toBe(false);
    expect(electrumUrlMayBeSaved('TCP://203.0.113.9:50001')).toBe(false);
    expect(electrumUrlMayBeSaved('tcp://10.0.0.20:50001')).toBe(true);
    expect(electrumUrlMayBeSaved('tcp://mynode.local:50001')).toBe(true);
    expect(electrumUrlMayBeSaved('tcp://abcdefghijklmnop.onion:50001')).toBe(true);
    expect(electrumUrlMayBeSaved('ssl://electrum.example.com:50002')).toBe(true);
    expect(PLAIN_INTERNET_REFUSED).not.toMatch(/[—–]/);
  });
  it('Settings asks before saving', () => {
    const src = (require('fs') as typeof import('fs')).readFileSync(
      require('path').join(__dirname, '../../ui/screens/NetworkSettingsScreen.tsx'),
      'utf8',
    );
    expect(src).toMatch(/!electrumUrlMayBeSaved\(currentUrl\)\) \{\s*setStatus\('failed'\);\s*setStatusDetail\(PLAIN_INTERNET_REFUSED\);\s*return;/);
  });
});
