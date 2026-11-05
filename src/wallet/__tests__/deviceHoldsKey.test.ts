/**
 * Decided 2026-09-26: a single-sig vault was linked to
 * a device when the FINGERPRINT in its descriptor matched, with the xpub
 * never compared, so a descriptor naming the client's real fingerprint over
 * somebody else's xpub opened Send.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import { deviceHoldsKey } from '../replaceDevice';

const client = HDKey.fromMasterSeed(sha256(utf8ToBytes('client seed')));
const stranger = HDKey.fromMasterSeed(sha256(utf8ToBytes('stranger seed')));
const PATH = "84'/0'/0'";
const device = {
  asked: [] as string[],
  async xpub(path: string) {
    this.asked.push(path);
    return client.derive(`m/${path}`).publicExtendedKey;
  },
};

describe('deviceHoldsKey', () => {
  it('the key the device really holds is proven', async () => {
    const key = { xpub: client.derive(`m/${PATH}`).publicExtendedKey, originPath: PATH };
    expect(await deviceHoldsKey(device, key, 'bitcoin')).toBe(true);
  });

  it("the client's fingerprint over a stranger's xpub is refused", async () => {
    const key = { xpub: stranger.derive(`m/${PATH}`).publicExtendedKey, originPath: PATH };
    expect(await deviceHoldsKey(device, key, 'bitcoin')).toBe(false);
  });

  it('a key recorded with no path is looked for at the standard accounts', async () => {
    device.asked = [];
    const key = { xpub: client.derive("m/84'/0'/2'").publicExtendedKey };
    expect(await deviceHoldsKey(device, key, 'bitcoin', ["84'/0'/0'", "84'/0'/1'", "84'/0'/2'"])).toBe(true);
    expect(device.asked).toEqual(["84'/0'/0'", "84'/0'/1'", "84'/0'/2'"]);
    expect(await deviceHoldsKey(device, { xpub: key.xpub }, 'bitcoin')).toBe(false);
  });
});
