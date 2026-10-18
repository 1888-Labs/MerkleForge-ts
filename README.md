<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/lockup/merkleforge-lockup-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/lockup/merkleforge-lockup-black.svg" width="420">
    </picture>
  </a>
</p>

<p align="center">
  Authenticated data structures for TypeScript and JavaScript: Binary, Sparse, and<br>
  Ethereum-compatible Patricia Merkle trees, byte-for-byte compatible with the Rust crates.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@merkleforge/variants"><img alt="npm" src="https://img.shields.io/npm/v/@merkleforge/variants?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@merkleforge/variants/v/next"><img alt="npm next" src="https://img.shields.io/npm/v/@merkleforge/variants/next?style=flat-square&label=next&color=6B6B6B"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="https://github.com/1888-Labs/MerkleForge"><img alt="Rust crates" src="https://img.shields.io/badge/rust-MerkleForge-000000?style=flat-square"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Website</a> ·
  <a href="https://1888-labs.github.io/MerkleForge/docs/getting-started">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a> ·
  <a href="contracts/README.md">Solidity verifiers</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

> ⚠️ **Not yet audited.** MerkleForge is tested with unit, property-based,
> cross-implementation, and Ethereum vector tests, but has not had an
> independent security audit. Review it against your threat model before using
> it in security-critical systems, and [report issues responsibly](.github/SECURITY.md).

## Why MerkleForge for TypeScript

The same trees, hashes, and proofs as the [MerkleForge Rust crates](https://github.com/1888-Labs/MerkleForge),
with an idiomatic TypeScript API:

- **Cross-language proofs.** Roots and proofs match the Rust implementation byte for byte,
  so a proof made by a Rust server verifies in a browser, and the other way round.
- **Three variants, one interface.** Every tree implements `MerkleTree`, so you can switch
  variants without rewriting integration code.
- **Pluggable hashes.** `Sha256`, `Keccak256`, `Blake3`, WebAssembly Keccak-256 and SHA-256,
  or your own with `defineHashFunction`.
- **Stateless proofs.** Verify with only a trusted root, the leaf, and an `O(log n)` proof.
- **On-chain and Ethereum.** Solidity verifiers for every proof type, and `eth_getProof`
  verification tested against real mainnet proofs.
- **Small.** ESM only, Node.js 22+, browsers, Deno, and Bun. The only runtime dependency
  is [`@noble/hashes`](https://github.com/paulmillr/noble-hashes).

## Packages

| Package | Role | Rust equivalent |
|---------|------|-----------------|
| [`@merkleforge/core`](packages/merkle-core) | `HashFunction` and `MerkleTree` interfaces, proofs, `MerkleError`, byte helpers | `merkle-core` |
| [`@merkleforge/hash`](packages/merkle-hash) | `Sha256`, `Keccak256`, `Blake3` adapters | `merkleforge-hash` |
| [`@merkleforge/variants`](packages/merkle-variants) | `BinaryMerkleTree` (with multiproofs), `SparseMerkleTree`, `MerklePatriciaTrie`, proof codecs | `merkle-variants` |
| [`@merkleforge/hash-wasm`](packages/merkle-hash-wasm) | WebAssembly `Keccak256` and `Sha256`, identical output, about 6x faster Keccak | none |
| [`@merkleforge/ethereum`](packages/merkle-ethereum) | Verify `eth_getProof` account and storage proofs against a state root | none |

| Variant | Use it for | Proofs |
|---------|------------|--------|
| `BinaryMerkleTree` | A known, ordered list of leaves (airdrops, batches, receipts) | Inclusion, `O(log n)` |
| `SparseMerkleTree` | Key-value state over 256-bit keys (rollups, registries) | Membership and non-membership |
| `MerklePatriciaTrie` | Ethereum-compatible tries; with `Keccak256` roots match Ethereum | RLP witnesses, membership and non-membership |

## Install

```sh
npm i @merkleforge/variants @merkleforge/hash @merkleforge/core
```

Staging builds from `develop` are published under the `next` tag:

```sh
npm i @merkleforge/variants@next @merkleforge/hash@next @merkleforge/core@next
```

## Usage

```ts
import { toHex, utf8 } from '@merkleforge/core'
import { Keccak256 } from '@merkleforge/hash'
import { BinaryMerkleTree } from '@merkleforge/variants'

const leaves = ['alice:100', 'bob:250', 'carol:75'].map(utf8)
const tree = BinaryMerkleTree.fromLeaves(Keccak256, leaves)

const root = tree.root()! // Uint8Array
const proof = tree.generateProof(1)

BinaryMerkleTree.verify(Keccak256, root, utf8('bob:250'), proof) // true
console.log(toHex(root))
```

Sparse Merkle tree with non-membership proofs:

```ts
import { SparseMerkleTree } from '@merkleforge/variants'

const smt = new SparseMerkleTree(Keccak256)
const alice = Keccak256.hash(utf8('alice')) // any 32-byte key
smt.insert(alice, utf8('balance:100'))

const proof = smt.generateMembershipProof(alice)
SparseMerkleTree.verifyMembership(Keccak256, smt.root()!, alice, utf8('balance:100'), proof) // true
```

Ethereum-compatible Patricia trie:

```ts
import { MerklePatriciaTrie } from '@merkleforge/variants'

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
  (single and multiproofs), `MerkleForgeSparse`, `MerkleForgePatricia`, and
  `MerkleForgeEthereum` (on-chain `eth_getProof` account and storage checks)
  for Keccak-256 proofs. `toSolidityBinaryProof`, `toSolidityBinaryMultiProof`,
  and `toSoliditySparseProof` shape proofs for calldata. Gas figures are in
  [contracts/README.md](contracts/README.md).
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

## Releases

Releases use [Changesets](https://github.com/changesets/changesets). Add one
with `pnpm changeset` in any PR that changes a package. All packages share one
version.

| Branch | npm tag | Version | GitHub |
|--------|---------|---------|--------|
| `develop` (staging) | `next` | `0.2.0-next.20261018193000`, on every push with pending changesets | Prerelease |
| `main` (stable) | `latest` | `0.2.0`, when the "Version packages" PR is merged | Release `v0.2.0` |

Merging `develop` into `main` opens the "Version packages" PR, which bumps
versions and writes the changelogs. Merging that PR publishes to npm and
creates the GitHub release. See the [releases page](https://github.com/1888-Labs/MerkleForge-ts/releases).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately via [SECURITY.md](.github/SECURITY.md).
MerkleForge has not been independently audited.

## Projects using MerkleForge

- **[ProofStream](https://github.com/1888-Labs/ProofStream)**: commits live DEX
  activity with a Keccak-256 binary tree so a browser can verify a single
  record against the dataset root.

Built something with MerkleForge? Open a PR to add it here.

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs), led by [Blessing Samuel](https://github.com/dicethedev), and open-source contributors.
Brand assets and usage rules: [MerkleForge brand kit](https://github.com/1888-Labs/MerkleForge/blob/main/assets/brand/BRAND.md).*
