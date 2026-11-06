// Deterministic inputs shared by run.mjs and parity.mjs, so the trees checked
// for byte-for-byte parity are exactly the trees that get timed.
import { toHex } from '../packages/merkle-core/dist/index.js'

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/** `n` random 32-byte leaves, `ops` random indices, and `[address, uint256]` accounts. */
export function inputs(n, ops) {
  const rand = rng(n)
  const leaves = Array.from({ length: n }, () => {
    const b = new Uint8Array(32)
    for (let i = 0; i < 32; i++) b[i] = Math.floor(rand() * 256)
    b[0] &= 0x1f // keeps every leaf a valid BN254 field element for the Poseidon2 trees
    return b
  })
  const indices = Array.from({ length: ops }, () => Math.floor(rand() * n))
  const accounts = leaves.map((leaf, i) => [toHex(leaf.subarray(0, 20)), String(1000n + BigInt(i))])
  return { leaves, indices, accounts }
}
