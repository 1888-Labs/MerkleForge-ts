// Aztec cases. @aztec/merkle-tree trees have a fixed depth (here log2(n), so
// they are full like the other trees), live in an LMDB-backed key-value store,
// and take any pair hasher; they run with Keccak-256 and with Aztec's Poseidon2.
// @aztec/world-state is Aztec's native (C++) state, so it runs its own note
// hash tree: depth 42, Poseidon2 with the MERKLE_HASH domain separator, LMDB.
// Proofs are checked with Aztec's computeRootFromSiblingPath.
import { createRequire } from 'node:module'
import { BarretenbergSync } from '@aztec/bb.js'
import { poseidon2Hash, poseidon2HashWithSeparator } from '@aztec/foundation/crypto/sync'
import { Fr } from '@aztec/foundation/curves/bn254'
import { computeRootFromSiblingPath } from '@aztec/foundation/trees'
import { openTmpStore } from '@aztec/kv-store/lmdb'
import { newTree, StandardTree } from '@aztec/merkle-tree'

await BarretenbergSync.initSingleton()

// @aztec/world-state 5.x brings its own @aztec/* 5.x copies; load from those.
const fromWorldState = createRequire(createRequire(import.meta.url).resolve('@aztec/world-state'))
const load = (specifier) => import(fromWorldState.resolve(specifier))
const { NativeWorldStateService } = await load('@aztec/world-state/native')
const { MerkleTreeId } = await load('@aztec/stdlib/trees')
const { Fr: Fr5 } = await load('@aztec/foundation/curves/bn254')
const { computeRootFromSiblingPath: computeRoot5 } = await load('@aztec/foundation/trees')
const { DomainSeparator } = await load('@aztec/constants')

const log2 = (n) => Math.round(Math.log2(n))
const identity = { fromBuffer: (b) => b }
let treeId = 0

function aztecStandardTree(hash, hasher, pairAsync) {
  return {
    name: `@aztec/merkle-tree StandardTree`,
    hash,
    setup: () => openTmpStore(true),
    build: async ({ leaves }, store) => {
      const tree = await newTree(
        StandardTree,
        store,
        hasher,
        `bench-${treeId++}`,
        identity,
        log2(leaves.length),
      )
      tree.appendLeaves(leaves.map((l) => Buffer.from(l)))
      await tree.commit()
      const root = tree.getRoot(false)
      return {
        proof: async (i) => (await tree.getSiblingPath(BigInt(i), false)).toBufferArray(),
        verify: async (i, path) =>
          (await computeRootFromSiblingPath(Buffer.from(leaves[i]), path, i, pairAsync)).equals(
            root,
          ),
        close: () => store.delete?.() ?? store.close?.(),
      }
    },
  }
}

export function aztecCases({ noblePair }) {
  const keccakHasher = {
    hash: (l, r) => Buffer.from(noblePair(l, r)),
    hashInputs: (inputs) => Buffer.from(inputs.reduce((acc, x) => noblePair(acc, x))),
  }
  const poseidonHasher = {
    hash: (l, r) =>
      poseidon2Hash([Fr.fromBuffer(Buffer.from(l)), Fr.fromBuffer(Buffer.from(r))]).toBuffer(),
    hashInputs: (inputs) => poseidon2Hash(inputs.map((i) => Fr.fromBuffer(i))).toBuffer(),
  }
  // Aztec's synchronous Poseidon2; its async default goes through a worker and is far slower.
  const poseidonPair = async (l, r) => poseidonHasher.hash(l, r)
  // Aztec 5.x append-only trees (note hashes) domain-separate node hashes.
  const noteHashPair = async (l, r) =>
    poseidon2HashWithSeparator(
      [Fr.fromBuffer(Buffer.from(l)), Fr.fromBuffer(Buffer.from(r))],
      DomainSeparator.MERKLE_HASH,
    ).toBuffer()
  return [
    aztecStandardTree('Keccak-256 (noble)', keccakHasher, async (l, r) => keccakHasher.hash(l, r)),
    aztecStandardTree('Poseidon2 (bb.js WASM)', poseidonHasher, poseidonPair),
    {
      name: '@aztec/world-state note hash tree (native)',
      hash: 'Poseidon2 (native C++), depth 42',
      setup: async () => {
        const ws = await NativeWorldStateService.ephemeral()
        return { ws, fork: await ws.fork() }
      },
      build: async ({ leaves }, { ws, fork }) => {
        const start = Number((await fork.getTreeInfo(MerkleTreeId.NOTE_HASH_TREE)).size)
        await fork.appendLeaves(
          MerkleTreeId.NOTE_HASH_TREE,
          leaves.map((l) => Fr5.fromBuffer(Buffer.from(l))),
        )
        const root = Buffer.from((await fork.getTreeInfo(MerkleTreeId.NOTE_HASH_TREE)).root)
        return {
          proof: async (i) =>
            (
              await fork.getSiblingPath(MerkleTreeId.NOTE_HASH_TREE, BigInt(start + i))
            ).toBufferArray(),
          verify: async (i, path) =>
            (await computeRoot5(Buffer.from(leaves[i]), path, start + i, noteHashPair)).equals(
              root,
            ),
          close: async () => {
            await fork.close()
            await ws.close()
          },
        }
      },
    },
  ]
}
