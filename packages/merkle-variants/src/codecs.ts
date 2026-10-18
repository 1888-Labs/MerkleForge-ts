import {
  BincodeReader,
  BincodeWriter,
  type Bytes,
  byteArrayFromJSON,
  MerkleError,
} from '@1888-labs/merkle-core'
import type { MptProof } from './patricia.js'
import { SPARSE_KEY_BYTES, type SparseMerkleProof } from './sparse.js'

/** Encodes a sparse proof like the Rust `SparseMerkleProof::to_bytes()`. */
export function encodeSparseProof(proof: SparseMerkleProof): Bytes {
  const w = new BincodeWriter().fixedBytes(proof.key)
  w.seq(proof.siblings, (sibling) => w.option(sibling, (hash) => w.fixedBytes(hash)))
  w.option(proof.leaf, (hash) => w.fixedBytes(hash))
  return w.finish()
}

/** Decodes the Rust `SparseMerkleProof::<[u8; N]>::from_bytes` format. Rejects trailing bytes. */
export function decodeSparseProof(bytes: Bytes, digestSize = 32): SparseMerkleProof {
  const r = new BincodeReader(bytes)
  const key = r.fixedBytes(SPARSE_KEY_BYTES)
  const siblings = r.seq(() => r.option(() => r.fixedBytes(digestSize)))
  const leaf = r.option(() => r.fixedBytes(digestSize))
  r.end()
  return { key, siblings, leaf }
}

/** The `serde_json` shape of a Rust `SparseMerkleProof<[u8; 32]>`. */
export interface SparseMerkleProofSerdeJSON {
  key: number[]
  siblings: (number[] | null)[]
  leaf: number[] | null
}

export function sparseProofToSerdeJSON(proof: SparseMerkleProof): SparseMerkleProofSerdeJSON {
  return {
    key: [...proof.key],
    siblings: proof.siblings.map((s) => (s === null ? null : [...s])),
    leaf: proof.leaf === null ? null : [...proof.leaf],
  }
}

export function sparseProofFromSerdeJSON(
  json: SparseMerkleProofSerdeJSON,
  digestSize = 32,
): SparseMerkleProof {
  return {
    key: byteArrayFromJSON(json.key, SPARSE_KEY_BYTES),
    siblings: json.siblings.map((s) => (s === null ? null : byteArrayFromJSON(s, digestSize))),
    leaf: json.leaf === null ? null : byteArrayFromJSON(json.leaf, digestSize),
  }
}

/** Encodes a Patricia witness like the Rust `MptProof::to_bytes()`. */
export function encodeMptProof(proof: MptProof): Bytes {
  const w = new BincodeWriter().bytes(proof.key)
  w.option(proof.value, (value) => w.bytes(value))
  w.seq(proof.proofNodes, (node) => w.bytes(node))
  return w.finish()
}

/** Decodes the Rust `MptProof::from_bytes` format. Rejects trailing bytes. */
export function decodeMptProof(bytes: Bytes): MptProof {
  const r = new BincodeReader(bytes)
  const key = r.bytes()
  const value = r.option(() => r.bytes())
  const proofNodes = r.seq(() => r.bytes())
  r.end()
  return { key, value, proofNodes }
}

/** The `serde_json` shape of a Rust `MptProof`. */
export interface MptProofSerdeJSON {
  key: number[]
  value: number[] | null
  proof_nodes: number[][]
}

export function mptProofToSerdeJSON(proof: MptProof): MptProofSerdeJSON {
  return {
    key: [...proof.key],
    value: proof.value === null ? null : [...proof.value],
    proof_nodes: proof.proofNodes.map((node) => [...node]),
  }
}

export function mptProofFromSerdeJSON(json: MptProofSerdeJSON): MptProof {
  if (!Array.isArray(json.proof_nodes)) {
    throw new MerkleError({ code: 'DeserializationError', reason: 'proof_nodes must be an array' })
  }
  return {
    key: byteArrayFromJSON(json.key),
    value: json.value === null ? null : byteArrayFromJSON(json.value),
    proofNodes: json.proof_nodes.map((node) => byteArrayFromJSON(node)),
  }
}
