/**
 * Shell utilities
 * Wrappers around Electron's shell module with type safety
 */
import { shell } from 'electron'

/**
 * Open a URL in the default browser
 */
export function openExternal(url: string): Promise<void> {
  return shell.openExternal(url)
}

/**
 * Open a URL in the default browser (fire and forget)
 */
export function openExternalSync(url: string): void {
  shell.openExternal(url).catch(() => {
    // Ignore errors for fire-and-forget
  })
}

/**
 * Show a file in the system file manager
 */
export function showItemInFolder(fullPath: string): void {
  shell.showItemInFolder(fullPath)
}

/**
 * Open a file with its default application
 * Returns empty string on success, error message on failure
 */
export function openPath(fullPath: string): Promise<string> {
  return shell.openPath(fullPath)
}

/**
 * Move a file to the trash
 * Returns true on success
 */
export async function trashItem(fullPath: string): Promise<boolean> {
  try {
    await shell.trashItem(fullPath)
    return true
  } catch {
    return false
  }
}

/**
 * Play the system beep sound
 */
export function beep(): void {
  shell.beep()
}
