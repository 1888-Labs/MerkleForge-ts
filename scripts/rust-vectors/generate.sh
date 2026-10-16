#!/usr/bin/env bash
# Regenerates the Rust reference vectors used by the test suites.
# Requires the Rust repo at ../MerkleForge (relative to this repo's root).
set -euo pipefail
cd "$(dirname "$0")"
root=../..
cargo run -q --release --bin binary | python3 -m json.tool > "$root/packages/merkle-variants/test/rust-vectors.json"
cp "$root/packages/merkle-variants/test/rust-vectors.json" "$root/packages/merkle-hash/test/rust-vectors.json"
cargo run -q --release --bin variants | python3 -m json.tool > "$root/packages/merkle-variants/test/rust-variant-vectors.json"
cargo run -q --release --bin codecs | python3 -m json.tool > "$root/packages/merkle-variants/test/rust-codec-vectors.json"
(cd "$root" && pnpm exec biome format --write packages/*/test/*.json >/dev/null)
echo "Vectors regenerated. Review the diff before committing."
