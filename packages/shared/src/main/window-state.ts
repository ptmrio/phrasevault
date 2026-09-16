/**
 * Window state persistence
 * Saves and restores window position, size, and maximized state
 */
import { BrowserWindow, screen } from 'electron'
import { JsonStore } from './json-store'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

interface WindowStateStore {
  windowState: WindowState
  [key: string]: unknown
}

/**
 * Create a window state manager for an app
 */
export function createWindowStateManager(
  storeName: string,
  defaults: Omit<WindowState, 'isMaximized'> & { isMaximized?: boolean }
) {
  const defaultState: WindowState = {
    width: defaults.width,
    height: defaults.height,
    x: defaults.x,
    y: defaults.y,
    isMaximized: defaults.isMaximized ?? false,
  }

  const store = new JsonStore<WindowStateStore>({
    name: `${storeName}-window-state`,
    defaults: { windowState: defaultState },
  })

  function get(): WindowState {
    const state = store.get('windowState')
    return validateState(state)
  }

  function save(win: BrowserWindow): void {
    if (win.isDestroyed()) return

    if (!win.isMaximized() && !win.isMinimized()) {
      const bounds = win.getBounds()
      store.set('windowState', {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: false,
      })
    } else if (win.isMaximized()) {
      const current = store.get('windowState')
      store.set('windowState', {
        ...current,
        isMaximized: true,
      })
    }
  }

  function attach(win: BrowserWindow): () => void {
    const saveHandler = () => save(win)

    win.on('resize', saveHandler)
    win.on('move', saveHandler)
    win.on('close', saveHandler)

    // Return cleanup function
    return () => {
      win.off('resize', saveHandler)
      win.off('move', saveHandler)
      win.off('close', saveHandler)
    }
  }

  function applyTo(win: BrowserWindow): void {
    const state = get()

    if (state.isMaximized) {
      win.maximize()
    } else {
      win.setBounds({
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
      })
    }
  }

  function validateState(state: WindowState): WindowState {
    // Ensure window is visible on at least one display
    const displays = screen.getAllDisplays()
    const isVisible = displays.some((display) => {
      const { x, y, width, height } = display.bounds
      const windowX = state.x ?? 0
      const windowY = state.y ?? 0
      return (
        windowX >= x &&
        windowX < x + width &&
        windowY >= y &&
        windowY < y + height
      )
    })

    if (!isVisible && state.x !== undefined && state.y !== undefined) {
      // Reset position if window would be off-screen
      return {
        ...state,
        x: undefined,
        y: undefined,
      }
    }

    return state
  }

  return {
    get,
    save,
    attach,
    applyTo,
  }
}

export type WindowStateManager = ReturnType<typeof createWindowStateManager>
