//! Writes `consensus` into every vector of the file named on the command line:
//! "ok" when libbitcoinconsensus accepts the finished transaction's input as a
//! spend of the coin it names, the library's error otherwise, and nothing for
//! a vector @scure did not finish. See gen.mjs for what the vectors are.
use std::fs;

fn main() {
    let path = std::env::args().nth(1).expect("the vectors file");
    let mut doc: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    let flags = bitcoinconsensus::VERIFY_ALL_PRE_TAPROOT | bitcoinconsensus::VERIFY_TAPROOT;
    let (mut ok, mut refused) = (0, 0);
    for v in doc["vectors"].as_array_mut().unwrap() {
        let Some(tx_hex) = v["finalTx"].as_str() else { continue };
        let tx = hex::decode(tx_hex).unwrap();
        let scripts: Vec<Vec<u8>> = v["prevouts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| hex::decode(p["script"].as_str().unwrap()).unwrap())
            .collect();
        let amounts: Vec<u64> = v["prevouts"].as_array().unwrap().iter().map(|p| p["amount"].as_u64().unwrap()).collect();
        let utxos: Vec<bitcoinconsensus::Utxo> = scripts
            .iter()
            .zip(&amounts)
            .map(|(s, a)| bitcoinconsensus::Utxo { script_pubkey: s.as_ptr(), script_pubkey_len: s.len() as u32, value: *a as i64 })
            .collect();
        let mut verdict = "ok".to_string();
        for i in 0..scripts.len() {
            if let Err(e) = bitcoinconsensus::verify_with_flags(&scripts[i], amounts[i], &tx, Some(&utxos), i, flags) {
                verdict = format!("input {}: {:?}", i, e);
                break;
            }
        }
        if verdict == "ok" { ok += 1 } else { refused += 1 }
        v["consensus"] = serde_json::Value::String(verdict);
    }
    fs::write(&path, serde_json::to_string_pretty(&doc).unwrap() + "\n").unwrap();
    eprintln!("{} accepted, {} refused", ok, refused);
}
