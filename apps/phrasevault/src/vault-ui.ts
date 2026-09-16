/**
 * Renderer-side vault state and the PIN dialog controller.
 *
 * The renderer decides when to ask for the PIN — it already knows a row's
 * `locked` flag and the session state from `vault:changed`. Main refuses
 * defensively as a second line, but the first line is here.
 *
 * No decrypted body is ever stored in this module. The only plaintext it handles
 * is the PIN itself, which is cleared from every field on close, success and
 * cancel.
 */
import type { VaultBodyResult, VaultErrorCode, VaultResult, VaultStatus } from './types'

const LOCKED_STATUS: VaultStatus = {
  available: false,
  hasPin: false,
  unlocked: false,
  lockedCount: 0,
  timeoutEnabled: true,
  timeoutMinutes: 15,
  kdfSupported: true,
}

export type VaultPinMode = 'setup' | 'unlock' | 'change'

/** Main never sends prose; each code maps to a key here. */
const ERROR_KEYS: Record<VaultErrorCode, string> = {
  'wrong-pin': 'vault_error_wrong_pin',
  'too-short': 'vault_error_too_short',
  throttled: 'vault_error_throttled',
  'unsupported-kdf': 'vault_error_unsupported',
  corrupt: 'vault_error_corrupt',
  unavailable: 'vault_error_unavailable',
  locked: 'vault_locked_toast',
  'no-pin': 'vault_error_unavailable',
  'has-pin': 'vault_error_unavailable',
}

let status: VaultStatus = { ...LOCKED_STATUS }
/**
 * Bumped by every broadcast. An awaited getStatus reply that predates the most
 * recent broadcast is stale and is dropped rather than overwriting fresher news.
 */
let statusRevision = 0

const statusListeners: Array<(next: VaultStatus) => void> = []

export function getVaultStatusSnapshot(): VaultStatus {
  return status
}

export function onVaultStatus(listener: (next: VaultStatus) => void): void {
  statusListeners.push(listener)
}

function publishStatus(next: VaultStatus): void {
  status = next
  for (const listener of statusListeners) listener(next)
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

interface PinElements {
  modal: HTMLElement
  title: HTMLElement
  currentRow: HTMLElement
  current: HTMLInputElement
  newLabel: HTMLElement
  newInput: HTMLInputElement
  confirmRow: HTMLElement
  confirm: HTMLInputElement
  error: HTMLElement
  hint: HTMLElement
  cancel: HTMLButtonElement
  submit: HTMLButtonElement
}

let el: PinElements | null = null
let mode: VaultPinMode = 'unlock'
let settle: ((ok: boolean) => void) | null = null
/** A derive is in flight: the dialog cannot be dismissed and Enter is ignored. */
let busy = false
let throttleUntil = 0
let throttleTimer: ReturnType<typeof setInterval> | null = null
let invoker: HTMLElement | null = null

interface VaultUiDeps {
  t: (key: string, options?: Record<string, unknown>) => string
  showModal: (modal: HTMLElement) => void
  hideModal: (modal: HTMLElement, done?: () => void) => void
  isModalOpen: (modal: HTMLElement) => boolean
  showToast: (message: string, type: 'success' | 'danger' | 'warning' | 'info') => void
  clearToasts: () => void
}

let deps: VaultUiDeps | null = null

function required(): { el: PinElements; deps: VaultUiDeps } {
  if (!el || !deps) throw new Error('vault UI not initialised')
  return { el, deps }
}

export function translateVaultError(code: VaultErrorCode, retryAfterMs?: number): string {
  const { deps: d } = required()
  if (code === 'throttled') {
    const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000))
    return d.t(ERROR_KEYS[code], { seconds })
  }
  return d.t(ERROR_KEYS[code])
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function setError(message: string): void {
  if (!el) return
  el.error.textContent = message
  el.error.hidden = message.length === 0
}

function clearFields(): void {
  if (!el) return
  el.current.value = ''
  el.newInput.value = ''
  el.confirm.value = ''
}

function stopThrottleCountdown(): void {
  if (throttleTimer) {
    clearInterval(throttleTimer)
    throttleTimer = null
  }
}

/** Counts down from a deadline so a slow tick cannot unlock the button early. */
function startThrottleCountdown(retryAfterMs: number): void {
  stopThrottleCountdown()
  throttleUntil = Date.now() + retryAfterMs
  const tick = (): void => {
    const remaining = throttleUntil - Date.now()
    if (remaining <= 0) {
      stopThrottleCountdown()
      throttleUntil = 0
      setError('')
      updateSubmitState()
      return
    }
    setError(translateVaultError('throttled', remaining))
    updateSubmitState()
  }
  tick()
  throttleTimer = setInterval(tick, 250)
}

function isThrottled(): boolean {
  return throttleUntil > Date.now()
}

function updateSubmitState(): void {
  if (!el || !deps) return
  el.submit.disabled = busy || isThrottled()
  const labelKey = busy
    ? 'vault_pin_working'
    : mode === 'setup'
      ? 'vault_pin_submit_setup'
      : mode === 'change'
        ? 'vault_pin_submit_change'
        : 'vault_pin_submit'
  el.submit.textContent = deps.t(labelKey)
}

/**
 * Every idle exit routes through here: Cancel, Escape, the backdrop and a
 * successful submit. The promise settles exactly once and the fields are wiped.
 */
export function closeVaultPinModal(ok: boolean): void {
  if (!el || !deps) return
  if (busy) return // A derive is in flight: not dismissible.
  stopThrottleCountdown()
  throttleUntil = 0
  const done = settle
  settle = null
  clearFields()
  setError('')
  const returnTo = invoker
  invoker = null
  deps.hideModal(el.modal, () => {
    if (returnTo && document.contains(returnTo)) returnTo.focus()
  })
  done?.(ok)
}

export function isVaultPinModalOpen(): boolean {
  return el !== null && deps !== null && deps.isModalOpen(el.modal)
}

/** True while a derive is running, so Escape handlers can refuse to dismiss. */
export function isVaultPinBusy(): boolean {
  return busy
}

export function openVaultPinModal(next: VaultPinMode): Promise<boolean> {
  const { el: e, deps: d } = required()
  if (settle) {
    // Never open over itself; the caller joins the dialog already on screen.
    return new Promise((resolve) => {
      const previous = settle
      settle = (ok) => {
        previous?.(ok)
        resolve(ok)
      }
    })
  }

  mode = next
  invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
  clearFields()
  setError('')

  const isChange = mode === 'change'
  const isUnlock = mode === 'unlock'
  e.currentRow.hidden = !isChange
  e.confirmRow.hidden = isUnlock
  e.hint.hidden = isUnlock

  e.title.textContent = d.t(
    mode === 'setup' ? 'vault_pin_title_setup' : isChange ? 'vault_pin_title_change' : 'vault_pin_title_unlock'
  )
  e.newLabel.textContent = d.t(isUnlock ? 'vault_pin_enter' : 'vault_pin_new')
  e.hint.textContent = d.t('vault_pin_hint_setup')
  updateSubmitState()

  d.showModal(e.modal)
  d.clearToasts()
  setTimeout(() => (isChange ? e.current : e.newInput).focus(), 50)

  return new Promise<boolean>((resolve) => {
    settle = resolve
  })
}

async function submitVaultPin(): Promise<void> {
  const { el: e, deps: d } = required()
  if (busy || isThrottled()) return

  const pin = e.newInput.value
  if (mode !== 'unlock' && pin !== e.confirm.value) {
    setError(d.t('vault_error_mismatch'))
    return
  }

  busy = true
  updateSubmitState()
  setError('')
  try {
    let result: VaultResult
    if (mode === 'setup') {
      result = (await window.api.invoke('vault:setup', { pin })) as VaultResult
    } else if (mode === 'change') {
      result = (await window.api.invoke('vault:changePin', {
        currentPin: e.current.value,
        newPin: pin,
      })) as VaultResult
    } else {
      result = (await window.api.invoke('vault:unlock', { pin })) as VaultResult
    }

    if (result.ok) {
      busy = false
      closeVaultPinModal(true)
      return
    }

    busy = false
    updateSubmitState()
    if (result.error === 'throttled' || typeof result.retryAfterMs === 'number') {
      startThrottleCountdown(result.retryAfterMs ?? 0)
      if (result.error !== 'throttled') setError(translateVaultError(result.error))
      return
    }
    setError(translateVaultError(result.error))
  } catch {
    busy = false
    updateSubmitState()
    setError(d.t('vault_error_unavailable'))
  } finally {
    busy = false
    updateSubmitState()
  }
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

/** Refresh the cached status, dropping a reply that a broadcast has overtaken. */
export async function refreshVaultStatus(): Promise<VaultStatus> {
  const revision = statusRevision
  try {
    const next = (await window.api.invoke('vault:getStatus')) as VaultStatus
    if (revision !== statusRevision) return status
    publishStatus(next)
  } catch {
    /* keep the last known status */
  }
  return status
}

/**
 * Make sure a protected row can be opened. Returns false when the user cancels,
 * in which case the caller must do nothing at all.
 */
export async function ensureVaultUnlocked(): Promise<boolean> {
  await refreshVaultStatus()
  if (!status.available) return false
  if (status.unlocked) return true
  if (!status.hasPin) return openVaultPinModal('setup')
  return openVaultPinModal('unlock')
}

/**
 * Read one body for the composer, unlocking first if the row needs it. Returns
 * null when the user cancelled or the body could not be produced; the caller
 * then opens nothing. The plaintext lives only in the composer textarea.
 */
export async function fetchPhraseBody(id: number, locked: boolean): Promise<string | null> {
  const { deps: d } = required()
  if (locked && !(await ensureVaultUnlocked())) return null
  try {
    const result = (await window.api.invoke('vault:getPhraseBody', { id })) as VaultBodyResult
    if (result.ok) return result.text
    d.showToast(translateVaultError(result.error), 'danger')
    return null
  } catch {
    d.showToast(d.t('vault_error_unavailable'), 'danger')
    return null
  }
}

export function initVaultUi(next: VaultUiDeps): void {
  deps = next
  const modal = document.getElementById('modal-vault-pin')
  if (!modal) return

  el = {
    modal,
    title: document.getElementById('vault-pin-title') as HTMLElement,
    currentRow: document.getElementById('vault-pin-current-row') as HTMLElement,
    current: document.getElementById('vault-pin-current') as HTMLInputElement,
    newLabel: document.getElementById('vault-pin-new-label') as HTMLElement,
    newInput: document.getElementById('vault-pin-new') as HTMLInputElement,
    confirmRow: document.getElementById('vault-pin-confirm-row') as HTMLElement,
    confirm: document.getElementById('vault-pin-confirm') as HTMLInputElement,
    error: document.getElementById('vault-pin-error') as HTMLElement,
    hint: document.getElementById('vault-pin-hint') as HTMLElement,
    cancel: document.getElementById('btn-vault-pin-cancel') as HTMLButtonElement,
    submit: document.getElementById('btn-vault-pin-submit') as HTMLButtonElement,
  }

  el.cancel.addEventListener('click', () => closeVaultPinModal(false))
  el.submit.addEventListener('click', () => void submitVaultPin())

  // Enter submits from any field, but never while throttled or mid-derive.
  for (const input of [el.current, el.newInput, el.confirm]) {
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      void submitVaultPin()
    })
  }

  window.api.removeAllListeners('vault:changed')
  window.api.receive('vault:changed', (payload: unknown) => {
    statusRevision++
    publishStatus(payload as VaultStatus)
  })
  void refreshVaultStatus()
}
