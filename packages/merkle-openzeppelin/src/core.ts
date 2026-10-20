import { type Bytes, concatBytes, fromHex, MerkleError, toHex } from '@merkleforge/core'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { abiEncode } from './abi.js'

/** A `0x`-prefixed, lowercase hex string, as `@openzeppelin/merkle-tree` returns. */
export type HexString = string

/** Bytes, a `0x` hex string, or an array of byte values, as `@openzeppelin/merkle-tree` accepts. */
export type BytesLike = Bytes | string | readonly number[]

/** Hashes two child nodes into their parent. Receives and returns 32-byte values. */
export type NodeHash = (left: BytesLike, right: BytesLike) => BytesLike

/** A proof for several leaves at once, in the format of OpenZeppelin's `MerkleProof.multiProofVerify`. */
export interface MultiProof<T, L = T> {
  leaves: L[]
  proof: T[]
  proofFlags: boolean[]
}

export function toBytes(value: BytesLike): Bytes {
  if (typeof value === 'string') return fromHex(value)
  return value instanceof Uint8Array ? value : Uint8Array.from(value)
}

export function hex(value: BytesLike): HexString {
  return toHex(toBytes(value))
}

/** Unsigned big-endian comparison, which is how OpenZeppelin orders 32-byte hashes. */
export function compareBytes(a: Bytes, b: Bytes): number {
  if (a.length !== b.length) return a.length - b.length
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] as number) - (b[i] as number)
    if (diff !== 0) return diff
  }
  return 0
}

/** `keccak256(keccak256(abi.encode(values)))`: the leaf hash of a `StandardMerkleTree`. */
export function standardLeafHash(types: readonly string[], value: readonly unknown[]): HexString {
  return toHex(standardLeafBytes(types, value))
}

export function standardLeafBytes(types: readonly string[], value: readonly unknown[]): Bytes {
  return keccak_256(keccak_256(abiEncode(types, value)))
}

/** `keccak256(min(a, b) || max(a, b))`: OpenZeppelin's commutative node hash. */
export function standardNodeHash(a: BytesLike, b: BytesLike): HexString {
  return toHex(sortedPairHash(toBytes(a), toBytes(b)))
}

function sortedPairHash(a: Bytes, b: Bytes): Bytes {
  return keccak_256(compareBytes(a, b) <= 0 ? concatBytes(a, b) : concatBytes(b, a))
}

/** Node hashing on bytes, with the custom `NodeHash` adapted when one is given. */
export type BytesNodeHash = (left: Bytes, right: Bytes) => Bytes

export function bytesNodeHash(nodeHash: NodeHash | undefined): BytesNodeHash {
  if (nodeHash === undefined) return sortedPairHash
  return (left, right) => checkNode(toBytes(nodeHash(toHex(left), toHex(right))))
}

export function checkNode(node: Bytes): Bytes {
  if (node.length !== 32)
    throw new MerkleError({
      code: 'InvalidProofStructure',
      reason: `Merkle tree nodes must be 32 bytes, got ${node.length}`,
    })
  return node
}

const left = (i: number) => 2 * i + 1
const right = (i: number) => 2 * i + 2
const parent = (i: number) => (i - 1) >> 1
const sibling = (i: number) => (i % 2 === 1 ? i + 1 : i - 1)

/**
 * Builds the flat tree OpenZeppelin uses: `2n - 1` nodes, root at index 0,
 * children of `i` at `2i + 1` and `2i + 2`, and leaf `i` at `length - 1 - i`.
 */
export function makeMerkleTree(leaves: readonly Bytes[], nodeHash: BytesNodeHash): Bytes[] {
  if (leaves.length === 0) throw new MerkleError({ code: 'EmptyTree' })
  const tree = new Array<Bytes>(2 * leaves.length - 1)
  leaves.forEach((leaf, i) => {
    tree[tree.length - 1 - i] = checkNode(leaf)
  })
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) {
    tree[i] = nodeHash(tree[left(i)] as Bytes, tree[right(i)] as Bytes)
  }
  return tree
}

function isLeafNode(tree: readonly Bytes[], i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < tree.length && left(i) >= tree.length
}

function checkLeafNode(tree: readonly Bytes[], i: number): void {
  if (!isLeafNode(tree, i))
    throw new MerkleError({ code: 'IndexOutOfBounds', index: i, len: tree.length })
}

export function getProof(tree: readonly Bytes[], index: number): Bytes[] {
  checkLeafNode(tree, index)
  const proof: Bytes[] = []
  for (let i = index; i > 0; i = parent(i)) proof.push(tree[sibling(i)] as Bytes)
  return proof
}

export function processProof(leaf: Bytes, proof: readonly Bytes[], nodeHash: BytesNodeHash): Bytes {
  checkNode(leaf)
  return proof.reduce((node, sib) => nodeHash(node, checkNode(sib)), leaf)
}

/** Tree indices are returned in the order OpenZeppelin uses: descending. */
export function getMultiProof(tree: readonly Bytes[], treeIndices: readonly number[]) {
  for (const i of treeIndices) checkLeafNode(tree, i)
  const indices = [...treeIndices].sort((a, b) => b - a)
  if (indices.some((v, i) => i > 0 && v === indices[i - 1]))
    throw new MerkleError({
      code: 'InvalidProofStructure',
      reason: 'cannot prove a duplicated index',
    })
  const stack = [...indices]
  const proof: Bytes[] = []
  const proofFlags: boolean[] = []
  while (stack.length > 0 && (stack[0] as number) > 0) {
    const j = stack.shift() as number
    const s = sibling(j)
    if (s === stack[0]) {
      proofFlags.push(true)
      stack.shift()
    } else {
      proofFlags.push(false)
      proof.push(tree[s] as Bytes)
    }
    stack.push(parent(j))
  }
  if (indices.length === 0) proof.push(tree[0] as Bytes)
  return { indices, proof, proofFlags }
}

export function processMultiProof(multiproof: MultiProof<Bytes>, nodeHash: BytesNodeHash): Bytes {
  multiproof.leaves.forEach(checkNode)
  multiproof.proof.forEach(checkNode)
  const flags = multiproof.proofFlags
  if (
    multiproof.proof.length < flags.filter((f) => !f).length ||
    multiproof.leaves.length + multiproof.proof.length !== flags.length + 1
  )
    throw new MerkleError({
      code: 'InvalidProofStructure',
      reason: 'leaves, proof, and proofFlags lengths do not match',
    })
  const stack = [...multiproof.leaves]
  const proof = [...multiproof.proof]
  for (const flag of flags) {
    const a = stack.shift()
    const b = flag ? stack.shift() : proof.shift()
    if (a === undefined || b === undefined)
      throw new MerkleError({ code: 'InvalidProofStructure', reason: 'multiproof is malformed' })
    stack.push(nodeHash(a, b))
  }
  return (stack.pop() ?? proof.shift()) as Bytes
}

export function isValidMerkleTree(tree: readonly Bytes[], nodeHash: BytesNodeHash): boolean {
  if (tree.length === 0) return false
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i] as Bytes
    if (node.length !== 32) return false
    const l = left(i)
    const r = right(i)
    if (r >= tree.length) {
      if (l < tree.length) return false
    } else if (compareBytes(node, nodeHash(tree[l] as Bytes, tree[r] as Bytes)) !== 0) {
      return false
    }
  }
  return true
}

export function renderMerkleTree(tree: readonly Bytes[]): string {
  if (tree.length === 0) throw new MerkleError({ code: 'EmptyTree' })
  const stack: [number, number[]][] = [[0, []]]
  const lines: string[] = []
  while (stack.length > 0) {
    const [i, path] = stack.pop() as [number, number[]]
    const indent = path
      .slice(0, -1)
      .map((p) => (p ? '│  ' : '   '))
      .join('')
    const branch = path
      .slice(-1)
      .map((p) => (p ? '├─ ' : '└─ '))
      .join('')
    lines.push(`${indent}${branch}${i}) ${toHex(tree[i] as Bytes)}`)
    if (right(i) < tree.length) {
      stack.push([right(i), [...path, 0]])
      stack.push([left(i), [...path, 1]])
    }
  }
  return lines.join('\n')
}
