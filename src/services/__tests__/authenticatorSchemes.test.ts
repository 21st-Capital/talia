import { readFileSync } from 'fs';
import { join } from 'path';
import { APPLE_PASSWORDS, AUTHENTICATOR_APPS } from '../authenticatorApps';

// canOpenURL answers false for any scheme the app has not declared, so an
// app missing here would never be found on the phone.
describe('authenticator schemes are declared in Info.plist', () => {
  const plist = readFileSync(join(__dirname, '../../../ios/KeelWallet/Info.plist'), 'utf8');
  const block = plist.split('<key>LSApplicationQueriesSchemes</key>')[1]?.split('</array>')[0] ?? '';
  const declared = [...block.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);

  it('declares every probed scheme', () => {
    for (const app of [...AUTHENTICATOR_APPS, APPLE_PASSWORDS]) {
      expect(declared).toContain(app.url.split(':')[0]);
    }
  });

  it('declares no shared code scheme and stays under the 25-entry cap', () => {
    expect(declared).not.toContain('otpauth');
    expect(declared).not.toContain('totp');
    expect(declared.length).toBeLessThanOrEqual(25);
  });
});
