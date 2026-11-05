# liana-bip138-fixture

Writes `src/wallet/__tests__/__fixtures__/liana_test_vault.bip138` and
`liana_test_vault_paths.bip138`, the encrypted descriptor backups that
`src/wallet/__tests__/bip138Backup.test.ts` opens to prove Talia reads what
Liana v16 writes. The files come from the `bip138` crate 0.2.0, the library
Liana v16.0 writes its `.bip138` backups with, at the version and features
Liana pins, called the way `export_encrypted_descriptor` in Liana's
`liana-gui/src/export.rs` calls it at v16.0. `Cargo.lock` holds every
dependency at the version and checksum Liana v16.0's own `Cargo.lock`
resolves.

The vault is the test file's `VAULT_DESCRIPTOR`, copied into `src/main.rs`
(change both together): a testnet taproot vault whose keys are derived from
the seeds of BIP-32 test vectors 1, 2 and 3 at m/48'/1'/0'/2', so no real
device's key is in it. Its internal key is the unspendable key Liana derives
from those keys, so Liana accepts the vault as its own. The program checks both
before it writes anything.

From the repository root (Rust and network access needed; the build stays out
of the repository):

```sh
cargo run --release --locked --manifest-path scripts/liana-bip138-fixture/Cargo.toml \
  --target-dir "${TMPDIR:-/tmp}/liana-bip138-fixture" -- \
  src/wallet/__tests__/__fixtures__/liana_test_vault.bip138
cargo run --release --locked --manifest-path scripts/liana-bip138-fixture/Cargo.toml \
  --target-dir "${TMPDIR:-/tmp}/liana-bip138-fixture" -- \
  src/wallet/__tests__/__fixtures__/liana_test_vault_paths.bip138 --store-common-paths
```

The first is Liana's default export, which leaves out derivation paths every
reader tries anyway (here all of them); the second stores those paths too, as
Liana's export can. Each run draws a new nonce and new decoy slots, so the
bytes change; the tests read the files, not their bytes.
