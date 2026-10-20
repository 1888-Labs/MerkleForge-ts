// Prints the results.json from `npm run bench` as Markdown tables for BENCHMARKS.md.
import { readFileSync } from 'node:fs'

const { environment, results } = JSON.parse(
  readFileSync(new URL('./results.json', import.meta.url)),
)
const fmt = (x) => (x === null ? 'n/a' : x >= 100 ? x.toFixed(0) : x.toFixed(1))

for (const scenario of [...new Set(results.map((r) => r.scenario))]) {
  console.log(`### ${scenario}\n`)
  for (const n of [...new Set(results.map((r) => r.n))]) {
    console.log(`**${n.toLocaleString('en-US')} leaves**\n`)
    console.log('| Library | Hash | Build (ms) | Proof (µs) | Verify (µs) |')
    console.log('|---|---|---:|---:|---:|')
    for (const r of results.filter((r) => r.scenario === scenario && r.n === n)) {
      console.log(
        `| ${r.library} | ${r.hash} | ${fmt(r.buildMs)} | ${fmt(r.proofUs)} | ${fmt(r.verifyUs)} |`,
      )
    }
    console.log()
  }
}
console.log(
  `Node ${environment.node}, ${environment.cpu}, ${environment.os}. Build is the median of ${environment.buildRuns} runs; proof and verify are the mean over ${environment.ops} random leaves.`,
)
