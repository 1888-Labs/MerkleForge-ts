import { type Bytes, concatBytes } from './bytes.js'

/** Domain separator prepended to leaf data before hashing. */
export const LEAF_PREFIX = 0x00
/** Domain separator prepended to two child digests before hashing. */
export const NODE_PREFIX = 0x01

/**
 * A hash function adapter. Trees take one of these at construction, so the
 * same tree code works with SHA-256, Keccak-256, BLAKE3, or your own hash.
 *
 * Implementations must keep leaves and internal nodes in separate domains,
 * e.g. `H(0x00 || data)` for leaves and `H(0x01 || left || right)` for nodes.
 */
export interface HashFunction {
  /** Human-readable name, e.g. `"SHA-256"`. Stored in tree metadata. */
  readonly algorithmName: string
  /** Digest length in bytes. */
  readonly digestSize: number
  /** Hashes leaf data in the leaf domain. */
  hash(data: Bytes): Bytes
  /** Hashes two child digests in the internal-node domain. */
  hashNodes(left: Bytes, right: Bytes): Bytes
  /** Hashes an already-encoded node (used by the Patricia trie for RLP nodes). */
  hashEncodedNode(encoded: Bytes): Bytes
  /** The digest of an empty leaf, used to pad trees to a power of two. */
  empty(): Bytes
  /**
   * Optional batch form of `hashNodes`, for adapters where one call per node
   * is the bottleneck (WebAssembly, native code, a GPU). Hashes the `k` pairs
   * of adjacent digests in `input` (`2k * digestSize` bytes, `left || right`
   * per pair) into `output` (`k * digestSize` bytes). `output` may overlap
   * the start of `input`. Must give the same digests as `hashNodes`; trees
   * call it through `hashNodePairs`, which falls back to `hashNodes`.
   */
  hashNodePairs?(input: Bytes, output: Bytes): void
  /**
   * Optional batch form of `hash`: writes the leaf digest of each entry of
   * `leaves` into `output` (`leaves.length * digestSize` bytes), in order.
   * Trees call it through `hashLeaves`, which falls back to `hash`.
   */
  hashLeaves?(leaves: readonly Bytes[], output: Bytes): void
}

/** The parts of a `HashFunction` that `defineHashFunction` cannot fill in for you. */
export interface HashFunctionSpec {
  algorithmName: string
  digestSize: number
  hash(data: Bytes): Bytes
  hashNodes?(left: Bytes, right: Bytes): Bytes
  hashEncodedNode?(encoded: Bytes): Bytes
  empty?(): Bytes
  hashNodePairs?(input: Bytes, output: Bytes): void
  hashLeaves?(leaves: readonly Bytes[], output: Bytes): void
}

/**
 * Builds a `HashFunction` from a spec, filling in the same defaults as the
 * Rust trait: `hashNodes` hashes `0x01 || left || right` with `hash`,
 * `hashEncodedNode` delegates to `hash`, and `empty` is `hash` of no bytes.
 * `empty` is computed once and returned as a fresh copy on each call.
 */
export function defineHashFunction(spec: HashFunctionSpec): HashFunction {
  const { algorithmName, digestSize, hash } = spec
  const hashNodes =
    spec.hashNodes ??
    ((left: Bytes, right: Bytes) => hash(concatBytes(Uint8Array.of(NODE_PREFIX), left, right)))
  const hashEncodedNode = spec.hashEncodedNode ?? hash
  const emptyDigest = spec.empty?.() ?? hash(new Uint8Array(0))
  const empty = () => emptyDigest.slice()
  const batch: Pick<HashFunction, 'hashNodePairs' | 'hashLeaves'> = {}
  if (spec.hashNodePairs) batch.hashNodePairs = spec.hashNodePairs
  if (spec.hashLeaves) batch.hashLeaves = spec.hashLeaves
  return Object.freeze({
    algorithmName,
    digestSize,
    hash,
    hashNodes,
    hashEncodedNode,
    empty,
    ...batch,
  })
}

/**
 * Hashes the adjacent digest pairs in `input` into `output` with
 * `hasher.hashNodePairs` when the adapter has it, or one `hashNodes` call per
 * pair otherwise. See `HashFunction.hashNodePairs` for the layout.
 */
export function hashNodePairs(hasher: HashFunction, input: Bytes, output: Bytes): void {
  const size = hasher.digestSize
  const count = input.length / (2 * size)
  if (!Number.isInteger(count) || output.length < count * size) {
    throw new RangeError(
      'hashNodePairs: input must hold whole pairs and output one digest per pair',
    )
  }
  if (count === 0) return
  if (hasher.hashNodePairs) {
    hasher.hashNodePairs(input, output)
    return
  }
  for (let i = 0; i < count; i++) {
    const at = 2 * i * size
    const digest = hasher.hashNodes(
      input.subarray(at, at + size),
      input.subarray(at + size, at + 2 * size),
    )
    output.set(checkDigest(digest, size), i * size)
  }
}

/**
 * Writes the leaf digest of every entry of `leaves` into `output`, in order,
 * with `hasher.hashLeaves` when the adapter has it, or `hash` otherwise.
 */
export function hashLeaves(hasher: HashFunction, leaves: readonly Bytes[], output: Bytes): void {
  const size = hasher.digestSize
  if (output.length < leaves.length * size) {
    throw new RangeError('hashLeaves: output must hold one digest per leaf')
  }
  if (leaves.length === 0) return
  if (hasher.hashLeaves) {
    hasher.hashLeaves(leaves, output)
    return
  }
  for (let i = 0; i < leaves.length; i++) {
    output.set(checkDigest(hasher.hash(leaves[i] as Bytes), size), i * size)
  }
}

function checkDigest(digest: Bytes, size: number): Bytes {
  if (digest.length !== size) {
    throw new RangeError(`hash returned ${digest.length} bytes, expected digestSize ${size}`)
  }
  return digest
}
