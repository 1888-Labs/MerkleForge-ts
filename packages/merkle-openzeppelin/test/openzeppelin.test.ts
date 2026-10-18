import { concatBytes, fromHex, isMerkleError, toHex } from '@merkleforge/core'
import { encode as metamaskEncode } from '@metamask/abi-utils'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  SimpleMerkleTree as OzSimpleMerkleTree,
  StandardMerkleTree as OzStandardMerkleTree,
} from '@openzeppelin/merkle-tree'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  abiEncode,
  type BytesLike,
  formatLeaf,
  SimpleMerkleTree,
  StandardMerkleTree,
  standardLeafHash,
  standardNodeHash,
} from '../src/index.js'

// A Solidity type and how to generate values for it, including the alternative
// representations OpenZeppelin accepts (decimal and hex strings, "true").
type Schema =
  | { kind: 'uint' | 'int'; bits: number }
  | { kind: 'address' | 'bool' | 'bytes' | 'string' }
  | { kind: 'fixedBytes'; size: number }
  | { kind: 'array'; inner: Schema; length?: number }
  | { kind: 'tuple'; items: Schema[] }

const typeOf = (s: Schema): string => {
  switch (s.kind) {
    case 'uint':
    case 'int':
      return `${s.kind}${s.bits}`
    case 'fixedBytes':
      return `bytes${s.size}`
    case 'array':
      return `${typeOf(s.inner)}[${s.length ?? ''}]`
    case 'tuple':
      return `(${s.items.map(typeOf).join(',')})`
    default:
      return s.kind
  }
}

const hexBytes = (min: number, max = min) =>
  fc.uint8Array({ minLength: min, maxLength: max }).map(toHex)

const valuesFor = (s: Schema): fc.Arbitrary<unknown> => {
  switch (s.kind) {
    case 'uint':
    case 'int': {
      const signed = s.kind === 'int'
      const max = (1n << BigInt(signed ? s.bits - 1 : s.bits)) - 1n
      const min = signed ? -max - 1n : 0n
      return fc
        .bigInt(min, max)
        .chain((n) =>
          fc.constantFrom<unknown>(
            n,
            n.toString(),
            ...(n >= 0n ? [`0x${n.toString(16)}`] : []),
            ...(Number.isSafeInteger(Number(n)) ? [Number(n)] : []),
          ),
        )
    }
    case 'address':
      return hexBytes(20)
    case 'bool':
      return fc.constantFrom<unknown>(true, false, 'true', 'false')
    case 'bytes':
      return fc.oneof(hexBytes(0, 70), fc.uint8Array({ maxLength: 70 }))
    case 'string':
      return fc.string({ unit: 'binary', maxLength: 40 })
    case 'fixedBytes':
      return hexBytes(1, s.size)
    case 'array':
      return fc.array(valuesFor(s.inner), {
        minLength: s.length ?? 0,
        maxLength: s.length ?? 4,
      })
    case 'tuple':
      return fc.tuple(...s.items.map(valuesFor))
  }
}

const leafSchema: fc.Arbitrary<Schema> = fc.oneof(
  fc.record({
    kind: fc.constantFrom('uint' as const, 'int' as const),
    bits: fc.integer({ min: 1, max: 32 }).map((n) => n * 8),
  }),
  fc.record({
    kind: fc.constantFrom('address' as const, 'bool' as const, 'bytes' as const, 'string' as const),
  }),
  fc.record({ kind: fc.constant('fixedBytes' as const), size: fc.integer({ min: 1, max: 32 }) }),
)

const schema: fc.Arbitrary<Schema> = fc.letrec<{ node: Schema }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leafSchema,
    fc.record({ kind: fc.constant('array' as const), inner: tie('node') }),
    fc.record({
      kind: fc.constant('array' as const),
      inner: tie('node'),
      length: fc.integer({ min: 1, max: 3 }),
    }),
    fc.record({
      kind: fc.constant('tuple' as const),
      items: fc.array(tie('node'), { minLength: 1, maxLength: 3 }),
    }),
  ),
})).node

const encodingAndValues = (maxLeaves: number) =>
  fc.array(schema, { minLength: 1, maxLength: 4 }).chain((schemas) =>
    fc.record({
      encoding: fc.constant(schemas.map(typeOf)),
      values: fc.array(fc.tuple(...schemas.map(valuesFor)) as fc.Arbitrary<unknown[]>, {
        minLength: 1,
        maxLength: maxLeaves,
      }),
      sortLeaves: fc.boolean(),
    }),
  )

describe('abiEncode', () => {
  it('matches @metamask/abi-utils (used by OpenZeppelin) for random types and values', () => {
    fc.assert(
      fc.property(
        fc
          .array(schema, { minLength: 1, maxLength: 4 })
          .chain((schemas) =>
            fc.tuple(fc.constant(schemas.map(typeOf)), fc.tuple(...schemas.map(valuesFor))),
          ),
        ([types, values]) => {
          expect(toHex(abiEncode(types, values))).toBe(
            toHex(metamaskEncode(types, values as never)),
          )
        },
      ),
      { numRuns: 500 },
    )
  })

  it('rejects out-of-range numbers, oversized bytes, and unknown types', () => {
    expect(() => abiEncode(['uint8'], [256n])).toThrow(RangeError)
    expect(() => abiEncode(['int8'], [-129])).toThrow(RangeError)
    expect(() => abiEncode(['bytes2'], ['0x010203'])).toThrow(RangeError)
    expect(() => abiEncode(['address'], [`0x${'11'.repeat(21)}`])).toThrow(RangeError)
    expect(() => abiEncode(['uint7'], [1])).toThrow(TypeError)
    expect(() => abiEncode(['fixed128x18'], [1])).toThrow(TypeError)
    expect(() => abiEncode(['bool'], [1])).toThrow(TypeError)
    expect(() => abiEncode(['uint256[2]'], [[1]])).toThrow(TypeError)
    expect(() => abiEncode(['uint256', 'bool'], [1])).toThrow(TypeError)
  })
})

describe('StandardMerkleTree', () => {
  // The example from the @openzeppelin/merkle-tree README.
  const airdrop = [
    ['0x1111111111111111111111111111111111111111', '5000000000000000000'],
    ['0x2222222222222222222222222222222222222222', '2500000000000000000'],
  ]

  it('builds the same tree as OpenZeppelin for the README airdrop', () => {
    const ours = StandardMerkleTree.of(airdrop, ['address', 'uint256'])
    const theirs = OzStandardMerkleTree.of(airdrop, ['address', 'uint256'])
    expect(ours.root).toBe(theirs.root)
    expect(ours.dump()).toEqual(theirs.dump())
    expect(ours.render()).toBe(theirs.render())
    expect([...ours.entries()]).toEqual([...theirs.entries()])
    for (const [i, value] of airdrop.entries()) {
      expect(ours.getProof(i)).toEqual(theirs.getProof(i))
      expect(ours.getProof(value)).toEqual(theirs.getProof(value))
      expect(ours.leafHash(value)).toBe(theirs.leafHash(value))
      expect(ours.leafLookup(value)).toBe(i)
    }
  })

  it('matches OpenZeppelin for random leaf encodings, values, and sizes', () => {
    fc.assert(
      fc.property(
        encodingAndValues(24),
        fc.infiniteStream(fc.boolean()),
        ({ encoding, values, sortLeaves }, picks) => {
          const ours = StandardMerkleTree.of(values, encoding, { sortLeaves })
          const theirs = OzStandardMerkleTree.of(values, encoding, { sortLeaves })
          expect(ours.root).toBe(theirs.root)
          expect(ours.length).toBe(theirs.length)
          expect(ours.dump()).toEqual(theirs.dump())
          expect(ours.render()).toBe(theirs.render())

          for (let i = 0; i < values.length; i++) {
            const proof = ours.getProof(i)
            expect(proof).toEqual(theirs.getProof(i))
            expect(
              OzStandardMerkleTree.verify(theirs.root, encoding, values[i] as unknown[], proof),
            ).toBe(true)
            expect(
              StandardMerkleTree.verify(ours.root, encoding, values[i] as unknown[], proof),
            ).toBe(true)
            expect(ours.verify(i, proof)).toBe(true)
          }

          const it = picks[Symbol.iterator]()
          const subset = values.map((_, i) => i).filter(() => it.next().value)
          const multi = ours.getMultiProof(subset)
          expect(multi).toEqual(theirs.getMultiProof(subset))
          expect(OzStandardMerkleTree.verifyMultiProof(theirs.root, encoding, multi)).toBe(true)
          expect(StandardMerkleTree.verifyMultiProof(ours.root, encoding, multi)).toBe(true)
          expect(ours.verifyMultiProof(multi)).toBe(true)

          // Dumps load in both directions.
          expect(StandardMerkleTree.load(theirs.dump()).root).toBe(theirs.root)
          expect(OzStandardMerkleTree.load(ours.dump()).root).toBe(ours.root)
        },
      ),
      { numRuns: 150 },
    )
  })

  it('exports the same leaf and node hashes', () => {
    const leaf = standardLeafHash(['address', 'uint256'], airdrop[0] as unknown[])
    expect(leaf).toBe(
      OzStandardMerkleTree.of(airdrop, ['address', 'uint256']).leafHash(airdrop[0] as string[]),
    )
    const [a, b] = [toHex(keccak_256(Uint8Array.of(1))), toHex(keccak_256(Uint8Array.of(2)))]
    expect(standardNodeHash(a, b)).toBe(standardNodeHash(b, a))
  })

  it('rejects a tampered proof or value', () => {
    const tree = StandardMerkleTree.of(airdrop, ['address', 'uint256'])
    const proof = tree.getProof(0)
    const other = [airdrop[0]?.[0], '5000000000000000001']
    expect(StandardMerkleTree.verify(tree.root, ['address', 'uint256'], other, proof)).toBe(false)
    const flipped = [`0x${'00'.repeat(32)}`]
    expect(tree.verify(0, flipped)).toBe(false)
  })

  it('fails loudly on bad input, like OpenZeppelin', () => {
    expect(() => StandardMerkleTree.of([], ['uint256'])).toThrow(
      expect.objectContaining({ code: 'EmptyTree' }),
    )
    const tree = StandardMerkleTree.of(airdrop, ['address', 'uint256'])
    expect(() => tree.getProof(2)).toThrow(expect.objectContaining({ code: 'IndexOutOfBounds' }))
    expect(() => tree.leafLookup(['0x3333333333333333333333333333333333333333', '1'])).toThrow(
      RangeError,
    )
    expect(() => tree.getMultiProof([0, 0])).toThrow(
      expect.objectContaining({ code: 'InvalidProofStructure' }),
    )
    expect(() => tree.getProof(0.5)).toThrow()

    const dump = tree.dump()
    const tampered = {
      ...dump,
      values: [
        { ...dump.values[0], value: ['0x1111111111111111111111111111111111111111', '1'] },
        dump.values[1],
      ],
    }
    try {
      StandardMerkleTree.load(tampered as typeof dump)
      expect.unreachable()
    } catch (error) {
      expect(isMerkleError(error, 'DeserializationError')).toBe(true)
    }
    expect(() => StandardMerkleTree.load({ ...dump, format: 'nope' } as never)).toThrow()
  })
})

describe('SimpleMerkleTree', () => {
  const bytes32 = fc.oneof(hexBytes(32), hexBytes(1, 31))

  it('matches OpenZeppelin, with the default and a custom node hash', () => {
    // Proof checks hash (node, sibling) in either order, so a custom hash must be
    // commutative, as with OpenZeppelin. This one adds a domain byte.
    const custom = (a: BytesLike | readonly number[], b: BytesLike | readonly number[]) => {
      const bytes = (v: BytesLike | readonly number[]) =>
        typeof v === 'string' ? fromHex(v) : Uint8Array.from(v)
      const [x, y] = [bytes(a), bytes(b)].sort((l, r) => (toHex(l) < toHex(r) ? -1 : 1)) as [
        Uint8Array,
        Uint8Array,
      ]
      return toHex(keccak_256(concatBytes(Uint8Array.of(1), x, y)))
    }
    fc.assert(
      fc.property(
        fc.array(bytes32, { minLength: 1, maxLength: 24 }),
        fc.boolean(),
        fc.boolean(),
        (values, sortLeaves, useCustom) => {
          const nodeHash = useCustom ? custom : undefined
          const options = nodeHash ? { sortLeaves, nodeHash } : { sortLeaves }
          const ours = SimpleMerkleTree.of(values, options)
          const theirs = OzSimpleMerkleTree.of(values, options)
          expect(ours.root).toBe(theirs.root)
          expect(ours.dump()).toEqual(theirs.dump())
          for (let i = 0; i < values.length; i++) {
            const proof = ours.getProof(i)
            expect(proof).toEqual(theirs.getProof(i))
            expect(SimpleMerkleTree.verify(ours.root, values[i] as string, proof, nodeHash)).toBe(
              true,
            )
          }
          const multi = ours.getMultiProof(values.map((_, i) => i).filter((i) => i % 2 === 0))
          expect(multi).toEqual(
            theirs.getMultiProof(values.map((_, i) => i).filter((i) => i % 2 === 0)),
          )
          expect(
            SimpleMerkleTree.verifyMultiProof(
              ours.root,
              { ...multi, leaves: multi.leaves.map(formatLeaf) },
              nodeHash,
            ),
          ).toBe(true)
          expect(SimpleMerkleTree.load(theirs.dump(), nodeHash).root).toBe(theirs.root)
          expect(
            OzSimpleMerkleTree.load(
              ours.dump(),
              nodeHash as unknown as Parameters<typeof OzSimpleMerkleTree.load>[1],
            ).root,
          ).toBe(ours.root)
        },
      ),
      { numRuns: 150 },
    )
  })

  it('requires the custom node hash when loading a custom dump', () => {
    const tree = SimpleMerkleTree.of([formatLeaf('0x01')], { nodeHash: (a) => a })
    expect(() => SimpleMerkleTree.load(tree.dump())).toThrow()
  })
})
