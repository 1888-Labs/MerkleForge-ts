// Runtime check for the built packages, using only standard JavaScript APIs.
// CI runs it on Node, Deno, and Bun (`pnpm build` first) to prove the
// published ESM works outside Node; the full Vitest suite also runs in
// Chromium, Firefox, and WebKit (vitest.browser.config.ts).
//
//   node test/runtime/check.mjs
//   deno run --allow-read test/runtime/check.mjs
//   bun test/runtime/check.mjs
import { bytesEqual, toHex, utf8 } from '../../packages/merkle-core/dist/index.js'
import { verifyEthGetProof } from '../../packages/merkle-ethereum/dist/index.js'
import eth from '../../packages/merkle-ethereum/test/fixtures/mainnet-proofs.json' with {
  type: 'json',
}
import { Blake3, Keccak256, keccak256, Sha256 } from '../../packages/merkle-hash/dist/index.js'
import {
  createKeccak256Wasm,
  createSha256Wasm,
} from '../../packages/merkle-hash-wasm/dist/index.js'
import { StandardMerkleTree } from '../../packages/merkle-openzeppelin/dist/index.js'
import { BinaryMerkleTree, SparseMerkleTree } from '../../packages/merkle-variants/dist/index.js'
import vectors from '../../packages/merkle-variants/test/rust-vectors.json' with { type: 'json' }

const runtime =
  typeof Deno !== 'undefined'
    ? `Deno ${Deno.version.deno}`
    : typeof Bun !== 'undefined'
      ? `Bun ${Bun.version}`
      : `Node ${process.versions.node}`

let checks = 0
function check(ok, what) {
  if (!ok) throw new Error(`${runtime}: ${what}`)
  checks++
}

// Roots match the Rust crates for every hash and size.
const hashers = { 'SHA-256': Sha256, 'Keccak-256': Keccak256, BLAKE3: Blake3 }
const leaves = (n) => Array.from({ length: n }, (_, i) => utf8(`leaf-${i}`))
for (const v of vectors.hashes) {
  const H = hashers[v.algorithm]
  for (const t of v.trees) {
    const tree = BinaryMerkleTree.fromLeaves(H, leaves(t.leafCount))
    check(toHex(tree.root()) === t.root, `${v.algorithm} root for ${t.leafCount} leaves`)
    const last = t.leafCount - 1
    const proof = tree.generateProof(last)
    check(
      BinaryMerkleTree.verify(H, tree.root(), leaves(t.leafCount)[last], proof),
      `${v.algorithm} proof for ${t.leafCount} leaves`,
    )
  }
}

// Known Keccak-256 answer, and the pure-JS sponge across block boundaries.
check(
  toHex(keccak256(new Uint8Array(0))) ===
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  'keccak256 of empty input',
)

// WebAssembly adapters give the same trees as the pure-JS ones.
const wasm = { 'Keccak-256': await createKeccak256Wasm(), 'SHA-256': await createSha256Wasm() }
const data = leaves(1000)
for (const [name, W] of Object.entries(wasm)) {
  const a = BinaryMerkleTree.fromLeaves(W, data).root()
  const b = BinaryMerkleTree.fromLeaves(hashers[name], data).root()
  check(bytesEqual(a, b), `${name} WASM tree equals pure JS`)
  const long = new Uint8Array(500).map((_, i) => i)
  check(bytesEqual(W.hash(long), hashers[name].hash(long)), `${name} WASM multi-block hash`)
}

// Sparse tree round trip.
const smt = new SparseMerkleTree(Keccak256)
const bob = keccak256(utf8('bob'))
smt.insert(keccak256(utf8('alice')), utf8('100'))
smt.insert(bob, utf8('42'))
check(
  SparseMerkleTree.verifyMembership(
    Keccak256,
    smt.root(),
    bob,
    utf8('42'),
    smt.generateMembershipProof(bob),
  ),
  'sparse membership proof',
)

// OpenZeppelin-compatible tree (root from @openzeppelin/merkle-tree's README).
const oz = StandardMerkleTree.of(
  [
    ['0x1111111111111111111111111111111111111111', '5000000000000000000'],
    ['0x2222222222222222222222222222222222222222', '2500000000000000000'],
  ],
  ['address', 'uint256'],
)
check(
  oz.root === '0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77',
  'OpenZeppelin StandardMerkleTree root',
)

// A real mainnet eth_getProof response.
const verified = verifyEthGetProof(eth.stateRoot, eth.contract)
check(verified.account?.nonce === 1n, 'mainnet eth_getProof')

console.log(`${runtime}: ${checks} checks passed`)
