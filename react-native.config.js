module.exports = {
  // iPhone only (decided 2026-11-04): the repository holds no Android project.
  project: { ios: {} },
  // Brand fonts (site parity): Bricolage Grotesque (display) + Figtree (body).
  assets: ['./assets/fonts'],
  // No native code is linked from native/bdkffi any more: the old engine's
  // removal (decided 2026-11-04) took the old library's iOS side and its
  // JavaScript, and its Android bridge (bdk-rn 0.30's, with its unchecked
  // Maven download of bdk-android) went on 2026-11-04 (decided: Talia ships
  // for iPhone only). The wallet library is the TaliaBdkWallet pod.
};
