/**
 * Licensing module - complete license management system
 *
 * Usage:
 * ```typescript
 * import { createLicenseSystem } from '@spqrkapps/shared/main'
 *
 * const licensing = createLicenseSystem({
 *   prefix: 'MYAPP-',
 *   publicKeyHex: '...',
 *   trialDays: 14,
 *   storeName: 'myapp'
 * })
 *
 * // Check trial status
 * const trial = licensing.trial.getTrialStatus()
 *
 * // Validate and store license
 * const result = await licensing.validateAndStore('MYAPP-...')
 * ```
 */

import {
  validateLicense,
  validateLicenseFormat,
  type LicenseConfig,
  type LicensePayload,
  type LicenseValidationResult,
} from './validate'
import {
  createTrialManager,
  setDevTrialDays,
  getDevTrialDays,
  isDevTrialOverride,
  type TrialConfig,
  type TrialStatus,
  type TrialManager,
} from './trial'
import {
  createLicenseStore,
  type StoredLicense,
  type LicenseStore,
  type LicenseStoreOptions,
} from './store'
import {
  getSeatStatus,
  formatSeatDisplay,
  singleUserProvider,
  type SeatStatus,
  type SeatCountProvider,
} from './seats'

// Re-export types
export type {
  LicenseConfig,
  LicensePayload,
  LicenseValidationResult,
  TrialConfig,
  TrialStatus,
  TrialManager,
  StoredLicense,
  LicenseStore,
  LicenseStoreOptions,
  SeatStatus,
  SeatCountProvider,
}

// Re-export functions
export {
  validateLicense,
  validateLicenseFormat,
  createTrialManager,
  createLicenseStore,
  setDevTrialDays,
  getDevTrialDays,
  isDevTrialOverride,
  getSeatStatus,
  formatSeatDisplay,
  singleUserProvider,
}

export interface LicenseSystemConfig {
  /** License key prefix (e.g., 'MYAPP-') */
  prefix: string
  /** Ed25519 public key in hex format */
  publicKeyHex: string
  /** Number of trial days */
  trialDays: number
  /** Days before expiry to start showing reminders (default: 5) */
  reminderStartDays?: number
  /** Store name for persisting data */
  storeName: string
}

export interface LicenseSystem {
  /** Trial manager */
  trial: TrialManager
  /** License store */
  store: LicenseStore
  /** Validate a license key */
  validate: (key: string) => Promise<LicenseValidationResult>
  /** Validate and store a license if valid */
  validateAndStore: (key: string) => Promise<LicenseValidationResult>
  /** Get current license status */
  getStatus: () => {
    hasLicense: boolean
    trial: TrialStatus
    license: StoredLicense | null
  }
}

/**
 * Create a complete license management system for an app
 */
export function createLicenseSystem(config: LicenseSystemConfig): LicenseSystem {
  const licenseConfig: LicenseConfig = {
    prefix: config.prefix,
    publicKeyHex: config.publicKeyHex,
  }

  const trialConfig: TrialConfig = {
    trialDays: config.trialDays,
    reminderStartDays: config.reminderStartDays,
    storeName: config.storeName,
  }

  const trial = createTrialManager(trialConfig)

  // Create validator function for signature re-verification
  async function validate(key: string): Promise<LicenseValidationResult> {
    return validateLicense(key, licenseConfig)
  }

  // Create store with prefix (for payload extraction) and validator (for signature verification)
  const storeOptions: LicenseStoreOptions = {
    storeName: config.storeName,
    prefix: config.prefix,
    validator: validate,
  }
  const store = createLicenseStore(storeOptions)

  async function validateAndStore(key: string): Promise<LicenseValidationResult> {
    const result = await validateLicense(key, licenseConfig)
    if (result.valid && result.payload) {
      store.saveLicense(key, result.payload)
    }
    return result
  }

  function getStatus() {
    return {
      hasLicense: store.hasValidLicense(),
      trial: trial.getTrialStatus(),
      license: store.getLicense(),
    }
  }

  return {
    trial,
    store,
    validate,
    validateAndStore,
    getStatus,
  }
}
