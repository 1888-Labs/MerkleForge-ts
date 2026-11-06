# @1888-labs/merkle-variants

## 0.2.3

### Patch Changes

- dad35e6: Faster trees and hashing, with identical roots and proofs.
  
  - `@merkleforge/core`: `HashFunction` gains optional batch methods `hashNodePairs` and `hashLeaves`, with `hashNodePairs()` / `hashLeaves()` helpers that fall back to per-node hashing. `fromHex` is several times faster.
  - `@merkleforge/hash`: `Keccak256` uses an unrolled in-house Keccak-f[1600] (about 2x faster than `@noble/hashes`, cross-tested against it) and implements the batch methods. New `keccak256(data, more?)` export for plain Keccak-256.
  - `@merkleforge/hash-wasm`: replaces the `hash-wasm` dependency with an embedded 9 KB `no_std` Rust module that hashes a whole tree layer per call and uses WebAssembly SIMD for Keccak-256 where available. Building a 131,072-leaf Keccak-256 tree is about 5x faster than in 0.2.2 (485 ms to 98 ms).
  - `@merkleforge/variants`: `BinaryMerkleTree` stores nodes in one flat buffer, hashes layer by layer through the batch API, and fills padding subtrees from precomputed empty-subtree digests. Pure-JS Keccak-256 builds are about 3x faster.
  - `@merkleforge/openzeppelin` and `@merkleforge/ethereum`: use the faster Keccak-256 from `@merkleforge/hash` instead of depending on `@noble/hashes` directly. OpenZeppelin-compatible trees build about 2x faster.
- Updated dependencies [dad35e6]
  - @merkleforge/core@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [c008a13]
  - @merkleforge/core@0.2.2

## 0.2.1

### Patch Changes

- @merkleforge/core@0.2.1

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
