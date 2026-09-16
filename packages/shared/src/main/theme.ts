/**
 * Theme management
 * System/light/dark theme with native theme integration
 */
import { nativeTheme, BrowserWindow } from 'electron'

export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * Set the application theme
 */
export function setTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

/**
 * Get the current theme setting
 */
export function getTheme(): ThemeMode {
  return nativeTheme.themeSource as ThemeMode
}

/**
 * Get the effective theme (resolved from system if needed)
 */
export function getEffectiveTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * Check if currently in dark mode
 */
export function isDarkMode(): boolean {
  return nativeTheme.shouldUseDarkColors
}

/**
 * Handle theme change from IPC - updates nativeTheme
 * Use this in theme:set IPC handlers for consistent behavior across apps
 *
 * The caption is in-page, so there is no native titlebar overlay to recolor;
 * the bar's color comes from `--titlebar-bg`. The window parameter is kept so
 * existing call sites keep their shape.
 */
export function handleThemeChange(_win: BrowserWindow | null, theme: ThemeMode): void {
  setTheme(theme)
}

/**
 * Set up theme change listener that notifies the renderer
 */
export function setupThemeListener(
  mainWindow: BrowserWindow,
  options?: {
    /** IPC channel to send theme changes to renderer */
    ipcChannel?: string
    /** Additional callback when theme changes */
    onThemeChange?: (isDark: boolean) => void
  }
): () => void {
  const { ipcChannel = 'theme:changed', onThemeChange } = options ?? {}

  const handler = () => {
    const isDark = nativeTheme.shouldUseDarkColors

    // Send to renderer
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(ipcChannel, isDark)
    }

    // Custom callback
    onThemeChange?.(isDark)
  }

  nativeTheme.on('updated', handler)

  // Return cleanup function
  return () => {
    nativeTheme.off('updated', handler)
  }
}
