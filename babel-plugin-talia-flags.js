/**
 * Inline the TALIA_* build flags so one branch can produce both apps.
 *
 * Why this exists (decided 2026-09-05): the signing app was being kept on a
 * separate branch with the release gates DELETED, which meant every fix had
 * to be applied twice by hand. Three real fixes were stranded there while
 * main moved 28 commits ahead. One branch, two builds, no divergence: the
 * flags come from the environment at build time instead of from the source.
 *
 *   ./scripts/ios-device.sh <udid> Release                 watch-only
 *   TALIA_FULL=1 ./scripts/ios-device.sh <udid> Release    signing build
 *
 * React Native's own preset only inlines process.env.NODE_ENV, so anything
 * else has to be replaced here or it is `undefined` on the device. Only the
 * names below are touched; every other process.env reference is left alone.
 */
// TALIA_HARNESS (BDK upgrade, decided 2026-10-15): the tier C runner, in
// the simulator only (index.js); ios-device.sh and ios-archive.sh refuse it.
const ALLOWED = new Set(['TALIA_FULL', 'TALIA_HWW', 'TALIA_PURCHASES', 'TALIA_HARNESS']);

module.exports = function taliaFlags({ types: t }) {
  return {
    name: 'talia-flags',
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        // Match process.env.NAME, written exactly that way.
        if (
          !t.isMemberExpression(node.object) ||
          !t.isIdentifier(node.object.object, { name: 'process' }) ||
          !t.isIdentifier(node.object.property, { name: 'env' }) ||
          node.object.computed ||
          node.computed ||
          !t.isIdentifier(node.property)
        ) {
          return;
        }
        const name = node.property.name;
        if (!ALLOWED.has(name)) return;
        const value = process.env[name];
        // An unset flag becomes undefined, so `=== '1'` is false and the
        // watch-only build is what you get by default.
        path.replaceWith(
          value === undefined ? t.identifier('undefined') : t.stringLiteral(String(value)),
        );
      },
    },
  };
};
