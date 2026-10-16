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
| [`@1888-labs/merkle-variants`](packages/merkle-variants) | `BinaryMerkleTree` (with multiproofs), `SparseMerkleTree`, `MerklePatriciaTrie`, proof codecs | `merkle-variants` |
| [`@1888-labs/merkle-hash-wasm`](packages/merkle-hash-wasm) | WebAssembly `Keccak256` and `Sha256`, identical output, about 6x faster Keccak | none |
| [`@1888-labs/merkle-ethereum`](packages/merkle-ethereum) | Verify `eth_getProof` account and storage proofs against a state root | none |

| Variant | Use it for | Proofs |
|---------|------------|--------|
| `BinaryMerkleTree` | A known, ordered list of leaves (airdrops, batches, receipts) | Inclusion, `O(log n)` |
| `SparseMerkleTree` | Key-value state over 256-bit keys (rollups, registries) | Membership and non-membership |
| `MerklePatriciaTrie` | Ethereum-compatible tries; with `Keccak256` roots match Ethereum | RLP witnesses, membership and non-membership |

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

Sparse Merkle tree with non-membership proofs:

```ts
import { SparseMerkleTree } from '@1888-labs/merkle-variants'

const smt = new SparseMerkleTree(Keccak256)
const alice = Keccak256.hash(utf8('alice')) // any 32-byte key
smt.insert(alice, utf8('balance:100'))

const proof = smt.generateMembershipProof(alice)
SparseMerkleTree.verifyMembership(Keccak256, smt.root()!, alice, utf8('balance:100'), proof) // true
```

Ethereum-compatible Patricia trie:

```ts
import { MerklePatriciaTrie } from '@1888-labs/merkle-variants'

const trie = new MerklePatriciaTrie(Keccak256)
trie.insert(utf8('dog'), utf8('puppy'))
const witness = trie.generateProof(utf8('dog'))
MerklePatriciaTrie.verifyProof(Keccak256, trie.root()!, witness) // true
```

## More features

- **Multiproofs**: `tree.generateMultiProof([1, 4, 9])` proves several leaves
  with shared siblings; verify with `BinaryMerkleTree.verifyMultiProof`.
- **Rust-compatible proof formats**: `encodeMerkleProof` / `decodeMerkleProof`
  produce the same bytes as Rust's `proof.to_bytes()` (bincode), and
  `merkleProofToSerdeJSON` the same JSON as `serde_json`. Sparse and Patricia
  proofs have matching codecs, so a proof made in Rust verifies in TypeScript
  and vice versa.
- **Solidity verifiers**: [`contracts/`](contracts) has `MerkleForgeBinary`
  (single and multiproofs) and `MerkleForgeSparse` libraries for Keccak-256
  trees. `toSolidityBinaryProof`, `toSolidityBinaryMultiProof`, and
  `toSoliditySparseProof` shape proofs for calldata.
- **Ethereum state proofs**: `verifyEthGetProof(stateRoot, response)` checks
  an `eth_getProof` response, tested against real mainnet proofs.

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
| `impl MerkleTree for SparseMerkleTree` (index-addressed) | `smt.indexed()` returns a `MerkleTree` view |
| `smt.insert(key, data)` / `trie.insert(key, value)` | same names, keys are `Uint8Array` |

Leaves are hashed as `H(0x00 || data)` and internal nodes as
`H(0x01 || left || right)`; BLAKE3 uses `derive_key` contexts instead. See the
[architecture notes](https://github.com/1888-Labs/MerkleForge/blob/main/ARCHITECTURE.md).

## Development

```sh
pnpm install
pnpm build   # tsc -b
pnpm test    # vitest, including cross-checks against vectors from the Rust crates
pnpm lint    # biome
pnpm check   # everything CI runs
```

Property tests (fast-check) cover random trees, edit sequences, and
tampering. `pnpm test:solidity` runs the Foundry tests for `contracts/` after
`pnpm fixtures:solidity` regenerates their fixtures.

The expected values in `packages/*/test/rust-*.json` come from the Rust
crates. With the Rust repo cloned next to this one, regenerate them with
`scripts/rust-vectors/generate.sh`. The Patricia trie is also tested against
the official Ethereum trie fixtures.

Releases use [Changesets](https://github.com/changesets/changesets): add one
with `pnpm changeset`, and merging the generated "Version packages" PR on
`main` publishes to npm.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately via [SECURITY.md](.github/SECURITY.md).
MerkleForge has not been independently audited.

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.
