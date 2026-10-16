# @1888-labs/merkle-variants

Merkle tree implementations for MerkleForge: `BinaryMerkleTree`, `SparseMerkleTree` (256-bit keys, membership and non-membership proofs), and an Ethereum-compatible `MerklePatriciaTrie`. Roots and proofs match the Rust `merkle-variants` crate.

Part of [MerkleForge for TypeScript](https://github.com/1888-Labs/MerkleForge-ts), a project by [1888 Labs](https://github.com/1888-Labs). Docs: <https://1888-labs.github.io/MerkleForge/>

```sh
npm i @1888-labs/merkle-variants
```

```ts
import { utf8 } from '@1888-labs/merkle-core'
import { Sha256 } from '@1888-labs/merkle-hash'
import { BinaryMerkleTree } from '@1888-labs/merkle-variants'

const tree = BinaryMerkleTree.fromLeaves(Sha256, [utf8('a'), utf8('b'), utf8('c')])
const proof = tree.generateProof(2)
BinaryMerkleTree.verify(Sha256, tree.root()!, utf8('c'), proof) // true
```

Licensed under MIT OR Apache-2.0.
