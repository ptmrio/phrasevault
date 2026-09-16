/**
 * Toast notification system for Electron renderer
 * Stacking toasts with auto-dismiss and undo support
 */

export type ToastType = 'success' | 'danger' | 'warning' | 'info'

export type ToastPosition =
  | 'top-right' | 'top-center' | 'top-left'
  | 'bottom-right' | 'bottom-center' | 'bottom-left'
  | 'center'

export type EntryDirection = 'left' | 'right' | 'top' | 'bottom' | 'fade'

export type StackDirection = 'down' | 'up'

export interface ToastOptions {
  message: string
  type?: ToastType
  /** Duration in ms (default: 3000, or 8000 with undo) */
  duration?: number
  /** Position (default: 'bottom-right' or global config) */
  position?: ToastPosition
  /** Entry animation direction (auto-detected from position if not specified) */
  entryDirection?: EntryDirection
  /** Stack direction for multiple toasts (default: 'down' or auto based on position) */
  stackDirection?: StackDirection
  /** Undo callback - shows undo button if provided */
  onUndo?: () => void
  /** Undo button text (default: 'Undo') - pass translated string for i18n */
  undoText?: string
}

export interface ToastConfig {
  position?: ToastPosition
  entryDirection?: EntryDirection
  stackDirection?: StackDirection
  duration?: number
}

export interface ToastResult {
  /** Dismiss the toast programmatically */
  dismiss: () => void
}

const DEFAULT_DURATION = 3000
const UNDO_DURATION = 8000

let toastContainer: HTMLElement | null = null
let currentPosition: string | null = null
let currentStackDirection: StackDirection | null = null

// Global configuration (set via configureToasts)
let globalConfig: ToastConfig = {}

/**
 * Configure global toast defaults
 * Call once at app startup to set defaults for all toasts
 */
export function configureToasts(config: ToastConfig): void {
  globalConfig = { ...config }
  // Reset container to apply new defaults on next toast
  if (toastContainer) {
    toastContainer.remove()
    toastContainer = null
    currentPosition = null
    currentStackDirection = null
  }
}

/**
 * Get smart defaults based on position
 */
function getDefaults(position: ToastPosition): { entry: EntryDirection; stack: StackDirection } {
  switch (position) {
    case 'top-right':
    case 'bottom-right':
      return { entry: 'right', stack: 'down' }
    case 'top-left':
    case 'bottom-left':
      return { entry: 'left', stack: 'down' }
    case 'top-center':
      return { entry: 'top', stack: 'down' }
    case 'bottom-center':
      return { entry: 'bottom', stack: 'up' }
    case 'center':
      return { entry: 'fade', stack: 'down' }
    default:
      return { entry: 'right', stack: 'down' }
  }
}

function ensureContainer(position: ToastPosition, stackDirection: StackDirection): HTMLElement {
  if (toastContainer && currentPosition === position && currentStackDirection === stackDirection) {
    return toastContainer
  }

  // Remove existing container if position or stack direction changed
  if (toastContainer) {
    toastContainer.remove()
  }

  toastContainer = document.createElement('div')
  let className = `toast-container toast-${position}`
  if (stackDirection === 'up') {
    className += ' toast-stack-up'
  }
  toastContainer.className = className
  currentPosition = position
  currentStackDirection = stackDirection
  document.body.appendChild(toastContainer)

  return toastContainer
}

/**
 * Show a toast notification
 */
export function showToast(options: ToastOptions): ToastResult {
  // Merge global config with per-call options (per-call takes precedence)
  const position = options.position ?? globalConfig.position ?? 'bottom-right'
  const defaults = getDefaults(position)

  const {
    message,
    type = 'info',
    onUndo,
    undoText = 'Undo',
    duration = options.duration ?? globalConfig.duration ?? (onUndo ? UNDO_DURATION : DEFAULT_DURATION),
    entryDirection = options.entryDirection ?? globalConfig.entryDirection ?? defaults.entry,
    stackDirection = options.stackDirection ?? globalConfig.stackDirection ?? defaults.stack,
  } = options

  const container = ensureContainer(position, stackDirection)

  const toast = document.createElement('div')
  toast.className = `toast toast-${type} toast-entry-${entryDirection}`

  const textSpan = document.createElement('span')
  textSpan.className = 'toast-message'
  textSpan.textContent = message
  toast.appendChild(textSpan)

  let undoClicked = false
  let timeoutId: ReturnType<typeof setTimeout>

  function dismiss(): void {
    clearTimeout(timeoutId)
    toast.classList.remove('show')
    toast.classList.add('hiding')

    toast.addEventListener(
      'transitionend',
      () => {
        toast.remove()
        // Remove container if empty
        if (container.children.length === 0) {
          container.remove()
          toastContainer = null
          currentPosition = null
        }
      },
      { once: true }
    )
  }

  // Add undo button if callback provided
  if (onUndo) {
    const undoBtn = document.createElement('button')
    undoBtn.className = 'toast-undo'
    undoBtn.textContent = undoText
    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      undoClicked = true
      onUndo()
      dismiss()
    })
    toast.appendChild(undoBtn)
  }

  container.appendChild(toast)

  // Trigger show animation
  requestAnimationFrame(() => {
    toast.classList.add('show')
  })

  // Auto-dismiss
  timeoutId = setTimeout(() => {
    if (!undoClicked) {
      dismiss()
    }
  }, duration)

  return { dismiss }
}

/**
 * Clear all toasts
 */
export function clearAllToasts(): void {
  if (toastContainer) {
    toastContainer.querySelectorAll('.toast').forEach((t) => t.remove())
    toastContainer.remove()
    toastContainer = null
    currentPosition = null
    currentStackDirection = null
  }
}

/**
 * Convenience methods for typed toasts
 */
export const toast = {
  success: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
    showToast({ ...options, message, type: 'success' }),

  error: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
    showToast({ ...options, message, type: 'danger' }),

  warning: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
    showToast({ ...options, message, type: 'warning' }),

  info: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
    showToast({ ...options, message, type: 'info' }),
}
