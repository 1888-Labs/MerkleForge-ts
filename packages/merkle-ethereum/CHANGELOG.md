# @1888-labs/merkle-ethereum

## 0.1.0

### Minor Changes

- fa094ee: Initial TypeScript release.
  
  - `BinaryMerkleTree`, `SparseMerkleTree`, and an Ethereum-compatible `MerklePatriciaTrie`, with roots and proofs that match the Rust crates.
  - SHA-256, Keccak-256, and BLAKE3 adapters, plus WebAssembly Keccak-256 and SHA-256 in `merkle-hash-wasm`.
  - Binary multiproofs.
  - Proof codecs that are byte-compatible with Rust's bincode and `serde_json` output.
  - Helpers that shape proofs for the MerkleForge Solidity verifiers.
  - `eth_getProof` account and storage proof verification in `merkle-ethereum`.

### Patch Changes

- Updated dependencies [fa094ee]
  - @1888-labs/merkle-core@0.1.0
  - @1888-labs/merkle-hash@0.1.0
  - @1888-labs/merkle-variants@0.1.0
