// RN's macro-based export for the Swift module. Method signatures must match
// the Swift @objc selectors exactly or the bridge silently drops them.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(BitboxModule, RCTEventEmitter)

RCT_EXTERN_METHOD(createClient:(NSString * _Nullable)noiseConfigJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(feedFrame:(nonnull NSNumber *)handle frameB64:(NSString *)frameB64)
RCT_EXTERN_METHOD(open:(nonnull NSNumber *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(unlockAndPair:(nonnull NSNumber *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(confirmPairing:(nonnull NSNumber *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(noiseConfigJson:(nonnull NSNumber *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deviceInfo:(nonnull NSNumber *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(rootFingerprint:(nonnull NSNumber *)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(xpub:(nonnull NSNumber *)handle
                  keypath:(NSString *)keypath
                  xpubType:(NSString *)xpubType
                  display:(BOOL)display
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isPolicyRegistered:(nonnull NSNumber *)handle
                  testnet:(BOOL)testnet
                  policy:(NSString *)policy
                  keys:(NSArray *)keys
                  keypathAccount:(NSString *)keypathAccount
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(registerPolicy:(nonnull NSNumber *)handle
                  testnet:(BOOL)testnet
                  policy:(NSString *)policy
                  keys:(NSArray *)keys
                  keypathAccount:(NSString *)keypathAccount
                  name:(NSString *)name
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(policyAddress:(nonnull NSNumber *)handle
                  testnet:(BOOL)testnet
                  policy:(NSString *)policy
                  keys:(NSArray *)keys
                  keypath:(NSString *)keypath
                  display:(BOOL)display
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(signPsbt:(nonnull NSNumber *)handle
                  testnet:(BOOL)testnet
                  psbtB64:(NSString *)psbtB64
                  policy:(NSString * _Nullable)policy
                  keys:(NSArray *)keys
                  keypathAccount:(NSString * _Nullable)keypathAccount
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(close:(nonnull NSNumber *)handle)

@end
