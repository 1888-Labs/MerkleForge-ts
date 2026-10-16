export { type Bytes, bytesEqual, concatBytes, fromHex, toHex, utf8 } from './bytes.js'
export {
  isMerkleError,
  MerkleError,
  type MerkleErrorCode,
  type MerkleErrorDetail,
} from './errors.js'
export {
  defineHashFunction,
  type HashFunction,
  type HashFunctionSpec,
  LEAF_PREFIX,
  NODE_PREFIX,
} from './hash-function.js'
export type { MerkleTree, ProofVerifier } from './merkle-tree.js'
export {
  isTrivialProof,
  type MerkleProof,
  type ProofNode,
  type ProofSide,
  proofDepth,
  type TreeMetadata,
} from './types.js'
