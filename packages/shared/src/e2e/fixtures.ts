/**
 * Shared Playwright fixtures for Electron app testing
 *
 * Usage in app e2e tests:
 * ```typescript
 * import { test, expect } from '@spqrkapps/shared/e2e'
 * ```
 */

import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, ConsoleMessage } from '@playwright/test'
import * as path from 'path'

export interface ConsoleError {
  type: string
  text: string
  location: string
}

export interface ElectronTestFixtures {
  electronApp: ElectronApplication
  window: Page
  consoleErrors: ConsoleError[]
}

export interface ElectronWorkerFixtures {
  appPath: string
  mainScript: string
  appName: string
}

/**
 * Patterns to ignore in console error detection
 * These are known benign messages from Electron/Chromium internals
 */
const IGNORED_CONSOLE_PATTERNS = [
  /Autofill\.enable/,
  /Autofill\.setAddresses/,
  /DevTools/,
  /Electron Security Warning/,
  /electron\/js2c/,
]

/**
 * Check if a console message should be ignored
 */
function shouldIgnoreConsoleMessage(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Create Playwright test with Electron fixtures
 *
 * @param options - Configuration for the Electron app
 * @returns Configured test function with Electron fixtures
 */
export function createElectronTest(options: {
  /** Path to the app directory (e.g., path to apps/example-app) */
  appDir: string
  /** App name for logging */
  appName: string
  /** Main script path relative to .vite/build (default: 'main.js') */
  mainScript?: string
  /** Additional environment variables */
  env?: Record<string, string>
  /** Timeout for app launch in ms (default: 30000) */
  launchTimeout?: number
}) {
  const {
    appDir,
    appName,
    mainScript = 'main.cjs',
    env = {},
    launchTimeout = 30000,
  } = options

  return base.extend<ElectronTestFixtures, ElectronWorkerFixtures>({
    // Worker-scoped fixtures (shared across tests in a worker)
    appPath: [appDir, { scope: 'worker' }],
    mainScript: [mainScript, { scope: 'worker' }],
    appName: [appName, { scope: 'worker' }],

    // Test-scoped fixtures
    consoleErrors: async ({}, use) => {
      const errors: ConsoleError[] = []
      await use(errors)
    },

    electronApp: async ({ appPath, mainScript, consoleErrors }, use) => {
      const mainPath = path.join(appPath, 'dist', mainScript)

      const electronApp = await electron.launch({
        args: [mainPath],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          ELECTRON_ENABLE_LOGGING: '1',
          ...env,
        },
        timeout: launchTimeout,
      })

      const attached = new WeakSet<Page>()
      const attachListeners = (page: Page) => {
        if (attached.has(page)) return
        attached.add(page)

        page.on('console', (msg: ConsoleMessage) => {
          const type = msg.type()
          const text = msg.text()

          if ((type === 'error' || type === 'warning') && !shouldIgnoreConsoleMessage(text)) {
            consoleErrors.push({
              type,
              text,
              location: msg.location().url || 'unknown',
            })
          }
        })

        page.on('pageerror', (error) => {
          consoleErrors.push({
            type: 'error',
            text: error.message,
            location: error.stack || 'pageerror',
          })
        })
      }

      electronApp.on('window', attachListeners)
      for (const page of electronApp.windows()) {
        attachListeners(page)
      }

      await use(electronApp)
      await electronApp.close()
    },

    window: async ({ electronApp }, use) => {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await use(window)
    },
  })
}

/**
 * Assert that no console errors occurred during test
 */
export function expectNoConsoleErrors(errors: ConsoleError[]): void {
  const actualErrors = errors.filter(e => e.type === 'error')
  if (actualErrors.length > 0) {
    const errorMessages = actualErrors
      .map(e => `  [${e.type}] ${e.text} (${e.location})`)
      .join('\n')
    throw new Error(`Console errors detected:\n${errorMessages}`)
  }
}

/**
 * Assert that no console warnings occurred during test
 */
export function expectNoConsoleWarnings(errors: ConsoleError[]): void {
  const warnings = errors.filter(e => e.type === 'warning')
  if (warnings.length > 0) {
    const warningMessages = warnings
      .map(e => `  [${e.type}] ${e.text} (${e.location})`)
      .join('\n')
    throw new Error(`Console warnings detected:\n${warningMessages}`)
  }
}

// Re-export Playwright utilities
export { expect, electron }
export type { ElectronApplication, Page, ConsoleMessage }
