<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@1888-labs/merkle-core</h1>

<p align="center">Interfaces, proof types, errors, and byte helpers<br>shared by every MerkleForge package. No tree logic.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@1888-labs/merkle-core"><img alt="npm" src="https://img.shields.io/npm/v/@1888-labs/merkle-core?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@1888-labs/merkle-core"><img alt="downloads" src="https://img.shields.io/npm/dm/@1888-labs/merkle-core?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@1888-labs/merkle-core` is the foundation of MerkleForge for TypeScript. It
holds no tree implementation; it defines the contracts that hash adapters and
tree variants use to work together.

Use it directly when you want to:

- implement your own hash adapter or tree variant;
- pass proofs around, or encode them for Rust, without pulling in the trees;
- handle `MerkleError` in code that only depends on the shared types.

## Install

```sh
npm i @1888-labs/merkle-core
```

## Usage

Bring your own hash. Only `hash` is required; `hashNodes` defaults to
`hash(0x01 || left || right)` and leaves are hashed as `hash(0x00 || data)`.

```ts
import { defineHashFunction } from '@1888-labs/merkle-core'

const MyHash = defineHashFunction({
  algorithmName: 'MyHash',
  digestSize: 32,
  hash: myHashFn,
})
```

Errors are typed and carry a `code`:

```ts
import { isMerkleError } from '@1888-labs/merkle-core'

try {
  tree.generateProof(99)
} catch (error) {
  if (isMerkleError(error, 'IndexOutOfBounds')) console.log(error.detail)
  else throw error
}
```

Proofs encode to the same bytes as Rust's `proof.to_bytes()` (bincode) and the
same JSON as `serde_json`:

```ts
import { decodeMerkleProof, encodeMerkleProof, merkleProofToSerdeJSON } from '@1888-labs/merkle-core'

const bytes = encodeMerkleProof(proof) // send to a Rust service
const same = decodeMerkleProof(bytes)
const json = merkleProofToSerdeJSON(proof)
```

## API

| Export | What it is |
|--------|------------|
| `HashFunction`, `defineHashFunction`, `LEAF_PREFIX`, `NODE_PREFIX` | The hash adapter interface and a helper to build one |
| `MerkleTree`, `ProofVerifier` | The interface every tree implements, and its static verifier |
| `MerkleProof`, `ProofNode`, `ProofSide`, `TreeMetadata`, `proofDepth`, `isTrivialProof` | Proof and metadata types |
| `MerkleError`, `isMerkleError`, `MerkleErrorCode` | Errors, matching Rust's `MerkleError` variants |
| `encodeMerkleProof`, `decodeMerkleProof`, `merkleProofToSerdeJSON`, `merkleProofFromSerdeJSON`, `BincodeReader`, `BincodeWriter` | Rust-compatible proof codecs |
| `Bytes`, `utf8`, `toHex`, `fromHex`, `concatBytes`, `bytesEqual` | Byte helpers |

## Part of MerkleForge

MerkleForge is a set of authenticated data structures for Rust and TypeScript
with matching roots and proofs across languages. All TypeScript packages share
one version.

| Package | What it holds |
|---------|---------------|
| **[`@1888-labs/merkle-core`](https://www.npmjs.com/package/@1888-labs/merkle-core)** | Interfaces, proof types, errors, codecs, and byte helpers |
| [`@1888-labs/merkle-hash`](https://www.npmjs.com/package/@1888-labs/merkle-hash) | SHA-256, Keccak-256, and BLAKE3 adapters |
| [`@1888-labs/merkle-hash-wasm`](https://www.npmjs.com/package/@1888-labs/merkle-hash-wasm) | WebAssembly Keccak-256 and SHA-256, same digests, faster |
| [`@1888-labs/merkle-variants`](https://www.npmjs.com/package/@1888-labs/merkle-variants) | Binary, Sparse, and Patricia trees, multiproofs, codecs |
| [`@1888-labs/merkle-ethereum`](https://www.npmjs.com/package/@1888-labs/merkle-ethereum) | Verify `eth_getProof` account and storage proofs |

Staging builds from `develop` are published under the `next` tag
(`npm i @1888-labs/merkle-core@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
