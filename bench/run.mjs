// Compares MerkleForge with other JavaScript Merkle tree libraries on the same
// machine and inputs. Run `pnpm build` in the repo root, then `npm install`
// and `npm run bench` here. Results go to stdout and results.json.
//
// Every library builds a tree from the same random 32-byte leaves, generates
// proofs for the same random indices, and verifies them. Sizes are powers of
// two so fixed-depth trees (Aztec) are full and comparable to the others.
import { writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  SimpleMerkleTree as OzSimple,
  StandardMerkleTree as OzStandard,
} from '@openzeppelin/merkle-tree'
import { MerkleTree as MerkleTreeJs } from 'merkletreejs'
import { toHex } from '../packages/merkle-core/dist/index.js'
import { Keccak256 } from '../packages/merkle-hash/dist/index.js'
import { createKeccak256Wasm } from '../packages/merkle-hash-wasm/dist/index.js'
import { SimpleMerkleTree, StandardMerkleTree } from '../packages/merkle-openzeppelin/dist/index.js'
import { BinaryMerkleTree } from '../packages/merkle-variants/dist/index.js'
import { aztecCases } from './aztec.mjs'

const SIZES = (process.env.SIZES ?? '1024,16384,131072').split(',').map(Number)
const OPS = Number(process.env.OPS ?? 2000)
const BUILD_RUNS = Number(process.env.BUILD_RUNS ?? 3)

// Deterministic inputs so every library sees the same leaves and indices.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

function inputs(n) {
  const rand = rng(n)
  const leaves = Array.from({ length: n }, () => {
    const b = new Uint8Array(32)
    for (let i = 0; i < 32; i++) b[i] = Math.floor(rand() * 256)
    b[0] &= 0x1f // keeps every leaf a valid BN254 field element for the Poseidon2 trees
    return b
  })
  const indices = Array.from({ length: OPS }, () => Math.floor(rand() * n))
  const accounts = leaves.map((leaf, i) => [toHex(leaf.subarray(0, 20)), String(1000n + BigInt(i))])
  return { leaves, indices, accounts }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function time(fn) {
  globalThis.gc?.()
  const start = performance.now()
  const result = await fn()
  return { ms: performance.now() - start, result }
}

/**
 * A case optionally sets up untimed state (`setup()`, e.g. opening a database),
 * builds a tree and returns `{ proof(i), verify(i, proof) }`. Build is
 * timed `BUILD_RUNS` times (median); proofs and verifies are timed over `OPS`
 * random indices (mean per operation).
 */
async function measure(c, n, data) {
  const builds = []
  let tree
  for (let r = 0; r < BUILD_RUNS; r++) {
    await tree?.close?.()
    const context = await c.setup?.() // databases and services, not timed
    const { ms, result } = await time(() => c.build(data, context))
    builds.push(ms)
    tree = result
  }
  // Warm up proof and verify paths so the JIT does not count against small trees.
  for (const i of data.indices.slice(0, 50)) await tree.verify?.(i, await tree.proof(i))
  const proofs = []
  const { ms: proofMs } = await time(async () => {
    for (const i of data.indices) proofs.push(await tree.proof(i))
  })
  let verifyMs = null
  if (tree.verify) {
    const { ms, result: ok } = await time(async () => {
      let all = true
      for (let k = 0; k < data.indices.length; k++) {
        all = (await tree.verify(data.indices[k], proofs[k])) && all
      }
      return all
    })
    if (!ok) throw new Error(`${c.name}: a proof did not verify at n=${n}`)
    verifyMs = ms
  }
  await tree.close?.()
  return {
    library: c.name,
    hash: c.hash,
    n,
    buildMs: median(builds),
    proofUs: (proofMs * 1000) / data.indices.length,
    verifyUs: verifyMs === null ? null : (verifyMs * 1000) / data.indices.length,
  }
}

const noblePair = (a, b) => keccak_256(new Uint8Array([...a, ...b]))
const KeccakWasm = await createKeccak256Wasm()

// bytes32 leaves, Keccak-256 binary tree.
const binaryCases = [
  {
    name: '@merkleforge/variants BinaryMerkleTree',
    hash: 'Keccak-256 (noble)',
    build: ({ leaves }) => {
      const tree = BinaryMerkleTree.fromLeaves(Keccak256, leaves)
      const root = tree.root()
      return {
        proof: (i) => tree.generateProof(i),
        verify: (i, p) => BinaryMerkleTree.verify(Keccak256, root, leaves[i], p),
      }
    },
  },
  {
    name: '@merkleforge/variants BinaryMerkleTree + hash-wasm',
    hash: 'Keccak-256 (WASM)',
    build: ({ leaves }) => {
      const tree = BinaryMerkleTree.fromLeaves(KeccakWasm, leaves)
      const root = tree.root()
      return {
        proof: (i) => tree.generateProof(i),
        verify: (i, p) => BinaryMerkleTree.verify(KeccakWasm, root, leaves[i], p),
      }
    },
  },
  {
    name: '@merkleforge/openzeppelin SimpleMerkleTree',
    hash: 'Keccak-256 (noble)',
    build: ({ leaves }) => {
      const tree = SimpleMerkleTree.of(leaves)
      const root = tree.root
      return {
        proof: (i) => tree.getProof(i),
        verify: (i, p) => SimpleMerkleTree.verify(root, leaves[i], p),
      }
    },
  },
  {
    name: '@openzeppelin/merkle-tree SimpleMerkleTree',
    hash: 'Keccak-256 (noble)',
    build: ({ leaves }) => {
      const tree = OzSimple.of(leaves)
      const root = tree.root
      return {
        proof: (i) => tree.getProof(i),
        verify: (i, p) => OzSimple.verify(root, leaves[i], p),
      }
    },
  },
  {
    name: 'merkletreejs MerkleTree',
    hash: 'Keccak-256 (noble)',
    build: ({ leaves }) => {
      const buffers = leaves.map((l) => Buffer.from(l))
      const tree = new MerkleTreeJs(buffers, (data) => Buffer.from(keccak_256(data)), {
        sortPairs: true,
      })
      const root = tree.getRoot()
      return {
        proof: (i) => tree.getProof(buffers[i], i),
        verify: (i, p) => tree.verify(p, buffers[i], root),
      }
    },
  },
  ...aztecCases({ noblePair }),
]

// The OpenZeppelin airdrop format: [address, uint256] leaves.
const standardCases = [
  {
    name: '@merkleforge/openzeppelin StandardMerkleTree',
    hash: 'Keccak-256 (noble)',
    build: ({ accounts }) => {
      const tree = StandardMerkleTree.of(accounts, ['address', 'uint256'])
      const root = tree.root
      return {
        proof: (i) => tree.getProof(i),
        verify: (i, p) => StandardMerkleTree.verify(root, ['address', 'uint256'], accounts[i], p),
      }
    },
  },
  {
    name: '@openzeppelin/merkle-tree StandardMerkleTree',
    hash: 'Keccak-256 (noble)',
    build: ({ accounts }) => {
      const tree = OzStandard.of(accounts, ['address', 'uint256'])
      const root = tree.root
      return {
        proof: (i) => tree.getProof(i),
        verify: (i, p) => OzStandard.verify(root, ['address', 'uint256'], accounts[i], p),
      }
    },
  },
]

const fmt = (x, digits = 1) => (x === null ? 'n/a' : x.toFixed(digits))
const results = []
for (const [scenario, cases] of [
  ['bytes32 leaves', binaryCases],
  ['OpenZeppelin [address, uint256] leaves', standardCases],
]) {
  console.log(`\n## ${scenario}\n`)
  console.log('| Library | Hash | Leaves | Build (ms) | Proof (µs) | Verify (µs) |')
  console.log('|---|---|---:|---:|---:|---:|')
  for (const n of SIZES) {
    const data = inputs(n)
    for (const c of cases) {
      if (c.maxSize && n > c.maxSize) continue
      const r = await measure(c, n, data)
      results.push({ scenario, ...r })
      console.log(
        `| ${r.library} | ${r.hash} | ${n} | ${fmt(r.buildMs)} | ${fmt(r.proofUs)} | ${fmt(r.verifyUs)} |`,
      )
    }
  }
}

const environment = {
  node: process.version,
  cpu: cpus()[0]?.model,
  os: `${platform()} ${release()}`,
  date: new Date().toISOString(),
  ops: OPS,
  buildRuns: BUILD_RUNS,
}
console.log(`\n${JSON.stringify(environment)}`)
writeFileSync(
  new URL('./results.json', import.meta.url),
  `${JSON.stringify({ environment, results }, null, 2)}\n`,
)
process.exit(0)
