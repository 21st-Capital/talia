/** Public surface of the descriptor layer. */
export * from './types';
export {
  parseDescriptor,
  detectNetwork,
  detectScriptType,
  parseKeyOrigins,
  parseTimelocks,
  parseMultisig,
  containsPrivateKeys,
  stripChecksum,
  classify,
  descriptorChecksum,
  checksumMatches,
} from './parse';
export { describeScript, hasTimelock, isLayered } from './describe';
export { splitMultipathDescriptor } from './multipath';
export { normalizeBareKey } from './bareKey';
export type { NormalizedBareKey } from './bareKey';
export { extractImportPayload, unsupportedWalletFileReason } from './importFile';
export type { ImportPayload } from './importFile';
export type { SplitDescriptors } from './multipath';
export {
  validateForImport,
  summarise,
  suggestLabel,
  guessSource,
  taprootKeyPathSpendable,
} from './validate';
export type {
  ValidationResult,
  ValidationOk,
  ValidationError,
  ValidateOptions,
} from './validate';
export { minOlderBlocks, csvLock } from './timelock';
export { parsePolicy, pathRequirement, pathSatisfiedBy, pathSatisfiedOnEveryInput,
  fallbackWitnessAllowed, primaryPath, deadEndShape, sigTypeLabel, pathOpenForTx, pathInPlay } from './policy';
export type { WalletPolicy, PolicyPath, PolicyGroup, PathInPlay } from './policy';
export { parseElectrumWallet } from './electrumWallet';
export type { ElectrumWallet } from './electrumWallet';
export { parseColdcardExport } from './coldcard';
export {
  coldcardWalletName,
  coldcardMultisigConfig,
  coldcardMiniscriptImport,
  coldcardNamedImport,
} from './coldcardRegister';
export type { ColdcardExport, ColdcardAccount } from './coldcard';
export {
  composeSinglesig,
  composeMultisig,
  composeTimelockVault,
  composeLayeredVault,
  monthsToBlocks,
  formatVaultKey,
  MAX_OLDER_BLOCKS,
  BLOCKS_PER_MONTH,
} from './compose';
export type { TimelockVaultSpec, RecoveryPathSpec, ComposeOpts } from './compose';
export { unspendableInternalKey, isProvablyUnspendableKey } from './unspendable';
