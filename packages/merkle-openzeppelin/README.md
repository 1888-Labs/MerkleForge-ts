<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@merkleforge/openzeppelin</h1>

<p align="center">Drop-in replacement for <code>@openzeppelin/merkle-tree</code>: the same roots, proofs,<br>multiproofs, and dump JSON, with no ethers or MetaMask dependencies.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@merkleforge/openzeppelin"><img alt="npm" src="https://img.shields.io/npm/v/@merkleforge/openzeppelin?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@merkleforge/openzeppelin"><img alt="downloads" src="https://img.shields.io/npm/dw/@merkleforge/openzeppelin?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@merkleforge/openzeppelin` reimplements `StandardMerkleTree` and
`SimpleMerkleTree` from [`@openzeppelin/merkle-tree`](https://github.com/OpenZeppelin/merkle-tree),
the format most airdrop, allowlist, and claim contracts use. Every root, proof,
multiproof, and `dump()` is identical, so:

- proofs verify on-chain with OpenZeppelin's [`MerkleProof`](https://docs.openzeppelin.com/contracts/5.x/api/utils#MerkleProof) library, unchanged;
- trees you already dumped with OpenZeppelin load as is, and ours load in OpenZeppelin;
- switching is a one-line import change.

It ships its own `abi.encode`, so it depends only on `@merkleforge/core` and
[`@noble/hashes`](https://github.com/paulmillr/noble-hashes), not on
`@metamask/abi-utils` or `ethereum-cryptography`.

## Install

```sh
npm i @merkleforge/openzeppelin
```

## Switch from OpenZeppelin

```diff
- import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
+ import { StandardMerkleTree } from '@merkleforge/openzeppelin'
```

## Usage

Build the tree and save it:

```ts
import { StandardMerkleTree } from '@merkleforge/openzeppelin'
import { writeFileSync } from 'node:fs'

const values = [
  ['0x1111111111111111111111111111111111111111', '5000000000000000000'],
  ['0x2222222222222222222222222222222222222222', '2500000000000000000'],
]

const tree = StandardMerkleTree.of(values, ['address', 'uint256'])
console.log('Merkle root:', tree.root) // put this in your contract

writeFileSync('tree.json', JSON.stringify(tree.dump()))
```

Give each claimant their proof:

```ts
import { readFileSync } from 'node:fs'

const tree = StandardMerkleTree.load(JSON.parse(readFileSync('tree.json', 'utf8')))

for (const [i, [address]] of tree.entries()) {
  if (address === claimant) console.log('Proof:', tree.getProof(i))
}
```

Verify it on-chain with OpenZeppelin Contracts:

```solidity
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

function claim(bytes32[] calldata proof, address account, uint256 amount) external {
    bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    require(MerkleProof.verify(proof, root, leaf), "Invalid proof");
    // ...
}
```

Or off-chain, without the tree:

```ts
StandardMerkleTree.verify(root, ['address', 'uint256'], [account, amount], proof) // true
```

Multiproofs work with `MerkleProof.multiProofVerify`:

```ts
const { leaves, proof, proofFlags } = tree.getMultiProof([0, 1])
```

## API

The API matches `@openzeppelin/merkle-tree` 1.x.

| Export | What it does |
|--------|--------------|
| `StandardMerkleTree.of(values, leafEncoding, { sortLeaves })` | Builds a tree; leaves are `keccak256(keccak256(abi.encode(...value)))` |
| `StandardMerkleTree.load(dump)` | Loads and validates `standard-v1` JSON, from either library |
| `StandardMerkleTree.verify(root, leafEncoding, leaf, proof)` | Checks a proof without the tree |
| `StandardMerkleTree.verifyMultiProof(root, leafEncoding, multiproof)` | Checks a multiproof without the tree |
| `SimpleMerkleTree.of(bytes32Values, { sortLeaves, nodeHash })` | Leaves are `bytes32` values you hashed yourself, with an optional custom node hash |
| `tree.root`, `tree.length`, `tree.at(i)`, `tree.entries()` | The root and the values in input order |
| `tree.getProof(indexOrValue)`, `tree.getMultiProof(indicesOrValues)` | Proofs as `0x` hex, ready for calldata |
| `tree.verify(...)`, `tree.verifyMultiProof(...)` | Checks against this tree's root |
| `tree.dump()`, `tree.render()`, `tree.validate()`, `tree.leafHash(value)`, `tree.leafLookup(value)` | Same as OpenZeppelin |
| `abiEncode(types, values)` | Solidity `abi.encode` for `uint`, `int`, `address`, `bool`, `bytesN`, `bytes`, `string`, arrays, and tuples |
| `standardLeafHash`, `standardNodeHash`, `formatLeaf` | The underlying hash functions |

Values can be given the same ways OpenZeppelin accepts them: integers as
`bigint`, `number`, or a decimal or hex string; addresses and bytes as `0x` hex
or `Uint8Array`; booleans as `true`/`false` or `"true"`/`"false"`.

Errors are `MerkleError` from `@merkleforge/core` (`EmptyTree`,
`IndexOutOfBounds`, `InvalidProofStructure`, `DeserializationError`), or
`TypeError`/`RangeError` for values that do not fit the leaf encoding.

## Performance

Same output, less work: at 131,072 `[address, uint256]` leaves it builds the
tree in 3.1 s against OpenZeppelin's 15.2 s, and generates and verifies proofs
about 2x faster. See [BENCHMARKS.md](https://github.com/1888-Labs/MerkleForge-ts/blob/main/BENCHMARKS.md).

## How it is tested

Every test compares against the real `@openzeppelin/merkle-tree` 1.0.8: random
leaf encodings (nested arrays and tuples included), random values in every
accepted representation, and random tree sizes, checking roots, every proof,
multiproofs, `dump()`, `render()`, and loading dumps in both directions.
`abiEncode` is checked against `@metamask/abi-utils` on the same random inputs.

## Part of MerkleForge

MerkleForge is a set of authenticated data structures for Rust and TypeScript
with matching roots and proofs across languages. All TypeScript packages share
one version.

| Package | What it holds |
|---------|---------------|
| [`@merkleforge/core`](https://www.npmjs.com/package/@merkleforge/core) | Interfaces, proof types, errors, codecs, and byte helpers |
| [`@merkleforge/hash`](https://www.npmjs.com/package/@merkleforge/hash) | SHA-256, Keccak-256, and BLAKE3 adapters |
| [`@merkleforge/hash-wasm`](https://www.npmjs.com/package/@merkleforge/hash-wasm) | WebAssembly Keccak-256 and SHA-256, same digests, faster |
| [`@merkleforge/variants`](https://www.npmjs.com/package/@merkleforge/variants) | Binary, Sparse, and Patricia trees, multiproofs, codecs |
| [`@merkleforge/ethereum`](https://www.npmjs.com/package/@merkleforge/ethereum) | Verify `eth_getProof` account and storage proofs |
| **[`@merkleforge/openzeppelin`](https://www.npmjs.com/package/@merkleforge/openzeppelin)** | OpenZeppelin-compatible `StandardMerkleTree` and `SimpleMerkleTree` |

Staging builds from `develop` are published under the `next` tag
(`npm i @merkleforge/openzeppelin@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
