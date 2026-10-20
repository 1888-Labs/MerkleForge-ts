<p align="center">
  <a href="https://github.com/1888-Labs/MerkleForge-ts">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-white.svg">
      <img alt="MerkleForge" src="https://raw.githubusercontent.com/1888-Labs/MerkleForge/main/assets/brand/svg/mark/merkleforge-mark-black.svg" width="72">
    </picture>
  </a>
</p>

<h1 align="center">@merkleforge/ethereum</h1>

<p align="center">Verify Ethereum <code>eth_getProof</code> responses against a trusted state root,<br>with no trust in the RPC that served them.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@merkleforge/ethereum"><img alt="npm" src="https://img.shields.io/npm/v/@merkleforge/ethereum?style=flat-square&label=npm&color=000000"></a>
  <a href="https://www.npmjs.com/package/@merkleforge/ethereum"><img alt="downloads" src="https://img.shields.io/npm/dm/@merkleforge/ethereum?style=flat-square&label=downloads&color=000000"></a>
  <a href="https://github.com/1888-Labs/MerkleForge-ts/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/1888-Labs/MerkleForge-ts/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-000000?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://1888-labs.github.io/MerkleForge/">Docs</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts">Repository</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge-ts/releases">Releases</a> ·
  <a href="https://github.com/1888-Labs/MerkleForge">Rust crates</a>
</p>

`@merkleforge/ethereum` checks [EIP-1186](https://eips.ethereum.org/EIPS/eip-1186)
proofs: account balance, nonce, code hash, and storage slots. It is built on the
MerkleForge `MerklePatriciaTrie` and tested against real mainnet proofs.

> Formerly published as `@1888-labs/merkle-ethereum` (deprecated). From 0.2.0, install `@merkleforge/ethereum`; the API is unchanged.

## Install

```sh
npm i @merkleforge/ethereum
```

## Usage

```ts
import { toHex } from '@merkleforge/core'
import { mappingSlot, verifyEthGetProof } from '@merkleforge/ethereum'

// stateRoot must come from a source you trust: a light client, or a block header you verified.
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const holder = '0x...'
const slot = mappingSlot(holder, 3n) // balanceOf is mapping slot 3
const response = await rpc('eth_getProof', [WETH, [toHex(slot)], blockTag])

const { account, storage } = verifyEthGetProof(stateRoot, response)
account?.balance // ETH held by the WETH contract, proven
storage[0].value // holder's WETH balance, proven
```

## API

| Export | What it does |
|--------|--------------|
| `verifyEthGetProof(stateRoot, response, options?)` | Checks the account proof, every storage proof, and that the response's own fields agree with them |
| `verifyAccountProof({ stateRoot, address, proof }, options?)` | Returns the `EthAccount`, or `null` when the proof shows it does not exist |
| `verifyStorageProof({ storageRoot, slot, proof }, options?)` | Returns the slot value as a `bigint` (`0n` for an empty slot) |
| `mappingSlot(key, slot)` | Storage slot of `mapping[key]`; nest calls for nested mappings |
| `keccak256`, `toBytes32`, `bytesToBigInt` | Helpers |
| `EMPTY_TRIE_ROOT`, `EMPTY_CODE_HASH` | Roots of empty storage and code |

Every verifier throws `MerkleError` with code `InvalidProof` on a mismatch.
Pass `{ hasher: await createKeccak256Wasm() }` from
[`@merkleforge/hash-wasm`](https://www.npmjs.com/package/@merkleforge/hash-wasm)
to verify faster. For on-chain checks, see `MerkleForgeEthereum` in the
[Solidity verifiers](https://github.com/1888-Labs/MerkleForge-ts/tree/main/contracts).

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
| **[`@merkleforge/ethereum`](https://www.npmjs.com/package/@merkleforge/ethereum)** | Verify `eth_getProof` account and storage proofs |
| [`@merkleforge/openzeppelin`](https://www.npmjs.com/package/@merkleforge/openzeppelin) | OpenZeppelin-compatible `StandardMerkleTree` and `SimpleMerkleTree` |

Staging builds from `develop` are published under the `next` tag
(`npm i @merkleforge/ethereum@next`). MerkleForge has not been independently
audited; report vulnerabilities via the [security policy](https://github.com/1888-Labs/MerkleForge-ts/blob/main/.github/SECURITY.md).

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your option.

---

*Maintained by [1888 Labs](https://github.com/1888-Labs) and open-source contributors.*
