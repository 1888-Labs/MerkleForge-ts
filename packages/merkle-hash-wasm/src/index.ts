import {
  type Bytes,
  defineHashFunction,
  type HashFunction,
  LEAF_PREFIX,
  NODE_PREFIX,
} from '@1888-labs/merkle-core'
import { createKeccak, createSHA256, type IHasher } from 'hash-wasm'

const LEAF = Uint8Array.of(LEAF_PREFIX)
const NODE = Uint8Array.of(NODE_PREFIX)

function digest(hasher: IHasher, ...parts: Bytes[]): Bytes {
  hasher.init()
  for (const part of parts) hasher.update(part)
  return hasher.digest('binary')
}

/**
 * Keccak-256 backed by WebAssembly. Same output and `algorithmName` as
 * `Keccak256` from `@1888-labs/merkle-hash` (about 6x faster in Node), so trees,
 * proofs, and JSON built with either are interchangeable.
 */
export async function createKeccak256Wasm(): Promise<HashFunction> {
  const hasher = await createKeccak(256)
  return defineHashFunction({
    algorithmName: 'Keccak-256',
    digestSize: 32,
    hash: (data) => digest(hasher, LEAF, data),
    hashNodes: (left, right) => digest(hasher, NODE, left, right),
    hashEncodedNode: (encoded) => digest(hasher, encoded),
  })
}

/**
 * SHA-256 backed by WebAssembly. Same output and `algorithmName` as `Sha256`
 * from `@1888-labs/merkle-hash`.
 */
export async function createSha256Wasm(): Promise<HashFunction> {
  const hasher = await createSHA256()
  return defineHashFunction({
    algorithmName: 'SHA-256',
    digestSize: 32,
    hash: (data) => digest(hasher, LEAF, data),
    hashNodes: (left, right) => digest(hasher, NODE, left, right),
  })
}
