import { toHex, utf8 } from '@merkleforge/core'
import { describe, expect, it } from 'vitest'
import { Blake3, Keccak256, Sha256 } from '../src/index.js'
import vectors from './rust-vectors.json' with { type: 'json' }

const hashers = { 'SHA-256': Sha256, 'Keccak-256': Keccak256, BLAKE3: Blake3 }

describe.each(vectors.hashes)('$algorithm matches the Rust crate', (v) => {
  const H = hashers[v.algorithm as keyof typeof hashers]

  it('reports its name and size', () => {
    expect(H.algorithmName).toBe(v.algorithm)
    expect(H.digestSize).toBe(32)
  })

  it('hashes leaves, nodes, encoded nodes, and empty', () => {
    expect(toHex(H.hash(utf8('abc')))).toBe(v.primitives.hashAbc)
    expect(toHex(H.hashNodes(H.hash(utf8('a')), H.hash(utf8('b'))))).toBe(v.primitives.hashNodes)
    expect(toHex(H.hashEncodedNode(utf8('abc')))).toBe(v.primitives.encodedAbc)
    expect(toHex(H.empty())).toBe(v.primitives.empty)
  })

  it('separates the leaf and node domains', () => {
    const a = H.hash(utf8('a'))
    const b = H.hash(utf8('b'))
    expect(toHex(H.hashNodes(a, b))).not.toBe(toHex(H.hash(new Uint8Array([...a, ...b]))))
  })
})
