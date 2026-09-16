/**
 * System notifications
 * Cross-platform notification support with Windows tray balloon fallback
 */
import { Notification, Tray, BrowserWindow } from 'electron'

const isWindows = process.platform === 'win32'

export interface NotificationOptions {
  title: string
  body: string
  icon?: string
  silent?: boolean
  onClick?: () => void
}

/**
 * Show a system notification
 * On Windows with tray, uses tray balloon; otherwise uses Notification API
 */
export function showNotification(
  options: NotificationOptions,
  tray?: Tray | null,
  mainWindow?: BrowserWindow
): Notification | void {
  const { title, body, icon, silent = true, onClick } = options

  // Windows: prefer tray balloon for background notifications
  if (isWindows && tray) {
    tray.displayBalloon({
      icon: icon || undefined,
      title,
      content: body,
    })

    if (onClick) {
      tray.once('balloon-click', () => {
        onClick()
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      })
    }
    return
  }

  // Other platforms: use Notification API
  if (!Notification.isSupported()) {
    return
  }

  const notification = new Notification({
    title,
    body,
    icon,
    silent,
  })

  if (onClick) {
    notification.on('click', () => {
      onClick()
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  }

  notification.show()
  return notification
}

/**
 * Check if app should show notification (window not focused)
 */
export function shouldNotify(mainWindow: BrowserWindow): boolean {
  return !mainWindow.isFocused()
}
