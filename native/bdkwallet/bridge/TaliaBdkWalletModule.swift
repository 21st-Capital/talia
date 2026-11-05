//
//  TaliaBdkWalletModule.swift
//
//  The wallet library (bdk-ffi 3.1.1, the fork's talia-3 line) as a React
//  Native module; the old one beside it (TaliaBdk, bdk-ffi 0.30) was removed
//  with the old engine (decided 2026-11-04). BDK upgrade (decided 2026-10-15):
//  the bridge BdkWalletEngineV3 (src/bitcoin/engine/
//  bdkWalletEngine.ts) calls, 18 calls in place of the 39 the old engine
//  made, plus the launch-time known-answer test.
//
//  Rules:
//  - Every method returns a promise. Wallet work runs on ONE serial queue
//    (walletQueue); only probeServer and addressActivity, which touch no
//    wallet, run on chainQueue.
//  - The only handle is one wallet id per vault; closeWallet frees it.
//  - Values are plain: sats as numbers, hex or base64 strings.
//  - Unknown ids or arguments reject (BAD_ARGUMENT, UNKNOWN_WALLET) and never
//    crash: no force unwrap of anything JavaScript hands in.
//  - Errors reject with a stable code (engineError.ts) and a message in bdk
//    0.28's wording where the app reads it ("Insufficient funds: N sat
//    available of M sat needed", "Spending policy required: External").
//  - A connection that could not be opened rejects SERVER_UNREACHABLE, in the
//    library's words (decided 2026-10-30, `client(_:)`): the app reads the mark
//    and no longer depends on those words. A server that answered is never it.
//  - A Rust panic is RUST_PANIC. The bridge then drops and recreates that
//    wallet SYNCHRONOUSLY on walletQueue, before any later call can run: the
//    panic poisoned the wallet's mutex, and every later call would fail.
//    The recreated wallet holds no coins and no tip, so until a sync succeeds
//    every call that reads the chain (balance, transactions, rawTransaction,
//    unspent, a "new" or "lastUnused" address, isMine, build, finalize)
//    rejects WALLET_RESYNCING; the engine syncs again and asks once more.
//
//  Three rules decided 2026-10-17 live here (rule 1, rule 2 and rule 3 below
//  name them):
//  1. Coverage (sync): after the full scan, each keychain is scanned at least
//     as far as the OTHER keychain's last used index plus 150 (never less
//     than 0..99), on a scratch wallet, so neither keychain's next index
//     moves for the scan itself, pass after pass until no keychain is short
//     (a sync still short after 64 passes refuses, COVERAGE_INCOMPLETE); the
//     wallet that replaces the old one is
//     opened with a lookahead that covers the same window, so isMine and a
//     PSBT's output derivations see it too. A coin found there reveals its
//     own index, as the full scan (and 0.28) do.
//  2. Fees (build): a rate-mode build never pays below ceil(rate x vsize) of
//     the largest transaction its coins can finalize into; when bdk_wallet's
//     ceil(sat/kwu x weight) is below that, the same coins are built again at
//     that fee as an absolute fee.
//  3. Drain input order (build): a wallet drain spends its coins in 0.28's
//     order (its database's: the outpoint's consensus bytes), named by the
//     bridge itself under TxOrdering.untouched.
//
//  The leaf hazard is not fixed here: `finalize` calls the library's
//  finalize_psbt_keeping_metadata, which carries the fork's fix for it (the
//  fork's comments call it D10), and the engine's scure fallback runs after
//  it in TypeScript (engineShared.finishFinalization).
//
//  Public keys only, never a secret: nothing here can sign.
//

import CryptoKit
import Foundation
import React

// MARK: - Known answers

/// One known answer: a descriptor (and its change descriptor, or none), a
/// network, the address at `index` of `keychain`.
private struct KnownAnswer {
  let descriptor: String
  let change: String?
  let network: Network
  let keychain: KeychainKind
  let index: UInt32
  let address: String
}

private let BIP84_ACCOUNT = "[73c5da0a/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V"
private let BIP86_ACCOUNT = "[73c5da0a/86'/0'/0']xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ"
// The same two account keys in their testnet form.
private let BIP84_TEST = "[73c5da0a/84'/0'/0']tpubDCxX2sYFS5bDkSe5GKKYHjBW7tgyN1R3UchpLJvdbf54ohxeGRtd8MbDUe1cguVHe4vnK68DsuD5MXjxi9EXx16rb9EnNsaF5KT99CinaJz"
private let BIP86_TEST = "[73c5da0a/86'/0'/0']tpubDC3pD7UZXnsgh3EBjbtBQiB1FnLask7UHBSunZ1DPK4dCFFZoFRkgxHB8gt42FvLzx1DpxfHWxAsYaY6b643RVcGjDxXxns7wKKYnnfEcbB"

private let KNOWN_ANSWERS: [KnownAnswer] = [
  // BIP-84's first receive and change addresses.
  KnownAnswer(
    descriptor: "wpkh(\(BIP84_ACCOUNT)/0/*)", change: "wpkh(\(BIP84_ACCOUNT)/1/*)",
    network: .bitcoin, keychain: .external, index: 0,
    address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
  KnownAnswer(
    descriptor: "wpkh(\(BIP84_ACCOUNT)/0/*)", change: "wpkh(\(BIP84_ACCOUNT)/1/*)",
    network: .bitcoin, keychain: .internal, index: 0,
    address: "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"),
  // BIP-86's second receive address (key path only).
  KnownAnswer(
    descriptor: "tr(\(BIP86_ACCOUNT)/0/*)", change: nil,
    network: .bitcoin, keychain: .external, index: 1,
    address: "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh"),
  // A 2-of-2 of the two on Testnet4, where Talia's "testnet" lives.
  KnownAnswer(
    descriptor: "wsh(sortedmulti(2,\(BIP84_TEST)/0/*,\(BIP86_TEST)/0/*))", change: nil,
    network: .testnet4, keychain: .external, index: 0,
    address: "tb1qm3ngrc6tj8xlv06qprd3lzas9430qp4p6arrn3jkmafxr9nlc2csevfuu7"),
]

private func networkKind(_ network: Network) -> NetworkKind {
  network == .bitcoin ? .main : .test
}

/// The address at `index` of `keychain`, peeked (the wallet's index never moves).
private func peek(
  descriptor: String, change: String?, network: Network, keychain: KeychainKind, index: UInt32
) throws -> String {
  let external = try Descriptor(descriptor: descriptor, networkKind: networkKind(network))
  let persister = try Persister.newInMemory()
  let wallet: Wallet
  if let change = change {
    let internalDescriptor = try Descriptor(descriptor: change, networkKind: networkKind(network))
    wallet = try Wallet(
      descriptor: external, changeDescriptor: internalDescriptor, network: network,
      persister: persister, lookahead: 1)
  } else {
    wallet = try Wallet.createSingle(
      descriptor: external, network: network, persister: persister, lookahead: 1)
  }
  return try wallet.peekAddress(keychain: keychain, index: index).address.description
}

// MARK: - Constants

/// The stop gap of every full scan, and the least lookahead of every wallet.
/// The saved `stopGap` (20) of a backend is never read.
private let GAP: UInt32 = 150
/// Script pubkeys asked for in one round trip (the batch size is tuned first;
/// decided 2026-10-25). A keychain's scan to its last use plus the stop gap of 150 then takes
/// one round trip, or two past index 49, where 25 took seven; electrum-client writes the batch as
/// separate requests in one write, so a server sees the same requests sooner. bdk_electrum
/// stops reading a batch's answers where the stop gap ends, so the scan finds exactly what it
/// found 25 at a time. The shadow week's report found the new engine's syncs about twice as
/// long as 0.28's, and on a phone every round trip costs the network's latency (the simulator
/// harness's timing.py measures them). The trade-off, accepted (decided 2026-10-25): a full scan of an
/// unused keychain asks for 0..199 where its stop gap ends at 149, 50 scripts whose answers are
/// never read, while a batch of 150 would take two round trips for every keychain used at all;
/// with the coverage pass a sync asks for about 2 to 3 times the script histories 0.28 does
/// (574 on a first sync of the simulator harness's 16-transaction vault, 400 on a later one, against 200;
/// timing.py counts them per sync).
private let BATCH: UInt64 = 200
/// A vault's connection is kept between its syncs for this long after its last good sync
/// (decided 2026-10-25, `KeptClient`): long enough for the launch's refresh, the vault's own
/// screen and a payment's follow-up sync, and well short of the idle limits of servers (the
/// three built-in Testnet4 servers kept an idle connection for over 10 minutes when probed on
/// 2026-10-25) and of mobile networks, so a connection the network dropped silently is rarely
/// met, which would cost one sync its timeout.
private let KEEP_CLIENT_S: TimeInterval = 120
/// The blocks at the top of the chain that bdk_electrum 0.24.1 fetches from the server at every
/// sync (its CHAIN_SUFFIX_LENGTH): the tip and the 7 below it. Its client's header cache is
/// refreshed there and nowhere else, so a kept client is checked against this window
/// (`SyncOutcome.holds`).
private let FRESH_WINDOW: UInt32 = 8
/// The most heights one `serverBlocks` call reads.
private let SERVER_BLOCKS_MAX = 20
/// Rule 1: each keychain is scanned at least to index 99.
private let COVERAGE_FLOOR: Int64 = 99
/// Rule 1: a sync that still has a keychain short after this many extra
/// passes refuses (COVERAGE_INCOMPLETE) instead of ending quietly. Targets
/// only grow, each pass by a coin found 150 or fewer indexes past the other
/// keychain's last one, so a real vault ends long before.
private let MAX_COVERAGE_PASSES = 64
/// The highest index a keychain can derive (BIP-32 non-hardened).
private let MAX_INDEX: Int64 = 0x7FFF_FFFF
/// The longest history `addressActivity` reads whole, its transactions in one batch (decided
/// 2026-11-05, the address book's check); a longer one is answered with the address's coins.
private let ADDRESS_ACTIVITY_WHOLE_MAX = 50
/// `addressActivity` asks its last question (the transactions, or the coins) only while at most
/// this many seconds have passed since it started (decided 2026-11-05): that question's own
/// timeout (8 s, the lookup's) then ends the call by 19 s, inside the 20 s the wallet layer gives
/// each server (wallet/chainServers.ts ADDRESS_LOOKUP_ATTEMPT_MS), so a slow server never holds
/// chainQueue past its turn.
private let ADDRESS_ACTIVITY_LAST_ASK_S: TimeInterval = 11

// MARK: - Errors

/// An error the bridge itself raises, with its stable code.
private struct BridgeError: Error {
  let code: String
  let message: String
}

private func bad(_ message: String) -> BridgeError {
  BridgeError(code: "BAD_ARGUMENT", message: message)
}

/// uniffi's own errors (a Rust panic among them) are `fileprivate` to the
/// generated file, so they are known here by their type's name.
private func isUniffiInternal(_ error: Error) -> Bool {
  String(describing: type(of: error)) == "UniffiInternalError"
}

/// The library's "the wallet's lock was poisoned" answer, from any of the
/// errors that carry it (fork commit 3: a poisoned wallet is an error).
private func isPoisoned(_ error: Error) -> Bool {
  switch error {
  case WalletError.WalletPoisoned: return true
  case CreateTxError.WalletPoisoned: return true
  case SignerError.WalletPoisoned: return true
  case DescriptorError.WalletPoisoned: return true
  case CannotConnectError.WalletPoisoned: return true
  case CalculateFeeError.WalletPoisoned: return true
  case PersistenceError.WalletPoisoned: return true
  default: return false
  }
}

/// The code and message a rejection carries. Messages keep bdk 0.28's
/// wording where the app reads them (engineError.ts).
private func describe(_ error: Error) -> (code: String, message: String) {
  if let e = error as? BridgeError { return (e.code, e.message) }
  if isUniffiInternal(error) {
    return ("RUST_PANIC", "The wallet library stopped: \(error.localizedDescription)")
  }
  if isPoisoned(error) {
    return ("RUST_PANIC", "The wallet library stopped earlier and was opened again.")
  }
  if let e = error as? CreateTxError {
    switch e {
    case .SpendingPolicyRequired(let kind):
      return ("SPENDING_POLICY_REQUIRED", "Spending policy required: \(kind)")
    case .InsufficientFunds(let needed, let available):
      return ("INSUFFICIENT_FUNDS", "Insufficient funds: \(available) sat available of \(needed) sat needed")
    case .OutputBelowDustLimit(let index):
      return ("OUTPUT_BELOW_DUST", "Output below the dust limit: \(index)")
    case .UnknownUtxo:
      return ("UNKNOWN_UTXO", "UTXO not found in the internal database")
    case .Policy(let message):
      if message.contains("items selected") {
        return ("POLICY_PATH_INVALID", "Invalid policy path: \(message)")
      }
      return ("OTHER", message)
    case .Version1Csv:
      return ("VERSION1_CSV", "Version 1 transactions cannot spend a CSV path")
    default:
      return ("OTHER", e.localizedDescription)
    }
  }
  if let e = error as? ElectrumError {
    // The server's or the connection's own words after 0.28's prefix: the
    // app's refusal readers match the server text, Diagnostics shows it.
    return ("OTHER", "Electrum client error: \(electrumText(e))")
  }
  return ("OTHER", error.localizedDescription)
}

/// Did the server answer (a refusal, an answer that could not be read)? A new connection would
/// be told the same, so a kept one is not replaced for it.
private func serverAnswered(_ e: ElectrumError) -> Bool {
  switch e {
  case .Protocol, .InvalidResponse: return true
  default: return false
  }
}

/// Did the connection fail with no answer from the server? `ElectrumClient(url:)` is the step
/// that opens it: electrum-client connects, shakes hands over TLS and asks `server.version` there
/// (a server that closes the stream in the handshake is rustls' "unexpected end of file", read
/// off a local listener on 2026-10-30). So a server can also ANSWER in that step (an error of its
/// own to `server.version` is `.Protocol`, something else on the port is `.Json`), which is why
/// this lists what cannot be an answer, rather than excepting what can.
private func neverConnected(_ e: ElectrumError) -> Bool {
  switch e {
  case .IoError, .SharedIoError, .AllAttemptsErrored, .CouldNotCreateConnection, .InvalidDnsNameError, .MissingDomain: return true
  default: return false
  }
}

private func electrumText(_ e: ElectrumError) -> String {
  switch e {
  // electrum-client's own words for a server that ANSWERED, as the old
  // library passed them on (bdk-ffi 3.x keeps only the server's text): the
  // app reads "Electrum server error" as "the server answered", so a
  // refusal is never taken for a server that could not be reached, and a
  // Testnet4 sync moves on to the next server after an error or an
  // unreadable answer (wallet/chainServers.ts, decided 2026-10-18).
  case .Protocol(let m):
    return "Electrum server error: \(m)"
  case .InvalidResponse(let m):
    return "Error during the deserialization of a response from the server: \(m)"
  case .IoError(let m), .Json(let m), .Hex(let m), .Bitcoin(let m),
    .Message(let m), .SharedIoError(let m), .CouldNotCreateConnection(let m):
    return m
  case .InvalidDnsNameError(let domain):
    return "invalid DNS name \(domain)"
  case .AllAttemptsErrored:
    return "Made one or multiple attempts, all errored"
  default:
    return String(describing: e)
  }
}

// MARK: - Small helpers

private func hexBytes(_ hex: String) -> Data? {
  let chars = Array(hex.utf8)
  guard chars.count % 2 == 0 else { return nil }
  var out = Data(capacity: chars.count / 2)
  var i = 0
  func nibble(_ c: UInt8) -> UInt8? {
    switch c {
    case 48...57: return c - 48
    case 97...102: return c - 87
    case 65...70: return c - 55
    default: return nil
    }
  }
  while i < chars.count {
    guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
    out.append(hi << 4 | lo)
    i += 2
  }
  return out
}

private func hexString(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

private func parseNetwork(_ s: String) throws -> Network {
  switch s {
  case "bitcoin": return .bitcoin
  // Talia's "testnet" is Testnet4.
  case "testnet": return .testnet4
  case "signet": return .signet
  case "regtest": return .regtest
  default: throw bad("network is not one this call takes")
  }
}

private func parseKeychain(_ s: String) throws -> KeychainKind {
  switch s {
  case "external": return .external
  case "internal": return .internal
  default: throw bad("keychain is not one this call takes")
  }
}

private func keychainName(_ k: KeychainKind) -> String {
  k == .external ? "external" : "internal"
}

/// A whole, non-negative number of at most `max`, from JavaScript.
private func whole(_ v: Any?, _ what: String, max: Double = 18_446_744_073_709_551_615) throws -> UInt64 {
  guard let n = v as? NSNumber else { throw bad("\(what) is missing") }
  let d = n.doubleValue
  guard d.isFinite, d >= 0, d <= max, d.rounded() == d else { throw bad("\(what) is not a whole number in range") }
  return d >= 18_446_744_073_709_551_615 ? UInt64.max : UInt64(d)
}

private func flag(_ v: Any?) -> Bool {
  (v as? NSNumber)?.boolValue ?? false
}

/// "txid:vout" from JavaScript.
private func parseOutPoint(_ s: Any?) throws -> OutPoint {
  guard let text = s as? String, let colon = text.lastIndex(of: ":") else { throw bad("a coin is not txid:vout") }
  let txidHex = String(text[text.startIndex..<colon])
  guard txidHex.count == 64, let vout = UInt32(text[text.index(after: colon)...]) else {
    throw bad("a coin is not txid:vout")
  }
  return OutPoint(txid: try Txid.fromString(hex: txidHex), vout: vout)
}

/// 0.28's database order for an outpoint: its consensus bytes (the txid's
/// internal byte order, then vout little-endian), as MemoryDatabase keyed it.
private func dbOrderKey(_ op: OutPoint) -> [UInt8] {
  let display = Array(hexBytes(op.txid.description) ?? Data())
  var key = Array(display.reversed())
  let v = op.vout
  key.append(contentsOf: [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF)])
  return key
}

private func lexLess(_ a: [UInt8], _ b: [UInt8]) -> Bool {
  for (x, y) in zip(a, b) where x != y { return x < y }
  return a.count < b.count
}

/// ceil(rate x vbytes), with the float noise of a decimal rate taken out
/// (1.1 x 250 is 275.00000000000006 in binary, which is 275).
private func feeAt(rateVb: Double, vbytes: UInt64) -> UInt64 {
  let x = rateVb * Double(vbytes)
  let r = x.rounded()
  if abs(x - r) < 1e-6 { return UInt64(r) }
  return UInt64(x.rounded(.up))
}

// MARK: - A vault's wallet

/// A vault's Electrum connection, kept from one sync to its next (decided 2026-10-25). The
/// library's client (bdk-ffi's ElectrumClient wraps bdk_electrum 0.24.1's BdkElectrumClient)
/// keeps every transaction, block header and confirmation proof it fetched, so a later sync on
/// the same client asks the server again only for the script histories: the transactions
/// themselves, their fee coins and their proofs come from memory, as 0.28's in-memory database
/// gives them to it for the launch. A new client per sync fetched every transaction again, one
/// round trip each. Held in memory only, so nothing outlives the app (decided 2026-10-15); one per vault, never
/// shared, so one connection never carries two vaults; replaced when the server or its settings
/// change, dropped after any failed sync (a client whose retries ran out never reconnects by
/// itself), on closeWallet, on a panic's recreate, and when idle longer than KEEP_CLIENT_S.
///
/// A reorganisation of the chain (decided 2026-10-28): the client caches block headers by HEIGHT
/// and confirmation proofs by block hash, and refreshes only the top 8 headers at each sync
/// (FRESH_WINDOW). A block replaced deeper than that between two syncs stays in its header cache,
/// and a transaction mined again at the same height then gets its proof, and the replaced block's
/// hash and time, from the cache: a block that is no longer on the chain (the simulator harness's reorg suite:
/// 8, 9 and 10 blocks deep). So a sync on a kept client is accepted only when one block of the
/// last good sync's window (`window`) is still the server's at its height in the new sync's own
/// window, which the server sent in this sync: every block at or below it is then unchanged, every
/// header the client cached is at or below the old window's top, and anything replaced lies inside
/// the new window, whose headers the library fetched again before it read a proof. Otherwise (no
/// block of the old window is still there, the chain moved on by more than the window, or the
/// server's tip went below it) the sync runs again on a new connection, and nothing of the first
/// attempt is kept. A reorganisation of a block or two keeps the connection.
///
/// The price, and why it stays (decided 2026-10-28): 8 blocks or more since the last sync also run
/// the sync again, with no reorganisation (the harness timing's "10 blocks between"), which can only
/// happen within KEEP_CLIENT_S of that sync (a burst of Testnet4 blocks; never at mainnet's
/// pace). One header asked at the old window's top would vouch for every cached header BELOW it,
/// but not for the ones above: the library caches the header of any height a proof needed,
/// including a block that arrived during the last sync above the tip it read, and its anchor
/// cache is keyed by the cached header's hash, so a block replaced there would come back without
/// a proof, the very fault this check exists for. The shared window covers those heights by
/// fetching them again; a lone header does not.
private struct KeptClient {
  /// The server and its settings (`ServerSettings.key`): another key is another connection.
  let key: String
  let client: ElectrumClient
  let lastUsed: Date
  /// The window of the last good sync on this client (height to hash): the chain its caches agree with.
  let window: [UInt32: BlockHash]
}

/// One sync's result, before it replaces the vault's wallet (`syncPasses`).
private struct SyncOutcome {
  let wallet: Wallet
  let tip: BlockId
  let used: [KeychainKind: Int64]
  let passes: Int
  let lookahead: Int64

  /// This sync's window: the blocks at the top of its chain, which came from the server in this
  /// sync (a block further down came from an anchor, which may be a kept client's cache).
  func window() throws -> [UInt32: BlockHash] {
    var out: [UInt32: BlockHash] = [:]
    let low = tip.height >= FRESH_WINDOW - 1 ? tip.height - (FRESH_WINDOW - 1) : 0
    for cp in try wallet.checkpoints() where cp.height >= low && cp.height <= tip.height {
      out[cp.height] = cp.hash
    }
    return out
  }

  /// Is a block of `earlier` (a kept client's last window) still the block at its height in this
  /// sync's window? Then nothing at or below it changed (`KeptClient`).
  func holds(_ earlier: [UInt32: BlockHash]) throws -> Bool {
    let now = try window()
    return earlier.contains { height, hash in now[height] == hash }
  }
}

/// The hash of a block header: double SHA-256 of its 80 consensus bytes.
private func headerHash(_ h: Header) throws -> BlockHash {
  var bytes = Data(capacity: 80)
  withUnsafeBytes(of: h.version.littleEndian) { bytes.append(contentsOf: $0) }
  bytes.append(h.prevBlockhash.serialize())
  bytes.append(h.merkleRoot.serialize())
  withUnsafeBytes(of: h.time.littleEndian) { bytes.append(contentsOf: $0) }
  withUnsafeBytes(of: h.bits.littleEndian) { bytes.append(contentsOf: $0) }
  withUnsafeBytes(of: h.nonce.littleEndian) { bytes.append(contentsOf: $0) }
  let once = Data(SHA256.hash(data: bytes))
  return try BlockHash.fromBytes(bytes: Data(SHA256.hash(data: once)))
}

private final class WalletState {
  let external: String
  let internalDescriptor: String?
  let network: Network
  var wallet: Wallet
  /// The highest index revealed in this session, per keychain (`sync`).
  var revealed: [KeychainKind: UInt32] = [:]
  /// The last used index the previous sync found, per keychain: where the
  /// next sync's first pass starts its coverage (rule 1).
  var lastUsed: [KeychainKind: Int64] = [:]
  var tip: UInt32 = 0
  /// The connection of this vault's last good sync, for its next one (`KeptClient`).
  var kept: KeptClient?
  /// Set when a panic recreated the wallet: it holds no coins and no tip
  /// until the next sync, so every call that reads the chain rejects
  /// WALLET_RESYNCING meanwhile (a balance of 0, an empty coin list, a reused
  /// receive address or a build at the wrong tip would be wrong answers).
  var needsSync = false
  /// Rule 2's weight bound: the most any input of this vault adds when satisfied.
  let maxSatisfaction: UInt64
  /// Whether the vault's inputs are segwit (marker, flag and a witness count each).
  let segwit: Bool
  /// Taproot inputs carry no non_witness_utxo requirement.
  let taproot: Bool

  init(external: String, internalDescriptor: String?, network: Network) throws {
    self.external = external
    self.internalDescriptor = internalDescriptor
    self.network = network
    let kind = networkKind(network)
    let e = try Descriptor(descriptor: external, networkKind: kind)
    var weight = try e.maxWeightToSatisfy()
    if let i = internalDescriptor {
      weight = max(weight, try Descriptor(descriptor: i, networkKind: kind).maxWeightToSatisfy())
    }
    self.maxSatisfaction = weight
    let type = e.descType()
    self.segwit = ![DescriptorType.bare, .sh, .pkh, .shSortedMulti].contains(type)
    self.taproot = type == .tr
    self.wallet = try WalletState.open(external: external, change: internalDescriptor, network: network, lookahead: GAP)
  }

  var keychains: [KeychainKind] { internalDescriptor == nil ? [.external] : [.external, .internal] }

  static func open(external: String, change: String?, network: Network, lookahead: UInt32) throws -> Wallet {
    let kind = networkKind(network)
    let e = try Descriptor(descriptor: external, networkKind: kind)
    let persister = try Persister.newInMemory()
    if let change = change {
      let i = try Descriptor(descriptor: change, networkKind: kind)
      return try Wallet(descriptor: e, changeDescriptor: i, network: network, persister: persister, lookahead: lookahead)
    }
    return try Wallet.createSingle(descriptor: e, network: network, persister: persister, lookahead: lookahead)
  }

  /// A fresh wallet of this vault, each keychain revealed to `reveal`.
  func fresh(lookahead: UInt32, reveal: [KeychainKind: Int64]) throws -> Wallet {
    let w = try WalletState.open(external: external, change: internalDescriptor, network: network, lookahead: lookahead)
    for (k, i) in reveal where i >= 0 {
      _ = try w.revealAddressesTo(keychain: k, index: UInt32(i))
    }
    return w
  }

  /// After a panic: the same vault, unsynced, with this session's revealed
  /// range, answering nothing that needs the chain until a sync succeeds.
  func recreate() {
    needsSync = true
    tip = 0
    // A panic inside a sync can leave the client's caches behind a poisoned lock.
    kept = nil
    var reveal: [KeychainKind: Int64] = [:]
    for (k, i) in revealed { reveal[k] = Int64(i) }
    if let w = try? fresh(lookahead: GAP, reveal: reveal) {
      wallet = w
    }
  }

  /// Rejects while the wallet waits for its sync after a panic.
  func requireSynced() throws {
    if needsSync {
      throw BridgeError(
        code: "WALLET_RESYNCING", message: "The wallet library was opened again and is syncing this vault first.")
    }
  }

  func noteRevealed() {
    for k in keychains {
      if let i = try? wallet.derivationIndex(keychain: k) {
        revealed[k] = max(revealed[k] ?? 0, i)
      }
    }
  }
}

/// The highest derivation index holding an output of `keychain`, or -1.
private func lastUsedIndex(_ w: Wallet, _ keychain: KeychainKind) throws -> Int64 {
  var best: Int64 = -1
  for o in try w.listOutput() where o.keychain == keychain {
    best = max(best, Int64(o.derivationIndex))
  }
  return best
}

// MARK: - The module

@objc(TaliaBdkWalletModule)
final class TaliaBdkWalletModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// Every call that touches a wallet, one at a time.
  private let walletQueue = DispatchQueue(label: "com.twentyfirstcapital.talia.bdkwallet", qos: .userInitiated)
  /// The calls that ask a server and touch no wallet: the connection test (`probeServer`) and the
  /// address book's check (`addressActivity`), so neither waits behind a vault's sync.
  private let chainQueue = DispatchQueue(label: "com.twentyfirstcapital.talia.bdkwallet.chain", qos: .userInitiated)
  /// Read and written on walletQueue only.
  private var wallets: [String: WalletState] = [:]

  // MARK: plumbing

  private func run(
    _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock,
    _ body: @escaping () throws -> Any
  ) {
    walletQueue.async {
      do {
        resolve(try body())
      } catch {
        let d = describe(error)
        reject(d.code, d.message, nil)
      }
    }
  }

  /// A call on one wallet: an unknown id rejects; a panic (or the poisoned
  /// lock one left) recreates the wallet before the rejection goes out.
  private func withWallet(
    _ id: String, _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock,
    _ body: @escaping (WalletState) throws -> Any
  ) {
    walletQueue.async {
      guard let state = self.wallets[id] else {
        reject("UNKNOWN_WALLET", "No open wallet has this id", nil)
        return
      }
      do {
        resolve(try body(state))
      } catch {
        if isUniffiInternal(error) || isPoisoned(error) {
          state.recreate()
        }
        let d = describe(error)
        reject(d.code, d.message, nil)
      }
    }
  }

  private struct ServerSettings {
    let url: String
    let retry: UInt8?
    let timeout: UInt8?
    let validate: Bool
    var key: String { "\(url) \(retry.map { String($0) } ?? "-") \(timeout.map { String($0) } ?? "-") \(validate)" }
  }

  private func serverSettings(_ server: NSDictionary) throws -> ServerSettings {
    guard let url = server["url"] as? String, !url.isEmpty else { throw bad("server url is missing") }
    let retry = server["retry"] == nil ? nil : UInt8(try whole(server["retry"], "retry", max: 255))
    let timeout = server["timeout"] == nil ? nil : UInt8(try whole(server["timeout"], "timeout", max: 255))
    let validate = (server["validateDomain"] as? NSNumber)?.boolValue ?? true
    return ServerSettings(url: url, retry: retry, timeout: timeout, validate: validate)
  }

  private func serverClient(_ server: NSDictionary) throws -> ElectrumClient {
    try client(try serverSettings(server))
  }

  /// A connection to the server. One that could not be opened rejects SERVER_UNREACHABLE (decided
  /// 2026-10-30), in the same words as before.
  private func client(_ s: ServerSettings) throws -> ElectrumClient {
    do {
      return try ElectrumClient(url: s.url, socks5: nil, timeout: s.timeout, retry: s.retry, validateDomain: s.validate)
    } catch let e as ElectrumError where neverConnected(e) {
      throw BridgeError(code: "SERVER_UNREACHABLE", message: describe(e).message)
    }
  }

  // MARK: known answer

  /// Resolves { passed, vectors } when every vector gives its address; rejects
  /// KNOWN_ANSWER_FAILED (which vector, no key material) or a library error.
  @objc(knownAnswer:rejecter:)
  func knownAnswer(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    walletQueue.async {
      for (i, v) in KNOWN_ANSWERS.enumerated() {
        let got: String
        do {
          got = try peek(
            descriptor: v.descriptor, change: v.change, network: v.network, keychain: v.keychain,
            index: v.index)
        } catch {
          reject("KNOWN_ANSWER_FAILED", "Vector \(i + 1) could not be derived: \(error)", nil)
          return
        }
        if got != v.address {
          reject("KNOWN_ANSWER_FAILED", "Vector \(i + 1) gave another address", nil)
          return
        }
      }
      resolve(["passed": true, "vectors": KNOWN_ANSWERS.count])
    }
  }

  // MARK: openWallet / closeWallet

  /// A watch-only wallet of the vault's receive descriptor and, when given,
  /// its change descriptor (the engine splits a `<0;1>` one first), on a
  /// network ("bitcoin" | "testnet" = Testnet4 | "signet" | "regtest"), in
  /// memory (nothing stored), lookahead 150. Resolves the wallet's id.
  @objc(openWallet:internal:network:resolver:rejecter:)
  func openWallet(
    _ external: String, internal change: NSString?, network: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      let net = try parseNetwork(network)
      let state = try WalletState(external: external, internalDescriptor: change as String?, network: net)
      let id = UUID().uuidString
      self.wallets[id] = state
      return id
    }
  }

  @objc(closeWallet:resolver:rejecter:)
  func closeWallet(
    _ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      return self.wallets.removeValue(forKey: id) != nil
    }
  }

  // MARK: sync

  /// One sync (rule 1). A fresh in-memory wallet every time,
  /// each keychain revealed up to this session's highest index first;
  /// full_scan(stop gap 150) with the previous sync's coverage as revealed
  /// range on a SCRATCH wallet; then, while a keychain's scan fell short of
  /// the other's last use + 150, a sync of that keychain's scripts up to it
  /// on another scratch wallet. The wallet that replaces the old one reveals
  /// only this session's range and the used indexes found, with a lookahead
  /// covering every scanned window, and takes every update. The connection
  /// of the vault's last good sync to the same server is used again
  /// (`KeptClient`, decided 2026-10-25); a kept one that fails before its
  /// timeout could run out (closed by the server or the network while idle)
  /// gives way to one new connection, and the sync runs once more on it
  /// (nothing of the vault changes before a sync succeeds). A sync on a kept
  /// connection is kept only when the chain its caches were filled from is
  /// still the server's (decided 2026-10-28, `KeptClient`, `SyncOutcome.holds`);
  /// otherwise it runs again on a new connection (`chainMoved`). Resolves
  /// { tipHeight, tipHash, ms, passes, lookahead, reused, chainMoved } (`tipHash`, the tip's
  /// block, since 2026-10-28: the shadow checks asked whether the server's chain moved after this
  /// sync before they read the server's blocks for their height buckets; unread by the app since
  /// the old engine went).
  @objc(sync:server:resolver:rejecter:)
  func sync(
    _ id: String, server: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      let started = Date()
      let settings = try self.serverSettings(server)
      var reused = false
      var client: ElectrumClient
      let kept = state.kept
      if let k = kept, k.key == settings.key, started.timeIntervalSince(k.lastUsed) < KEEP_CLIENT_S {
        client = k.client
        reused = true
      } else {
        client = try self.client(settings)
      }
      // Kept again only once this sync succeeded.
      state.kept = nil
      var outcome: SyncOutcome
      do {
        outcome = try self.syncPasses(state, client)
      } catch let e as ElectrumError
        where reused && !serverAnswered(e) && Date().timeIntervalSince(started) < Double(settings.timeout ?? 30)
      {
        // Failed faster than a timeout: the kept connection was closed, never a silent server
        // (that costs its timeout once, as before). Testnet4's retry is 0, so electrum-client
        // would not reconnect by itself.
        client = try self.client(settings)
        reused = false
        outcome = try self.syncPasses(state, client)
      }
      // The kept client's caches against the chain read now (decided 2026-10-28): a block of
      // its last window must still be the server's, or a cached header of a replaced block may
      // have given a transaction a block that is no longer on the chain. The sync then runs
      // again on a new connection, whose caches hold only what it reads itself.
      var chainMoved = false
      if reused, let k = kept, !(try outcome.holds(k.window)) {
        chainMoved = true
        client = try self.client(settings)
        reused = false
        outcome = try self.syncPasses(state, client)
      }
      let window = try outcome.window()
      self.commit(state, outcome)
      state.kept = KeptClient(key: settings.key, client: client, lastUsed: Date(), window: window)
      return [
        "tipHeight": state.tip,
        "tipHash": outcome.tip.hash.description,
        "passes": outcome.passes,
        "lookahead": outcome.lookahead,
        "ms": Int(Date().timeIntervalSince(started) * 1000),
        "reused": reused,
        "chainMoved": chainMoved,
      ] as [String: Any]
    }
  }

  /// The passes of one sync on `client` (see `sync`). Nothing of `state` changes: the outcome
  /// replaces the vault's wallet only through `commit`, so a failed attempt, or one `sync`
  /// refuses, leaves the vault as it was.
  private func syncPasses(_ state: WalletState, _ client: ElectrumClient) throws -> SyncOutcome {
    let keychains = state.keychains
    let two = keychains.count == 2
    let other: (KeychainKind) -> KeychainKind = { $0 == .external ? .internal : .external }
    // The session's revealed range, carried into the fresh wallet.
    var carried: [KeychainKind: Int64] = [:]
    for k in keychains { carried[k] = state.revealed[k].map { Int64($0) } ?? -1 }
    // Rule 1's target for a keychain, from the other one's last use.
    func target(_ k: KeychainKind, _ used: [KeychainKind: Int64]) -> Int64 {
      guard two else { return COVERAGE_FLOOR }
      return min(MAX_INDEX, max(COVERAGE_FLOOR, (used[other(k)] ?? -1) + Int64(GAP)))
    }

    // Pass 1: the full scan, its revealed range stretched (on the scratch
    // wallet only) so that it already reaches the previous sync's target.
    var scanReveal: [KeychainKind: Int64] = [:]
    for k in keychains {
      scanReveal[k] = max(carried[k] ?? -1, target(k, state.lastUsed) - Int64(GAP))
    }
    let scan = try state.fresh(lookahead: GAP, reveal: scanReveal)
    let fullScan = try client.fullScan(
      request: try scan.startFullScan().build(), stopGap: UInt64(GAP), batchSize: BATCH, fetchPrevTxouts: true)
    try scan.applyUpdate(update: fullScan)
    var used: [KeychainKind: Int64] = [:]
    var covered: [KeychainKind: Int64] = [:]
    for k in keychains {
      used[k] = try lastUsedIndex(scan, k)
      // bdk_electrum 0.24.1 scans the revealed range, then stops 150
      // unused scripts past it or past the last used one.
      let revealedNow = try scan.derivationIndex(keychain: k).map { Int64($0) } ?? -1
      covered[k] = min(MAX_INDEX, max(revealedNow, scanReveal[k] ?? -1) + Int64(GAP))
    }

    // Rule 1: until every keychain reaches its target. A sync that
    // stops short would miss a coin 0.28 finds, which the decision never
    // allows, so it refuses rather than resolve.
    var updates: [Update] = [fullScan]
    var passes = 1
    while true {
      let short = keychains.filter { target($0, used) > (covered[$0] ?? -1) }
      if short.isEmpty { break }
      if passes > MAX_COVERAGE_PASSES {
        throw BridgeError(
          code: "COVERAGE_INCOMPLETE",
          message: "The vault's addresses were not all searched after \(passes) passes.")
      }
      var reveal: [KeychainKind: Int64] = [:]
      for k in short { reveal[k] = target(k, used) }
      let extra = try state.fresh(lookahead: 1, reveal: reveal)
      // The full scan's chain first (decided 2026-10-25): the pass's request then starts from
      // today's tip, which the server's latest headers already hold, instead of from genesis,
      // whose header cost a round trip of its own. Applying the update also reveals each keychain
      // to the last index the full scan found used (bdk_wallet 3.1.0 apply_update,
      // reveal_to_target_multi), so the pass asks again for the OTHER keychain's used scripts,
      // which the scan has just answered (with their transactions as expected txids). It finds a
      // superset, so nothing is lost; those scripts ride in the same batches of 200, and leaving
      // them out would need a single-keychain wallet per pass. Accepted.
      try extra.applyUpdate(update: fullScan)
      let update = try client.sync(
        request: try extra.startSyncWithRevealedSpks().build(), batchSize: BATCH, fetchPrevTxouts: true)
      try extra.applyUpdate(update: update)
      for k in short {
        covered[k] = reveal[k]
        used[k] = max(used[k] ?? -1, try lastUsedIndex(extra, k))
      }
      updates.append(update)
      passes += 1
    }

    // The wallet that replaces the old one.
    var finalReveal: [KeychainKind: Int64] = [:]
    var lookahead = Int64(GAP)
    for k in keychains {
      // Every coin found sits at or below its keychain's last used index,
      // so revealing to it indexes them all; the lookahead then reaches
      // rule 1's window, for isMine and output derivations.
      finalReveal[k] = max(carried[k] ?? -1, used[k] ?? -1)
      lookahead = max(lookahead, target(k, used) - (finalReveal[k] ?? -1))
    }
    let fresh = try state.fresh(lookahead: UInt32(min(lookahead, MAX_INDEX)), reveal: finalReveal)
    for u in updates { try fresh.applyUpdate(update: u) }
    return SyncOutcome(
      wallet: fresh, tip: try fresh.latestCheckpoint(), used: used, passes: passes, lookahead: lookahead)
  }

  /// A sync's outcome becomes the vault's wallet.
  private func commit(_ state: WalletState, _ outcome: SyncOutcome) {
    state.wallet = outcome.wallet
    state.tip = outcome.tip.height
    state.lastUsed = outcome.used
    state.needsSync = false
    state.noteRevealed()
  }


  // MARK: reading

  @objc(balance:resolver:rejecter:)
  func balance(
    _ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      try state.requireSynced()
      let b = try state.wallet.balance()
      return [
        "confirmed": b.confirmed.toSat(),
        "trustedPending": b.trustedPending.toSat(),
        "untrustedPending": b.untrustedPending.toSat(),
        "immature": b.immature.toSat(),
        // Spendable is trusted_spendable; immature stays out of it.
        "spendable": b.trustedSpendable.toSat(),
        "total": b.total.toSat(),
      ] as [String: Any]
    }
  }

  /// The wallet's canonical transactions: txid, sent, received, fee (null
  /// when a spent coin's output is unknown), height, timestamp and the
  /// block's hash (each null while unconfirmed; the hash since 2026-10-28,
  /// for the shadow checks' look at the block against the server's chain,
  /// which went with the old engine; nothing in the app reads it since).
  @objc(transactions:resolver:rejecter:)
  func transactions(
    _ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      try state.requireSynced()
      var out: [[String: Any]] = []
      for t in try state.wallet.transactions() {
        let sr = try state.wallet.sentAndReceived(tx: t.transaction)
        let fee = try? state.wallet.calculateFee(tx: t.transaction)
        var row: [String: Any] = [
          "txid": t.transaction.computeTxid().description,
          "sent": sr.sent.toSat(),
          "received": sr.received.toSat(),
          "fee": fee.map { $0.toSat() as Any } ?? NSNull(),
          "height": NSNull(),
          "timestamp": NSNull(),
          "blockHash": NSNull(),
        ]
        if case .confirmed(let at, _) = t.chainPosition {
          row["height"] = at.blockId.height
          row["timestamp"] = at.confirmationTime
          row["blockHash"] = at.blockId.hash.description
        }
        out.append(row)
      }
      return out
    }
  }

  /// Consensus bytes (hex) of one of the wallet's transactions, or null.
  @objc(rawTransaction:txid:resolver:rejecter:)
  func rawTransaction(
    _ id: String, txid: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      guard txid.count == 64, let t = try? Txid.fromString(hex: txid) else { throw bad("txid is not a txid") }
      try state.requireSynced()
      guard let tx = try state.wallet.getTx(txid: t) else { return NSNull() }
      return hexString(tx.transaction.serialize())
    }
  }

  /// Unspent coins: txid, vout, value, keychain, index and address (null
  /// when the script has no address form).
  @objc(unspent:resolver:rejecter:)
  func unspent(
    _ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      try state.requireSynced()
      return try state.wallet.listUnspent().map { u -> [String: Any] in
        let address = try? Address.fromScript(script: u.txout.scriptPubkey, network: state.network)
        var height: Any = NSNull()
        if case .confirmed(let at, _) = u.chainPosition { height = at.blockId.height }
        return [
          "txid": u.outpoint.txid.description,
          "vout": u.outpoint.vout,
          "value": u.txout.value.toSat(),
          "keychain": keychainName(u.keychain),
          "index": u.derivationIndex,
          "height": height,
          "address": address.map { $0.description as Any } ?? NSNull(),
        ]
      }
    }
  }

  /// An address of `keychain` ("external" | "internal"): `which` is "new"
  /// (reveal the next), "lastUnused" (0.28's rule: the current index while
  /// no transaction pays it, else the next; on a keychain that never revealed
  /// one, index 0, revealed, as 0.28 stored it) or a decimal index (peeked,
  /// 0..2^31-1). Resolves { index, address, keychain }.
  @objc(address:keychain:which:resolver:rejecter:)
  func address(
    _ id: String, keychain: String, which: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      let k = try parseKeychain(keychain)
      let w = state.wallet
      let info: AddressInfo
      switch which {
      case "new":
        try state.requireSynced()
        info = try w.revealNextAddress(keychain: k)
      case "lastUnused":
        try state.requireSynced()
        if let i = try w.derivationIndex(keychain: k) {
          let a = try w.peekAddress(keychain: k, index: i)
          let paid = try w.listOutput().contains { $0.keychain == a.keychain && $0.derivationIndex == i }
          info = paid ? try w.revealNextAddress(keychain: k) : a
        } else {
          // 0.28 stored index 0 here (fetch_index on an empty database
          // increments it), so the next "new" is index 1 (simulator harness, gap_21).
          info = try w.revealNextAddress(keychain: k)
        }
      default:
        guard !which.isEmpty, which.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int64(which), n <= MAX_INDEX else {
          throw bad("which is \"new\", \"lastUnused\" or an index")
        }
        info = try w.peekAddress(keychain: k, index: UInt32(n))
      }
      state.noteRevealed()
      return ["index": info.index, "address": info.address.description, "keychain": keychainName(info.keychain)] as [String: Any]
    }
  }

  /// The highest index revealed on `keychain`, or null (read only: Receive's
  /// search for a coin's address reads it through the engine's `addressReach`,
  /// and the simulator harness; the shadow checks compared it with 0.28's
  /// until the old engine went).
  @objc(derivationIndex:keychain:resolver:rejecter:)
  func derivationIndex(
    _ id: String, keychain: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      let k = try parseKeychain(keychain)
      if k == .internal && state.internalDescriptor == nil { return NSNull() }
      return try state.wallet.derivationIndex(keychain: k).map { $0 as Any } ?? NSNull()
    }
  }

  /// Does the wallet derive this address? An address of another network is
  /// not the wallet's (refused natively by the address parser).
  @objc(isMine:address:resolver:rejecter:)
  func isMine(
    _ id: String, address: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      guard let a = try? Address(address: address.trimmingCharacters(in: .whitespaces), network: state.network) else {
        return false
      }
      // The recreated wallet's lookahead is 150, not the synced window.
      try state.requireSynced()
      return try state.wallet.isMine(script: a.scriptPubkey())
    }
  }

  /// The keychain's policy tree as JSON (`policies(k)?.asString()`), or null.
  /// A vault with no change descriptor answers null for "internal", as 0.28
  /// did (the library would answer with the receive keychain's).
  @objc(policies:keychain:resolver:rejecter:)
  func policies(
    _ id: String, keychain: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      let k = try parseKeychain(keychain)
      if k == .internal && state.internalDescriptor == nil { return NSNull() }
      guard let p = try state.wallet.policies(keychain: k) else { return NSNull() }
      return try p.asString()
    }
  }

  // MARK: build

  private struct BuildSpec {
    var recipients: [(script: Script, sats: UInt64)] = []
    var drainTo: Script?
    var drainWallet = false
    var utxos: [OutPoint] = []
    var manualOnly = false
    var unspendable: [OutPoint] = []
    var kwu: UInt64 = 0
    var rateVb: Double = 0
    var feeAbsolute: UInt64?
    var paths: [KeychainKind: [String: [UInt64]]] = [:]
    var rbf = true
    var csvPath = false
    var version: Int32 = 1
    var currentHeight: UInt32 = 0
    var replacing: [Txid] = []
  }

  private func parsePath(_ v: Any?) throws -> [String: [UInt64]]? {
    guard let d = v as? [String: Any] else { return nil }
    var out: [String: [UInt64]] = [:]
    for (node, list) in d {
      guard let items = list as? [Any] else { throw bad("a policy path is { node: [index] }") }
      out[node] = try items.map { try whole($0, "a policy path index", max: 1_000_000) }
    }
    return out
  }

  private func parseBuild(_ o: NSDictionary, _ state: WalletState) throws -> BuildSpec {
    var s = BuildSpec()
    let address = { (text: Any?) throws -> Script in
      guard let t = text as? String, let a = try? Address(address: t.trimmingCharacters(in: .whitespaces), network: state.network) else {
        throw bad("an address is not one of this network")
      }
      return a.scriptPubkey()
    }
    for r in (o["recipients"] as? [NSDictionary]) ?? [] {
      s.recipients.append((try address(r["address"]), try whole(r["sats"], "an amount")))
    }
    if o["drainTo"] != nil && !(o["drainTo"] is NSNull) { s.drainTo = try address(o["drainTo"]) }
    s.drainWallet = flag(o["drainWallet"])
    s.utxos = try ((o["utxos"] as? [Any]) ?? []).map(parseOutPoint)
    s.manualOnly = flag(o["manualOnly"])
    s.unspendable = try ((o["unspendable"] as? [Any]) ?? []).map(parseOutPoint)
    s.kwu = try whole(o["feeRateSatPerKwu"], "feeRateSatPerKwu", max: 1_000_000_000)
    guard let rate = (o["feeRateSatPerVb"] as? NSNumber)?.doubleValue, rate.isFinite, rate > 0 else {
      throw bad("feeRateSatPerVb is missing")
    }
    s.rateVb = rate
    if let fee = o["feeAbsoluteSats"], !(fee is NSNull) { s.feeAbsolute = try whole(fee, "feeAbsoluteSats") }
    if let paths = o["policyPaths"] as? NSDictionary {
      if let e = try parsePath(paths["external"]) { s.paths[.external] = e }
      if let i = try parsePath(paths["internal"]) { s.paths[.internal] = i }
    }
    s.rbf = (o["rbf"] as? NSNumber)?.boolValue ?? true
    s.csvPath = flag(o["csvPath"])
    s.version = Int32(try whole(o["version"], "version", max: 2))
    s.currentHeight = UInt32(try whole(o["currentHeight"], "currentHeight", max: Double(UInt32.max)))
    s.replacing = try ((o["replacing"] as? [Any]) ?? []).map {
      guard let t = $0 as? String, t.count == 64 else { throw bad("a replaced txid is not a txid") }
      return try Txid.fromString(hex: t)
    }
    if s.recipients.isEmpty && s.drainTo == nil { throw bad("a build pays someone") }
    return s
  }

  /// One TxBuilder run of the spec, with this nSequence (nil: the library's).
  private func finish(_ s: BuildSpec, _ state: WalletState, change: Script, sequence: UInt32?) throws -> Psbt {
    var b = TxBuilder().ordering(ordering: .untouched)
    if !s.replacing.isEmpty { b = b.replacing(txids: s.replacing) }
    if !s.unspendable.isEmpty { b = b.unspendable(unspendable: s.unspendable) }
    if !s.utxos.isEmpty { b = b.addUtxos(outpoints: s.utxos) }
    if s.manualOnly { b = b.manuallySelectedOnly() }
    if let to = s.drainTo {
      if s.drainWallet { b = b.drainWallet() }
      b = b.drainTo(script: to)
    } else {
      for r in s.recipients { b = b.addRecipient(script: r.script, amount: Amount.fromSat(satoshi: r.sats)) }
      b = b.drainTo(script: change)
    }
    // The rate, then the absolute fee: in 3.x the last call wins.
    b = b.feeRate(feeRate: FeeRate.fromSatPerKwu(satKwu: s.kwu))
    if let fee = s.feeAbsolute { b = b.feeAbsolute(feeAmount: Amount.fromSat(satoshi: fee)) }
    for (k, p) in s.paths { b = b.policyPath(policyPath: p, keychain: k) }
    b = b.version(version: s.version)
    b = b.currentHeight(height: s.currentHeight)
    if let seq = sequence { b = b.setExactSequence(nsequence: seq) }
    return try b.finish(wallet: state.wallet)
  }

  /// The post-build checks: a legacy input carries no witness_utxo, so only
  /// segwit inputs must.
  private func postBuildProblems(_ psbt: Psbt, _ s: BuildSpec, _ state: WalletState) -> String? {
    let tx = psbt.extractTxUncheckedFeeRate()
    let txins = tx.input()
    let inputs = psbt.input()
    guard inputs.count == txins.count else { return "the inputs do not match the transaction" }
    for (i, input) in inputs.enumerated() {
      if state.segwit && input.witnessUtxo == nil { return "input \(i) carries no witness_utxo" }
      if !state.taproot {
        guard let parent = input.nonWitnessUtxo else { return "input \(i) carries no non_witness_utxo" }
        if parent.computeTxid() != txins[i].previousOutput.txid { return "input \(i)'s non_witness_utxo is another transaction" }
      }
      if input.bip32Derivation.isEmpty && input.tapKeyOrigins.isEmpty { return "input \(i) carries no derivation of a vault key" }
    }
    if txins.contains(where: { $0.sequence & 0x8000_0000 == 0 }) && tx.version() < 2 {
      return "a relative timelock in a version 1 transaction"
    }
    if tx.lockTime() != 0 && txins.allSatisfy({ $0.sequence == 0xFFFF_FFFF }) {
      return "nLockTime is set but every input is final"
    }
    if s.rbf && !s.csvPath && txins.contains(where: { $0.sequence != 0xFFFF_FFFD }) {
      return "an RBF payment whose inputs do not all signal it"
    }
    // RBF off (a rescue, an heir's spend): every input final for RBF
    // (0xFFFFFFFE or 0xFFFFFFFF) or carrying a BIP-68 wait (bit 31 clear).
    if !s.rbf && txins.contains(where: { $0.sequence < 0xFFFF_FFFE && $0.sequence & 0x8000_0000 != 0 }) {
      return "a payment without RBF whose inputs signal it"
    }
    return nil
  }

  /// Rule 2's floor: ceil(rate x vsize) of the largest transaction these
  /// coins can finalize into (every input at its descriptor's largest
  /// satisfaction, the segwit marker and flag, a witness count per input).
  private func feeFloor(_ psbt: Psbt, _ s: BuildSpec, _ state: WalletState) -> UInt64 {
    let tx = psbt.extractTxUncheckedFeeRate()
    let n = UInt64(tx.input().count)
    var weight = tx.weight() + n * state.maxSatisfaction
    if state.segwit { weight += 2 + n }
    return feeAt(rateVb: s.rateVb, vbytes: (weight + 3) / 4)
  }

  /// A build: resolves { psbt, txid, fee, floorApplied, reordered }.
  /// The engine passes the version and whether the chosen path carries a CSV;
  /// the bridge chooses nSequence, names a wallet drain's
  /// coins in 0.28's order (rule 3), holds a rate-mode fee to its floor
  /// (rule 2), runs the post-build checks, and reveals the change index it
  /// peeked only once the build succeeded.
  @objc(build:options:resolver:rejecter:)
  func build(
    _ id: String, options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      try state.requireSynced()
      var s = try self.parseBuild(options, state)
      let changeKeychain: KeychainKind = state.internalDescriptor == nil ? .external : .internal
      let next = try state.wallet.nextDerivationIndex(keychain: changeKeychain)
      let change = try state.wallet.peekAddress(keychain: changeKeychain, index: next).address.scriptPubkey()

      // nSequence: the library's own with RBF on
      // or on a CSV path; otherwise 0xFFFFFFFE whenever nLockTime is not 0
      // (always at a known tip, and on an after() path at tip 0), 0xFFFFFFFF
      // only when it is 0.
      var sequence: UInt32? = (s.rbf || s.csvPath) ? nil : 0xFFFF_FFFE
      var psbt = try self.finish(s, state, change: change, sequence: sequence)
      if !s.rbf && sequence == nil
        && psbt.extractTxUncheckedFeeRate().input().contains(where: { $0.sequence == 0xFFFF_FFFD })
      {
        // The engine read an older() on the chosen path, but the library
        // found no CSV to write (it then signals RBF with 0xFFFFFFFD on every
        // input): the transaction decides, with 0.28's rule for a path
        // without one.
        sequence = 0xFFFF_FFFE
        psbt = try self.finish(s, state, change: change, sequence: sequence)
      }
      if sequence == 0xFFFF_FFFE && s.currentHeight == 0 && psbt.extractTxUncheckedFeeRate().lockTime() == 0 {
        sequence = 0xFFFF_FFFF
        psbt = try self.finish(s, state, change: change, sequence: sequence)
      }

      // Rule 3: a wallet drain names its coins in 0.28's order.
      var reordered = false
      if s.drainWallet && s.utxos.isEmpty {
        let coins = psbt.extractTxUncheckedFeeRate().input().map { $0.previousOutput }
        let ordered = coins.sorted { lexLess(dbOrderKey($0), dbOrderKey($1)) }
        let same = zip(coins, ordered).allSatisfy { $0.txid == $1.txid && $0.vout == $1.vout }
        if !same {
          var named = s
          named.utxos = ordered
          named.manualOnly = true
          psbt = try self.finish(named, state, change: change, sequence: sequence)
          s = named
          reordered = true
        }
      }

      // Rule 2: never below ceil(rate x vsize).
      var floorApplied = false
      if s.feeAbsolute == nil {
        let floor = self.feeFloor(psbt, s, state)
        if let fee = try? psbt.fee(), fee < floor {
          var fixed = s
          fixed.utxos = psbt.extractTxUncheckedFeeRate().input().map { $0.previousOutput }
          fixed.manualOnly = true
          fixed.feeAbsolute = floor
          psbt = try self.finish(fixed, state, change: change, sequence: sequence)
          floorApplied = true
          if let paid = try? psbt.fee(), paid < floor {
            throw BridgeError(code: "POST_BUILD_CHECK", message: "The payment pays less than its fee rate")
          }
        }
      }

      if let problem = self.postBuildProblems(psbt, s, state) {
        throw BridgeError(code: "POST_BUILD_CHECK", message: "The payment was not built safely: \(problem)")
      }
      // Only now: the change index this build used moves on.
      if s.drainTo == nil {
        _ = try state.wallet.revealAddressesTo(keychain: changeKeychain, index: next)
        state.noteRevealed()
      }
      return [
        "psbt": psbt.serialize(),
        "txid": psbt.extractTxUncheckedFeeRate().computeTxid().description,
        "fee": (try? psbt.fee()).map { $0 as Any } ?? NSNull(),
        "floorApplied": floorApplied,
        "reordered": reordered,
      ] as [String: Any]
    }
  }

  // MARK: PSBTs

  /// { psbt, txid, fee|null } of a PSBT: txid of the transaction it extracts
  /// to now (its unsigned one until finalized, as 0.28's `txid()`).
  @objc(psbtInfo:resolver:rejecter:)
  func psbtInfo(
    _ psbt: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      let p = try Psbt(psbtBase64: psbt)
      return [
        "psbt": p.serialize(),
        "txid": p.extractTxUncheckedFeeRate().computeTxid().description,
        "fee": (try? p.fee()).map { $0 as Any } ?? NSNull(),
      ] as [String: Any]
    }
  }

  /// original.combine(signed), in that order, then the combine repair: the
  /// vault's own key origins re-derived (bitcoin's combine lets the second
  /// copy's derivations win). Resolves the combined PSBT.
  @objc(combine:original:signedPsbt:resolver:rejecter:)
  func combine(
    _ id: String, original: String, signedPsbt signed: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      let o = try Psbt(psbtBase64: original)
      let s = try Psbt(psbtBase64: signed)
      let combined = try o.combine(other: s)
      try state.wallet.updatePsbtWithDescriptor(psbt: combined)
      return combined.serialize()
    }
  }

  /// The library's finalizer the way 0.28's watch-only sign() ran it
  /// (finalize_psbt_keeping_metadata): resolves { psbt, finalized,
  /// error }. The leaf hazard's fix is in this library call.
  @objc(finalize:psbt:resolver:rejecter:)
  func finalize(
    _ id: String, psbt: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      // The finalizer reads the wallet's tip for older() and after().
      try state.requireSynced()
      let p = try Psbt(psbtBase64: psbt)
      do {
        let done = try state.wallet.finalizePsbtKeepingMetadata(psbt: p, signOptions: nil)
        return ["psbt": p.serialize(), "finalized": done, "error": NSNull()] as [String: Any]
      } catch {
        if isUniffiInternal(error) || isPoisoned(error) { throw error }
        // A refusal hands the copy back exactly as it came, as 0.28's sign()
        // did (the old engine kept its own copy when sign() threw). The fork
        // wrote the descriptor's metadata into `p` before its gates refused
        // (MissingNonWitnessUtxo) until the fork's fix (decided 2026-10-17: the copy is
        // written back only on success); this stays as a second guard, and
        // every input that did not finalize is kept byte for byte.
        let untouched = try Psbt(psbtBase64: psbt)
        return ["psbt": untouched.serialize(), "finalized": false, "error": error.localizedDescription] as [String: Any]
      }
    }
  }

  /// The transaction a PSBT extracts to, hex (the fee rate unchecked here;
  /// the engine's own ceiling applies to builds).
  @objc(extract:resolver:rejecter:)
  func extract(
    _ psbt: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      hexString(try Psbt(psbtBase64: psbt).extractTxUncheckedFeeRate().serialize())
    }
  }

  // MARK: the network

  /// Broadcast a transaction (hex) through a short-lived client; resolves its
  /// txid. The server's refusal text is kept in the message.
  @objc(broadcast:transaction:resolver:rejecter:)
  func broadcast(
    _ server: NSDictionary, transaction: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      guard let bytes = hexBytes(transaction) else { throw bad("the transaction is not hex") }
      let tx = try Transaction(transactionBytes: bytes)
      let client = try self.serverClient(server)
      // The id of what went out, not the one the server typed back.
      let txid = tx.computeTxid().description
      _ = try client.transactionBroadcast(tx: tx)
      return txid
    }
  }

  /// A strict decode of a transaction (hex): resolves { txid }.
  @objc(parseTransaction:resolver:rejecter:)
  func parseTransaction(
    _ transaction: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    run(resolve, reject) {
      guard let bytes = hexBytes(transaction) else { throw bad("the transaction is not hex") }
      return ["txid": try Transaction(transactionBytes: bytes).computeTxid().description]
    }
  }

  /// The server's blocks at `heights` NOW, read from the server itself and never from a cache:
  /// for each height { height, hash, time }, or null where the server gave none (a height above
  /// its tip). Made for the shadow checks, which asked whether the block each engine reported
  /// for a transaction was still on the chain (decided 2026-10-28); nothing in the app calls it
  /// since the old engine went, and the call stays until a change to the bridge of its own; at most
  /// SERVER_BLOCKS_MAX heights. Asks through the
  /// vault's kept connection when it is to the same server and still kept, else through a
  /// short-lived one; a connection that fails rejects the call.
  @objc(serverBlocks:server:heights:resolver:rejecter:)
  func serverBlocks(
    _ id: String, server: NSDictionary, heights: NSArray,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    withWallet(id, resolve, reject) { state in
      let settings = try self.serverSettings(server)
      guard heights.count <= SERVER_BLOCKS_MAX else { throw bad("at most \(SERVER_BLOCKS_MAX) heights") }
      let wanted = try heights.map { UInt64(try whole($0, "height", max: Double(MAX_INDEX))) }
      let client: ElectrumClient
      if let k = state.kept, k.key == settings.key, Date().timeIntervalSince(k.lastUsed) < KEEP_CLIENT_S {
        client = k.client
      } else {
        client = try self.client(settings)
      }
      // The tip first: a height above it has no block, and asking for one is an error.
      let tip = UInt64(try client.blockHeadersSubscribe().height)
      return try wanted.map { h -> Any in
        guard h <= tip else { return NSNull() }
        let header = try client.blockHeader(height: h)
        return ["height": h, "hash": try headerHash(header).description, "time": header.time] as [String: Any]
      }
    }
  }

  /// What the server knows about one address (the address book's check, decided 2026-11-05).
  /// Facts only: whether the address has spent is the wallet layer's rule
  /// (wallet/addressBookCheck.ts), and the server is the one handed in (wallet/chainServers.ts
  /// chose it). On chainQueue like the connection test, so it never waits behind a sync, through a
  /// short-lived client of its own, and a connection that could not be opened rejects
  /// SERVER_UNREACHABLE as a sync or a broadcast does. network: "bitcoin" | "testnet" (Testnet4) |
  /// "signet" | "regtest"; an address of another network is refused before anything is asked.
  /// The history comes first. With at most ADDRESS_ACTIVITY_WHOLE_MAX entries its transactions are
  /// fetched whole in ONE batch on the same client, and it resolves
  /// { kind: "txs", txs: [{ txid, height, spends: ["<txid>:<vout>" of every input],
  /// pays: [the vout of every output paying the address] }] } in the history's order; with more,
  /// the coins the address holds are asked after the history, and it resolves
  /// { kind: "long", history: [{ txid, height }], unspent: [{ txid, vout, height }] }.
  /// So it is three round trips at most (the connection, the history, then the transactions or
  /// the coins), and the last is asked only within ADDRESS_ACTIVITY_LAST_ASK_S.
  /// Heights are Electrum's: the block's once confirmed; in the mempool 0, or -1 for a
  /// transaction spending an unconfirmed coin, and 0 for an unspent coin.
  @objc(addressActivity:network:address:resolver:rejecter:)
  func addressActivity(
    _ server: NSDictionary, network: String, address: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    chainQueue.async {
      let started = ProcessInfo.processInfo.systemUptime
      do {
        let net = try parseNetwork(network)
        guard let a = try? Address(address: address.trimmingCharacters(in: .whitespaces), network: net) else {
          throw bad("the address is not one of this network")
        }
        let script = a.scriptPubkey()
        let client = try self.serverClient(server)
        let history = try client.scriptGetHistory(script: script)
        if !history.isEmpty && ProcessInfo.processInfo.systemUptime - started > ADDRESS_ACTIVITY_LAST_ASK_S {
          throw BridgeError(code: "OTHER", message: "The server took too long to answer about this address")
        }
        if history.count > ADDRESS_ACTIVITY_WHOLE_MAX {
          let unspent = try client.scriptListUnspent(script: script)
          resolve([
            "kind": "long",
            "history": history.map { h -> [String: Any] in ["txid": h.txid.description, "height": h.height] },
            "unspent": unspent.map { u -> [String: Any] in ["txid": u.txid.description, "vout": u.vout, "height": u.height] },
          ] as [String: Any])
          return
        }
        let fetched = try client.batchTransactionGet(txids: history.map { $0.txid })
        guard fetched.count == history.count else {
          throw BridgeError(code: "OTHER", message: "The server answered \(fetched.count) of \(history.count) transactions")
        }
        let paid = script.toBytes()
        var txs: [[String: Any]] = []
        for (h, tx) in zip(history, fetched) {
          // A transaction other than the one asked for is no fact about this address.
          guard tx.computeTxid() == h.txid else {
            throw BridgeError(code: "OTHER", message: "The server answered another transaction for \(h.txid.description)")
          }
          let spends = tx.input().map { i -> String in "\(i.previousOutput.txid.description):\(i.previousOutput.vout)" }
          var pays: [UInt32] = []
          for (vout, o) in tx.output().enumerated() where o.scriptPubkey.toBytes() == paid {
            pays.append(UInt32(vout))
          }
          txs.append(["txid": h.txid.description, "height": h.height, "spends": spends, "pays": pays])
        }
        resolve(["kind": "txs", "txs": txs] as [String: Any])
      } catch {
        // The codes of a sync or a broadcast, never the connection test's: a connection that could
        // not be opened keeps its SERVER_UNREACHABLE mark.
        let d = describe(error)
        reject(d.code, d.message, nil)
      }
    }
  }

  /// The connection test (Settings and Diagnostics, through the engine
  /// provider): connect and read the tip. Resolves { height }.
  @objc(probeServer:resolver:rejecter:)
  func probeServer(
    _ server: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    chainQueue.async {
      do {
        let client = try self.serverClient(server)
        resolve(["height": try client.blockHeadersSubscribe().height])
      } catch {
        let d = describe(error)
        // The connection test answers as the contract recording holds it (bdkWalletBridgeCalls.json,
        // never edited): nothing decides on its code, Settings and Diagnostics show its words.
        reject(d.code == "SERVER_UNREACHABLE" ? "OTHER" : d.code, d.message, nil)
      }
    }
  }

  #if DEBUG
  /// DEBUG builds only: the address at `index` of a public descriptor's
  /// keychain ("external" | "internal"), peeked. network: "bitcoin" | "testnet"
  /// (Testnet4) | "signet" | "regtest".
  @objc(peekAddress:network:keychain:index:resolver:rejecter:)
  func peekAddress(
    _ descriptor: String, network: String, keychain: String, index: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let nets: [String: Network] = ["bitcoin": .bitcoin, "testnet": .testnet4, "signet": .signet, "regtest": .regtest]
    let keychains: [String: KeychainKind] = ["external": .external, "internal": .internal]
    guard let net = nets[network], let kc = keychains[keychain], index.int64Value >= 0,
      index.int64Value < (1 << 31)
    else {
      reject("BAD_ARGUMENT", "network, keychain or index is not one this call takes", nil)
      return
    }
    walletQueue.async {
      do {
        resolve(try peek(descriptor: descriptor, change: nil, network: net, keychain: kc, index: index.uint32Value))
      } catch {
        reject("BDKWALLET_ERROR", "\(error)", nil)
      }
    }
  }
  #endif
}
