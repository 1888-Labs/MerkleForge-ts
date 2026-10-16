# Contributing to MerkleForge for TypeScript

Thanks for helping. This repo is the TypeScript port of
[MerkleForge](https://github.com/1888-Labs/MerkleForge). The Rust crates are the
reference implementation: roots, proofs, and encodings here must match them
byte for byte.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security issues privately as described in [SECURITY.md](.github/SECURITY.md),
not in public issues.

## Good first contributions

- More test vectors and property-style tests (tampered proofs, edge sizes).
- Docs and examples for browser, Deno, and Bun usage.
- Benchmarks for tree builds and proof verification.
- Issues labelled `good first issue`.

## Development setup

You need Node.js 22+ and pnpm (the version is pinned in `package.json`; run
`corepack enable` to pick it up).

```sh
git clone https://github.com/1888-Labs/MerkleForge-ts.git
cd MerkleForge-ts
pnpm install
pnpm check   # lint, typecheck, test, and package checks
```

| Command | What it does |
|---------|--------------|
| `pnpm build` | Compile every package with `tsc -b` into `dist/` |
| `pnpm typecheck` | Type-check sources and tests |
| `pnpm test` | Run Vitest against the sources (no build needed) |
| `pnpm coverage` | Tests with V8 coverage |
| `pnpm lint` / `pnpm format` | Biome lint and format check / auto-fix |
| `pnpm check:packages` | publint and arethetypeswrong on what npm will ship |
| `pnpm fixtures:solidity` | Regenerate `contracts/test/fixtures` from the TypeScript packages |
| `pnpm test:solidity` | Foundry tests for the Solidity verifiers (needs [Foundry](https://getfoundry.sh)) |

## Layout

```
packages/
  merkle-core/       interfaces, proof types, MerkleError, byte helpers, bincode codec
  merkle-hash/       Sha256, Keccak256, Blake3 adapters (@noble/hashes)
  merkle-hash-wasm/  WebAssembly Keccak256 and Sha256 (hash-wasm)
  merkle-variants/   trees, multiproofs, proof codecs, Solidity proof shapes
    test/rust-*.json   expected values generated from the Rust crates
  merkle-ethereum/   eth_getProof verification (mainnet fixtures in test/fixtures)
contracts/           Solidity verifiers + Foundry tests
scripts/rust-vectors/   Rust program that regenerates the vectors
```

## Workflow

1. Branch from `develop` (`feat/...`, `fix/...`, `docs/...`).
2. Make a focused change with tests.
3. If it changes a published package, run `pnpm changeset` and describe the
   change for users. Docs, CI, and test-only changes do not need one.
4. Run `pnpm check`.
5. Open a PR into `develop`. `develop` is merged into `main` to release.

Commits use [Conventional Commits](https://www.conventionalcommits.org/):
`feat(sparse): ...`, `fix(binary): ...`, `test(patricia): ...`, `docs: ...`.

## Matching the Rust implementation

- When porting or changing tree logic, read the matching Rust file in
  `merkle-variants/src/` first and keep the algorithm the same.
- Add or regenerate vectors from the Rust crates rather than hand-writing
  expected hashes, and never edit an expected value just to make a test pass.
- Domain separation (`0x00` leaves, `0x01` nodes, BLAKE3 contexts), binary
  padding, sparse empty hashes and shortcuts, and Patricia RLP/hex-prefix
  encoding are consensus-sensitive. Changes need focused regression tests.
- TypeScript APIs should feel native: throw `MerkleError` instead of returning
  results, use `Uint8Array` for bytes, and pass the `HashFunction` as a value.

## Features without a Rust counterpart

Multiproofs, the Solidity verifiers, `merkle-hash-wasm`, and
`merkle-ethereum` exist only here for now. Keep their formats documented
(the multiproof bincode layout is written as the Rust struct it would be) so
the Rust crates can adopt them without breaking compatibility.

## Pull requests

- Explain the problem, the change, and any compatibility or security impact.
- List the commands you ran.
- Keep unrelated refactors out of the PR.

## Releases (maintainers)

Releases run from `main` with [Changesets](https://github.com/changesets/changesets).
Pending changesets make the Release workflow open a "Version packages" PR.
Merging it publishes all three packages to npm with provenance. The packages
are versioned together.
