/** Public surface of the wallet-engine layer. */
export * from './types';
// Every engine and the connection test come through the provider (BDK
// upgrade, decided 2026-10-15; one engine since the old engine's removal, decided
// 2026-11-04).
export {
  activeEngineFactory,
  configureEngine,
  ensureKnownAnswer,
  knownAnswerNow,
  LIBRARY_CHECK_FAILED,
  lastConnectionAnswer,
  lookUpAddressActivity,
  NO_WALLET_LIBRARY,
  onConnectionAnswer,
  onKnownAnswer,
  testBackendConnection,
} from './engineProvider';
export type { ConnectionAnswer, EngineConfig, KnownAnswerListener, KnownAnswerState } from './engineProvider';
export { libraryProblem } from './libraryProblem';
export { BdkWalletEngineV3, bdkWalletEngineV3Factory } from './bdkWalletEngine';
export {
  EngineError,
  classifyEngineError,
  coinsHeldByPendingTx,
  engineErrorFacts,
  engineErrorMessage,
} from './engineError';
export type { EngineErrorCode, EngineErrorFacts } from './engineError';
export {
  capturesSigningRounds,
  clearSigningRounds,
  onSigningRounds,
  signingRounds,
  signingRoundsFile,
} from './signingRounds';
export type { SigningRound } from './signingRounds';
export {
  fakeAddressActivity,
  FakeWalletEngine,
  fakeWalletEngineFactory,
  FAKE_PSBT_BASE64,
} from './fakeEngine';
export type { FakeEngineOptions } from './fakeEngine';
