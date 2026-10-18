import {
  type Bytes,
  bytesEqual,
  concatBytes,
  fromHex,
  type HashFunction,
  MerkleError,
  toHex,
} from '@1888-labs/merkle-core'
import { Keccak256 } from '@1888-labs/merkle-hash'
import { decodeRlp, MerklePatriciaTrie, type RlpValue } from '@1888-labs/merkle-variants'
import { keccak_256 } from '@noble/hashes/sha3.js'

/** Bytes, or a hex string as returned by JSON-RPC (`0x`-prefixed). */
export type BytesLike = Bytes | string

/** Root of an empty trie: `keccak256(rlp(""))`. The storage root of an account with no storage. */
export const EMPTY_TRIE_ROOT = fromHex(
  '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
)
/** `keccak256("")`: the code hash of an account with no code. */
export const EMPTY_CODE_HASH = fromHex(
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
)

/** An Ethereum account as stored in the state trie. */
export interface EthAccount {
  readonly nonce: bigint
  readonly balance: bigint
  readonly storageRoot: Bytes
  readonly codeHash: Bytes
}

/** The `eth_getProof` JSON-RPC response (EIP-1186). */
export interface EthGetProofResponse {
  address: string
  balance: string
  codeHash: string
  nonce: string
  storageHash: string
  accountProof: string[]
  storageProof: { key: string; value: string; proof: string[] }[]
}

/** A verified `eth_getProof` response. `account` is `null` when the account does not exist. */
export interface VerifiedEthProof {
  readonly address: Bytes
  readonly account: EthAccount | null
  readonly storage: readonly { readonly slot: Bytes; readonly value: bigint }[]
}

export interface VerifyOptions {
  /** Hash used for trie nodes. Defaults to `Keccak256`; pass `createKeccak256Wasm()` for speed. */
  hasher?: HashFunction
}

function bytes(value: BytesLike): Bytes {
  return typeof value === 'string' ? fromHex(value) : value
}

function invalid(): MerkleError {
  return new MerkleError({ code: 'InvalidProof' })
}

/** Raw `keccak256(data)`, without MerkleForge's leaf prefix. */
export function keccak256(data: BytesLike): Bytes {
  return keccak_256(bytes(data))
}

/**
 * Left-pads to 32 bytes. Hex strings may be JSON-RPC quantities such as
 * `"0x0"` (odd length is fine). Throws when the value does not fit.
 */
export function toBytes32(value: BytesLike | bigint): Bytes {
  if (typeof value === 'string') {
    if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new TypeError(`invalid hex value ${value}`)
    value = BigInt(value)
  }
  if (typeof value === 'bigint') {
    if (value < 0n || value >= 1n << 256n) throw new RangeError('value does not fit in 32 bytes')
    return fromHex(value.toString(16).padStart(64, '0'))
  }
  const raw = value
  if (raw.length > 32) throw new RangeError(`value is ${raw.length} bytes, expected at most 32`)
  const out = new Uint8Array(32)
  out.set(raw, 32 - raw.length)
  return out
}

/** Big-endian unsigned integer from bytes. Empty bytes are `0n`. */
export function bytesToBigInt(value: Bytes): bigint {
  return value.length === 0 ? 0n : BigInt(toHex(value))
}

/**
 * The storage slot of `mapping[key]` for a Solidity mapping declared at
 * `slot`: `keccak256(pad32(key) || pad32(slot))`. Nest calls for nested mappings.
 */
export function mappingSlot(key: BytesLike | bigint, slot: BytesLike | bigint): Bytes {
  return keccak256(concatBytes(toBytes32(key), toBytes32(slot)))
}

function decodeAccount(rlp: Bytes): EthAccount {
  let fields: RlpValue
  try {
    fields = decodeRlp(rlp)
  } catch {
    throw invalid()
  }
  if (
    !Array.isArray(fields) ||
    fields.length !== 4 ||
    !fields.every((f) => f instanceof Uint8Array)
  )
    throw invalid()
  const [nonce, balance, storageRoot, codeHash] = fields as Bytes[]
  if (storageRoot?.length !== 32 || codeHash?.length !== 32) throw invalid()
  return {
    nonce: bytesToBigInt(nonce as Bytes),
    balance: bytesToBigInt(balance as Bytes),
    storageRoot,
    codeHash,
  }
}

/**
 * Verifies an account proof against a block's `stateRoot` and returns the
 * account, or `null` when the proof shows the account does not exist.
 * Throws `InvalidProof` when the proof does not match the root.
 */
export function verifyAccountProof(
  params: { stateRoot: BytesLike; address: BytesLike; proof: readonly BytesLike[] },
  options: VerifyOptions = {},
): EthAccount | null {
  const address = bytes(params.address)
  if (address.length !== 20) throw new TypeError(`address must be 20 bytes, got ${address.length}`)
  const value = MerklePatriciaTrie.proveValue(
    options.hasher ?? Keccak256,
    bytes(params.stateRoot),
    keccak256(address),
    params.proof.map(bytes),
  )
  return value === null ? null : decodeAccount(value)
}

/**
 * Verifies a storage proof against an account's `storageRoot` and returns the
 * slot value (`0n` when the slot is empty). Throws `InvalidProof` on mismatch.
 */
export function verifyStorageProof(
  params: { storageRoot: BytesLike; slot: BytesLike | bigint; proof: readonly BytesLike[] },
  options: VerifyOptions = {},
): bigint {
  const storageRoot = bytes(params.storageRoot)
  const proof = params.proof.map(bytes)
  if (proof.length === 0 && bytesEqual(storageRoot, EMPTY_TRIE_ROOT)) return 0n
  const value = MerklePatriciaTrie.proveValue(
    options.hasher ?? Keccak256,
    storageRoot,
    keccak256(toBytes32(params.slot)),
    proof,
  )
  if (value === null) return 0n
  let decoded: RlpValue
  try {
    decoded = decodeRlp(value)
  } catch {
    throw invalid()
  }
  if (!(decoded instanceof Uint8Array) || decoded.length > 32 || decoded[0] === 0) throw invalid()
  return bytesToBigInt(decoded)
}

function sameQuantity(hex: string, value: bigint): boolean {
  return BigInt(hex) === value
}

/**
 * Verifies a full `eth_getProof` response against a trusted `stateRoot`:
 * the account proof, every storage proof, and that the response's own
 * fields (`balance`, `nonce`, `storageHash`, `codeHash`, each `value`) agree
 * with what the proofs show. Throws `InvalidProof` on any mismatch.
 */
export function verifyEthGetProof(
  stateRoot: BytesLike,
  response: EthGetProofResponse,
  options: VerifyOptions = {},
): VerifiedEthProof {
  const address = bytes(response.address)
  const account = verifyAccountProof({ stateRoot, address, proof: response.accountProof }, options)

  if (account === null) {
    const zeroed =
      sameQuantity(response.balance, 0n) &&
      sameQuantity(response.nonce, 0n) &&
      response.storageProof.every((s) => sameQuantity(s.value, 0n))
    if (!zeroed) throw invalid()
    return {
      address,
      account,
      storage: response.storageProof.map((s) => ({ slot: toBytes32(s.key), value: 0n })),
    }
  }

  const consistent =
    sameQuantity(response.balance, account.balance) &&
    sameQuantity(response.nonce, account.nonce) &&
    bytesEqual(fromHex(response.storageHash), account.storageRoot) &&
    bytesEqual(fromHex(response.codeHash), account.codeHash)
  if (!consistent) throw invalid()

  const storage = response.storageProof.map((s) => {
    const slot = toBytes32(s.key)
    const value = verifyStorageProof(
      { storageRoot: account.storageRoot, slot, proof: s.proof },
      options,
    )
    if (!sameQuantity(s.value, value)) throw invalid()
    return { slot, value }
  })
  return { address, account, storage }
}
