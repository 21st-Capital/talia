module.exports = function (api) {
  // The build flags are read at TRANSFORM time, so babel's cache has to know
  // about them. Without this, switching TALIA_FULL would reuse the previous
  // build's inlined values and quietly produce the wrong app.
  api.cache.using(
    () =>
      `${process.env.TALIA_FULL ?? ''}|${process.env.TALIA_HWW ?? ''}|` +
      `${process.env.TALIA_PURCHASES ?? ''}|${process.env.TALIA_HARNESS ?? ''}`,
  );
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: ['./babel-plugin-talia-flags.js'],
  };
};
