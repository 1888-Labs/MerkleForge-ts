import { type MerkleProof, toHex } from '@1888-labs/merkle-core'
import type { BinaryMultiProof } from './multiproof.js'
import { SPARSE_TREE_DEPTH, type SparseMerkleProof } from './sparse.js'

/** A `0x`-prefixed hex string, ready for viem, ethers, or any ABI encoder. */
export type Hex = `0x${string}`

/** Arguments for `MerkleForgeBinary.verify` in `contracts/src/MerkleForgeBinary.sol`. */
export interface SolidityBinaryProof {
  leafIndex: bigint
  leafCount: bigint
  siblings: Hex[]
}

/** Arguments for `MerkleForgeSparse.verifyMembership` / `verifyNonMembership`. */
export interface SoliditySparseProof {
  key: Hex
  /** Only the non-empty siblings, leaf level first. */
  siblings: Hex[]
  /** Bit `i` is set when the sibling at level `i` is in `siblings`; unset levels are empty subtrees. */
  bitmap: bigint
}

/** Arguments for `MerkleForgeBinary.verifyMultiProof`. */
export interface SolidityBinaryMultiProof {
  leafIndices: bigint[]
  leafCount: bigint
  hashes: Hex[]
}

const hex = (bytes: Uint8Array) => toHex(bytes) as Hex

/**
 * Converts a `BinaryMerkleTree` proof for the Solidity verifier. The contract
 * hashes with Keccak-256, so the proof must come from a `Keccak256` tree.
 */
export function toSolidityBinaryProof(proof: MerkleProof): SolidityBinaryProof {
  return {
    leafIndex: BigInt(proof.leafIndex),
    leafCount: BigInt(proof.leafCount),
    siblings: proof.path.map((node) => hex(node.hash)),
  }
}

/** Converts a binary multiproof for the Solidity verifier (Keccak-256 trees only). */
export function toSolidityBinaryMultiProof(proof: BinaryMultiProof): SolidityBinaryMultiProof {
  return {
    leafIndices: proof.leafIndices.map(BigInt),
    leafCount: BigInt(proof.leafCount),
    hashes: proof.hashes.map(hex),
  }
}

/**
 * Compresses a sparse proof for the Solidity verifier: empty siblings are
 * dropped and marked in a bitmap, so calldata holds only real hashes.
 * Keccak-256 trees only.
 */
export function toSoliditySparseProof(proof: SparseMerkleProof): SoliditySparseProof {
  if (proof.siblings.length !== SPARSE_TREE_DEPTH)
    throw new RangeError('sparse proofs have 256 siblings')
  let bitmap = 0n
  const siblings: Hex[] = []
  proof.siblings.forEach((sibling, level) => {
    if (sibling === null) return
    bitmap |= 1n << BigInt(level)
    siblings.push(hex(sibling))
  })
  return { key: hex(proof.key), siblings, bitmap }
}
