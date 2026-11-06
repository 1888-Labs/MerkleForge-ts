// Byte-for-byte parity on the benchmark's own inputs: before any speed number
// means anything, MerkleForge has to produce exactly the same bytes as the
// thing it is compared with or claims compatibility with.
//
// - @merkleforge/openzeppelin vs @openzeppelin/merkle-tree: root, full tree
//   dump (every node), every sampled proof, and a multiproof.
// - @merkleforge/hash-wasm vs @merkleforge/hash: root and every encoded proof.
// - @merkleforge/variants vs the Rust crates (merkle-variants on crates.io
//   source, run live through scripts/rust-vectors): root and the bincode bytes
//   of every sampled proof, for Keccak-256 and SHA-256.
// - keccak256 vs @noble/hashes keccak_256: every input length 0..1024 plus
//   random inputs.
//
// Run `npm run parity` (needs `pnpm build`, and cargo plus the Rust repo at
// ../MerkleForge for the Rust rows; RUST=0 skips them). Exits non-zero on any
// mismatch. Writes parity.json.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  SimpleMerkleTree as OzSimple,
  StandardMerkleTree as OzStandard,
} from '@openzeppelin/merkle-tree'
import { encodeMerkleProof, toHex } from '../packages/merkle-core/dist/index.js'
import { Keccak256, keccak256, Sha256 } from '../packages/merkle-hash/dist/index.js'
import { createKeccak256Wasm } from '../packages/merkle-hash-wasm/dist/index.js'
import { SimpleMerkleTree, StandardMerkleTree } from '../packages/merkle-openzeppelin/dist/index.js'
import { BinaryMerkleTree } from '../packages/merkle-variants/dist/index.js'
import { inputs } from './inputs.mjs'

const SIZES = (process.env.SIZES ?? '1024,16384,131072').split(',').map(Number)
const OPS = Number(process.env.OPS ?? 2000)
const RUST = process.env.RUST !== '0'
const KeccakWasm = await createKeccak256Wasm()

const rows = []
let failed = false
function check(check, against, n, compared, ok) {
  rows.push({ check, against, n, compared, identical: ok })
  if (!ok) failed = true
  const leaves = n === null ? '' : n.toLocaleString('en-US')
  console.log(
    `| ${check} | ${against} | ${leaves} | ${compared} | ${ok ? 'identical' : '**MISMATCH**'} |`,
  )
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function rustParity(leaves, indices) {
  const dir = mkdtempSync(join(tmpdir(), 'merkleforge-parity-'))
  try {
    writeFileSync(join(dir, 'leaves.bin'), concat(leaves))
    writeFileSync(join(dir, 'indices.bin'), new Uint8Array(Uint32Array.from(indices).buffer))
    const out = execFileSync(
      'cargo',
      [
        'run',
        '-q',
        '--release',
        '--bin',
        'parity',
        '--',
        join(dir, 'leaves.bin'),
        join(dir, 'indices.bin'),
      ],
      {
        cwd: new URL('../scripts/rust-vectors/', import.meta.url).pathname, // its rust-toolchain.toml
        maxBuffer: 1 << 30,
        encoding: 'utf8',
      },
    )
    return JSON.parse(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('| Check | Against | Leaves | Compared | Result |')
console.log('|---|---|---:|---|---|')

// Keccak-256 primitive.
{
  let count = 0
  let ok = true
  for (let len = 0; len <= 1024; len++, count++) {
    const d = Uint8Array.from({ length: len }, (_, i) => (i * 131 + len) & 0xff)
    ok &&= toHex(keccak256(d)) === toHex(keccak_256(d))
  }
  for (let k = 0; k < 100_000; k++, count++) {
    const d = Uint8Array.from({ length: k % 200 }, () => Math.floor(Math.random() * 256))
    ok &&= toHex(keccak256(d)) === toHex(keccak_256(d))
  }
  check(
    '`keccak256` (@merkleforge/hash)',
    '`keccak_256` (@noble/hashes 2.4.0)',
    null,
    `${count.toLocaleString('en-US')} digests, lengths 0–1024 + random`,
    ok,
  )
}

for (const n of SIZES) {
  const { leaves, indices, accounts } = inputs(n, OPS)
  const multi = indices.slice(0, 64)

  // OpenZeppelin SimpleMerkleTree.
  {
    const a = SimpleMerkleTree.of(leaves)
    const b = OzSimple.of(leaves)
    const ok =
      a.root === b.root &&
      same(a.dump(), b.dump()) &&
      indices.every((i) => same(a.getProof(i), b.getProof(i))) &&
      same(a.getMultiProof(multi), b.getMultiProof(multi))
    check(
      '`SimpleMerkleTree` (@merkleforge/openzeppelin)',
      '@openzeppelin/merkle-tree 1.0.8',
      n,
      `root, full dump (${(2 * n - 1).toLocaleString('en-US')} nodes), ${OPS} proofs, 1 multiproof`,
      ok,
    )
  }

  // OpenZeppelin StandardMerkleTree ([address, uint256]).
  {
    const types = ['address', 'uint256']
    const a = StandardMerkleTree.of(accounts, types)
    const b = OzStandard.of(accounts, types)
    const ok =
      a.root === b.root &&
      same(a.dump(), b.dump()) &&
      indices.every((i) => same(a.getProof(i), b.getProof(i))) &&
      same(a.getMultiProof(multi), b.getMultiProof(multi))
    check(
      '`StandardMerkleTree` (@merkleforge/openzeppelin)',
      '@openzeppelin/merkle-tree 1.0.8',
      n,
      `root, full dump (${(2 * n - 1).toLocaleString('en-US')} nodes), ${OPS} proofs, 1 multiproof`,
      ok,
    )
  }

  // WebAssembly vs pure JS.
  const js = BinaryMerkleTree.fromLeaves(Keccak256, leaves)
  const jsProofs = indices.map((i) => encodeMerkleProof(js.generateProof(i)))
  {
    const wasm = BinaryMerkleTree.fromLeaves(KeccakWasm, leaves)
    const ok =
      toHex(wasm.root()) === toHex(js.root()) &&
      indices.every(
        (i, k) => toHex(encodeMerkleProof(wasm.generateProof(i))) === toHex(jsProofs[k]),
      )
    check(
      '`BinaryMerkleTree` + @merkleforge/hash-wasm',
      '`BinaryMerkleTree` + @merkleforge/hash (pure JS)',
      n,
      `root, ${OPS} encoded proofs`,
      ok,
    )
  }

  // Rust crates, live.
  if (RUST) {
    const rust = rustParity(leaves, indices)
    for (const [hasher, r] of [
      [Keccak256, rust[0]],
      [Sha256, rust[1]],
    ]) {
      const tree = hasher === Keccak256 ? js : BinaryMerkleTree.fromLeaves(hasher, leaves)
      const proofs =
        hasher === Keccak256
          ? jsProofs
          : indices.map((i) => encodeMerkleProof(tree.generateProof(i)))
      const ok = toHex(tree.root()) === `0x${r.root}` && toHex(concat(proofs)) === `0x${r.proofs}`
      check(
        `\`BinaryMerkleTree\` ${r.algorithm} (@merkleforge/variants)`,
        'Rust `merkle-variants` `BinaryMerkleTree`',
        n,
        `root, bincode bytes of ${OPS} proofs`,
        ok,
      )
    }
  }
}

writeFileSync(
  new URL('./parity.json', import.meta.url),
  `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), node: process.version, ops: OPS, rows }, null, 2)}\n`,
)
if (failed) {
  console.error('\nParity FAILED: at least one output differs.')
  process.exit(1)
}
console.log('\nEvery output is byte-for-byte identical.')
