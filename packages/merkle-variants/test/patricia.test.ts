import { fromHex, isMerkleError, toHex, utf8 } from '@1888-labs/merkle-core'
import { Blake3, Keccak256, Sha256 } from '@1888-labs/merkle-hash'
import { describe, expect, it } from 'vitest'
import {
  computeRootHash,
  hpDecode,
  hpEncode,
  MerklePatriciaTrie,
  type MptProof,
  rlpDecode,
  rlpEncode,
} from '../src/index.js'
import anyOrder from './fixtures/ethereum_trie/trieanyorder.json' with { type: 'json' }
import ordered from './fixtures/ethereum_trie/trietest.json' with { type: 'json' }
import vectors from './rust-variant-vectors.json' with { type: 'json' }

const hashers = { 'SHA-256': Sha256, 'Keccak-256': Keccak256, BLAKE3: Blake3 }
const EMPTY_TRIE_ROOT = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'
const testBytes = (s: string) => (s.startsWith('0x') ? fromHex(s) : utf8(s))
const rootOrEmpty = (trie: MerklePatriciaTrie) =>
  toHex(trie.root() ?? computeRootHash(Keccak256, { kind: 'empty' }))

describe('MerklePatriciaTrie matches the official Ethereum trie vectors', () => {
  it('empty trie', () => {
    expect(toHex(computeRootHash(Keccak256, { kind: 'empty' }))).toBe(EMPTY_TRIE_ROOT)
  })

  it.each(Object.entries(ordered))('trietest %s', (_, test) => {
    const trie = new MerklePatriciaTrie(Keccak256)
    for (const [k, v] of test.in as [string, string | null][]) {
      const keyBytes = testBytes(k)
      const valueBytes = v === null ? new Uint8Array() : testBytes(v)
      if (valueBytes.length === 0) {
        if (trie.get(keyBytes) !== undefined) trie.remove(keyBytes)
      } else {
        trie.insert(keyBytes, valueBytes)
      }
    }
    expect(rootOrEmpty(trie)).toBe(test.root)
  })

  it.each(Object.entries(anyOrder))('trieanyorder %s', (_, test) => {
    const entries = Object.entries(test.in as Record<string, string>)
    for (const order of [entries, [...entries].reverse()]) {
      const trie = new MerklePatriciaTrie(Keccak256)
      for (const [k, v] of order) trie.insert(testBytes(k), testBytes(v))
      expect(rootOrEmpty(trie)).toBe(test.root)
    }
  })
})

describe.each(vectors.hashes)(
  'MerklePatriciaTrie<$algorithm> matches the Rust crate',
  ({ algorithm, patricia: v }) => {
    const H = hashers[algorithm as keyof typeof hashers]
    const build = () => {
      const trie = new MerklePatriciaTrie(H)
      for (const [k, val] of v.entries) trie.insert(fromHex(k as string), fromHex(val as string))
      return trie
    }

    it('matches every root while inserting, and the final shape', () => {
      const trie = new MerklePatriciaTrie(H)
      v.entries.forEach(([k, val], i) => {
        trie.insert(fromHex(k as string), fromHex(val as string))
        expect(toHex(trie.root() ?? new Uint8Array())).toBe(v.insertRoots[i])
      })
      expect(trie.nodeCount).toBe(v.full.nodeCount)
      expect(trie.height).toBe(v.full.height)
    })

    it.each([
      ['membership', v.membership],
      ['long-value membership', v.longMembership],
      ['non-membership', v.nonMembership],
    ])('produces the same %s proof', (_, expected) => {
      const proof = build().generateProof(fromHex(expected.key))
      expect(proof.value && toHex(proof.value)).toBe(expected.value)
      expect(proof.proofNodes.map(toHex)).toEqual(expected.proofNodes)
      expect(MerklePatriciaTrie.verifyProof(H, fromHex(v.full.root), proof)).toBe(true)
    })

    it('collapses nodes on removal the same way', () => {
      const trie = build()
      for (const r of v.removals) {
        trie.remove(fromHex(r.key))
        expect(toHex(trie.root() ?? new Uint8Array())).toBe(r.root)
        expect(trie.nodeCount).toBe(r.nodeCount)
        expect(trie.height).toBe(r.height)
      }
    })

    it('matches the index-addressed MerkleTree view', () => {
      const view = new MerklePatriciaTrie(H).indexed()
      for (let i = 0; i < 4; i++) view.insert(utf8(`leaf-${i}`))
      view.remove(1)
      expect(view.insert(utf8('leaf-again'))).toBe(v.indexed.nextIndex)
      expect(toHex(view.root() ?? new Uint8Array())).toBe(v.indexed.root)
      expect(() => view.generateProof(0)).toThrow(
        expect.objectContaining({ code: 'UnsupportedOperation' }),
      )
    })
  },
)

describe('MerklePatriciaTrie', () => {
  const trie = new MerklePatriciaTrie(Keccak256)
  for (const [k, val] of [
    ['do', 'verb'],
    ['dog', 'puppy'],
    ['doge', 'coin'],
    ['horse', 'stallion'],
  ]) {
    trie.insert(utf8(k as string), utf8(val as string))
  }
  const root = trie.root() ?? new Uint8Array()

  it('gets values and lists entries in key order', () => {
    expect(trie.get(utf8('dog'))).toEqual(utf8('puppy'))
    expect(trie.get(utf8('cat'))).toBeUndefined()
    expect(trie.entries().map(([k]) => new TextDecoder().decode(k))).toEqual([
      'do',
      'dog',
      'doge',
      'horse',
    ])
  })

  it('rejects tampered proofs', () => {
    const proof = trie.generateProof(utf8('dog'))
    const bad: MptProof[] = [
      { ...proof, value: utf8('kitten') },
      { ...proof, value: null },
      { ...proof, key: utf8('doe') },
      { ...proof, proofNodes: proof.proofNodes.slice(0, -1) },
      { ...proof, proofNodes: [...proof.proofNodes, Uint8Array.of(0x80)] },
      { ...proof, proofNodes: [Uint8Array.of(0xff)] },
    ]
    for (const p of bad) expect(MerklePatriciaTrie.verifyProof(Keccak256, root, p)).toBe(false)
    expect(MerklePatriciaTrie.verifyProof(Keccak256, Keccak256.empty(), proof)).toBe(false)
  })

  it('round-trips through JSON', () => {
    const restored = MerklePatriciaTrie.fromJSON(Keccak256, JSON.parse(JSON.stringify(trie)))
    expect(restored.root()).toEqual(root)
    expect(() => MerklePatriciaTrie.fromJSON(Sha256, trie.toJSON())).toThrow(
      /built with Keccak-256/,
    )
  })

  it('throws typed errors', () => {
    const empty = new MerklePatriciaTrie(Keccak256)
    expect(() => empty.generateProof(utf8('x'))).toThrow(
      expect.objectContaining({ code: 'EmptyTree' }),
    )
    expect(() => empty.insert(utf8('x'), new Uint8Array())).toThrow(
      expect.objectContaining({ code: 'EmptyLeafData' }),
    )
    try {
      empty.remove(utf8('x'))
      expect.unreachable()
    } catch (error) {
      expect(isMerkleError(error, 'UnsupportedOperation')).toBe(true)
    }
  })

  it('encodes hex-prefix paths and RLP nodes reversibly', () => {
    for (const [path, isLeaf] of [
      [[1, 2, 3], true],
      [[0xa, 0xb], false],
      [[], true],
    ] as const) {
      expect(hpDecode(hpEncode(path, isLeaf))).toEqual({ path, isLeaf })
    }
    expect(hpDecode(Uint8Array.of(0x40))).toEqual({ path: [], isLeaf: false })
    for (const encoded of trie.generateProof(utf8('doge')).proofNodes) {
      expect(rlpEncode(rlpDecode(encoded))).toEqual(encoded)
    }
    expect(() => rlpDecode(Uint8Array.of(0xc1))).toThrow(
      expect.objectContaining({ code: 'RlpError' }),
    )
  })
})
