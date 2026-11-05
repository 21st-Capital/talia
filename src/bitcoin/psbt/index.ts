/** Public surface of the PSBT layer. */
export {
  buildUnsignedPsbt,
  validateBuildRequest,
  totalRecipientAmount,
  looksLikeAddress,
  BuildValidationError,
  DUST_LIMIT,
  MAX_FEE_RATE,
} from './build';
export type { BuildValidationIssue } from './build';
export {
  isValidBase64Psbt,
  makePsbtExport,
  psbtFilename,
  slugify,
  decodeBase64,
  encodeBase64,
  looksLikePsbt,
  looksLikeRawTx,
  decodeHexOrBase64,
  PSBT_MAGIC,
} from './export';
export type { PsbtExport } from './export';
export { parsePsbt, psbtLockTime, scriptToAddress, psbtInputsFinalized, psbtSignatureStatus, unsignedTxid } from './parse';
export type { ParsedPsbt, PsbtOutputSummary, PsbtSignatureStatus } from './parse';
export { buildCosignRequest } from './cosignRequest';
export type { CosignRequest } from './cosignRequest';
export { scureFinalizePsbt } from './finalize';
export { txLocksOf } from './timelockCheck';
export {
  rawTxShape,
  psbtTxShape,
  rawTxMatchesPsbt,
  checkRescueSpend,
  feeLooksAbsurd,
  psbtAbsurdFee,
  refusalMessage,
  BroadcastRefusedError,
} from './broadcastCheck';
export type { TxShape, BroadcastRefusal, RescueExpectation, WalletFacts } from './broadcastCheck';
