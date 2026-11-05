//! Writes an encrypted descriptor backup (.bed) the way Liana's GUI exported
//! one, for the cross check in `src/wallet/__tests__/encryptedBackup.test.ts`.
//!
//! `export` follows `export_encrypted_descriptor` in `liana-gui/src/export.rs`
//! at Liana's v15.0 tag, the last release that wrote `.bed` files: the parsed
//! descriptor goes whole to `EncryptedBackup::set_payload`, which takes the
//! participant keys and the origin derivation paths from it, and the file is
//! checked to open with every spendable key (giving the descriptor back) and
//! to stay shut for the BIP341 NUMS point. Liana also tries the unspendable
//! internal key it derives, whose public key is that same point. Only the
//! progress messages and the async file writing are left out.
//!
//! Liana parses the descriptor as a `LianaDescriptor`: the miniscript
//! descriptor (`Descriptor::from_str` and `sanity_check`, as here) plus a check
//! that it is a Liana spending policy, which the bytes do not depend on.
//!
//! Usage: cargo run --release -- <out.bed> [descriptor]

use std::{env, fs, process, str::FromStr};

use encrypted_backup::{
    descriptor::{bip341_nums, dpk_to_pk},
    Decrypted, EncryptedBackup,
};
use miniscript::{bitcoin::secp256k1::PublicKey, Descriptor, DescriptorPublicKey, ForEachKey};

/// The vault of `encryptedBackup.test.ts` (`VAULT_DESCRIPTOR`): a test vault of
/// made-up keys (BIP-32 test vectors 1, 2 and 3 at m/48'/1'/0'/2', the vault
/// of the .bip138 fixtures), whose internal key is the unspendable key
/// Liana derives from those three. Keep the two in step.
const VAULT_DESCRIPTOR: &str = "tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*),older(65535))})#ffpaesuq";

/// `LianaDescriptor::spendable_keys`: every key but the NUMS point.
fn spendable_keys(descriptor: &Descriptor<DescriptorPublicKey>) -> Vec<PublicKey> {
    let mut keys = Vec::new();
    descriptor.for_each_key(|k| {
        let pk = dpk_to_pk(k);
        if pk != bip341_nums() && !keys.contains(&pk) {
            keys.push(pk);
        }
        true
    });
    keys
}

fn export(descriptor: &Descriptor<DescriptorPublicKey>) -> Result<Vec<u8>, String> {
    let bytes = EncryptedBackup::new()
        .set_payload(descriptor)
        .and_then(|b| b.encrypt())
        .map_err(|e| format!("encryption failed: {e:?}"))?;

    // verify we can decrypt with any keys from the descriptor
    for key in spendable_keys(descriptor) {
        let decrypted = EncryptedBackup::new()
            .set_encrypted_payload(&bytes)
            .and_then(|b| b.set_keys(vec![key]).decrypt())
            .map_err(|e| format!("does not open with {key}: {e:?}"))?;
        match decrypted {
            Decrypted::Descriptor(d) if d.to_string() == descriptor.to_string() => {}
            other => return Err(format!("{key} opens something else: {other:?}")),
        }
    }

    // verify we can NOT decrypt w/ BIP341 NUMS
    let opened = EncryptedBackup::new()
        .set_encrypted_payload(&bytes)
        .map_err(|e| format!("cannot read back: {e:?}"))?
        .set_keys(vec![bip341_nums()])
        .decrypt();
    if opened.is_ok() {
        return Err("opens with the NUMS point, which nobody holds".into());
    }
    Ok(bytes)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(out) = args.first() else {
        eprintln!("usage: liana-bed-fixture <out.bed> [descriptor]");
        process::exit(2);
    };
    let text = args.get(1).map(String::as_str).unwrap_or(VAULT_DESCRIPTOR);
    let descriptor = Descriptor::<DescriptorPublicKey>::from_str(text)
        .and_then(|d| d.sanity_check().map(|_| d))
        .unwrap_or_else(|e| {
            eprintln!("not a descriptor: {e}");
            process::exit(1);
        });
    let bytes = export(&descriptor).unwrap_or_else(|e| {
        eprintln!("{e}");
        process::exit(1);
    });
    fs::write(out, &bytes).unwrap_or_else(|e| {
        eprintln!("cannot write {out}: {e}");
        process::exit(1);
    });
    println!(
        "wrote {out}: {} bytes, {} keys open it",
        bytes.len(),
        spendable_keys(&descriptor).len()
    );
}
