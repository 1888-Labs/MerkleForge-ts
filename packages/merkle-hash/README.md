<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@merkleforge/hash</h1>

<p align="center">SHA-256, Keccak-256, and BLAKE3 hash adapters for MerkleForge,<br>with domain-separated leaf and internal-node hashing.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@merkleforge/hash"><img alt="npm" src="https://img.shields.io/npm/v/@merkleforge/hash?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@merkleforge/hash"><img alt="downloads" src="https://img.shields.io/npm/dm/@merkleforge/hash?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@merkleforge/hash` provides ready-made `HashFunction` adapters built on
[`@noble/hashes`](https://github.com/paulmillr/noble-hashes). Every tree in
`@merkleforge/variants` takes one, so switching algorithms is a one-word
change, and each produces the same digests as the Rust `merkleforge-hash` crate.

## Install

```sh
npm i @merkleforge/hash @merkleforge/core
```

## Usage

```ts
import { utf8 } from '@merkleforge/core'
import { Blake3, Keccak256, Sha256 } from '@merkleforge/hash'
import { BinaryMerkleTree } from '@merkleforge/variants'

Keccak256.hash(utf8('leaf')) // Keccak-256(0x00 || "leaf")

const tree = BinaryMerkleTree.fromLeaves(Blake3, [utf8('a'), utf8('b')])
```

## Adapters

| Adapter | Leaf hash | Node hash | Use it for |
|---------|-----------|-----------|------------|
| `Sha256` | `SHA-256(0x00 \|\| data)` | `SHA-256(0x01 \|\| left \|\| right)` | General use, Bitcoin-style systems |
| `Keccak256` | `Keccak-256(0x00 \|\| data)` | `Keccak-256(0x01 \|\| left \|\| right)` | Ethereum, Solidity verifiers, Patricia tries |
| `Blake3` | BLAKE3 `derive_key` leaf context | BLAKE3 `derive_key` node context | Systems already built on BLAKE3 |

The `0x00` / `0x01` prefixes keep a leaf from being passed off as an internal
node (second-preimage protection). With `Keccak256`, `MerklePatriciaTrie`
hashes nodes with plain Keccak-256, so its roots match Ethereum.

For about 6x faster Keccak-256, use
[`@merkleforge/hash-wasm`](https://www.npmjs.com/package/@merkleforge/hash-wasm),
which returns the same digests.

## Part of MerkleForge

MerkleForge is a set of authenticated data structures for Rust and TypeScript
with matching roots and proofs across languages. All TypeScript packages share
one version.

| Package | What it holds |
|---------|---------------|
| [`@merkleforge/core`](https://www.npmjs.com/package/@merkleforge/core) | Interfaces, proof types, errors, codecs, and byte helpers |
| **[`@merkleforge/hash`](https://www.npmjs.com/package/@merkleforge/hash)** | SHA-256, Keccak-256, and BLAKE3 adapters |
| [`@merkleforge/hash-wasm`](https://www.npmjs.com/package/@merkleforge/hash-wasm) | WebAssembly Keccak-256 and SHA-256, same digests, faster |
| [`@merkleforge/variants`](https://www.npmjs.com/package/@merkleforge/variants) | Binary, Sparse, and Patricia trees, multiproofs, codecs |
| [`@merkleforge/ethereum`](https://www.npmjs.com/package/@merkleforge/ethereum) | Verify `eth_getProof` account and storage proofs |

Staging builds from `develop` are published under the `next` tag
(`npm i @merkleforge/hash@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
