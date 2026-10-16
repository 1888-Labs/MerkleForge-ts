//! serde_json and bincode (standard config) encodings of every proof type.
use merkle_core::traits::{MerkleTree, Serializable};
use merkle_core::types::LeafIndex;
use merkle_variants::{BinaryMerkleTree, MerklePatriciaTrie, SparseMerkleTree};
use merkleforge_hash::{HashFunction, Keccak256};
use serde::Serialize;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect::<String>()
}

fn case<T: Serialize + Serializable>(name: &str, value: &T) -> String {
    format!(
        "{{\"name\":\"{name}\",\"json\":{},\"bincode\":\"0x{}\"}}",
        serde_json::to_string(&serde_json::to_string(value).unwrap()).unwrap(),
        hex(&value.to_bytes().unwrap())
    )
}

fn main() {
    let leaves: Vec<Vec<u8>> = (0..300).map(|i| format!("leaf-{i}").into_bytes()).collect();
    let small = BinaryMerkleTree::<Keccak256>::from_leaves(&leaves[..5]).unwrap();
    let large = BinaryMerkleTree::<Keccak256>::from_leaves(&leaves).unwrap();

    let mut smt = SparseMerkleTree::<Keccak256>::new();
    for i in 0..8 {
        smt.insert(Keccak256::hash(format!("key-{i}").as_bytes()), format!("value-{i}").as_bytes())
            .unwrap();
    }
    let mut indexed = SparseMerkleTree::<Keccak256>::new();
    for leaf in &leaves[..3] {
        MerkleTree::insert(&mut indexed, leaf).unwrap();
    }

    let mut mpt = MerklePatriciaTrie::<Keccak256>::new();
    mpt.insert(b"do", b"verb").unwrap();
    mpt.insert(b"dog", b"puppy").unwrap();
    mpt.insert(b"doge", &vec![0xab; 300]).unwrap();
    mpt.insert(b"horse", b"stallion").unwrap();

    let multi_small = small.generate_multi_proof(&[LeafIndex(4), LeafIndex(1), LeafIndex(1)]).unwrap();
    let multi_large = large
        .generate_multi_proof(&[0, 7, 8, 9, 150, 298, 299].map(LeafIndex))
        .unwrap();

    let cases = [
        case("binary-small", &small.generate_proof(LeafIndex(4)).unwrap()),
        case("binary-large", &large.generate_proof(LeafIndex(299)).unwrap()),
        case("sparse-indexed", &MerkleTree::generate_proof(&indexed, LeafIndex(1)).unwrap()),
        case("sparse-member", &smt.generate_membership_proof(Keccak256::hash(b"key-3")).unwrap()),
        case("sparse-non-member", &smt.generate_membership_proof(Keccak256::hash(b"absent")).unwrap()),
        case("mpt-member", &mpt.generate_proof(b"dog").unwrap()),
        case("mpt-long-value", &mpt.generate_proof(b"doge").unwrap()),
        case("mpt-non-member", &mpt.generate_proof(b"dot").unwrap()),
        case("multi-small", &multi_small),
        case("multi-large", &multi_large),
    ];
    let roots = format!(
        "{{\"binary-small\":\"0x{}\",\"binary-large\":\"0x{}\",\"sparse-indexed\":\"0x{}\",\"sparse\":\"0x{}\",\"mpt\":\"0x{}\"}}",
        hex(small.root().unwrap()),
        hex(large.root().unwrap()),
        hex(MerkleTree::root(&indexed).unwrap()),
        hex(smt.root().unwrap()),
        hex(mpt.root().unwrap())
    );
    println!("{{\"hash\":\"Keccak-256\",\"roots\":{roots},\"cases\":[{}]}}", cases.join(","));
}
