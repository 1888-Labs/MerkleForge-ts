# Benchmarks

How MerkleForge for TypeScript compares with other JavaScript Merkle tree
libraries: [`@openzeppelin/merkle-tree`](https://github.com/OpenZeppelin/merkle-tree),
[`merkletreejs`](https://github.com/merkletreejs/merkletreejs),
[`@aztec/merkle-tree`](https://www.npmjs.com/package/@aztec/merkle-tree), and
[`@aztec/world-state`](https://www.npmjs.com/package/@aztec/world-state).
All numbers come from one run of [`bench/`](bench) on one machine, so read
them as ratios, not absolutes.

## Summary

At 131,072 leaves:

| Task | MerkleForge | Others |
|---|---|---|
| Build a Keccak-256 tree | **485 ms** with `hash-wasm`, 2,119 ms pure JS | merkletreejs 1,544 ms · Aztec StandardTree 2,669 ms · OpenZeppelin 14,518 ms |
| Build an OpenZeppelin airdrop tree (`[address, uint256]`) | **3,070 ms** (`@merkleforge/openzeppelin`) | OpenZeppelin 15,197 ms (4.9x slower) |
| Generate one proof | **8–11 µs** (`BinaryMerkleTree`) | merkletreejs 37 µs · Aztec 51–53 µs · OpenZeppelin 743 µs |
| Verify one proof | **41 µs** with `hash-wasm`, 148 µs pure JS | Aztec StandardTree 168 µs · merkletreejs 538 µs · OpenZeppelin 474 µs |
| Install footprint | **1–2 dependencies, about 1.4 MB** | merkletreejs 3, 1 MB · OpenZeppelin 38, 16 MB · Aztec merkle-tree 362, 395 MB · Aztec world-state 377, 1.1 GB |

- `@merkleforge/openzeppelin` gives the same roots and proofs as
  `@openzeppelin/merkle-tree` while building trees 4–9x faster, generating
  proofs 2–4x faster, and verifying them about 2x faster.
- With pure-JS Keccak, `BinaryMerkleTree` builds about 1.4x slower than
  merkletreejs because it hashes every leaf with a domain prefix
  (`H(0x00 || leaf)`), which protects against second-preimage attacks. That is
  twice the hashing; merkletreejs uses leaves as nodes directly. With
  `@merkleforge/hash-wasm` it is 3.2x faster than merkletreejs.

## What is measured

Each library builds a tree from the same random 32-byte leaves, generates
proofs for the same 2,000 random leaves, and verifies every proof (a run fails
if any proof does not verify). Build time is the median of 3 builds; proof and
verify times are the mean per operation after a warm-up. Database setup
(Aztec) is not counted.

Sizes are powers of two, so the fixed-depth Aztec trees are full and have the
same depth as the other trees, except `@aztec/world-state`, whose note hash
tree is always 42 levels deep.

What differs between libraries, so the numbers are not like for like:

- **Hash.** MerkleForge, OpenZeppelin, merkletreejs, and one Aztec
  `StandardTree` run use Keccak-256 from `@noble/hashes` (or WebAssembly where
  noted). The other Aztec runs use Poseidon2, a SNARK-friendly hash that costs
  more per call in JavaScript.
- **Storage.** The Aztec trees keep nodes in LMDB and support commit, rollback,
  and snapshots. `@aztec/world-state` is Aztec's native C++ rollup state. The
  other libraries keep the tree in memory.
- **Verification.** OpenZeppelin, merkletreejs, and MerkleForge verify with
  their own functions. The Aztec trees have no verifier on the tree, so their
  proofs are checked with Aztec's `computeRootFromSiblingPath` and Aztec's
  synchronous Poseidon2. For world-state that means 42 Poseidon2 hashes in
  JavaScript per proof, which is why its verify column is high.
- **Proof generation in the OpenZeppelin-compatible trees** re-verifies every
  proof before returning it (both libraries do this), so it is slower than in
  `BinaryMerkleTree`.

## Results

### bytes32 leaves

**1,024 leaves**

| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |
|---|---|---:|---:|---:|
| @merkleforge/variants BinaryMerkleTree | Keccak-256 (noble) | 27.9 | 3.3 | 100 |
| @merkleforge/variants BinaryMerkleTree + hash-wasm | Keccak-256 (WASM) | 6.9 | 2.2 | 27.3 |
| @merkleforge/openzeppelin SimpleMerkleTree | Keccak-256 (noble) | 15.8 | 94.7 | 114 |
| @openzeppelin/merkle-tree SimpleMerkleTree | Keccak-256 (noble) | 104 | 263 | 235 |
| merkletreejs MerkleTree | Keccak-256 (noble) | 12.8 | 2.1 | 98.5 |
| @aztec/merkle-tree StandardTree | Keccak-256 (noble) | 35.3 | 27.4 | 129 |
| @aztec/merkle-tree StandardTree | Poseidon2 (bb.js WASM) | 66.3 | 32.9 | 328 |
| @aztec/world-state note hash tree (native) | Poseidon2 (native C++), depth 42 | 21.7 | 66.9 | 1257 |

**16,384 leaves**

| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |
|---|---|---:|---:|---:|
| @merkleforge/variants BinaryMerkleTree | Keccak-256 (noble) | 276 | 9.3 | 128 |
| @merkleforge/variants BinaryMerkleTree + hash-wasm | Keccak-256 (WASM) | 65.3 | 5.5 | 31.7 |
| @merkleforge/openzeppelin SimpleMerkleTree | Keccak-256 (noble) | 173 | 124 | 174 |
| @openzeppelin/merkle-tree SimpleMerkleTree | Keccak-256 (noble) | 1631 | 328 | 306 |
| merkletreejs MerkleTree | Keccak-256 (noble) | 144 | 3.1 | 120 |
| @aztec/merkle-tree StandardTree | Keccak-256 (noble) | 429 | 44.4 | 165 |
| @aztec/merkle-tree StandardTree | Poseidon2 (bb.js WASM) | 701 | 50.9 | 403 |
| @aztec/world-state note hash tree (native) | Poseidon2 (native C++), depth 42 | 313 | 74.2 | 1251 |

**131,072 leaves**

| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |
|---|---|---:|---:|---:|
| @merkleforge/variants BinaryMerkleTree | Keccak-256 (noble) | 2119 | 10.8 | 148 |
| @merkleforge/variants BinaryMerkleTree + hash-wasm | Keccak-256 (WASM) | 485 | 8.2 | 40.8 |
| @merkleforge/openzeppelin SimpleMerkleTree | Keccak-256 (noble) | 1561 | 176 | 204 |
| @openzeppelin/merkle-tree SimpleMerkleTree | Keccak-256 (noble) | 14518 | 743 | 474 |
| merkletreejs MerkleTree | Keccak-256 (noble) | 1544 | 36.9 | 538 |
| @aztec/merkle-tree StandardTree | Keccak-256 (noble) | 2669 | 51.9 | 167 |
| @aztec/merkle-tree StandardTree | Poseidon2 (bb.js WASM) | 4672 | 50.7 | 392 |
| @aztec/world-state note hash tree (native) | Poseidon2 (native C++), depth 42 | 2007 | 52.9 | 988 |

### OpenZeppelin [address, uint256] leaves

**1,024 leaves**

| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |
|---|---|---:|---:|---:|
| @merkleforge/openzeppelin StandardMerkleTree | Keccak-256 (noble) | 28.4 | 85.8 | 103 |
| @openzeppelin/merkle-tree StandardMerkleTree | Keccak-256 (noble) | 125 | 230 | 220 |

**16,384 leaves**

| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |
|---|---|---:|---:|---:|
| @merkleforge/openzeppelin StandardMerkleTree | Keccak-256 (noble) | 386 | 115 | 131 |
| @openzeppelin/merkle-tree StandardMerkleTree | Keccak-256 (noble) | 1874 | 289 | 271 |

**131,072 leaves**

| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |
|---|---|---:|---:|---:|
| @merkleforge/openzeppelin StandardMerkleTree | Keccak-256 (noble) | 3070 | 141 | 171 |
| @openzeppelin/merkle-tree StandardMerkleTree | Keccak-256 (noble) | 15197 | 333 | 320 |

Node v24.15.0, 11th Gen Intel(R) Core(TM) i7-1185G7 @ 3.00GHz, linux 7.0.0-38-generic. Build is the median of 3 runs; proof and verify are the mean over 2000 random leaves.

## Install footprint

Dependencies installed with each library, not counting the library itself,
and the total size of the library plus its dependencies.

| Library | Dependencies | Size |
|---|---:|---:|
| `@merkleforge/core` + `hash` + `variants` | 1 (`@noble/hashes`) | 1.4 MB |
| `@merkleforge/openzeppelin` | 2 (`@merkleforge/core`, `@noble/hashes`) | 1.1 MB |
| `merkletreejs` 0.6.0 | 3 | 1 MB |
| `@openzeppelin/merkle-tree` 1.0.8 | 38 | 16 MB |
| `@aztec/merkle-tree` 4.4.0 | 362 | 395 MB |
| `@aztec/world-state` 5.2.1 | 377 | 1.1 GB |

The Aztec packages bring Aztec's prover (`bb.js`), native bindings, LMDB, an
HTTP server, and Ethereum tooling. They are built for running an Aztec node,
not as general-purpose tree libraries.

## Reproduce

```sh
pnpm install && pnpm build   # in the repo root
cd bench
npm install                  # comparison libraries, kept out of the pnpm workspace
npm run bench                # writes results.json; SIZES, OPS, and BUILD_RUNS env vars adjust the run
node report.mjs              # prints the tables above
```
