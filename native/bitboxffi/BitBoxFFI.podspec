Pod::Spec.new do |s|
  s.name         = "BitBoxFFI"
  s.version      = "0.1.0"
  s.summary      = "Talia's BitBox02 Nova protocol layer: bitbox-api (Rust) over uniffi"
  s.homepage     = "https://github.com/21st-Capital/talia"
  # The bridge and the generated Swift are Apache-2.0, as is the library built
  # from talia-bitbox-ffi (https://github.com/21st-Capital/talia-bitbox-ffi).
  s.license      = { :type => "Apache-2.0" }
  s.author       = "21st Capital"
  s.platform     = :ios, "15.0"
  s.source       = { :path => "." }
  s.source_files = "bitbox.swift", "BitboxModule.swift", "BitboxModule.m"
  s.vendored_libraries = "lib/libbitboxffi-ios.a"
  # The C FFI layer reaches Swift as its own clang module: ffi/module.modulemap
  # wraps the uniffi-generated header, and canImport(bitboxFFI) in the
  # generated Swift then resolves. The name module.modulemap in a directory on
  # SWIFT_INCLUDE_PATHS is the one layout Swift discovers on its own.
  s.preserve_paths = "ffi/**"
  s.pod_target_xcconfig = {
    "SWIFT_INCLUDE_PATHS" => "$(PODS_TARGET_SRCROOT)/ffi",
    "OTHER_LDFLAGS" => "-lbitboxffi",
    "LIBRARY_SEARCH_PATHS" => "$(PODS_TARGET_SRCROOT)/lib",
  }
  s.dependency "React-Core"
end
