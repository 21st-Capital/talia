/** Public surface of the exchange layer (pure; I/O lives in services/). */
export {
  KRAKEN_API_ORIGIN,
  KRAKEN_ENTRY_PREFIX,
  KRAKEN_KEY_TOO_POWERFUL,
  KRAKEN_KEY_UNCHECKABLE,
  KRAKEN_PERMISSION_PROBES,
  krakenPermissionVerdict,
  krakenReadOnlyVerdict,
  freshKrakenDrafts,
  isKrakenEntry,
  krakenEntryId,
  krakenErrorMessage,
  krakenLedgerToEntries,
  krakenOddReplyMessage,
  describeReplyHeaders,
  krakenSignature,
  krakenTradesToEntries,
  looksLikeKrakenSecret,
  parseKrakenPair,
  parseKrakenQr,
} from './kraken';
export type { KrakenKeyVerdict, KrakenPermissionVerdict, KrakenProbeRole } from './kraken';
export type { KrakenEntryDraft, KrakenLedgerRow, KrakenPair, KrakenQrContents, KrakenTrade } from './kraken';
export type { ExchangeEntryDraft } from './drafts';
export { freshDrafts } from './drafts';
export {
  COINBASE_API_HOST,
  COINBASE_ENTRY_PREFIX,
  COINBASE_FILLS_PATH,
  COINBASE_KEY_PERMISSIONS_PATH,
  COINBASE_KEY_TOO_POWERFUL,
  COINBASE_SANDBOX_HOST,
  coinbaseEntryId,
  coinbaseKeyVerdict,
  coinbaseErrorMessage,
  coinbaseFillsToEntries,
  coinbaseJwt,
  coinbaseJwtVerifies,
  coinbaseKeyProblemMessage,
  coinbaseSigningKey,
  coinbaseTimeToMs,
  isCoinbaseEntry,
  parseCoinbaseKeyInput,
  parseCoinbaseProduct,
} from './coinbase';
export type { CoinbaseFill, CoinbaseKeyInput, CoinbaseKeyProblem, CoinbaseProduct } from './coinbase';
