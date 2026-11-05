//! Writes a Liana wallet backup (plain JSON) and a Liana labels export
//! (BIP-329 JSONL) for `src/bitcoin/descriptor/__tests__/lianaBackup.test.ts`.
//!
//! The types below are copied from `liana-gui/src/backup.rs` at Liana's v16.0
//! tag, serde attributes and all, and `main` fills them the way
//! `Backup::from_app` does there: the wallet's name is `wallet_name` of the
//! descriptor ("Liana-" and its checksum), the alias is the name the owner
//! typed, each key carries what `KeySetting::to_backup` writes (its
//! fingerprint and alias), the labels come whole from the BIP-329 library
//! Liana pins, the account carries Liana's version in its proprietary map,
//! and the file is written with `serde_json::to_string_pretty`, as
//! `export.rs` writes it. The labels file is `Labels::export`, which is what
//! Liana's "Export labels" writes. Both are read back before anything is
//! written: the backup into the same types, the labels with the library's
//! own reader.
//!
//! The vault is the one `src/wallet/__tests__/bip138Backup.test.ts` uses:
//! testnet keys derived from the seeds of BIP-32 test vectors 1, 2 and 3 at
//! m/48'/1'/0'/2', so no real device's key is in it. The transaction ids
//! are made up, the address is BIP-173's own testnet example, and every
//! value is fixed, so the files come out the same on every run.
//!
//! Usage: cargo run --release -- <backup.json> <labels.jsonl>

use std::{collections::BTreeMap, env, fs, process, str::FromStr};

use bip329::{AddressRecord, Label, Labels, OutputRecord, TransactionRecord};
use bitcoin::{address::NetworkUnchecked, bip32::Fingerprint, Address, Network, OutPoint, Txid};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The test file's VAULT_DESCRIPTOR (change both together).
const VAULT_DESCRIPTOR: &str = "tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*),older(65535))})#ffpaesuq";

/// Made-up transaction ids: nothing on any chain.
const TX_PAID_IN: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const TX_PAID_OUT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const TX_NO_LABEL: &str = "3333333333333333333333333333333333333333333333333333333333333333";
/// BIP-173's testnet P2WPKH example address.
const EXAMPLE_ADDRESS: &str = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

// ---- Copied from liana-gui/src/backup.rs at v16.0 ---------------------------

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Backup {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    pub accounts: Vec<Account>,
    pub network: Network,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<u64>,
    /// App proprietary metadata (settings, configuration, etc..)
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub proprietary: serde_json::Map<String, serde_json::Value>,
    #[serde(default = "default_version")]
    pub version: u32,
    /// True when synthesized from a bare descriptor rather than read from a backup file.
    #[serde(skip)]
    pub descriptor_only: bool,
}

fn default_version() -> u32 {
    0
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Account {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub descriptor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receive_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub keys: BTreeMap<Fingerprint, Key>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<bip329::Labels>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transactions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub psbts: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub coins: BTreeMap<String, Coin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chain_tip: Option<ChainTip>,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub proprietary: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ChainTip {
    pub block_height: i32,
    pub block_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Coin {
    amount: u64,
    outpoint: String,
    address: String,
    block_height: Option<i32>,
    account: u32,
    derivation_index: u32,
    is_coinbase: Option<bool>,
    is_from_self: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Key {
    pub key: Fingerprint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<KeyRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_type: Option<KeyType>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub proprietary: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum KeyRole {
    Main,
    Recovery,
    Inheritance,
    Cosigning,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum KeyType {
    Internal,
    External,
    ThirdParty,
}

// ---- Copied from liana-gui/src/app/wallet.rs at v16.0 -----------------------

fn wallet_name(desc: &str) -> String {
    let checksum = desc
        .split_once('#')
        .map(|(_, checksum)| checksum)
        .unwrap_or("");
    format!(
        "{}{}{}",
        "Liana",
        if checksum.is_empty() { "" } else { "-" },
        checksum
    )
}

// ----------------------------------------------------------------------------

fn fail(message: &str) -> ! {
    eprintln!("liana-wallet-backup-fixture: {message}");
    process::exit(1);
}

fn txid(hex: &str) -> Txid {
    Txid::from_str(hex).unwrap_or_else(|_| fail("bad txid"))
}

fn labels() -> Labels {
    let address: Address<NetworkUnchecked> =
        EXAMPLE_ADDRESS.parse().unwrap_or_else(|_| fail("bad address"));
    Labels::new(vec![
        Label::Transaction(TransactionRecord {
            ref_: txid(TX_PAID_IN),
            label: Some("Salary November".into()),
            origin: None,
        }),
        Label::Transaction(TransactionRecord {
            ref_: txid(TX_PAID_OUT),
            label: Some("Rent".into()),
            origin: None,
        }),
        // A record with no label, which BIP-329 allows.
        Label::Transaction(TransactionRecord {
            ref_: txid(TX_NO_LABEL),
            label: None,
            origin: None,
        }),
        Label::Address(AddressRecord {
            ref_: address,
            label: Some("Shop address".into()),
        }),
        Label::Output(OutputRecord {
            ref_: OutPoint { txid: txid(TX_PAID_IN), vout: 0 },
            label: Some("Salary coin".into()),
            spendable: None,
        }),
    ])
}

fn key(fingerprint: &str, alias: &str) -> (Fingerprint, Key) {
    let fp = Fingerprint::from_str(fingerprint).unwrap_or_else(|_| fail("bad fingerprint"));
    (
        fp,
        Key {
            key: fp,
            alias: Some(alias.into()),
            role: None,
            key_type: None,
            proprietary: Value::Null,
        },
    )
}

fn backup() -> Backup {
    let mut proprietary = serde_json::Map::new();
    proprietary.insert("liana_version".into(), "16.0".into());
    let name = wallet_name(VAULT_DESCRIPTOR);
    let account = Account {
        name: Some(name.clone()),
        descriptor: VAULT_DESCRIPTOR.into(),
        receive_index: Some(2),
        change_index: Some(1),
        timestamp: Some(1_793_836_800),
        keys: [
            key("3442193e", "Ledger test"),
            key("bd16bee5", "BitBox test"),
            key("41d63b50", "Recovery test"),
        ]
        .into_iter()
        .collect(),
        labels: Some(labels()),
        transactions: Vec::new(),
        psbts: Vec::new(),
        coins: BTreeMap::new(),
        chain_tip: Some(ChainTip { block_height: 120_000, block_hash: None }),
        proprietary,
    };
    Backup {
        name: Some(name),
        alias: Some("Savings test".into()),
        accounts: vec![account],
        network: Network::Testnet4,
        proprietary: serde_json::Map::new(),
        date: Some(1_793_836_800),
        version: 0,
        descriptor_only: false,
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let [backup_path, labels_path] = args.as_slice() else {
        fail("usage: <backup.json> <labels.jsonl>");
    };

    let backup = backup();
    let json = serde_json::to_string_pretty(&backup).unwrap_or_else(|_| fail("backup to JSON"));
    let read: Backup = serde_json::from_str(&json).unwrap_or_else(|_| fail("backup does not read back"));
    if read != backup {
        fail("backup reads back different");
    }

    let jsonl = labels().export().unwrap_or_else(|_| fail("labels to JSONL"));
    let read = Labels::try_from_str(&jsonl).unwrap_or_else(|_| fail("labels do not read back"));
    if read != labels() {
        fail("labels read back different");
    }

    fs::write(backup_path, json).unwrap_or_else(|_| fail("write backup"));
    fs::write(labels_path, jsonl).unwrap_or_else(|_| fail("write labels"));
}
