import {
  BincodeReader,
  BincodeWriter,
  type Bytes,
  byteArrayFromJSON,
  bytesEqual,
  type HashFunction,
  MerkleError,
} from '@1888-labs/merkle-core'

/**
 * One proof for several leaves of a `BinaryMerkleTree`. `hashes` holds only
 * the siblings that cannot be computed from the proven leaves, ordered layer
 * by layer from the leaves up, left to right within a layer. Proving `k` of
 * `n` leaves needs at most `k * log2(n)` hashes and often far fewer.
 */
export interface BinaryMultiProof {
  /** Proven leaf indices, strictly increasing. */
  readonly leafIndices: readonly number[]
  readonly leafCount: number
  readonly hashes: readonly Bytes[]
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function isValidIndexSet(indices: readonly number[], leafCount: number): boolean {
  if (!Number.isSafeInteger(leafCount) || leafCount <= 0 || indices.length === 0) return false
  return indices.every(
    (index, i) =>
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < leafCount &&
      (i === 0 || index > (indices[i - 1] as number)),
  )
}

/**
 * Walks the layers above `indices` and returns, in proof order, the position
 * `[layer, offset]` of every sibling the proof must carry.
 */
export function multiProofSiblingPositions(
  indices: readonly number[],
  leafCount: number,
): [number, number][] {
  const positions: [number, number][] = []
  let known = [...indices]
  for (let layer = 0, width = nextPowerOfTwo(leafCount); width > 1; layer++, width /= 2) {
    const next: number[] = []
    for (let i = 0; i < known.length; i++) {
      const offset = known[i] as number
      if (offset % 2 === 0 && known[i + 1] === offset + 1) i++
      else positions.push([layer, offset ^ 1])
      next.push(Math.floor(offset / 2))
    }
    known = next
  }
  return positions
}

/** Checks a multiproof for `leaves` (raw data, in `proof.leafIndices` order) against `expectedRoot`. */
export function verifyBinaryMultiProof(
  hasher: HashFunction,
  expectedRoot: Bytes,
  leaves: readonly Bytes[],
  proof: BinaryMultiProof,
): boolean {
  const { leafIndices, leafCount, hashes } = proof
  if (!isValidIndexSet(leafIndices, leafCount) || leaves.length !== leafIndices.length) return false
  if (leaves.some((leaf) => leaf.length === 0)) return false

  let known: [number, Bytes][] = leafIndices.map((index, i) => [
    index,
    hasher.hash(leaves[i] as Bytes),
  ])
  let used = 0
  for (let width = nextPowerOfTwo(leafCount); width > 1; width /= 2) {
    const next: [number, Bytes][] = []
    for (let i = 0; i < known.length; i++) {
      const [offset, hash] = known[i] as [number, Bytes]
      const right = known[i + 1]
      let parent: Bytes
      if (offset % 2 === 0 && right?.[0] === offset + 1) {
        parent = hasher.hashNodes(hash, right[1])
        i++
      } else {
        const sibling = hashes[used++]
        if (sibling === undefined) return false
        parent =
          offset % 2 === 0 ? hasher.hashNodes(hash, sibling) : hasher.hashNodes(sibling, hash)
      }
      next.push([Math.floor(offset / 2), parent])
    }
    known = next
  }
  const [root] = known
  return used === hashes.length && root !== undefined && bytesEqual(root[1], expectedRoot)
}

/**
 * Encodes a multiproof exactly like the Rust `BinaryMultiProof::to_bytes()`
 * (bincode 2, standard config).
 */
export function encodeBinaryMultiProof(proof: BinaryMultiProof): Bytes {
  const w = new BincodeWriter()
  w.seq(proof.leafIndices, (index) => w.varint(index))
  w.varint(proof.leafCount)
  w.seq(proof.hashes, (hash) => w.fixedBytes(hash))
  return w.finish()
}

export function decodeBinaryMultiProof(bytes: Bytes, digestSize = 32): BinaryMultiProof {
  const r = new BincodeReader(bytes)
  const leafIndices = r.seq(() => r.varint())
  const leafCount = r.varint()
  const hashes = r.seq(() => r.fixedBytes(digestSize))
  r.end()
  if (!isValidIndexSet(leafIndices, leafCount)) {
    throw new MerkleError({
      code: 'DeserializationError',
      reason: 'invalid multiproof leaf indices',
    })
  }
  return { leafIndices, leafCount, hashes }
}

/** Sorts and de-duplicates requested indices, throwing for any out of range. */
export function normalizeMultiProofIndices(indices: Iterable<number>, leafCount: number): number[] {
  if (leafCount === 0) throw new MerkleError({ code: 'EmptyTree' })
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  if (sorted.length === 0) {
    throw new MerkleError({
      code: 'InvalidProofStructure',
      reason: 'a multiproof needs at least one leaf',
    })
  }
  for (const index of sorted) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= leafCount) {
      throw new MerkleError({ code: 'IndexOutOfBounds', index, len: leafCount })
    }
  }
  return sorted
}

/** The `serde_json` shape of a Rust `BinaryMultiProof<[u8; 32]>`. */
export interface BinaryMultiProofSerdeJSON {
  leaf_indices: number[]
  leaf_count: number
  hashes: number[][]
}

export function multiProofToSerdeJSON(proof: BinaryMultiProof): BinaryMultiProofSerdeJSON {
  return {
    leaf_indices: [...proof.leafIndices],
    leaf_count: proof.leafCount,
    hashes: proof.hashes.map((hash) => [...hash]),
  }
}

export function multiProofFromSerdeJSON(
  json: BinaryMultiProofSerdeJSON,
  digestSize = 32,
): BinaryMultiProof {
  if (!isValidIndexSet(json.leaf_indices, json.leaf_count)) {
    throw new MerkleError({
      code: 'DeserializationError',
      reason: 'invalid multiproof leaf indices',
    })
  }
  return {
    leafIndices: [...json.leaf_indices],
    leafCount: json.leaf_count,
    hashes: json.hashes.map((hash) => byteArrayFromJSON(hash, digestSize)),
  }
}
