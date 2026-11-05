Pod::Spec.new do |s|
  s.name         = "TaliaBdkWallet"
  s.version      = "3.1.1"
  s.summary      = "Talia's wallet library: a fork of bdk-ffi 3.1.1 behind Talia's own bridge"
  s.homepage     = "https://github.com/21st-Capital/talia"
  # The bridge is Apache-2.0, the app's licence. The generated Swift and the
  # library come from talia-bdk-ffi (https://github.com/21st-Capital/talia-bdk-ffi),
  # which is MIT OR Apache-2.0, taken here under Apache-2.0.
  s.license      = { :type => "Apache-2.0" }
  s.author       = "21st Capital"
  s.platform     = :ios, "15.0"
  s.source       = { :path => "." }
  # BitcoinDevKit.swift is the fork's generated Swift (uniffi 0.31.2), written
  # by native/build-bdkwallet.sh with ffi/BitcoinDevKitFFI.h; bridge/ is
  # Talia's React Native module over it (BDK upgrade, decided 2026-10-15: the
  # new bridge). Everything here compiles into this pod's own
  # Swift module; until the old library's TaliaBdk pod was removed
  # (decided 2026-11-04) that kept its types from meeting the old generated
  # Swift, which used the same names.
  s.source_files = "BitcoinDevKit.swift", "bridge/*.{m,swift}"
  # The fork's static library, linked IN PLACE: the file pinned in
  # native/native-libs.sha256 is the file the app links, with no copy in
  # between (scripts/archive-provenance.js reads this podspec as data and
  # refuses anything else). Only the device library is named; a simulator build puts a
  # folder holding a copy of lib/libbdkwallet-sim.a, named
  # libbdkwallet-ios.a, first on LIBRARY_SEARCH_PATHS (scripts/ios-sim.sh).
  s.vendored_libraries = "lib/libbdkwallet-ios.a"
  # The C layer reaches Swift as its own clang module (BitcoinDevKitFFI): the
  # hand-written ffi/module.modulemap wraps the generated header, and
  # canImport(BitcoinDevKitFFI) in BitcoinDevKit.swift then resolves. The
  # modulemap uniffi writes is never copied (it would name other modules).
  s.preserve_paths = "ffi/**"
  s.pod_target_xcconfig = {
    "SWIFT_INCLUDE_PATHS" => "$(PODS_TARGET_SRCROOT)/ffi",
  }
  s.dependency "React-Core"
end
