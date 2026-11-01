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

// Nibble value of each ASCII code, or -1 for a non-hex character.
const NIBBLES = new Int8Array(128).fill(-1)
for (let i = 0; i < 16; i++) {
  NIBBLES['0123456789abcdef'.charCodeAt(i)] = i
  NIBBLES['0123456789ABCDEF'.charCodeAt(i)] = i
}

/** Decodes hex, with or without a `0x` prefix. Throws on odd length or non-hex characters. */
export function fromHex(hex: string): Bytes {
  const start = hex.startsWith('0x') || hex.startsWith('0X') ? 2 : 0
  if ((hex.length - start) % 2 !== 0) throw new TypeError('hex string must have an even length')
  const out = new Uint8Array((hex.length - start) / 2)
  for (let i = 0, j = start; i < out.length; i++, j += 2) {
    const hi = NIBBLES[hex.charCodeAt(j)] ?? -1
    const lo = NIBBLES[hex.charCodeAt(j + 1)] ?? -1
    if (hi < 0 || lo < 0) throw new TypeError('hex string contains non-hex characters')
    out[i] = (hi << 4) | lo
  }
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
