/** Public surface of the wallet (app-state) layer. */
export { WalletProvider, useWallets } from './WalletProvider';
export type { NewWalletInput, StoreProblem } from './WalletProvider';
export type { WalletMeta, AppSettings, BackendType } from './types';
export { backendFor, getEngineFactory, USE_FAKE_ENGINE } from './engineProvider';
export { broadcastThroughChainServers, chainServerNote, serverHold, syncProblemNote } from './chainServers';
export { formatSats, formatBtc, formatSignedSats, groupDigits, resolveUnit, AUTO_BTC_THRESHOLD,
} from './format';
export { buildLedger, withRunningBalance, groupIntoSections, formatDayTitle, isSelfTransfer } from './history';
export type { LedgerTx, LedgerSection } from './history';
export { getTxNote, setTxNote, getAllTxNotes, carryTxNote, addTxNotes } from './txNotes';
export { readLabelsFile, notesForHistory, labelsImportTitle } from './labelsImport';
export type { LabelsImportOutcome } from './labelsImport';
export { saveTxCache, loadTxCache, clearTxCache } from './txCache';
export { saveUtxoCache, loadUtxoCache, clearUtxoCache, agedTipHeight } from './utxoCache';
export { findDuplicateWallet, duplicateVaultMessage } from './duplicates';
export { explorerTxUrl, mempoolTxUrl } from './explorer';
export { customerFingerprintsOf, ledgerFingerprintsOf,
  bitboxFingerprintsOf, signingDeviceFingerprintsOf, deviceKeyLabel, hardwareRegistrationChecklist, registrationWalk, heirFingerprintsOf,
  ownKeysOnThisPhone, knownDevicesFor, vaultShapeOf,
  vaultIsLedgerBound, vaultWasImported, sendAccess, primaryPathCustomerFingerprints, primaryPathFullyRegistered,
  isSingleSigVault, singleSigDevice, deviceOfKey, singleSigKeyId, signingReach, stepKeyOf, stepKeysOf, ownKeysToRegister,
  addressCheckKeysOf, addressCheckOffered } from './keyDevices';
export type { SendAccess, SigningReach } from './keyDevices';
export { ownKeysLeftToSign } from './ownKeysLeft';
export { newHeirId } from './heirId';
export { providerKeysOf, providerKeyRoleLabel, accountIndexOf, vaultNumberOf, vaultOfAccount } from './providerKeyRoles';
export { isSharedViewer, mayExportEditableCopy, EDITABLE_EXPORT_ACTIONS } from './sharedAccess';
export { withKeyOrigin, standardOriginPath } from './descriptorOrigin';
export {
  replaceableKeys,
  deviceReplacementPatch,
  needsReRegistration,
  registersAfterReplacement,
  sameExtendedKey,
  deviceHoldsKey,
  canReplaceDevice,
} from './replaceDevice';
export { uniqueVaultName, fitName, MAX_NAME_LENGTH } from './vaultNames';
export { defaultKeyNames, isDefaultKeyName, keyDisplayName, keyNameTemplate, registrationAsksKeyName } from './keyNames';
export type { ReplaceableKey } from './replaceDevice';
export type { ProviderKeyEntry, ProviderKeyRole, VaultNumber } from './providerKeyRoles';
export type { UtxoCache } from './utxoCache';
export { ADDRESSES_NOT_CHECKED, ADDRESS_CHECK_PATIENCE_MS, saveAddrCache, loadAddrCache, clearAddrCache } from './addrCache';
export type { AddressCache, CachedAddress } from './addrCache';
export { getHistoricalRate, getHistoricalPoint } from './historicalPrice';
export { outpointKey, resolveBasis, basisForCoin, vaultBasisSummary, vaultUnrealizedFiat,
  coinUnrealizedFiat, coinBasisError, reassignRecord, recordCostIn } from './coinBasis';
export { convertFiatOnDate, crossConvert } from './fxRate';
export type { CoinBasisRecord, VaultBasisSummary, ResolvedBasis } from './coinBasis';
export { loadCoinCosts, saveCoinCosts, clearCoinCosts } from './coinCosts';
export { hasAppPin, isValidPin, waitMessage } from './pin';
export { LOCK_AFTER_CHOICES, lockAfterLabel, lockAfterSeconds, shouldRelock } from './appLock';
export type { LockAfterSeconds } from './appLock';
export { getBtcPrice, getBtcUsdPrice, formatFiat, formatUsd, FIAT_CURRENCIES, fiatSymbol } from './price';
export { formatAmount, formatSignedAmount, formatCardAmount, chunkAddress, addressDigitRuns } from './format';
export { sectionsForWallets,
  categoryTitleFor, visibleWallets, visibleTotalSats, allCategories, hiddenSectionKeys, withSectionHidden, CATEGORY_SAVINGS, CATEGORY_SPENDING, CATEGORY_VIRTUAL, CATEGORY_SINGLE_SIG, CATEGORY_MULTISIG, CATEGORY_OTHER, effectiveCategory, shapeCategory, storedCategoryFor,
  portfolioCategory, portfolioSectionTitleFor, portfolioSectionsFor, PORTFOLIO_DEFAULT_SECTION_TITLE,
  isBuiltinCategory, isBuiltinPortfolioCategory, vaultSectionChoices, portfolioSectionChoices } from './categories';
export { orderWalletsByIds } from './walletOrder';
export type { WalletSection, SectionChoice } from './categories';
export { formatRelativeTime } from './history';
export type { AmountUnit, FiatCurrency, ExchangeKind, ExchangeLink, SharedPortfolio } from './types';
export { exchangeLinksOf, exchangeLinkOf, withExchangeLink, withoutExchangeLink } from './exchangeLinks';
export { DEFAULT_SETTINGS } from './storage';
export { utxoExpiries, nearestExpiryBlocks, formatBlocksDuration, REFRESH_SOON_BLOCKS } from './timelock';
export { timelockNotice, coinTimelockChip, REFRESH_EXPLAINER } from './timelockNotice';
export { ownPaymentIds, mayBeBait } from './baitWarning';
export { manualBalanceSats, manualSummary, manualUnrealizedFiat, manualEntryError,
  sortManualEntries, manualRunningBalance, parseAmountToSats, parseFiatAmount, SATS_PER_BTC } from './manualLedger';
export type { ManualEntry, ManualEntryKind, ManualSummary, ManualLedgerEntry } from './manualLedger';
export { coinsValueFromPrice, coinsValueFromTotal, pricePerBtcFromCoinsValue, entryTotalWithFee,
  entryTotalFromPrice, fiatDecimals } from './manualEntryPricing';
export type { EntryTotal, EntryTotalInput } from './manualEntryPricing';
export { loadManualEntries, peekManualEntries, saveManualEntries, clearManualEntries, newManualEntryId } from './manualEntries';
export { serializeManualVault, parseManualVault } from './manualExport';
export { entryOrigin, originVaultName, originWords, usableFee, entryMoney, usablePrice, formatMoney,
  formatFiatValue, displayNote } from './entryDetails';
export type { EntryOrigin, EntryMoney } from './entryDetails';
export { entryFormMoney, entryFormOpening, plainNumber } from './entryForm';
export type { MoneyAnchor, EntryFormMoney, EntryFormMoneyInput, EntryFormOpening } from './entryForm';
export { EXCHANGE_SOURCES, P2P_SOURCE, OTHER_SOURCE, NO_SOURCE_KEY, MAX_SOURCE_NAME_LENGTH, cleanSourceName, sourcePickerRows,
  sourceFieldsFor, entrySourceName, entrySourceFields, sourceFieldsToStore, sanitizeSourceFields } from './entrySources';
export type { SourceOption, EntrySourceFields } from './entrySources';
export { portfolioEntriesFromHistory, toManualEntries } from './vaultToPortfolio';
export { snapshotVaultIntoPortfolio, snapshotOutcomeMessage } from './portfolioSnapshot';
export type { SnapshotOutcome } from './portfolioSnapshot';
export { buildPortfolioCsv, buildPortfolioPdf, portfolioPdfRows } from './portfolioReport';
export {
  decryptBackup,
  descriptorPaths,
  encryptBackup,
  parseBackup,
  participantKeys,
  stripKeyDecoration,
  encodeTaliaPayload,
  readTaliaPayload,
  openBackup,
  readSealedBackup,
} from './encryptedBackup';
export type { OpenedBackup } from './encryptedBackup';
export {
  parseTaliaVaultExport,
  serializeTaliaVaultExport,
  taliaVaultExportOf,
  taliaExportDescriptorText,
  importedVaultPatch,
} from './taliaVaultExport';
export type { TaliaVaultExport } from './taliaVaultExport';
export {
  buildPortfolioStatementCsv,
  buildPortfolioStatementDocument,
  portfolioStatementData,
  portfolioStatementRows,
} from './portfolioStatement';
export type { PortfolioStatementInput } from './portfolioStatement';
export {
  buildStatementCsv,
  buildStatementDocument,
  periodLabel,
  statementData,
  statementRows,
  txKind,
} from './txReport';
export type { StatementInput } from './txReport';
export {
  isAllTime,
  presetPeriod,
  splitByPeriod,
  todayIso,
} from './statementPeriod';
export type { PeriodPreset, StatementPeriod } from './statementPeriod';
export { statementStrings, ISSUER } from './statementText';
export type { StatementLang } from './statementText';
export { manualTotalSats } from './categories';
export type { UtxoExpiry } from './timelock';
export { ownKeysFirst } from './keyOrder';
export { isTestNetwork, networkNote, withNetworkNote } from './networkNote';
export {
  pendingProviderKey,
  PENDING_PROVIDER_FPS,
  PENDING_PROVIDER_LABELS,
} from './pendingProviderKeys';
export {
  loadReplacementContext,
  findPendingChild,
  pendingChildNow,
  replacementEligibility,
  signalsReplaceable,
  spentOnEverydayPath,
  originalOf,
  feeRateOf,
  roundRateUp,
  minimumRate,
  effectiveRate,
  feeFloor,
  replacementVsize,
  replacementFee,
  dustFor,
  speedUpShape,
  speedUpFigures,
  speedUpRequest,
  cancelFigures,
  cancelRequest,
  replacementRows,
  customReplacementRow,
  customRateProblem,
  checkBuiltFee,
  replacementProblems,
  buildReplacement,
  isInsufficientFunds,
  replacementBuildFailure,
  replacementBroadcastFailure,
  replacementRecord,
  ReplacementError,
  TIER_KEYS,
  TIER_LABELS,
  EVERYDAY_SEQUENCE,
  FINAL_SEQUENCE_NO_RBF,
  MIN_RATE_STEP,
  INCREMENTAL_RELAY_RATE,
} from './replacement';
export type {
  ReplacementContext,
  SpentCoin,
  CannotReplace,
  NoSpeedUp,
  NoCancel,
  ReplacementEligibility,
  OriginalTx,
  OriginalOutput,
  SpeedUpShape,
  SpeedUpFigures,
  CancelFigures,
  TierKey,
  ReplacementRow,
  BuiltFeeCheck,
  ReplacementErrorCode,
  ReplacementBuild,
} from './replacement';
export { etaForRate, etaLine, etaNeedsBlocks, etaPhraseForMinutes, blocksUntilMined, TIER_ETA } from './txEta';
export type { MempoolBlock } from './txEta';
export { getMempoolBlocks, getTxEta } from './mempoolBlocks';
export {
  loadTxReplacements,
  getTxReplacements,
  saveTxReplacement,
  getReplacementState,
  pruneTxReplacements,
  clearTxReplacements,
  planTxReplacement,
  plannedReplacement,
  recordIfReplacement,
  saveSentAt,
  getSentAt,
  noteWaiting,
  dropSiblingPlans,
  replacementSendCheck,
  returnedPayment,
} from './txReplacements';
export type { ReplacementSendVerdict, WaitingTimes } from './txReplacements';
export {
  replacedBy,
  replacing,
  laterReplacements,
  earlierReplacements,
  currentTxid,
  isReturn,
  returnedPaymentSats,
  replacementState,
  KEEP_UNTIL_CONFIRMATIONS,
} from './txReplacementLogic';
export { replacementParamsFromPlan } from './txReplacementLogic';
export type { TxReplacement, ReplacementKind, ReplacementState, ReplacementParams } from './txReplacementLogic';
