import {
  type Bytes,
  bytesEqual,
  fromHex,
  type HashFunction,
  MerkleError,
  type MerkleProof,
  type MerkleTree,
  type ProofNode,
  type ProofSide,
  type TreeMetadata,
  toHex,
} from '@1888-labs/merkle-core'
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
 * and stored as a flat array (leaves first, root last). Best when the full
 * leaf set is known up front. Proofs are `O(log n)`.
 */
export class BinaryMerkleTree implements MerkleTree {
  readonly hasher: HashFunction
  #nodes: Bytes[] = []
  #leafCount = 0
  #height = 0

  constructor(hasher: HashFunction) {
    this.hasher = hasher
  }

  /** Creates an empty tree with room for `capacity` leaves before it has to grow. */
  static withCapacity(hasher: HashFunction, capacity: number): BinaryMerkleTree {
    const tree = new BinaryMerkleTree(hasher)
    if (capacity <= 0) return tree
    const empty = hasher.empty()
    tree.#nodes = Array.from({ length: nodeCount(nextPowerOfTwo(capacity)) }, () => empty)
    tree.#recomputeRoot()
    return tree
  }

  /** Builds a tree from raw leaf data in one pass. Throws `EmptyLeafData` for an empty leaf. */
  static fromLeaves(hasher: HashFunction, leaves: Iterable<Bytes>): BinaryMerkleTree {
    const hashes: Bytes[] = []
    for (const leaf of leaves) {
      if (leaf.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
      hashes.push(hasher.hash(leaf))
    }
    return BinaryMerkleTree.#fromLeafHashes(hasher, hashes)
  }

  /** Rebuilds a tree from `toJSON()` output. Throws if it was built with another hash. */
  static fromJSON(hasher: HashFunction, json: BinaryMerkleTreeJSON): BinaryMerkleTree {
    if (json.hashAlgorithm !== hasher.algorithmName) {
      throw new MerkleError({
        code: 'DeserializationError',
        reason: `tree was built with ${json.hashAlgorithm}, expected ${hasher.algorithmName}`,
      })
    }
    const leaves = json.leaves.map((hex) => {
      const digest = fromHex(hex)
      if (digest.length !== hasher.digestSize) {
        throw new MerkleError({
          code: 'DeserializationError',
          reason: `leaf digest is ${digest.length} bytes, expected ${hasher.digestSize}`,
        })
      }
      return digest
    })
    return BinaryMerkleTree.#fromLeafHashes(hasher, leaves)
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
    return this.isEmpty() ? undefined : this.#nodes.at(-1)?.slice()
  }

  insert(data: Bytes): number {
    if (data.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
    const index = this.#leafCount
    this.#ensureLeafCapacity(index + 1)
    this.#nodes[index] = this.hasher.hash(data)
    this.#leafCount += 1
    this.#height = log2(this.#leafCapacity()) + 1
    this.#recomputePath(index)
    return index
  }

  remove(index: number): void {
    this.#checkIndex(index)
    this.#nodes[index] = this.hasher.empty()
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
      nodeCount: this.#nodes.length,
      hashAlgorithm: this.hasher.algorithmName,
      variant: 'BinaryMerkleTree',
    }
  }

  toJSON(): BinaryMerkleTreeJSON {
    return {
      hashAlgorithm: this.hasher.algorithmName,
      leaves: this.#nodes.slice(0, this.#leafCount).map(toHex),
    }
  }

  static #fromLeafHashes(hasher: HashFunction, hashes: Bytes[]): BinaryMerkleTree {
    const tree = new BinaryMerkleTree(hasher)
    if (hashes.length === 0) return tree

    const capacity = nextPowerOfTwo(hashes.length)
    const empty = hasher.empty()
    tree.#leafCount = hashes.length
    tree.#nodes = hashes.concat(
      Array.from({ length: nodeCount(capacity) - hashes.length }, () => empty),
    )
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

  #node(i: number): Bytes {
    const node = this.#nodes[i]
    if (node === undefined) throw new RangeError(`node ${i} is out of range`)
    return node
  }

  #leafCapacity(): number {
    return Math.ceil(this.#nodes.length / 2)
  }

  #ensureLeafCapacity(required: number): void {
    if (required > this.#leafCapacity()) this.#resizeLeafLayer(nextPowerOfTwo(required))
  }

  #resizeLeafLayer(capacity: number): void {
    const empty = this.hasher.empty()
    const keep = Math.min(this.#leafCount, capacity)
    const nodes = Array.from({ length: nodeCount(capacity) }, () => empty)
    for (let i = 0; i < keep; i++) nodes[i] = this.#node(i)
    this.#nodes = nodes
    this.#recomputeRoot()
  }

  #trimEmptyTrailingLeaves(): void {
    const empty = this.hasher.empty()
    while (this.#leafCount > 0 && bytesEqual(this.#node(this.#leafCount - 1), empty)) {
      this.#leafCount -= 1
    }
  }

  #recomputeRoot(): void {
    let layerStart = 0
    let layerWidth = this.#leafCapacity()
    let parentStart = layerWidth

    while (layerWidth > 1) {
      for (let offset = 0; offset < layerWidth / 2; offset++) {
        this.#nodes[parentStart + offset] = this.hasher.hashNodes(
          this.#node(layerStart + offset * 2),
          this.#node(layerStart + offset * 2 + 1),
        )
      }
      layerStart = parentStart
      layerWidth /= 2
      parentStart += layerWidth
    }
  }

  #recomputePath(leafIndex: number): void {
    let layerStart = 0
    let layerWidth = this.#leafCapacity()
    let parentStart = layerWidth
    let offset = leafIndex

    while (layerWidth > 1) {
      const pair = offset - (offset % 2)
      this.#nodes[parentStart + Math.floor(offset / 2)] = this.hasher.hashNodes(
        this.#node(layerStart + pair),
        this.#node(layerStart + pair + 1),
      )
      offset = Math.floor(offset / 2)
      layerStart = parentStart
      layerWidth /= 2
      parentStart += layerWidth
    }
  }
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
