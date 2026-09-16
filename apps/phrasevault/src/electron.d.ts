// Window augmentation for preload API
import type { ThemeMode, SettingsData, ToastMessage, Phrase, PhraseType, PhraseFormOptions, DynamicPromptData } from './types'
import type { ValidatedPreloadAPI } from '@spqrkapps/shared/preload'

export {}

// Modal module types
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

interface PhrasePickerContext {
  generation: number
  available: boolean
  excludedIds: readonly string[]
}

interface ModalsInit {
  onSettingsDismiss?: () => void
  canDismissSettings?: () => boolean
  /** Lazy renderer view of database generation, availability and pending deletions. */
  getPhrasePickerContext?: () => PhrasePickerContext
}

interface ModalsAPI {
  init: (elements: ModalsInit) => void
  showToast: (message: string, type?: 'success' | 'danger' | 'warning' | 'info', options?: ToastOptions) => ToastResult

  // Shared modal utilities (from @spqrkapps/shared/renderer)
  hasOpenModals: () => boolean
  hideTopModal: () => void

  // Settings Modal
  openSettingsModal: () => void
  closeSettingsModal: (reason?: 'discard' | 'save') => void
  isSettingsModalOpen: () => boolean

  // Markdown Modal
  openMarkdownModal: (options: MarkdownModalOptions) => void
  closeMarkdownModal: () => void
  isMarkdownModalOpen: () => boolean

  // Phrase Modal
  openPhraseForm: (phrase?: string, expandedText?: string, type?: PhraseType, id?: number | string | null, options?: PhraseFormOptions) => void
  closePhraseModal: () => void
  isPhraseModalOpen: () => boolean
  invalidatePhrasePicker: () => void

  // Dynamic Prompt Modal
  openDynamicModal: (data: DynamicPromptData) => void
  closeDynamicModal: () => void
  cancelDynamicModal: () => void
  isDynamicModalOpen: () => boolean

  // Purchase Reminder Modal
  openPurchaseReminderModal: () => void
  closePurchaseReminderModal: () => void
  isPurchaseReminderModalOpen: () => boolean

  // Legacy Migration Modal
  openLegacyMigrationModal: () => void
  closeLegacyMigrationModal: (onComplete?: () => void) => void
  isLegacyMigrationModalOpen: () => boolean

  // Vault (PIN lock)
  getVaultStatusSnapshot: () => import('./types').VaultStatus
  ensureVaultUnlocked: () => Promise<boolean>
  fetchPhraseBody: (id: number, locked: boolean) => Promise<string | null>
  openVaultPinModal: (mode: 'setup' | 'unlock' | 'change') => Promise<boolean>
  onVaultStatus: (listener: (next: import('./types').VaultStatus) => void) => void
  translateVaultError: (code: import('./types').VaultErrorCode, retryAfterMs?: number) => string

  // Import Preview Modal
  openImportPreviewModal: (analysis: import('./types').ImportAnalysis) => void
  closeImportPreviewModal: () => void
  confirmImport: () => void
  isImportPreviewModalOpen: () => boolean
}

declare global {
  interface Window {
    api: ValidatedPreloadAPI
    modals: ModalsAPI
    platform: NodeJS.Platform
  }

  // Global variables set in main process
  var databaseEvents: import('events').EventEmitter
  var isQuitting: boolean
}

// Module declarations for packages without types
declare module '@hurdlegroup/robotjs' {
  export function keyTap(key: string, modifiers?: string | string[]): void
  export function typeString(text: string): void
  export function setKeyboardDelay(ms: number): void
}

declare module 'node-window-manager' {
  interface Window {
    path: string
    getBounds(): { x: number; y: number; width: number; height: number }
    bringToTop(): void
  }

  interface WindowManager {
    getActiveWindow(): Window | null
    requestAccessibility(): boolean
  }

  export const windowManager: WindowManager
}

// Locale modules
declare module '../locales/en.js' {
  const locale: { translation: Record<string, string> }
  export default locale
}

declare module '../locales/es.js' {
  const locale: { translation: Record<string, string> }
  export default locale
}

declare module '../locales/pt.js' {
  const locale: { translation: Record<string, string> }
  export default locale
}

declare module '../locales/fr.js' {
  const locale: { translation: Record<string, string> }
  export default locale
}

declare module '../locales/de.js' {
  const locale: { translation: Record<string, string> }
  export default locale
}

declare module '../locales/it.js' {
  const locale: { translation: Record<string, string> }
  export default locale
}
