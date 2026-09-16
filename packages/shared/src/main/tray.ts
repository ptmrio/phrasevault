/**
 * System tray management
 * Handles tray icon, context menu, and dock visibility (macOS)
 *
 * Platform behavior:
 * - Windows: Left-click fires 'click' event (toggle window). Right-click shows context menu.
 * - macOS: setContextMenu() hijacks ALL clicks to show the menu, so we use
 *   popUpContextMenu() on right-click only, keeping left-click for toggle.
 */
import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

const isMac = process.platform === 'darwin'

/**
 * Store context menu per tray for macOS popUpContextMenu usage.
 * On macOS we don't use setContextMenu (it hijacks left-click),
 * so we track the menu here and show it on right-click only.
 */
const trayMenuMap = new WeakMap<Tray, Menu>()

export interface TrayOptions {
  /** Path to tray icon */
  iconPath: string
  /** Tooltip text */
  tooltip: string
  /** Context menu items */
  contextMenu?: MenuItemConstructorOptions[]
  /** Click handler (default: toggle window visibility) */
  onClick?: (win: BrowserWindow) => void
}

/**
 * Create a system tray with click-to-toggle behavior
 *
 * Cross-platform behavior:
 * - Left-click: Runs onClick handler (or toggleWindow by default)
 * - Right-click: Shows context menu
 */
export function createTray(
  options: TrayOptions,
  mainWindow: BrowserWindow
): Tray {
  const icon = nativeImage.createFromPath(options.iconPath)
  const tray = new Tray(icon.resize({ width: 16, height: 16 }))

  tray.setToolTip(options.tooltip)

  if (options.contextMenu) {
    const menu = Menu.buildFromTemplate(options.contextMenu)
    if (isMac) {
      // macOS: Store menu for right-click popup instead of setContextMenu
      trayMenuMap.set(tray, menu)
      tray.on('right-click', () => {
        const currentMenu = trayMenuMap.get(tray)
        if (currentMenu) tray.popUpContextMenu(currentMenu)
      })
    } else {
      tray.setContextMenu(menu)
    }
  }

  tray.on('click', () => {
    if (options.onClick) {
      options.onClick(mainWindow)
    } else {
      toggleWindow(mainWindow)
    }
  })

  return tray
}

/**
 * Toggle window visibility (with dock on macOS)
 */
export async function toggleWindow(win: BrowserWindow): Promise<void> {
  if (win.isVisible()) {
    hideToTray(win)
  } else {
    await showFromTray(win)
  }
}

/**
 * Hide window to tray (also hides dock icon on macOS)
 */
export function hideToTray(win: BrowserWindow): void {
  win.hide()
  if (isMac && app.dock) {
    app.dock.hide()
  }
}

/**
 * Show window from tray (also shows dock icon on macOS)
 */
export async function showFromTray(win: BrowserWindow): Promise<void> {
  if (isMac && app.dock) {
    await app.dock.show()
  }
  win.show()
  win.focus()
}

/**
 * Update tray tooltip
 */
export function updateTrayTooltip(tray: Tray, tooltip: string): void {
  tray.setToolTip(tooltip)
}

/**
 * Update tray context menu
 */
export function updateTrayMenu(
  tray: Tray,
  items: MenuItemConstructorOptions[]
): void {
  const menu = Menu.buildFromTemplate(items)
  if (isMac) {
    trayMenuMap.set(tray, menu)
  } else {
    tray.setContextMenu(menu)
  }
}
