use merkle_core::traits::HashFunction;
use merkle_core::types::{LeafIndex, ProofSide};
use merkle_variants::BinaryMerkleTree;
use merkleforge_hash::{Blake3, Keccak256, Sha256};

fn hex(b: &[u8]) -> String {
    let mut s = String::from("0x");
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn leaves(n: usize) -> Vec<Vec<u8>> {
    (0..n).map(|i| format!("leaf-{i}").into_bytes()).collect()
}

fn emit<H: HashFunction>() -> String {
    let mut out = String::new();
    out.push_str(&format!("{{\"algorithm\":\"{}\",", H::algorithm_name()));
    out.push_str(&format!(
        "\"primitives\":{{\"hashAbc\":\"{}\",\"hashNodes\":\"{}\",\"empty\":\"{}\",\"encodedAbc\":\"{}\"}},",
        hex(H::hash(b"abc").as_ref()),
        hex(H::hash_nodes(&H::hash(b"a"), &H::hash(b"b")).as_ref()),
        hex(H::empty().as_ref()),
        hex(H::hash_encoded_node(b"abc").as_ref()),
    ));
    let mut trees = Vec::new();
    for n in 1..=9 {
        let t = BinaryMerkleTree::<H>::from_leaves(leaves(n)).unwrap();
        let p = t.generate_proof(LeafIndex(n - 1)).unwrap();
        let path: Vec<String> = p
            .path
            .iter()
            .map(|node| {
                let side = match node.side {
                    ProofSide::Left => "left",
                    ProofSide::Right => "right",
                };
                format!("{{\"hash\":\"{}\",\"side\":\"{side}\"}}", hex(node.hash.as_ref()))
            })
            .collect();
        trees.push(format!(
            "{{\"leafCount\":{n},\"height\":{},\"root\":\"{}\",\"lastProof\":[{}]}}",
            t.height(),
            hex(t.root().unwrap().as_ref()),
            path.join(",")
        ));
    }
    out.push_str(&format!("\"trees\":[{}],", trees.join(",")));
    let mut t = BinaryMerkleTree::<H>::from_leaves(leaves(5)).unwrap();
    t.remove(LeafIndex(4)).unwrap();
    let after_tail = (t.leaf_count(), t.height(), hex(t.root().unwrap().as_ref()));
    t.remove(LeafIndex(1)).unwrap();
    let after_mid = (t.leaf_count(), t.height(), hex(t.root().unwrap().as_ref()));
    out.push_str(&format!(
        "\"removals\":[{{\"index\":4,\"leafCount\":{},\"height\":{},\"root\":\"{}\"}},{{\"index\":1,\"leafCount\":{},\"height\":{},\"root\":\"{}\"}}]}}",
        after_tail.0, after_tail.1, after_tail.2, after_mid.0, after_mid.1, after_mid.2
    ));
    out
}

fn main() {
    println!(
        "{{\"leafPattern\":\"leaf-{{i}}\",\"hashes\":[{},{},{}]}}",
        emit::<Sha256>(),
        emit::<Keccak256>(),
        emit::<Blake3>()
    );
}
