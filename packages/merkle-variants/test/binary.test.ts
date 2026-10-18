import { fromHex, isMerkleError, type MerkleProof, toHex, utf8 } from '@merkleforge/core'
import { Blake3, Keccak256, Sha256 } from '@merkleforge/hash'
import { describe, expect, it } from 'vitest'
import { BinaryMerkleTree } from '../src/index.js'
import vectors from './rust-vectors.json' with { type: 'json' }

const hashers = { 'SHA-256': Sha256, 'Keccak-256': Keccak256, BLAKE3: Blake3 }
const leaves = (n: number) => Array.from({ length: n }, (_, i) => utf8(`leaf-${i}`))

describe.each(vectors.hashes)('BinaryMerkleTree<$algorithm> matches the Rust crate', (v) => {
  const H = hashers[v.algorithm as keyof typeof hashers]

  it.each(v.trees)('builds the same root for $leafCount leaves', (t) => {
    const tree = BinaryMerkleTree.fromLeaves(H, leaves(t.leafCount))
    expect(tree.leafCount).toBe(t.leafCount)
    expect(tree.height).toBe(t.height)
    expect(toHex(tree.root() ?? new Uint8Array())).toBe(t.root)
  })

  it.each(v.trees)('builds the same root by inserting $leafCount leaves', (t) => {
    const tree = new BinaryMerkleTree(H)
    for (const leaf of leaves(t.leafCount)) tree.insert(leaf)
    expect(toHex(tree.root() ?? new Uint8Array())).toBe(t.root)
  })

  it.each(v.trees)('produces the same proof for the last of $leafCount leaves', (t) => {
    const tree = BinaryMerkleTree.fromLeaves(H, leaves(t.leafCount))
    const proof = tree.generateProof(t.leafCount - 1)
    expect(proof.path.map((n) => ({ hash: toHex(n.hash), side: n.side }))).toEqual(t.lastProof)
    expect(
      BinaryMerkleTree.verify(H, fromHex(t.root), utf8(`leaf-${t.leafCount - 1}`), proof),
    ).toBe(true)
  })

  it('removes leaves the same way', () => {
    const tree = BinaryMerkleTree.fromLeaves(H, leaves(5))
    for (const r of v.removals) {
      tree.remove(r.index)
      expect(tree.leafCount).toBe(r.leafCount)
      expect(tree.height).toBe(r.height)
      expect(toHex(tree.root() ?? new Uint8Array())).toBe(r.root)
    }
  })
})

describe('BinaryMerkleTree', () => {
  it('verifies every leaf and rejects tampering', () => {
    const data = leaves(7)
    const tree = BinaryMerkleTree.fromLeaves(Sha256, data)
    const root = tree.root()
    if (!root) throw new Error('expected a root')
    data.forEach((leaf, i) => {
      const proof = tree.generateProof(i)
      expect(BinaryMerkleTree.verify(Sha256, root, leaf, proof)).toBe(true)
      expect(BinaryMerkleTree.verify(Sha256, root, utf8('forged'), proof)).toBe(false)
      expect(BinaryMerkleTree.verify(Keccak256, root, leaf, proof)).toBe(false)
    })
  })

  it('rejects malformed proofs without throwing', () => {
    const tree = BinaryMerkleTree.fromLeaves(Sha256, leaves(4))
    const root = tree.root() ?? new Uint8Array()
    const proof = tree.generateProof(1)
    const variants: MerkleProof[] = [
      { ...proof, leafIndex: 2 },
      { ...proof, leafCount: 0 },
      { ...proof, leafIndex: 9 },
      { ...proof, path: proof.path.slice(1) },
      {
        ...proof,
        path: proof.path.map((n) => ({ ...n, side: n.side === 'left' ? 'right' : 'left' })),
      },
    ]
    for (const bad of variants)
      expect(BinaryMerkleTree.verify(Sha256, root, utf8('leaf-1'), bad)).toBe(false)
    expect(BinaryMerkleTree.verify(Sha256, root, new Uint8Array(), proof)).toBe(false)
  })

  it('throws typed errors', () => {
    const tree = new BinaryMerkleTree(Sha256)
    expect(tree.root()).toBeUndefined()
    expect(() => tree.generateProof(0)).toThrow(expect.objectContaining({ code: 'EmptyTree' }))
    expect(() => tree.insert(new Uint8Array())).toThrow(
      expect.objectContaining({ code: 'EmptyLeafData' }),
    )
    tree.insert(utf8('a'))
    try {
      tree.remove(3)
      expect.unreachable()
    } catch (error) {
      expect(isMerkleError(error, 'IndexOutOfBounds')).toBe(true)
    }
  })

  it('round-trips through JSON', () => {
    const tree = BinaryMerkleTree.fromLeaves(Blake3, leaves(6))
    const json = JSON.parse(JSON.stringify(tree))
    const restored = BinaryMerkleTree.fromJSON(Blake3, json)
    expect(restored.root()).toEqual(tree.root())
    expect(() => BinaryMerkleTree.fromJSON(Sha256, json)).toThrow(/built with BLAKE3/)
  })

  it('withCapacity pads to the reserved size, like the Rust crate', () => {
    const tree = BinaryMerkleTree.withCapacity(Sha256, 16)
    for (const leaf of leaves(3)) tree.insert(leaf)
    expect(tree.height).toBe(5)
    expect(tree.metadata()).toMatchObject({
      leafCount: 3,
      variant: 'BinaryMerkleTree',
      hashAlgorithm: 'SHA-256',
    })
  })

  it('does not leak internal buffers', () => {
    const tree = BinaryMerkleTree.fromLeaves(Sha256, leaves(2))
    const root = tree.root()
    if (root) root[0] = (root[0] ?? 0) ^ 0xff
    expect(tree.root()).not.toEqual(root)
  })
})
