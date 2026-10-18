# @1888-labs/merkle-hash-wasm

WebAssembly Keccak-256 and SHA-256 adapters for MerkleForge, built on
[`hash-wasm`](https://github.com/Daninet/hash-wasm). They return exactly the
same digests and `algorithmName` as `@1888-labs/merkle-hash`, so you can swap
them in without changing any root, proof, or saved tree.

Keccak-256 is about 6x faster than the pure-JS adapter in Node, which matters
most for `SparseMerkleTree` (every new key costs about 256 hashes). SHA-256 is
only slightly faster. BLAKE3 is not offered because `hash-wasm` has no
`derive_key` mode.

Part of [MerkleForge for TypeScript](https://github.com/1888-Labs/MerkleForge-ts), a project by [1888 Labs](https://github.com/1888-Labs).

```sh
npm i @1888-labs/merkle-hash-wasm
```

```ts
import { createKeccak256Wasm } from '@1888-labs/merkle-hash-wasm'
import { SparseMerkleTree } from '@1888-labs/merkle-variants'

const Keccak256 = await createKeccak256Wasm() // loads the WASM module once
const smt = new SparseMerkleTree(Keccak256)
```

Licensed under MIT OR Apache-2.0.
