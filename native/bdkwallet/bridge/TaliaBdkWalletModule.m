//
//  TaliaBdkWalletModule.m
//
//  React Native's export of TaliaBdkWalletModule.swift. The selectors must
//  match the Swift @objc names exactly or the bridge silently drops a method.
//  peekAddress exists in DEBUG builds only, as in the Swift.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TaliaBdkWalletModule, NSObject)

RCT_EXTERN_METHOD(knownAnswer:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openWallet:(nonnull NSString *)external
                  internal:(NSString *)internal
                  network:(nonnull NSString *)network
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(closeWallet:(nonnull NSString *)walletId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sync:(nonnull NSString *)walletId
                  server:(nonnull NSDictionary *)server
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(balance:(nonnull NSString *)walletId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(transactions:(nonnull NSString *)walletId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(rawTransaction:(nonnull NSString *)walletId
                  txid:(nonnull NSString *)txid
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(unspent:(nonnull NSString *)walletId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(address:(nonnull NSString *)walletId
                  keychain:(nonnull NSString *)keychain
                  which:(nonnull NSString *)which
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(derivationIndex:(nonnull NSString *)walletId
                  keychain:(nonnull NSString *)keychain
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isMine:(nonnull NSString *)walletId
                  address:(nonnull NSString *)address
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(policies:(nonnull NSString *)walletId
                  keychain:(nonnull NSString *)keychain
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(build:(nonnull NSString *)walletId
                  options:(nonnull NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(psbtInfo:(nonnull NSString *)psbt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(combine:(nonnull NSString *)walletId
                  original:(nonnull NSString *)original
                  signedPsbt:(nonnull NSString *)signedPsbt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(finalize:(nonnull NSString *)walletId
                  psbt:(nonnull NSString *)psbt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(extract:(nonnull NSString *)psbt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(broadcast:(nonnull NSDictionary *)server
                  transaction:(nonnull NSString *)transaction
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(parseTransaction:(nonnull NSString *)transaction
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(serverBlocks:(nonnull NSString *)walletId
                  server:(nonnull NSDictionary *)server
                  heights:(nonnull NSArray *)heights
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addressActivity:(nonnull NSDictionary *)server
                  network:(nonnull NSString *)network
                  address:(nonnull NSString *)address
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(probeServer:(nonnull NSDictionary *)server
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

#if DEBUG
RCT_EXTERN_METHOD(peekAddress:(nonnull NSString *)descriptor
                  network:(nonnull NSString *)network
                  keychain:(nonnull NSString *)keychain
                  index:(nonnull NSNumber *)index
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
#endif

@end
