import { hashLeaves, hashNodePairs, toHex, utf8 } from '@merkleforge/core'
import { keccak_256 } from '@noble/hashes/sha3.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Blake3, Keccak256, keccak256, Sha256 } from '../src/index.js'
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

describe('Keccak-256 sponge', () => {
  const message = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff)

  it('matches @noble/hashes for every length across several blocks', () => {
    for (let n = 0; n <= 3 * 136 + 2; n++) {
      const data = message(n)
      expect(keccak256(data)).toEqual(keccak_256(data))
      expect(Keccak256.hash(data)).toEqual(keccak_256(Uint8Array.of(0, ...data)))
      expect(Keccak256.hashEncodedNode(data)).toEqual(keccak_256(data))
    }
  })

  it('matches @noble/hashes on random input', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1000 }), fc.uint8Array({ maxLength: 100 }), (a, b) => {
        expect(keccak256(a)).toEqual(keccak_256(a))
        expect(Keccak256.hashNodes(a, b)).toEqual(keccak_256(Uint8Array.of(1, ...a, ...b)))
      }),
    )
  })

  it('returns independent buffers', () => {
    const a = keccak256(utf8('a'))
    const b = keccak256(utf8('b'))
    expect(a).not.toEqual(b)
    expect(toHex(a)).toBe('0x3ac225168df54212a25c1c01fd35bebfea408fdac2e31ddd6f80a4bbf9a5f1cb')
  })
})

describe.each([
  ['Keccak-256', Keccak256],
  ['SHA-256', Sha256],
  ['BLAKE3', Blake3],
])('%s batch hashing', (_, H) => {
  it('hashNodePairs and hashLeaves match hashNodes and hash', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { maxLength: 40 }),
        fc.array(fc.uint8Array({ maxLength: 300 }), { maxLength: 20 }),
        (nodes, leaves) => {
          const even = nodes.slice(0, nodes.length - (nodes.length % 2))
          const out = new Uint8Array((even.length / 2) * 32)
          hashNodePairs(H, Uint8Array.from(even.flatMap((n) => [...n])), out)
          for (let i = 0; i < even.length / 2; i++) {
            expect(out.subarray(32 * i, 32 * i + 32)).toEqual(
              H.hashNodes(even[2 * i] as Uint8Array, even[2 * i + 1] as Uint8Array),
            )
          }
          const digests = new Uint8Array(leaves.length * 32)
          hashLeaves(H, leaves, digests)
          leaves.forEach((leaf, i) => {
            expect(digests.subarray(32 * i, 32 * i + 32)).toEqual(H.hash(leaf))
          })
        },
      ),
    )
  })

  it('hashes pairs in place', () => {
    const input = Uint8Array.from({ length: 64 * 4 }, (_, i) => i & 0xff)
    const expected = new Uint8Array(32 * 4)
    hashNodePairs(H, input, expected)
    hashNodePairs(H, input, input)
    expect(input.subarray(0, 32 * 4)).toEqual(expected)
  })
})
