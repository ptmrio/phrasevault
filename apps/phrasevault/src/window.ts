import { BrowserWindow, app, Tray, nativeTheme } from 'electron'
import {
  createMainWindow,
  setupDevMode,
  setupThemeListener,
  createTray as createSharedTray,
  toggleWindow,
  hideToTray as sharedHideToTray,
  showFromTray as sharedShowFromTray,
  shouldShowWindowOnStartup,
  showNotification,
} from '@spqrkapps/shared/main'
import path from 'path'
import { getConfig, setConfig, getBalloonShown, setBalloonShown } from './services/config'
import i18n from './i18n'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isMac = process.platform === 'darwin'

/**
 * Get the app root directory, handling different execution contexts:
 * - Dev mode (electron-forge): __dirname = .vite/build/, go up 2 levels
 * - E2E mode (electron dist/main.cjs): __dirname = dist/, go up 1 level
 * - Packaged: app.getAppPath() = resources path
 */
export function getAppRoot(): string {
  // In dev mode with electron-forge/vite, __dirname is .vite/build/
  // Go up two levels to reach the app root
  if (__dirname.includes('.vite')) {
    return path.join(__dirname, '..', '..')
  }
  // In E2E mode or packaged app, __dirname is dist/, so go up one level
  return path.join(__dirname, '..')
}

/**
 * Icon path helpers
 *
 * Windows icon usage:
 * - Notifications (tray balloon): Use PNG for sharper rendering (ICO extraction is blurry)
 * - BrowserWindow/Taskbar: Use ICO (multi-size, proper Windows integration)
 * - Tray: Use ICO (system tray expects ICO on Windows)
 *
 * macOS icon usage:
 * - All contexts: Use PNG at appropriate size
 */

/** Icon for notifications - PNG for sharp Windows toast rendering */
export function getIconPath(): string {
  return path.join(getAppRoot(), 'assets', 'img', 'icon_256x256.png')
}

/** Icon for BrowserWindow/taskbar - ICO on Windows for proper integration */
export function getAppIconPath(): string {
  return path.join(getAppRoot(), 'assets', 'img', isMac ? 'icon_256x256.png' : 'icon.ico')
}

/** Icon for system tray */
function getTrayIconPath(): string {
  return path.join(getAppRoot(), 'assets', 'img', isMac ? 'tray-icon.png' : 'tray.ico')
}

/**
 * Show background notification - uses tray balloon on Windows, Notification API on macOS
 */
export function showBackgroundNotification(title: string, body: string, trayInstance: Tray | null): void {
  showNotification({ title, body, icon: getIconPath() }, trayInstance)
}

/**
 * Hide window to tray - delegates to shared implementation
 */
export function hideToTray(): void {
  if (mainWindow) {
    sharedHideToTray(mainWindow)
  }
}

/**
 * Show window from tray - delegates to shared implementation
 */
export function showFromTray(): void {
  if (mainWindow) {
    sharedShowFromTray(mainWindow)
  }
}

interface CreateWindowOptions {
  launchedAtLogin?: boolean
}

export function createWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const { launchedAtLogin = false } = options
  const isDark = nativeTheme.shouldUseDarkColors

  mainWindow = createMainWindow({
    width: 800,
    height: 600,
    preloadPath: path.join(__dirname, 'preload.cjs'),
    htmlPath: path.join(getAppRoot(), 'templates', 'index.html'),
    icon: getAppIconPath(),
    backgroundColor: isDark ? '#182029' : '#f2f5fa',
    showImmediately: false,
    autoShow: false, // Custom show logic for showOnStartup
  })

  // Setup shared theme listener so the renderer is notified of system theme changes
  setupThemeListener(mainWindow, {
    ipcChannel: 'theme:changed',
  })

  mainWindow.once('ready-to-show', () => {
    setupDevMode(mainWindow!)

    const isTestMode = process.env.NODE_ENV === 'test'
    const config = getConfig()
    const shouldShow = shouldShowWindowOnStartup({
      launchedAtLogin,
      forceShow: isTestMode || config.showOnStartup === true,
    })

    if (shouldShow) {
      mainWindow!.show()
      // Consume one-shot showOnStartup flag (first install welcome)
      if (!isTestMode && config.showOnStartup === true) {
        setConfig({ showOnStartup: false })
      }
    } else {
      mainWindow!.hide()
      if (isMac && app.dock) {
        app.dock.hide()
      }
      if (tray && !getBalloonShown()) {
        showBackgroundNotification(
          'PhraseVault',
          i18n.t('PhraseVault is running in the background.'),
          tray
        )
        setBalloonShown(true)
      }
    }
  })

  mainWindow.on('close', (event) => {
    if (!global.isQuitting) {
      event.preventDefault()
      hideToTray()
      if (tray && !getBalloonShown()) {
        showBackgroundNotification(
          'PhraseVault',
          i18n.t('PhraseVault is running in the background.'),
          tray
        )
        setBalloonShown(true)
      }
    }
  })

  return mainWindow
}

export function createTray(): Tray {
  if (!mainWindow) {
    throw new Error('createTray called before mainWindow was created')
  }

  const shortcutKey = isMac ? '⌘.' : 'Ctrl+.'

  tray = createSharedTray({
    iconPath: getTrayIconPath(),
    tooltip: i18n.t('PhraseVault is running in the background. Press {{shortcut}} to show/hide.', {
      shortcut: shortcutKey,
    }),
    contextMenu: [
      {
        label: i18n.t('Show/Hide'),
        click: () => {
          if (mainWindow) {
            toggleWindow(mainWindow)
          }
        },
      },
      {
        label: i18n.t('Quit'),
        click: () => {
          global.isQuitting = true
          app.quit()
        },
      },
    ],
    onClick: () => {
      if (mainWindow) {
        toggleWindow(mainWindow)
      }
    },
  }, mainWindow)

  return tray
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getTray(): Tray | null {
  return tray
}
