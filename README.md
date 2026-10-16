# MerkleForge for TypeScript

Authenticated data structures for TypeScript and JavaScript: the same trees,
hashes, and proofs as the [MerkleForge Rust crates](https://github.com/1888-Labs/MerkleForge),
with roots and proofs that match the Rust implementation byte for byte.

A project by [1888 Labs](https://github.com/1888-Labs). Docs: <https://1888-labs.github.io/MerkleForge/>

## Packages

| Package | Role | Rust equivalent |
|---------|------|-----------------|
| [`@1888-labs/merkle-core`](packages/merkle-core) | `HashFunction` and `MerkleTree` interfaces, proofs, `MerkleError`, byte helpers | `merkle-core` |
| [`@1888-labs/merkle-hash`](packages/merkle-hash) | `Sha256`, `Keccak256`, `Blake3` adapters | `merkleforge-hash` |
| [`@1888-labs/merkle-variants`](packages/merkle-variants) | `BinaryMerkleTree` | `merkle-variants` |

`SparseMerkleTree` and `MerklePatriciaTrie` are next.

## Install

```sh
npm i @1888-labs/merkle-variants @1888-labs/merkle-hash @1888-labs/merkle-core
```

ESM only. Works in Node.js 22+, browsers, Deno, and Bun. The only runtime
dependency is [`@noble/hashes`](https://github.com/paulmillr/noble-hashes).

## Usage

```ts
import { toHex, utf8 } from '@1888-labs/merkle-core'
import { Keccak256 } from '@1888-labs/merkle-hash'
import { BinaryMerkleTree } from '@1888-labs/merkle-variants'

const leaves = ['alice:100', 'bob:250', 'carol:75'].map(utf8)
const tree = BinaryMerkleTree.fromLeaves(Keccak256, leaves)

const root = tree.root()! // Uint8Array
const proof = tree.generateProof(1)

BinaryMerkleTree.verify(Keccak256, root, utf8('bob:250'), proof) // true
console.log(toHex(root))
```

## How it maps to Rust

| Rust | TypeScript |
|------|------------|
| `BinaryMerkleTree::<Keccak256>::from_leaves(data)?` | `BinaryMerkleTree.fromLeaves(Keccak256, data)` |
| Generic `H: HashFunction` type parameter | `HashFunction` object passed at construction |
| `Result<T, MerkleError>` | Throws `MerkleError`; check `error.code` or use `isMerkleError(error, 'EmptyTree')` |
| `[u8; 32]` digests | `Uint8Array` |
| `LeafIndex(usize)` | `number` |
| `ProofSide::Left` / `Right` | `'left'` / `'right'` |
| `serde` | `tree.toJSON()` / `BinaryMerkleTree.fromJSON(hasher, json)` |

Leaves are hashed as `H(0x00 || data)` and internal nodes as
`H(0x01 || left || right)`; BLAKE3 uses `derive_key` contexts instead. See the
[architecture notes](https://github.com/1888-Labs/MerkleForge/blob/main/ARCHITECTURE.md).

## Development

```sh
pnpm install
pnpm build   # tsc -b
pnpm test    # vitest, including cross-checks against vectors from the Rust crates
pnpm lint    # biome
```

Releases use [Changesets](https://github.com/changesets/changesets): add one
with `pnpm changeset`, and merging the generated "Version packages" PR on
`main` publishes to npm.

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.
