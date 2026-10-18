import { type Bytes, fromHex, MerkleError, toHex } from '@merkleforge/core'
import { abiEncode } from './abi.js'
import {
  type BytesLike,
  type BytesNodeHash,
  bytesNodeHash,
  compareBytes,
  getMultiProof,
  getProof,
  type HexString,
  hex,
  isValidMerkleTree,
  type MultiProof,
  makeMerkleTree,
  type NodeHash,
  processMultiProof,
  processProof,
  renderMerkleTree,
  standardLeafBytes,
  toBytes,
} from './core.js'

/** The JSON shape of `tree.dump()`, identical to `@openzeppelin/merkle-tree`. */
export interface MerkleTreeData<T> {
  format: string
  tree: HexString[]
  values: { value: T; treeIndex: number }[]
}

export interface MerkleTreeOptions {
  /** Sort leaves by hash before building the tree (default `true`). Keep it on for multiproofs. */
  sortLeaves?: boolean
}

type IndexedValue<T> = { value: T; treeIndex: number }

/** Shared implementation of OpenZeppelin's `MerkleTreeImpl`, working on bytes internally. */
abstract class OpenZeppelinTree<T> {
  protected readonly nodes: readonly Bytes[]
  protected readonly values: readonly IndexedValue<T>[]
  protected readonly nodeHashBytes: BytesNodeHash
  readonly #leafBytes: (leaf: T) => Bytes
  readonly #lookup: Map<string, number>

  protected constructor(
    nodes: readonly Bytes[],
    values: readonly IndexedValue<T>[],
    leafBytes: (leaf: T) => Bytes,
    nodeHash: BytesNodeHash,
  ) {
    if (values.some(({ value }) => typeof value === 'number'))
      throw new TypeError('leaf values cannot be numbers')
    this.nodes = nodes
    this.values = values
    this.nodeHashBytes = nodeHash
    this.#leafBytes = leafBytes
    this.#lookup = new Map(
      values.map(({ treeIndex }, valueIndex) => [
        toHex(nodes[treeIndex] ?? new Uint8Array()),
        valueIndex,
      ]),
    )
  }

  protected static prepare<T>(
    values: readonly T[],
    options: MerkleTreeOptions,
    leafBytes: (leaf: T) => Bytes,
    nodeHash: BytesNodeHash,
  ): [Bytes[], IndexedValue<T>[]] {
    const hashed = values.map((value, valueIndex) => ({ valueIndex, hash: leafBytes(value) }))
    if (options.sortLeaves ?? true) hashed.sort((a, b) => compareBytes(a.hash, b.hash))
    const nodes = makeMerkleTree(
      hashed.map((h) => h.hash),
      nodeHash,
    )
    const indexed = values.map((value) => ({ value, treeIndex: 0 }))
    hashed.forEach(({ valueIndex }, leafIndex) => {
      ;(indexed[valueIndex] as IndexedValue<T>).treeIndex = nodes.length - 1 - leafIndex
    })
    return [nodes, indexed]
  }

  /** The root, as `0x` hex. */
  get root(): HexString {
    return toHex(this.nodes[0] as Bytes)
  }

  /** Number of leaves. */
  get length(): number {
    return this.values.length
  }

  /** The value at `index` in the original input order. */
  at(index: number): T | undefined {
    return this.values.at(index)?.value
  }

  /** ASCII drawing of the tree, the same as OpenZeppelin's `render()`. */
  render(): string {
    return renderMerkleTree(this.nodes)
  }

  /** `[index, value]` pairs in the original input order. */
  *entries(): IterableIterator<[number, T]> {
    for (const [i, { value }] of this.values.entries()) yield [i, value]
  }

  /** Checks every value against its leaf and every node against its children. Throws if the tree is inconsistent. */
  validate(): void {
    for (let i = 0; i < this.values.length; i++) this.#checkValueAt(i)
    if (!isValidMerkleTree(this.nodes, this.nodeHashBytes))
      throw new MerkleError({ code: 'DeserializationError', reason: 'Merkle tree is invalid' })
  }

  /** The leaf hash of `leaf`, as `0x` hex. */
  leafHash(leaf: T): HexString {
    return toHex(this.#leafBytes(leaf))
  }

  /** The input index of `leaf`. Throws if it is not in the tree. */
  leafLookup(leaf: T): number {
    const index = this.#lookup.get(this.leafHash(leaf))
    if (index === undefined) throw new RangeError('leaf is not in the tree')
    return index
  }

  /** Proof for one value, given by input index or by value. Pass it to `MerkleProof.verify` in Solidity. */
  getProof(leaf: number | T): HexString[] {
    const valueIndex = typeof leaf === 'number' ? leaf : this.leafLookup(leaf)
    const { treeIndex } = this.#checkValueAt(valueIndex)
    const proof = getProof(this.nodes, treeIndex)
    if (!this.#verify(this.nodes[treeIndex] as Bytes, proof))
      throw new MerkleError({ code: 'InvalidProof' })
    return proof.map(toHex)
  }

  /** One proof for several values. Pass it to `MerkleProof.multiProofVerify` in Solidity. */
  getMultiProof(leaves: (number | T)[]): MultiProof<HexString, T> {
    const valueIndices = leaves.map((leaf) =>
      typeof leaf === 'number' ? leaf : this.leafLookup(leaf),
    )
    const treeIndices = valueIndices.map((i) => this.#checkValueAt(i).treeIndex)
    const { indices, proof, proofFlags } = getMultiProof(this.nodes, treeIndices)
    const leafNodes = indices.map((i) => this.nodes[i] as Bytes)
    if (!this.#verifyMulti({ leaves: leafNodes, proof, proofFlags }))
      throw new MerkleError({ code: 'InvalidProof' })
    return {
      leaves: leafNodes.map((node) => {
        const valueIndex = this.#lookup.get(toHex(node)) as number
        return (this.values[valueIndex] as IndexedValue<T>).value
      }),
      proof: proof.map(toHex),
      proofFlags,
    }
  }

  /** Checks a proof for `leaf` (an input index or a value) against this tree's root. */
  verify(leaf: number | T, proof: BytesLike[]): boolean {
    return this.#verify(this.#leafOf(leaf), proof.map(toBytes))
  }

  /** Checks a multiproof against this tree's root. */
  verifyMultiProof(multiproof: MultiProof<BytesLike, number | T>): boolean {
    return this.#verifyMulti({
      leaves: multiproof.leaves.map((leaf) => this.#leafOf(leaf)),
      proof: multiproof.proof.map(toBytes),
      proofFlags: multiproof.proofFlags,
    })
  }

  protected dumpValues(): IndexedValue<T>[] {
    return this.values.map(({ value, treeIndex }) => ({ value, treeIndex }))
  }

  #leafOf(leaf: number | T): Bytes {
    if (typeof leaf !== 'number') return this.#leafBytes(leaf)
    const entry = this.values[leaf]
    if (entry === undefined)
      throw new MerkleError({ code: 'IndexOutOfBounds', index: leaf, len: this.values.length })
    return this.#leafBytes(entry.value)
  }

  #checkValueAt(index: number): IndexedValue<T> {
    const entry = this.values[index]
    if (entry === undefined)
      throw new MerkleError({ code: 'IndexOutOfBounds', index, len: this.values.length })
    const node = this.nodes[entry.treeIndex]
    if (node === undefined || compareBytes(node, this.#leafBytes(entry.value)) !== 0)
      throw new MerkleError({
        code: 'DeserializationError',
        reason: 'Merkle tree does not contain the expected value',
      })
    return entry
  }

  #verify(leaf: Bytes, proof: readonly Bytes[]): boolean {
    return compareBytes(processProof(leaf, proof, this.nodeHashBytes), this.nodes[0] as Bytes) === 0
  }

  #verifyMulti(multiproof: MultiProof<Bytes>): boolean {
    return (
      compareBytes(processMultiProof(multiproof, this.nodeHashBytes), this.nodes[0] as Bytes) === 0
    )
  }
}

const defaultNodeHash = bytesNodeHash(undefined)

/** The JSON shape of `StandardMerkleTree.dump()`. */
export interface StandardMerkleTreeData<T extends unknown[]> extends MerkleTreeData<T> {
  format: 'standard-v1'
  leafEncoding: string[]
}

/**
 * Drop-in replacement for `StandardMerkleTree` from `@openzeppelin/merkle-tree`.
 * Same roots, proofs, multiproofs, and `dump()` JSON, so proofs verify with
 * OpenZeppelin's `MerkleProof` library on-chain and existing dumps load as is.
 *
 * Leaves are `keccak256(keccak256(abi.encode(...value)))`, sorted by hash;
 * nodes are `keccak256` of the sorted pair.
 */
export class StandardMerkleTree<T extends unknown[]> extends OpenZeppelinTree<T> {
  protected readonly leafEncoding: string[]

  protected constructor(
    nodes: readonly Bytes[],
    values: readonly IndexedValue<T>[],
    leafEncoding: string[],
  ) {
    super(nodes, values, (leaf) => standardLeafBytes(leafEncoding, leaf), defaultNodeHash)
    this.leafEncoding = leafEncoding
  }

  /** Builds a tree. `leafEncoding` is the Solidity type of each field, e.g. `['address', 'uint256']`. */
  static of<T extends unknown[]>(
    values: T[],
    leafEncoding: string[],
    options: MerkleTreeOptions = {},
  ): StandardMerkleTree<T> {
    const [nodes, indexed] = OpenZeppelinTree.prepare(
      values,
      options,
      (leaf) => standardLeafBytes(leafEncoding, leaf),
      defaultNodeHash,
    )
    return new StandardMerkleTree(nodes, indexed, leafEncoding)
  }

  /** Loads the JSON from `dump()`, ours or OpenZeppelin's, and validates it. */
  static load<T extends unknown[]>(data: StandardMerkleTreeData<T>): StandardMerkleTree<T> {
    if (data.format !== 'standard-v1')
      throw new MerkleError({
        code: 'DeserializationError',
        reason: `unknown format '${data.format}'`,
      })
    if (data.leafEncoding === undefined)
      throw new MerkleError({ code: 'DeserializationError', reason: 'expected leaf encoding' })
    const tree = new StandardMerkleTree(data.tree.map(fromHex), data.values, data.leafEncoding)
    tree.validate()
    return tree
  }

  /** Checks a proof against a root without the tree. */
  static verify<T extends unknown[]>(
    root: BytesLike,
    leafEncoding: string[],
    leaf: T,
    proof: BytesLike[],
  ): boolean {
    const computed = processProof(
      standardLeafBytes(leafEncoding, leaf),
      proof.map(toBytes),
      defaultNodeHash,
    )
    return compareBytes(computed, toBytes(root)) === 0
  }

  /** Checks a multiproof against a root without the tree. */
  static verifyMultiProof<T extends unknown[]>(
    root: BytesLike,
    leafEncoding: string[],
    multiproof: MultiProof<BytesLike, T>,
  ): boolean {
    const computed = processMultiProof(
      {
        leaves: multiproof.leaves.map((leaf) => standardLeafBytes(leafEncoding, leaf)),
        proof: multiproof.proof.map(toBytes),
        proofFlags: multiproof.proofFlags,
      },
      defaultNodeHash,
    )
    return compareBytes(computed, toBytes(root)) === 0
  }

  /** JSON you can store and later pass to `load`, in OpenZeppelin's `standard-v1` format. */
  dump(): StandardMerkleTreeData<T> {
    return {
      format: 'standard-v1',
      leafEncoding: this.leafEncoding,
      tree: this.nodes.map(toHex),
      values: this.dumpValues(),
    }
  }
}

/** The JSON shape of `SimpleMerkleTree.dump()`. */
export interface SimpleMerkleTreeData extends MerkleTreeData<HexString> {
  format: 'simple-v1'
  hash?: 'custom'
}

export interface SimpleMerkleTreeOptions extends MerkleTreeOptions {
  /** Custom node hash. The default is OpenZeppelin's sorted-pair Keccak-256. */
  nodeHash?: NodeHash
}

/** A `bytes32` leaf, right-padded like `abi.encode(bytes32)`. */
export function formatLeaf(value: BytesLike): HexString {
  return toHex(simpleLeafBytes(value))
}

function simpleLeafBytes(value: BytesLike): Bytes {
  return abiEncode(['bytes32'], [value])
}

/**
 * Drop-in replacement for `SimpleMerkleTree` from `@openzeppelin/merkle-tree`:
 * leaves are `bytes32` values used as is (hash them yourself), with an
 * optional custom node hash.
 */
export class SimpleMerkleTree extends OpenZeppelinTree<BytesLike> {
  readonly #custom: boolean

  protected constructor(
    nodes: readonly Bytes[],
    values: readonly IndexedValue<BytesLike>[],
    nodeHash: NodeHash | undefined,
  ) {
    super(nodes, values, simpleLeafBytes, bytesNodeHash(nodeHash))
    this.#custom = nodeHash !== undefined
  }

  static of(values: BytesLike[], options: SimpleMerkleTreeOptions = {}): SimpleMerkleTree {
    const [nodes, indexed] = OpenZeppelinTree.prepare(
      values,
      options,
      simpleLeafBytes,
      bytesNodeHash(options.nodeHash),
    )
    return new SimpleMerkleTree(nodes, indexed, options.nodeHash)
  }

  /** Loads the JSON from `dump()`. Pass the same `nodeHash` the tree was built with, if any. */
  static load(data: SimpleMerkleTreeData, nodeHash?: NodeHash): SimpleMerkleTree {
    if (data.format !== 'simple-v1')
      throw new MerkleError({
        code: 'DeserializationError',
        reason: `unknown format '${data.format}'`,
      })
    if ((nodeHash === undefined) === (data.hash === 'custom'))
      throw new MerkleError({
        code: 'DeserializationError',
        reason: nodeHash
          ? 'data does not expect a custom node hashing function'
          : 'data expects a custom node hashing function',
      })
    const tree = new SimpleMerkleTree(data.tree.map(fromHex), data.values, nodeHash)
    tree.validate()
    return tree
  }

  static verify(
    root: BytesLike,
    leaf: BytesLike,
    proof: BytesLike[],
    nodeHash?: NodeHash,
  ): boolean {
    const computed = processProof(
      simpleLeafBytes(leaf),
      proof.map(toBytes),
      bytesNodeHash(nodeHash),
    )
    return compareBytes(computed, toBytes(root)) === 0
  }

  static verifyMultiProof(
    root: BytesLike,
    multiproof: MultiProof<BytesLike, BytesLike>,
    nodeHash?: NodeHash,
  ): boolean {
    const computed = processMultiProof(
      {
        leaves: multiproof.leaves.map(toBytes),
        proof: multiproof.proof.map(toBytes),
        proofFlags: multiproof.proofFlags,
      },
      bytesNodeHash(nodeHash),
    )
    return compareBytes(computed, toBytes(root)) === 0
  }

  /** JSON in OpenZeppelin's `simple-v1` format. */
  dump(): SimpleMerkleTreeData {
    return {
      format: 'simple-v1',
      tree: this.nodes.map(toHex),
      values: this.values.map(({ value, treeIndex }) => ({ value: hex(value), treeIndex })),
      ...(this.#custom ? { hash: 'custom' as const } : {}),
    }
  }
}
