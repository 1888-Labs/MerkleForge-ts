import { bytesEqual, decodeMerkleProof, encodeMerkleProof, toHex } from '@merkleforge/core'
import { Blake3, Keccak256, Sha256 } from '@merkleforge/hash'
import { createKeccak256Wasm } from '@merkleforge/hash-wasm'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BinaryMerkleTree,
  decodeMptProof,
  decodeSparseProof,
  encodeMptProof,
  encodeSparseProof,
  MerklePatriciaTrie,
  SparseMerkleTree,
} from '../src/index.js'

const hasher = fc.constantFrom(Sha256, Keccak256, Blake3)
const leaf = fc.uint8Array({ minLength: 1, maxLength: 40 })
const flipByte = (bytes: Uint8Array, at: number) =>
  bytes.map((b, i) => (i === at % bytes.length ? b ^ 0xff : b))

describe('BinaryMerkleTree properties', () => {
  it('every leaf proof verifies and any tampering fails', () => {
    fc.assert(
      fc.property(
        hasher,
        fc.array(leaf, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        fc.nat(),
        (H, leaves, pick, at) => {
          const tree = BinaryMerkleTree.fromLeaves(H, leaves)
          const root = tree.root() as Uint8Array
          const index = pick % leaves.length
          const proof = tree.generateProof(index)
          expect(BinaryMerkleTree.verify(H, root, leaves[index] as Uint8Array, proof)).toBe(true)
          expect(
            BinaryMerkleTree.verify(H, root, flipByte(leaves[index] as Uint8Array, at), proof),
          ).toBe(false)
          if (proof.path.length > 0) {
            const path = proof.path.map((n, i) =>
              i === at % proof.path.length ? { ...n, hash: flipByte(n.hash, at) } : n,
            )
            expect(
              BinaryMerkleTree.verify(H, root, leaves[index] as Uint8Array, { ...proof, path }),
            ).toBe(false)
          }
          expect(decodeMerkleProof(encodeMerkleProof(proof))).toEqual(proof)
        },
      ),
    )
  })

  it('building incrementally, in bulk, or from JSON gives the same root', () => {
    fc.assert(
      fc.property(hasher, fc.array(leaf, { minLength: 1, maxLength: 40 }), (H, leaves) => {
        const bulk = BinaryMerkleTree.fromLeaves(H, leaves)
        const incremental = new BinaryMerkleTree(H)
        for (const l of leaves) incremental.insert(l)
        expect(incremental.root()).toEqual(bulk.root())
        expect(BinaryMerkleTree.fromJSON(H, bulk.toJSON()).root()).toEqual(bulk.root())
      }),
    )
  })

  it('multiproofs verify for any subset and match single proofs on their own', () => {
    fc.assert(
      fc.property(
        fc.array(leaf, { minLength: 1, maxLength: 40 }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
        (leaves, picks) => {
          const tree = BinaryMerkleTree.fromLeaves(Keccak256, leaves)
          const proof = tree.generateMultiProof(picks.map((p) => p % leaves.length))
          const items = proof.leafIndices.map((i) => leaves[i] as Uint8Array)
          expect(
            BinaryMerkleTree.verifyMultiProof(Keccak256, tree.root() as Uint8Array, items, proof),
          ).toBe(true)
          const total = proof.leafIndices.reduce(
            (sum, i) => sum + tree.generateProof(i).path.length,
            0,
          )
          expect(proof.hashes.length).toBeLessThanOrEqual(total)
        },
      ),
    )
  })
})

// Keys drawn near each other share long prefixes and exercise shortcut and batch nodes.
const base = Keccak256.hash(Uint8Array.of(1))
const sparseKey = fc.oneof(
  fc.uint8Array({ minLength: 32, maxLength: 32 }),
  fc.nat(255).map((b) => Uint8Array.of(...base.subarray(0, 31), b)),
  fc.nat(0xffff).map((v) => Uint8Array.of(...base.subarray(0, 30), v >> 8, v & 0xff)),
)
type SparseOp =
  | { remove: false; key: Uint8Array; value: Uint8Array }
  | { remove: true; key: Uint8Array }
const sparseOps = fc.array(
  fc.oneof(
    fc.record({ remove: fc.constant(false as const), key: sparseKey, value: leaf }),
    fc.record({ remove: fc.constant(true as const), key: sparseKey }),
  ),
  { maxLength: 30 },
)

describe('SparseMerkleTree properties', () => {
  // The WASM Keccak keeps this fast; it is checked against the pure-JS adapter elsewhere.
  it('any sequence of edits matches a fresh tree built from the final contents', async () => {
    const H = await createKeccak256Wasm()
    fc.assert(
      fc.property(sparseOps, (ops: SparseOp[]) => {
        const tree = new SparseMerkleTree(H)
        const model = new Map<string, [Uint8Array, Uint8Array]>()
        for (const op of ops) {
          const id = toHex(op.key)
          if (op.remove) {
            if (!model.has(id)) continue
            tree.remove(op.key)
            model.delete(id)
          } else {
            tree.insert(op.key, op.value)
            model.set(id, [op.key, op.value])
          }
        }
        const fresh = new SparseMerkleTree(H)
        fresh.batchInsert(model.values())
        expect(tree.leafCount).toBe(model.size)
        expect(tree.root()).toEqual(fresh.root())
        expect(tree.storedNodeCount).toBe(fresh.storedNodeCount)
        expect(SparseMerkleTree.fromJSON(H, tree.toJSON()).root()).toEqual(tree.root())

        const root = tree.root() ?? tree.emptyRoot()
        for (const [key, value] of model.values()) {
          const proof = tree.generateMembershipProof(key)
          expect(SparseMerkleTree.verifyMembership(H, root, key, value, proof)).toBe(true)
          expect(decodeSparseProof(encodeSparseProof(proof))).toEqual(proof)
        }
        for (const op of ops) {
          if (model.has(toHex(op.key))) continue
          const proof = tree.generateMembershipProof(op.key)
          expect(SparseMerkleTree.verifyNonMembership(H, root, op.key, proof)).toBe(true)
        }
      }),
      { numRuns: 60 },
    )
  }, 60_000)
})

// A tiny alphabet makes keys that are prefixes of each other, so branches carry values.
const mptKey = fc
  .array(fc.constantFrom(0x00, 0x01, 0x10, 0xab), { maxLength: 4 })
  .map((b) => Uint8Array.from(b))
const mptEntries = fc.uniqueArray(fc.tuple(mptKey, leaf), {
  selector: ([k]) => toHex(k),
  maxLength: 25,
})

describe('MerklePatriciaTrie properties', () => {
  it('the root does not depend on insertion order', () => {
    fc.assert(
      fc.property(mptEntries, fc.infiniteStream(fc.nat()), (entries, stream) => {
        const a = new MerklePatriciaTrie(Keccak256)
        for (const [k, v] of entries) a.insert(k, v)
        const shuffled = [...entries].sort(() => (stream.next().value % 3) - 1)
        const b = new MerklePatriciaTrie(Keccak256)
        for (const [k, v] of shuffled) b.insert(k, v)
        expect(b.root()).toEqual(a.root())
        expect(b.nodeCount).toBe(a.nodeCount)
      }),
    )
  })

  it('removing entries gives the trie built from what remains', () => {
    fc.assert(
      fc.property(
        mptEntries,
        fc.array(fc.boolean(), { minLength: 25, maxLength: 25 }),
        (entries, drop) => {
          const trie = new MerklePatriciaTrie(Keccak256)
          for (const [k, v] of entries) trie.insert(k, v)
          const kept = entries.filter((_, i) => !drop[i])
          entries.forEach(([k], i) => {
            if (drop[i]) trie.remove(k)
          })
          const fresh = new MerklePatriciaTrie(Keccak256)
          for (const [k, v] of kept) fresh.insert(k, v)
          expect(trie.root()).toEqual(fresh.root())
          expect(trie.nodeCount).toBe(fresh.nodeCount)
          expect(trie.height).toBe(fresh.height)
        },
      ),
    )
  })

  it('proofs verify for present and absent keys and expose the right value', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(mptKey, leaf), {
          selector: ([k]) => toHex(k),
          minLength: 1,
          maxLength: 25,
        }),
        mptKey,
        (entries, probe) => {
          const trie = new MerklePatriciaTrie(Keccak256)
          for (const [k, v] of entries) trie.insert(k, v)
          const root = trie.root() as Uint8Array
          for (const key of [...entries.map(([k]) => k), probe]) {
            const proof = trie.generateProof(key)
            const expected = trie.get(key) ?? null
            expect(proof.value === null ? null : toHex(proof.value)).toBe(
              expected && toHex(expected),
            )
            expect(MerklePatriciaTrie.verifyProof(Keccak256, root, proof)).toBe(true)
            const proven = MerklePatriciaTrie.proveValue(Keccak256, root, key, proof.proofNodes)
            expect(
              proven === null || expected === null
                ? proven === expected
                : bytesEqual(proven, expected),
            ).toBe(true)
            expect(decodeMptProof(encodeMptProof(proof))).toEqual(proof)
            if (proof.value !== null) {
              const forged = { ...proof, value: Uint8Array.of(...proof.value, 1) }
              expect(MerklePatriciaTrie.verifyProof(Keccak256, root, forged)).toBe(false)
            }
          }
        },
      ),
    )
  })
})
