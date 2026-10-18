/** Raw bytes. Every digest, leaf, and encoded node in MerkleForge is a `Uint8Array`. */
export type Bytes = Uint8Array

const encoder = new TextEncoder()

/** Encodes a string as UTF-8 bytes. */
export function utf8(text: string): Bytes {
  return encoder.encode(text)
}

const HEX_BYTES = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** Encodes bytes as lowercase hex with a `0x` prefix. */
export function toHex(bytes: Bytes): string {
  let out = '0x'
  for (const byte of bytes) out += HEX_BYTES[byte] as string
  return out
}

/** Decodes hex, with or without a `0x` prefix. Throws on odd length or non-hex characters. */
export function fromHex(hex: string): Bytes {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (body.length % 2 !== 0) throw new TypeError('hex string must have an even length')
  if (!/^[0-9a-fA-F]*$/.test(body)) throw new TypeError('hex string contains non-hex characters')
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Byte-wise equality. Not constant time. */
export function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Concatenates byte arrays into a new `Uint8Array`. */
export function concatBytes(...parts: Bytes[]): Bytes {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
