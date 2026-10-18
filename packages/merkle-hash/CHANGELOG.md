# @1888-labs/merkle-hash

## 0.2.0

### Minor Changes

- 8fa8166: Rename the packages to the `@merkleforge` scope: `@1888-labs/merkle-core` is now `@merkleforge/core`, and likewise `hash`, `hash-wasm`, `variants`, and `ethereum`. The API is unchanged; update your imports. The `@1888-labs/merkle-*` packages are deprecated.

### Patch Changes

- Updated dependencies [8fa8166]
  - @merkleforge/core@0.2.0

## 0.1.1

### Patch Changes

- 51dcd3f: Rewrite the package READMEs with MerkleForge branding, API tables, and more examples, and sharpen package descriptions and keywords for npm search.
- Updated dependencies [51dcd3f]
  - @1888-labs/merkle-core@0.1.1

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
