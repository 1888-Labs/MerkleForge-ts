import {
  type Bytes,
  bytesEqual,
  fromHex,
  type HashFunction,
  MerkleError,
  type MerkleProof,
  type MerkleTree,
  type ProofNode,
  type TreeMetadata,
  toHex,
} from '@1888-labs/merkle-core'

/** Fixed tree depth for MerkleForge sparse Merkle trees. */
export const SPARSE_TREE_DEPTH = 256
/** Number of cached empty hashes (levels 0..=256). */
export const EMPTY_HASH_LEVELS = SPARSE_TREE_DEPTH + 1
/** Maximum subtree depth stored as a single batch entry. */
export const BATCH_DEPTH = 4
/** Sparse keys are 256 bits. */
export const SPARSE_KEY_BYTES = 32

/**
 * A key-addressed sparse Merkle proof.
 *
 * `siblings` run from the leaf level to the root and always hold 256 entries.
 * `null` marks an empty sibling subtree, which verifiers rebuild from the
 * empty-hash chain. `leaf` is the stored leaf hash, or `null` for a
 * non-membership proof.
 */
export interface SparseMerkleProof {
  readonly key: Bytes
  readonly siblings: readonly (Bytes | null)[]
  readonly leaf: Bytes | null
}

/** JSON form of a `SparseMerkleTree`: the hash name and `[key, leafHash]` pairs in key order. */
export interface SparseMerkleTreeJSON {
  hashAlgorithm: string
  leaves: [key: string, leafHash: string][]
}

/** True when `proof` carries a stored leaf hash. */
export function isSparseMembershipProof(proof: SparseMerkleProof): boolean {
  return proof.leaf !== null
}

/**
 * Returns the bit at `depth` in `key`, most-significant bit first: depth `0`
 * is the high bit of `key[0]` and depth `255` the low bit of `key[31]`.
 */
export function bitAt(key: Bytes, depth: number): boolean {
  if (!Number.isInteger(depth) || depth < 0 || depth >= SPARSE_TREE_DEPTH) {
    throw new RangeError(`bitAt: depth ${depth} out of range (max ${SPARSE_TREE_DEPTH - 1})`)
  }
  return ((key[depth >> 3] ?? 0) & (1 << (7 - (depth & 7)))) !== 0
}

type NodeEntry =
  | { kind: 'leaf'; hash: Bytes }
  | { kind: 'internal'; hash: Bytes }
  | { kind: 'shortcut'; prefix: number; hash: Bytes }
  | { kind: 'batch'; root: Bytes; nodes: Map<number, Bytes> }

function commitment(entry: NodeEntry): Bytes {
  return entry.kind === 'batch' ? entry.root : entry.hash
}

interface Leaf {
  readonly key: Bytes
  readonly hex: string
  readonly hash: Bytes
  /**
   * Cached roots of the single-leaf subtree above this leaf: `chain[i]` is
   * the commitment at depth `256 - i`, so `chain[0]` is the leaf hash. Grown
   * on demand; a new `Leaf` is created whenever the hash changes.
   */
  readonly chain: Bytes[]
}

function makeLeaf(key: Bytes, hex: string, hash: Bytes): Leaf {
  return { key, hex, hash, chain: [hash] }
}

/** A node position: its depth plus the key prefix of that length, zero-padded. */
class NodeKey {
  readonly depth: number
  readonly path: Bytes
  #id: string | undefined

  private constructor(depth: number, path: Bytes) {
    this.depth = depth
    this.path = path
  }

  get id(): string {
    this.#id ??= `${this.depth}:${toHex(this.path)}`
    return this.#id
  }

  static of(key: Bytes, depth: number): NodeKey {
    const path = new Uint8Array(SPARSE_KEY_BYTES)
    const fullBytes = depth >> 3
    const remainingBits = depth & 7
    path.set(key.subarray(0, fullBytes))
    if (remainingBits > 0) path[fullBytes] = (key[fullBytes] ?? 0) & (0xff << (8 - remainingBits))
    return new NodeKey(depth, path)
  }

  static sibling(key: Bytes, depth: number): NodeKey {
    const node = NodeKey.of(key, depth)
    const bit = depth - 1
    const path = node.path.slice()
    path[bit >> 3] = (path[bit >> 3] ?? 0) ^ (1 << (7 - (bit & 7)))
    return new NodeKey(depth, path)
  }

  child(right: boolean): NodeKey {
    const path = this.path.slice()
    if (right) path[this.depth >> 3] = (path[this.depth >> 3] ?? 0) | (1 << (7 - (this.depth & 7)))
    return new NodeKey(this.depth + 1, path)
  }

  /** The largest 256-bit key under this node's prefix. */
  lastKey(): Bytes {
    const last = this.path.slice()
    const fullBytes = this.depth >> 3
    const remainingBits = this.depth & 7
    let firstFree = fullBytes
    if (remainingBits > 0) {
      last[fullBytes] = (last[fullBytes] ?? 0) | (0xff >> remainingBits)
      firstFree += 1
    }
    last.fill(0xff, firstFree)
    return last
  }
}

function checkKey(key: Bytes): void {
  if (key.length !== SPARSE_KEY_BYTES) {
    throw new TypeError(`sparse keys must be ${SPARSE_KEY_BYTES} bytes, got ${key.length}`)
  }
}

function lowerBound(sorted: readonly string[], target: string): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] as string) < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBound(sorted: readonly string[], target: string): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] as string) <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function splitByBit(leaves: readonly Leaf[], depth: number): [Leaf[], Leaf[]] {
  const left: Leaf[] = []
  const right: Leaf[] = []
  for (const leaf of leaves) (bitAt(leaf.key, depth) ? right : left).push(leaf)
  return [left, right]
}

function keyForLeafIndex(index: number): Bytes {
  const key = new Uint8Array(SPARSE_KEY_BYTES)
  new DataView(key.buffer).setBigUint64(24, BigInt(index))
  return key
}

/**
 * A sparse Merkle tree over a 256-bit key space.
 *
 * Only non-empty nodes are stored. Empty subtrees use a precomputed hash per
 * level, single-leaf subtrees collapse into shortcut nodes, and the bottom
 * four levels are stored as batches. Mutations recompute only the stored
 * nodes on the changed key paths.
 */
export class SparseMerkleTree {
  readonly hasher: HashFunction
  #nodes = new Map<string, NodeEntry>()
  #leaves = new Map<string, Leaf>()
  #sorted: string[] = []
  #root: Bytes
  #emptyHashes: Bytes[]
  #lastNodeAccesses = 0
  #nextIndexHint = 0

  constructor(hasher: HashFunction) {
    this.hasher = hasher
    let current = hasher.empty()
    this.#emptyHashes = [current]
    for (let level = 1; level <= SPARSE_TREE_DEPTH; level++) {
      current = hasher.hashNodes(current, current)
      this.#emptyHashes.push(current)
    }
    this.#root = current
  }

  /** Rebuilds a tree from `toJSON()` output. */
  static fromJSON(hasher: HashFunction, json: SparseMerkleTreeJSON): SparseMerkleTree {
    if (json.hashAlgorithm !== hasher.algorithmName) {
      throw new MerkleError({
        code: 'DeserializationError',
        reason: `tree was built with ${json.hashAlgorithm}, expected ${hasher.algorithmName}`,
      })
    }
    const tree = new SparseMerkleTree(hasher)
    const empty = hasher.empty()
    for (const [keyHex, hashHex] of json.leaves) {
      const key = fromHex(keyHex)
      const hash = fromHex(hashHex)
      if (key.length !== SPARSE_KEY_BYTES || hash.length !== hasher.digestSize) {
        throw new MerkleError({ code: 'DeserializationError', reason: 'malformed sparse leaf' })
      }
      if (bytesEqual(hash, empty)) {
        throw new MerkleError({
          code: 'DeserializationError',
          reason: 'leaf hash equals the empty leaf',
        })
      }
      const hex = toHex(key)
      if (tree.#leaves.has(hex)) {
        throw new MerkleError({ code: 'DeserializationError', reason: 'duplicate sparse key' })
      }
      tree.#leaves.set(hex, makeLeaf(key, hex, hash))
    }
    tree.#sorted = [...tree.#leaves.keys()].sort()
    tree.#rebuild()
    return tree
  }

  /** Inserts or overwrites the leaf at `key`. `data` is hashed before it is stored. */
  insert(key: Bytes, data: Bytes): void {
    checkKey(key)
    if (data.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
    this.#setLeaf(key, this.hasher.hash(data), true)
    this.#applyChanges([key])
  }

  /**
   * Inserts or overwrites many leaves, recomputing each affected node once.
   * When a key appears more than once, the last value wins.
   */
  batchInsert(updates: Iterable<readonly [key: Bytes, data: Bytes]>): void {
    const list = [...updates]
    for (const [key, data] of list) {
      checkKey(key)
      if (data.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
    }
    if (list.length === 0) {
      this.#lastNodeAccesses = 0
      return
    }

    const changed = new Map<string, Bytes>()
    for (const [key, data] of list) {
      const added = this.#setLeaf(key, this.hasher.hash(data), false)
      if (added) this.#sorted.push(toHex(key))
      changed.set(toHex(key), key)
    }
    this.#sorted.sort()
    this.#applyChanges(
      [...changed.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, k]) => k),
    )
  }

  /** Removes the leaf at `key`. Throws `UnsupportedOperation` when the key is absent. */
  remove(key: Bytes): void {
    checkKey(key)
    if (!this.#deleteLeaf(toHex(key))) {
      throw new MerkleError({
        code: 'UnsupportedOperation',
        operation: 'remove missing sparse key',
      })
    }
    this.#applyChanges([key])
  }

  /** Removes many leaves in one pass. Throws `UnsupportedOperation` if any key is absent. */
  batchRemove(keys: Iterable<Bytes>): void {
    const unique = new Map<string, Bytes>()
    for (const key of keys) {
      checkKey(key)
      unique.set(toHex(key), key)
    }
    if (unique.size === 0) {
      this.#lastNodeAccesses = 0
      return
    }
    for (const hex of unique.keys()) {
      if (!this.#leaves.has(hex)) {
        throw new MerkleError({
          code: 'UnsupportedOperation',
          operation: 'remove missing sparse key',
        })
      }
    }
    for (const hex of unique.keys()) this.#deleteLeaf(hex)
    this.#applyChanges([...unique.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, k]) => k))
  }

  /** The hashed leaf stored at `key`, if any. */
  get(key: Bytes): Bytes | undefined {
    checkKey(key)
    return this.#leaves.get(toHex(key))?.hash.slice()
  }

  /**
   * Builds a proof for `key`: a membership proof when the key is stored,
   * otherwise a non-membership proof with `leaf: null`.
   */
  generateMembershipProof(key: Bytes): SparseMerkleProof {
    checkKey(key)
    const siblings: (Bytes | null)[] = []
    for (let depth = SPARSE_TREE_DEPTH; depth >= 1; depth--) {
      siblings.push(this.#subtreeHashAt(NodeKey.sibling(key, depth))?.slice() ?? null)
    }
    return { key: key.slice(), siblings, leaf: this.get(key) ?? null }
  }

  /** Checks that `key` holds `leafData` in the tree with root `expectedRoot`. */
  static verifyMembership(
    hasher: HashFunction,
    expectedRoot: Bytes,
    key: Bytes,
    leafData: Bytes,
    proof: SparseMerkleProof,
  ): boolean {
    if (!bytesEqual(proof.key, key) || leafData.length === 0) return false
    if (proof.key.length !== SPARSE_KEY_BYTES || proof.siblings.length !== SPARSE_TREE_DEPTH)
      return false
    const leafHash = hasher.hash(leafData)
    return (
      proof.leaf !== null &&
      bytesEqual(proof.leaf, leafHash) &&
      bytesEqual(reconstructRoot(hasher, proof.key, leafHash, proof.siblings), expectedRoot)
    )
  }

  /** Checks that `key` is absent from the tree with root `expectedRoot`. */
  static verifyNonMembership(
    hasher: HashFunction,
    expectedRoot: Bytes,
    key: Bytes,
    proof: SparseMerkleProof,
  ): boolean {
    return (
      bytesEqual(proof.key, key) &&
      proof.key.length === SPARSE_KEY_BYTES &&
      proof.leaf === null &&
      proof.siblings.length === SPARSE_TREE_DEPTH &&
      bytesEqual(reconstructRoot(hasher, proof.key, hasher.empty(), proof.siblings), expectedRoot)
    )
  }

  /** The current root, or `undefined` when no leaves are stored. See `emptyRoot()`. */
  root(): Bytes | undefined {
    return this.isEmpty() ? undefined : this.#root.slice()
  }

  /** The root of a fully empty tree (the empty hash at level 256). */
  emptyRoot(): Bytes {
    return this.emptyHashAt(SPARSE_TREE_DEPTH)
  }

  /** The cached empty hash at `level`: `0` is the empty leaf, `256` the empty root. */
  emptyHashAt(level: number): Bytes {
    const hash = this.#emptyHashes[level]
    if (hash === undefined) {
      throw new RangeError(`emptyHashAt: level ${level} out of range (max ${SPARSE_TREE_DEPTH})`)
    }
    return hash.slice()
  }

  /** Copies of all 257 cached empty hashes. */
  emptyHashes(): Bytes[] {
    return this.#emptyHashes.map((hash) => hash.slice())
  }

  get leafCount(): number {
    return this.#leaves.size
  }

  isEmpty(): boolean {
    return this.#leaves.size === 0
  }

  /** `0` when empty, otherwise the key-space depth (256). */
  get height(): number {
    return this.isEmpty() ? 0 : SPARSE_TREE_DEPTH
  }

  /** The fixed key-space depth: 256. */
  get depth(): number {
    return SPARSE_TREE_DEPTH
  }

  /** Number of materialized node entries (leaves, internal, shortcut, and batch). */
  get storedNodeCount(): number {
    return this.#nodes.size
  }

  /** Number of node entries written by the last mutation. */
  get lastNodeAccessCount(): number {
    return this.#lastNodeAccesses
  }

  /** How many entries this tree would store with shortcuts but without batching. */
  unbatchedNodeCountEstimate(): number {
    const count = (depth: number, leaves: Leaf[]): number => {
      if (leaves.length <= 1) return leaves.length
      const [left, right] = splitByBit(leaves, depth)
      return 1 + count(depth + 1, left) + count(depth + 1, right)
    }
    return count(0, this.#allLeaves())
  }

  metadata(): TreeMetadata {
    return {
      leafCount: this.leafCount,
      height: this.height,
      nodeCount: this.#nodes.size,
      hashAlgorithm: this.hasher.algorithmName,
      variant: 'SparseMerkleTree',
    }
  }

  toJSON(): SparseMerkleTreeJSON {
    return {
      hashAlgorithm: this.hasher.algorithmName,
      leaves: this.#allLeaves().map((leaf) => [leaf.hex, toHex(leaf.hash)]),
    }
  }

  /**
   * An index-addressed `MerkleTree` view over this tree, sharing its state.
   * Leaf index `i` lives at the key whose last 8 bytes are `i` big-endian.
   * `insert` takes the first free index at or above the leaf count, so it
   * never overwrites a leaf, even after removals.
   */
  indexed(): MerkleTree {
    const tree = this
    const existingKey = (index: number): Bytes => {
      if (this.isEmpty()) throw new MerkleError({ code: 'EmptyTree' })
      const key = Number.isSafeInteger(index) && index >= 0 ? keyForLeafIndex(index) : undefined
      if (key === undefined || !this.#leaves.has(toHex(key))) {
        throw new MerkleError({ code: 'IndexOutOfBounds', index, len: this.leafCount })
      }
      return key
    }
    return {
      hasher: this.hasher,
      insert: (data) => {
        let index = Math.max(this.leafCount, this.#nextIndexHint)
        while (this.#leaves.has(toHex(keyForLeafIndex(index)))) index++
        this.insert(keyForLeafIndex(index), data)
        this.#nextIndexHint = index + 1
        return index
      },
      remove: (index) => this.remove(existingKey(index)),
      root: () => this.root(),
      get leafCount() {
        return tree.leafCount
      },
      isEmpty: () => this.isEmpty(),
      get height() {
        return tree.height
      },
      generateProof: (index): MerkleProof => {
        const key = existingKey(index)
        const proof = this.generateMembershipProof(key)
        const path: ProofNode[] = proof.siblings.map((sibling, level) => ({
          hash: sibling ?? this.emptyHashAt(level),
          side: bitAt(key, SPARSE_TREE_DEPTH - 1 - level) ? 'left' : 'right',
        }))
        return { leafIndex: index, leafCount: this.leafCount, path }
      },
      metadata: () => this.metadata(),
    }
  }

  #allLeaves(): Leaf[] {
    return this.#sorted.map((hex) => this.#leaves.get(hex) as Leaf)
  }

  /** Stores a leaf hash. Returns true when the key was new. */
  #setLeaf(key: Bytes, hash: Bytes, keepSorted: boolean): boolean {
    const hex = toHex(key)
    const added = !this.#leaves.has(hex)
    this.#leaves.set(hex, makeLeaf(key.slice(), hex, hash))
    if (added && keepSorted) this.#sorted.splice(lowerBound(this.#sorted, hex), 0, hex)
    return added
  }

  #deleteLeaf(hex: string): boolean {
    if (!this.#leaves.delete(hex)) return false
    this.#sorted.splice(lowerBound(this.#sorted, hex), 1)
    return true
  }

  /** Index range in `#sorted` of the leaves under `node`. */
  #range(node: NodeKey): [number, number] {
    return [
      lowerBound(this.#sorted, toHex(node.path)),
      upperBound(this.#sorted, toHex(node.lastKey())),
    ]
  }

  #leavesUnder(node: NodeKey): Leaf[] {
    const [lo, hi] = this.#range(node)
    return this.#sorted.slice(lo, hi).map((hex) => this.#leaves.get(hex) as Leaf)
  }

  #emptyAt(level: number): Bytes {
    return this.#emptyHashes[level] as Bytes
  }

  #rebuild(): void {
    this.#nodes.clear()
    this.#lastNodeAccesses = 0
    this.#root = this.isEmpty()
      ? this.#emptyAt(SPARSE_TREE_DEPTH)
      : this.#buildCompressedSubtree(0, this.#allLeaves())
  }

  /** `changed` must be sorted by key and free of duplicates. */
  #applyChanges(changed: Bytes[]): void {
    this.#lastNodeAccesses = 0
    const first = changed[0]
    if (first === undefined) return
    this.#root =
      this.#updateSubtree(NodeKey.of(first, 0), changed) ?? this.#emptyAt(SPARSE_TREE_DEPTH)
  }

  #updateSubtree(node: NodeKey, changed: Bytes[]): Bytes | undefined {
    const depth = node.depth

    if (SPARSE_TREE_DEPTH - depth <= BATCH_DEPTH) {
      const leaves = this.#leavesUnder(node)
      if (leaves.length === 0) {
        this.#nodes.delete(node.id)
        return undefined
      }
      const batch = this.#buildBatch(depth, leaves)
      this.#nodes.set(node.id, batch)
      this.#lastNodeAccesses++
      return batch.root
    }

    const [lo, hi] = this.#range(node)
    if (lo === hi) {
      this.#purgeSubtree(node)
      return undefined
    }
    if (hi - lo === 1) {
      const leaf = this.#leaves.get(this.#sorted[lo] as string) as Leaf
      this.#purgeChildren(node)
      const hash = this.#singleLeafSubtreeRoot(leaf, depth)
      this.#nodes.set(node.id, { kind: 'shortcut', prefix: depth, hash })
      this.#lastNodeAccesses++
      return hash
    }

    const wasInternal = this.#nodes.get(node.id)?.kind === 'internal'
    // Keys share this node's prefix and are sorted, so every key going left
    // precedes every key going right.
    let split = 0
    while (split < changed.length && !bitAt(changed[split] as Bytes, depth)) split++

    const left = this.#childCommitment(node.child(false), changed.slice(0, split), wasInternal)
    const right = this.#childCommitment(node.child(true), changed.slice(split), wasInternal)
    const empty = this.#emptyAt(SPARSE_TREE_DEPTH - depth - 1)
    const hash = this.hasher.hashNodes(left ?? empty, right ?? empty)
    this.#nodes.set(node.id, { kind: 'internal', hash })
    this.#lastNodeAccesses++
    return hash
  }

  #childCommitment(
    child: NodeKey,
    changed: Bytes[],
    parentWasInternal: boolean,
  ): Bytes | undefined {
    if (parentWasInternal && changed.length === 0) {
      // Every non-empty child of an internal node is stored, so an untouched
      // child's stored commitment is still current.
      const entry = this.#nodes.get(child.id)
      return entry && commitment(entry)
    }
    return this.#updateSubtree(child, changed)
  }

  #purgeSubtree(node: NodeKey): void {
    const entry = this.#nodes.get(node.id)
    this.#nodes.delete(node.id)
    if (entry?.kind === 'internal') {
      this.#purgeSubtree(node.child(false))
      this.#purgeSubtree(node.child(true))
    }
  }

  #purgeChildren(node: NodeKey): void {
    if (this.#nodes.get(node.id)?.kind === 'internal') {
      this.#purgeSubtree(node.child(false))
      this.#purgeSubtree(node.child(true))
    }
  }

  #buildCompressedSubtree(depth: number, leaves: Leaf[]): Bytes {
    const first = leaves[0] as Leaf
    if (SPARSE_TREE_DEPTH - depth <= BATCH_DEPTH) {
      const batch = this.#buildBatch(depth, leaves)
      this.#nodes.set(NodeKey.of(first.key, depth).id, batch)
      this.#lastNodeAccesses++
      return batch.root
    }

    if (leaves.length === 1) {
      const hash = this.#singleLeafSubtreeRoot(first, depth)
      this.#nodes.set(NodeKey.of(first.key, depth).id, { kind: 'shortcut', prefix: depth, hash })
      this.#lastNodeAccesses++
      return hash
    }

    const [left, right] = splitByBit(leaves, depth)
    const empty = this.#emptyAt(SPARSE_TREE_DEPTH - depth - 1)
    const leftHash = left.length ? this.#buildCompressedSubtree(depth + 1, left) : empty
    const rightHash = right.length ? this.#buildCompressedSubtree(depth + 1, right) : empty
    const hash = this.hasher.hashNodes(leftHash, rightHash)
    this.#nodes.set(NodeKey.of(first.key, depth).id, { kind: 'internal', hash })
    this.#lastNodeAccesses++
    return hash
  }

  #buildBatch(depth: number, leaves: Leaf[]): NodeEntry & { kind: 'batch' } {
    const root = this.#subtreeRootFromLeaves(depth, leaves) as Bytes
    const nodes = new Map<number, Bytes>()
    for (const leaf of leaves) {
      let position = 0
      for (let d = depth; d < SPARSE_TREE_DEPTH; d++)
        position = (position << 1) | (bitAt(leaf.key, d) ? 1 : 0)
      nodes.set(position, leaf.hash)
    }
    return { kind: 'batch', root, nodes }
  }

  /** Root of the subtree at `depth` that holds only `leaf`, every sibling empty. */
  #singleLeafSubtreeRoot(leaf: Leaf, depth: number): Bytes {
    const { chain, key } = leaf
    for (let level = chain.length; level <= SPARSE_TREE_DEPTH - depth; level++) {
      const current = chain[level - 1] as Bytes
      const sibling = this.#emptyAt(level - 1)
      chain.push(
        bitAt(key, SPARSE_TREE_DEPTH - level)
          ? this.hasher.hashNodes(sibling, current)
          : this.hasher.hashNodes(current, sibling),
      )
    }
    return chain[SPARSE_TREE_DEPTH - depth] as Bytes
  }

  #subtreeHashAt(node: NodeKey): Bytes | undefined {
    const entry = this.#nodes.get(node.id)
    if (entry) return commitment(entry)

    // Not stored: the subtree is empty, under a shortcut (one leaf), or
    // inside a batch (at most 2^BATCH_DEPTH leaves).
    const [lo, hi] = this.#range(node)
    if (lo === hi) return undefined
    if (hi - lo === 1) {
      const leaf = this.#leaves.get(this.#sorted[lo] as string) as Leaf
      return this.#singleLeafSubtreeRoot(leaf, node.depth)
    }
    return this.#subtreeRootFromLeaves(node.depth, this.#leavesUnder(node))
  }

  #subtreeRootFromLeaves(depth: number, leaves: Leaf[]): Bytes | undefined {
    const [only] = leaves
    if (only === undefined) return undefined
    if (leaves.length === 1) return this.#singleLeafSubtreeRoot(only, depth)

    const [left, right] = splitByBit(leaves, depth)
    const empty = this.#emptyAt(SPARSE_TREE_DEPTH - depth - 1)
    return this.hasher.hashNodes(
      this.#subtreeRootFromLeaves(depth + 1, left) ?? empty,
      this.#subtreeRootFromLeaves(depth + 1, right) ?? empty,
    )
  }
}

function reconstructRoot(
  hasher: HashFunction,
  key: Bytes,
  leafHash: Bytes,
  siblings: readonly (Bytes | null)[],
): Bytes {
  let current = leafHash
  let emptyHash = hasher.empty()
  let emptyLevel = 0

  siblings.forEach((sibling, level) => {
    let siblingHash = sibling
    if (siblingHash === null) {
      while (emptyLevel < level) {
        emptyHash = hasher.hashNodes(emptyHash, emptyHash)
        emptyLevel++
      }
      siblingHash = emptyHash
    }
    current = bitAt(key, SPARSE_TREE_DEPTH - 1 - level)
      ? hasher.hashNodes(siblingHash, current)
      : hasher.hashNodes(current, siblingHash)
  })
  return current
}
