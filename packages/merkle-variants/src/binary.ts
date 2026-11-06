import {
  type Bytes,
  bytesEqual,
  fromHex,
  type HashFunction,
  hashLeaves,
  hashNodePairs,
  MerkleError,
  type MerkleProof,
  type MerkleTree,
  type ProofNode,
  type ProofSide,
  type TreeMetadata,
  toHex,
} from '@merkleforge/core'
import {
  type BinaryMultiProof,
  multiProofSiblingPositions,
  normalizeMultiProofIndices,
  verifyBinaryMultiProof,
} from './multiproof.js'

/** JSON form of a `BinaryMerkleTree`: the hash name and the leaf digests in hex. */
export interface BinaryMerkleTreeJSON {
  hashAlgorithm: string
  leaves: string[]
}

/**
 * A balanced binary Merkle tree, padded to a power of two with empty leaves
 * and stored as one flat byte array (leaves first, root last). Best when the
 * full leaf set is known up front. Proofs are `O(log n)`.
 *
 * Builds hash a whole layer at a time through `hashNodePairs`, so hash
 * adapters with a batch path (such as `@merkleforge/hash-wasm`) pay one call
 * per layer instead of one per node. Padding subtrees are filled from
 * precomputed empty-subtree digests instead of being hashed.
 */
export class BinaryMerkleTree implements MerkleTree {
  readonly hasher: HashFunction
  /** Every node, `digestSize` bytes each: leaf layer, then each parent layer, root last. */
  #store: Uint8Array = new Uint8Array(0)
  /** Leaf layer width: a power of two, or 0 for a tree with no storage. */
  #capacity = 0
  #leafCount = 0
  #height = 0

  constructor(hasher: HashFunction) {
    this.hasher = hasher
  }

  /** Creates an empty tree with room for `capacity` leaves before it has to grow. */
  static withCapacity(hasher: HashFunction, capacity: number): BinaryMerkleTree {
    const tree = new BinaryMerkleTree(hasher)
    if (capacity <= 0) return tree
    tree.#allocate(nextPowerOfTwo(capacity))
    tree.#recomputeRoot()
    return tree
  }

  /** Builds a tree from raw leaf data in one pass. Throws `EmptyLeafData` for an empty leaf. */
  static fromLeaves(hasher: HashFunction, leaves: Iterable<Bytes>): BinaryMerkleTree {
    const list = Array.isArray(leaves) ? (leaves as readonly Bytes[]) : [...leaves]
    for (const leaf of list) {
      if (leaf.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
    }
    const digests = new Uint8Array(list.length * hasher.digestSize)
    hashLeaves(hasher, list, digests)
    return BinaryMerkleTree.#fromLeafHashes(hasher, digests, list.length)
  }

  /** Rebuilds a tree from `toJSON()` output. Throws if it was built with another hash. */
  static fromJSON(hasher: HashFunction, json: BinaryMerkleTreeJSON): BinaryMerkleTree {
    if (json.hashAlgorithm !== hasher.algorithmName) {
      throw new MerkleError({
        code: 'DeserializationError',
        reason: `tree was built with ${json.hashAlgorithm}, expected ${hasher.algorithmName}`,
      })
    }
    const size = hasher.digestSize
    const digests = new Uint8Array(json.leaves.length * size)
    json.leaves.forEach((hex, i) => {
      const digest = fromHex(hex)
      if (digest.length !== size) {
        throw new MerkleError({
          code: 'DeserializationError',
          reason: `leaf digest is ${digest.length} bytes, expected ${size}`,
        })
      }
      digests.set(digest, i * size)
    })
    return BinaryMerkleTree.#fromLeafHashes(hasher, digests, json.leaves.length)
  }

  /**
   * Checks that `leafData` is in a tree with root `expectedRoot`. Returns
   * `false` for any malformed proof instead of throwing.
   */
  static verify(
    hasher: HashFunction,
    expectedRoot: Bytes,
    leafData: Bytes,
    proof: MerkleProof,
  ): boolean {
    const { leafIndex, leafCount, path } = proof
    if (
      leafData.length === 0 ||
      !Number.isSafeInteger(leafIndex) ||
      !Number.isSafeInteger(leafCount) ||
      leafCount <= 0 ||
      leafIndex < 0 ||
      leafIndex >= leafCount
    ) {
      return false
    }
    if (path.length !== log2(nextPowerOfTwo(leafCount))) return false

    let current = hasher.hash(leafData)
    let offset = leafIndex
    for (const node of path) {
      const expectedSide: ProofSide = offset % 2 === 0 ? 'right' : 'left'
      if (node.side !== expectedSide) return false
      current =
        node.side === 'left'
          ? hasher.hashNodes(node.hash, current)
          : hasher.hashNodes(current, node.hash)
      offset = Math.floor(offset / 2)
    }
    return bytesEqual(current, expectedRoot)
  }

  get leafCount(): number {
    return this.#leafCount
  }

  get height(): number {
    return this.#height
  }

  isEmpty(): boolean {
    return this.#leafCount === 0
  }

  root(): Bytes | undefined {
    return this.isEmpty() ? undefined : this.#node(this.#nodeCount() - 1).slice()
  }

  insert(data: Bytes): number {
    if (data.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
    const index = this.#leafCount
    this.#ensureLeafCapacity(index + 1)
    this.#setNode(index, this.hasher.hash(data))
    this.#leafCount += 1
    this.#height = log2(this.#leafCapacity()) + 1
    this.#recomputePath(index)
    return index
  }

  remove(index: number): void {
    this.#checkIndex(index)
    this.#setNode(index, this.hasher.empty())
    this.#trimEmptyTrailingLeaves()

    if (this.#leafCount === 0) {
      this.#height = 0
      this.#recomputeRoot()
      return
    }

    const required = nextPowerOfTwo(this.#leafCount)
    if (required < this.#leafCapacity()) this.#resizeLeafLayer(required)
    else this.#recomputePath(index)
    this.#height = log2(required) + 1
  }

  generateProof(index: number): MerkleProof {
    this.#checkIndex(index)
    const path: ProofNode[] = []
    let layerStart = 0
    let layerWidth = this.#leafCapacity()
    let offset = index

    while (layerWidth > 1) {
      const isLeftChild = offset % 2 === 0
      const sibling = this.#node(layerStart + (isLeftChild ? offset + 1 : offset - 1))
      path.push({ hash: sibling.slice(), side: isLeftChild ? 'right' : 'left' })
      offset = Math.floor(offset / 2)
      layerStart += layerWidth
      layerWidth /= 2
    }

    return { leafIndex: index, leafCount: this.#leafCount, path }
  }

  /**
   * Builds one proof for several leaves. Indices may be in any order and may
   * repeat; the proof lists them sorted and de-duplicated in `leafIndices`.
   * Throws `EmptyTree`, `IndexOutOfBounds`, or `InvalidProofStructure` (no indices).
   */
  generateMultiProof(indices: Iterable<number>): BinaryMultiProof {
    const leafIndices = normalizeMultiProofIndices(indices, this.#leafCount)
    const layerStarts: number[] = []
    for (let start = 0, width = this.#leafCapacity(); width >= 1; width /= 2) {
      layerStarts.push(start)
      start += width
    }
    const hashes = multiProofSiblingPositions(leafIndices, this.#leafCount).map(([layer, offset]) =>
      this.#node((layerStarts[layer] as number) + offset).slice(),
    )
    return { leafIndices, leafCount: this.#leafCount, hashes }
  }

  /** Checks a multiproof. `leaves` are the raw leaf data in `proof.leafIndices` order. */
  static verifyMultiProof(
    hasher: HashFunction,
    expectedRoot: Bytes,
    leaves: readonly Bytes[],
    proof: BinaryMultiProof,
  ): boolean {
    return verifyBinaryMultiProof(hasher, expectedRoot, leaves, proof)
  }

  metadata(): TreeMetadata {
    return {
      leafCount: this.#leafCount,
      height: this.#height,
      nodeCount: this.#nodeCount(),
      hashAlgorithm: this.hasher.algorithmName,
      variant: 'BinaryMerkleTree',
    }
  }

  toJSON(): BinaryMerkleTreeJSON {
    return {
      hashAlgorithm: this.hasher.algorithmName,
      leaves: Array.from({ length: this.#leafCount }, (_, i) => toHex(this.#node(i))),
    }
  }

  /** Builds a tree from `count` leaf digests laid out back to back in `digests`. */
  static #fromLeafHashes(hasher: HashFunction, digests: Bytes, count: number): BinaryMerkleTree {
    const tree = new BinaryMerkleTree(hasher)
    if (count === 0) return tree

    const capacity = nextPowerOfTwo(count)
    tree.#allocate(capacity)
    tree.#store.set(digests)
    tree.#leafCount = count
    tree.#trimEmptyTrailingLeaves()
    if (tree.#leafCount === 0) return new BinaryMerkleTree(hasher)

    const required = nextPowerOfTwo(tree.#leafCount)
    if (required < capacity) tree.#resizeLeafLayer(required)
    else tree.#recomputeRoot()
    tree.#height = log2(required) + 1
    return tree
  }

  #checkIndex(index: number): void {
    if (this.isEmpty()) throw new MerkleError({ code: 'EmptyTree' })
    if (!Number.isInteger(index) || index < 0 || index >= this.#leafCount) {
      throw new MerkleError({ code: 'IndexOutOfBounds', index, len: this.#leafCount })
    }
  }

  /** A view (not a copy) of node `i`. Copy it before handing it out. */
  #node(i: number): Bytes {
    if (i < 0 || i >= this.#nodeCount()) throw new RangeError(`node ${i} is out of range`)
    const size = this.hasher.digestSize
    return this.#store.subarray(i * size, (i + 1) * size)
  }

  #setNode(i: number, digest: Bytes): void {
    this.#store.set(checkDigest(digest, this.hasher.digestSize), i * this.hasher.digestSize)
  }

  #nodeCount(): number {
    return this.#capacity === 0 ? 0 : nodeCount(this.#capacity)
  }

  #leafCapacity(): number {
    return this.#capacity
  }

  /** Replaces storage with `capacity` leaves' worth of zeroed nodes. */
  #allocate(capacity: number): void {
    this.#capacity = capacity
    this.#store = new Uint8Array(nodeCount(capacity) * this.hasher.digestSize)
  }

  #ensureLeafCapacity(required: number): void {
    if (required > this.#leafCapacity()) this.#resizeLeafLayer(nextPowerOfTwo(required))
  }

  #resizeLeafLayer(capacity: number): void {
    const size = this.hasher.digestSize
    const keep = Math.min(this.#leafCount, capacity)
    const leaves = this.#store.subarray(0, keep * size)
    this.#allocate(capacity)
    this.#store.set(leaves)
    this.#recomputeRoot()
  }

  #trimEmptyTrailingLeaves(): void {
    const empty = this.hasher.empty()
    while (this.#leafCount > 0 && bytesEqual(this.#node(this.#leafCount - 1), empty)) {
      this.#leafCount -= 1
    }
  }

  /**
   * Recomputes every internal node. Only the pairs above real leaves are
   * hashed; the rest of each layer is the digest of an all-empty subtree of
   * that height, which is the same value everywhere and is computed once.
   */
  #recomputeRoot(): void {
    if (this.#capacity === 0) return
    const size = this.hasher.digestSize
    const store = this.#store
    let zero = this.hasher.empty()
    let layerStart = 0
    let layerWidth = this.#capacity
    let populated = this.#leafCount
    fill(store, zero, layerStart + populated, layerStart + layerWidth, size)

    while (layerWidth > 1) {
      const parentStart = layerStart + layerWidth
      const pairs = Math.ceil(populated / 2)
      hashNodePairs(
        this.hasher,
        store.subarray(layerStart * size, (layerStart + 2 * pairs) * size),
        store.subarray(parentStart * size, (parentStart + pairs) * size),
      )
      zero = this.hasher.hashNodes(zero, zero)
      layerWidth /= 2
      fill(store, zero, parentStart + pairs, parentStart + layerWidth, size)
      layerStart = parentStart
      populated = pairs
    }
  }

  #recomputePath(leafIndex: number): void {
    let layerStart = 0
    let layerWidth = this.#leafCapacity()
    let parentStart = layerWidth
    let offset = leafIndex

    while (layerWidth > 1) {
      const pair = offset - (offset % 2)
      this.#setNode(
        parentStart + Math.floor(offset / 2),
        this.hasher.hashNodes(this.#node(layerStart + pair), this.#node(layerStart + pair + 1)),
      )
      offset = Math.floor(offset / 2)
      layerStart = parentStart
      layerWidth /= 2
      parentStart += layerWidth
    }
  }
}

/** Writes `digest` into nodes `from..to` of `store` (`size` bytes per node), by doubling copies. */
function fill(store: Uint8Array, digest: Bytes, from: number, to: number, size: number): void {
  if (from >= to) return
  store.set(checkDigest(digest, size), from * size)
  for (let done = 1; done < to - from; done *= 2) {
    const n = Math.min(done, to - from - done)
    store.copyWithin((from + done) * size, from * size, (from + n) * size)
  }
}

function checkDigest(digest: Bytes, size: number): Bytes {
  if (digest.length !== size) {
    throw new RangeError(`hash returned ${digest.length} bytes, expected digestSize ${size}`)
  }
  return digest
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function log2(powerOfTwo: number): number {
  let bits = 0
  for (let p = powerOfTwo; p > 1; p /= 2) bits++
  return bits
}

function nodeCount(leafCapacity: number): number {
  return leafCapacity * 2 - 1
}
