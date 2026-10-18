---
'@1888-labs/merkle-core': minor
'@1888-labs/merkle-hash': minor
'@1888-labs/merkle-hash-wasm': minor
'@1888-labs/merkle-variants': minor
'@1888-labs/merkle-ethereum': minor
---

Initial TypeScript release.

- `BinaryMerkleTree`, `SparseMerkleTree`, and an Ethereum-compatible `MerklePatriciaTrie`, with roots and proofs that match the Rust crates.
- SHA-256, Keccak-256, and BLAKE3 adapters, plus WebAssembly Keccak-256 and SHA-256 in `merkle-hash-wasm`.
- Binary multiproofs.
- Proof codecs that are byte-compatible with Rust's bincode and `serde_json` output.
- Helpers that shape proofs for the MerkleForge Solidity verifiers.
- `eth_getProof` account and storage proof verification in `merkle-ethereum`.
