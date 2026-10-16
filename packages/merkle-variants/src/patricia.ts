import {
  type Bytes,
  bytesEqual,
  concatBytes,
  fromHex,
  type HashFunction,
  MerkleError,
  type MerkleTree,
  type TreeMetadata,
  toHex,
  utf8,
} from '@1888-labs/merkle-core'

const EMPTY_RLP = 0x80
const SHORT_STRING_OFFSET = 0x80
const LONG_STRING_OFFSET = 0xb7
const SHORT_LIST_OFFSET = 0xc0
const LONG_LIST_OFFSET = 0xf7

/** A nibble path: each entry is `0x0..=0xF`, high nibble of each key byte first. */
export type Nibbles = readonly number[]

/**
 * How a parent embeds a child node. Ethereum inlines nodes whose RLP is under
 * 32 bytes and stores the hash of anything larger.
 */
export type NodeRef = { kind: 'hash'; hash: Bytes } | { kind: 'inline'; rlp: Bytes }

/** The four Ethereum MPT node types. */
export type MptNode =
  | { kind: 'empty' }
  | { kind: 'leaf'; keySuffix: Nibbles; value: Bytes }
  | { kind: 'extension'; sharedPrefix: Nibbles; child: NodeRef }
  | { kind: 'branch'; children: readonly NodeRef[]; value: Bytes | null }

/**
 * A Patricia trie witness for one key: RLP-encoded nodes from the root to the
 * node where the key path ends. `value: null` makes it a non-membership proof.
 */
export interface MptProof {
  readonly key: Bytes
  readonly value: Bytes | null
  readonly proofNodes: readonly Bytes[]
}

/** JSON form of a `MerklePatriciaTrie`: the hash name and `[key, value]` entries in key order. */
export interface MerklePatriciaTrieJSON {
  hashAlgorithm: string
  entries: [key: string, value: string][]
}

const EMPTY_REF: NodeRef = { kind: 'inline', rlp: Uint8Array.of(EMPTY_RLP) }

function rlpError(reason: string): MerkleError {
  return new MerkleError({ code: 'RlpError', reason })
}

/** Splits bytes into nibbles, high nibble first. */
export function bytesToNibbles(bytes: Bytes): number[] {
  const out: number[] = []
  for (const byte of bytes) out.push(byte >> 4, byte & 0x0f)
  return out
}

function nibblesToBytes(nibbles: Nibbles): Bytes {
  const out = new Uint8Array(Math.ceil(nibbles.length / 2))
  for (let i = 0; i < nibbles.length; i += 2) {
    out[i / 2] = ((nibbles[i] ?? 0) << 4) | (nibbles[i + 1] ?? 0)
  }
  return out
}

function commonPrefixLen(a: Nibbles, b: Nibbles): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function nibblesEqual(a: Nibbles, b: Nibbles): boolean {
  return a.length === b.length && commonPrefixLen(a, b) === a.length
}

/**
 * Hex-prefix encodes a nibble path. Leaves use prefix nibble `0x2` (even
 * length) or `0x3` (odd); extensions use `0x0` or `0x1`.
 */
export function hpEncode(path: Nibbles, isLeaf: boolean): Bytes {
  const odd = path.length % 2 === 1
  const prefix = (isLeaf ? 0x2 : 0x0) | (odd ? 0x1 : 0x0)
  return nibblesToBytes(odd ? [prefix, ...path] : [prefix, 0, ...path])
}

function hpDecodeChecked(bytes: Bytes): { path: number[]; isLeaf: boolean } {
  const nibbles = bytesToNibbles(bytes)
  const prefix = nibbles[0]
  if (prefix === undefined) throw rlpError('empty hex-prefix path')
  if (prefix > 0x3) throw rlpError(`invalid hex-prefix nibble 0x${prefix.toString(16)}`)
  const isLeaf = prefix >= 0x2
  if (prefix % 2 === 1) return { path: nibbles.slice(1), isLeaf }
  if (nibbles[1] !== 0) throw rlpError('even hex-prefix path must include zero padding nibble')
  return { path: nibbles.slice(2), isLeaf }
}

/**
 * Decodes a hex-prefix path. Malformed input returns an empty extension path
 * instead of throwing; `rlpDecode` validates strictly.
 */
export function hpDecode(bytes: Bytes): { path: number[]; isLeaf: boolean } {
  try {
    return hpDecodeChecked(bytes)
  } catch {
    return { path: [], isLeaf: false }
  }
}

function lengthBytes(length: number): Bytes {
  const out: number[] = []
  for (let n = length; n > 0; n = Math.floor(n / 256)) out.unshift(n % 256)
  return Uint8Array.from(out)
}

function rlpEncodeBytes(bytes: Bytes): Bytes {
  if (bytes.length === 1 && (bytes[0] as number) < 0x80) return bytes.slice()
  if (bytes.length <= 55)
    return concatBytes(Uint8Array.of(SHORT_STRING_OFFSET + bytes.length), bytes)
  const len = lengthBytes(bytes.length)
  return concatBytes(Uint8Array.of(LONG_STRING_OFFSET + len.length), len, bytes)
}

function rlpEncodeList(items: readonly Bytes[]): Bytes {
  const payload = concatBytes(...items)
  if (payload.length <= 55)
    return concatBytes(Uint8Array.of(SHORT_LIST_OFFSET + payload.length), payload)
  const len = lengthBytes(payload.length)
  return concatBytes(Uint8Array.of(LONG_LIST_OFFSET + len.length), len, payload)
}

function rlpEncodeNodeRef(ref: NodeRef): Bytes {
  return ref.kind === 'hash' ? rlpEncodeBytes(ref.hash) : ref.rlp
}

/** RLP-encodes an MPT node. */
export function rlpEncode(node: MptNode): Bytes {
  switch (node.kind) {
    case 'empty':
      return Uint8Array.of(EMPTY_RLP)
    case 'leaf':
      return rlpEncodeList([
        rlpEncodeBytes(hpEncode(node.keySuffix, true)),
        rlpEncodeBytes(node.value),
      ])
    case 'extension':
      return rlpEncodeList([
        rlpEncodeBytes(hpEncode(node.sharedPrefix, false)),
        rlpEncodeNodeRef(node.child),
      ])
    case 'branch':
      return rlpEncodeList([
        ...node.children.map(rlpEncodeNodeRef),
        node.value === null ? Uint8Array.of(EMPTY_RLP) : rlpEncodeBytes(node.value),
      ])
  }
}

type RlpItem = { kind: 'bytes'; bytes: Bytes } | { kind: 'list'; items: Bytes[] }

function readPayload(bytes: Bytes, offset: number, len: number): Bytes {
  if (offset + len > bytes.length) throw rlpError('RLP payload length exceeds input')
  return bytes.subarray(offset, offset + len)
}

function readLongLength(bytes: Bytes, lenOfLen: number): [len: number, offset: number] {
  const raw = readPayload(bytes, 1, lenOfLen)
  if (raw[0] === 0) throw rlpError('RLP length has leading zero')
  let len = 0
  for (const byte of raw) {
    len = len * 256 + byte
    if (!Number.isSafeInteger(len)) throw rlpError('RLP length overflows')
  }
  return [len, 1 + lenOfLen]
}

function parseListPayload(payload: Bytes): Bytes[] {
  const items: Bytes[] = []
  let cursor = 0
  while (cursor < payload.length) {
    const [, consumed] = parseRlpItem(payload.subarray(cursor))
    items.push(payload.slice(cursor, cursor + consumed))
    cursor += consumed
  }
  return items
}

function parseRlpItem(bytes: Bytes): [RlpItem, number] {
  const prefix = bytes[0]
  if (prefix === undefined) throw rlpError('empty RLP input')
  if (prefix <= 0x7f) return [{ kind: 'bytes', bytes: Uint8Array.of(prefix) }, 1]
  if (prefix <= 0xb7) {
    const len = prefix - SHORT_STRING_OFFSET
    return [{ kind: 'bytes', bytes: readPayload(bytes, 1, len).slice() }, 1 + len]
  }
  if (prefix <= 0xbf) {
    const [len, offset] = readLongLength(bytes, prefix - LONG_STRING_OFFSET)
    return [{ kind: 'bytes', bytes: readPayload(bytes, offset, len).slice() }, offset + len]
  }
  if (prefix <= 0xf7) {
    const len = prefix - SHORT_LIST_OFFSET
    return [{ kind: 'list', items: parseListPayload(readPayload(bytes, 1, len)) }, 1 + len]
  }
  const [len, offset] = readLongLength(bytes, prefix - LONG_LIST_OFFSET)
  return [{ kind: 'list', items: parseListPayload(readPayload(bytes, offset, len)) }, offset + len]
}

function decodeRlpBytes(bytes: Bytes): Bytes {
  const [item, consumed] = parseRlpItem(bytes)
  if (consumed !== bytes.length) throw rlpError('trailing bytes after RLP byte string')
  if (item.kind === 'list') throw rlpError('expected RLP byte string, found list')
  return item.bytes
}

function isRlpEmpty(bytes: Bytes): boolean {
  return bytes.length === 1 && bytes[0] === EMPTY_RLP
}

function decodeNodeRef(item: Bytes): NodeRef {
  if (isRlpEmpty(item)) return EMPTY_REF
  try {
    const hash = decodeRlpBytes(item)
    if (hash.length === 32) return { kind: 'hash', hash }
  } catch {
    // Not a byte string, so it is an inline node.
  }
  return { kind: 'inline', rlp: item.slice() }
}

/** Decodes an RLP-encoded MPT node. Throws `RlpError` for malformed input. */
export function rlpDecode(bytes: Bytes): MptNode {
  const [item, consumed] = parseRlpItem(bytes)
  if (consumed !== bytes.length) throw rlpError('trailing bytes after RLP item')

  if (item.kind === 'bytes') {
    if (item.bytes.length === 0) return { kind: 'empty' }
    throw rlpError('top-level MPT node cannot be a non-empty byte string')
  }
  const { items } = item
  if (items.length === 2) {
    const { path, isLeaf } = hpDecodeChecked(decodeRlpBytes(items[0] as Bytes))
    return isLeaf
      ? { kind: 'leaf', keySuffix: path, value: decodeRlpBytes(items[1] as Bytes) }
      : { kind: 'extension', sharedPrefix: path, child: decodeNodeRef(items[1] as Bytes) }
  }
  if (items.length === 17) {
    const value = decodeRlpBytes(items[16] as Bytes)
    return {
      kind: 'branch',
      children: items.slice(0, 16).map(decodeNodeRef),
      value: value.length === 0 ? null : value,
    }
  }
  throw rlpError(`invalid MPT list length ${items.length}; expected 2 or 17`)
}

/** The Ethereum node reference for `node`: its RLP when shorter than 32 bytes, otherwise its hash. */
export function hashNode(hasher: HashFunction, node: MptNode): NodeRef {
  const rlp = rlpEncode(node)
  return rlp.length >= 32
    ? { kind: 'hash', hash: hasher.hashEncodedNode(rlp) }
    : { kind: 'inline', rlp }
}

/** The root hash of `root`. Unlike child references, a root is always hashed. */
export function computeRootHash(hasher: HashFunction, root: MptNode): Bytes {
  return hasher.hashEncodedNode(rlpEncode(root))
}

type TrieKind =
  | { kind: 'leaf'; path: number[]; value: Bytes }
  | { kind: 'extension'; path: number[]; child: TrieNode }
  | { kind: 'branch'; children: (TrieNode | undefined)[]; value: Bytes | null }

interface TrieNode {
  readonly node: TrieKind
  /** How a parent embeds this node. */
  readonly ref: NodeRef
  /** Nodes in this subtree, including this one. */
  readonly nodeCount: number
  /** Longest node path from here to a leaf, including this node. */
  readonly height: number
}

function toMpt(node: TrieKind): MptNode {
  switch (node.kind) {
    case 'leaf':
      return { kind: 'leaf', keySuffix: node.path, value: node.value }
    case 'extension':
      return { kind: 'extension', sharedPrefix: node.path, child: node.child.ref }
    case 'branch':
      return {
        kind: 'branch',
        children: node.children.map((child) => child?.ref ?? EMPTY_REF),
        value: node.value,
      }
  }
}

const TRAIT_KEY_PREFIX = utf8('merkleforge:mpt:trait-leaf:')

function keyForLeafIndex(index: number): Bytes {
  const suffix = new Uint8Array(8)
  new DataView(suffix.buffer).setBigUint64(0, BigInt(index))
  return concatBytes(TRAIT_KEY_PREFIX, suffix)
}

/**
 * An Ethereum-style Merkle Patricia trie over byte keys. With `Keccak256` its
 * roots match Ethereum's state and transaction tries.
 *
 * Every node caches its reference (inline RLP or hash), so a mutation only
 * re-encodes and re-hashes the nodes on the changed key path. Removals
 * collapse branches and extensions, so the trie always has the canonical
 * shape for its entries.
 */
export class MerklePatriciaTrie {
  readonly hasher: HashFunction
  #root: TrieNode | undefined
  #rootHash: Bytes | undefined
  #len = 0
  #nextIndexHint = 0

  constructor(hasher: HashFunction) {
    this.hasher = hasher
  }

  /** Rebuilds a trie from `toJSON()` output. */
  static fromJSON(hasher: HashFunction, json: MerklePatriciaTrieJSON): MerklePatriciaTrie {
    if (json.hashAlgorithm !== hasher.algorithmName) {
      throw new MerkleError({
        code: 'DeserializationError',
        reason: `trie was built with ${json.hashAlgorithm}, expected ${hasher.algorithmName}`,
      })
    }
    const trie = new MerklePatriciaTrie(hasher)
    for (const [keyHex, valueHex] of json.entries) {
      const key = fromHex(keyHex)
      if (trie.get(key) !== undefined) {
        throw new MerkleError({ code: 'DeserializationError', reason: 'duplicate Patricia key' })
      }
      trie.insert(key, fromHex(valueHex))
    }
    return trie
  }

  /** Inserts or updates `value` at `key`. Throws `EmptyLeafData` for an empty value. */
  insert(key: Bytes, value: Bytes): void {
    if (value.length === 0) throw new MerkleError({ code: 'EmptyLeafData' })
    if (this.get(key) === undefined) this.#len++
    this.#root = this.#insertAt(this.#root, bytesToNibbles(key), value.slice())
    this.#refreshRootHash()
  }

  /** Removes the value at `key`. Throws `UnsupportedOperation` when the key is absent. */
  remove(key: Bytes): void {
    if (this.get(key) === undefined) {
      throw new MerkleError({
        code: 'UnsupportedOperation',
        operation: 'remove missing Patricia key',
      })
    }
    if (this.#root === undefined) throw new MerkleError({ code: 'EmptyTree' })
    this.#root = this.#removeAt(this.#root, bytesToNibbles(key))
    this.#len--
    this.#refreshRootHash()
  }

  /** The value stored at `key`, if any. */
  get(key: Bytes): Bytes | undefined {
    let remaining: number[] = bytesToNibbles(key)
    let node = this.#root
    while (node) {
      const n = node.node
      if (n.kind === 'leaf') return nibblesEqual(n.path, remaining) ? n.value.slice() : undefined
      if (n.kind === 'extension') {
        if (commonPrefixLen(n.path, remaining) !== n.path.length) return undefined
        remaining = remaining.slice(n.path.length)
        node = n.child
      } else {
        const [nibble, ...rest] = remaining
        if (nibble === undefined) return n.value?.slice()
        node = n.children[nibble]
        remaining = rest
      }
    }
    return undefined
  }

  /**
   * Builds a witness for `key` from the root to where the key path ends.
   * Missing keys produce a non-membership proof. Throws `EmptyTree`.
   */
  generateProof(key: Bytes): MptProof {
    if (this.#root === undefined) throw new MerkleError({ code: 'EmptyTree' })
    let remaining: number[] = bytesToNibbles(key)
    let node: TrieNode = this.#root
    const proofNodes: Bytes[] = []

    for (;;) {
      proofNodes.push(rlpEncode(toMpt(node.node)))
      const n = node.node
      if (n.kind === 'leaf') {
        const value = nibblesEqual(n.path, remaining) ? n.value.slice() : null
        return { key: key.slice(), value, proofNodes }
      }
      if (n.kind === 'extension') {
        if (commonPrefixLen(n.path, remaining) !== n.path.length) {
          return { key: key.slice(), value: null, proofNodes }
        }
        remaining = remaining.slice(n.path.length)
        node = n.child
        continue
      }
      const [nibble, ...rest] = remaining
      if (nibble === undefined)
        return { key: key.slice(), value: n.value?.slice() ?? null, proofNodes }
      const child = n.children[nibble]
      if (child === undefined) return { key: key.slice(), value: null, proofNodes }
      remaining = rest
      node = child
    }
  }

  /**
   * Checks a witness against a trusted root. Membership proofs need the last
   * node to hold `proof.value`; non-membership proofs need the path to end at
   * an empty child, a missing branch value, or a diverging leaf/extension.
   */
  static verifyProof(hasher: HashFunction, expectedRoot: Bytes, proof: MptProof): boolean {
    const [rootNode] = proof.proofNodes
    if (rootNode === undefined || !bytesEqual(hasher.hashEncodedNode(rootNode), expectedRoot))
      return false
    try {
      return verifyProofAt(hasher, bytesToNibbles(proof.key), proof.value, proof.proofNodes, 0)
    } catch {
      return false
    }
  }

  /** The root hash, or `undefined` for an empty trie. */
  root(): Bytes | undefined {
    return this.#rootHash?.slice()
  }

  isEmpty(): boolean {
    return this.#len === 0
  }

  /** Number of stored entries. */
  get leafCount(): number {
    return this.#len
  }

  /** Number of materialized trie nodes. */
  get nodeCount(): number {
    return this.#root?.nodeCount ?? 0
  }

  /** Longest node path from the root to any leaf. */
  get height(): number {
    return this.#root?.height ?? 0
  }

  /** Every `[key, value]` entry in ascending key order. */
  entries(): [key: Bytes, value: Bytes][] {
    const out: [Bytes, Bytes][] = []
    const walk = (node: TrieNode, prefix: number[]) => {
      const n = node.node
      if (n.kind === 'leaf') out.push([nibblesToBytes([...prefix, ...n.path]), n.value.slice()])
      else if (n.kind === 'extension') walk(n.child, [...prefix, ...n.path])
      else {
        if (n.value !== null) out.push([nibblesToBytes(prefix), n.value.slice()])
        n.children.forEach((child, nibble) => {
          if (child) walk(child, [...prefix, nibble])
        })
      }
    }
    if (this.#root) walk(this.#root, [])
    return out
  }

  metadata(): TreeMetadata {
    return {
      leafCount: this.#len,
      height: this.height,
      nodeCount: this.nodeCount,
      hashAlgorithm: this.hasher.algorithmName,
      variant: 'MerklePatriciaTrie',
    }
  }

  toJSON(): MerklePatriciaTrieJSON {
    return {
      hashAlgorithm: this.hasher.algorithmName,
      entries: this.entries().map(([key, value]) => [toHex(key), toHex(value)]),
    }
  }

  /**
   * An index-addressed `MerkleTree` view sharing this trie's state. Leaf
   * index `i` lives at `"merkleforge:mpt:trait-leaf:" || u64be(i)`.
   * `generateProof` throws `UnsupportedOperation`: Patricia proofs are
   * key-addressed, so use `MerklePatriciaTrie.generateProof`.
   */
  indexed(): MerkleTree {
    const trie = this
    const existingKey = (index: number): Bytes => {
      if (this.isEmpty()) throw new MerkleError({ code: 'EmptyTree' })
      const key = Number.isSafeInteger(index) && index >= 0 ? keyForLeafIndex(index) : undefined
      if (key === undefined || this.get(key) === undefined) {
        throw new MerkleError({ code: 'IndexOutOfBounds', index, len: this.#len })
      }
      return key
    }
    return {
      hasher: this.hasher,
      insert: (data) => {
        let index = Math.max(this.#len, this.#nextIndexHint)
        while (this.get(keyForLeafIndex(index)) !== undefined) index++
        this.insert(keyForLeafIndex(index), data)
        this.#nextIndexHint = index + 1
        return index
      },
      remove: (index) => this.remove(existingKey(index)),
      root: () => this.root(),
      get leafCount() {
        return trie.leafCount
      },
      isEmpty: () => this.isEmpty(),
      get height() {
        return trie.height
      },
      generateProof: (index) => {
        existingKey(index)
        throw new MerkleError({
          code: 'UnsupportedOperation',
          operation: 'Patricia trie proofs are key-addressed; use MerklePatriciaTrie.generateProof',
        })
      },
      metadata: () => this.metadata(),
    }
  }

  #refreshRootHash(): void {
    const ref = this.#root?.ref
    this.#rootHash =
      ref === undefined
        ? undefined
        : ref.kind === 'hash'
          ? ref.hash
          : this.hasher.hashEncodedNode(ref.rlp)
  }

  #make(node: TrieKind): TrieNode {
    const ref = hashNode(this.hasher, toMpt(node))
    let nodeCount = 1
    let height = 1
    if (node.kind === 'extension') {
      nodeCount += node.child.nodeCount
      height += node.child.height
    } else if (node.kind === 'branch') {
      for (const child of node.children) {
        if (!child) continue
        nodeCount += child.nodeCount
        height = Math.max(height, 1 + child.height)
      }
    }
    return { node, ref, nodeCount, height }
  }

  #leaf(path: number[], value: Bytes): TrieNode {
    return this.#make({ kind: 'leaf', path, value })
  }

  #withPrefix(prefix: number[], node: TrieNode): TrieNode {
    return prefix.length === 0 ? node : this.#make({ kind: 'extension', path: prefix, child: node })
  }

  /** Builds a branch holding two entries that diverge (or end) right here. */
  #branchOf(entries: [remaining: number[], value: Bytes | TrieNode][]): TrieNode {
    const children: (TrieNode | undefined)[] = new Array(16).fill(undefined)
    let value: Bytes | null = null
    for (const [remaining, item] of entries) {
      if (!(item instanceof Uint8Array)) {
        const [nibble, ...rest] = remaining
        children[nibble as number] = this.#withPrefix(rest, item)
      } else if (remaining.length === 0) {
        value = item
      } else {
        const [nibble, ...rest] = remaining
        children[nibble as number] = this.#leaf(rest, item)
      }
    }
    return this.#make({ kind: 'branch', children, value })
  }

  #insertAt(node: TrieNode | undefined, path: number[], value: Bytes): TrieNode {
    if (node === undefined) return this.#leaf(path, value)
    const n = node.node

    if (n.kind === 'leaf') {
      if (nibblesEqual(n.path, path)) return this.#leaf(n.path, value)
      const common = commonPrefixLen(n.path, path)
      const branch = this.#branchOf([
        [n.path.slice(common), n.value],
        [path.slice(common), value],
      ])
      return this.#withPrefix(path.slice(0, common), branch)
    }

    if (n.kind === 'extension') {
      const common = commonPrefixLen(n.path, path)
      if (common === n.path.length) {
        return this.#make({
          kind: 'extension',
          path: n.path,
          child: this.#insertAt(n.child, path.slice(common), value),
        })
      }
      const branch = this.#branchOf([
        [n.path.slice(common), n.child],
        [path.slice(common), value],
      ])
      return this.#withPrefix(n.path.slice(0, common), branch)
    }

    const [nibble, ...rest] = path
    if (nibble === undefined) return this.#make({ kind: 'branch', children: n.children, value })
    const children = n.children.slice()
    children[nibble] = this.#insertAt(children[nibble], rest, value)
    return this.#make({ kind: 'branch', children, value: n.value })
  }

  /** Removes the entry at `path`, which must exist below `node`. */
  #removeAt(node: TrieNode, path: number[]): TrieNode | undefined {
    const n = node.node
    if (n.kind === 'leaf') return undefined
    if (n.kind === 'extension') {
      const child = this.#removeAt(n.child, path.slice(n.path.length))
      return child && this.#mergePrefix(n.path, child)
    }

    const children = n.children.slice()
    let value = n.value
    const [nibble, ...rest] = path
    if (nibble === undefined) value = null
    else children[nibble] = this.#removeAt(children[nibble] as TrieNode, rest)
    return this.#normalizeBranch(children, value)
  }

  /** Prepends `prefix` to `node`, merging into a leaf or extension so extensions never chain. */
  #mergePrefix(prefix: number[], node: TrieNode): TrieNode {
    const n = node.node
    if (n.kind === 'branch') return this.#make({ kind: 'extension', path: prefix, child: node })
    if (n.kind === 'leaf') return this.#leaf([...prefix, ...n.path], n.value)
    return this.#make({ kind: 'extension', path: [...prefix, ...n.path], child: n.child })
  }

  /** Collapses a branch left with fewer than two occupied slots (children plus value). */
  #normalizeBranch(children: (TrieNode | undefined)[], value: Bytes | null): TrieNode | undefined {
    const occupied = children.flatMap((child, slot) => (child ? [slot] : []))
    const [first] = occupied
    if (first === undefined) return value === null ? undefined : this.#leaf([], value)
    if (occupied.length === 1 && value === null) {
      return this.#mergePrefix([first], children[first] as TrieNode)
    }
    return this.#make({ kind: 'branch', children, value })
  }
}

function nodeRefMatches(hasher: HashFunction, ref: NodeRef, encoded: Bytes): boolean {
  return ref.kind === 'hash'
    ? bytesEqual(hasher.hashEncodedNode(encoded), ref.hash)
    : bytesEqual(ref.rlp, encoded)
}

function sameValue(a: Bytes | null, b: Bytes | null): boolean {
  return a === null || b === null ? a === b : bytesEqual(a, b)
}

function verifyProofAt(
  hasher: HashFunction,
  path: number[],
  value: Bytes | null,
  proofNodes: readonly Bytes[],
  index: number,
): boolean {
  const encoded = proofNodes[index]
  if (encoded === undefined) return false
  const isLast = index + 1 === proofNodes.length
  const node = rlpDecode(encoded)

  switch (node.kind) {
    case 'empty':
      return value === null && isLast
    case 'leaf':
      return nibblesEqual(node.keySuffix, path)
        ? sameValue(value, node.value) && isLast
        : value === null && isLast
    case 'extension': {
      if (commonPrefixLen(path, node.sharedPrefix) !== node.sharedPrefix.length)
        return value === null && isLast
      const next = proofNodes[index + 1]
      if (next === undefined || !nodeRefMatches(hasher, node.child, next)) return false
      return verifyProofAt(
        hasher,
        path.slice(node.sharedPrefix.length),
        value,
        proofNodes,
        index + 1,
      )
    }
    case 'branch': {
      const [nibble, ...rest] = path
      if (nibble === undefined) return sameValue(value, node.value) && isLast
      const child = node.children[nibble] as NodeRef
      if (child.kind === 'inline' && isRlpEmpty(child.rlp)) return value === null && isLast
      const next = proofNodes[index + 1]
      if (next === undefined || !nodeRefMatches(hasher, child, next)) return false
      return verifyProofAt(hasher, rest, value, proofNodes, index + 1)
    }
  }
}
