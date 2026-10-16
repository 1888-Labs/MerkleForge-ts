import type { Bytes } from './bytes.js'

/** Which side of the running hash a proof sibling sits on. */
export type ProofSide = 'left' | 'right'

/** One step of an inclusion proof: a sibling digest and its side. */
export interface ProofNode {
  readonly hash: Bytes
  readonly side: ProofSide
}

/** An inclusion proof for one leaf, ordered from the leaf up to the root. */
export interface MerkleProof {
  readonly leafIndex: number
  readonly leafCount: number
  readonly path: readonly ProofNode[]
}

/** Summary of a tree's shape, mirroring the Rust `TreeMetadata`. */
export interface TreeMetadata {
  readonly leafCount: number
  readonly height: number
  readonly nodeCount: number
  readonly hashAlgorithm: string
  readonly variant: string
}

/** Number of sibling hashes in a proof. */
export function proofDepth(proof: MerkleProof): number {
  return proof.path.length
}

/** True when the proof has no siblings, i.e. the tree holds a single leaf. */
export function isTrivialProof(proof: MerkleProof): boolean {
  return proof.path.length === 0
}
