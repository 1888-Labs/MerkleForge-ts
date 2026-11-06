---
"@merkleforge/core": patch
"@merkleforge/hash": patch
"@merkleforge/hash-wasm": patch
"@merkleforge/variants": patch
"@merkleforge/openzeppelin": patch
"@merkleforge/ethereum": patch
---

Faster trees and hashing, with identical roots and proofs.

- `@merkleforge/core`: `HashFunction` gains optional batch methods `hashNodePairs` and `hashLeaves`, with `hashNodePairs()` / `hashLeaves()` helpers that fall back to per-node hashing. `fromHex` is several times faster.
- `@merkleforge/hash`: `Keccak256` uses an unrolled in-house Keccak-f[1600] (about 2x faster than `@noble/hashes`, cross-tested against it) and implements the batch methods. New `keccak256(data, more?)` export for plain Keccak-256.
- `@merkleforge/hash-wasm`: replaces the `hash-wasm` dependency with an embedded 9 KB `no_std` Rust module that hashes a whole tree layer per call and uses WebAssembly SIMD for Keccak-256 where available. Building a 131,072-leaf Keccak-256 tree is about 5x faster than in 0.2.2 (485 ms to 98 ms).
- `@merkleforge/variants`: `BinaryMerkleTree` stores nodes in one flat buffer, hashes layer by layer through the batch API, and fills padding subtrees from precomputed empty-subtree digests. Pure-JS Keccak-256 builds are about 3x faster.
- `@merkleforge/openzeppelin` and `@merkleforge/ethereum`: use the faster Keccak-256 from `@merkleforge/hash` instead of depending on `@noble/hashes` directly. OpenZeppelin-compatible trees build about 2x faster.
