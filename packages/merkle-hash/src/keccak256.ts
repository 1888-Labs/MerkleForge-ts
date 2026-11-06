import {
  type Bytes,
  defineHashFunction,
  type HashFunction,
  LEAF_PREFIX,
  NODE_PREFIX,
} from '@merkleforge/core'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { keccakF1600 } from './keccak-f1600.js'

const RATE = 136
const NO_PREFIX = -1

// One shared sponge. Hashing never calls user code, so it cannot be re-entered.
const state = new Int32Array(50)
const stateBytes = new Uint8Array(state.buffer)
const block = new Uint8Array(RATE)
const blockWords = new Int32Array(block.buffer)
let blockPos = 0

// The typed-array views above assume little-endian words. Every current JS
// engine on every common CPU is little-endian; fall back to noble otherwise.
const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

function absorbBlock(): void {
  for (let i = 0; i < 34; i++) state[i] = (state[i] as number) ^ (blockWords[i] as number)
  keccakF1600(state)
}

function absorb(data: Bytes): void {
  let i = 0
  while (i < data.length) {
    const take = Math.min(RATE - blockPos, data.length - i)
    block.set(take === data.length ? data : data.subarray(i, i + take), blockPos)
    blockPos += take
    i += take
    if (blockPos === RATE) {
      absorbBlock()
      blockPos = 0
    }
  }
}

/** Keccak-256 of `prefix` (a byte, or `NO_PREFIX`) followed by `a` and `b`, written to `out[at..at + 32]`. */
function sponge(prefix: number, a: Bytes, b: Bytes | undefined, out: Bytes, at: number): void {
  state.fill(0)
  blockPos = 0
  if (prefix !== NO_PREFIX) block[blockPos++] = prefix
  absorb(a)
  if (b !== undefined) absorb(b)
  block.fill(0, blockPos)
  block[blockPos] = (block[blockPos] as number) ^ 0x01
  block[RATE - 1] = (block[RATE - 1] as number) ^ 0x80
  absorbBlock()
  out.set(stateBytes.subarray(0, 32), at)
}

function digest(prefix: number, a: Bytes, b?: Bytes): Bytes {
  const out = new Uint8Array(32)
  sponge(prefix, a, b, out, 0)
  return out
}

function nobleDigest(prefix: number, a: Bytes, b?: Bytes): Bytes {
  const prefixLength = prefix === NO_PREFIX ? 0 : 1
  const input = new Uint8Array(prefixLength + a.length + (b?.length ?? 0))
  if (prefixLength) input[0] = prefix
  input.set(a, prefixLength)
  if (b) input.set(b, prefixLength + a.length)
  return keccak_256(input)
}

const keccak = littleEndian ? digest : nobleDigest

/**
 * Plain Keccak-256 of `data`, or of `data || more` without building the
 * concatenation (the Ethereum variant, no domain prefix). Same output as
 * `keccak_256` from `@noble/hashes`, about 2x faster on the short inputs
 * Merkle trees hash.
 */
export function keccak256(data: Bytes, more?: Bytes): Bytes {
  return keccak(NO_PREFIX, data, more)
}

function hashNodePairs(input: Bytes, output: Bytes): void {
  const count = input.length / 64
  for (let i = 0; i < count; i++) {
    const at = 64 * i
    sponge(NODE_PREFIX, input.subarray(at, at + 64), undefined, output, 32 * i)
  }
}

function hashLeaves(leaves: readonly Bytes[], output: Bytes): void {
  for (let i = 0; i < leaves.length; i++) {
    sponge(LEAF_PREFIX, leaves[i] as Bytes, undefined, output, 32 * i)
  }
}

/**
 * Keccak-256 (the Ethereum variant, not NIST SHA3-256) with MerkleForge
 * domain separation.
 *
 * - Leaf: `Keccak-256(0x00 || data)`
 * - Internal node: `Keccak-256(0x01 || left || right)`
 * - Encoded node: plain `Keccak-256(encoded)`, so Patricia trie roots match Ethereum.
 */
export const Keccak256: HashFunction = defineHashFunction({
  algorithmName: 'Keccak-256',
  digestSize: 32,
  hash: (data) => keccak(LEAF_PREFIX, data),
  hashNodes: (left, right) => keccak(NODE_PREFIX, left, right),
  hashEncodedNode: (encoded) => keccak(NO_PREFIX, encoded),
  ...(littleEndian ? { hashNodePairs, hashLeaves } : {}),
})
