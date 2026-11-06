import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'

// Runs the whole suite in real browsers. `BROWSERS` picks a subset, e.g.
// `BROWSERS=chromium pnpm test:browser`; CI runs all three.
const browsers = (process.env.BROWSERS ?? 'chromium,firefox,webkit').split(',')

export default mergeConfig(
  base,
  defineConfig({
    test: {
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: browsers.map((browser) => ({ browser: browser as 'chromium' })),
      },
    },
  }),
)
