/**
 * Modal management module for PhraseVault renderer
 * Handles Settings Modal, Markdown Modal, Phrase Modal, Dynamic Prompt Modal, and Toast Notifications
 *
 * Uses @spqrkapps/shared/renderer for base modal/toast functionality
 */

import type { PhraseType, PhraseFormOptions, PhraseRow, DynamicPromptData, Placeholder, ImportAnalysis, ImportConfirmation } from './types'
import {
  closeVaultPinModal,
  ensureVaultUnlocked,
  fetchPhraseBody,
  getVaultStatusSnapshot,
  initVaultUi,
  isVaultPinBusy,
  isVaultPinModalOpen,
  onVaultStatus,
  openVaultPinModal,
  refreshVaultStatus,
  translateVaultError,
} from './vault-ui'
import {
  showModal,
  hideModal,
  hasOpenModals,
  hideTopModal as sharedHideTopModal,
  getOpenModals,
  isModalOpen,
  showToast as sharedShowToast,
  clearAllToasts,
  configureToasts,
} from '@spqrkapps/shared/renderer'

// Configure toasts for PhraseVault: centered at bottom, stacking upward
configureToasts({
  position: 'bottom-center',
  // entryDirection and stackDirection will auto-default based on position
})

/**
 * Translation helper - wraps IPC call for convenience
 */
function t(key: string, options?: Record<string, unknown>): string {
  return window.api.sendSync<string>('i18n:translate-sync', key, options) ?? key
}

// =============================================================================
// Types
// =============================================================================

interface ToastOptions {
  onUndo?: () => void
  undoText?: string
  duration?: number
}

interface ToastResult {
  dismiss: () => void
}

interface MarkdownModalButton {
  label: string
  className?: string
  onClick?: () => void
  closeModal?: boolean
}

interface MarkdownModalOptions {
  title: string
  file?: string
  content?: string
  buttons?: MarkdownModalButton[]
}

interface ModalsInit {
  /** Renderer-owned preference discard, run for every Settings dismissal. */
  onSettingsDismiss?: () => void
  /** False only while a submitted Save can already persist. */
  canDismissSettings?: () => boolean
  /**
   * Lazy view of the renderer's database lifecycle for the phrase picker. It is
   * stored during init and read only on fetch/apply/insert, because the
   * renderer's own locals do not exist yet while init runs.
   */
  getPhrasePickerContext?: () => PhrasePickerContext
}

interface PhrasePickerContext {
  generation: number
  available: boolean
  excludedIds: readonly string[]
}

/** UTF-16 offsets of the composer's saved textarea selection. */
interface ComposerRange {
  start: number
  end: number
  direction: 'forward' | 'backward' | 'none'
}

/** One deliberate shelf activation deferred until a composition settles. */
interface QueuedInsert {
  token: string
  relativeRange?: readonly [number, number]
  session: number
  secondary: boolean
}

interface MarkdownContentResponse {
  success: boolean
  html?: string
  error?: string
}

interface SelectPlaceholder extends Placeholder {
  options?: {
    choices: Array<{ value: string; default?: boolean }>
    default?: string
  }
}

// =============================================================================
// Module State
// =============================================================================

let settingsModal: HTMLElement
let markdownModal: HTMLElement
let markdownClose: HTMLElement
let markdownTitle: HTMLElement
let markdownContent: HTMLElement
let markdownFooter: HTMLElement
let phraseModal: HTMLElement
let phraseModalClose: HTMLElement

let onSettingsDismiss: (() => void) | undefined
let canDismissSettings: (() => boolean) | undefined
let settingsClosing = false

// --- Composer shelf, disclosure and picker ----------------------------------
let expandedTextInput: HTMLTextAreaElement
let phraseInsertShelf: HTMLElement
let phraseInsertMore: HTMLButtonElement
let phraseInsertMorePanel: HTMLElement
let phrasePicker: HTMLSelectElement
let phrasePickerRetry: HTMLButtonElement
let phrasePickerStatus: HTMLElement

let getPhrasePickerContext: (() => PhrasePickerContext) | undefined

/**
 * One form lifetime. Every fresh open and every actual close advances it, so a
 * scheduled focus, a deferred IME insert or a late picker reply belonging to an
 * older form can never touch the current draft.
 */
let phraseFormSession = 0
/** Set across the shared hide transition so no work runs against a dying form. */
let phraseClosing = false
let composerRange: ComposerRange = { start: 0, end: 0, direction: 'none' }
let composerComposing = false
let queuedInsert: QueuedInsert | null = null

let pickerVersion = 0
/** Row ID to validated, lowercased short ID. The option value is never trusted. */
const pickerShortIds = new Map<string, string>()
/** The database generation those short IDs were validated against, if any. */
let pickerGeneration: number | null = null
let pickerStatusKey = ''
let pickerRefreshScheduled = false
/**
 * One Escape is handed to the focused select for its own interaction; the next
 * one, if the select still holds focus, belongs to the disclosure. The native
 * popup is not observable from the DOM, so this is a one-shot, not a detection.
 */
let pickerEscapeArmed = false
/**
 * A closed native select changes its selection and dispatches `change` inside
 * the same task as the keydown, so browsing would insert and snap back, leaving
 * every row but the first unreachable without opening the popup. The native
 * popup is not observable from the DOM, so - like pickerEscapeArmed - this is a
 * one-shot cleared on the next task, not a detection.
 */
let pickerBrowsing = false

/** Keys that move a closed select's selection without opening its popup. */
const PICKER_BROWSE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
])

let settingsTrigger: HTMLElement | null = null
let saveButtonController: AbortController | null = null

// Dynamic prompt modal elements
let dynamicModal: HTMLElement | null = null
let dynamicModalClose: HTMLElement | null = null
let dynamicModalTitle: HTMLElement | null = null
let dynamicModalForm: HTMLElement | null = null
let dynamicModalSubmit: HTMLElement | null = null
let dynamicModalCancel: HTMLElement | null = null
let currentDynamicData: DynamicPromptData | null = null
let isCopyOperation = false

// Purchase reminder and legacy migration modals
let purchaseReminderModal: HTMLElement | null = null
let legacyMigrationModal: HTMLElement | null = null

// Import preview modal
let importPreviewModal: HTMLElement | null = null
let currentImportAnalysis: ImportAnalysis | null = null

// =============================================================================
// Constants
// =============================================================================

const TOAST_DURATION_DEFAULT = 2500
const TOAST_DURATION_UNDO = 8000

// =============================================================================
// Modal Utilities - Using @spqrkapps/shared/renderer
// =============================================================================
// showModal, hideModal, hasOpenModals, hideTopModal, isModalOpen imported from shared

// =============================================================================
// Toast Notifications - Using @spqrkapps/shared/renderer
// =============================================================================

function showToast(
  message: string,
  type: 'success' | 'danger' | 'warning' | 'info' = 'success',
  options: ToastOptions | (() => void) = {}
): ToastResult {
  // Handle legacy signature: showToast(message, type, undoCallback)
  if (typeof options === 'function') {
    options = { onUndo: options }
  }

  const { onUndo, undoText, duration } = options
  const toastDuration = duration ?? (onUndo ? TOAST_DURATION_UNDO : TOAST_DURATION_DEFAULT)

  // Use shared toast with adapted options
  const result = sharedShowToast({
    message,
    type,
    duration: toastDuration,
    onUndo,
    undoText,
  })

  return { dismiss: result.dismiss }
}

// =============================================================================
// Settings Modal
// =============================================================================

function openSettingsModal(): void {
  // Repeated entry is a no-op, including during the opening/closing transition,
  // so an unsaved draft is never re-initialised behind the user.
  if (settingsClosing || getOpenModals().includes(settingsModal)) return
  // Shared hideModal restores this control itself; it is captured here only so a
  // control that disappeared while Settings was open has a local fallback.
  settingsTrigger = document.activeElement as HTMLElement | null
  showModal(settingsModal)

  // Request fresh settings data
  window.api.send('config:get')
  window.api.send('database:getRecent')
}

/**
 * Every Settings dismissal routes through this policy so Escape and backdrop
 * discard the preference draft exactly like Cancel, and a committing Save
 * cannot be interrupted. Shared show/hide still owns stacking and focus.
 */
function closeSettingsModal(reason: 'discard' | 'save' = 'discard'): void {
  if (settingsClosing || !getOpenModals().includes(settingsModal)) return
  if (reason === 'discard' && canDismissSettings && !canDismissSettings()) return
  settingsClosing = true
  if (reason === 'discard') onSettingsDismiss?.()
  const trigger = settingsTrigger
  settingsTrigger = null
  hideModal(settingsModal, () => {
    settingsClosing = false
    // Shared restoration already ran. Only a control that left the document
    // needs the app-local fallback, and never over a newly opened modal.
    if (trigger && !trigger.isConnected && !getOpenModals().length) {
      document.getElementById('search')?.focus()
    }
  })
}

/**
 * Settings needs its discard policy and the composer needs its session cleanup;
 * every other modal keeps shared behaviour.
 */
function hideTopModal(): void {
  const top = getOpenModals().at(-1)
  if (top === settingsModal) closeSettingsModal()
  else if (top === phraseModal) closePhraseModal()
  else sharedHideTopModal()
}

function isSettingsModalOpen(): boolean {
  return isModalOpen(settingsModal)
}

// =============================================================================
// Markdown Modal
// =============================================================================

function openMarkdownModal(options: MarkdownModalOptions): void {
  const { title, file, content, buttons = [] } = options

  // Guard against being called before init()
  if (!markdownModal || !markdownContent) {
    console.error('openMarkdownModal called before init()')
    return
  }

  markdownTitle.textContent = title
  markdownContent.innerHTML = '<p class="loading">' + t('Loading...') + '</p>'

  // Set up footer with buttons (default Close button or custom buttons)
  if (buttons.length > 0) {
    // Custom buttons provided - replace footer content
    markdownFooter.innerHTML = ''
    buttons.forEach((btn) => {
      const button = document.createElement('button')
      button.className = btn.className || 'btn btn-secondary'
      button.textContent = btn.label
      button.addEventListener('click', () => {
        if (btn.onClick) btn.onClick()
        if (btn.closeModal !== false) closeMarkdownModal()
      })
      markdownFooter.appendChild(button)
    })
  } else {
    // No custom buttons - restore default Close button
    markdownFooter.innerHTML = '<button id="btn-markdown-ok" class="btn btn-secondary">Close</button>'
    markdownFooter.querySelector('#btn-markdown-ok')?.addEventListener('click', closeMarkdownModal)
  }

  showModal(markdownModal)

  // Load content from file or render raw markdown
  if (file) {
    window.api.send('markdown:readFile', file)
  } else if (content) {
    window.api.send('markdown:render', content)
  }
}

function closeMarkdownModal(): void {
  hideModal(markdownModal, () => {
    markdownContent.innerHTML = ''
  })
}

function isMarkdownModalOpen(): boolean {
  return isModalOpen(markdownModal)
}

// =============================================================================
// Phrase Modal
// =============================================================================

function openPhraseModal(): void {
  showModal(phraseModal)
}

/**
 * The single app-local composer teardown. Every actual close routes here, so the
 * form session, a deferred IME insert and any in-flight picker read are
 * invalidated synchronously, before the shared hide animation completes.
 */
function closePhraseModal(): void {
  if (phraseClosing || !getOpenModals().includes(phraseModal)) return
  phraseClosing = true
  invalidateComposerSession()
  hideModal(phraseModal, () => {
    phraseClosing = false
  })
}

let phraseFormFocusVersion = 0
/** Whether the row currently in the composer was protected when it opened. */
let composerOpenedLocked = false

function isPhraseModalOpen(): boolean {
  return isModalOpen(phraseModal)
}

// =============================================================================
// Composer: saved selection, one native edit per activation, More and picker
//
// The textarea stays the source of truth. The shelf performs exactly one native
// editing transaction per deliberate activation so a single Ctrl/Cmd+Z undoes
// one insert and nothing else; there is no app-maintained undo stack, token
// mirror or second document model.
// =============================================================================

/**
 * Literal parser text only. Date/clipboard values are never evaluated here, and
 * the sample words Label/Tone/Formal/Casual are fixed in every locale so that
 * localized punctuation cannot alter the grammar.
 */
const INSERT_TOKENS: Record<string, { token: string; range?: readonly [number, number] }> = {
  date: { token: '{{date}}' },
  time: { token: '{{time}}' },
  clipboard: { token: '{{clipboard}}' },
  field: { token: '{{input:Label}}', range: [8, 13] },
  choice: { token: '{{select:Tone=Formal,*Casual}}', range: [14, 28] },
  datetime: { token: '{{datetime}}' },
  weekday: { token: '{{weekday}}' },
  month: { token: '{{month}}' },
  year: { token: '{{year}}' },
  textarea: { token: '{{textarea:Label}}', range: [11, 16] },
}

/** Chips that live inside the disclosure; closing More cancels their queued work. */
const SECONDARY_INSERTS = new Set(['datetime', 'weekday', 'month', 'year', 'textarea'])

const SHORT_ID_PATTERN = /^[a-z0-9]{7}$/i

function captureComposerRange(): void {
  const direction = expandedTextInput.selectionDirection
  composerRange = {
    start: expandedTextInput.selectionStart,
    end: expandedTextInput.selectionEnd,
    direction: direction === 'backward' || direction === 'forward' ? direction : 'none',
  }
}

/** True only while this composer is the topmost, settled, open modal. */
function composerOwnsInput(): boolean {
  return !phraseClosing && isPhraseModalOpen() && getOpenModals().at(-1) === phraseModal
}

/**
 * One deliberate activation. A refused or partial native command leaves the
 * draft and its history untouched and warns; there is deliberately no value or
 * setRangeText fallback, because that would destroy undo.
 */
function performComposerInsert(token: string, relativeRange?: readonly [number, number]): void {
  const before = expandedTextInput.value
  const start = Math.min(composerRange.start, before.length)
  const end = Math.max(start, Math.min(composerRange.end, before.length))
  expandedTextInput.focus({ preventScroll: true })
  expandedTextInput.setSelectionRange(start, end, composerRange.direction)
  const expected = before.slice(0, start) + token + before.slice(end)
  const accepted = document.execCommand('insertText', false, token)
  if (!accepted || expandedTextInput.value !== expected) {
    expandedTextInput.setSelectionRange(start, end, composerRange.direction)
    captureComposerRange()
    showToast(t('composer_insert_failed'), 'danger')
    return
  }
  const [from, to] = relativeRange ?? [token.length, token.length]
  expandedTextInput.setSelectionRange(start + from, start + to)
  captureComposerRange()
}

/**
 * While an IME composition is live nothing may move focus, selection or text.
 * At most one token is queued per form; further activations are ignored until it
 * settles or a boundary cancels it.
 */
function requestComposerInsert(
  token: string, relativeRange: readonly [number, number] | undefined, secondary: boolean
): void {
  if (!composerOwnsInput()) return
  if (composerComposing) {
    if (queuedInsert) return
    queuedInsert = { token, relativeRange, session: phraseFormSession, secondary }
    return
  }
  performComposerInsert(token, relativeRange)
}

function flushQueuedInsert(): void {
  const pending = queuedInsert
  if (!pending) return
  // Let the composition's own final input event update the committed value and
  // range first, then edit on the next rendering turn under a session check.
  requestAnimationFrame(() => {
    if (queuedInsert !== pending) return
    queuedInsert = null
    if (pending.session !== phraseFormSession || composerComposing || !composerOwnsInput()) return
    captureComposerRange()
    performComposerInsert(pending.token, pending.relativeRange)
  })
}

// --- More disclosure --------------------------------------------------------

function isMoreOpen(): boolean {
  return !phraseInsertMorePanel.hidden
}

function openMore(): void {
  if (isMoreOpen()) return
  phraseInsertMorePanel.hidden = false
  phraseInsertMore.setAttribute('aria-expanded', 'true')
  // Every opening is one fresh read; there is no picker cache.
  fetchPhrasePicker()
}

/** Closing cancels the picker request and any queued secondary insert. */
function closeMore(returnFocus: boolean): void {
  const wasOpen = isMoreOpen()
  phraseInsertMorePanel.hidden = true
  phraseInsertMore.setAttribute('aria-expanded', 'false')
  if (wasOpen && queuedInsert?.secondary) queuedInsert = null
  pickerEscapeArmed = false
  resetPickerControls()
  if (wasOpen && returnFocus) phraseInsertMore.focus()
}

// --- Form lifetime ----------------------------------------------------------

function invalidateComposerSession(): void {
  phraseFormSession++
  phraseFormFocusVersion++
  queuedInsert = null
  composerComposing = false
  closeMore(false)
}

// --- Phrase picker ----------------------------------------------------------

function setPickerStatus(key: string): void {
  pickerStatusKey = key
  phrasePickerStatus.textContent = key ? t(key) : ''
}

/** Placeholder-only state: nothing eligible is selected and Insert is refused. */
function resetPickerControls(): void {
  pickerVersion++
  pickerShortIds.clear()
  pickerGeneration = null
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.disabled = true
  placeholder.selected = true
  placeholder.textContent = t('composer_phrase_choose')
  phrasePicker.replaceChildren(placeholder)
  phrasePicker.value = ''
  phrasePicker.disabled = true
  phrasePickerRetry.hidden = true
  setPickerStatus('')
}

function fetchPhrasePicker(): void {
  if (!composerOwnsInput() || !isMoreOpen()) return
  resetPickerControls()
  const context = getPhrasePickerContext?.()
  if (!context || !context.available) {
    // An unavailable database issues no read at all.
    setPickerStatus('composer_phrase_unavailable')
    return
  }
  const version = pickerVersion
  const session = phraseFormSession
  const generation = context.generation
  setPickerStatus('composer_phrase_loading')
  window.api
    .invoke<PhraseRow[]>('phrases:search', '')
    .then((rows) => applyPickerRows(rows, version, session, generation))
    .catch(() => failPicker(version, session))
}

/** A reply may only be applied to the form, request and generation that asked. */
function pickerReplyIsCurrent(version: number, session: number): boolean {
  return version === pickerVersion && session === phraseFormSession
    && composerOwnsInput() && isMoreOpen()
}

function applyPickerRows(
  rows: PhraseRow[], version: number, session: number, generation: number
): void {
  if (!pickerReplyIsCurrent(version, session)) return
  const context = getPhrasePickerContext?.()
  if (!context || !context.available || context.generation !== generation) return

  const idInput = phraseModal.querySelector('#idInput') as HTMLInputElement
  const editedId = idInput.value
  const excluded = new Set(context.excludedIds.map(String))

  // Deduplicate row IDs in response order, then drop the edited row, pending
  // deletions and any short ID outside seven base36 characters.
  const seenIds = new Set<string>()
  const eligible: Array<{ id: string; label: string; shortId: string }> = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row.id)
    if (seenIds.has(id)) continue
    seenIds.add(id)
    if (id === editedId || excluded.has(id)) continue
    const shortId = typeof row.short_id === 'string' ? row.short_id : ''
    if (!SHORT_ID_PATTERN.test(shortId)) continue
    const normalized = shortId.toLowerCase()
    const name = typeof row.phrase === 'string' ? row.phrase : ''
    eligible.push({ id, shortId: normalized, label: name ? name + ' (' + normalized + ')' : normalized })
  }

  // Two distinct rows sharing one normalized short ID are ambiguous references:
  // omit every one of them rather than guessing.
  const counts = new Map<string, number>()
  for (const entry of eligible) counts.set(entry.shortId, (counts.get(entry.shortId) ?? 0) + 1)
  const usable = eligible.filter((entry) => counts.get(entry.shortId) === 1)

  // The visible rows belong to the generation that validated them; an insert
  // from a superseded generation is refused rather than guessed.
  pickerGeneration = generation
  for (const entry of usable) {
    const option = document.createElement('option')
    option.value = entry.id
    // Names may contain markup or braces; textContent keeps them literal.
    option.textContent = entry.label
    phrasePicker.appendChild(option)
    pickerShortIds.set(entry.id, entry.shortId)
  }

  if (!usable.length) {
    setPickerStatus('composer_phrase_empty')
    return
  }
  phrasePicker.disabled = false
  setPickerStatus('')
}

function failPicker(version: number, session: number): void {
  if (!pickerReplyIsCurrent(version, session)) return
  setPickerStatus('composer_phrase_error')
  phrasePickerRetry.hidden = false
}

/**
 * Renderer notification. It clears the stale list and advances the request
 * version immediately; a visible disclosure over an available database gets one
 * coalesced refresh, and a hidden one gets no read at all.
 */
function invalidatePhrasePicker(): void {
  if (!phraseModal) return
  const focused = document.activeElement
  const focusWasInPicker = focused === phrasePicker || focused === phrasePickerRetry
  resetPickerControls()
  // Moving focus must never disturb the saved textarea range.
  if (focusWasInPicker && composerOwnsInput()) phraseInsertMore.focus()
  if (!composerOwnsInput() || !isMoreOpen()) return
  const context = getPhrasePickerContext?.()
  if (!context || !context.available) {
    setPickerStatus('composer_phrase_unavailable')
    return
  }
  setPickerStatus('composer_phrase_loading')
  if (pickerRefreshScheduled) return
  pickerRefreshScheduled = true
  queueMicrotask(() => {
    pickerRefreshScheduled = false
    fetchPhrasePicker()
  })
}

/** Insert is an intent of its own: choosing a row never edits the textarea. */
function insertSelectedPhrase(): void {
  if (!composerOwnsInput() || !isMoreOpen()) return
  const rowId = phrasePicker.value
  const shortId = pickerShortIds.get(rowId)
  if (!shortId) return
  const context = getPhrasePickerContext?.()
  if (!context || !context.available) return
  if (pickerGeneration === null || context.generation !== pickerGeneration) return
  const idInput = phraseModal.querySelector('#idInput') as HTMLInputElement
  if (rowId === idInput.value) return
  if (context.excludedIds.map(String).includes(rowId)) return
  requestComposerInsert('{{phrase:' + shortId + '}}', undefined, true)
}

/**
 * Back to the placeholder without a synthetic `change`: only a user commit ever
 * inserts. Programmatic selection of a disabled option is permitted; this does
 * not disable the select, clear its options, advance pickerVersion, touch
 * #phrase-picker-status or close More.
 */
function snapPickerBack(): void {
  phrasePicker.selectedIndex = 0
}

function initComposer(): void {
  expandedTextInput = phraseModal.querySelector('#expandedTextInput') as HTMLTextAreaElement
  phraseInsertShelf = phraseModal.querySelector('#phrase-insert-shelf') as HTMLElement
  phraseInsertMore = phraseModal.querySelector('#phrase-insert-more') as HTMLButtonElement
  phraseInsertMorePanel = phraseModal.querySelector('#phrase-insert-more-panel') as HTMLElement
  phrasePicker = phraseModal.querySelector('#phrase-picker') as HTMLSelectElement
  phrasePickerRetry = phraseModal.querySelector('#phrase-picker-retry') as HTMLButtonElement
  phrasePickerStatus = phraseModal.querySelector('#phrase-picker-status') as HTMLElement

  // The textarea owns the range. Input listeners only observe it; they never
  // reenter insertion.
  for (const type of ['select', 'input', 'keyup', 'mouseup', 'click', 'focus', 'blur']) {
    expandedTextInput.addEventListener(type, () => {
      if (!composerComposing) captureComposerRange()
    })
  }

  expandedTextInput.addEventListener('compositionstart', () => {
    composerComposing = true
    // A new composition supersedes any token queued for the previous one.
    queuedInsert = null
  })
  expandedTextInput.addEventListener('compositionend', () => {
    composerComposing = false
    flushQueuedInsert()
  })

  // Pointer activation moves focus to the button. Capture the range first, while
  // the textarea still owns focus, so the shelf never overwrites it.
  for (const region of [phraseInsertShelf, phraseInsertMorePanel]) {
    region.addEventListener('pointerdown', (event) => {
      if (composerComposing) {
        // A live composition keeps focus and selection. Refusing the pointerdown
        // default suppresses the focus change that would settle the IME, while
        // the click still arrives to queue one token. Every shelf button is
        // covered, including More and its chevron; the native select keeps its
        // own pointer behaviour.
        const chip = event.target instanceof Element ? event.target.closest('button') : null
        if (chip) event.preventDefault()
        return
      }
      if (document.activeElement === expandedTextInput) captureComposerRange()
    }, true)
  }

  // Alt-Tab or a hidden window ends the composer's claim on a deferred token:
  // compositionend must never mutate a draft the user has left behind.
  window.addEventListener('blur', () => {
    queuedInsert = null
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) queuedInsert = null
  })

  for (const [id, entry] of Object.entries(INSERT_TOKENS)) {
    const button = phraseModal.querySelector('#phrase-insert-' + id) as HTMLButtonElement
    button.addEventListener('click', () => {
      requestComposerInsert(entry.token, entry.range, SECONDARY_INSERTS.has(id))
    })
  }

  phraseInsertMore.addEventListener('click', () => {
    // A composition owns focus and selection: the disclosure neither toggles nor
    // takes focus. The user finishes composing, then opens More themselves.
    if (composerComposing) return
    if (isMoreOpen()) closeMore(true)
    else openMore()
    phraseInsertMore.focus()
  })

  // A closed select that merely holds focus must not swallow Escape forever,
  // and a select that loses focus must not stay armed for browsing.
  phrasePicker.addEventListener('blur', () => {
    pickerEscapeArmed = false
    pickerBrowsing = false
  })

  phrasePicker.addEventListener('keydown', (event) => {
    const modified = event.ctrlKey || event.metaKey || event.altKey
    const composing = event.isComposing || event.keyCode === 229
    // Assigned on every keydown, so Alt+ArrowDown, F4, Space, Tab and Escape
    // clear the flag rather than leave it armed. Space is excluded deliberately:
    // on a closed select Chromium opens the popup with it.
    pickerBrowsing = !modified && !composing
      && (PICKER_BROWSE_KEYS.has(event.key) || (event.key.length === 1 && event.key !== ' '))
    // The closed-select change is dispatched inside this same task, so it always
    // sees the flag; a later popup commit always sees it cleared. Not a time
    // threshold, and not queueMicrotask: a microtask can run before the default.
    setTimeout(() => { pickerBrowsing = false }, 0)
    if (event.key !== 'Enter' || composing) return
    // The composer has no form ancestor, but Enter must not travel further.
    event.preventDefault()
    if (!pickerShortIds.has(phrasePicker.value)) return
    insertSelectedPhrase()
    snapPickerBack()
  })

  phrasePicker.addEventListener('change', () => {
    // Browsing a closed select moves the selection only.
    if (pickerBrowsing) {
      pickerBrowsing = false
      return
    }
    insertSelectedPhrase()
    snapPickerBack()
  })

  // Retry repeats the same read; it is never an insertion intent.
  phrasePickerRetry.addEventListener('click', fetchPhrasePicker)

  const cancelButton = phraseModal.querySelector('#btn-phrase-cancel') as HTMLButtonElement
  cancelButton.addEventListener('click', closePhraseModal)

  // Capture phase, topmost composer only: the disclosure must consume the first
  // Escape before the shared modal system discards the whole draft. A child
  // modal on top keeps its own handling.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || getOpenModals().at(-1) !== phraseModal) return
    if (event.isComposing || event.keyCode === 229) {
      // A live composition owns this Escape; cancel the queued token but leave
      // the dialog alone.
      queuedInsert = null
      event.stopImmediatePropagation()
      return
    }
    if (document.activeElement === phrasePicker && !pickerEscapeArmed) {
      // The native select cancels its own interaction first. Its popup is not a
      // DOM listener, so the event is only kept away from the disclosure and the
      // shared dismissal; the default is left to the control. One Escape only:
      // a select that keeps focus hands the next one back to the disclosure.
      pickerEscapeArmed = true
      event.stopImmediatePropagation()
      return
    }
    pickerEscapeArmed = false
    event.preventDefault()
    event.stopImmediatePropagation()
    if (isMoreOpen()) {
      closeMore(true)
      return
    }
    closePhraseModal()
  }, true)

  // The shared backdrop handler hides the modal directly, which would skip the
  // composer teardown. Capture the overlay click and route it through the one
  // close that invalidates the form session, like Settings does.
  phraseModal.addEventListener('click', (event) => {
    if (event.target !== phraseModal || getOpenModals().at(-1) !== phraseModal) return
    event.preventDefault()
    event.stopImmediatePropagation()
    closePhraseModal()
  }, true)

  // Language changes retranslate the picker's own strings without rebuilding the
  // textarea or touching stored tokens and the saved range.
  window.api.receive('i18n:languageChanged', () => {
    if (!phrasePicker) return
    const placeholder = phrasePicker.options[0]
    if (placeholder && placeholder.value === '') placeholder.textContent = t('composer_phrase_choose')
    if (pickerStatusKey) phrasePickerStatus.textContent = t(pickerStatusKey)
  })
}

function openPhraseForm(
  phrase = '',
  expandedText = '',
  type: PhraseType = 'text',
  id: number | string | null = null,
  options: PhraseFormOptions = {}
): void {
  const title = phraseModal.querySelector('#modal-title') as HTMLElement
  const phraseInput = phraseModal.querySelector('#phraseInput') as HTMLInputElement
  const idInput = phraseModal.querySelector('#idInput') as HTMLInputElement

  phraseInput.value = phrase
  expandedTextInput.value = expandedText
  idInput.value = id ? String(id) : ''

  // Reflect the row's protection. A blank Add/Create always opens unchecked;
  // ticking the box never encrypts, Save does.
  composerOpenedLocked = Boolean(id) && options.locked === true
  const lockCheckbox = phraseModal.querySelector('#phrase-lock') as HTMLInputElement | null
  if (lockCheckbox) lockCheckbox.checked = composerOpenedLocked

  // A fresh form is a fresh lifetime: no leftover disclosure, deferred insert,
  // picker reply, saved range or dragged editor height survives it.
  phraseFormSession++
  queuedInsert = null
  composerComposing = false
  closeMore(false)
  expandedTextInput.style.height = ''
  composerRange = { start: expandedText.length, end: expandedText.length, direction: 'none' }

  const typeRadio = phraseModal.querySelector(
    `input[name="phraseType"][value="${type}"]`
  ) as HTMLInputElement
  if (typeRadio) {
    typeRadio.checked = true
  }

  title.textContent = id ? t('Edit Phrase') : t('Add Phrase')

  openPhraseModal()
  // Delay focus to ensure modal animation has started and element is visible.
  // Queued after shared showModal's own focus setup; the version and open-state
  // checks stop a stale timer from focusing a re-opened form.
  const focusVersion = ++phraseFormFocusVersion
  const focusTarget = options.focus === 'content' ? expandedTextInput : phraseInput
  requestAnimationFrame(() => {
    setTimeout(() => {
      // A child opened during the delay is topmost: the composer behind it must
      // not pull focus out of it.
      if (focusVersion === phraseFormFocusVersion && composerOwnsInput()) focusTarget.focus()
    }, 50)
  })

  const saveButton = phraseModal.querySelector('#saveButton') as HTMLButtonElement

  if (saveButtonController) {
    saveButtonController.abort()
  }

  saveButtonController = new AbortController()

  saveButton.addEventListener('click', handleSaveButtonClick, {
    signal: saveButtonController.signal,
  })
}

/**
 * Ticking the box needs a PIN before it can mean anything: with no PIN the setup
 * dialog opens, with a locked session the unlock dialog does. Cancelling either
 * unticks the box and changes nothing — Save is still what encrypts.
 */
function initComposerLockCheckbox(): void {
  const checkbox = document.getElementById('phrase-lock') as HTMLInputElement | null
  if (!checkbox) return
  checkbox.addEventListener('change', () => {
    if (!checkbox.checked) return
    void (async () => {
      const status = await refreshVaultStatus()
      if (status.unlocked) return
      const ok = await openVaultPinModal(status.hasPin ? 'unlock' : 'setup')
      if (!ok) checkbox.checked = false
    })()
  })
}

function handleSaveButtonClick(): void {
  // A submitted form cannot still accept a deferred token, including when
  // validation returns early below.
  queuedInsert = null
  const phraseInput = phraseModal.querySelector('#phraseInput') as HTMLInputElement
  const idInput = phraseModal.querySelector('#idInput') as HTMLInputElement
  const typeRadio = phraseModal.querySelector(
    'input[name="phraseType"]:checked'
  ) as HTMLInputElement | null
  const type = typeRadio?.value || 'plain'

  const newPhrase = phraseInput.value
  const newExpandedText = expandedTextInput.value
  const id = idInput.value

  if (!newPhrase.trim()) {
    showToast(t('Phrase cannot be empty'), 'danger')
    return
  }

  const lockCheckbox = phraseModal.querySelector('#phrase-lock') as HTMLInputElement | null
  const locked = lockCheckbox?.checked === true

  void saveComposer({ id, newPhrase, newExpandedText, type, locked, wasLocked: composerOpenedLocked })
}

/**
 * A save that protects a row — or that unprotects one — needs an unlocked
 * session. If the timer fired while the composer was open the draft stays on
 * screen and Save re-prompts; cancelling sends nothing at all.
 */
async function saveComposer(args: {
  id: string
  newPhrase: string
  newExpandedText: string
  type: string
  locked: boolean
  wasLocked: boolean
}): Promise<void> {
  if (args.locked || args.wasLocked) {
    const ready = await ensureVaultUnlocked()
    if (!ready) return
  }

  try {
    if (args.id) {
      window.api.send('phrases:edit', {
        id: args.id,
        newPhrase: args.newPhrase,
        newExpandedText: args.newExpandedText,
        type: args.type,
        locked: args.locked,
      })
    } else {
      window.api.send('phrases:add', {
        newPhrase: args.newPhrase,
        newExpandedText: args.newExpandedText,
        type: args.type,
        locked: args.locked,
      })
    }
  } catch (error) {
    console.error('Failed to save phrase:', error)
    showToast(t('Failed to save phrase'), 'danger')
  }
}

// =============================================================================
// Dynamic Prompt Modal
// =============================================================================

function initDynamicModal(): void {
  dynamicModal = document.getElementById('modal-dynamic')
  if (!dynamicModal) return // Modal not in DOM yet

  dynamicModalClose = dynamicModal.querySelector('.modal-close')
  dynamicModalTitle = document.getElementById('dynamic-modal-title')
  dynamicModalForm = document.getElementById('dynamic-form')
  dynamicModalSubmit = document.getElementById('btn-dynamic-insert')
  dynamicModalCancel = document.getElementById('btn-dynamic-cancel')

  dynamicModalClose?.addEventListener('click', cancelDynamicModal)
  dynamicModalCancel?.addEventListener('click', cancelDynamicModal)
  dynamicModalSubmit?.addEventListener('click', submitDynamicForm)

  // Handle Enter key to submit (except in textarea, skip during IME composition)
  dynamicModalForm?.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (e.key === 'Enter' && !e.isComposing && target.tagName !== 'TEXTAREA') {
      e.preventDefault()
      submitDynamicForm()
    }
  })

  // ESC handling is done by the shared modal system (hideTopModal)
  // No duplicate handler needed here

  // Listen for dynamic prompt requests from main process
  window.api.removeAllListeners('prompt:show')
  window.api.receive('prompt:show', (data: unknown) => {
    isCopyOperation = false
    openDynamicModal(data as DynamicPromptData)
  })

  // Listen for copy-specific dynamic prompt requests
  window.api.removeAllListeners('prompt:showForCopy')
  window.api.receive('prompt:showForCopy', (data: unknown) => {
    isCopyOperation = true
    openDynamicModal(data as DynamicPromptData)
  })
}

function openDynamicModal(data: DynamicPromptData): void {
  if (!dynamicModal || !dynamicModalTitle || !dynamicModalForm) return

  const modal = dynamicModal
  const form = dynamicModalForm

  currentDynamicData = data
  dynamicModalTitle.textContent = t('Fill in Details')
  form.innerHTML = ''

  // Build form fields for each promptable placeholder
  data.placeholders.forEach((p, index) => {
    const fieldId = `dynamic-field-${index}`
    const label = p.label || t(p.type === 'textarea' ? 'Text' : 'Value')

    const wrapper = document.createElement('div')
    wrapper.className = 'dynamic-field'

    const labelEl = document.createElement('label')
    labelEl.htmlFor = fieldId
    labelEl.textContent = label
    wrapper.appendChild(labelEl)

    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

    const selectPlaceholder = p as SelectPlaceholder

    if (p.type === 'select' && selectPlaceholder.options?.choices) {
      input = document.createElement('select')
      input.className = 'input'
      selectPlaceholder.options.choices.forEach((choice) => {
        const option = document.createElement('option')
        option.value = choice.value
        option.textContent = choice.value
        if (choice.default) option.selected = true
        input.appendChild(option)
      })
    } else if (p.type === 'textarea') {
      input = document.createElement('textarea')
      input.className = 'input'
      input.rows = 3
      // Default value can come from options.default (parsePlaceholders) or defaultValue (Placeholder type)
      const defaultVal = (p as SelectPlaceholder).options?.default || p.defaultValue || ''
      input.value = defaultVal
    } else {
      input = document.createElement('input')
      input.type = 'text'
      input.className = 'input'
      // Default value can come from options.default (parsePlaceholders) or defaultValue (Placeholder type)
      const defaultVal = (p as SelectPlaceholder).options?.default || p.defaultValue || ''
      input.value = defaultVal
    }

    input.id = fieldId
    input.dataset.label = p.label || `__${p.type}_${index}`
    wrapper.appendChild(input)

    form.appendChild(wrapper)
  })

  showModal(modal)

  // Focus first input after modal animation
  setTimeout(() => {
    const firstInput = form.querySelector('input, select, textarea') as HTMLElement | null
    firstInput?.focus()
  }, 50)
}

function cancelDynamicModal(): void {
  if (!dynamicModal) return
  // Dropping the dialog must also drop any plaintext main is holding for it.
  if (currentDynamicData?.pendingId !== undefined) {
    window.api.send(isCopyOperation ? 'prompt:copyResponse' : 'prompt:response', {
      phraseId: currentDynamicData.phraseId,
      phraseType: currentDynamicData.phraseType,
      pendingId: currentDynamicData.pendingId,
      cancelled: true,
      values: {},
      clipboardContent: '',
    })
  }
  hideModal(dynamicModal, () => {
    if (dynamicModalForm) dynamicModalForm.innerHTML = ''
    currentDynamicData = null
  })
}

function closeDynamicModal(): void {
  if (!dynamicModal) return
  hideModal(dynamicModal, () => {
    if (dynamicModalForm) dynamicModalForm.innerHTML = ''
    currentDynamicData = null
  })
}

function submitDynamicForm(): void {
  if (!currentDynamicData || !dynamicModalForm) return

  const form = dynamicModalForm

  // Collect values from form
  const values: Record<string, string> = {}
  form
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea'
    )
    .forEach((el) => {
      if (el.dataset.label) {
        values[el.dataset.label] = el.value
      }
    })

  // Send response to main process (use copy-specific channel if this is a copy operation)
  // A protected resolution arrived as a handle, not as text: echo the handle
  // back so main can use the copy it kept. There is nothing to resend.
  const responseChannel = isCopyOperation ? 'prompt:copyResponse' : 'prompt:response'
  window.api.send(responseChannel, {
    phraseId: currentDynamicData.phraseId,
    phraseType: currentDynamicData.phraseType,
    ...(currentDynamicData.pendingId === undefined
      ? { text: currentDynamicData.text }
      : { pendingId: currentDynamicData.pendingId }),
    values,
    clipboardContent: currentDynamicData.clipboardContent,
  })

  // Close modal without sending cancel
  closeDynamicModal()
}

function isDynamicModalOpen(): boolean {
  return dynamicModal !== null && isModalOpen(dynamicModal)
}

// =============================================================================
// Purchase Reminder Modal
// =============================================================================

function openPurchaseReminderModal(): void {
  if (purchaseReminderModal) {
    showModal(purchaseReminderModal)
  }
}

function closePurchaseReminderModal(): void {
  if (purchaseReminderModal) {
    hideModal(purchaseReminderModal)
  }
}

function isPurchaseReminderModalOpen(): boolean {
  return purchaseReminderModal !== null && isModalOpen(purchaseReminderModal)
}

// =============================================================================
// Legacy Migration Modal
// =============================================================================

function openLegacyMigrationModal(): void {
  if (legacyMigrationModal) {
    showModal(legacyMigrationModal)
  }
}

function closeLegacyMigrationModal(onComplete?: () => void): void {
  if (legacyMigrationModal) {
    // hideModal only leaves the stack on transition completion, so callers that
    // open another modal next must wait for that boundary.
    hideModal(legacyMigrationModal, onComplete)
  } else {
    onComplete?.()
  }
}

function isLegacyMigrationModalOpen(): boolean {
  return legacyMigrationModal !== null && isModalOpen(legacyMigrationModal)
}

// =============================================================================
// Initialization
// =============================================================================

function init(elements: ModalsInit): void {
  // Cache DOM elements
  settingsModal = document.getElementById('modal-settings')!
  markdownModal = document.getElementById('modal-markdown')!
  markdownClose = markdownModal.querySelector('.modal-close')!
  markdownTitle = document.getElementById('markdown-modal-title')!
  markdownContent = document.getElementById('markdown-modal-content')!
  markdownFooter = document.getElementById('markdown-modal-footer')!
  const markdownOkBtn = document.getElementById('btn-markdown-ok')
  phraseModal = document.getElementById('modal-phrase')!
  phraseModalClose = phraseModal.querySelector('.modal-close')!

  // Store references to external elements. The picker context is only stored:
  // the renderer's database locals do not exist yet while init runs.
  onSettingsDismiss = elements.onSettingsDismiss
  canDismissSettings = elements.canDismissSettings
  getPhrasePickerContext = elements.getPhrasePickerContext

  initComposer()
  initVaultUi({ t, showModal, hideModal, isModalOpen, showToast, clearToasts: clearAllToasts })
  initComposerLockCheckbox()

  // The PIN dialog owns its own Escape/backdrop exits so a derive in flight
  // cannot be dismissed out from under itself.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !isVaultPinModalOpen()) return
      if (getOpenModals().at(-1) !== document.getElementById('modal-vault-pin')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!isVaultPinBusy()) closeVaultPinModal(false)
    },
    true
  )
  const vaultPinOverlay = document.getElementById('modal-vault-pin')
  vaultPinOverlay?.addEventListener('click', (event) => {
    if (event.target !== vaultPinOverlay) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!isVaultPinBusy()) closeVaultPinModal(false)
  })

  // Capture phase: the shared default Escape/backdrop close must not bypass the
  // discard policy. Child modals keep their own handling.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || getOpenModals().at(-1) !== settingsModal) return
    event.preventDefault()
    event.stopImmediatePropagation()
    closeSettingsModal()
  }, true)
  settingsModal.addEventListener('click', (event) => {
    if (event.target !== settingsModal || getOpenModals().at(-1) !== settingsModal) return
    event.preventDefault()
    event.stopImmediatePropagation()
    closeSettingsModal()
  }, true)

  // Cache purchase reminder and legacy migration modals
  purchaseReminderModal = document.getElementById('modal-purchase-reminder')
  legacyMigrationModal = document.getElementById('modal-legacy-migration')

  // Attach close button listeners
  // Note: Settings modal close/cancel handled in renderer.ts for revert logic
  markdownClose.addEventListener('click', closeMarkdownModal)
  markdownOkBtn?.addEventListener('click', closeMarkdownModal)
  phraseModalClose.addEventListener('click', closePhraseModal)

  // Purchase reminder modal close button
  const purchaseReminderClose = purchaseReminderModal?.querySelector('.modal-close')
  purchaseReminderClose?.addEventListener('click', closePurchaseReminderModal)

  // Legacy migration modal close button
  const legacyMigrationClose = legacyMigrationModal?.querySelector('.modal-close')
  legacyMigrationClose?.addEventListener('click', () => closeLegacyMigrationModal())

  // Import preview modal
  importPreviewModal = document.getElementById('modal-import-preview')
  const importPreviewClose = importPreviewModal?.querySelector('.modal-close')
  importPreviewClose?.addEventListener('click', closeImportPreviewModal)

  // Handle markdown content received from main process
  window.api.receive('markdown:content', (data: unknown) => {
    if (!markdownContent) return // Guard against early IPC

    const response = data as MarkdownContentResponse
    if (response.success && response.html) {
      markdownContent.innerHTML = response.html
      // Handle links in markdown content to open externally
      markdownContent.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault()
          const href = link.getAttribute('href')
          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            window.api.send('shell:openExternal', href)
          }
        })
      })
    } else {
      markdownContent.innerHTML =
        '<p class="error">' + (response.error || 'Failed to load content') + '</p>'
    }
  })
}

// =============================================================================
// Import Preview Modal
// =============================================================================

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function openImportPreviewModal(analysis: ImportAnalysis): void {
  if (!importPreviewModal) return
  currentImportAnalysis = analysis

  const summaryEl = document.getElementById('import-summary')!
  const conflictsEl = document.getElementById('import-conflicts')!
  const warningsEl = document.getElementById('import-warnings')!

  // Build summary
  const sourceLabel = {
    phrasevault: 'PhraseVault',
    textexpander: 'TextExpander CSV',
    espanso: 'Espanso',
  }[analysis.source]

  // Stat badges for easy scanning
  const stats: string[] = []
  if (analysis.newPhrases.length > 0) {
    stats.push(`<span class="import-stat import-stat-new">${analysis.newPhrases.length} ${t('new')}</span>`)
  }
  if (analysis.conflicts.length > 0) {
    stats.push(`<span class="import-stat import-stat-conflict">${analysis.conflicts.length} ${t('already exist')}</span>`)
  }
  if (analysis.skipped > 0) {
    stats.push(`<span class="import-stat import-stat-skipped">${analysis.skipped} ${t('skipped')}</span>`)
  }

  summaryEl.innerHTML = `
    <div class="import-file-info">
      <span class="import-file-name">${escapeHtml(analysis.fileName)}</span>
      <span class="import-file-source">${sourceLabel}</span>
    </div>
    <p class="import-total">${analysis.total} ${t('phrases found')}</p>
    <div class="import-stats">${stats.join('')}</div>
  `

  // Build conflict list with checkboxes (checked = overwrite, unchecked = skip)
  if (analysis.conflicts.length > 0) {
    conflictsEl.classList.remove('hidden')
    conflictsEl.innerHTML = `
      <div class="import-section-header">
        <span class="settings-label">${t('Existing phrases')}</span>
        <span class="import-section-actions">
          <button class="btn btn-ghost btn-sm" id="import-skip-all">${t('Skip All')}</button>
          <button class="btn btn-ghost btn-sm" id="import-overwrite-all">${t('Overwrite All')}</button>
        </span>
      </div>
      <div class="import-conflict-list">
        ${analysis.conflicts.map((c, i) => `
          <label class="import-conflict-row settings-checkbox" data-index="${i}">
            <input type="checkbox" name="conflict-${i}">
            <span class="import-conflict-name">${escapeHtml(c.imported.phrase)}</span>
          </label>
        `).join('')}
      </div>
      <p class="settings-hint">${t('Check to overwrite, uncheck to skip')}</p>
    `

    // Bulk action handlers
    document.getElementById('import-skip-all')?.addEventListener('click', () => {
      conflictsEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = false })
    })
    document.getElementById('import-overwrite-all')?.addEventListener('click', () => {
      conflictsEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = true })
    })
  } else {
    conflictsEl.classList.add('hidden')
    conflictsEl.innerHTML = ''
  }

  // Build warnings
  if (analysis.warnings.length > 0) {
    warningsEl.classList.remove('hidden')
    warningsEl.innerHTML = `
      <div class="import-warnings-inner">
        ${analysis.warnings.map(w =>
          `<p>${escapeHtml(w)}</p>`
        ).join('')}
      </div>
    `
  } else {
    warningsEl.classList.add('hidden')
    warningsEl.innerHTML = ''
  }

  // Disable Import button if there's nothing actionable
  const importConfirmBtn = importPreviewModal.querySelector('#btn-import-confirm') as HTMLButtonElement | null
  if (importConfirmBtn) {
    const hasActionable = analysis.newPhrases.length > 0 || analysis.conflicts.length > 0
    importConfirmBtn.disabled = !hasActionable
  }

  showModal(importPreviewModal)
}

function closeImportPreviewModal(): void {
  if (importPreviewModal) {
    hideModal(importPreviewModal, () => {
      currentImportAnalysis = null
    })
  }
}

function confirmImport(): void {
  if (!currentImportAnalysis || !importPreviewModal) return

  const conflictsEl = document.getElementById('import-conflicts')!

  // Collect conflict resolutions (checked = overwrite, unchecked = skip)
  const conflictActions = currentImportAnalysis.conflicts.map((conflict, i) => {
    const checkbox = conflictsEl.querySelector<HTMLInputElement>(
      `input[name="conflict-${i}"]`
    )
    return {
      imported: conflict.imported,
      existingId: conflict.existing.id,
      action: (checkbox?.checked ? 'overwrite' : 'skip') as 'skip' | 'overwrite',
    }
  })

  const confirmation: ImportConfirmation = {
    newPhrases: currentImportAnalysis.newPhrases,
    conflicts: conflictActions,
  }

  window.api.send('phrases:importConfirm', confirmation)
  closeImportPreviewModal()
}

function isImportPreviewModalOpen(): boolean {
  return importPreviewModal !== null && isModalOpen(importPreviewModal)
}

// =============================================================================
// Module Exports
// =============================================================================

window.modals = {
  init,
  showToast,

  // Shared modal utilities (re-exported from @spqrkapps/shared/renderer)
  hasOpenModals,
  hideTopModal,

  // Settings Modal
  openSettingsModal,
  closeSettingsModal,
  isSettingsModalOpen,

  // Markdown Modal
  openMarkdownModal,
  closeMarkdownModal,
  isMarkdownModalOpen,

  // Phrase Modal
  openPhraseForm,
  closePhraseModal,
  isPhraseModalOpen,
  invalidatePhrasePicker,

  // Dynamic Prompt Modal
  openDynamicModal,
  closeDynamicModal,
  cancelDynamicModal,
  isDynamicModalOpen,

  // Purchase Reminder Modal
  openPurchaseReminderModal,
  closePurchaseReminderModal,
  isPurchaseReminderModalOpen,

  // Legacy Migration Modal
  openLegacyMigrationModal,
  closeLegacyMigrationModal,
  isLegacyMigrationModalOpen,

  // Vault (PIN lock)
  getVaultStatusSnapshot,
  ensureVaultUnlocked,
  fetchPhraseBody,
  openVaultPinModal,
  onVaultStatus,
  translateVaultError,

  // Import Preview Modal
  openImportPreviewModal,
  closeImportPreviewModal,
  confirmImport,
  isImportPreviewModalOpen,
}

// Initialize dynamic modal after DOM elements are set up
document.addEventListener('DOMContentLoaded', initDynamicModal)
