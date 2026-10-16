import type { Bytes } from './bytes.js'
import type { HashFunction } from './hash-function.js'
import type { MerkleProof, TreeMetadata } from './types.js'

/**
 * The interface every MerkleForge tree implements, so integrations can switch
 * variants without changing call sites. Operations throw `MerkleError`.
 */
export interface MerkleTree {
  /** The hash function this tree was built with. */
  readonly hasher: HashFunction
  /** Appends a leaf and returns its index. Throws `EmptyLeafData` for empty input. */
  insert(data: Bytes): number
  /** Clears the leaf at `index`. Throws `EmptyTree` or `IndexOutOfBounds`. */
  remove(index: number): void
  /** The current root, or `undefined` when the tree is empty. */
  root(): Bytes | undefined
  /** Number of leaves. */
  readonly leafCount: number
  /** True when the tree holds no leaves. */
  isEmpty(): boolean
  /** Number of levels, counting the leaf layer. Zero when empty. */
  readonly height: number
  /** Builds an inclusion proof for the leaf at `index`. */
  generateProof(index: number): MerkleProof
  /** Shape summary. */
  metadata(): TreeMetadata
}

/** Checks a proof against a root without holding the tree. */
export type ProofVerifier = (
  hasher: HashFunction,
  expectedRoot: Bytes,
  leafData: Bytes,
  proof: MerkleProof,
) => boolean
