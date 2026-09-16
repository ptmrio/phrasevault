/**
 * PhraseVault Configuration Service
 *
 * Uses shared createConfigService for config persistence.
 * Maintains backward compatibility with existing config.json files.
 */
import { app } from 'electron'
import path from 'path'
import { createConfigService, JsonStore } from '@spqrkapps/shared/main'
import type { AppConfig } from '../types'

interface ConfigData extends AppConfig {
  [key: string]: unknown
}

const defaultConfig: AppConfig = {
  theme: 'system',
  // Empty means unset. A concrete 'en' default made first-run OS detection unreachable.
  language: '',
  installDate: null,
  purchased: false,
  autostart: true,
  dbPath: path.join(app.getPath('userData'), 'phrasevault.sqlite'),
  showOnStartup: true,
  firstRun: true,
  initializeTables: true,
  recentFiles: [],
  licenseAgreed: false,
  summonShortcut: 'CommandOrControl+.',
  unlockTimeoutEnabled: true,
  unlockTimeoutMinutes: 15,
  moveToApplicationsDeclined: false,
}

const configService = createConfigService<ConfigData>({
  name: 'config',
  defaults: defaultConfig as ConfigData,
  migrations: {
    '1.0.0': (store) => {
      if (!store.get('installDate')) {
        store.set('installDate', new Date().toISOString())
      }
    },
    '1.1.0': (store) => {
      // Add default summonShortcut for existing users
      if (!store.get('summonShortcut')) {
        store.set('summonShortcut', 'CommandOrControl+.')
      }
    },
  },
})

// Runtime state (not persisted)
let balloonShown = false

/**
 * Get full config object
 */
export function getConfig(): AppConfig {
  return configService.getAll()
}

/**
 * Update config with partial values
 */
export function setConfig(updates: Partial<AppConfig>): void {
  configService.setMultiple(updates as Partial<ConfigData>)
}

/**
 * Add a file to recent files list (max 10)
 */
export function addRecentFile(filePath: string): void {
  const recentFiles = configService.get('recentFiles') || []
  // Remove if already exists
  const filtered = recentFiles.filter((f) => f !== filePath)
  // Add to front
  filtered.unshift(filePath)
  // Keep max 10
  configService.set('recentFiles', filtered.slice(0, 10))
}

/**
 * Get balloon shown state (runtime, not persisted)
 */
export function getBalloonShown(): boolean {
  return balloonShown
}

/**
 * Set balloon shown state (runtime, not persisted)
 */
export function setBalloonShown(value: boolean): void {
  balloonShown = value
}

/**
 * Check if license agreement should be shown
 */
/**
 * Current license version - users must re-accept when this changes
 */
export const LICENSE_VERSION = 'SPQRK SOFTWARE LICENSE v1.1'

/**
 * Check if license agreement should be shown
 */
export function shouldShowLicenseAgreement(): boolean {
  return configService.get('licenseAgreed') !== LICENSE_VERSION
}

/**
 * Accept the license agreement
 */
export function acceptLicenseAgreement(): void {
  configService.set('licenseAgreed', LICENSE_VERSION)
}

// Legacy compatibility export
export const configStore: JsonStore<ConfigData> = configService._store
