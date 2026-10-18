import {
  decodeMerkleProof,
  encodeMerkleProof,
  fromHex,
  type MerkleProof,
  merkleProofFromSerdeJSON,
  merkleProofToSerdeJSON,
  toHex,
  utf8,
} from '@merkleforge/core'
import { Keccak256 } from '@merkleforge/hash'
import { describe, expect, it } from 'vitest'
import {
  BinaryMerkleTree,
  decodeBinaryMultiProof,
  decodeMptProof,
  decodeSparseProof,
  encodeBinaryMultiProof,
  encodeMptProof,
  encodeSparseProof,
  MerklePatriciaTrie,
  mptProofFromSerdeJSON,
  mptProofToSerdeJSON,
  multiProofFromSerdeJSON,
  multiProofToSerdeJSON,
  SparseMerkleTree,
  sparseProofFromSerdeJSON,
  sparseProofToSerdeJSON,
} from '../src/index.js'
import vectors from './rust-codec-vectors.json' with { type: 'json' }

const cases = Object.fromEntries(vectors.cases.map((c) => [c.name, c]))
const leaves = Array.from({ length: 300 }, (_, i) => utf8(`leaf-${i}`))
const pick = (name: string) => {
  const c = cases[name]
  if (!c) throw new Error(`missing vector ${name}`)
  return { json: JSON.parse(c.json), bytes: fromHex(c.bincode) }
}

function sparseTree() {
  const smt = new SparseMerkleTree(Keccak256)
  for (let i = 0; i < 8; i++) smt.insert(Keccak256.hash(utf8(`key-${i}`)), utf8(`value-${i}`))
  return smt
}

function mptTrie() {
  const mpt = new MerklePatriciaTrie(Keccak256)
  mpt.insert(utf8('do'), utf8('verb'))
  mpt.insert(utf8('dog'), utf8('puppy'))
  mpt.insert(utf8('doge'), new Uint8Array(300).fill(0xab))
  mpt.insert(utf8('horse'), utf8('stallion'))
  return mpt
}

describe('MerkleProof codecs match Rust serde_json and bincode', () => {
  const proofs: [string, () => MerkleProof][] = [
    [
      'binary-small',
      () => BinaryMerkleTree.fromLeaves(Keccak256, leaves.slice(0, 5)).generateProof(4),
    ],
    ['binary-large', () => BinaryMerkleTree.fromLeaves(Keccak256, leaves).generateProof(299)],
    [
      'sparse-indexed',
      () => {
        const view = new SparseMerkleTree(Keccak256).indexed()
        for (const leaf of leaves.slice(0, 3)) view.insert(leaf)
        return view.generateProof(1)
      },
    ],
  ]

  it.each(proofs)('%s', (name, make) => {
    const proof = make()
    const { json, bytes } = pick(name)
    expect(merkleProofToSerdeJSON(proof)).toEqual(json)
    expect(toHex(encodeMerkleProof(proof))).toBe(toHex(bytes))
    expect(decodeMerkleProof(bytes)).toEqual(proof)
    expect(merkleProofFromSerdeJSON(json)).toEqual(proof)
  })

  it('a decoded Rust proof verifies in TypeScript', () => {
    const proof = decodeMerkleProof(pick('binary-large').bytes)
    expect(
      BinaryMerkleTree.verify(
        Keccak256,
        fromHex(vectors.roots['binary-large']),
        utf8('leaf-299'),
        proof,
      ),
    ).toBe(true)
  })

  it('rejects malformed input', () => {
    const { bytes } = pick('binary-small')
    expect(() => decodeMerkleProof(bytes.slice(0, -1))).toThrow(/end of input/)
    expect(() => decodeMerkleProof(Uint8Array.of(...bytes, 0))).toThrow(/trailing bytes/)
    const badSide = bytes.slice()
    badSide[badSide.length - 1] = 7
    expect(() => decodeMerkleProof(badSide)).toThrow(/ProofSide/)
    expect(() => decodeMerkleProof(Uint8Array.of(0xfb, 0x01, 0x00))).toThrow(/non-canonical/)
  })
})

describe('SparseMerkleProof codecs match Rust', () => {
  it.each([
    ['sparse-member', 'key-3'],
    ['sparse-non-member', 'absent'],
  ])('%s', (name, keyName) => {
    const proof = sparseTree().generateMembershipProof(Keccak256.hash(utf8(keyName)))
    const { json, bytes } = pick(name)
    expect(sparseProofToSerdeJSON(proof)).toEqual(json)
    expect(toHex(encodeSparseProof(proof))).toBe(toHex(bytes))
    expect(decodeSparseProof(bytes)).toEqual(proof)
    expect(sparseProofFromSerdeJSON(json)).toEqual(proof)
  })

  it('a decoded Rust proof verifies in TypeScript', () => {
    const proof = decodeSparseProof(pick('sparse-member').bytes)
    const root = fromHex(vectors.roots.sparse)
    expect(
      SparseMerkleTree.verifyMembership(Keccak256, root, proof.key, utf8('value-3'), proof),
    ).toBe(true)
  })
})

describe('MptProof codecs match Rust', () => {
  it.each([
    ['mpt-member', 'dog'],
    ['mpt-long-value', 'doge'],
    ['mpt-non-member', 'dot'],
  ])('%s', (name, key) => {
    const proof = mptTrie().generateProof(utf8(key))
    const { json, bytes } = pick(name)
    expect(mptProofToSerdeJSON(proof)).toEqual(json)
    expect(toHex(encodeMptProof(proof))).toBe(toHex(bytes))
    expect(decodeMptProof(bytes)).toEqual(proof)
    expect(mptProofFromSerdeJSON(json)).toEqual(proof)
    expect(
      MerklePatriciaTrie.verifyProof(Keccak256, fromHex(vectors.roots.mpt), decodeMptProof(bytes)),
    ).toBe(true)
  })
})

describe('BinaryMultiProof matches the Rust BinaryMerkleTree::generate_multi_proof', () => {
  it.each([
    ['multi-small', 5, [4, 1, 1], 'binary-small'],
    ['multi-large', 300, [0, 7, 8, 9, 150, 298, 299], 'binary-large'],
  ] as const)('%s', (name, n, picks, rootName) => {
    const tree = BinaryMerkleTree.fromLeaves(Keccak256, leaves.slice(0, n))
    const proof = tree.generateMultiProof(picks)
    const { json, bytes } = pick(name)
    expect(multiProofToSerdeJSON(proof)).toEqual(json)
    expect(toHex(encodeBinaryMultiProof(proof))).toBe(toHex(bytes))
    expect(decodeBinaryMultiProof(bytes)).toEqual(proof)
    expect(multiProofFromSerdeJSON(json)).toEqual(proof)
    const items = proof.leafIndices.map((i) => leaves[i] as Uint8Array)
    expect(
      BinaryMerkleTree.verifyMultiProof(Keccak256, fromHex(vectors.roots[rootName]), items, proof),
    ).toBe(true)
  })
})
