# @merkleforge/openzeppelin

## 0.2.1

### Patch Changes

- e0cfa9c: Add `@merkleforge/openzeppelin`, a drop-in replacement for `@openzeppelin/merkle-tree`. `StandardMerkleTree` and `SimpleMerkleTree` produce identical roots, proofs, multiproofs, and `dump()` JSON, so proofs verify with OpenZeppelin's `MerkleProof` on-chain and existing dumps load unchanged. Includes a dependency-free `abiEncode`.
- @merkleforge/core@0.2.1
