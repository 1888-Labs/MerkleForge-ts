import {
  type Bytes,
  defineHashFunction,
  type HashFunction,
  LEAF_PREFIX,
  NODE_PREFIX,
} from '@merkleforge/core'
import { WASM_SCALAR, WASM_SIMD } from './wasm-module.js'

const NO_PREFIX = -1
const PAGE = 65536

interface Exports {
  memory: WebAssembly.Memory
  __heap_base: WebAssembly.Global
  keccak_many(prefix: number, input: number, lens: number, count: number, out: number): void
  keccak_pairs(prefix: number, input: number, count: number, out: number): void
  sha256_many(prefix: number, input: number, lens: number, count: number, out: number): void
  sha256_pairs(prefix: number, input: number, count: number, out: number): void
}

let compiled: Promise<WebAssembly.Module> | undefined

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Compiles the embedded module once, preferring the SIMD build (two Keccak
 * permutations per instruction stream) when the engine validates it. Each
 * adapter gets its own instance and memory.
 */
async function instantiate(): Promise<Exports> {
  compiled ??= (async () => {
    const simd = decodeBase64(WASM_SIMD)
    return WebAssembly.compile(WebAssembly.validate(simd) ? simd : decodeBase64(WASM_SCALAR))
  })()
  const instance = await WebAssembly.instantiate(await compiled)
  return instance.exports as unknown as Exports
}

type Many = (prefix: number, input: number, lens: number, count: number, out: number) => void
type Pairs = (prefix: number, input: number, count: number, out: number) => void

/**
 * A handle on one module instance that copies inputs into linear memory
 * (growing it when needed), runs one batch call, and copies digests out.
 */
class Engine {
  readonly #x: Exports
  readonly #base: number
  readonly #many: Many
  readonly #pairs: Pairs

  constructor(x: Exports, many: Many, pairs: Pairs) {
    this.#x = x
    // Align the scratch area so the length table can use a Uint32Array view.
    this.#base = Math.ceil((x.__heap_base.value as number) / 8) * 8
    this.#many = many
    this.#pairs = pairs
  }

  /** Memory from the scratch base, at least `size` bytes long. */
  #scratch(size: number): Uint8Array {
    const needed = this.#base + size
    const { memory } = this.#x
    if (memory.buffer.byteLength < needed) {
      memory.grow(Math.ceil((needed - memory.buffer.byteLength) / PAGE))
    }
    return new Uint8Array(memory.buffer, this.#base, size)
  }

  /** Digest of `prefix || data`. */
  one(prefix: number, data: Bytes): Bytes {
    const inputSize = align(data.length)
    const mem = this.#scratch(inputSize + 4 + 32)
    mem.set(data)
    new DataView(mem.buffer, this.#base + inputSize, 4).setUint32(0, data.length, true)
    this.#many(prefix, this.#base, this.#base + inputSize, 1, this.#base + inputSize + 4)
    return mem.slice(inputSize + 4, inputSize + 36)
  }

  /** Digest of `prefix || left || right` for 32-byte nodes. */
  two(prefix: number, left: Bytes, right: Bytes): Bytes {
    if (left.length !== 32 || right.length !== 32) {
      const joined = new Uint8Array(left.length + right.length)
      joined.set(left)
      joined.set(right, left.length)
      return this.one(prefix, joined)
    }
    const mem = this.#scratch(64)
    mem.set(left)
    mem.set(right, 32)
    this.#pairs(prefix, this.#base, 1, this.#base)
    return mem.slice(0, 32)
  }

  pairs(prefix: number, input: Bytes, output: Bytes): void {
    const count = input.length / 64
    const mem = this.#scratch(input.length)
    mem.set(input)
    this.#pairs(prefix, this.#base, count, this.#base)
    output.set(mem.subarray(0, count * 32))
  }

  many(prefix: number, leaves: readonly Bytes[], output: Bytes): void {
    let total = 0
    for (const leaf of leaves) total += leaf.length
    const lensAt = align(total)
    const outAt = lensAt + 4 * leaves.length
    const mem = this.#scratch(outAt + 32 * leaves.length)
    const lens = new Uint32Array(mem.buffer, this.#base + lensAt, leaves.length)
    let offset = 0
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i] as Bytes
      mem.set(leaf, offset)
      lens[i] = leaf.length
      offset += leaf.length
    }
    this.#many(prefix, this.#base, this.#base + lensAt, leaves.length, this.#base + outAt)
    output.set(mem.subarray(outAt, outAt + 32 * leaves.length))
  }
}

function align(n: number): number {
  return Math.ceil(n / 8) * 8
}

function adapter(algorithmName: string, engine: Engine, encodedNode = false): HashFunction {
  return defineHashFunction({
    algorithmName,
    digestSize: 32,
    hash: (data) => engine.one(LEAF_PREFIX, data),
    hashNodes: (left, right) => engine.two(NODE_PREFIX, left, right),
    ...(encodedNode ? { hashEncodedNode: (encoded: Bytes) => engine.one(NO_PREFIX, encoded) } : {}),
    hashNodePairs: (input, output) => engine.pairs(NODE_PREFIX, input, output),
    hashLeaves: (leaves, output) => engine.many(LEAF_PREFIX, leaves, output),
  })
}

/**
 * Keccak-256 backed by WebAssembly. Same output and `algorithmName` as
 * `Keccak256` from `@merkleforge/hash`, so trees, proofs, and JSON built with
 * either are interchangeable. Builds large trees about 6–7x faster than the
 * pure-JS adapter in Node because it hashes whole tree layers in one call
 * (`hashNodePairs`). Numbers and how to reproduce them: BENCHMARKS.md.
 */
export async function createKeccak256Wasm(): Promise<HashFunction> {
  const x = await instantiate()
  return adapter('Keccak-256', new Engine(x, x.keccak_many, x.keccak_pairs), true)
}

/**
 * SHA-256 backed by WebAssembly. Same output and `algorithmName` as `Sha256`
 * from `@merkleforge/hash`.
 */
export async function createSha256Wasm(): Promise<HashFunction> {
  const x = await instantiate()
  return adapter('SHA-256', new Engine(x, x.sha256_many, x.sha256_pairs))
}
