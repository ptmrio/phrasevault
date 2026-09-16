/**
 * Modal system for Electron renderer
 * Stackable modals with backdrop close, transitions, and markdown support
 *
 * Standard HTML pattern:
 * .modal-overlay (backdrop) > .modal (dialog box) with .active class
 */

import { renderIcon } from './icons'

const BASE_INSET_REM = 2 // base inset in rem (increases by 1rem per stacked modal)
let openModals: HTMLElement[] = []

// Escape key handler reference for cleanup
let escapeHandler: ((e: KeyboardEvent) => void) | null = null
let bodyOverflow: string | null = null

const triggerMap = new WeakMap<HTMLElement, HTMLElement | null>()
const keydownMap = new WeakMap<HTMLElement, (e: KeyboardEvent) => void>()

/**
 * Block or release the in-page caption while a modal is open.
 *
 * The attribute drives three things that must move together: CSS `no-drag` on
 * the whole bar (Electron drag regions bypass pointer events, so the backdrop
 * alone is not enough), `inert` so Tab never reaches a caption or any other
 * titlebar button, and the window-controls component's real `disabled`.
 */
function setModalBlocked(blocked: boolean): void {
  const root = document.documentElement
  if (blocked) root.setAttribute('data-modal-open', 'true')
  else root.removeAttribute('data-modal-open')

  document.querySelectorAll<HTMLElement>('.titlebar').forEach((bar) => {
    bar.inert = blocked
  })
}

/**
 * Show a modal with animation
 * Uses .modal-overlay pattern
 */
export function showModal(modal: HTMLElement): void {
  if (!modal) return
  const dialog = getDialogElement(modal)
  ensureDialogA11y(dialog)
  lockBodyScroll()
  const isFirstModal = openModals.length === 0
  if (isFirstModal) setModalBlocked(true)
  // Remove stale hidden attributes if modal was previously marked as background.
  // `inert` must be cleared with them: a modal stacked over an already-open one
  // was marked inert as a background child and could not take focus otherwise.
  modal.removeAttribute('data-modal-hidden')
  modal.removeAttribute('aria-hidden')
  modal.inert = false
  applyStackOffset(modal)
  modal.style.display = 'grid'
  requestAnimationFrame(() => {
    modal.classList.add('active')
  })

  openModals.push(modal)
  setupBackdropClose(modal)
  setupEscapeHandler()
  // Focus management also handles setting aria-hidden AFTER focus moves
  setupFocusManagement(modal, dialog, isFirstModal)
}

/**
 * Hide a modal with animation
 * Uses .modal-overlay pattern
 */
export function hideModal(modal: HTMLElement, onComplete?: () => void): void {
  let completed = false
  const dialog = getDialogElement(modal)

  const completeHide = () => {
    if (completed) return
    completed = true

    modal.style.display = 'none'
    modal.removeEventListener('transitionend', handleTransitionEnd)
    openModals = openModals.filter((m) => m !== modal)

    // Release before focus is restored: an inert ancestor would swallow the
    // restore target. This runs on transitionend (or the 300ms fallback), so
    // the overlay is already off-screen.
    if (openModals.length === 0) setModalBlocked(false)

    teardownFocusManagement(modal, dialog)

    // Remove escape handler if no modals open
    if (openModals.length === 0) {
      removeEscapeHandler()
      setBackgroundHidden(modal, false)
      unlockBodyScroll()
    }

    onComplete?.()
  }

  const handleTransitionEnd = () => {
    if (!modal.classList.contains('active')) {
      completeHide()
    }
  }

  modal.classList.remove('active')

  modal.addEventListener('transitionend', handleTransitionEnd, { once: true })

  // Fallback timeout in case transitionend doesn't fire
  // (e.g., if transitions are disabled or element is not visible)
  setTimeout(() => {
    if (!completed && !modal.classList.contains('active')) {
      completeHide()
    }
  }, 300)
}

/**
 * Hide all open modals
 */
export function hideAllModals(): void {
  ;[...openModals].reverse().forEach((modal) => hideModal(modal))
}

/**
 * Hide the topmost modal
 */
export function hideTopModal(): void {
  if (openModals.length > 0) {
    hideModal(openModals[openModals.length - 1])
  }
}

/**
 * Check if any modal is open
 */
export function hasOpenModals(): boolean {
  return openModals.length > 0
}

/**
 * Get count of open modals
 */
export function getOpenModalCount(): number {
  return openModals.length
}

/**
 * Check if a specific modal is open
 * Supports both .show and .active patterns
 */
export function isModalOpen(modal: HTMLElement): boolean {
  if (modal.style.display !== 'grid') return false
  return modal.classList.contains('active')
}

/**
 * Get the list of currently open modals
 */
export function getOpenModals(): HTMLElement[] {
  return [...openModals]
}

function applyStackOffset(modal: HTMLElement): void {
  const index = openModals.length
  const inset = BASE_INSET_REM + index // 2rem, 3rem, 4rem, etc.
  modal.style.setProperty('--modal-inset', `${inset}rem`)
  // Increment z-index for stacking
  modal.style.zIndex = String(1000 + index)
}

function setupBackdropClose(modal: HTMLElement): void {
  const handler = (e: MouseEvent) => {
    if (e.target === modal) {
      hideModal(modal)
      modal.removeEventListener('click', handler)
    }
  }
  modal.addEventListener('click', handler)
}

function setupEscapeHandler(): void {
  if (escapeHandler) return // Already set up

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && openModals.length > 0) {
      e.preventDefault()
      hideTopModal()
    }
  }
  document.addEventListener('keydown', escapeHandler)
}

function removeEscapeHandler(): void {
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler)
    escapeHandler = null
  }
}

function getDialogElement(modal: HTMLElement): HTMLElement {
  return modal.querySelector('.modal') ?? modal
}

function ensureDialogA11y(dialog: HTMLElement): void {
  if (!dialog.hasAttribute('role')) {
    dialog.setAttribute('role', 'dialog')
  }
  dialog.setAttribute('aria-modal', 'true')
  if (!dialog.hasAttribute('tabindex')) {
    dialog.setAttribute('tabindex', '-1')
  }
  const titleEl = dialog.querySelector<HTMLElement>('.modal-header h1, .modal-header h2, .modal-header h3')
  if (titleEl) {
    if (!titleEl.id) {
      titleEl.id = `modal-title-${Math.random().toString(36).slice(2, 8)}`
    }
    dialog.setAttribute('aria-labelledby', titleEl.id)
  }
}

function setupFocusManagement(modal: HTMLElement, dialog: HTMLElement, isFirstModal: boolean): void {
  const trigger = document.activeElement as HTMLElement | null
  triggerMap.set(modal, trigger)

  const keydownHandler = (e: KeyboardEvent) => trapFocus(dialog, e)
  keydownMap.set(modal, keydownHandler)
  dialog.addEventListener('keydown', keydownHandler)

  requestAnimationFrame(() => {
    const focusables = getFocusableElements(dialog)
    const target = focusables[0] ?? dialog
    target.focus()
    // Set aria-hidden on background AFTER focus moves to modal
    // This prevents the "aria-hidden on focused element" warning
    if (isFirstModal) {
      setBackgroundHidden(modal, true)
    }
  })
}

function teardownFocusManagement(modal: HTMLElement, dialog: HTMLElement): void {
  const keydownHandler = keydownMap.get(modal)
  if (keydownHandler) {
    dialog.removeEventListener('keydown', keydownHandler)
    keydownMap.delete(modal)
  }

  const trigger = triggerMap.get(modal)
  triggerMap.delete(modal)
  if (trigger && document.contains(trigger)) {
    trigger.focus()
  }
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ]
  return Array.from(container.querySelectorAll<HTMLElement>(selectors.join(',')))
}

function trapFocus(dialog: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const focusables = getFocusableElements(dialog)
  if (focusables.length === 0) {
    dialog.focus()
    e.preventDefault()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    last.focus()
    e.preventDefault()
  } else if (!e.shiftKey && active === last) {
    first.focus()
    e.preventDefault()
  }
}

function lockBodyScroll(): void {
  if (openModals.length > 0) return
  bodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll(): void {
  if (openModals.length > 0) return
  if (bodyOverflow !== null) {
    document.body.style.overflow = bodyOverflow
    bodyOverflow = null
  }
}

function setBackgroundHidden(modal: HTMLElement, hidden: boolean): void {
  const bodyChildren = Array.from(document.body.children)
  if (hidden) {
    bodyChildren.forEach((child) => {
      if (child === modal) return
      // Never hide a modal that is itself open: this runs in a rAF, so a second
      // modal opened in the same task as the first is already on the stack.
      if (child instanceof HTMLElement && openModals.includes(child)) return
      if (child.getAttribute('data-modal-hidden') === 'true') return
      child.setAttribute('data-modal-hidden', 'true')
      child.setAttribute('aria-hidden', 'true')
      if (child instanceof HTMLElement) child.inert = true
    })
    return
  }

  bodyChildren.forEach((child) => {
    if (child.getAttribute('data-modal-hidden') === 'true') {
      child.removeAttribute('data-modal-hidden')
      child.removeAttribute('aria-hidden')
      if (child instanceof HTMLElement) child.inert = false
    }
  })
}

/**
 * Create and show a confirmation modal dynamically
 */
export function showConfirmModal(options: {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmClass?: string
  onConfirm: () => void
  onCancel?: () => void
}): HTMLElement {
  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmClass = 'btn-primary',
    onConfirm,
    onCancel,
  } = options

  const modal = document.createElement('div')
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`
  const closeIcon = renderIcon('x', { size: 'sm' })
  modal.className = 'modal-overlay modal-sm'
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-header">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <button class="modal-close" aria-label="Close">${closeIcon}</button>
      </div>
      <div class="modal-body">
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary cancel-btn">${escapeHtml(cancelText)}</button>
        <button class="btn ${confirmClass} confirm-btn">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  const confirmBtn = modal.querySelector('.confirm-btn')!
  const cancelBtn = modal.querySelector('.cancel-btn')!
  const closeBtn = modal.querySelector('.modal-close')!

  const cleanup = () => {
    hideModal(modal, () => modal.remove())
  }

  confirmBtn.addEventListener('click', () => {
    hideModal(modal, () => {
      modal.remove()
      onConfirm()
    })
  })

  cancelBtn.addEventListener('click', () => {
    hideModal(modal, () => {
      modal.remove()
      onCancel?.()
    })
  })

  closeBtn.addEventListener('click', () => {
    cleanup()
    onCancel?.()
  })

  showModal(modal)
  return modal
}

/**
 * Create and show an alert modal dynamically
 */
export function showAlertModal(options: {
  title: string
  message: string
  buttonText?: string
  onClose?: () => void
}): HTMLElement {
  const { title, message, buttonText = 'OK', onClose } = options

  const modal = document.createElement('div')
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`
  const closeIcon = renderIcon('x', { size: 'sm' })
  modal.className = 'modal-overlay modal-sm'
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-header">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <button class="modal-close" aria-label="Close">${closeIcon}</button>
      </div>
      <div class="modal-body">
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary ok-btn">${escapeHtml(buttonText)}</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  const okBtn = modal.querySelector('.ok-btn')!
  const closeBtn = modal.querySelector('.modal-close')!

  const cleanup = () => {
    hideModal(modal, () => {
      modal.remove()
      onClose?.()
    })
  }

  okBtn.addEventListener('click', cleanup)
  closeBtn.addEventListener('click', cleanup)

  showModal(modal)
  return modal
}

/**
 * Create and show an input modal dynamically
 * Returns a promise that resolves with the input value or null if cancelled
 */
export function showInputModal(options: {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  inputType?: 'text' | 'password' | 'email' | 'number'
  confirmText?: string
  cancelText?: string
}): Promise<string | null> {
  return new Promise((resolve) => {
    const {
      title,
      message,
      placeholder = '',
      defaultValue = '',
      inputType = 'text',
      confirmText = 'OK',
      cancelText = 'Cancel',
    } = options

    const modal = document.createElement('div')
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`
    const closeIcon = renderIcon('x', { size: 'sm' })
    modal.className = 'modal-overlay modal-md'
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="modal-header">
          <h2 id="${titleId}">${escapeHtml(title)}</h2>
          <button class="modal-close" aria-label="Close">${closeIcon}</button>
        </div>
        <div class="modal-body">
          ${message ? `<p>${escapeHtml(message)}</p>` : ''}
          <input type="${inputType}" class="input modal-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}" />
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">${escapeHtml(cancelText)}</button>
          <button class="btn btn-primary confirm-btn">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    const input = modal.querySelector('.modal-input') as HTMLInputElement
    const confirmBtn = modal.querySelector('.confirm-btn')!
    const cancelBtn = modal.querySelector('.cancel-btn')!
    const closeBtn = modal.querySelector('.modal-close')!

    const confirm = () => {
      const value = input.value
      hideModal(modal, () => {
        modal.remove()
        resolve(value)
      })
    }

    const cancel = () => {
      hideModal(modal, () => {
        modal.remove()
        resolve(null)
      })
    }

    confirmBtn.addEventListener('click', confirm)
    cancelBtn.addEventListener('click', cancel)
    closeBtn.addEventListener('click', cancel)

    // Enter to confirm, Escape handled globally
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      }
    })

    showModal(modal)

    // Focus input after animation starts
    requestAnimationFrame(() => input.focus())
  })
}

// ============================================================================
// Markdown Modal Support
// ============================================================================

export interface MarkdownModalButton {
  label: string
  className?: string
  onClick?: () => void
  closeModal?: boolean
}

export interface MarkdownModalOptions {
  /** Modal title */
  title: string
  /** Markdown file path (relative to app's configured basePath) */
  file?: string
  /** Raw markdown content to render */
  content?: string
  /** Optional footer buttons */
  buttons?: MarkdownModalButton[]
  /** Size variant */
  size?: 'sm' | 'default' | 'lg' | 'xl'
  /** IPC send function from preload (e.g., window.electron.send) */
  send: (channel: string, data?: unknown) => void
  /** IPC receive function from preload (e.g., window.electron.receive) */
  receive: (channel: string, callback: (data: unknown) => void) => void
  /** Handler for external links (optional, defaults to send shell:openExternal) */
  onExternalLink?: (url: string) => void
}

interface MarkdownContentResponse {
  success: boolean
  html?: string
  error?: string
}

let markdownModal: HTMLElement | null = null
let markdownCleanup: (() => void) | null = null

/**
 * Show a markdown modal with content loaded from file or raw markdown
 */
export function showMarkdownModal(options: MarkdownModalOptions): HTMLElement {
  const {
    title,
    file,
    content,
    buttons = [],
    size = 'default',
    send,
    receive,
    onExternalLink,
  } = options

  // Clean up any existing markdown modal
  if (markdownModal) {
    hideMarkdownModal()
  }

  const sizeClass = size === 'default' ? '' : `modal-${size}`
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`
  const closeIcon = renderIcon('x', { size: 'sm' })

  markdownModal = document.createElement('div')
  markdownModal.className = `modal-overlay modal-scrollable ${sizeClass}`.trim()
  markdownModal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-header">
        <h2 id="${titleId}">${escapeHtml(title)}</h2>
        <button class="modal-close" aria-label="Close">${closeIcon}</button>
      </div>
      <div class="modal-body markdown-content">
        <p class="loading">Loading...</p>
      </div>
      <div class="modal-footer" style="display: ${buttons.length > 0 ? 'flex' : 'none'}"></div>
    </div>
  `

  const bodyEl = markdownModal.querySelector('.modal-body')!
  const footerEl = markdownModal.querySelector('.modal-footer')!
  const closeBtn = markdownModal.querySelector('.modal-close')!

  // Set up footer buttons
  buttons.forEach((btn) => {
    const button = document.createElement('button')
    button.className = btn.className || 'btn btn-secondary'
    button.textContent = btn.label
    button.addEventListener('click', () => {
      btn.onClick?.()
      if (btn.closeModal !== false) {
        hideMarkdownModal()
      }
    })
    footerEl.appendChild(button)
  })

  closeBtn.addEventListener('click', () => hideMarkdownModal())

  document.body.appendChild(markdownModal)

  // Set up IPC listener for content
  const handleContent = (data: unknown) => {
    const response = data as MarkdownContentResponse
    if (response.success && response.html) {
      bodyEl.innerHTML = response.html

      // Handle external links
      bodyEl.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault()
          const href = link.getAttribute('href')
          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            if (onExternalLink) {
              onExternalLink(href)
            } else {
              send('shell:openExternal', href)
            }
          }
        })
      })
    } else {
      bodyEl.innerHTML = `<p class="error">${escapeHtml(response.error || 'Failed to load content')}</p>`
    }
  }

  receive('markdown:content', handleContent)

  // Store cleanup function
  markdownCleanup = () => {
    // Note: receive typically adds a listener, apps should handle cleanup
    // This is a best-effort cleanup
  }

  // Request content
  if (file) {
    send('markdown:readFile', file)
  } else if (content) {
    send('markdown:render', content)
  }

  showModal(markdownModal)
  return markdownModal
}

/**
 * Hide the markdown modal
 */
export function hideMarkdownModal(onComplete?: () => void): void {
  if (markdownModal) {
    hideModal(markdownModal, () => {
      markdownModal?.remove()
      markdownModal = null
      markdownCleanup?.()
      markdownCleanup = null
      onComplete?.()
    })
  } else {
    onComplete?.()
  }
}

/**
 * Check if markdown modal is open
 */
export function isMarkdownModalOpen(): boolean {
  return markdownModal !== null && isModalOpen(markdownModal)
}

// ============================================================================
// Utility Functions
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Initialize close button handlers for pre-existing modals in HTML
 * Call this after DOM is ready for modals defined in HTML templates
 */
export function initModalCloseButtons(): void {
  document.querySelectorAll('.modal .modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay') as HTMLElement
      if (modal) {
        hideModal(modal)
      }
    })
  })
}
