# liana-bed-fixture

Writes `src/wallet/__tests__/__fixtures__/liana_test_vault.bed`, the encrypted
descriptor backup that `src/wallet/__tests__/encryptedBackup.test.ts` opens to
prove Talia reads what Liana writes. The file comes from
`bitcoin-encrypted-backup` 0.0.2, the library Liana wrote its `.bed` backups
with up to v15.0 (Liana v16 writes `.bip138` files, which Talia reads too; see
`scripts/liana-bip138-fixture/`), at the version and features Liana pinned,
called the way `export_encrypted_descriptor` in Liana's
`liana-gui/src/export.rs` called it at v15.0. `Cargo.lock` holds every dependency at the version Liana v15.0's own
`Cargo.lock` resolves. The vault is the test file's `VAULT_DESCRIPTOR`, copied
into `src/main.rs` (change both together): a test vault of made-up keys
derived from the seeds of BIP-32 test vectors 1, 2 and 3 at m/48'/1'/0'/2'
(the vault of the `.bip138` fixtures), so no real device's key is in it. Its
internal key is the unspendable key Liana derives from those three keys, so
Liana accepts the vault as its own.

From the repository root (Rust and network access needed; the build stays out
of the repository):

```sh
cargo run --release --manifest-path scripts/liana-bed-fixture/Cargo.toml \
  --target-dir "${TMPDIR:-/tmp}/liana-bed-fixture" -- \
  src/wallet/__tests__/__fixtures__/liana_test_vault.bed
```

A second argument seals another descriptor instead. Each run draws a new
nonce, so the bytes change; the tests read the file, not its bytes.
