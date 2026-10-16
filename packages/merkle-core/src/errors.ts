/** Every way a MerkleForge operation can fail, mirroring the Rust `MerkleError`. */
export type MerkleErrorDetail =
  | { code: 'EmptyTree' }
  | { code: 'IndexOutOfBounds'; index: number; len: number }
  | { code: 'InvalidProof' }
  | { code: 'InvalidProofStructure'; reason: string }
  | { code: 'EmptyLeafData' }
  | { code: 'SerializationError'; reason: string }
  | { code: 'DeserializationError'; reason: string }
  | { code: 'HashError'; reason: string }
  | { code: 'UnsupportedOperation'; operation: string }
  | { code: 'RlpError'; reason: string }

export type MerkleErrorCode = MerkleErrorDetail['code']

function describe(detail: MerkleErrorDetail): string {
  switch (detail.code) {
    case 'EmptyTree':
      return 'operation requires a non-empty tree'
    case 'IndexOutOfBounds':
      return `index ${detail.index} is out of bounds for a tree with ${detail.len} leaves`
    case 'InvalidProof':
      return 'proof verification failed: computed root does not match'
    case 'InvalidProofStructure':
      return `malformed proof structure: ${detail.reason}`
    case 'EmptyLeafData':
      return 'leaf data must not be empty'
    case 'SerializationError':
      return `serialisation error: ${detail.reason}`
    case 'DeserializationError':
      return `deserialisation error: ${detail.reason}`
    case 'HashError':
      return `hash computation error: ${detail.reason}`
    case 'UnsupportedOperation':
      return `operation '${detail.operation}' is not supported for this tree variant`
    case 'RlpError':
      return `RLP codec error: ${detail.reason}`
  }
}

/**
 * Thrown by MerkleForge operations. Switch on `error.detail.code` to handle a
 * specific case; the remaining `detail` fields depend on the code.
 */
export class MerkleError extends Error {
  override readonly name = 'MerkleError'
  readonly detail: MerkleErrorDetail

  constructor(detail: MerkleErrorDetail) {
    super(describe(detail))
    this.detail = detail
  }

  get code(): MerkleErrorCode {
    return this.detail.code
  }
}

/** Type guard for `MerkleError`, optionally narrowed to one code. */
export function isMerkleError<C extends MerkleErrorCode>(
  error: unknown,
  code?: C,
): error is MerkleError & { detail: Extract<MerkleErrorDetail, { code: C }> } {
  return error instanceof MerkleError && (code === undefined || error.code === code)
}
