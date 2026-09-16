/**
 * Development mode utilities for Electron apps
 * Provides DevTools auto-open, console forwarding, and test timeout handling
 */
import { app, BrowserWindow } from 'electron'

/**
 * Setup test timeout for CLI testing.
 * Parses --test-timeout=<ms> from command line and auto-quits after timeout.
 * Call this in app.whenReady().
 *
 * @example
 * ```typescript
 * app.whenReady().then(() => {
 *   setupTestTimeout()
 *   // ... rest of app init
 * })
 * ```
 */
export function setupTestTimeout(): void {
  const testTimeoutArg = process.argv.find(arg => arg.startsWith('--test-timeout='))
  if (testTimeoutArg) {
    const ms = parseInt(testTimeoutArg.split('=')[1], 10)
    if (!isNaN(ms) && ms > 0) {
      console.log(`[TEST] Auto-quit scheduled in ${ms}ms`)
      setTimeout(() => {
        console.log('[TEST] Timeout reached, quitting...')
        app.quit()
      }, ms)
    }
  }
}

/**
 * Setup development mode features for a window.
 * - Opens DevTools automatically
 * - Forwards renderer console output to main process stdout
 *
 * Only activates when NODE_ENV === 'development'.
 * Call this after window is created, typically in ready-to-show handler.
 *
 * @example
 * ```typescript
 * mainWindow.once('ready-to-show', () => {
 *   setupDevMode(mainWindow)
 *   mainWindow.show()
 * })
 * ```
 */
export function setupDevMode(window: BrowserWindow): void {
  if (process.env.NODE_ENV !== 'development') return

  window.webContents.openDevTools()

  window.webContents.on('console-message', (event) => {
    const src = event.sourceId ? event.sourceId.split('/').pop() : 'renderer'
    const level = String(event.level).toUpperCase()
    console.log(`[Renderer:${level}] ${src}:${event.lineNumber} ${event.message}`)
  })
}
