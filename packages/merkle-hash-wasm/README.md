<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@merkleforge/hash-wasm</h1>

<p align="center">WebAssembly Keccak-256 and SHA-256 adapters for MerkleForge.<br>Same digests as <code>@merkleforge/hash</code>, with whole-layer batch hashing and SIMD.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@merkleforge/hash-wasm"><img alt="npm" src="https://img.shields.io/npm/v/@merkleforge/hash-wasm?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@merkleforge/hash-wasm"><img alt="downloads" src="https://img.shields.io/npm/dw/@merkleforge/hash-wasm?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@merkleforge/hash-wasm` is a small WebAssembly module (about 9 KB, no
imports, written in `no_std` Rust in
[`scripts/wasm-hash`](https://github.com/1888-Labs/MerkleForge-ts/tree/main/scripts/wasm-hash))
embedded in the package, so it loads the same way in Node, Deno, Bun, and
browsers with no bundler configuration and no runtime dependencies beyond
`@merkleforge/core`. The adapters return exactly the same digests and
`algorithmName` as `@merkleforge/hash`, so you can swap them in without
changing any root, proof, or saved tree.

It is fast for two reasons:

- **Batching.** The adapters implement `hashNodePairs` and `hashLeaves`, so
  `BinaryMerkleTree` hashes each whole layer in one call into WebAssembly
  instead of one call per node.
- **SIMD.** Where the engine supports WebAssembly SIMD (every current browser,
  Node, Deno, and Bun), Keccak-256 runs two permutations at once. Older
  engines get a scalar build automatically.

Building a 131,072-leaf Keccak-256 tree takes about 80–110 ms in Node, versus
about 640 ms with the pure-JS adapter and 485 ms with 0.2.2's WebAssembly adapter.
See [BENCHMARKS.md](https://github.com/1888-Labs/MerkleForge-ts/blob/main/BENCHMARKS.md).

> Formerly published as `@1888-labs/merkle-hash-wasm` (deprecated). From 0.2.0, install `@merkleforge/hash-wasm`; the API is unchanged.

## Install

```sh
npm i @merkleforge/hash-wasm @merkleforge/core
```

## Usage

The WASM module loads asynchronously, once:

```ts
import { createKeccak256Wasm } from '@merkleforge/hash-wasm'
import { SparseMerkleTree } from '@merkleforge/variants'

const Keccak256 = await createKeccak256Wasm()
const smt = new SparseMerkleTree(Keccak256)
```

With `@merkleforge/ethereum`:

```ts
import { verifyEthGetProof } from '@merkleforge/ethereum'

const result = verifyEthGetProof(stateRoot, response, { hasher: await createKeccak256Wasm() })
```

## API

| Export | Returns |
|--------|---------|
| `createKeccak256Wasm()` | `Promise<HashFunction>`, interchangeable with `Keccak256` (including Patricia node hashing) |
| `createSha256Wasm()` | `Promise<HashFunction>`, interchangeable with `Sha256` |

Each call creates its own WebAssembly instance; the module is compiled once.
Memory grows as needed for large inputs. BLAKE3 is not offered yet.

## Part of MerkleForge

MerkleForge is a set of authenticated data structures for Rust and TypeScript
with matching roots and proofs across languages. All TypeScript packages share
one version.

| Package | What it holds |
|---------|---------------|
| [`@merkleforge/core`](https://www.npmjs.com/package/@merkleforge/core) | Interfaces, proof types, errors, codecs, and byte helpers |
| [`@merkleforge/hash`](https://www.npmjs.com/package/@merkleforge/hash) | SHA-256, Keccak-256, and BLAKE3 adapters |
| **[`@merkleforge/hash-wasm`](https://www.npmjs.com/package/@merkleforge/hash-wasm)** | WebAssembly Keccak-256 and SHA-256, same digests, faster |
| [`@merkleforge/variants`](https://www.npmjs.com/package/@merkleforge/variants) | Binary, Sparse, and Patricia trees, multiproofs, codecs |
| [`@merkleforge/ethereum`](https://www.npmjs.com/package/@merkleforge/ethereum) | Verify `eth_getProof` account and storage proofs |
| [`@merkleforge/openzeppelin`](https://www.npmjs.com/package/@merkleforge/openzeppelin) | OpenZeppelin-compatible `StandardMerkleTree` and `SimpleMerkleTree` |

Staging builds from `develop` are published under the `next` tag
(`npm i @merkleforge/hash-wasm@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
