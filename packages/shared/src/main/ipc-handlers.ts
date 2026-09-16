/**
 * Standard IPC Handler Registrations
 *
 * Pre-built IPC handler sets for common functionality across all apps.
 * These eliminate duplicate handler code in individual apps.
 *
 * @example
 * ```typescript
 * import {
 *   registerThemeHandlers,
 *   registerI18nHandlers,
 *   registerWindowHandlers,
 *   registerShellHandlers,
 * } from '@spqrkapps/shared/main'
 *
 * // In app.whenReady()
 * registerThemeHandlers({ mainWindow, configService })
 * registerI18nHandlers({ mainWindow, configService, i18next })
 * registerWindowHandlers({ mainWindow })
 * registerShellHandlers()
 * ```
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { getTheme, getEffectiveTheme, handleThemeChange, type ThemeMode } from './theme'
import type { WindowControlsState } from '../types/window-controls'
import type { LicenseSystem } from './licensing'

/**
 * Configuration for theme handlers
 */
export interface ThemeHandlerOptions {
  /** Main window instance */
  mainWindow: BrowserWindow | null
  /** Function to persist theme to config */
  setConfig: (theme: ThemeMode) => void
  /** IPC channel to notify renderer of theme changes (default: 'theme:changed') */
  notifyChannel?: string
}

/**
 * Register standard theme IPC handlers
 *
 * Channels registered:
 * - `theme:get` - Returns current theme setting
 * - `theme:set` - Sets theme and updates titlebar
 * - `theme:getEffective` - Returns resolved theme (light/dark)
 *
 * @returns Cleanup function to remove handlers
 */
export function registerThemeHandlers(options: ThemeHandlerOptions): () => void {
  const { mainWindow, setConfig, notifyChannel = 'theme:changed' } = options

  ipcMain.handle('theme:get', () => getTheme())

  ipcMain.handle('theme:set', (_event, theme: ThemeMode) => {
    setConfig(theme)
    handleThemeChange(mainWindow, theme)
    mainWindow?.webContents.send(notifyChannel, theme)
    return true
  })

  ipcMain.handle('theme:getEffective', () => getEffectiveTheme())

  return () => {
    ipcMain.removeHandler('theme:get')
    ipcMain.removeHandler('theme:set')
    ipcMain.removeHandler('theme:getEffective')
  }
}

/**
 * Configuration for i18n handlers
 */
export interface I18nHandlerOptions {
  /** Main window instance */
  mainWindow: BrowserWindow | null
  /** i18next instance */
  i18next: {
    t: (key: string, options?: Record<string, unknown>) => string
    changeLanguage: (lang: string) => Promise<unknown>
    language: string
  }
  /** Function to persist language to config */
  setConfig: (lang: string) => void
  /** Available language codes (e.g., ['en', 'de']) */
  availableLanguages: string[]
  /** IPC channel to notify renderer of language changes (default: 'i18n:languageChanged') */
  notifyChannel?: string
  /** Optional callback after language change (e.g., rebuild tray menu) */
  onLanguageChanged?: (lang: string) => void
}

/**
 * Register standard i18n IPC handlers
 *
 * Channels registered:
 * - `i18n:translate` - Translate a key (async)
 * - `i18n:translate-sync` - Translate a key (sync)
 * - `i18n:changeLanguage` - Change language and persist
 * - `i18n:getLanguage` - Get current language (async)
 * - `i18n:getLanguage-sync` - Get current language (sync)
 * - `i18n:getAvailableLanguages` - Get list of available languages
 *
 * @returns Cleanup function to remove handlers
 */
export function registerI18nHandlers(options: I18nHandlerOptions): () => void {
  const {
    mainWindow,
    i18next,
    setConfig,
    availableLanguages,
    notifyChannel = 'i18n:languageChanged',
    onLanguageChanged,
  } = options

  // Async handlers
  ipcMain.handle('i18n:translate', (_event, key: string, opts?: Record<string, unknown>) => {
    return i18next.t(key, opts)
  })

  ipcMain.handle('i18n:changeLanguage', async (_event, lang: string) => {
    await i18next.changeLanguage(lang)
    setConfig(lang)
    mainWindow?.webContents.send(notifyChannel, lang)
    onLanguageChanged?.(lang)
    return true
  })

  ipcMain.handle('i18n:getLanguage', () => i18next.language)

  ipcMain.handle('i18n:getAvailableLanguages', () => availableLanguages)

  // Sync handlers (for preload)
  ipcMain.on('i18n:translate-sync', (event, key: string, opts?: Record<string, unknown>) => {
    event.returnValue = i18next.t(key, opts)
  })

  ipcMain.on('i18n:getLanguage-sync', (event) => {
    event.returnValue = i18next.language
  })

  return () => {
    ipcMain.removeHandler('i18n:translate')
    ipcMain.removeHandler('i18n:changeLanguage')
    ipcMain.removeHandler('i18n:getLanguage')
    ipcMain.removeHandler('i18n:getAvailableLanguages')
    ipcMain.removeAllListeners('i18n:translate-sync')
    ipcMain.removeAllListeners('i18n:getLanguage-sync')
  }
}

/**
 * Configuration for window handlers
 */
export interface WindowHandlerOptions {
  /** Main window instance (can be getter function for lazy access) */
  getWindow: () => BrowserWindow | null
}

/**
 * Register the window-control IPC handlers and the window-state publisher.
 *
 * Main is the single source of truth for caption state; the renderer never
 * infers it from its own click. Channels registered:
 * - `window:minimize` / `window:maximize` / `window:close` (invoke)
 * - `window:zoom` (invoke, darwin, outside fullscreen)
 * - `window:set-fullscreen` (invoke `{ fullscreen: boolean }`, darwin)
 * - `window:get-state` (invoke, returns the current snapshot)
 * - `window:state-changed` (main -> renderer, full snapshot, monotonic revision)
 *
 * Register once per app lifecycle. The returned cleanup removes the handlers
 * and every listener attached here.
 *
 * @returns Cleanup function
 */
export function registerWindowHandlers(options: WindowHandlerOptions): () => void {
  const { getWindow } = options

  let revision = 0
  let transitioning = false

  const currentPlatform = (): WindowControlsState['platform'] =>
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'

  const buildState = (): WindowControlsState => {
    const win = getWindow()
    const alive = win !== null && !win.isDestroyed()
    const platform = currentPlatform()
    const fullscreen = alive ? win.isFullScreen() : false

    return {
      revision,
      platform,
      focused: alive ? win.isFocused() : false,
      maximized: alive ? win.isMaximized() : false,
      fullscreen,
      transitioning,
      canMinimize: alive && win.isMinimizable() && !fullscreen && !transitioning,
      canMaximize:
        alive && platform !== 'darwin' && win.isMaximizable() && !fullscreen && !transitioning,
      canZoom: alive && platform === 'darwin' && !fullscreen && !transitioning,
      canFullscreen: alive && platform === 'darwin' && win.isFullScreenable() && !transitioning,
      canClose: alive && win.isClosable() && !transitioning,
    }
  }

  let watched: BrowserWindow | null = null

  function publish(): void {
    ensureWatched()
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    revision += 1
    win.webContents.send('window:state-changed', buildState())
  }

  function settle(): void {
    transitioning = false
    publish()
  }

  const windowEvents: [string, () => void][] = [
    ['focus', publish],
    ['blur', publish],
    ['maximize', publish],
    ['unmaximize', publish],
    ['minimize', publish],
    ['restore', publish],
    ['enter-full-screen', settle],
    ['leave-full-screen', settle],
  ]

  function detach(target: BrowserWindow | null): void {
    if (!target) return
    try {
      windowEvents.forEach(([event, handler]) => target.removeListener(event as 'focus', handler))
      target.webContents.removeListener('did-finish-load', publish)
    } catch {
      // Destroyed windows reject method calls; the listeners die with them.
    }
  }

  function attach(target: BrowserWindow): void {
    windowEvents.forEach(([event, handler]) => target.on(event as 'focus', handler))
    target.webContents.on('did-finish-load', publish)
  }

  function ensureWatched(): void {
    const win = getWindow()
    const next = win && !win.isDestroyed() ? win : null
    if (next === watched) return
    detach(watched)
    if (watched !== null) transitioning = false
    watched = next
    if (watched) attach(watched)
  }

  /**
   * Resolve the target window for a command. Never trust a renderer-supplied
   * window id: the sender must map to the window this registration owns, and
   * the request must come from the main frame.
   */
  const resolve = (event: IpcMainInvokeEvent): BrowserWindow | null => {
    ensureWatched()
    const win = getWindow()
    if (!win || win.isDestroyed()) return null
    if (BrowserWindow.fromWebContents(event.sender) !== win) return null
    if (event.senderFrame && event.senderFrame.parent !== null) return null
    return win
  }

  ipcMain.handle('window:minimize', (event: IpcMainInvokeEvent) => {
    const win = resolve(event)
    if (!win || transitioning || win.isFullScreen() || !win.isMinimizable()) return
    win.minimize()
  })

  ipcMain.handle('window:maximize', (event: IpcMainInvokeEvent) => {
    const win = resolve(event)
    if (!win) return
    if (currentPlatform() === 'darwin') return
    if (transitioning || win.isFullScreen() || !win.isMaximizable()) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window:close', (event: IpcMainInvokeEvent) => {
    const win = resolve(event)
    if (!win || transitioning) return
    // close() only, so each app's close interception and tray policy runs.
    win.close()
  })

  ipcMain.handle('window:zoom', (event: IpcMainInvokeEvent) => {
    const win = resolve(event)
    if (!win) return
    if (currentPlatform() !== 'darwin') return
    if (transitioning || win.isFullScreen()) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window:set-fullscreen', (event: IpcMainInvokeEvent, payload: unknown) => {
    const win = resolve(event)
    if (!win) return
    if (currentPlatform() !== 'darwin') return
    if (transitioning) return
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { fullscreen?: unknown }).fullscreen !== 'boolean'
    ) {
      return
    }
    const { fullscreen } = payload as { fullscreen: boolean }
    if (win.isFullScreen() === fullscreen) return

    transitioning = true
    publish()
    win.setFullScreen(fullscreen)
  })

  ipcMain.handle('window:get-state', (event: IpcMainInvokeEvent): WindowControlsState | null => {
    if (!resolve(event)) return null
    // No revision bump: a get-state reply must never look newer than the last
    // published event, so a losing race is discarded by the renderer.
    return buildState()
  })

  ensureWatched()

  return () => {
    const channels = [
      'window:minimize',
      'window:maximize',
      'window:close',
      'window:zoom',
      'window:set-fullscreen',
      'window:get-state',
    ]
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    detach(watched)
    watched = null
  }
}

/**
 * Register standard shell IPC handlers
 *
 * Channels registered:
 * - `shell:openExternal` - Open URL in default browser
 * - `shell:showItemInFolder` - Show file in file manager
 * - `shell:openPath` - Open file with default application
 *
 * @returns Cleanup function to remove handlers
 */
export function registerShellHandlers(): () => void {
  ipcMain.on('shell:openExternal', (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:openPath', (_event, filePath: string) => {
    return shell.openPath(filePath)
  })

  return () => {
    ipcMain.removeAllListeners('shell:openExternal')
    ipcMain.removeHandler('shell:showItemInFolder')
    ipcMain.removeHandler('shell:openPath')
  }
}

/**
 * Configuration for app info handlers
 */
export interface AppInfoHandlerOptions {
  /** Electron app instance */
  app: {
    getVersion: () => string
    getPath: (name: 'userData' | 'logs') => string
    isPackaged: boolean
  }
  /** Additional info to include */
  additionalInfo?: Record<string, unknown>
}

/**
 * Register standard app info IPC handlers
 *
 * Channels registered:
 * - `app:getInfo` - Get app version, platform, paths, etc.
 *
 * @returns Cleanup function to remove handlers
 */
export function registerAppInfoHandlers(options: AppInfoHandlerOptions): () => void {
  const { app, additionalInfo = {} } = options

  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    paths: {
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
    },
    ...additionalInfo,
  }))

  return () => {
    ipcMain.removeHandler('app:getInfo')
  }
}

/**
 * Configuration for license/trial IPC handlers
 */
export interface LicenseHandlerOptions {
  /** License system from createLicenseSystem() */
  licensing: LicenseSystem
  /**
   * Channel prefix for trial-related handlers.
   * - `'trial'` → `trial:status`, `trial:shouldShowReminder`, `trial:markReminderShown` (BOS)
   * - `'license'` → `license:getTrialStatus`, `license:shouldShowReminder`, `license:markReminderShown` (PV/PC)
   * @default 'trial'
   */
  trialPrefix?: 'trial' | 'license'
  /** Called after successful license activation (e.g. to clear legacy flags) */
  onActivated?: (payload: Record<string, unknown>) => void
}

/**
 * Register standard licensing and trial IPC handlers
 *
 * Channels registered:
 * - `license:activate` — Validate and store a license key
 * - `license:get` — Get stored license
 * - `license:deactivate` — Clear stored license
 * - `license:hasValid` — Check if a valid license exists
 * - `{trial:status | license:getTrialStatus}` — Get trial status
 * - `{trial:shouldShowReminder | license:shouldShowReminder}` — Check purchase reminder
 * - `{trial:markReminderShown | license:markReminderShown}` — Mark reminder as shown
 *
 * @returns Cleanup function to remove all handlers
 */
export function registerLicenseHandlers(options: LicenseHandlerOptions): () => void {
  const { licensing, trialPrefix = 'trial', onActivated } = options

  ipcMain.handle('license:activate', async (_event, licenseKey: string) => {
    try {
      const result = await licensing.validateAndStore(licenseKey.trim())
      if (result.valid && result.payload) {
        onActivated?.(result.payload)
        return { success: true, payload: result.payload }
      }
      return { success: false, error: result.error || 'Invalid license' }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('license:get', () => licensing.store.getLicense())

  ipcMain.handle('license:deactivate', () => {
    licensing.store.clearLicense()
    return { success: true }
  })

  ipcMain.handle('license:hasValid', () => licensing.store.hasValidLicense())

  // Trial handlers — channel names depend on prefix
  const trialStatusChannel = trialPrefix === 'trial' ? 'trial:status' : 'license:getTrialStatus'
  const shouldRemindChannel = trialPrefix === 'trial' ? 'trial:shouldShowReminder' : 'license:shouldShowReminder'
  const markShownChannel = trialPrefix === 'trial' ? 'trial:markReminderShown' : 'license:markReminderShown'

  ipcMain.handle(trialStatusChannel, () => licensing.trial.getTrialStatus())

  ipcMain.handle(shouldRemindChannel, () => {
    if (licensing.store.hasValidLicense()) return false
    return licensing.trial.shouldShowReminder()
  })

  ipcMain.handle(markShownChannel, () => {
    licensing.trial.markReminderShown()
    return { success: true }
  })

  return () => {
    ipcMain.removeHandler('license:activate')
    ipcMain.removeHandler('license:get')
    ipcMain.removeHandler('license:deactivate')
    ipcMain.removeHandler('license:hasValid')
    ipcMain.removeHandler(trialStatusChannel)
    ipcMain.removeHandler(shouldRemindChannel)
    ipcMain.removeHandler(markShownChannel)
  }
}
