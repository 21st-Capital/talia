/**
 * bs58check for the phone bundle.
 *
 * The UR registry (@keystonehq/bc-ur-registry) depends on bs58check@2, which
 * reaches Node's `stream` and `string_decoder` through create-hash and
 * cipher-base; a React Native bundle has neither, and Metro refused the
 * build (2026-09-08). Metro resolves `bs58check` to this file instead
 * (metro.config.js): the same encode/decode surface on the audited
 * @scure/base + @noble/hashes the app already uses for its own keys.
 * Jest keeps the real package; Node has the core modules.
 */
const { createBase58check } = require('@scure/base');
const { sha256 } = require('@noble/hashes/sha256');

const codec = createBase58check(sha256);

function decode(str) {
  return Buffer.from(codec.decode(str));
}

module.exports = {
  encode: (payload) => codec.encode(Uint8Array.from(payload)),
  decode,
  decodeUnsafe: (str) => {
    try {
      return decode(str);
    } catch {
      return undefined;
    }
  },
};
