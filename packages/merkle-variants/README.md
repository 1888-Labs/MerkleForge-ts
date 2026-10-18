<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@1888-labs/merkle-variants</h1>

<p align="center">Binary, Sparse, and Ethereum-compatible Patricia Merkle trees<br>for MerkleForge, with roots and proofs that match the Rust crate.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@1888-labs/merkle-variants"><img alt="npm" src="https://img.shields.io/npm/v/@1888-labs/merkle-variants?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@1888-labs/merkle-variants"><img alt="downloads" src="https://img.shields.io/npm/dm/@1888-labs/merkle-variants?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@1888-labs/merkle-variants` holds the tree implementations. Every tree takes a
`HashFunction` at construction, so you can use SHA-256, Keccak-256, BLAKE3, or
your own adapter without changing the tree API.

| Variant | Use it for | Proofs |
|---------|------------|--------|
| `BinaryMerkleTree` | A known, ordered list of leaves (airdrops, batches, receipts) | Inclusion and multiproofs, `O(log n)` |
| `SparseMerkleTree` | Key-value state over 256-bit keys (rollups, registries) | Membership and non-membership |
| `MerklePatriciaTrie` | Ethereum-compatible tries; with `Keccak256` roots match Ethereum | RLP witnesses, membership and non-membership |

## Install

```sh
npm i @1888-labs/merkle-variants @1888-labs/merkle-hash @1888-labs/merkle-core
```

## Usage

Binary tree, with stateless verification:

```ts
import { utf8 } from '@1888-labs/merkle-core'
import { Keccak256 } from '@1888-labs/merkle-hash'
import { BinaryMerkleTree } from '@1888-labs/merkle-variants'

const leaves = ['alice:100', 'bob:250', 'carol:75'].map(utf8)
const tree = BinaryMerkleTree.fromLeaves(Keccak256, leaves)

const root = tree.root()!
const proof = tree.generateProof(1)
BinaryMerkleTree.verify(Keccak256, root, utf8('bob:250'), proof) // true

// Several leaves with shared siblings
const multi = tree.generateMultiProof([0, 2])
BinaryMerkleTree.verifyMultiProof(Keccak256, root, [leaves[0], leaves[2]], multi) // true
```

Sparse tree, proving a key is present or absent:

```ts
import { SparseMerkleTree } from '@1888-labs/merkle-variants'

const smt = new SparseMerkleTree(Keccak256)
const alice = Keccak256.hash(utf8('alice')) // any 32-byte key
smt.insert(alice, utf8('balance:100'))

const proof = smt.generateMembershipProof(alice)
SparseMerkleTree.verifyMembership(Keccak256, smt.root()!, alice, utf8('balance:100'), proof) // true

const bob = Keccak256.hash(utf8('bob'))
SparseMerkleTree.verifyNonMembership(Keccak256, smt.root()!, bob, smt.generateMembershipProof(bob)) // true
```

Ethereum-compatible Patricia trie:

```ts
import { MerklePatriciaTrie } from '@1888-labs/merkle-variants'

const trie = new MerklePatriciaTrie(Keccak256)
trie.insert(utf8('dog'), utf8('puppy'))
const witness = trie.generateProof(utf8('dog'))
MerklePatriciaTrie.verifyProof(Keccak256, trie.root()!, witness) // true
```

## Interop

- **Rust:** `encodeSparseProof`, `encodeMptProof`, `encodeBinaryMultiProof`
  (and `decode*`) match Rust's bincode bytes; the `*ToSerdeJSON` /
  `*FromSerdeJSON` helpers match `serde_json`. Binary proofs use the codecs in
  `@1888-labs/merkle-core`.
- **Saved trees:** `tree.toJSON()` and `BinaryMerkleTree.fromJSON(hasher, json)`
  (likewise for the other variants) store leaves only and rebuild on load.
- **Solidity:** `toSolidityBinaryProof`, `toSolidityBinaryMultiProof`, and
  `toSoliditySparseProof` shape proofs for the
  [MerkleForge Solidity verifiers](https://github.com/1888-Labs/MerkleForge-ts/tree/main/contracts).
- **RLP:** `encodeRlp` / `decodeRlp` and the hex-prefix helpers are exported for
  working with Ethereum trie nodes.

## Part of MerkleForge

MerkleForge is a set of authenticated data structures for Rust and TypeScript
with matching roots and proofs across languages. All TypeScript packages share
one version.

| Package | What it holds |
|---------|---------------|
| [`@1888-labs/merkle-core`](https://www.npmjs.com/package/@1888-labs/merkle-core) | Interfaces, proof types, errors, codecs, and byte helpers |
| [`@1888-labs/merkle-hash`](https://www.npmjs.com/package/@1888-labs/merkle-hash) | SHA-256, Keccak-256, and BLAKE3 adapters |
| [`@1888-labs/merkle-hash-wasm`](https://www.npmjs.com/package/@1888-labs/merkle-hash-wasm) | WebAssembly Keccak-256 and SHA-256, same digests, faster |
| **[`@1888-labs/merkle-variants`](https://www.npmjs.com/package/@1888-labs/merkle-variants)** | Binary, Sparse, and Patricia trees, multiproofs, codecs |
| [`@1888-labs/merkle-ethereum`](https://www.npmjs.com/package/@1888-labs/merkle-ethereum) | Verify `eth_getProof` account and storage proofs |

Staging builds from `develop` are published under the `next` tag
(`npm i @1888-labs/merkle-variants@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
