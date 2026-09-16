/**
 * Shared Playwright configuration for Electron apps
 *
 * Usage in app playwright.config.ts:
 * ```typescript
 * import { createPlaywrightConfig } from '@spqrkapps/shared/e2e/playwright.base'
 *
 * export default createPlaywrightConfig({
 *   testDir: './e2e',
 * })
 * ```
 */

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

export interface ElectronPlaywrightConfigOptions {
  /** Test directory (default: './e2e') */
  testDir?: string
  /** Test timeout in ms (default: 60000) */
  timeout?: number
  /** Number of retries (default: 0 locally, 2 in CI) */
  retries?: number
  /** Whether to run tests in parallel (default: false for Electron) */
  fullyParallel?: boolean
  /** Number of workers (default: 1 for Electron) */
  workers?: number
  /** Reporter type (default: 'html') */
  reporter?: PlaywrightTestConfig['reporter']
  /** Output directory for artifacts (default: './e2e-results') */
  outputDir?: string
  /** Additional Playwright config options */
  additionalConfig?: Partial<PlaywrightTestConfig>
}

/**
 * Create a Playwright config optimized for Electron testing
 */
export function createPlaywrightConfig(
  options: ElectronPlaywrightConfigOptions = {}
): PlaywrightTestConfig {
  const {
    testDir = './e2e',
    timeout = 60000,
    retries = process.env.CI ? 2 : 0,
    fullyParallel = false,
    workers = 1,
    reporter = 'html',
    outputDir = './e2e-results',
    additionalConfig = {},
  } = options

  return defineConfig({
    testDir,
    timeout,
    fullyParallel,
    forbidOnly: !!process.env.CI,
    retries,
    workers,
    reporter,
    outputDir,

    // Electron-specific settings
    use: {
      // Capture trace on first retry for debugging
      trace: 'on-first-retry',
      // Capture screenshot on failure
      screenshot: 'only-on-failure',
      // Capture video on first retry
      video: 'on-first-retry',
    },

    // Don't use web server (Electron handles its own)
    webServer: undefined,

    // Projects - single project for Electron
    projects: [
      {
        name: 'electron',
        testMatch: '**/*.spec.ts',
      },
    ],

    // Merge additional config
    ...additionalConfig,
  })
}

export { defineConfig }
