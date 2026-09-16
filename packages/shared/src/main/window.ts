/**
 * Window factory for Electron apps
 * Creates BrowserWindow with consistent settings and a frameless, in-page caption
 *
 * There is no native window chrome: the Windows Control Overlay and the macOS
 * hiddenInset traffic lights paint above the webview and cannot be covered by
 * `.modal-overlay`. The caption is rendered in-page by
 * `initWindowControls` from `@spqrkapps/shared/renderer`.
 */
import { BrowserWindow, Menu, nativeTheme } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'

/** Options that would re-introduce native window chrome. Never accepted. */
const NATIVE_CHROME_KEYS = [
  'frame',
  'titleBarStyle',
  'titleBarOverlay',
  'trafficLightPosition',
] as const

/** `BrowserWindow` options a caller may pass through, minus the caption keys. */
export type SafeBrowserWindowOptions = Omit<
  Partial<BrowserWindowConstructorOptions>,
  (typeof NATIVE_CHROME_KEYS)[number]
>

export interface WindowOptions {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  /** Window X position (for restoring window state) */
  x?: number
  /** Window Y position (for restoring window state) */
  y?: number
  preloadPath: string
  htmlPath?: string
  devUrl?: string
  isDev?: boolean
  /** Path to window icon (.ico on Windows, .png on macOS/Linux) */
  icon?: string
  /** Window background color (hex string) */
  backgroundColor?: string
  /**
   * Enable sandbox (recommended for security).
   * Set false only if preload needs Node.js APIs like fs/path.
   * @default false - Many Electron apps need Node.js in preload
   */
  sandbox?: boolean
  /** Show window immediately or wait for ready-to-show */
  showImmediately?: boolean
  /**
   * Auto-show window on ready-to-show event.
   * Set to false if app needs custom show logic (e.g., autostart modes).
   * @default true (when showImmediately is false)
   */
  autoShow?: boolean
  /** Additional BrowserWindow options (native caption keys are rejected) */
  browserWindowOptions?: SafeBrowserWindowOptions
}

/**
 * Drop any native caption key a caller slipped through a cast or from JS.
 * Types alone are bypassable; the runtime delete plus a warning is not.
 */
function stripNativeChrome(options: SafeBrowserWindowOptions): SafeBrowserWindowOptions {
  const extra = options as Record<string, unknown>
  const removed = NATIVE_CHROME_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(extra, key)
  )
  if (removed.length > 0) {
    console.warn(
      '[shared/window] browserWindowOptions cannot set native window chrome; ignoring keys:',
      removed
    )
    removed.forEach((key) => {
      delete extra[key]
    })
  }
  return options
}

/**
 * Create a main window with consistent settings
 */
export function createMainWindow(options: WindowOptions): BrowserWindow {
  const {
    width = 1200,
    height = 800,
    minWidth = 800,
    minHeight = 600,
    x,
    y,
    preloadPath,
    htmlPath,
    devUrl,
    isDev = false,
    icon,
    backgroundColor,
    sandbox = false,
    showImmediately = false,
    autoShow = true,
    browserWindowOptions = {},
  } = options

  const isMac = process.platform === 'darwin'

  const windowOptions: BrowserWindowConstructorOptions = {
    width,
    height,
    minWidth,
    minHeight,
    ...(x !== undefined && { x }),
    ...(y !== undefined && { y }),
    ...(icon && { icon }),
    ...(backgroundColor && { backgroundColor }),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox,
    },
    ...stripNativeChrome(browserWindowOptions),
    // These keys win over the spread so a cast cannot restore native chrome
    // or a constructor-time show on darwin.
    frame: false,
    show: isMac ? false : showImmediately,
    ...(isMac ? { zoomToPageWidth: true } : {}),
  }

  const win = new BrowserWindow(windowOptions)

  if (isMac) {
    // The in-page cluster is the only caption. Hide the native traffic lights
    // before any show(), and re-assert after every transition that can repaint
    // them, so no native cluster flashes.
    const hideNativeButtons = () => {
      if (!win.isDestroyed()) win.setWindowButtonVisibility(false)
    }
    hideNativeButtons()
    win.on('show', hideNativeButtons)
    win.on('enter-full-screen', hideNativeButtons)
    win.on('leave-full-screen', hideNativeButtons)
    if (showImmediately) win.show()
  }

  // Enable right-click context menu for text inputs (Cut/Copy/Paste)
  win.webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) {
      Menu.buildFromTemplate([
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ]).popup()
    }
  })

  if (isDev && devUrl) {
    win.loadURL(devUrl)
  } else if (htmlPath) {
    win.loadFile(htmlPath)
  }

  if (!showImmediately && autoShow) {
    win.once('ready-to-show', () => {
      win.show()
    })
  }

  return win
}

/**
 * Get current effective dark mode state
 */
export function isDarkMode(): boolean {
  return nativeTheme.shouldUseDarkColors
}
