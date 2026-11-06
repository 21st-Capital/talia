/**
 * ios/Podfile.lock's PODFILE CHECKSUM is the SHA-1 of ios/Podfile's bytes, as
 * CocoaPods computes it. A Podfile edit (a comment too) changes it, and a
 * Podfile.lock left behind makes the next pod install rewrite that line, which
 * the archive gate then refuses as an uncommitted change (decided 2026-11-06).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ios = path.join(__dirname, '..', '..', 'ios');

describe('ios/Podfile.lock', () => {
  it("records the SHA-1 of ios/Podfile's bytes as its PODFILE CHECKSUM", () => {
    const podfile = fs.readFileSync(path.join(ios, 'Podfile'));
    const lock = fs.readFileSync(path.join(ios, 'Podfile.lock'), 'utf8');
    const lines = lock.split('\n').filter((l) => l.startsWith('PODFILE CHECKSUM:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`PODFILE CHECKSUM: ${crypto.createHash('sha1').update(podfile).digest('hex')}`);
  });
});
