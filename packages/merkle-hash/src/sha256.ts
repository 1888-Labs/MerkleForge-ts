import { concatBytes, defineHashFunction, LEAF_PREFIX, NODE_PREFIX } from '@1888-labs/merkle-core'
import { sha256 as sha2_256 } from '@noble/hashes/sha2.js'

/**
 * SHA-256 with MerkleForge domain separation.
 *
 * - Leaf: `SHA-256(0x00 || data)`
 * - Internal node: `SHA-256(0x01 || left || right)`
 */
export const Sha256 = defineHashFunction({
  algorithmName: 'SHA-256',
  digestSize: 32,
  hash: (data) => sha2_256(concatBytes(Uint8Array.of(LEAF_PREFIX), data)),
  hashNodes: (left, right) => sha2_256(concatBytes(Uint8Array.of(NODE_PREFIX), left, right)),
})
