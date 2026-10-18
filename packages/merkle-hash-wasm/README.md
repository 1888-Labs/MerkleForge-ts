<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@1888-labs/merkle-hash-wasm</h1>

<p align="center">WebAssembly Keccak-256 and SHA-256 adapters for MerkleForge.<br>Same digests as <code>@1888-labs/merkle-hash</code>, about 6x faster Keccak.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@1888-labs/merkle-hash-wasm"><img alt="npm" src="https://img.shields.io/npm/v/@1888-labs/merkle-hash-wasm?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@1888-labs/merkle-hash-wasm"><img alt="downloads" src="https://img.shields.io/npm/dm/@1888-labs/merkle-hash-wasm?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@1888-labs/merkle-hash-wasm` wraps [`hash-wasm`](https://github.com/Daninet/hash-wasm).
The adapters return exactly the same digests and `algorithmName` as
`@1888-labs/merkle-hash`, so you can swap them in without changing any root,
proof, or saved tree.

Keccak-256 is about 6x faster than the pure-JS adapter in Node. That matters
most for `SparseMerkleTree`, where every new key costs about 256 hashes, and
for verifying `eth_getProof` responses in bulk. SHA-256 is only slightly faster.

## Install

```sh
npm i @1888-labs/merkle-hash-wasm @1888-labs/merkle-core
```

## Usage

The WASM module loads asynchronously, once:

```ts
import { createKeccak256Wasm } from '@1888-labs/merkle-hash-wasm'
import { SparseMerkleTree } from '@1888-labs/merkle-variants'

const Keccak256 = await createKeccak256Wasm()
const smt = new SparseMerkleTree(Keccak256)
```

With `@1888-labs/merkle-ethereum`:

```ts
import { verifyEthGetProof } from '@1888-labs/merkle-ethereum'

const result = verifyEthGetProof(stateRoot, response, { hasher: await createKeccak256Wasm() })
```

## API

| Export | Returns |
|--------|---------|
| `createKeccak256Wasm()` | `Promise<HashFunction>`, interchangeable with `Keccak256` (including Patricia node hashing) |
| `createSha256Wasm()` | `Promise<HashFunction>`, interchangeable with `Sha256` |

BLAKE3 is not offered because `hash-wasm` has no `derive_key` mode.

## Part of MerkleForge

MerkleForge is a set of authenticated data structures for Rust and TypeScript
with matching roots and proofs across languages. All TypeScript packages share
one version.

| Package | What it holds |
|---------|---------------|
| [`@1888-labs/merkle-core`](https://www.npmjs.com/package/@1888-labs/merkle-core) | Interfaces, proof types, errors, codecs, and byte helpers |
| [`@1888-labs/merkle-hash`](https://www.npmjs.com/package/@1888-labs/merkle-hash) | SHA-256, Keccak-256, and BLAKE3 adapters |
| **[`@1888-labs/merkle-hash-wasm`](https://www.npmjs.com/package/@1888-labs/merkle-hash-wasm)** | WebAssembly Keccak-256 and SHA-256, same digests, faster |
| [`@1888-labs/merkle-variants`](https://www.npmjs.com/package/@1888-labs/merkle-variants) | Binary, Sparse, and Patricia trees, multiproofs, codecs |
| [`@1888-labs/merkle-ethereum`](https://www.npmjs.com/package/@1888-labs/merkle-ethereum) | Verify `eth_getProof` account and storage proofs |

Staging builds from `develop` are published under the `next` tag
(`npm i @1888-labs/merkle-hash-wasm@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
