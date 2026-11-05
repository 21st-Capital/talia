# liana-wallet-backup-fixture

Writes `src/bitcoin/descriptor/__tests__/__fixtures__/liana_test_wallet_backup.json`
and `liana_test_labels.jsonl`, the two plain files `lianaBackup.test.ts` reads to
prove Talia reads what Liana v16 writes:

- the **wallet backup** Liana saves as `liana-backup-<date>.json`, which holds
  the descriptor with the wallet's name and alias, the name of each key and the
  wallet's BIP-329 labels, and
- the **labels export** Liana saves as `liana-labels-<date>.jsonl`, the same
  labels as BIP-329 JSONL, one record per line.

The backup's types are copied from `liana-gui/src/backup.rs` at Liana's v16.0
tag, serde attributes and all, and filled the way `Backup::from_app` fills them;
the labels come from the BIP-329 library at the commit Liana v16.0 pins.
`Cargo.lock` holds every dependency at the version and checksum Liana v16.0's own
`Cargo.lock` resolves. Every value is fixed, so a run writes the same bytes.

The vault is the one the encrypted backup fixtures use: a testnet taproot vault
whose keys come from the seeds of BIP-32 test vectors 1, 2 and 3 at
m/48'/1'/0'/2', so no real device's key is in it. The transaction ids are made
up and the address is BIP-173's own testnet example.

From the repository root (Rust and network access needed; the build stays out
of the repository):

```sh
cargo run --release --locked --manifest-path scripts/liana-wallet-backup-fixture/Cargo.toml \
  --target-dir "${TMPDIR:-/tmp}/liana-wallet-backup-fixture" -- \
  src/bitcoin/descriptor/__tests__/__fixtures__/liana_test_wallet_backup.json \
  src/bitcoin/descriptor/__tests__/__fixtures__/liana_test_labels.jsonl
```
