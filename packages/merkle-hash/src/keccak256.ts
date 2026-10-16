import { concatBytes, defineHashFunction, LEAF_PREFIX, NODE_PREFIX } from '@1888-labs/merkle-core'
import { keccak_256 } from '@noble/hashes/sha3.js'

/**
 * Keccak-256 (the Ethereum variant, not NIST SHA3-256) with MerkleForge
 * domain separation.
 *
 * - Leaf: `Keccak-256(0x00 || data)`
 * - Internal node: `Keccak-256(0x01 || left || right)`
 * - Encoded node: plain `Keccak-256(encoded)`, so Patricia trie roots match Ethereum.
 */
export const Keccak256 = defineHashFunction({
  algorithmName: 'Keccak-256',
  digestSize: 32,
  hash: (data) => keccak_256(concatBytes(Uint8Array.of(LEAF_PREFIX), data)),
  hashNodes: (left, right) => keccak_256(concatBytes(Uint8Array.of(NODE_PREFIX), left, right)),
  hashEncodedNode: (encoded) => keccak_256(encoded),
})
