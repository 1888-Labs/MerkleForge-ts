import { hashLeaves, hashNodePairs, toHex, utf8 } from '@merkleforge/core'
import { Keccak256, Sha256 } from '@merkleforge/hash'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createKeccak256Wasm, createSha256Wasm } from '../src/index.js'

describe.each([
  ['Keccak-256', Keccak256, createKeccak256Wasm],
  ['SHA-256', Sha256, createSha256Wasm],
])('%s WASM adapter', (name, reference, create) => {
  it('matches the pure-JS adapter for every operation', async () => {
    const H = await create()
    expect(H.algorithmName).toBe(name)
    expect(H.digestSize).toBe(32)
    expect(toHex(H.empty())).toBe(toHex(reference.empty()))
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 300 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (data, other) => {
          expect(H.hash(data)).toEqual(reference.hash(data))
          expect(H.hashEncodedNode(data)).toEqual(reference.hashEncodedNode(data))
          expect(H.hashNodes(reference.hash(data), other)).toEqual(
            reference.hashNodes(reference.hash(data), other),
          )
        },
      ),
    )
  })

  it('returns independent buffers', async () => {
    const H = await create()
    const a = H.hash(utf8('a'))
    const b = H.hash(utf8('b'))
    expect(a).not.toEqual(b)
    expect(a).toEqual(reference.hash(utf8('a')))
  })

  it('batches pairs and leaves exactly like the pure-JS adapter', async () => {
    const H = await create()
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 64 }),
        fc.array(fc.uint8Array({ maxLength: 300 }), { maxLength: 30 }),
        (pairs, leaves) => {
          const input = Uint8Array.from({ length: 64 * pairs }, (_, i) => (i * 7 + pairs) & 0xff)
          const got = new Uint8Array(32 * pairs)
          const want = new Uint8Array(32 * pairs)
          hashNodePairs(H, input, got)
          hashNodePairs(reference, input, want)
          expect(got).toEqual(want)
          const a = new Uint8Array(32 * leaves.length)
          const b = new Uint8Array(32 * leaves.length)
          hashLeaves(H, leaves, a)
          hashLeaves(reference, leaves, b)
          expect(a).toEqual(b)
        },
      ),
    )
  })

  it('grows its memory for large inputs', async () => {
    const H = await create()
    // Larger than the module's initial memory, so the adapter has to grow it.
    const big = new Uint8Array(3_000_000)
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff
    expect(H.hash(big)).toEqual(reference.hash(big))
    const pairs = big.subarray(0, 64 * 4096)
    const got = new Uint8Array(32 * 4096)
    const want = new Uint8Array(32 * 4096)
    hashNodePairs(H, pairs, got)
    hashNodePairs(reference, pairs, want)
    expect(got).toEqual(want)
    expect(H.hashNodes(utf8('not'), utf8('32 bytes'))).toEqual(
      reference.hashNodes(utf8('not'), utf8('32 bytes')),
    )
  })
})
