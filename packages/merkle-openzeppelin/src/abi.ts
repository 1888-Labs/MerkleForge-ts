import { type Bytes, concatBytes, fromHex, utf8 } from '@merkleforge/core'

/**
 * Solidity `abi.encode` for the types OpenZeppelin trees use as leaf
 * encodings: `uint<M>`, `int<M>`, `address`, `bool`, `bytes<M>`, `bytes`,
 * `string`, `T[]`, `T[k]`, and tuples written as `(T1,T2,...)`.
 *
 * Accepts the same values as `@metamask/abi-utils` (which
 * `@openzeppelin/merkle-tree` uses): integers as `bigint`, `number`, or a
 * decimal or `0x` string; bytes and addresses as `0x` hex or `Uint8Array`;
 * booleans as `true`/`false` or `"true"`/`"false"`.
 */
export function abiEncode(types: readonly string[], values: readonly unknown[]): Bytes {
  return encodeTuple(types.map(parseType), values)
}

interface Coder {
  readonly type: string
  readonly dynamic: boolean
  /** Bytes the value takes in the head when static. */
  readonly headSize: number
  encode(value: unknown): Bytes
}

const WORD = 32
const typeCache = new Map<string, Coder>()

function parseType(raw: string): Coder {
  const type = raw.trim()
  let coder = typeCache.get(type)
  if (coder === undefined) {
    coder = buildCoder(type)
    typeCache.set(type, coder)
  }
  return coder
}

function buildCoder(type: string): Coder {
  const array = type.match(/^(.*)\[(\d*)\]$/s)
  if (array) {
    const inner = parseType(array[1] as string)
    const lengthText = array[2] as string
    if (lengthText === '') return dynamicArrayCoder(type, inner)
    const length = Number(lengthText)
    if (length === 0) throw new TypeError(`invalid ABI type "${type}": fixed arrays need a length`)
    return fixedArrayCoder(type, inner, length)
  }
  if (type.startsWith('(') && type.endsWith(')')) return tupleCoder(type, splitTuple(type))
  const int = type.match(/^(u?)int(\d*)$/)
  if (int) {
    const bits = int[2] === '' ? 256 : Number(int[2])
    if (bits < 8 || bits > 256 || bits % 8 !== 0)
      throw new TypeError(`invalid ABI type "${type}": size must be a multiple of 8 from 8 to 256`)
    return intCoder(type, bits, int[1] === '')
  }
  const fixed = type.match(/^bytes(\d+)$/)
  if (fixed) {
    const size = Number(fixed[1])
    if (size < 1 || size > 32)
      throw new TypeError(`invalid ABI type "${type}": size must be 1 to 32`)
    return staticCoder(type, (value) => {
      const bytes = toBytes(value, type)
      if (bytes.length > size)
        throw new RangeError(`${type} value is ${bytes.length} bytes, expected at most ${size}`)
      return padEnd(bytes)
    })
  }
  switch (type) {
    case 'address':
      return staticCoder(type, (value) => {
        const bytes = toBytes(value, type)
        if (bytes.length > 20) throw new RangeError(`address is ${bytes.length} bytes, expected 20`)
        return padStart(bytes)
      })
    case 'bool':
      return staticCoder(type, (value) => {
        if (value === true || value === 'true') return padStart(Uint8Array.of(1))
        if (value === false || value === 'false') return new Uint8Array(WORD)
        throw new TypeError(`invalid bool value ${String(value)}`)
      })
    case 'bytes':
      return dynamicCoder(type, (value) => encodeBytes(toBytes(value, type)))
    case 'string':
      return dynamicCoder(type, (value) => {
        if (typeof value !== 'string') throw new TypeError(`invalid string value ${String(value)}`)
        return encodeBytes(utf8(value))
      })
  }
  throw new TypeError(`unsupported ABI type "${type}"`)
}

function staticCoder(type: string, encode: (value: unknown) => Bytes): Coder {
  return { type, dynamic: false, headSize: WORD, encode }
}

function dynamicCoder(type: string, encode: (value: unknown) => Bytes): Coder {
  return { type, dynamic: true, headSize: WORD, encode }
}

function intCoder(type: string, bits: number, signed: boolean): Coder {
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n
  return staticCoder(type, (value) => {
    const n = toBigInt(value, type)
    if (n < min || n > max) throw new RangeError(`${n} is out of range for ${type}`)
    return bigIntWord(n < 0n ? (1n << 256n) + n : n)
  })
}

function tupleCoder(type: string, elements: readonly Coder[]): Coder {
  const dynamic = elements.some((e) => e.dynamic)
  return {
    type,
    dynamic,
    headSize: dynamic ? WORD : elements.reduce((sum, e) => sum + e.headSize, 0),
    encode: (value) => encodeTuple(elements, asArray(value, type, elements.length)),
  }
}

function fixedArrayCoder(type: string, inner: Coder, length: number): Coder {
  const elements = Array.from({ length }, () => inner)
  return {
    type,
    dynamic: inner.dynamic,
    headSize: inner.dynamic ? WORD : inner.headSize * length,
    encode: (value) => encodeTuple(elements, asArray(value, type, length)),
  }
}

function dynamicArrayCoder(type: string, inner: Coder): Coder {
  return dynamicCoder(type, (value) => {
    const items = asArray(value, type)
    return concatBytes(
      bigIntWord(BigInt(items.length)),
      encodeTuple(
        items.map(() => inner),
        items,
      ),
    )
  })
}

/** Head/tail encoding shared by tuples, fixed arrays, and dynamic array bodies. */
function encodeTuple(coders: readonly Coder[], values: readonly unknown[]): Bytes {
  if (coders.length !== values.length)
    throw new TypeError(`expected ${coders.length} values, got ${values.length}`)
  const headSize = coders.reduce((sum, c) => sum + c.headSize, 0)
  const heads: Bytes[] = []
  const tails: Bytes[] = []
  let tailOffset = headSize
  coders.forEach((coder, i) => {
    const encoded = coder.encode(values[i])
    if (coder.dynamic) {
      heads.push(bigIntWord(BigInt(tailOffset)))
      tails.push(encoded)
      tailOffset += encoded.length
    } else {
      heads.push(encoded)
    }
  })
  return concatBytes(...heads, ...tails)
}

function splitTuple(type: string): Coder[] {
  const elements: string[] = []
  let depth = 0
  let current = ''
  for (const char of type.slice(1, -1)) {
    if (char === ',' && depth === 0) {
      elements.push(current)
      current = ''
      continue
    }
    if (char === '(') depth++
    else if (char === ')') depth--
    current += char
  }
  if (current.trim() !== '') elements.push(current)
  if (depth !== 0) throw new TypeError(`invalid ABI type "${type}": unbalanced parentheses`)
  return elements.map(parseType)
}

function encodeBytes(bytes: Bytes): Bytes {
  const padded = new Uint8Array(Math.ceil(bytes.length / WORD) * WORD)
  padded.set(bytes)
  return concatBytes(bigIntWord(BigInt(bytes.length)), padded)
}

function asArray(value: unknown, type: string, length?: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${type} value must be an array`)
  if (length !== undefined && value.length !== length)
    throw new TypeError(`${type} value has ${value.length} elements, expected ${length}`)
  return value
}

function toBigInt(value: unknown, type: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') {
    try {
      return BigInt(value)
    } catch {}
  }
  throw new TypeError(`invalid ${type} value ${String(value)}`)
}

function toBytes(value: unknown, type: string): Bytes {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)) {
    return fromHex(value.length % 2 === 0 ? value : `0x0${value.slice(2)}`)
  }
  throw new TypeError(`invalid ${type} value ${String(value)}: expected 0x hex or Uint8Array`)
}

function bigIntWord(n: bigint): Bytes {
  return fromHex(n.toString(16).padStart(64, '0'))
}

function padStart(bytes: Bytes): Bytes {
  const out = new Uint8Array(WORD)
  out.set(bytes, WORD - bytes.length)
  return out
}

function padEnd(bytes: Bytes): Bytes {
  const out = new Uint8Array(WORD)
  out.set(bytes)
  return out
}
