const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// The TALIA_* flags are inlined at transform time (babel-plugin-talia-flags.js),
// but Metro's transform cache key ignores the environment. On 2026-09-12 a
// plain bundle built with NO flags came back as the full app, served from the
// entries a TALIA_FULL=1 phone build had cached. Keying the cache on the flags
// gives each app its own entries, so no build can pick up another app's code.
const TALIA_FLAGS = ['TALIA_FULL', 'TALIA_HWW', 'TALIA_PURCHASES', 'TALIA_HARNESS']
  .map((name) => `${name}=${process.env[name] ?? ''}`)
  .join(',');

const config = {
  cacheVersion: `talia-flags:${TALIA_FLAGS}`,
  resolver: {
    // The UR registry's bs58check reaches Node's stream module, which a
    // phone bundle does not have. The shim gives it the same surface on the
    // audited libraries the app already carries (see src/shims/bs58check.js).
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'bs58check') {
        return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/shims/bs58check.js') };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
