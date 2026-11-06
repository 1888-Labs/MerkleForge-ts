//! Live parity check for bench/parity.mjs: reads 32-byte leaves and u32 proof
//! indices written by the TypeScript side, builds the same trees with the Rust
//! crates, and prints each root plus every proof's bincode bytes as JSON.
//!
//! Usage: parity <leaves.bin> <indices.bin>
use merkle_core::traits::Serializable;
use merkle_core::types::{LeafIndex, MerkleProof};
use merkle_variants::BinaryMerkleTree;
use merkleforge_hash::{HashFunction, Keccak256, Sha256};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn emit<H: HashFunction>(leaves: &[&[u8]], indices: &[usize]) -> String
where
    MerkleProof<H::Digest>: Serializable,
{
    let tree = BinaryMerkleTree::<H>::from_leaves(leaves).unwrap();
    let mut proofs = Vec::new();
    for &i in indices {
        proofs.extend(
            tree.generate_proof(LeafIndex(i))
                .unwrap()
                .to_bytes()
                .unwrap(),
        );
    }
    format!(
        "{{\"algorithm\":\"{}\",\"root\":\"{}\",\"proofs\":\"{}\"}}",
        H::algorithm_name(),
        hex(tree.root().unwrap().as_ref()),
        hex(&proofs)
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let leaves = std::fs::read(&args[1]).unwrap();
    let indices: Vec<usize> = std::fs::read(&args[2])
        .unwrap()
        .chunks_exact(4)
        .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]) as usize)
        .collect();
    let leaves: Vec<&[u8]> = leaves.chunks_exact(32).collect();
    println!(
        "[{},{}]",
        emit::<Keccak256>(&leaves, &indices),
        emit::<Sha256>(&leaves, &indices)
    );
}
