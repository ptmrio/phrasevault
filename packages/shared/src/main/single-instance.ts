/**
 * Single instance enforcement
 * Ensures only one instance of the app runs at a time
 */
import { app, BrowserWindow } from 'electron'

export interface SingleInstanceOptions {
  /** Called when a second instance is launched */
  onSecondInstance?: (
    win: BrowserWindow | null,
    commandLine: string[],
    workingDirectory: string
  ) => void
  /** Skip single instance lock in test mode (NODE_ENV === 'test') to allow Playwright to launch multiple instances */
  skipInTestMode?: boolean
}

/**
 * Enforce single instance of the app
 * Returns false if another instance is already running (current instance should quit)
 */
export function enforceSingleInstance(
  options: SingleInstanceOptions = {}
): boolean {
  // Skip single instance lock in test mode if requested
  if (options.skipInTestMode && process.env.NODE_ENV === 'test') {
    return true
  }

  const gotLock = app.requestSingleInstanceLock()

  if (!gotLock) {
    app.quit()
    return false
  }

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    const win = BrowserWindow.getAllWindows()[0] ?? null

    if (options.onSecondInstance) {
      options.onSecondInstance(win, commandLine, workingDirectory)
    } else {
      // Default behavior: focus the existing window
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    }
  })

  return true
}

/**
 * Release single instance lock (if needed)
 */
export function releaseSingleInstanceLock(): void {
  app.releaseSingleInstanceLock()
}
