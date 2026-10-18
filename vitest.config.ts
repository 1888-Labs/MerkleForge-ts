import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve workspace packages to their sources so tests never depend on a prior build.
const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@merkleforge/core': src('merkle-core'),
      '@merkleforge/hash': src('merkle-hash'),
      '@merkleforge/hash-wasm': src('merkle-hash-wasm'),
      '@merkleforge/variants': src('merkle-variants'),
      '@merkleforge/ethereum': src('merkle-ethereum'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
