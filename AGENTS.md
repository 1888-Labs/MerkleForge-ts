# AGENTS.md

Guidance for coding agents working in MerkleForge for TypeScript. It applies
to the whole repository unless a deeper `AGENTS.md` overrides it.

## Project overview

TypeScript port of the [MerkleForge](https://github.com/1888-Labs/MerkleForge)
Rust framework for authenticated data structures, published to npm under the
`@1888-labs` scope. The Rust crates are the reference implementation: roots,
proofs, node encodings, and error behavior must match them.

## Repository map

- `packages/merkle-core/`: `HashFunction`, `MerkleTree`, proof types,
  `MerkleError`, byte helpers. No tree logic and no runtime dependencies.
- `packages/merkle-hash/`: `Sha256`, `Keccak256`, `Blake3` built on
  `@noble/hashes`.
- `packages/merkle-variants/`: `BinaryMerkleTree`, `SparseMerkleTree`,
  `MerklePatriciaTrie`, and Patricia RLP/hex-prefix helpers.
- `packages/*/test/`: Vitest suites. `rust-vectors.json` files are generated
  from the Rust crates; `fixtures/ethereum_trie/` holds the official Ethereum
  trie vectors.
- `.changeset/`: pending release notes. `.github/workflows/`: CI and release.

## Development rules

- Read the matching Rust source and its tests before changing behavior here.
- Keep changes focused. Do not reformat or refactor unrelated code.
- Sources are ESM with `.js` extensions in relative imports (NodeNext).
- Keep `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
  clean. Do not loosen `tsconfig.base.json` to make code compile.
- Public APIs need TSDoc, including what they throw.
- Return copies of internal `Uint8Array` state; never hand out internal buffers.
- `merkle-core` must stay dependency-free. New runtime dependencies elsewhere
  need a clear reason; prefer audited, zero-dependency libraries.
- Never add secrets, tokens, or credentials anywhere, including history.
  The npm token lives only in the `NPM_TOKEN` repository secret.

## Cryptographic invariants

- Preserve leaf/node domain separation for every hash adapter.
- Roots and proofs must be deterministic for identical ordered inputs.
- Verification must return `false` (not throw) for a changed leaf, sibling,
  index, key, or root, and for malformed proofs.
- Binary padding, sparse empty hashes/shortcuts/batches, and Patricia RLP and
  hex-prefix encoding are consensus-sensitive. Changes require regression
  tests against Rust-generated vectors.
- Do not edit Ethereum fixture expectations or Rust vectors to make a test pass.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm check:packages
```

`pnpm check` runs all four. If a check cannot run, say so and why.

## Git and pull requests

- Integration branch is `develop`; `main` is the release branch.
- Conventional Commits: `feat(sparse): ...`, `fix(binary): ...`, `docs: ...`.
- Add a changeset (`pnpm changeset`) when a published package changes.
- Do not push, force-push, publish to npm, or merge release PRs unless the
  user explicitly asks.
