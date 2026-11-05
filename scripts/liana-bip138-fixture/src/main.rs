//! Writes an encrypted descriptor backup (.bip138) the way Liana's GUI exports
//! one, for the cross check in `src/wallet/__tests__/bip138Backup.test.ts`.
//!
//! `export` follows `export_encrypted_descriptor` in `liana-gui/src/export.rs`
//! at Liana's v16.0 tag, the first release that writes `.bip138` files: the
//! parsed descriptor goes whole to `EncryptedBackup::set_payload`, which takes
//! the encryption keys and their origin derivation paths from it,
//! `set_store_common_paths` carries the export's choice to also store the
//! derivation paths every reader tries anyway, and the file is checked to open
//! with every spendable key (giving the descriptor back as its only item) and
//! to stay shut for the vault's unspendable internal key and the BIP341 NUMS
//! point. Only the progress messages and the async file writing are left out.
//!
//! Liana parses the descriptor as a `LianaDescriptor`: the miniscript
//! descriptor (`Descriptor::from_str` and `sanity_check`, as here) plus a check
//! that it is a Liana spending policy, which the bytes do not depend on.
//!
//! The vault's keys are derived from the seeds BIP-32 publishes as its test
//! vectors 1, 2 and 3, and its internal key is the unspendable key Liana
//! derives for a taproot vault; `check_vault` proves both before anything is
//! written, so the fixture holds no key of any real device.
//!
//! Usage: cargo run --release -- <out.bip138> [--store-common-paths]

use std::{env, fs, process, str::FromStr};

use bip138::{
    descriptor::{dpk_to_root_pk, BIP341_NUMS},
    Decrypted, EncryptedBackup, EncryptedMetadata,
};
use miniscript::{
    bitcoin::{
        bip32::{ChainCode, ChildNumber, DerivationPath, Xpriv, Xpub},
        hashes::{sha256, Hash},
        secp256k1::{PublicKey, Secp256k1},
        NetworkKind,
    },
    descriptor::Tr,
    Descriptor, DescriptorPublicKey, ForEachKey,
};

/// The vault of `bip138Backup.test.ts` (`VAULT_DESCRIPTOR`): a testnet taproot
/// vault in Liana's shape, two of the first two keys at any time or the third
/// key alone after 65535 blocks. Its keys are those of BIP-32 test vectors 1, 2
/// and 3 at m/48'/1'/0'/2', and its internal key is the unspendable key Liana
/// derives from them. Keep the two copies in step.
const VAULT_DESCRIPTOR: &str = "tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*),older(65535))})#ffpaesuq";

/// The seeds of BIP-32 test vectors 1, 2 and 3, published in BIP-32 itself.
const TEST_VECTOR_SEEDS: [&str; 3] = [
    "000102030405060708090a0b0c0d0e0f",
    "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
    "4b381541583be4423346c643850da4b320e46a87ae3d2a4e6da11eba819cd4acba45d239319ac14f863b8d5ab5a0d0c64d2e8a1e7d1457df2e5a3c51c73235be",
];

/// The account Liana derives a testnet multisig key at.
const ACCOUNT_PATH: &str = "48'/1'/0'/2'";

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

/// The BIP341 NUMS point, as Liana's `bip341_nums()` gives it.
fn nums() -> PublicKey {
    let mut bytes = vec![0x02];
    bytes.extend_from_slice(&BIP341_NUMS);
    PublicKey::from_slice(&bytes).expect("the NUMS point is on the curve")
}

fn multi_xkey(key: &DescriptorPublicKey) -> Option<Xpub> {
    match key {
        DescriptorPublicKey::MultiXPub(k) => Some(k.xkey),
        _ => None,
    }
}

/// `unspendable_internal_xpub` in `liana/src/descriptors/analysis.rs` at v16.0:
/// the NUMS point with, as chain code, the sha256 of every taptree key's public
/// key in tree order.
fn unspendable_internal_xpub(desc: &Tr<DescriptorPublicKey>) -> Option<Xpub> {
    let tap_tree = desc.tap_tree().as_ref()?;
    let first_key = tap_tree.iter().flat_map(|(_, ms)| ms.iter_pk()).next()?;
    let network = multi_xkey(&first_key)?.network;
    let concat = tap_tree
        .iter()
        .flat_map(|(_, ms)| ms.iter_pk())
        .try_fold(Vec::new(), |mut acc, pk| {
            acc.extend_from_slice(&multi_xkey(&pk)?.public_key.serialize());
            Some(acc)
        })?;
    Some(Xpub {
        network,
        depth: 0,
        parent_fingerprint: [0; 4].into(),
        child_number: ChildNumber::from(0),
        public_key: nums(),
        chain_code: ChainCode::from(sha256::Hash::hash(&concat).to_byte_array()),
    })
}

/// The vault built from the published seeds alone.
fn vault_from_test_vectors() -> Descriptor<DescriptorPublicKey> {
    let secp = Secp256k1::new();
    let path = DerivationPath::from_str(&format!("m/{ACCOUNT_PATH}")).expect("path");
    let keys: Vec<(String, Xpub)> = TEST_VECTOR_SEEDS
        .iter()
        .map(|seed| {
            let master = Xpriv::new_master(NetworkKind::Test, &unhex(seed)).expect("seed");
            let account = Xpub::from_priv(&secp, &master.derive_priv(&secp, &path).expect("derive"));
            let expr = format!("[{}/{ACCOUNT_PATH}]{account}/<0;1>/*", master.fingerprint(&secp));
            (expr, account)
        })
        .collect();
    // Tree order is the multi_a leaf (keys 1, 2), then the timelocked leaf (key 3).
    let mut concat = Vec::new();
    for (_, account) in &keys {
        concat.extend_from_slice(&account.public_key.serialize());
    }
    let internal = Xpub {
        network: NetworkKind::Test,
        depth: 0,
        parent_fingerprint: [0; 4].into(),
        child_number: ChildNumber::from(0),
        public_key: nums(),
        chain_code: ChainCode::from(sha256::Hash::hash(&concat).to_byte_array()),
    };
    let text = format!(
        "tr({internal}/<0;1>/*,{{multi_a(2,{},{}),and_v(v:pk({}),older(65535))}})",
        keys[0].0, keys[1].0, keys[2].0
    );
    Descriptor::from_str(&text).expect("the vault parses")
}

/// The vault this program seals holds only test-vector keys, and Liana would
/// derive the same internal key for it.
fn check_vault(descriptor: &Descriptor<DescriptorPublicKey>) -> Result<(), String> {
    let expected = vault_from_test_vectors();
    if descriptor.to_string() != expected.to_string() {
        return Err(format!(
            "VAULT_DESCRIPTOR is not the vault of the BIP-32 test vectors, which is\n{expected}"
        ));
    }
    let Descriptor::Tr(tr) = descriptor else {
        return Err("not a taproot vault".into());
    };
    let internal = multi_xkey(tr.internal_key()).ok_or("internal key is not an xpub")?;
    if Some(internal) != unspendable_internal_xpub(tr) {
        return Err("the internal key is not the one Liana derives".into());
    }
    Ok(())
}

/// `LianaDescriptor::spendable_keys`: every key but the NUMS point.
fn spendable_keys(descriptor: &Descriptor<DescriptorPublicKey>) -> Vec<DescriptorPublicKey> {
    let mut keys: Vec<DescriptorPublicKey> = Vec::new();
    descriptor.for_each_key(|k| {
        let root = dpk_to_root_pk(k).ok();
        if root.is_some() && root != Some(nums()) && !keys.contains(k) {
            keys.push(k.clone());
        }
        true
    });
    keys
}

fn opens_with(bytes: &[u8], key: PublicKey) -> Result<Vec<Decrypted>, String> {
    EncryptedBackup::new()
        .set_encrypted_payload(bytes)
        .map_err(|e| format!("cannot read back: {e:?}"))?
        .set_keys(vec![key])
        .decrypt()
        .map_err(|e| format!("{e:?}"))
}

fn export(
    descriptor: &Descriptor<DescriptorPublicKey>,
    store_common_paths: bool,
) -> Result<Vec<u8>, String> {
    let bytes = EncryptedBackup::new()
        .set_payload(descriptor)
        .map(|b| b.set_store_common_paths(store_common_paths))
        .and_then(|b| b.encrypt())
        .map_err(|e| format!("encryption failed: {e:?}"))?
        .bytes;

    // verify we can decrypt with any keys from the descriptor
    for key in spendable_keys(descriptor) {
        let root = dpk_to_root_pk(&key).map_err(|e| format!("{key}: {e:?}"))?;
        match opens_with(&bytes, root)?.as_slice() {
            [Decrypted::Descriptor(d)] if d.to_string() == descriptor.to_string() => {}
            other => return Err(format!("{key} opens something else: {other:?}")),
        }
    }

    // verify we can NOT decrypt w/ unspendable key or BIP341 NUMS
    if let Descriptor::Tr(tr) = descriptor {
        let unspendable = dpk_to_root_pk(tr.internal_key()).map_err(|e| format!("{e:?}"))?;
        if opens_with(&bytes, unspendable).is_ok() {
            return Err("opens with the unspendable internal key".into());
        }
    }
    if opens_with(&bytes, nums()).is_ok() {
        return Err("opens with the NUMS point, which nobody holds".into());
    }
    Ok(bytes)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let store_common_paths = args.iter().any(|a| a == "--store-common-paths");
    let rest: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let (Some(out), true) = (rest.first(), rest.len() == 1) else {
        eprintln!("usage: liana-bip138-fixture <out.bip138> [--store-common-paths]");
        process::exit(2);
    };
    let descriptor = Descriptor::<DescriptorPublicKey>::from_str(VAULT_DESCRIPTOR)
        .and_then(|d| d.sanity_check().map(|_| d))
        .unwrap_or_else(|e| {
            eprintln!("VAULT_DESCRIPTOR is not a descriptor: {e}\nthe test-vector vault is\n{}", vault_from_test_vectors());
            process::exit(1);
        });
    let checked = check_vault(&descriptor).and_then(|_| export(&descriptor, store_common_paths));
    let bytes = checked.unwrap_or_else(|e| {
        eprintln!("{e}");
        process::exit(1);
    });
    fs::write(out, &bytes).unwrap_or_else(|e| {
        eprintln!("cannot write {out}: {e}");
        process::exit(1);
    });
    let meta = EncryptedMetadata::from_encrypted_payload(&bytes).expect("reads back");
    println!(
        "wrote {out}: {} bytes, {} keys open it, {} key slots, {} derivation paths stored",
        bytes.len(),
        spendable_keys(&descriptor).len(),
        meta.individual_secrets.len(),
        meta.derivation_paths.len()
    );
}
