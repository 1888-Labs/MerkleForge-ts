import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve workspace packages to their sources so tests never depend on a prior build.
const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@1888-labs/merkle-core': src('merkle-core'),
      '@1888-labs/merkle-hash': src('merkle-hash'),
      '@1888-labs/merkle-hash-wasm': src('merkle-hash-wasm'),
      '@1888-labs/merkle-variants': src('merkle-variants'),
      '@1888-labs/merkle-ethereum': src('merkle-ethereum'),
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
