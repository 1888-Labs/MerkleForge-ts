import { fromHex, isMerkleError, toHex, utf8 } from '@1888-labs/merkle-core'
import { Blake3, Keccak256, Sha256 } from '@1888-labs/merkle-hash'
import { describe, expect, it } from 'vitest'
import { bitAt, SPARSE_TREE_DEPTH, type SparseMerkleProof, SparseMerkleTree } from '../src/index.js'
import vectors from './rust-variant-vectors.json' with { type: 'json' }

const hashers = { 'SHA-256': Sha256, 'Keccak-256': Keccak256, BLAKE3: Blake3 }
const key = (i: number) => Sha256.hash(utf8(`key-${i}`))
const adjacent = (i: number) => {
  const k = key(1000)
  k[31] = i
  return k
}
const value = (i: number) => utf8(`value-${i}`)
const hexes = (list: readonly (Uint8Array | null)[]) =>
  list.map((b) => (b === null ? null : toHex(b)))
const allKeys = () => [
  ...Array.from({ length: 20 }, (_, i) => key(i)),
  ...Array.from({ length: 6 }, (_, i) => adjacent(i)),
]

function populated(H: (typeof hashers)[keyof typeof hashers]) {
  const tree = new SparseMerkleTree(H)
  allKeys().forEach((k, i) => {
    tree.insert(k, value(i))
  })
  return tree
}

describe.each(vectors.hashes)(
  'SparseMerkleTree<$algorithm> matches the Rust crate',
  ({ algorithm, sparse: v }) => {
    const H = hashers[algorithm as keyof typeof hashers]

    it('has the same empty root', () => {
      const tree = new SparseMerkleTree(H)
      expect(tree.root()).toBeUndefined()
      expect(toHex(tree.emptyRoot())).toBe(v.emptyRoot)
      expect(tree.emptyHashAt(0)).toEqual(H.empty())
    })

    it('matches every root and stored node count while inserting', () => {
      const tree = new SparseMerkleTree(H)
      allKeys().forEach((k, i) => {
        tree.insert(k, value(i))
        expect(toHex(tree.root() ?? new Uint8Array())).toBe(v.insertRoots[i])
        expect(tree.storedNodeCount).toBe(v.insertStoredNodeCounts[i])
      })
      expect(tree.unbatchedNodeCountEstimate()).toBe(v.unbatchedNodeCountEstimate)
    })

    it('produces the same membership proof', () => {
      const tree = populated(H)
      const proof = tree.generateMembershipProof(key(3))
      expect(toHex(proof.key)).toBe(v.membership.key)
      expect(proof.leaf && toHex(proof.leaf)).toBe(v.membership.leaf)
      expect(hexes(proof.siblings)).toEqual(v.membership.siblings)
      const root = fromHex(v.root)
      expect(SparseMerkleTree.verifyMembership(H, root, key(3), value(3), proof)).toBe(true)
    })

    it('produces the same non-membership proof', () => {
      const tree = populated(H)
      const absent = Sha256.hash(utf8('absent'))
      const proof = tree.generateMembershipProof(absent)
      expect(proof.leaf).toBeNull()
      expect(hexes(proof.siblings)).toEqual(v.nonMembership.siblings)
      expect(SparseMerkleTree.verifyNonMembership(H, fromHex(v.root), absent, proof)).toBe(true)
    })

    it('removes, batch inserts, and batch removes the same way', () => {
      const tree = populated(H)
      for (const r of v.removals) {
        tree.remove(fromHex(r.key))
        expect(toHex(tree.root() ?? new Uint8Array())).toBe(r.root)
        expect(tree.storedNodeCount).toBe(r.storedNodeCount)
        expect(tree.lastNodeAccessCount).toBe(r.lastNodeAccessCount)
      }

      const updates: [Uint8Array, Uint8Array][] = Array.from({ length: 10 }, (_, j) => [
        key(20 + j),
        value(20 + j),
      ])
      updates.push([key(1), utf8('overwritten')], [key(21), utf8('last-wins')])
      tree.batchInsert(updates)
      expect(toHex(tree.root() ?? new Uint8Array())).toBe(v.batchInsert.root)
      expect(tree.leafCount).toBe(v.batchInsert.leafCount)
      expect(tree.storedNodeCount).toBe(v.batchInsert.storedNodeCount)
      expect(tree.lastNodeAccessCount).toBe(v.batchInsert.lastNodeAccessCount)

      tree.batchRemove([key(20), key(2), adjacent(0), key(20)])
      expect(toHex(tree.root() ?? new Uint8Array())).toBe(v.batchRemove.root)
      expect(tree.leafCount).toBe(v.batchRemove.leafCount)
      expect(tree.storedNodeCount).toBe(v.batchRemove.storedNodeCount)
    })

    it('matches the index-addressed MerkleTree view', () => {
      const view = new SparseMerkleTree(H).indexed()
      for (let i = 0; i < 5; i++) view.insert(utf8(`leaf-${i}`))
      view.remove(2)
      expect(view.insert(utf8('leaf-again'))).toBe(v.indexed.nextIndex)
      expect(view.leafCount).toBe(v.indexed.leafCount)
      expect(toHex(view.root() ?? new Uint8Array())).toBe(v.indexed.root)
      const proof = view.generateProof(1)
      expect(proof.path.map((n) => ({ hash: toHex(n.hash), side: n.side }))).toEqual(
        v.indexed.proof1,
      )
    })
  },
)

describe('SparseMerkleTree', () => {
  it('batch and sequential inserts give the same tree', () => {
    const a = populated(Keccak256)
    const b = new SparseMerkleTree(Keccak256)
    b.batchInsert(allKeys().map((k, i) => [k, value(i)] as const))
    expect(b.root()).toEqual(a.root())
    expect(b.storedNodeCount).toBe(a.storedNodeCount)
  })

  it('round-trips through JSON with identical storage', () => {
    const tree = populated(Sha256)
    const restored = SparseMerkleTree.fromJSON(Sha256, JSON.parse(JSON.stringify(tree)))
    expect(restored.root()).toEqual(tree.root())
    expect(restored.storedNodeCount).toBe(tree.storedNodeCount)
    expect(() => SparseMerkleTree.fromJSON(Blake3, tree.toJSON())).toThrow(/built with SHA-256/)
  })

  it('removing every leaf returns to the empty tree', () => {
    const tree = populated(Blake3)
    tree.batchRemove(allKeys())
    expect(tree.isEmpty()).toBe(true)
    expect(tree.root()).toBeUndefined()
    expect(tree.storedNodeCount).toBe(0)
    expect(tree.height).toBe(0)
  })

  it('rejects tampered or mismatched proofs', () => {
    const tree = populated(Sha256)
    const root = tree.root() ?? new Uint8Array()
    const proof = tree.generateMembershipProof(key(4))
    const flipped = proof.siblings.map((s) => s)
    const firstReal = flipped.findIndex((s) => s !== null)
    const sibling = flipped[firstReal] as Uint8Array
    flipped[firstReal] = sibling.map((b, i) => (i === 0 ? b ^ 1 : b))
    const bad: SparseMerkleProof[] = [
      { ...proof, siblings: flipped },
      { ...proof, siblings: proof.siblings.slice(1) },
      { ...proof, leaf: null },
    ]
    for (const p of bad)
      expect(SparseMerkleTree.verifyMembership(Sha256, root, key(4), value(4), p)).toBe(false)
    expect(SparseMerkleTree.verifyMembership(Sha256, root, key(5), value(4), proof)).toBe(false)
    expect(SparseMerkleTree.verifyMembership(Sha256, root, key(4), utf8('nope'), proof)).toBe(false)
    expect(SparseMerkleTree.verifyNonMembership(Sha256, root, key(4), proof)).toBe(false)
  })

  it('validates keys and data', () => {
    const tree = new SparseMerkleTree(Sha256)
    expect(() => tree.insert(new Uint8Array(31), utf8('x'))).toThrow(TypeError)
    expect(() => tree.insert(key(0), new Uint8Array())).toThrow(
      expect.objectContaining({ code: 'EmptyLeafData' }),
    )
    try {
      tree.remove(key(0))
      expect.unreachable()
    } catch (error) {
      expect(isMerkleError(error, 'UnsupportedOperation')).toBe(true)
    }
    expect(() => tree.indexed().generateProof(0)).toThrow(
      expect.objectContaining({ code: 'EmptyTree' }),
    )
  })

  it('reads bits most-significant first', () => {
    const k = new Uint8Array(32)
    k[0] = 0b1000_0000
    k[31] = 0b0000_0001
    expect(bitAt(k, 0)).toBe(true)
    expect(bitAt(k, 1)).toBe(false)
    expect(bitAt(k, SPARSE_TREE_DEPTH - 1)).toBe(true)
    expect(() => bitAt(k, SPARSE_TREE_DEPTH)).toThrow(RangeError)
  })
})
