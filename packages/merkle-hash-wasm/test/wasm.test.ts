import { toHex, utf8 } from '@merkleforge/core'
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
})
