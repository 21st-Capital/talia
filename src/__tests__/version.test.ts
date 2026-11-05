// The version on the Settings page must be the version Apple ships. It is
// hand-kept in three files, so this test is the thing that keeps them equal:
// it reads the Xcode project and package.json directly and compares.
//
// If this test fails, ONE of these is stale:
//   src/config.ts                              APP_VERSION / APP_BUILD
//   package.json                               version
//   ios/KeelWallet.xcodeproj/project.pbxproj   MARKETING_VERSION /
//                                              CURRENT_PROJECT_VERSION
import { readFileSync } from 'fs';
import { join } from 'path';

import { APP_BUILD, APP_VERSION } from '../config';

const root = join(__dirname, '..', '..');

/** Every value the Xcode project gives a build setting, de-duplicated — the
 *  project carries one per configuration (Debug and Release), and a release
 *  where they disagree would ship a version nobody reviewed. */
function xcodeSetting(name: string): string[] {
  const pbxproj = readFileSync(
    join(root, 'ios', 'KeelWallet.xcodeproj', 'project.pbxproj'),
    'utf8',
  );
  const found = [...pbxproj.matchAll(new RegExp(`${name} = ([^;]+);`, 'g'))].map((m) =>
    m[1].trim().replace(/^"(.*)"$/, '$1'),
  );
  return [...new Set(found)];
}

describe('the version shown in Settings', () => {
  it('matches the marketing version Xcode builds', () => {
    expect(xcodeSetting('MARKETING_VERSION')).toEqual([APP_VERSION]);
  });

  it('matches the build number Xcode builds', () => {
    expect(xcodeSetting('CURRENT_PROJECT_VERSION')).toEqual([APP_BUILD]);
  });

  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe(APP_VERSION);
  });

  it('reads as a released version, not a placeholder', () => {
    // 0.x on the App Store reads as unfinished to a client, and the old
    // hand-kept constant sat at 0.1.0 while the app already built 1.0.0.
    expect(APP_VERSION).toMatch(/^[1-9]\d*\.\d+\.\d+$/);
    expect(APP_BUILD).toMatch(/^\d+$/);
  });
});
