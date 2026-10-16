// Writes contracts/test/fixtures/proofs.json from the built TypeScript packages.
// Run `pnpm fixtures:solidity` (it builds first).
import { writeFileSync } from 'node:fs'
import { toHex, utf8 } from '../packages/merkle-core/dist/index.js'
import { Keccak256 } from '../packages/merkle-hash/dist/index.js'
import {
  BinaryMerkleTree,
  SparseMerkleTree,
  toSolidityBinaryMultiProof,
  toSolidityBinaryProof,
  toSoliditySparseProof,
} from '../packages/merkle-variants/dist/index.js'

const leaves = (n) => Array.from({ length: n }, (_, i) => utf8(`leaf-${i}`))
const binary = []
const multi = []
for (const n of [1, 2, 3, 5, 8, 13, 100]) {
  const data = leaves(n)
  const tree = BinaryMerkleTree.fromLeaves(Keccak256, data)
  const root = toHex(tree.root())
  for (const index of new Set([0, Math.floor(n / 2), n - 1])) {
    const p = toSolidityBinaryProof(tree.generateProof(index))
    binary.push({
      root,
      leaf: toHex(data[index]),
      leafIndex: index,
      leafCount: n,
      siblings: p.siblings,
    })
  }
  const indices = [...new Set([0, Math.floor(n / 3), Math.floor(n / 3) + 1, n - 1])].filter(
    (i) => i < n,
  )
  const p = toSolidityBinaryMultiProof(tree.generateMultiProof(indices))
  multi.push({
    root,
    leaves: indices.map((i) => toHex(data[i])),
    leafIndices: indices,
    leafCount: n,
    hashes: p.hashes,
  })
}

const smt = new SparseMerkleTree(Keccak256)
const keys = Array.from({ length: 40 }, (_, i) => Keccak256.hash(utf8(`key-${i}`)))
smt.batchInsert(keys.map((k, i) => [k, utf8(`value-${i}`)]))
const near = keys[0].slice()
near[31] ^= 1
smt.insert(near, utf8('neighbour'))
const root = toHex(smt.root())
const sparse = []
for (const [key, leaf] of [
  [keys[0], 'value-0'],
  [keys[17], 'value-17'],
  [near, 'neighbour'],
  [Keccak256.hash(utf8('absent')), null],
  [new Uint8Array(32), null],
]) {
  const p = toSoliditySparseProof(smt.generateMembershipProof(key))
  sparse.push({
    root,
    key: p.key,
    member: leaf !== null,
    leaf: leaf === null ? '0x' : toHex(utf8(leaf)),
    siblings: p.siblings,
    bitmap: `0x${p.bitmap.toString(16).padStart(64, '0')}`,
  })
}

const out = {
  binaryCount: binary.length,
  binary,
  multiCount: multi.length,
  multi,
  sparseCount: sparse.length,
  sparse,
}
writeFileSync(
  new URL('../contracts/test/fixtures/proofs.json', import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
)
console.log(
  `wrote ${binary.length} binary, ${multi.length} multi, ${sparse.length} sparse fixtures`,
)
