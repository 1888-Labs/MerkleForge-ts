// Per-call Keccak-256: MerkleForge's pure-JS sponge against @noble/hashes on
// the input sizes Merkle trees hash. Backs the "about 2x faster than noble"
// claim in BENCHMARKS.md. Run with `npm run bench:keccak`; CALLS adjusts the
// number of hashes per size.
import { cpus, platform, release } from 'node:os'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { keccak256 } from '../packages/merkle-hash/dist/index.js'

const CALLS = Number(process.env.CALLS ?? 200_000)
const ROUNDS = 5
const SIZES = [32, 33, 64, 65, 136]

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function inputs(size) {
  return Array.from({ length: 256 }, (_, i) => {
    const b = new Uint8Array(size)
    for (let j = 0; j < size; j++) b[j] = (i * 31 + j * 7) & 0xff
    return b
  })
}

// Median ns per call over ROUNDS rounds of CALLS hashes, after a warm-up round.
function nsPerCall(fn, data) {
  let sink = 0
  const round = () => {
    const start = performance.now()
    for (let i = 0; i < CALLS; i++) sink ^= fn(data[i & 255])[0]
    return ((performance.now() - start) * 1e6) / CALLS
  }
  round()
  const ns = median(Array.from({ length: ROUNDS }, round))
  if (sink === -1) console.log(sink) // keeps the work observable
  return ns
}

console.log('| Input | @noble/hashes keccak_256 | @merkleforge/hash keccak256 | Speedup |')
console.log('|---:|---:|---:|---:|')
for (const size of SIZES) {
  const data = inputs(size)
  for (const d of data) {
    if (keccak256(d).join() !== keccak_256(d).join())
      throw new Error(`digest mismatch at ${size} bytes`)
  }
  const noble = nsPerCall(keccak_256, data)
  const forge = nsPerCall(keccak256, data)
  console.log(
    `| ${size} B | ${(noble / 1000).toFixed(2)} µs | ${(forge / 1000).toFixed(2)} µs | ${(noble / forge).toFixed(1)}x |`,
  )
}
console.log(
  `\nNode ${process.version}, ${cpus()[0]?.model.trim()}, ${platform()} ${release()}. Median of ${ROUNDS} rounds of ${CALLS} calls per size.`,
)
