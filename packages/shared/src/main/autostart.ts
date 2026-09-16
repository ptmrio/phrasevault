/**
 * Autostart (login item) management
 * Cross-platform support for Windows and macOS
 *
 * Platform behavior (Electron 39+, 2026):
 * - Windows: `args` parameter passes CLI flags (e.g., ['--hidden']) to the executable
 * - macOS 13+: `args` is NOT supported (Windows-only). Login detection uses `wasOpenedAtLogin`
 * - macOS <13: `wasOpenedAsHidden` still works but is deprecated
 *
 * See: https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows
 */
import { app } from 'electron'

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

/**
 * Configuration for autostart behavior
 */
export interface AutostartConfig {
  /** Whether autostart is enabled */
  enabled: boolean
}

/**
 * Options for set/get autostart functions.
 *
 * Note: Only `windowsArgs` is supported. The `args` parameter in Electron's
 * setLoginItemSettings is Windows-only. macOS login items do not support
 * custom command-line arguments.
 */
export interface AutostartOptions {
  /** Arguments to pass on Windows (e.g., ['--hidden']). Ignored on macOS. */
  windowsArgs?: string[]
}

/**
 * Default autostart args used across all apps in the monorepo.
 * Windows passes '--hidden' so `wasLaunchedAtLogin()` can detect login launches.
 * macOS uses `wasOpenedAtLogin` from the OS (no args needed).
 */
export const DEFAULT_AUTOSTART_ARGS: AutostartOptions = {
  windowsArgs: ['--hidden'],
}

/**
 * Set autostart (login item) settings
 *
 * - Windows: Registers login item with optional CLI args via the registry
 * - macOS: Registers via SMAppService (Electron abstracts this). No args support.
 *
 * @example
 * ```typescript
 * import { setAutostart, DEFAULT_AUTOSTART_ARGS } from '@spqrkapps/shared/main'
 *
 * setAutostart(true, DEFAULT_AUTOSTART_ARGS)
 * setAutostart(false)
 * ```
 */
export function setAutostart(enabled: boolean, options: AutostartOptions = {}): void {
  if (!app.isPackaged) {
    console.warn('[Autostart] Only works in packaged apps')
    return
  }

  if (isWindows) {
    const args = options.windowsArgs ?? []
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: enabled ? args : undefined,
    })
  } else if (isMac) {
    // macOS: args parameter is not supported by Electron (Windows-only)
    app.setLoginItemSettings({
      openAtLogin: enabled,
    })
  }
  // Linux: Would need XDG desktop file (not implemented)
}

/**
 * Get current autostart status
 *
 * IMPORTANT: On Windows, you must pass the same args used in setAutostart()
 * for accurate status. See: https://github.com/electron/electron/issues/33308
 *
 * @example
 * ```typescript
 * import { getAutostartStatus, DEFAULT_AUTOSTART_ARGS } from '@spqrkapps/shared/main'
 *
 * const { enabled } = getAutostartStatus(DEFAULT_AUTOSTART_ARGS)
 * ```
 */
export function getAutostartStatus(options: AutostartOptions = {}): AutostartConfig {
  // Windows requires matching args to get correct status
  const args = isWindows ? (options.windowsArgs ?? []) : undefined

  const settings = app.getLoginItemSettings({ args })

  return {
    enabled: settings.openAtLogin,
  }
}

/**
 * Check if app was launched at login/startup (cross-platform)
 *
 * Detection per platform:
 * - macOS 13+: `wasOpenedAtLogin` (via SMAppService, restored in Electron 29.4+)
 * - macOS <13: `wasOpenedAsHidden` (deprecated but still functional)
 * - Windows: `--hidden` arg presence (passed via setAutostart windowsArgs)
 */
export function wasLaunchedAtLogin(): boolean {
  const settings = app.getLoginItemSettings() as Electron.LoginItemSettings & {
    wasOpenedAsHidden?: boolean
  }

  return (
    settings.wasOpenedAtLogin ||
    Boolean(settings.wasOpenedAsHidden) ||
    process.argv.includes('--hidden')
  )
}

/**
 * Check if autostart is supported on current platform
 */
export function isAutostartSupported(): boolean {
  return isWindows || isMac
}

/**
 * Sync the system login item state to match the app's config.
 * Handles migration scenarios (e.g., NSIS→Velopack) where the
 * login item mechanism changed but the user's preference persists.
 *
 * @param shouldBeEnabled - The desired state from app config
 * @param options - Autostart options (pass same args used in setAutostart)
 *
 * @example
 * ```typescript
 * import { syncAutostart, DEFAULT_AUTOSTART_ARGS } from '@spqrkapps/shared/main'
 *
 * const config = getConfig()
 * syncAutostart(config.autostart, DEFAULT_AUTOSTART_ARGS)
 * ```
 */
export function syncAutostart(shouldBeEnabled: boolean, options: AutostartOptions = {}): void {
  if (!isAutostartSupported()) return

  const { enabled: actuallyEnabled } = getAutostartStatus(options)

  if (shouldBeEnabled && !actuallyEnabled) {
    setAutostart(true, options)
  } else if (!shouldBeEnabled && actuallyEnabled) {
    setAutostart(false, options)
  }
}

/**
 * Options for determining startup window visibility
 */
export interface StartupVisibilityOptions {
  /** Was this a login/autostart launch? (from wasLaunchedAtLogin) */
  launchedAtLogin: boolean
  /**
   * What to do on login launch.
   * - 'hidden': Stay in tray (default — most tray-resident apps want this)
   * - 'visible': Show window even on login launch
   */
  loginMode?: 'visible' | 'hidden'
  /** Force show regardless of other conditions (e.g., first run, test mode) */
  forceShow?: boolean
}

/**
 * Determine whether to show the main window at startup.
 *
 * Encapsulates the common startup visibility decision:
 * 1. forceShow (test mode, first run) → always show
 * 2. Login launch → respect loginMode (default: hidden)
 * 3. Normal user launch → always show
 *
 * @example
 * ```typescript
 * // PhraseVault: always hidden on login (no mode selector)
 * const show = shouldShowWindowOnStartup({
 *   launchedAtLogin: wasLaunchedAtLogin(),
 *   forceShow: isTestMode || config.showOnStartup,
 * })
 *
 * // ExampleApp: user-configurable login mode
 * const show = shouldShowWindowOnStartup({
 *   launchedAtLogin: wasLaunchedAtLogin(),
 *   loginMode: config.autostartMode,
 * })
 * ```
 */
export function shouldShowWindowOnStartup(options: StartupVisibilityOptions): boolean {
  if (options.forceShow) return true
  if (options.launchedAtLogin) {
    return (options.loginMode ?? 'hidden') === 'visible'
  }
  return true // Normal user-initiated launch → always show
}
