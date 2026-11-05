//
// The React Native face of bitbox-ffi.
//
// THREADING CONTRACT (from the crate's docs, and it is load-bearing): every
// protocol op BLOCKS its thread until the device answers, and the frames the
// device sends back arrive through feedFrame. If ops and frames shared one
// queue, the op would block the very frame that completes it and the ceremony
// would hang until the 180s read timeout. So ops run on their own serial
// queue and feedFrame on another.
//
// The FrameSink callback fires ON the blocked op thread. It only forwards the
// frame to JS as an event and returns; ble-plx does the actual write there.
//
import Foundation
import React

@objc(BitboxModule)
class BitboxModule: RCTEventEmitter {
  // Concurrent on purpose: the Rust registry is the serializer (a second op
  // on the same handle gets a clean "busy" error), and a serial queue here
  // meant one abandoned createClient blocked every retry behind its 180s
  // read timeout.
  private let opQueue = DispatchQueue(label: "talia.bitbox.ops", attributes: .concurrent)
  private let frameQueue = DispatchQueue(label: "talia.bitbox.frames")

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["bitboxFrame"] }

  private class Sink: FrameSink {
    weak var emitter: BitboxModule?
    // Queue and return: the protocol thread is blocked until send() does.
    func send(frame: [UInt8]) {
      let b64 = Data(frame).base64EncodedString()
      emitter?.sendEvent(withName: "bitboxFrame", body: b64)
    }
  }

  @objc(createClient:resolver:rejecter:)
  func createClient(_ noiseConfigJson: String?,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    opQueue.async {
      let sink = Sink()
      sink.emitter = self
      let handle = BitBoxFFI.createClient(sink: sink, noiseConfigJson: noiseConfigJson)
      resolve(NSNumber(value: handle))
    }
  }

  @objc(feedFrame:frameB64:)
  func feedFrame(_ handle: NSNumber, frameB64: String) {
    frameQueue.async {
      guard let data = Data(base64Encoded: frameB64) else { return }
      BitBoxFFI.feedFrame(handle: handle.uint64Value, frame: [UInt8](data))
    }
  }

  private func run<T>(_ resolve: @escaping RCTPromiseResolveBlock,
                      _ reject: @escaping RCTPromiseRejectBlock,
                      _ op: @escaping () throws -> T,
                      map: @escaping (T) -> Any?) {
    opQueue.async {
      do {
        resolve(map(try op()))
      } catch let e as BitBoxError {
        switch e {
        case let .Device(message): reject("bitbox_device", message, nil)
        case let .State(message): reject("bitbox_state", message, nil)
        }
      } catch {
        reject("bitbox_unknown", error.localizedDescription, nil)
      }
    }
  }

  @objc(open:resolver:rejecter:)
  func open(_ handle: NSNumber,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock) {
    run(resolve, reject, { try BitBoxFFI.open(handle: handle.uint64Value) }, map: { (_: Void) -> Any? in nil })
  }

  @objc(unlockAndPair:resolver:rejecter:)
  func unlockAndPair(_ handle: NSNumber,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    run(resolve, reject, { try BitBoxFFI.unlockAndPair(handle: handle.uint64Value) }, map: { $0 as Any? })
  }

  @objc(confirmPairing:resolver:rejecter:)
  func confirmPairing(_ handle: NSNumber,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    run(resolve, reject, { try BitBoxFFI.confirmPairing(handle: handle.uint64Value) }, map: { (_: Void) -> Any? in nil })
  }

  @objc(noiseConfigJson:resolver:rejecter:)
  func noiseConfigJson(_ handle: NSNumber,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    run(resolve, reject, { try BitBoxFFI.noiseConfigJson(handle: handle.uint64Value) }, map: { $0 as Any? })
  }

  @objc(deviceInfo:resolver:rejecter:)
  func deviceInfo(_ handle: NSNumber,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    run(resolve, reject, { try BitBoxFFI.deviceInfo(handle: handle.uint64Value) }, map: { (info: DeviceInfo) -> Any? in
      [
        "name": info.name,
        "version": info.version,
        "initialized": info.initialized,
        "mnemonicPassphraseEnabled": info.mnemonicPassphraseEnabled,
      ]
    })
  }

  @objc(rootFingerprint:resolver:rejecter:)
  func rootFingerprint(_ handle: NSNumber,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    run(resolve, reject, { try BitBoxFFI.rootFingerprint(handle: handle.uint64Value) }, map: { $0 as Any? })
  }

  @objc(xpub:keypath:xpubType:display:resolver:rejecter:)
  func xpub(_ handle: NSNumber, keypath: String, xpubType: String, display: Bool,
            resolver resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock) {
    let t: XPubType
    switch xpubType.lowercased() {
    case "xpub": t = .xpub
    case "zpub": t = .zpub
    case "vpub": t = .vpub
    default: t = .tpub
    }
    run(resolve, reject, {
      try BitBoxFFI.xpub(handle: handle.uint64Value, keypath: keypath, xpubType: t, display: display)
    }, map: { $0 as Any? })
  }

  // keys arrive from JS as [{rootFingerprintHex?, keypath?, xpub}].
  private func parseKeys(_ raw: [[String: Any]]) -> [PolicyKey] {
    raw.map { k in
      PolicyKey(
        rootFingerprintHex: k["rootFingerprintHex"] as? String,
        keypath: k["keypath"] as? String,
        xpub: (k["xpub"] as? String) ?? ""
      )
    }
  }

  @objc(isPolicyRegistered:testnet:policy:keys:keypathAccount:resolver:rejecter:)
  func isPolicyRegistered(_ handle: NSNumber, testnet: Bool, policy: String,
                          keys: [[String: Any]], keypathAccount: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    let parsed = parseKeys(keys)
    run(resolve, reject, {
      try BitBoxFFI.isPolicyRegistered(handle: handle.uint64Value, testnet: testnet,
                                       policy: policy, keys: parsed, keypathAccount: keypathAccount)
    }, map: { $0 as Any? })
  }

  @objc(registerPolicy:testnet:policy:keys:keypathAccount:name:resolver:rejecter:)
  func registerPolicy(_ handle: NSNumber, testnet: Bool, policy: String,
                      keys: [[String: Any]], keypathAccount: String, name: String,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    let parsed = parseKeys(keys)
    run(resolve, reject, {
      try BitBoxFFI.registerPolicy(handle: handle.uint64Value, testnet: testnet,
                                   policy: policy, keys: parsed,
                                   keypathAccount: keypathAccount, name: name)
    }, map: { (_: Void) -> Any? in nil })
  }

  @objc(policyAddress:testnet:policy:keys:keypath:display:resolver:rejecter:)
  func policyAddress(_ handle: NSNumber, testnet: Bool, policy: String,
                     keys: [[String: Any]], keypath: String, display: Bool,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    let parsed = parseKeys(keys)
    run(resolve, reject, {
      try BitBoxFFI.policyAddress(handle: handle.uint64Value, testnet: testnet,
                                  policy: policy, keys: parsed, keypath: keypath, display: display)
    }, map: { $0 as Any? })
  }

  @objc(signPsbt:testnet:psbtB64:policy:keys:keypathAccount:resolver:rejecter:)
  func signPsbt(_ handle: NSNumber, testnet: Bool, psbtB64: String,
                policy: String?, keys: [[String: Any]], keypathAccount: String?,
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
    let parsed = parseKeys(keys)
    run(resolve, reject, {
      try BitBoxFFI.signPsbt(handle: handle.uint64Value, testnet: testnet,
                             psbtB64: psbtB64, policy: policy, keys: parsed,
                             keypathAccount: keypathAccount)
    }, map: { $0 as Any? })
  }

  @objc(close:)
  func close(_ handle: NSNumber) {
    opQueue.async { BitBoxFFI.close(handle: handle.uint64Value) }
  }
}
