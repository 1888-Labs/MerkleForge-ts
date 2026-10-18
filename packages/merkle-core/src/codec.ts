import type { Bytes } from './bytes.js'
import { MerkleError } from './errors.js'
import type { MerkleProof, ProofNode, ProofSide } from './types.js'

function decodeError(reason: string): MerkleError {
  return new MerkleError({ code: 'DeserializationError', reason })
}

/**
 * Writes values in bincode 2's `standard()` format (little-endian varints),
 * the format the Rust crates use for `Serializable::to_bytes`.
 */
export class BincodeWriter {
  #chunks: number[] = []

  /** A `u8`, written as one raw byte. */
  u8(value: number): this {
    this.#chunks.push(value & 0xff)
    return this
  }

  /** A `usize`/`u64`/`u32` varint: one byte below 251, else a 251/252/253 marker and 2/4/8 LE bytes. */
  varint(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(`cannot encode ${value} as a varint`)
    if (value < 251) return this.u8(value)
    const [marker, width] = value <= 0xffff ? [251, 2] : value <= 0xffffffff ? [252, 4] : [253, 8]
    this.u8(marker)
    let rest = BigInt(value)
    for (let i = 0; i < width; i++) {
      this.u8(Number(rest & 0xffn))
      rest >>= 8n
    }
    return this
  }

  /** Fixed-size bytes such as a `[u8; 32]` digest: no length prefix. */
  fixedBytes(bytes: Bytes): this {
    for (const byte of bytes) this.#chunks.push(byte)
    return this
  }

  /** A `Vec<u8>`: varint length, then the bytes. */
  bytes(bytes: Bytes): this {
    return this.varint(bytes.length).fixedBytes(bytes)
  }

  /** An `Option<T>`: `0` for `None`, `1` then the value for `Some`. */
  option<T>(value: T | null, write: (value: T) => void): this {
    if (value === null) return this.u8(0)
    this.u8(1)
    write(value)
    return this
  }

  /** A `Vec<T>`: varint length, then each item. */
  seq<T>(items: readonly T[], write: (item: T) => void): this {
    this.varint(items.length)
    for (const item of items) write(item)
    return this
  }

  finish(): Bytes {
    return Uint8Array.from(this.#chunks)
  }
}

/** Reads bincode 2 `standard()` data. Throws `DeserializationError` on malformed input. */
export class BincodeReader {
  readonly #bytes: Bytes
  #offset = 0

  constructor(bytes: Bytes) {
    this.#bytes = bytes
  }

  u8(): number {
    const byte = this.#bytes[this.#offset]
    if (byte === undefined) throw decodeError('unexpected end of input')
    this.#offset++
    return byte
  }

  varint(): number {
    const first = this.u8()
    if (first < 251) return first
    const width = first === 251 ? 2 : first === 252 ? 4 : first === 253 ? 8 : 0
    if (width === 0) throw decodeError(`unsupported varint marker ${first}`)
    let value = 0n
    for (let i = 0; i < width; i++) value |= BigInt(this.u8()) << BigInt(8 * i)
    const minimum = width === 2 ? 251n : width === 4 ? 0x10000n : 0x100000000n
    if (value < minimum) throw decodeError('non-canonical varint')
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw decodeError('varint exceeds the safe integer range')
    return Number(value)
  }

  fixedBytes(length: number): Bytes {
    if (this.#offset + length > this.#bytes.length) throw decodeError('unexpected end of input')
    const out = this.#bytes.slice(this.#offset, this.#offset + length)
    this.#offset += length
    return out
  }

  bytes(): Bytes {
    return this.fixedBytes(this.varint())
  }

  option<T>(read: () => T): T | null {
    const tag = this.u8()
    if (tag === 0) return null
    if (tag === 1) return read()
    throw decodeError(`invalid option tag ${tag}`)
  }

  seq<T>(read: () => T): T[] {
    const length = this.varint()
    if (length > this.#bytes.length - this.#offset)
      throw decodeError('sequence length exceeds input')
    return Array.from({ length }, read)
  }

  /** Throws unless every byte was consumed. */
  end(): void {
    if (this.#offset !== this.#bytes.length) throw decodeError('trailing bytes after value')
  }
}

const SIDE_TAGS: Record<ProofSide, number> = { left: 0, right: 1 }

/**
 * Encodes a proof exactly like the Rust `proof.to_bytes()` (bincode 2,
 * standard config), so proofs can move between Rust and TypeScript.
 */
export function encodeMerkleProof(proof: MerkleProof): Bytes {
  const w = new BincodeWriter().varint(proof.leafIndex).varint(proof.leafCount)
  w.seq(proof.path, (node) => w.fixedBytes(node.hash).varint(SIDE_TAGS[node.side]))
  return w.finish()
}

/**
 * Decodes the Rust `MerkleProof::<[u8; N]>::from_bytes` format. Unlike Rust,
 * trailing bytes are rejected. `digestSize` defaults to 32.
 */
export function decodeMerkleProof(bytes: Bytes, digestSize = 32): MerkleProof {
  const r = new BincodeReader(bytes)
  const leafIndex = r.varint()
  const leafCount = r.varint()
  const path = r.seq<ProofNode>(() => {
    const hash = r.fixedBytes(digestSize)
    const tag = r.varint()
    if (tag > 1) throw decodeError(`invalid ProofSide tag ${tag}`)
    return { hash, side: tag === 0 ? 'left' : 'right' }
  })
  r.end()
  return { leafIndex, leafCount, path }
}

/** The `serde_json` shape of a Rust `MerkleProof<[u8; 32]>`. */
export interface MerkleProofSerdeJSON {
  leaf_index: number
  leaf_count: number
  path: { hash: number[]; side: 'Left' | 'Right' }[]
}

/** Converts a proof to the JSON object `serde_json` produces for the Rust type. */
export function merkleProofToSerdeJSON(proof: MerkleProof): MerkleProofSerdeJSON {
  return {
    leaf_index: proof.leafIndex,
    leaf_count: proof.leafCount,
    path: proof.path.map((node) => ({
      hash: [...node.hash],
      side: node.side === 'left' ? 'Left' : 'Right',
    })),
  }
}

/** Reads a proof from the Rust `serde_json` shape. */
export function merkleProofFromSerdeJSON(json: MerkleProofSerdeJSON, digestSize = 32): MerkleProof {
  return {
    leafIndex: json.leaf_index,
    leafCount: json.leaf_count,
    path: json.path.map((node) => {
      if (node.side !== 'Left' && node.side !== 'Right')
        throw decodeError(`invalid ProofSide ${node.side}`)
      return {
        hash: byteArrayFromJSON(node.hash, digestSize),
        side: node.side === 'Left' ? 'left' : 'right',
      }
    }),
  }
}

/** Validates a serde byte array (`[u8; N]` or `Vec<u8>`) and converts it to bytes. */
export function byteArrayFromJSON(value: readonly number[], length?: number): Bytes {
  if (!Array.isArray(value) || value.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw decodeError('expected an array of bytes')
  }
  if (length !== undefined && value.length !== length) {
    throw decodeError(`expected ${length} bytes, got ${value.length}`)
  }
  return Uint8Array.from(value)
}
