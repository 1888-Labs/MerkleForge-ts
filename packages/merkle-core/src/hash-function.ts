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
}

/** The parts of a `HashFunction` that `defineHashFunction` cannot fill in for you. */
export interface HashFunctionSpec {
  algorithmName: string
  digestSize: number
  hash(data: Bytes): Bytes
  hashNodes?(left: Bytes, right: Bytes): Bytes
  hashEncodedNode?(encoded: Bytes): Bytes
  empty?(): Bytes
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
  return Object.freeze({ algorithmName, digestSize, hash, hashNodes, hashEncodedNode, empty })
}
