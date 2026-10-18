import { utf8 } from '@1888-labs/merkle-core'
import { Keccak256, Sha256 } from '@1888-labs/merkle-hash'
import { describe, expect, it } from 'vitest'
import {
  BinaryMerkleTree,
  type BinaryMultiProof,
  decodeBinaryMultiProof,
  encodeBinaryMultiProof,
} from '../src/index.js'

const leaves = (n: number) => Array.from({ length: n }, (_, i) => utf8(`leaf-${i}`))

describe('BinaryMerkleTree multiproofs', () => {
  const data = leaves(11)
  const tree = BinaryMerkleTree.fromLeaves(Keccak256, data)
  const root = tree.root() ?? new Uint8Array()
  const verify = (
    proof: BinaryMultiProof,
    items = proof.leafIndices.map((i) => data[i] as Uint8Array),
  ) => BinaryMerkleTree.verifyMultiProof(Keccak256, root, items, proof)

  it('verifies any subset, including a single leaf and every leaf', () => {
    for (const subset of [
      [0],
      [10],
      [3, 4],
      [0, 5, 10],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [...data.keys()],
    ]) {
      expect(verify(tree.generateMultiProof(subset))).toBe(true)
    }
  })

  it('needs only the padding when every leaf is proven, and matches a single proof for one leaf', () => {
    // 11 leaves pad to 16: the proof carries empty leaf 11 and the empty subtree over 12..15.
    expect(tree.generateMultiProof(data.keys()).hashes).toEqual([
      Keccak256.empty(),
      Keccak256.hashNodes(
        Keccak256.hashNodes(Keccak256.empty(), Keccak256.empty()),
        Keccak256.hashNodes(Keccak256.empty(), Keccak256.empty()),
      ),
    ])
    const full = BinaryMerkleTree.fromLeaves(Keccak256, leaves(8))
    expect(full.generateMultiProof(leaves(8).keys()).hashes).toEqual([])
    const single = tree.generateMultiProof([6])
    expect(single.hashes).toEqual(tree.generateProof(6).path.map((n) => n.hash))
  })

  it('shares siblings between neighbouring leaves', () => {
    const multi = tree.generateMultiProof([4, 5, 6, 7])
    expect(multi.hashes.length).toBe(2)
    expect(multi.hashes.length).toBeLessThan(4 * tree.generateProof(4).path.length)
  })

  it('normalizes the requested indices', () => {
    expect(tree.generateMultiProof([7, 2, 7, 0]).leafIndices).toEqual([0, 2, 7])
    expect(() => tree.generateMultiProof([11])).toThrow(
      expect.objectContaining({ code: 'IndexOutOfBounds' }),
    )
    expect(() => tree.generateMultiProof([])).toThrow(
      expect.objectContaining({ code: 'InvalidProofStructure' }),
    )
    expect(() => new BinaryMerkleTree(Sha256).generateMultiProof([0])).toThrow(
      expect.objectContaining({ code: 'EmptyTree' }),
    )
  })

  it('rejects tampering', () => {
    const proof = tree.generateMultiProof([1, 4, 9])
    const items = proof.leafIndices.map((i) => data[i] as Uint8Array)
    const flipped = proof.hashes.map((h, i) =>
      i === 0 ? h.map((b, j) => (j === 0 ? b ^ 1 : b)) : h,
    )
    const bad: [BinaryMultiProof, Uint8Array[]][] = [
      [proof, [utf8('forged'), ...items.slice(1)]],
      [proof, items.slice(1)],
      [{ ...proof, hashes: flipped }, items],
      [{ ...proof, hashes: proof.hashes.slice(1) }, items],
      [{ ...proof, hashes: [...proof.hashes, root] }, items],
      [{ ...proof, leafIndices: [1, 4, 8] }, items],
      [{ ...proof, leafIndices: [4, 1, 9] }, items],
      // leafCount fixes the tree depth (as in single proofs), so a count with a different depth fails.
      [{ ...proof, leafCount: 17 }, items],
      [{ ...proof, leafCount: 0 }, items],
    ]
    for (const [p, l] of bad) expect(verify(p, l)).toBe(false)
  })

  it('round-trips through bincode', () => {
    const proof = tree.generateMultiProof([0, 3, 300 % 11])
    const decoded = decodeBinaryMultiProof(encodeBinaryMultiProof(proof))
    expect(decoded).toEqual(proof)
    expect(verify(decoded)).toBe(true)
    expect(() =>
      decodeBinaryMultiProof(encodeBinaryMultiProof({ ...proof, leafIndices: [3, 0] })),
    ).toThrow(/leaf indices/)
  })
})
