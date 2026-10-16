import { describe, expect, it } from 'vitest'
import {
  bytesEqual,
  concatBytes,
  defineHashFunction,
  fromHex,
  isMerkleError,
  MerkleError,
  toHex,
  utf8,
} from '../src/index.js'

// XOR of every byte: a toy hash that makes the default domain prefixes easy to check.
const Xor8 = defineHashFunction({
  algorithmName: 'XOR8',
  digestSize: 1,
  hash: (data) => Uint8Array.of(data.reduce((acc, b) => acc ^ b, 0)),
})

describe('bytes', () => {
  it('round-trips hex', () => {
    const bytes = Uint8Array.of(0, 1, 0xab, 0xff)
    expect(toHex(bytes)).toBe('0x0001abff')
    expect(fromHex('0x0001abff')).toEqual(bytes)
    expect(fromHex('0001ABFF')).toEqual(bytes)
  })

  it('rejects malformed hex', () => {
    expect(() => fromHex('0x123')).toThrow(TypeError)
    expect(() => fromHex('0xzz')).toThrow(TypeError)
  })

  it('compares and concatenates', () => {
    expect(bytesEqual(utf8('ab'), concatBytes(utf8('a'), utf8('b')))).toBe(true)
    expect(bytesEqual(utf8('ab'), utf8('abc'))).toBe(false)
  })
})

describe('defineHashFunction', () => {
  it('prefixes internal nodes with 0x01 by default', () => {
    const l = Xor8.hash(utf8('left'))
    const r = Xor8.hash(utf8('right'))
    expect(Xor8.hashNodes(l, r)).toEqual(Uint8Array.of(0x01 ^ (l[0] ?? 0) ^ (r[0] ?? 0)))
  })

  it('delegates encoded nodes to hash and derives empty', () => {
    expect(Xor8.hashEncodedNode(utf8('node'))).toEqual(Xor8.hash(utf8('node')))
    expect(Xor8.empty()).toEqual(Xor8.hash(new Uint8Array(0)))
  })

  it('returns a fresh empty digest each call', () => {
    const a = Xor8.empty()
    a[0] = 0xff
    expect(Xor8.empty()).toEqual(Uint8Array.of(0))
  })
})

describe('MerkleError', () => {
  it('formats messages like the Rust crate', () => {
    expect(new MerkleError({ code: 'EmptyTree' }).message).toContain('non-empty')
    const oob = new MerkleError({ code: 'IndexOutOfBounds', index: 5, len: 3 })
    expect(oob.message).toBe('index 5 is out of bounds for a tree with 3 leaves')
    expect(oob.code).toBe('IndexOutOfBounds')
  })

  it('narrows with isMerkleError', () => {
    const error: unknown = new MerkleError({ code: 'IndexOutOfBounds', index: 5, len: 3 })
    expect(isMerkleError(error)).toBe(true)
    expect(isMerkleError(error, 'EmptyTree')).toBe(false)
    if (isMerkleError(error, 'IndexOutOfBounds')) expect(error.detail.len).toBe(3)
    expect(isMerkleError(new Error('nope'))).toBe(false)
  })
})
