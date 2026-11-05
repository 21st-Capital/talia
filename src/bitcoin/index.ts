/**
 * Keel's Bitcoin layer — the clean boundary between wallet logic and UI.
 *
 * The UI imports from here (and never from the wallet library's native module
 * directly). Everything below is descriptor-native and free of native
 * dependencies, so it can be unit tested in plain Node: the engine is handed
 * its library's module by the wallet layer (wallet/engineLaunch.ts).
 */
export * from './descriptor';
export * from './engine';
export * from './psbt';
export * from './network';
export * from './rawTx';
