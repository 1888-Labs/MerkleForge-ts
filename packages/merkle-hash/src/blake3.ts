import { concatBytes, defineHashFunction, utf8 } from '@1888-labs/merkle-core'
import { blake3 } from '@noble/hashes/blake3.js'

const LEAF_CONTEXT = utf8('MerkleForge 2026 leaf v1')
const NODE_CONTEXT = utf8('MerkleForge 2026 internal-node v1')

/**
 * BLAKE3 in `derive_key` mode, with separate context strings for leaves and
 * internal nodes instead of byte prefixes.
 */
export const Blake3 = defineHashFunction({
  algorithmName: 'BLAKE3',
  digestSize: 32,
  hash: (data) => blake3(data, { context: LEAF_CONTEXT }),
  hashNodes: (left, right) => blake3(concatBytes(left, right), { context: NODE_CONTEXT }),
})
