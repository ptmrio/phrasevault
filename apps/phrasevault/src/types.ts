// PhraseVault Type Definitions

export interface Phrase {
  id: number
  short_id: string
  phrase: string
  expanded_text: string
  type: PhraseType
  category_id: number | null
  usage_count: number
  created_at: string
  updated_at: string
}

export type PhraseType = 'text' | 'markdown' | 'mdwysiwyg' | 'html'

export interface Category {
  id: number
  name: string
  parent_id: number | null
  sort_order: number
}

export interface AppConfig {
  theme: ThemeMode
  language: string
  installDate: string | null
  purchased: boolean
  autostart: boolean
  dbPath: string
  showOnStartup: boolean
  firstRun: boolean
  initializeTables: boolean
  recentFiles: string[]
  licenseAgreed: string | boolean
  summonShortcut: string
  unlockTimeoutEnabled: boolean
  unlockTimeoutMinutes: number
  /** macOS: the user ticked "Don't ask again" on the Move to Applications offer. */
  moveToApplicationsDeclined: boolean
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface SettingsData {
  theme: ThemeMode
  language: string
  autostart: boolean
  version: string
  platform: NodeJS.Platform
  summonShortcut: string
}

export interface ToastMessage {
  type: 'success' | 'danger' | 'warning' | 'info'
  message: string
}

export interface DynamicPromptData {
  phraseId: number
  phraseType: PhraseType
  /** Absent when a protected body took part — main holds the text under pendingId. */
  text?: string
  /** Present only when a protected body took part. */
  pendingId?: string
  placeholders: Placeholder[]
  clipboardContent: string
}

export interface DynamicPromptResponse {
  phraseId: number
  phraseType: PhraseType
  text?: string
  /** When present, main uses its own stored text and ignores any text field. */
  pendingId?: string
  /** The renderer echoes this on Escape/Cancel so main can drop the slot. */
  cancelled?: boolean
  values: Record<string, string>
  clipboardContent: string
}

export interface Placeholder {
  type: string
  name: string
  label?: string
  defaultValue?: string
  fullMatch: string
}

export interface MarkdownContentResponse {
  success: boolean
  html?: string
  filename?: string
  error?: string
}

export interface DatabaseStatus {
  status: 'connected' | 'error' | 'loading'
  path?: string
  error?: string
}

import type { VaultErrorCode } from './services/lock'

export type { VaultErrorCode }

/** Broadcast on vault:changed after every state change. */
export interface VaultStatus {
  /** Database is open and readable. */
  available: boolean
  /** The vault_key row exists. */
  hasPin: boolean
  unlocked: boolean
  /** Rows with locked = 1. */
  lockedCount: number
  timeoutEnabled: boolean
  timeoutMinutes: number
  /** False when the stored kdf is unknown to this build. */
  kdfSupported: boolean
}

/** Main never sends prose for a vault failure; the renderer maps the code. */
export type VaultResult = { ok: true } | { ok: false; error: VaultErrorCode; retryAfterMs?: number }

export type VaultBodyResult = { ok: true; text: string } | { ok: false; error: VaultErrorCode }

// IPC Channel types (namespaced format)
export type ValidChannel =
  // Phrases
  | 'phrases:search'
  | 'phrases:add'
  | 'phrases:edit'
  | 'phrases:delete'
  | 'phrases:duplicate'
  | 'phrases:copyToClipboard'
  | 'phrases:copyId'
  | 'phrases:incrementUsage'
  | 'phrases:insert'
  | 'phrases:insertById'
  | 'phrases:list'
  | 'phrases:added'
  | 'phrases:duplicated'
  | 'phrases:edited'
  | 'phrases:deleted'
  | 'phrases:export'
  | 'phrases:importFile'
  | 'phrases:importConfirm'
  | 'phrases:importPreview'
  | 'phrases:importComplete'
  // Theme
  | 'theme:get'
  | 'theme:set'
  // Config
  | 'config:get'
  | 'config:init'
  | 'config:getLanguage'
  | 'config:setAutostart'
  // i18n
  | 'i18n:translate'
  | 'i18n:translate-sync'
  | 'i18n:changeLanguage'
  | 'i18n:getLanguage'
  | 'i18n:getLanguage-sync'
  | 'i18n:getAvailableLanguages'
  | 'i18n:languageChanged'
  // Database
  | 'database:new'
  | 'database:open'
  | 'database:openRecent'
  | 'database:getRecent'
  | 'database:recentList'
  | 'database:showInFolder'
  | 'database:status'
  | 'database:error'
  | 'database:switched'
  // UI
  | 'ui:toast'
  | 'ui:focusSearch'
  | 'ui:openSettings'
  // App
  | 'app:hideToTray'
  // Shell
  | 'shell:openExternal'
  // Markdown
  | 'markdown:readFile'
  | 'markdown:render'
  | 'markdown:content'
  // License
  | 'license:showAgreement'
  | 'license:accept'
  | 'license:decline'
  | 'license:showLegacyMigration'
  | 'license:activate'
  | 'license:get'
  | 'license:deactivate'
  | 'license:getTrialStatus'
  | 'license:shouldShowReminder'
  | 'license:markReminderShown'
  | 'license:getStatus'
  // Dynamic Prompts
  | 'prompt:show'
  | 'prompt:response'
  | 'prompt:showForCopy'
  | 'prompt:copyResponse'
  // Vault (PIN lock)
  | 'vault:getStatus'
  | 'vault:setup'
  | 'vault:unlock'
  | 'vault:lock'
  | 'vault:changePin'
  | 'vault:setTimeout'
  | 'vault:getPhraseBody'
  | 'vault:changed'
  // Shortcut
  | 'shortcut:get'
  | 'shortcut:set'
  | 'shortcut:validate'
  | 'shortcut:changed'

// Import/Export types

export interface ImportedPhrase {
  phrase: string
  expanded_text: string
  type: PhraseType
  short_id?: string
}

export interface ImportResult {
  phrases: ImportedPhrase[]
  warnings: string[]
  skipped: number
  source: 'phrasevault' | 'textexpander' | 'espanso'
}

export interface ImportAnalysis {
  fileName: string
  source: ImportResult['source']
  total: number
  newPhrases: ImportedPhrase[]
  conflicts: ImportConflict[]
  warnings: string[]
  skipped: number
}

export interface ImportConflict {
  imported: ImportedPhrase
  existing: Phrase
}

export interface ImportConfirmation {
  newPhrases: ImportedPhrase[]
  conflicts: Array<{
    imported: ImportedPhrase
    existingId: number
    action: 'skip' | 'overwrite'
  }>
}

/**
 * A raw row as stored by SQLite. Field names are the actual database columns;
 * `type` is a plain string because seeded/legacy rows include 'plain'.
 */
export interface PhraseRow {
  id: number
  phrase: string
  expanded_text: string
  type: string
  short_id: string
  usageCount: number
  dateAdd: string
  dateLastUsed: string
  /** 1 when the body lives in expanded_cipher and expanded_text is ''. */
  locked: 0 | 1
}

/** Optional explicit focus target for the phrase editor. */
export interface PhraseFormOptions {
  focus?: 'name' | 'content'
  /** The row was protected when the composer opened. */
  locked?: boolean
}
