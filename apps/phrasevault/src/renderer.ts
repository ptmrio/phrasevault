/**
 * PhraseVault Renderer Process
 * Main UI logic for the phrase management interface
 */

import './modal'
import {
  createIcon,
  initWindowControls,
  type WindowControlsHandle,
} from '@spqrkapps/shared/renderer'
import { createPaletteSearch } from './palette-search'
import type { PaletteState } from './palette-search'
import { createCompositionGuard, isPlainPaletteKey } from './palette-keys'
import { filterPhrases } from './phrase-search'
import type { PhraseRow, PhraseType, SettingsData, ThemeMode, ToastMessage, ImportAnalysis, VaultResult, VaultStatus } from './types'

/**
 * Translation helper - wraps IPC call for convenience.
 * Interpolation escaping is disabled only for these text/attribute assignments:
 * every value is assigned through textContent or setAttribute, never innerHTML.
 */
function t(key: string, values?: Record<string, unknown>): string {
  const options = values ? { ...values, interpolation: { escapeValue: false } } : undefined
  return window.api.sendSync<string>('i18n:translate-sync', key, options) ?? key
}

// The in-page caption. Held at module scope so the language-change path can
// re-label it.
let windowControls: WindowControlsHandle | null = null

function windowControlLabels() {
  return {
    group: t('Window controls'),
    minimize: t('Minimize'),
    maximize: t('Maximize'),
    restore: t('Restore Down'),
    close: t('Close'),
    enterFullScreen: t('Enter Full Screen'),
    exitFullScreen: t('Exit Full Screen'),
    zoom: t('Zoom'),
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const titleBar = document.getElementById('title-bar')
  if (titleBar) {
    windowControls = initWindowControls({ container: titleBar, labels: windowControlLabels() })
  }

  // =============================================================================
  // DOM Elements
  // =============================================================================

  const searchInput = document.getElementById('search') as HTMLInputElement
  const phraseList = document.getElementById('phrase-list') as HTMLUListElement
  const addPhraseButton = document.getElementById('add-phrase') as HTMLButtonElement
  const settingsBtn = document.getElementById('btn-settings') as HTMLButtonElement
  const dbStatusBtn = document.getElementById('btn-db-status') as HTMLButtonElement
  const searchButton = document.getElementById('search-btn') as HTMLButtonElement
  const searchClear = document.getElementById('search-clear') as HTMLButtonElement

  // Initialize modal module with required DOM elements. The renderer owns both
  // database status renderings; the modal module keeps no copy of them.
  window.modals.init({
    // Every Settings dismissal discards the preference draft; a committing Save
    // is the only state that refuses one.
    onSettingsDismiss: () => discardSettings(),
    canDismissSettings: () => !settingsSession?.committing,
    // Lazy by contract: these locals are still in their temporal dead zone while
    // init runs, so the composer reads them only on fetch, apply and insert.
    getPhrasePickerContext: () => ({
      generation: controller.getState().generation,
      available: databaseAvailable === true,
      excludedIds: [...pendingDeletions.keys()],
    }),
  })

  // =============================================================================
  // State
  // =============================================================================

  // Track phrases pending deletion (for undo functionality).
  // The row is retained so search results can stay masked until the delete is
  // acknowledged or undone, and so Create is not offered prematurely.
  interface PendingDeletion {
    row: PhraseRow
    generation: number
    timer: ReturnType<typeof setTimeout>
    sent: boolean
    dismiss: () => void
  }
  const pendingDeletions = new Map<string, PendingDeletion>()

  // Track database status for re-translation on language change
  let currentDatabaseStatus: 'available' | 'loading' | 'error' = 'loading'

  // ---------------------------------------------------------------------------
  // Preference draft state
  //
  // committedPreferences mirrors what the main process has actually persisted.
  // A SettingsSession owns one opening: its baseline is captured once and never
  // replaced by a later, untagged config reply. Async completions check owner
  // identity so a cancelled or superseded operation is inert.
  // ---------------------------------------------------------------------------
  type Preferences = Pick<SettingsData, 'theme' | 'language' | 'autostart' | 'summonShortcut'>
  type ShortcutValidation = { valid: boolean; error?: string }
  type ShortcutRegistration = { success: boolean; error?: string }
  interface SettingsSession {
    id: number
    baseline: Preferences | null
    validationRevision: number
    validation: Promise<ShortcutValidation> | null
    validatedShortcut: string | null
    validationResult: ShortcutValidation | null
    saving: boolean
    committing: boolean
  }
  let committedPreferences: Preferences | null = null
  let settingsSession: SettingsSession | null = null
  let settingsSessionId = 0

  // Settings modal state
  const settingsStatusIndicator = document.getElementById('settings-status-indicator')
  const settingsStatusText = document.getElementById('settings-status-text')
  let appVersion = ''

  /** The four Settings categories, in rail order. About is last. */
  const SETTINGS_PANES = ['preferences', 'database', 'security', 'about'] as const
  type SettingsPane = (typeof SETTINGS_PANES)[number]
  let selectedSettingsPane: SettingsPane = 'preferences'

  // =============================================================================
  // i18n
  // =============================================================================

  function applyTranslations(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n')
      if (!key) return

      const attribute = el.getAttribute('data-i18n-attribute')
      if (attribute) {
        el.setAttribute(attribute, t(key))
      } else {
        el.innerText = t(key)
      }
    })
  }

  /**
   * The data-i18n loop assigns one attribute per element, so the palette chrome
   * tooltips are applied here as well as their accessible names.
   */
  function applyChromeLabels(): void {
    for (const [control, key] of [
      [searchButton, 'Search'],
      [searchClear, 'Clear'],
      [addPhraseButton, 'Add Phrase'],
    ] as const) {
      control.setAttribute('aria-label', t(key))
      control.title = t(key)
    }
  }

  /**
   * The recent list is built on demand, so its heading is not a data-i18n node
   * and has to be retranslated in place rather than waiting for the next
   * database:recentList event to rebuild it.
   */
  function applyRecentDatabasesLabel(): void {
    const label = document.getElementById('recent-databases-label')
    if (label) label.textContent = t('Recent Databases') + ':'
  }

  window.api.receive('i18n:languageChanged', (lang: unknown) => {
    // Update HTML lang attribute for screen readers and spellcheck
    if (typeof lang === 'string') {
      document.documentElement.lang = lang
    }
    if (typeof lang === 'string' && committedPreferences) committedPreferences.language = lang
    // Language change handled by main process - re-apply all translations
    applyTranslations()
    applyChromeLabels()
    windowControls?.setLabels(windowControlLabels())
    // Re-apply dynamic translations (database status, etc.)
    applyDatabaseStatus()
    applyRecentDatabasesLabel()
    // Re-render phrase list to pick up new translations for dynamically created elements
    updateList()
  })

  applyTranslations()
  applyChromeLabels()

  // =============================================================================
  // Theme
  // =============================================================================

  // One effective subscription, installed at startup rather than per System
  // selection, so repeated preview/cancel cycles cannot accumulate listeners and
  // an obsolete System listener can never override an explicit Light/Dark.
  const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)')
  let effectiveTheme: ThemeMode = window.api.sendSync<ThemeMode>('theme:get') ?? 'system'

  function applyTheme(mode: ThemeMode): void {
    effectiveTheme = mode
    document.documentElement.classList.toggle(
      'dark',
      mode === 'system' ? systemAppearance.matches : mode === 'dark'
    )
  }

  const onSystemAppearance = (): void => {
    if (effectiveTheme === 'system') applyTheme('system')
  }
  systemAppearance.addEventListener('change', onSystemAppearance)
  window.addEventListener('beforeunload', () => {
    systemAppearance.removeEventListener('change', onSystemAppearance)
  })
  applyTheme(effectiveTheme)

  window.api.receive('theme:set', (theme: unknown) => {
    const mode = theme as ThemeMode
    if (committedPreferences) committedPreferences.theme = mode
    // An open draft owns both the preview and the select until it is discarded
    // or saved; a committed event must not reach through it.
    if (settingsSession) return
    applyTheme(mode)
    if (settingsTheme) settingsTheme.value = mode
  })

  // =============================================================================
  // Status Indicator
  // =============================================================================

  /**
   * Literal, trusted glyph geometry - no icon library, no dependency. Each state
   * has its own shape, so status is never carried by colour alone.
   */
  const STATUS_GLYPHS: Record<'available' | 'loading' | 'error', Array<[string, Record<string, string>]>> = {
    available: [
      ['ellipse', { cx: '12', cy: '5', rx: '8', ry: '3' }],
      ['path', { d: 'M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5' }],
      ['path', { d: 'M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3' }],
    ],
    loading: [['path', { d: 'M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4' }]],
    error: [
      ['circle', { cx: '12', cy: '12', r: '9' }],
      ['path', { d: 'M12 7v6' }],
      ['path', { d: 'M12 17h.01' }],
    ],
  }

  const SVG_NS = 'http://www.w3.org/2000/svg'

  function renderStatusGlyph(svg: SVGElement | null, state: 'available' | 'loading' | 'error'): void {
    if (!svg || svg.dataset.state === state) return
    svg.dataset.state = state
    svg.replaceChildren(
      ...STATUS_GLYPHS[state].map(([tag, attributes]) => {
        const shape = document.createElementNS(SVG_NS, tag)
        for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value)
        return shape
      })
    )
  }

  function updateStatusIndicator(available: boolean): void {
    currentDatabaseStatus = available ? 'available' : 'loading'
    applyDatabaseStatus()
  }

  function applyDatabaseStatus(): void {
    let color: string
    let statusText: string

    switch (currentDatabaseStatus) {
      case 'available':
        // Deliberately quiet: a loaded database is the normal state, not a
        // success signal that competes with the palette for attention.
        color = 'var(--text-muted)'
        statusText = t('Phrases loaded')
        break
      case 'error':
        color = 'var(--palette-status-error)'
        statusText = t('Database error')
        break
      default:
        color = 'var(--palette-status-loading)'
        statusText = t('Loading...')
    }

    // The status control carries the state in its own accessible name and
    // tooltip; the gear is Settings alone.
    settingsBtn.setAttribute('aria-label', t('Settings'))
    settingsBtn.title = t('Settings')
    const label = t('database_status_label', { status: statusText })
    dbStatusBtn.dataset.state = currentDatabaseStatus
    dbStatusBtn.style.color = color
    dbStatusBtn.setAttribute('aria-label', label)
    dbStatusBtn.title = label
    renderStatusGlyph(document.getElementById('db-status-glyph') as SVGElement | null, currentDatabaseStatus)

    if (settingsStatusIndicator) {
      settingsStatusIndicator.dataset.state = currentDatabaseStatus
      settingsStatusIndicator.style.color = color
      renderStatusGlyph(settingsStatusIndicator.querySelector('svg'), currentDatabaseStatus)
    }
    // Assign only on a real change: a hidden Database pane must not announce
    // repeated background activity through its live region.
    if (settingsStatusText && settingsStatusText.textContent !== statusText) {
      settingsStatusText.textContent = statusText
    }
  }

  // Both locations render at startup, not only on the first status event.
  applyDatabaseStatus()

  // =============================================================================
  // Palette: search freshness, selection and one cancellable Enter intent
  // =============================================================================

  const composition = createCompositionGuard()
  const paletteStatus = document.getElementById('palette-status') as HTMLElement
  let databaseAvailable: boolean | undefined
  let renderedKey = ''

  const controller = createPaletteSearch({
    read: (query) => window.api.invoke<PhraseRow[]>('phrases:search', query),
    render: renderPalette,
    onError: (error) => {
      console.error('Failed to search phrases:', error)
      currentDatabaseStatus = 'error'
      applyDatabaseStatus()
      window.modals.showToast(t('palette_search_failed'), 'danger')
    },
    canActivate: () =>
      document.hasFocus() &&
      !document.hidden &&
      !window.modals.hasOpenModals() &&
      !composition.isActive() &&
      paletteOrigin(document.activeElement) !== null,
    activate: (target) => {
      if (target.kind === 'phrase') insertTextIntoActiveField(String(target.id))
      else openCreate(target.name)
    },
  })

  /** Editor types are a closed set; stored rows may still carry legacy 'plain'. */
  function editorType(type: string): PhraseType {
    return type === 'markdown' || type === 'mdwysiwyg' || type === 'html' ? type : 'text'
  }

  function enterHint(): HTMLElement {
    const hint = document.createElement('kbd')
    hint.className = 'palette-enter-hint'
    hint.textContent = t('palette_enter_key')
    hint.hidden = true
    hint.setAttribute('aria-hidden', 'true')
    return hint
  }

  function openCreate(name: string): void {
    controller.cancelEnter()
    window.modals.openPhraseForm(name, '', 'text', null, { focus: 'content' })
  }

  function paletteOrigin(element: Element | null): 'search' | 'row' | 'create' | null {
    if (element === searchInput) return 'search'
    if (element?.matches('#phrase-list > li.phrase-item[data-id]')) return 'row'
    if (element?.matches('#phrase-list > li > button[data-palette-action="create"]')) return 'create'
    return null
  }

  function actionableRows(): HTMLElement[] {
    return Array.from(
      phraseList.querySelectorAll<HTMLElement>(
        ':scope > .phrase-item[data-id], :scope > li > button[data-palette-action="create"]'
      )
    ).filter((element) => element.getClientRects().length > 0 && !pendingDeletions.has(element.dataset.id ?? ''))
  }

  /**
   * Paint selection, Enter badges and the status line. Presentation only: it
   * never moves focus and never touches the controller's Enter intent.
   *
   * Selection follows real focus, not the implicit Enter target. While the
   * caret is in #search nothing is painted, so ArrowDown lands on row 0 as a
   * first selection rather than a second one. The target still decides which
   * focused element earns the badge, and still drives the status line so a
   * search-focused user is told what Enter will do. `announce` is false for
   * retained loading rows, whose live region keeps its last settled text.
   */
  function decoratePalette(state: PaletteState, announce = true): void {
    // Fresh read: a rebuild may have refocused a row and republished since.
    const current = controller.getState().target
    const origin = paletteOrigin(document.activeElement)
    const inPalette = origin !== null && !window.modals.hasOpenModals()
    // Focus inside a nested Copy/Edit/More is not selection of its parent row.
    const focused = origin === 'row' || origin === 'create' ? document.activeElement : null
    phraseList.querySelectorAll<HTMLElement>('.phrase-item, .palette-create').forEach((element) => {
      const selected = element === focused
      const isTarget =
        current?.kind === 'phrase'
          ? element.classList.contains('phrase-item') && element.dataset.id === String(current.id)
          : current?.kind === 'create' && element.dataset.paletteAction === 'create'
      element.classList.toggle('is-selected', selected)
      const hint = element.querySelector<HTMLElement>('.palette-enter-hint')
      if (hint) hint.hidden = !selected || !isTarget || !inPalette
    })
    if (!announce) return
    if (!inPalette && state.phase === 'ready') paletteStatus.textContent = ''
    else if (current?.kind === 'create') paletteStatus.textContent = t('palette_create_status', { name: current.name })
    else if (current?.kind === 'phrase') {
      const phrase = state.rows.find((row) => row.id === current.id)
      paletteStatus.textContent = t('palette_insert_status', { name: phrase?.phrase ?? '' })
    } else
      paletteStatus.textContent =
        state.phase === 'error' ? t('palette_search_failed') : state.phase === 'ready' ? '' : t('Loading...')
  }

  function renderPalette(state: PaletteState): void {
    if (state.phase === 'ready') {
      // Notify on the actual restoration only; a per-render call would be a
      // refresh loop.
      const restored = databaseAvailable !== true
      databaseAvailable = true
      currentDatabaseStatus = 'available'
      applyDatabaseStatus()
      if (restored) window.modals.invalidatePhrasePicker()
    }
    // Ordinary typing keeps the last settled list: mark the request state and
    // return without repainting. renderedKey is deliberately not updated, and
    // every setQuery bumps version, so the settled result always repaints.
    // A generation bump (database switch) must NOT return: reset cleared the
    // controller rows, but the DOM still shows database A until we rebuild.
    if (state.phase === 'loading') {
      phraseList.dataset.phase = 'loading'
      searchInput.setAttribute('aria-busy', 'true')
      const paintedGeneration = renderedKey === '' ? NaN : Number(renderedKey.split(':')[0])
      // Retained rows are not rebuilt, but their decoration still has to track
      // focus and the now-unknown Enter target. The status says nothing new.
      if (paintedGeneration === state.generation) {
        decoratePalette(state, false)
        return
      }
    }
    const key = [state.generation, state.version, state.phase, [...pendingDeletions.keys()].sort().join(',')].join(':')
    if (key !== renderedKey) {
      renderedKey = key
      const active = document.activeElement
      const origin = paletteOrigin(active)
      const focusedId = origin === 'row' ? (active as HTMLElement).getAttribute('data-id') : null
      phraseList.replaceChildren()
      phraseList.dataset.phase = state.phase
      searchInput.setAttribute('aria-busy', String(state.phase === 'loading'))
      if (state.phase === 'ready') {
        renderRows(state.rows)
        phraseList.querySelectorAll<HTMLElement>(':scope > .phrase-item').forEach((row) => {
          const actions = row.querySelector('.phrase-action')?.parentElement
          if (actions) row.insertBefore(enterHint(), actions)
        })
        if (state.target?.kind === 'create') {
          const li = document.createElement('li')
          li.className = 'palette-create-item'
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'palette-create'
          button.dataset.paletteAction = 'create'
          const label = document.createElement('span')
          label.className = 'flex-1 min-w-0 truncate'
          label.textContent = t('palette_create', { name: state.target.name })
          button.setAttribute('aria-label', label.textContent)
          button.append(label, enterHint())
          button.addEventListener('click', () => {
            if (!document.hasFocus() || window.modals.hasOpenModals() || composition.isActive()) return
            controller.focusPhrase(null)
            controller.enter()
          })
          li.append(button)
          phraseList.append(li)
        }
      } else {
        const li = document.createElement('li')
        li.className = 'palette-status-row'
        li.textContent = state.phase === 'error' ? t('palette_search_failed') : t('Loading...')
        phraseList.append(li)
      }
      if ((origin === 'row' || origin === 'create') && !window.modals.hasOpenModals()) {
        const replacement = focusedId
          ? phraseList.querySelector<HTMLElement>(':scope > .phrase-item[data-id="' + focusedId + '"]')
          : phraseList.querySelector<HTMLElement>('[data-palette-action="create"]')
        ;(replacement ?? searchInput).focus()
      }
    }
    decoratePalette(state)
    updateFilteredExport()
  }

  function updateList(): void {
    controller.refresh()
  }

  // --- Pending deletion lifetime ---------------------------------------------

  function syncPending(): void {
    controller.setPending([...pendingDeletions.values()].map((entry) => entry.row))
    // The picker excludes pending deletions, so every change to that set makes
    // an open list stale. Same-turn notifications coalesce into one refresh.
    window.modals.invalidatePhrasePicker()
  }

  function cancelDeletions(): void {
    for (const entry of pendingDeletions.values()) {
      clearTimeout(entry.timer)
      entry.dismiss()
    }
    pendingDeletions.clear()
    syncPending()
  }

  function beginDeletion(row: PhraseRow): void {
    const id = String(row.id)
    if (pendingDeletions.has(id)) return
    const generation = controller.getState().generation
    const entry: PendingDeletion = {
      row,
      generation,
      sent: false,
      dismiss: () => {},
      timer: setTimeout(() => {
        if (pendingDeletions.get(id) !== entry || controller.getState().generation !== generation) return
        entry.sent = true
        try {
          window.api.send('phrases:delete', row.id)
        } catch (error) {
          console.error('Failed to delete phrase:', error)
          // Never leave a transiently actionable stale row behind.
          controller.fail()
          pendingDeletions.delete(id)
          syncPending()
          window.modals.showToast(t('Failed to delete phrase'), 'danger')
        }
        // Keep the record until phrases:deleted acknowledges this ID.
      }, 8000),
    }
    pendingDeletions.set(id, entry)
    syncPending()
    const toast = window.modals.showToast(t('Phrase deleted'), 'success', {
      undoText: t('Undo'),
      duration: 8000,
      onUndo: () => {
        if (entry.sent || pendingDeletions.get(id) !== entry) return
        clearTimeout(entry.timer)
        pendingDeletions.delete(id)
        syncPending()
        window.modals.showToast(t('Deletion cancelled'), 'success')
      },
    })
    entry.dismiss = toast.dismiss
  }

  // --- Event origins ----------------------------------------------------------

  searchInput.addEventListener('input', () => controller.setQuery(searchInput.value))
  searchInput.addEventListener('compositionstart', () => {
    composition.start()
    controller.cancelEnter()
  })
  searchInput.addEventListener('compositionend', () => composition.end())
  document.addEventListener('keyup', (event) => composition.keyup(event.key), true)

  document.addEventListener('focusin', () => {
    const origin = paletteOrigin(document.activeElement)
    if (origin === 'row') controller.focusPhrase(Number((document.activeElement as HTMLElement).dataset.id))
    else if (origin === 'search' || origin === 'create') controller.focusPhrase(null)
    else {
      controller.cancelEnter()
      renderPalette(controller.getState())
    }
  })
  // Focus dropped to nothing (a click on empty list space) fires no focusin;
  // repaint so the row it left stops advertising Enter.
  document.addEventListener('focusout', (event) => {
    if (event.relatedTarget === null) renderPalette(controller.getState())
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') controller.cancelEnter()
    const origin = paletteOrigin(document.activeElement)
    if (!origin || window.modals.hasOpenModals() || !document.hasFocus() || document.hidden) return
    if (composition.blocks(event)) {
      if (origin === 'create' && event.key === 'Enter') event.preventDefault()
      return
    }
    if (event.key === 'Enter' && !isPlainPaletteKey(event)) {
      if (origin === 'create') event.preventDefault()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      controller.enter()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const rows = actionableRows()
    if (!rows.length) return
    event.preventDefault()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const index = rows.indexOf(document.activeElement as HTMLElement)
    const next = origin === 'search' ? rows[direction === 1 ? 0 : rows.length - 1] : rows[index + direction]
    ;(next ?? searchInput).focus()
  })

  const nestedControl =
    '.phrase-action, .phrase-menu, button, a, input, textarea, select, [contenteditable], [role="button"]'
  phraseList.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element) || target.closest(nestedControl)) return
    target.closest<HTMLElement>('.phrase-item[data-id]')?.focus()
  })
  phraseList.addEventListener('dblclick', (event) => {
    const target = event.target
    if (!(target instanceof Element) || target.closest(nestedControl)) return
    const row = target.closest<HTMLElement>('.phrase-item[data-id]')
    if (!row || pendingDeletions.has(row.dataset.id ?? '')) return
    row.focus()
    controller.enter()
  })

  window.addEventListener('blur', () => controller.cancelEnter())
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) controller.cancelEnter()
  })
  const modalObserver = new MutationObserver(() => {
    if (window.modals.hasOpenModals()) controller.cancelEnter()
  })
  modalObserver.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['class', 'style'],
  })
  window.addEventListener('beforeunload', () => modalObserver.disconnect())

  // =============================================================================
  // Database lifecycle
  // =============================================================================

  window.api.receive('database:status', (value: unknown) => {
    const available = value === true
    updateStatusIndicator(available)
    // Only an actual availability transition invalidates: a repeated true status
    // must not refresh an open picker.
    if (databaseAvailable === available) return
    databaseAvailable = available
    controller.reset(searchInput.value, available)
    if (!available) cancelDeletions()
    window.modals.invalidatePhrasePicker()
  })

  window.api.receive('database:error', (error: unknown) => {
    console.error('Database error:', error)
    databaseAvailable = false
    currentDatabaseStatus = 'error'
    applyDatabaseStatus()
    controller.fail()
    cancelDeletions()
    window.modals.invalidatePhrasePicker()
  })

  window.api.receive('database:switched', () => {
    cancelDeletions()
    window.modals.closeSettingsModal()
    searchInput.value = ''
    syncSearchClear()
    databaseAvailable = true
    controller.reset('', true)
    searchInput.focus()
    // A new generation cannot be referenced by an old reply or a reused row ID.
    window.modals.invalidatePhrasePicker()
  })

  // =============================================================================
  // Settings Modal
  // =============================================================================

  const settingsTheme = document.getElementById('settings-theme') as HTMLSelectElement
  const languageSelect = document.getElementById('language-select') as HTMLSelectElement
  const autostartToggle = document.getElementById('autostart-toggle') as HTMLInputElement
  const settingsTabs = SETTINGS_PANES.map(
    (name) => document.getElementById('settings-tab-' + name) as HTMLButtonElement
  )
  const settingsPanels = SETTINGS_PANES.map(
    (name) => document.getElementById('settings-' + name) as HTMLElement
  )
  const btnSettingsClose = document.getElementById('btn-settings-close') as HTMLButtonElement
  const btnSettingsCancel = document.getElementById('btn-settings-cancel') as HTMLButtonElement
  const btnSettingsSave = document.getElementById('btn-settings-save') as HTMLButtonElement
  const settingsDialog = document.querySelector('#modal-settings .modal') as HTMLElement

  // ===========================================================================
  // Settings -> Security
  //
  // The timeout toggle and select are draft values committed by Settings Save.
  // Lock now and Change PIN act immediately and leave Settings open.
  // ===========================================================================

  const vaultStatusText = document.getElementById('vault-status-text') as HTMLElement
  const vaultEmptyHint = document.getElementById('vault-empty-hint') as HTMLElement
  const vaultHint = document.getElementById('vault-hint') as HTMLElement
  const vaultTimeoutSection = document.getElementById('vault-timeout-section') as HTMLElement
  const vaultTimeoutToggle = document.getElementById('vault-timeout-toggle') as HTMLInputElement
  const vaultTimeoutSelect = document.getElementById('vault-timeout-select') as HTMLSelectElement
  const btnVaultLockNow = document.getElementById('btn-vault-lock-now') as HTMLButtonElement
  const btnVaultChangePin = document.getElementById('btn-vault-change-pin') as HTMLButtonElement

  /** Reflect live status. Never reseeds the draft controls. */
  function renderVaultStatus(status: VaultStatus): void {
    const key = !status.hasPin
      ? 'vault_status_none'
      : status.unlocked
        ? 'vault_status_unlocked'
        : 'vault_status_locked'
    vaultStatusText.textContent = t(key, { count: status.lockedCount })
    vaultEmptyHint.hidden = status.hasPin
    vaultHint.hidden = !status.hasPin
    btnVaultLockNow.disabled = !status.unlocked
    btnVaultChangePin.disabled = !status.hasPin || !status.kdfSupported

    // With no PIN, or no database, there is nothing for a timeout to govern.
    const timeoutUsable = status.available && status.hasPin
    vaultTimeoutToggle.disabled = !timeoutUsable
    vaultTimeoutSection.classList.toggle('is-disabled', !timeoutUsable)
    vaultTimeoutSelect.disabled = !timeoutUsable || !vaultTimeoutToggle.checked
  }

  vaultTimeoutToggle.addEventListener('change', () => {
    const status = window.modals.getVaultStatusSnapshot()
    vaultTimeoutSelect.disabled = !(status.available && status.hasPin) || !vaultTimeoutToggle.checked
  })

  btnVaultLockNow.addEventListener('click', () => {
    void window.api.invoke('vault:lock')
  })

  btnVaultChangePin.addEventListener('click', () => {
    void window.modals.openVaultPinModal('change')
  })

  window.modals.onVaultStatus(renderVaultStatus)

  /** Seed the draft controls from config at open time only. */
  function seedVaultDraft(status: VaultStatus): void {
    vaultTimeoutToggle.checked = status.timeoutEnabled
    vaultTimeoutSelect.value = String(status.timeoutMinutes)
    renderVaultStatus(status)
  }

  // =============================================================================
  // Shortcut Recording
  // =============================================================================

  const shortcutInput = document.getElementById('shortcut-input') as HTMLInputElement
  const shortcutRecordBtn = document.getElementById('shortcut-record-btn') as HTMLButtonElement
  const shortcutResetBtn = document.getElementById('shortcut-reset-btn') as HTMLButtonElement
  const shortcutError = document.getElementById('shortcut-error') as HTMLElement

  let isRecordingShortcut = false
  let pendingShortcut: string | null = null

  /**
   * Convert Electron accelerator to display format
   */
  function acceleratorToDisplay(accelerator: string): string {
    const isMac = window.platform === 'darwin'
    if (isMac) {
      return accelerator
        .replace(/CommandOrControl/g, '⌘')
        .replace(/Control/g, '⌃')
        .replace(/Command/g, '⌘')
        .replace(/Alt/g, '⌥')
        .replace(/Shift/g, '⇧')
        .replace(/\+/g, '')
    }
    return accelerator
      .replace(/CommandOrControl/g, t('Ctrl'))
      .replace(/Control/g, t('Ctrl'))
      .replace(/Command/g, t('Ctrl'))
      .replace(/Alt/g, t('Alt'))
      .replace(/Shift/g, t('Shift'))
  }

  /**
   * Build accelerator string from keyboard event
   */
  function buildAccelerator(e: KeyboardEvent): string | null {
    const parts: string[] = []

    // Modifiers
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')

    // Key (ignore if it's just a modifier)
    const key = e.key
    const ignoreKeys = ['Control', 'Alt', 'Shift', 'Meta', 'Command']
    if (ignoreKeys.includes(key)) {
      return null // Only modifiers pressed, not a complete shortcut
    }

    // Normalize key name for Electron accelerator format
    let keyName = key
    if (key.length === 1) {
      keyName = key.toUpperCase()
    } else if (key.startsWith('Arrow')) {
      keyName = key.replace('Arrow', '')
    } else if (key === ' ') {
      keyName = 'Space'
    } else if (key === 'Escape') {
      keyName = 'Esc'
    }

    parts.push(keyName)
    return parts.join('+')
  }

  function showShortcutError(key: string): void {
    shortcutInput.classList.remove('valid')
    shortcutInput.classList.add('invalid')
    shortcutError.textContent = t(key)
    shortcutError.style.display = 'block'
  }

  /**
   * Validation belongs to the session and the candidate that started it. A newer
   * Record/Reset, a recorder Cancel or a Settings discard bumps the revision, so
   * a late reply cannot revive a closed recorder or a closed session.
   */
  async function validatePendingShortcut(accelerator: string): Promise<ShortcutValidation> {
    const owner = settingsSession
    if (!owner?.baseline) return { valid: false, error: 'Invalid shortcut' }
    const revision = ++owner.validationRevision
    pendingShortcut = accelerator
    owner.validatedShortcut = null
    owner.validationResult = null
    const validation = window.api
      .invoke<ShortcutValidation>('shortcut:validate', accelerator)
      .catch(() => ({ valid: false, error: 'Invalid shortcut' }))
    owner.validation = validation
    const result = await validation
    if (
      settingsSession !== owner ||
      owner.validationRevision !== revision ||
      pendingShortcut !== accelerator
    )
      return result
    owner.validatedShortcut = accelerator
    owner.validationResult = result
    if (result.valid) {
      shortcutInput.classList.remove('invalid')
      shortcutInput.classList.add('valid')
      shortcutError.style.display = 'none'
    } else {
      // Retain the failed candidate so Save cannot silently drop it and commit
      // the other preferences instead.
      showShortcutError(result.error || 'Invalid shortcut')
    }
    return result
  }

  /**
   * Handle keydown during shortcut recording
   */
  function handleShortcutKeydown(e: KeyboardEvent): void {
    if (!isRecordingShortcut) return

    e.preventDefault()
    e.stopPropagation()

    const accelerator = buildAccelerator(e)
    if (!accelerator) return // Only modifiers, wait for main key

    shortcutInput.value = acceleratorToDisplay(accelerator)
    shortcutInput.classList.remove('recording')
    stopRecording()
    void validatePendingShortcut(accelerator)
  }

  function startRecording(): void {
    isRecordingShortcut = true
    pendingShortcut = null
    shortcutInput.value = t('Press keys...')
    shortcutInput.classList.add('recording')
    shortcutInput.classList.remove('valid', 'invalid')
    shortcutError.style.display = 'none'
    shortcutRecordBtn.textContent = t('Cancel')
    document.addEventListener('keydown', handleShortcutKeydown, true)
    updateSettingsAvailability()
  }

  /** Removes only the capture listener; it never promotes a stale result. */
  function stopRecording(): void {
    isRecordingShortcut = false
    shortcutRecordBtn.textContent = t('Record')
    document.removeEventListener('keydown', handleShortcutKeydown, true)
    updateSettingsAvailability()
  }

  function cancelRecording(): void {
    stopRecording()
    const baseline = settingsSession?.baseline ?? committedPreferences
    shortcutInput.value = acceleratorToDisplay(baseline?.summonShortcut ?? 'CommandOrControl+.')
    shortcutInput.classList.remove('recording', 'valid', 'invalid')
    shortcutError.style.display = 'none'
    pendingShortcut = null
    if (settingsSession) {
      settingsSession.validationRevision++
      settingsSession.validation = null
      settingsSession.validatedShortcut = null
      settingsSession.validationResult = null
    }
  }

  shortcutRecordBtn.addEventListener('click', () => {
    if (isRecordingShortcut) {
      cancelRecording()
    } else {
      startRecording()
    }
  })

  shortcutResetBtn.addEventListener('click', () => {
    const defaultShortcut = 'CommandOrControl+.'
    shortcutInput.value = acceleratorToDisplay(defaultShortcut)
    shortcutInput.classList.remove('recording', 'valid', 'invalid')
    shortcutError.style.display = 'none'
    stopRecording()
    void validatePendingShortcut(defaultShortcut)
  })

  /** Count only fresh, real, settled phrases - never Create/loading/error rows. */
  function updateFilteredExport(): void {
    const button = document.getElementById('export-filtered-btn') as HTMLButtonElement | null
    if (!button) return
    const state = controller.getState()
    const count =
      state.phase === 'ready' ? state.rows.filter((row) => !pendingDeletions.has(String(row.id))).length : 0
    const unsettledMatches =
      filterPhrases(
        [...pendingDeletions.values()].map((entry) => entry.row),
        state.query
      ).length > 0
    const enabled = state.phase === 'ready' && !!state.query.trim() && count > 0 && !unsettledMatches
    button.classList.toggle('hidden', !enabled)
    button.disabled = !enabled
    button.textContent = t('Export Filtered') + ' (' + count + ')'
  }

  /** The four controls a Save commits; the form itself holds the draft. */
  function readPreferenceControls(): Preferences {
    return {
      theme: settingsTheme.value as ThemeMode,
      language: languageSelect.value,
      autostart: autostartToggle.checked,
      summonShortcut:
        pendingShortcut ??
        settingsSession?.baseline?.summonShortcut ??
        committedPreferences?.summonShortcut ??
        'CommandOrControl+.',
    }
  }

  function restorePreferenceControls(value: Preferences): void {
    settingsTheme.value = value.theme
    languageSelect.value = value.language
    autostartToggle.checked = value.autostart
    shortcutInput.value = acceleratorToDisplay(value.summonShortcut)
  }

  const preferenceControls = (): HTMLInputElement[] | HTMLElement[] => [
    settingsTheme, languageSelect, autostartToggle, shortcutRecordBtn, shortcutResetBtn,
  ]

  /**
   * A null baseline is the initial configuration-loading state: the daily
   * controls and Save wait for it, while Cancel stays usable.
   */
  function updateSettingsAvailability(): void {
    if (busyControls) {
      // Rail availability is independent of the preference snapshot: a held Save
      // must still freeze category switching.
      for (const tab of settingsTabs) tab.disabled = true
      return
    }
    const ready = !!settingsSession?.baseline
    for (const control of preferenceControls()) {
      ;(control as HTMLInputElement).disabled = !ready
    }
    // The rail never waits for baseline configuration - only for the recorder.
    for (const tab of settingsTabs) tab.disabled = isRecordingShortcut
    btnSettingsSave.disabled = !ready || isRecordingShortcut
  }

  let busyControls: Map<HTMLElement, boolean> | null = null

  /**
   * saving disables the editable preferences; committing additionally blocks
   * dismissal, because a submitted Save can already have persisted something.
   */
  function setSettingsBusy(saving: boolean, committing: boolean): void {
    const targets = [...preferenceControls(), btnSettingsSave] as HTMLElement[]
    if (saving) {
      if (!busyControls) {
        busyControls = new Map()
        for (const control of targets) {
          busyControls.set(control, (control as HTMLInputElement).disabled)
        }
      }
      for (const control of targets) (control as HTMLInputElement).disabled = true
    } else if (busyControls) {
      for (const [control, wasDisabled] of busyControls) {
        ;(control as HTMLInputElement).disabled = wasDisabled
      }
      busyControls = null
    }
    btnSettingsClose.disabled = committing
    btnSettingsCancel.disabled = committing
    if (committing) settingsDialog.setAttribute('aria-busy', 'true')
    else settingsDialog.removeAttribute('aria-busy')
    updateSettingsAvailability()
  }

  /**
   * Local category selection: DOM and session state only. It performs no config
   * read, refetch or persistence, so switching panes can never touch the draft.
   */
  function selectSettingsPane(pane: SettingsPane): void {
    selectedSettingsPane = pane
    SETTINGS_PANES.forEach((name, index) => {
      const selected = name === pane
      settingsTabs[index].setAttribute('aria-selected', String(selected))
      settingsTabs[index].tabIndex = selected ? 0 : -1
      settingsPanels[index].hidden = !selected
    })
  }

  /** Rail switching is inert while the recorder or a submitted Save owns input. */
  function railLocked(): boolean {
    return isRecordingShortcut || !!settingsSession?.saving
  }

  for (const [index, tab] of settingsTabs.entries()) {
    tab.addEventListener('click', () => {
      if (railLocked()) return
      selectSettingsPane(SETTINGS_PANES[index])
    })
    tab.addEventListener('keydown', (event) => {
      if (
        railLocked() ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        composition.isActive()
      )
        return
      const last = SETTINGS_PANES.length - 1
      let target: number
      if (event.key === 'ArrowDown') target = index === last ? 0 : index + 1
      else if (event.key === 'ArrowUp') target = index === 0 ? last : index - 1
      else if (event.key === 'Home') target = 0
      else if (event.key === 'End') target = last
      else return
      event.preventDefault()
      // Automatic activation: every panel already exists locally, so selection
      // and focus move together.
      selectSettingsPane(SETTINGS_PANES[target])
      settingsTabs[target].focus()
    })
  }

  /** The single Settings initializer: gear, ui:openSettings and Ctrl+, share it. */
  function openSettings(pane: SettingsPane = 'preferences'): void {
    if (window.modals.isSettingsModalOpen() || window.modals.hasOpenModals() || isRecordingShortcut) return
    controller.cancelEnter()
    settingsSession = {
      id: ++settingsSessionId,
      baseline: committedPreferences ? { ...committedPreferences } : null,
      validationRevision: 0,
      validation: null,
      validatedShortcut: null,
      validationResult: null,
      saving: false,
      committing: false,
    }
    stopRecording()
    pendingShortcut = null
    shortcutInput.classList.remove('recording', 'valid', 'invalid')
    shortcutError.style.display = 'none'
    // A fresh session starts with a usable activate control and no inherited
    // error, whether or not the previous session's request ever came back.
    licenseActivateBtn.disabled = false
    licenseError.style.display = 'none'
    if (settingsSession.baseline) restorePreferenceControls(settingsSession.baseline)
    seedVaultDraft(window.modals.getVaultStatusSnapshot())
    updateFilteredExport()
    // Fresh opening: select the requested category and zero every panel's scroll
    // before the dialog is shown, so no panel opens mid-content.
    selectSettingsPane(pane)
    for (const panel of settingsPanels) panel.scrollTop = 0
    setSettingsBusy(false, false)
    const session = settingsSession
    window.modals.openSettingsModal()
    // Runs after the shared initial-focus rAF, and only while this session still
    // owns an open Settings dialog with nothing stacked on top of it.
    requestAnimationFrame(() => {
      if (settingsSession !== session || !window.modals.isSettingsModalOpen()) return
      if (!settingsDialog.contains(document.activeElement)) return
      settingsTabs[SETTINGS_PANES.indexOf(selectedSettingsPane)].focus()
    })
  }

  /**
   * Reapplies the opening baseline, including the theme preview, and makes any
   * outstanding validation inert. It never closes the modal itself.
   */
  function discardSettings(): void {
    const session = settingsSession
    settingsSession = null
    busyControls = null
    btnSettingsClose.disabled = false
    btnSettingsCancel.disabled = false
    settingsDialog.removeAttribute('aria-busy')
    stopRecording()
    pendingShortcut = null
    shortcutInput.classList.remove('recording', 'valid', 'invalid')
    shortcutError.style.display = 'none'
    if (session?.baseline) {
      session.validationRevision++
      restorePreferenceControls(session.baseline)
      // Restore System by its mode and the current media query, never by a
      // captured dark-class boolean.
      applyTheme(session.baseline.theme)
    }
  }

  /**
   * Ordered Save: a pending shortcut must validate and register before any other
   * preference is written, so a rejected shortcut cannot leave a saved preview.
   */
  async function saveSettings(): Promise<void> {
    const owner = settingsSession
    if (!owner?.baseline || owner.saving || isRecordingShortcut) return
    const target = readPreferenceControls()
    owner.saving = true
    setSettingsBusy(true, false)
    try {
      if (pendingShortcut !== null) {
        const validation =
          owner.validatedShortcut === target.summonShortcut
            ? owner.validationResult
            : await (owner.validation ?? validatePendingShortcut(target.summonShortcut))
        if (settingsSession !== owner) return
        if (!validation?.valid) {
          showShortcutError(validation?.error || 'Invalid shortcut')
          return
        }
      }
      owner.committing = true
      setSettingsBusy(true, true)
      // Registration is decided against what is actually registered now, not the
      // opening baseline: a Save that registered and then failed on a later write
      // leaves the two apart, and a Reset back to the baseline value still has to
      // be sent. The baseline itself stays immutable for discard.
      const registered = committedPreferences?.summonShortcut ?? owner.baseline.summonShortcut
      if (target.summonShortcut !== registered) {
        const result = await window.api.invoke<ShortcutRegistration>(
          'shortcut:set', target.summonShortcut)
        if (settingsSession !== owner) return
        if (!result.success) {
          window.modals.showToast(t(result.error || 'Failed to set shortcut'), 'danger')
          return
        }
        committedPreferences!.summonShortcut = target.summonShortcut
      }
      await window.api.invoke<boolean>('i18n:changeLanguage', target.language)
      if (settingsSession !== owner) return
      committedPreferences!.language = target.language
      window.api.send('theme:set', target.theme)
      if (target.autostart !== owner.baseline.autostart) {
        window.api.send('config:setAutostart', target.autostart)
      }

      // The Security draft commits here, with the rest of the preferences. A
      // refusal keeps the draft on screen and reports the mapped error.
      const vaultTimeout = await window.api.invoke<VaultResult>('vault:setTimeout', {
        enabled: vaultTimeoutToggle.checked,
        minutes: Number(vaultTimeoutSelect.value),
      })
      if (settingsSession !== owner) return
      if (!vaultTimeout.ok) {
        window.modals.showToast(window.modals.translateVaultError(vaultTimeout.error), 'danger')
        return
      }
      committedPreferences = { ...target }
      applyTheme(target.theme)
      stopRecording()
      pendingShortcut = null
      owner.validationRevision++
      settingsSession = null
      setSettingsBusy(false, false)
      window.modals.closeSettingsModal('save')
      window.modals.showToast(t('Settings saved'), 'success')
    } catch (error) {
      if (settingsSession === owner) {
        console.error('Failed to save settings:', error)
        window.modals.showToast(t('Failed to save settings'), 'danger')
      }
    } finally {
      if (settingsSession === owner) {
        owner.saving = false
        owner.committing = false
        setSettingsBusy(false, false)
      }
    }
  }

  // Explicit zero-argument wrappers: a click Event or an IPC payload must never
  // arrive as the pane argument.
  settingsBtn.addEventListener('click', () => openSettings())
  window.api.receive('ui:openSettings', () => openSettings())
  dbStatusBtn.addEventListener('click', () => openSettings('database'))
  // Windows-only, focused-app accelerator. macOS keeps its native Cmd+, menu item.
  document.addEventListener('keydown', (event) => {
    if (
      window.platform !== 'win32' ||
      event.key !== ',' ||
      !event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.repeat ||
      event.isComposing ||
      composition.isActive() ||
      isRecordingShortcut ||
      window.modals.hasOpenModals() ||
      !document.hasFocus()
    )
      return
    event.preventDefault()
    openSettings()
  })

  // Header close, Cancel, Escape and backdrop all reach the same app-local
  // discard policy in modal.ts.
  btnSettingsClose.addEventListener('click', () => window.modals.closeSettingsModal())
  btnSettingsCancel.addEventListener('click', () => window.modals.closeSettingsModal())
  btnSettingsSave.addEventListener('click', () => {
    void saveSettings()
  })

  // Theme is the only preference that previews; the rest wait for Save.
  settingsTheme.addEventListener('change', () => {
    if (settingsSession?.baseline && !settingsSession.saving) {
      applyTheme(settingsTheme.value as ThemeMode)
    }
  })

  // Settings: Database actions
  document.getElementById('new-db-btn')!.addEventListener('click', () => {
    window.api.send('database:new')
  })

  document.getElementById('open-db-btn')!.addEventListener('click', () => {
    window.api.send('database:open')
  })

  document.getElementById('show-db-btn')!.addEventListener('click', () => {
    window.api.send('database:showInFolder')
  })

  // Settings: Import/Export actions
  document.getElementById('import-btn')!.addEventListener('click', () => {
    window.api.send('phrases:importFile')
  })

  document.getElementById('export-all-btn')!.addEventListener('click', () => {
    window.api.send('phrases:export', { mode: 'all' })
  })

  const exportFilteredButton = document.getElementById('export-filtered-btn') as HTMLButtonElement
  exportFilteredButton.addEventListener('click', () => {
    updateFilteredExport()
    if (exportFilteredButton.disabled) return
    window.api.send('phrases:export', { mode: 'filtered', searchText: searchInput.value })
  })

  // =============================================================================
  // License Activation UI
  // =============================================================================

  const licenseKeyInput = document.getElementById('license-key-input') as HTMLInputElement
  const licenseActivateBtn = document.getElementById('license-activate-btn') as HTMLButtonElement
  const licenseDeactivateBtn = document.getElementById('license-deactivate-btn') as HTMLButtonElement
  const licenseRecoveryLink = document.getElementById('license-recovery-link') as HTMLAnchorElement
  const licenseError = document.getElementById('license-error') as HTMLElement
  const licenseSectionTrial = document.getElementById('license-section-trial') as HTMLElement
  const licenseSectionActive = document.getElementById('license-section-active') as HTMLElement
  const licenseStatusTrial = document.getElementById('license-status-trial') as HTMLElement
  const licenseEmail = document.getElementById('license-email') as HTMLElement
  const licenseIdDisplay = document.getElementById('license-id-display') as HTMLElement

  // Every license read is numbered, so an older status reply that lands after a
  // newer one cannot repaint the band with a stale answer.
  let licenseRead = 0

  // Update license status display
  async function updateLicenseUI(): Promise<void> {
    // A completion released after close/reopen belongs to the old session and
    // must not touch the new one's license UI, error state or focus.
    const owner = settingsSession
    const read = ++licenseRead
    try {
      const status = await window.api.invoke<{
        hasLicense: boolean
        license: { payload?: { email?: string; id?: string } } | null
        trial: { active: boolean; daysRemaining: number; expired: boolean }
        isLegacyUser: boolean
      }>('license:getStatus')

      if (settingsSession !== owner || read !== licenseRead) return

      // Refresh only the license nodes: a status change never touches the
      // preference draft. If the focused control disappears, move focus to a
      // surviving relevant control.
      const focusWasTrial = licenseSectionTrial.contains(document.activeElement)
      const focusWasActive = licenseSectionActive.contains(document.activeElement)
      licenseSectionTrial.style.display = status.hasLicense ? 'none' : 'block'
      licenseSectionActive.style.display = status.hasLicense ? 'block' : 'none'
      if (status.hasLicense) {
        licenseEmail.textContent = status.license?.payload?.email || ''
        const id = status.license?.payload?.id || ''
        licenseIdDisplay.textContent = id
        licenseIdDisplay.style.display = id ? 'block' : 'none'
      } else {
        licenseStatusTrial.textContent = status.trial.expired
          ? t('trial_expired')
          : status.trial.active
            ? t('trial_days_remaining').replace('{{days}}', String(status.trial.daysRemaining))
            : t('Unlicensed')
        licenseStatusTrial.className = status.trial.expired
          ? 'text-sm text-danger-500'
          : 'text-sm settings-status-muted'
      }
      // The band that just disappeared owned focus: hand it to the selected
      // rail tab, which is visible in every pane. Theme can be hidden.
      if (status.hasLicense && focusWasTrial) {
        settingsTabs[SETTINGS_PANES.indexOf(selectedSettingsPane)].focus()
      }
      if (!status.hasLicense && focusWasActive) licenseKeyInput.focus()
    } catch (error) {
      console.error('Failed to get license status:', error)
    }
  }

  // Activate license
  if (licenseActivateBtn) {
    licenseActivateBtn.addEventListener('click', async () => {
      const key = licenseKeyInput.value.trim()
      if (!key) {
        licenseError.textContent = t('license_error_empty')
        licenseError.style.display = 'block'
        return
      }

      // Validate format (should start with PV-)
      if (!key.startsWith('PV-')) {
        licenseError.textContent = t('license_error_format')
        licenseError.style.display = 'block'
        return
      }

      // The Settings session that started this activation owns its completion.
      // A reply released after close/reopen belongs to a dialog that no longer
      // exists and must not write the current session's key, error or band.
      const owner = settingsSession
      licenseActivateBtn.disabled = true
      licenseError.style.display = 'none'

      try {
        const result = await window.api.invoke<{ success: boolean; error?: string; payload?: { email: string } }>('license:activate', key)
        if (settingsSession !== owner) return
        if (result.success) {
          licenseKeyInput.value = ''
          window.modals.showToast(t('license_activated'), 'success')
          updateLicenseUI()
          // Hide legacy migration modal if visible
          window.modals.closeLegacyMigrationModal()
        } else {
          licenseError.textContent = result.error || t('license_error_invalid')
          licenseError.style.display = 'block'
        }
      } catch (error) {
        if (settingsSession !== owner) return
        licenseError.textContent = t('license_error_invalid')
        licenseError.style.display = 'block'
      } finally {
        // Re-enabling is a session-owned write too: a stale reply must not
        // release a button the current session is holding disabled. Opening
        // Settings resets it, so this cannot strand the control.
        if (settingsSession === owner) licenseActivateBtn.disabled = false
      }
    })
  }

  // Deactivate license
  if (licenseDeactivateBtn) {
    licenseDeactivateBtn.addEventListener('click', async () => {
      const owner = settingsSession
      try {
        await window.api.invoke('license:deactivate')
        if (settingsSession !== owner) return
        window.modals.showToast(t('license_deactivated'), 'success')
        updateLicenseUI()
      } catch (error) {
        console.error('Failed to deactivate license:', error)
      }
    })
  }

  // Recovery link
  if (licenseRecoveryLink) {
    licenseRecoveryLink.addEventListener('click', (e) => {
      e.preventDefault()
      window.api.send('shell:openExternal', 'https://phrasevault.app/get-license')
    })
  }

  // Buy reuses the purchase reminder's pricing route. It commits no preference
  // and is not a reminder dismissal.
  document.getElementById('license-buy-btn')!.addEventListener('click', () => {
    window.api.send('shell:openExternal', 'https://phrasevault.app/pricing')
  })

  // Clear error on input
  if (licenseKeyInput) {
    licenseKeyInput.addEventListener('input', () => {
      licenseError.style.display = 'none'
    })
  }

  // Settings: Help links
  document.getElementById('link-docs')!.addEventListener('click', (e) => {
    e.preventDefault()
    window.api.send('shell:openExternal', 'https://phrasevault.app/help')
  })

  document.getElementById('link-issues')!.addEventListener('click', (e) => {
    e.preventDefault()
    window.api.send('shell:openExternal', 'https://github.com/ptmrio/phrasevault/issues')
  })

  document.getElementById('link-license')!.addEventListener('click', (e) => {
    e.preventDefault()
    window.modals.openMarkdownModal({
      file: 'license.md',
      title: t('View License Agreement'),
    })
  })

  document.getElementById('link-thirdparty')!.addEventListener('click', (e) => {
    e.preventDefault()
    window.modals.openMarkdownModal({
      file: 'thirdparty.md',
      title: t('Third Party Licenses'),
    })
  })

  // Check for Updates
  document.getElementById('check-updates-btn')!.addEventListener('click', () => {
    window.api.send(
      'shell:openExternal',
      `https://phrasevault.app/download?currentVersion=${appVersion}`
    )
  })

  // Receive settings metadata. config:init is an untagged reply that can arrive
  // after the user starts editing, so it refreshes platform/version/license only
  // and seeds the preference cache exactly once.
  window.api.receive('config:init', (settings: unknown) => {
    const data = settings as SettingsData
    // Add platform class to body
    document.documentElement.dataset.platform = data.platform

    // Autostart (show on Windows and macOS only)
    const autostartSection = document.getElementById('autostart-section') as HTMLElement
    const isMac = data.platform === 'darwin'
    const isWindows = data.platform === 'win32'
    if (isWindows || isMac) {
      autostartSection.style.display = ''
      // Update label based on platform
      const autostartLabel = autostartSection.querySelector('span[data-i18n]')
      if (autostartLabel) {
        const key = isMac ? 'Start at Login' : 'Start with Windows'
        autostartLabel.setAttribute('data-i18n', key)
        autostartLabel.textContent = t(key)
      }
    } else {
      autostartSection.style.display = 'none'
    }

    // License status (async update)
    updateLicenseUI()

    // Version
    appVersion = data.version
    const versionText = document.getElementById('version-text')
    if (versionText) {
      versionText.textContent = `${t('Version')} ${data.version}`
    }

    // Preferences: never overwrite a session baseline, a draft control, the
    // preview, or a newer committed Save. A late reply is not an acknowledgement.
    if (committedPreferences) return
    committedPreferences = {
      theme: data.theme,
      language: data.language,
      autostart: data.autostart,
      summonShortcut: data.summonShortcut || 'CommandOrControl+.',
    }
    // Set HTML lang attribute for screen readers and spellcheck. After this
    // first seed, html.lang follows the real i18n:languageChanged event.
    document.documentElement.lang = data.language
    if (settingsSession && !settingsSession.baseline) {
      // Settings opened before configuration arrived: no editable draft existed.
      settingsSession.baseline = { ...committedPreferences }
      restorePreferenceControls(settingsSession.baseline)
      updateSettingsAvailability()
    } else if (!settingsSession) {
      restorePreferenceControls(committedPreferences)
    }
  })

  // One startup request, with the listener already registered above.
  window.api.send('config:get')

  // Receive recent databases
  window.api.receive('database:recentList', (files: unknown) => {
    const recentFiles = files as string[]
    const container = document.getElementById('recent-databases') as HTMLElement
    container.innerHTML = ''

    if (recentFiles && recentFiles.length > 0) {
      const label = document.createElement('span')
      label.id = 'recent-databases-label'
      label.className = 'text-xs settings-status-muted mb-1 block'
      label.textContent = t('Recent Databases') + ':'
      container.appendChild(label)

      recentFiles.slice(0, 5).forEach((file) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn btn-ghost btn-sm justify-start font-sans w-full'
        // Display truncates; the tooltip and the accessible name keep the path.
        btn.textContent = truncatePath(file, 55)
        btn.title = file
        btn.setAttribute('aria-label', file)
        btn.addEventListener('click', () => {
          window.api.send('database:openRecent', file)
        })
        container.appendChild(btn)
      })
    }
  })

  // Listen for shortcut changes from main process. During Save this can arrive
  // before shortcut:set resolves; it updates the committed cache only.
  window.api.receive('shortcut:changed', (accelerator: unknown) => {
    const shortcut = accelerator as string
    if (committedPreferences) committedPreferences.summonShortcut = shortcut
    if (settingsSession || isRecordingShortcut) return
    shortcutInput.value = acceleratorToDisplay(shortcut)
  })

  // =============================================================================
  // Phrase List & Search
  // =============================================================================

  // Leading magnifier flushes the same coalesced request without inserting.
  // It is also the mouse retry for a failed read; it never opens an editor.
  searchButton.addEventListener('click', () => {
    controller.cancelEnter()
    searchInput.focus()
    controller.flush()
  })

  /** Clear exists for the raw query, so whitespace still offers it. */
  function syncSearchClear(): void {
    searchClear.hidden = searchInput.value.length === 0
    searchClear.disabled = searchClear.hidden
  }

  searchInput.addEventListener('input', syncSearchClear)
  searchClear.addEventListener('click', () => {
    controller.cancelEnter()
    searchInput.value = ''
    syncSearchClear()
    controller.setQuery('', true)
    searchInput.focus()
  })
  syncSearchClear()

  // =============================================================================
  // Phrase Modal & List Management
  // =============================================================================

  function checkScrollbar(): void {
    if (phraseList.scrollHeight > phraseList.clientHeight) {
      phraseList.style.paddingRight = '5px'
    } else {
      phraseList.style.paddingRight = '0'
    }
  }

  checkScrollbar()
  window.addEventListener('resize', checkScrollbar)

  const scrollObserver = new MutationObserver(checkScrollbar)
  scrollObserver.observe(phraseList, { childList: true, subtree: true })

  window.addEventListener('beforeunload', () => {
    scrollObserver.disconnect()
  })

  /**
   * The single blank-editor entry point: the trailing + and the focused-app
   * Ctrl/Cmd+N accelerator. It cancels a pending P0 Enter before opening and
   * never prefills from the current query.
   */
  function openBlankPhrase(event?: KeyboardEvent): void {
    if (
      window.modals.hasOpenModals() ||
      isRecordingShortcut ||
      composition.isActive() ||
      !document.hasFocus() ||
      document.hidden ||
      (event && composition.blocks(event))
    )
      return
    if (event) {
      const modifier =
        window.platform === 'darwin'
          ? event.metaKey && !event.ctrlKey
          : window.platform === 'win32' && event.ctrlKey && !event.metaKey
      if (
        !modifier ||
        event.key.toLowerCase() !== 'n' ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      )
        return
      event.preventDefault()
    }
    controller.cancelEnter()
    window.modals.openPhraseForm('', '', 'text', null)
  }

  addPhraseButton.addEventListener('click', () => openBlankPhrase())
  document.addEventListener('keydown', openBlankPhrase)

  /**
   * Which of the rows currently on screen are protected. PhraseRow carries the
   * flag but not the body, so this is all the renderer needs to decide whether
   * an operation has to ask for the PIN first.
   */
  const lockedIds = new Set<number>()

  function renderRows(phraseData: readonly PhraseRow[]): void {
    lockedIds.clear()
    for (const row of phraseData) if (row.locked === 1) lockedIds.add(row.id)
    // Rows hidden by a pending deletion stay out of the rendered list.
    const visiblePhrases = phraseData.filter((p) => !pendingDeletions.has(String(p.id)))

    visiblePhrases.forEach((phrase) => {
      const li = document.createElement('li')
      li.tabIndex = 0
      li.className = 'phrase-item'
      li.setAttribute('data-id', String(phrase.id))

      const span = document.createElement('span')
      span.className = 'flex-1 min-w-0 truncate'
      const strong = document.createElement('strong')
      strong.textContent =
        phrase.phrase.length > 200 ? phrase.phrase.substring(0, 200) : phrase.phrase
      span.appendChild(strong)
      if (phrase.locked === 1) {
        // No preview and no placeholder dots: a dot count would leak the length.
        const lockGlyph = createIcon('lock', { size: 'sm' })
        lockGlyph.classList.add('phrase-lock-glyph')
        lockGlyph.setAttribute('role', 'img')
        lockGlyph.setAttribute('aria-label', t('vault_row_locked'))
        span.appendChild(document.createTextNode(' '))
        span.appendChild(lockGlyph)
      } else {
        span.appendChild(document.createTextNode(' - ' + phrase.expanded_text))
      }

      const divButtons = document.createElement('div')
      divButtons.className = 'flex gap-1 flex-shrink-0'

      // Copy button
      const copyButton = document.createElement('button')
      copyButton.className = 'phrase-action'
      copyButton.setAttribute('data-action', 'copy')
      copyButton.setAttribute('data-id', String(phrase.id))
      copyButton.title = t('Copy to clipboard')
      copyButton.appendChild(createIcon('copy', { size: 'sm' }))

      // Edit button
      const editButton = document.createElement('button')
      editButton.className = 'phrase-action'
      editButton.setAttribute('data-action', 'edit')
      editButton.setAttribute('data-id', String(phrase.id))
      editButton.title = t('Edit Phrase')
      editButton.appendChild(createIcon('edit', { size: 'sm' }))

      // More options button
      const threeDots = document.createElement('button')
      threeDots.className = 'phrase-action'
      threeDots.title = t('More')
      threeDots.appendChild(createIcon('dots-vertical', { size: 'sm' }))

      divButtons.appendChild(copyButton)
      divButtons.appendChild(editButton)
      divButtons.appendChild(threeDots)

      // Create menu
      const menu = document.createElement('div')
      menu.className = 'phrase-menu'

      // Copy ID menu item
      const copyIdItem = document.createElement('button')
      copyIdItem.type = 'button'
      copyIdItem.className = 'phrase-menu-item'
      copyIdItem.setAttribute('data-action', 'copy-id')
      copyIdItem.setAttribute('data-short-id', phrase.short_id || '')
      copyIdItem.appendChild(createIcon('link', { size: 'sm' }))
      const spanCopyId = document.createElement('span')
      spanCopyId.textContent = t('Copy ID')
      copyIdItem.appendChild(spanCopyId)
      menu.appendChild(copyIdItem)

      // Duplicate menu item
      const duplicateItem = document.createElement('button')
      duplicateItem.type = 'button'
      duplicateItem.className = 'phrase-menu-item'
      duplicateItem.setAttribute('data-action', 'duplicate')
      duplicateItem.setAttribute('data-id', String(phrase.id))
      duplicateItem.appendChild(createIcon('copy', { size: 'sm' }))
      const spanDuplicate = document.createElement('span')
      spanDuplicate.textContent = t('Duplicate Phrase')
      duplicateItem.appendChild(spanDuplicate)
      menu.appendChild(duplicateItem)

      // Delete menu item
      const deleteItem = document.createElement('button')
      deleteItem.type = 'button'
      deleteItem.className = 'phrase-menu-item'
      deleteItem.setAttribute('data-action', 'delete')
      deleteItem.setAttribute('data-id', String(phrase.id))
      deleteItem.appendChild(createIcon('trash', { size: 'sm' }))
      const spanDelete = document.createElement('span')
      spanDelete.textContent = t('Delete Phrase')
      deleteItem.appendChild(spanDelete)
      menu.appendChild(deleteItem)

      li.appendChild(span)
      li.appendChild(divButtons)
      li.appendChild(menu)

      phraseList.appendChild(li)

      // Menu toggle
      threeDots.addEventListener('click', (e) => {
        e.stopPropagation()
        if (menu.style.display === 'block') {
          menu.setAttribute('data-state', 'closed')
          menu.style.display = 'none'
        } else {
          closeAllMenus()
          menu.style.display = 'block'
          menu.setAttribute('data-state', 'open')
          // The last rows sit at the bottom of the list viewport, so a menu that
          // would clip below it opens upwards instead.
          menu.removeAttribute('data-placement')
          const menuBounds = menu.getBoundingClientRect()
          const listBounds = phraseList.getBoundingClientRect()
          if (menuBounds.bottom > listBounds.bottom) menu.dataset.placement = 'above'
        }
      })

      // Menu item actions
      li.querySelectorAll<HTMLElement>('.phrase-menu-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const action = (e.currentTarget as HTMLElement).getAttribute('data-action')
          const id = (e.currentTarget as HTMLElement).getAttribute('data-id')

          if (action === 'copy-id') {
            const shortId = (e.currentTarget as HTMLElement).getAttribute('data-short-id')
            if (shortId) {
              window.api.send('phrases:copyId', shortId)
            } else {
              window.modals.showToast(t('No ID available'), 'warning')
            }
          } else if (action === 'delete' && id) {
            // Row visibility is owned by the current render, not a style toggle.
            beginDeletion(phrase)
          } else if (action === 'duplicate' && id) {
            try {
              window.api.send('phrases:duplicate', id)
            } catch (error) {
              console.error('Failed to duplicate phrase:', error)
              window.modals.showToast(t('Failed to duplicate phrase'), 'danger')
            }
          }
          menu.style.display = 'none'
        })
      })

      // Copy button action
      copyButton.addEventListener('click', (e) => {
        e.stopPropagation()
        void (async () => {
          // A protected row asks for the PIN first, then copies exactly once.
          if (phrase.locked === 1 && !(await window.modals.ensureVaultUnlocked())) return
          try {
            // Send only the id: main reads the row and reveals it. Toasts come
            // from there, after any dynamic-insert prompts.
            window.api.send('phrases:copyToClipboard', phrase.id)
          } catch (error) {
            console.error('Failed to copy to clipboard:', error)
            window.modals.showToast(t('Failed to copy'), 'danger')
          }
        })()
      })

      // Edit button action
      editButton.addEventListener('click', (e) => {
        e.stopPropagation()
        void (async () => {
          if (phrase.locked !== 1) {
            window.modals.openPhraseForm(phrase.phrase, phrase.expanded_text, editorType(phrase.type), phrase.id)
            return
          }
          // Cancelling the PIN dialog means the composer does not open at all.
          const body = await window.modals.fetchPhraseBody(phrase.id, true)
          if (body === null) return
          window.modals.openPhraseForm(phrase.phrase, body, editorType(phrase.type), phrase.id, {
            locked: true,
          })
        })()
      })
    })
  }

  document.addEventListener('click', closeAllMenus)

  function closeAllMenus(): void {
    document.querySelectorAll<HTMLElement>('.phrase-menu').forEach((menu) => {
      menu.setAttribute('data-state', 'closed')
      menu.style.display = 'none'
    })
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  function truncatePath(path: string, maxLength = 40): string {
    if (path.length <= maxLength) return path

    const separator = path.includes('\\') ? '\\' : '/'
    const parts = path.split(separator)
    const filename = parts.pop() || ''

    // Always show filename, truncate directory part
    const availableForDir = maxLength - filename.length - 5 // 5 for ".../" or "...\"

    if (availableForDir < 10) {
      // Not enough space, just show truncated filename
      return filename.length > maxLength ? filename.slice(0, maxLength - 3) + '...' : filename
    }

    const dirPath = parts.join(separator)
    const startChars = Math.ceil(availableForDir * 0.4)
    const endChars = availableForDir - startChars

    const truncatedDir = dirPath.slice(0, startChars) + '...' + dirPath.slice(-endChars)
    return truncatedDir + separator + filename
  }

  function insertTextIntoActiveField(id: string): void {
    // A protected row asks for the PIN first; main refuses defensively too.
    if (lockedIds.has(Number(id))) {
      void (async () => {
        if (!(await window.modals.ensureVaultUnlocked())) return
        sendInsert(id)
      })()
      return
    }
    sendInsert(id)
  }

  function sendInsert(id: string): void {
    try {
      window.api.send('phrases:insertById', id)
    } catch (error) {
      console.error('Failed to insert phrase:', error)
      window.modals.showToast(t('Failed to insert phrase'), 'danger')
    }
  }

  // =============================================================================
  // IPC Event Handlers
  // =============================================================================

  window.api.receive('ui:focusSearch', () => {
    // Summon refreshes and cancels any older pending Enter; it never inserts.
    controller.cancelEnter()
    controller.refresh()
    if (window.modals.hasOpenModals()) return
    searchInput.focus()
    searchInput.select()
  })

  window.api.receive('phrases:added', () => {
    window.modals.closePhraseModal()
    controller.refresh()
    // The acknowledgement already closed the composer, so this only proves the
    // picker session was torn down; it never reopens or refetches.
    window.modals.invalidatePhrasePicker()
  })

  window.api.receive('phrases:duplicated', (phrase: unknown) => {
    const data = phrase as { phrase: string }
    searchInput.value = data.phrase
    syncSearchClear()
    controller.setQuery(data.phrase, true)
    searchInput.focus()
    window.modals.invalidatePhrasePicker()
  })

  window.api.receive('phrases:edited', () => {
    window.modals.closePhraseModal()
    controller.refresh()
    window.modals.invalidatePhrasePicker()
  })

  window.api.receive('phrases:deleted', (value: unknown) => {
    const id = String(value)
    const entry = pendingDeletions.get(id)
    // A directly acknowledged mutation (for example the disposable E2E fixture)
    // still refreshes; raw rows are invalidated before the mask is lifted.
    controller.refresh()
    if (entry) {
      clearTimeout(entry.timer)
      entry.dismiss()
      pendingDeletions.delete(id)
      syncPending()
    }
    // A directly acknowledged delete has no pending record to sync, so the
    // committed event still has to invalidate an open picker itself.
    window.modals.invalidatePhrasePicker()
  })

  // DOM-based ESC key handler
  // Note: This replaces the IPC-based handler to allow the shared modal system's
  // ESC handler to work properly (main process no longer blocks DOM events)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // The shared modal system handles ESC for open modals via its own listener
      // We only handle window minimize when no modals are open
      if (window.modals.hasOpenModals()) {
        // Let shared modal system handle it (it will call hideTopModal)
        return
      }

      // Close any open menus
      const openMenu = document.querySelector('.phrase-menu[data-state="open"]')
      if (openMenu) {
        closeAllMenus()
        return
      }

      // No modals, no menus - hide the palette to the tray
      try {
        window.api.send('app:hideToTray')
      } catch (error) {
        console.error('Failed to hide window to tray:', error)
      }
    }
  })

  window.api.receive('ui:toast', (message: unknown) => {
    const data = message as ToastMessage
    window.modals.showToast(data.message, data.type)
  })

  // Import preview
  window.api.receive('phrases:importPreview', (data: unknown) => {
    window.modals.openImportPreviewModal(data as ImportAnalysis)
  })

  // Import complete — refresh through the same correlated request path
  window.api.receive('phrases:importComplete', () => {
    controller.refresh()
    window.modals.invalidatePhrasePicker()
  })

  // Import confirm/cancel button handlers
  const importConfirmBtn = document.getElementById('btn-import-confirm')
  if (importConfirmBtn) {
    importConfirmBtn.addEventListener('click', () => {
      window.modals.confirmImport()
    })
  }

  const importCancelBtn = document.getElementById('btn-import-cancel')
  if (importCancelBtn) {
    importCancelBtn.addEventListener('click', () => {
      window.modals.closeImportPreviewModal()
    })
  }

  // =============================================================================
  // License Agreement
  // =============================================================================

  window.api.receive('license:showAgreement', () => {
    window.modals.openMarkdownModal({
      title: t('License Agreement'),
      file: 'license.md',
      buttons: [
        {
          label: t('Decline'),
          className: 'btn btn-secondary',
          onClick: () => {
            window.api.send('license:decline')
          },
          closeModal: false,
        },
        {
          label: t('Accept'),
          className: 'btn btn-primary',
          onClick: () => {
            window.api.send('license:accept')
          },
        },
      ],
    })
  })

  // =============================================================================
  // Purchase Reminder Modal (for new trial users)
  // =============================================================================

  /**
   * Check if purchase reminder should be shown (pull-based, aligned with ExampleApp)
   * Called after initialization to show reminder for trial users in final days
   */
  async function checkAndShowPurchaseReminder(): Promise<void> {
    try {
      const shouldShow = await window.api.invoke<boolean>('license:shouldShowReminder')
      if (shouldShow) {
        window.modals.openPurchaseReminderModal()
      }
    } catch (error) {
      console.error('Failed to check purchase reminder:', error)
    }
  }

  const purchaseReminderModal = document.getElementById('modal-purchase-reminder')
  if (purchaseReminderModal) {
    purchaseReminderModal.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('#btn-purchase-reminder-buy')) {
        window.modals.closePurchaseReminderModal()
        window.api.send('shell:openExternal', 'https://phrasevault.app/pricing')
      } else if (target.closest('#btn-purchase-reminder-later') || target.closest('#btn-purchase-reminder-close')) {
        window.modals.closePurchaseReminderModal()
        window.api.invoke('license:markReminderShown')
      }
    })
  }

  // =============================================================================
  // Legacy Migration Modal (for honor-system users)
  // =============================================================================

  window.api.receive('license:showLegacyMigration', () => {
    window.modals.openLegacyMigrationModal()
  })

  const legacyMigrationModal = document.getElementById('modal-legacy-migration')
  if (legacyMigrationModal) {
    legacyMigrationModal.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('#btn-legacy-migration-get')) {
        window.api.send('shell:openExternal', 'https://phrasevault.app/recover-license')
      } else if (target.closest('#btn-legacy-migration-enter')) {
        // Wait for the migration modal to actually leave the stack, then use the
        // shared initializer so this entry also receives a draft baseline.
        window.modals.closeLegacyMigrationModal(() => {
          openSettings()
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (window.modals.isSettingsModalOpen() && licenseKeyInput.offsetParent !== null) {
                licenseKeyInput.focus()
              }
            }, 100)
          })
        })
      } else if (target.closest('#btn-legacy-migration-later') || target.closest('#btn-legacy-migration-close')) {
        window.modals.closeLegacyMigrationModal()
      }
    })
  }

  // =============================================================================
  // Initialize
  // =============================================================================

  updateList()

  // Check for purchase reminder (pull-based, after other modals have chance to show)
  // Small delay ensures license agreement/legacy migration modals take priority
  setTimeout(() => {
    checkAndShowPurchaseReminder()
  }, 500)
})
