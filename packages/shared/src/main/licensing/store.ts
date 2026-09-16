/**
 * License storage using JsonStore
 *
 * Security: Only the license key is stored. The payload is always extracted
 * from the signed key on read, preventing tampering with stored payload data.
 */
import { JsonStore } from '../json-store'
import { validateLicenseFormat } from './validate'
import type { LicensePayload, LicenseValidationResult } from './validate'

export interface StoredLicense {
  key: string
  payload: LicensePayload
  activatedAt: string
  timestamp: number
}

/**
 * Internal storage format - payload is NOT stored, only derived from key
 */
interface StoredLicenseData {
  key: string
  activatedAt: string
  timestamp: number
}

interface LicenseStoreData {
  license?: StoredLicenseData
  [key: string]: unknown
}

/**
 * Validator function type for re-validating stored licenses
 */
export type LicenseValidator = (key: string) => Promise<LicenseValidationResult>

export interface LicenseStoreOptions {
  storeName: string
  /** License key prefix (e.g., 'MYAPP-') - required to extract payload from key */
  prefix: string
  /** Optional validator for signature re-verification on load */
  validator?: LicenseValidator
}

/**
 * Create a license store for an app
 * @param options - Store configuration with prefix and optional validator
 */
export function createLicenseStore(options: LicenseStoreOptions) {
  const { storeName, prefix, validator } = options

  const store = new JsonStore<LicenseStoreData>({
    name: `${storeName}-license`,
    defaults: {},
  })

  // Cache for validation results to avoid repeated async validation
  let cachedValidation: { key: string; valid: boolean } | null = null

  /**
   * Save a license key. Only the key and metadata are stored.
   * The payload parameter is accepted for API compatibility but ignored -
   * payload is always extracted from the signed key on read.
   */
  function saveLicense(key: string, _payload: LicensePayload): void {
    const data: StoredLicenseData = {
      key,
      activatedAt: new Date().toISOString(),
      timestamp: Date.now(),
    }
    store.set('license', data)
    // Update cache on save (we know it's valid if we're saving)
    cachedValidation = { key, valid: true }
  }

  /**
   * Get the stored license with payload extracted from the signed key.
   * This ensures the payload cannot be tampered with in storage.
   */
  function getLicense(): StoredLicense | null {
    const stored = store.get('license')
    if (!stored || !stored.key) return null

    // Extract payload from the signed key (single source of truth)
    const result = validateLicenseFormat(stored.key, prefix)
    if (!result.valid || !result.payload) return null

    return {
      key: stored.key,
      payload: result.payload,
      activatedAt: stored.activatedAt,
      timestamp: stored.timestamp,
    }
  }

  function clearLicense(): void {
    store.delete('license')
    cachedValidation = null
  }

  /**
   * Check if stored license is valid
   * If validator is provided, re-verifies signature to prevent tampering
   */
  function hasValidLicense(): boolean {
    const license = getLicense()
    if (!license || !license.payload || !license.key) {
      return false
    }

    // If no validator provided, trust the stored data (legacy behavior)
    if (!validator) {
      return true
    }

    // Check cache first
    if (cachedValidation && cachedValidation.key === license.key) {
      return cachedValidation.valid
    }

    // Synchronously return false and validate in background
    // This prevents blocking but ensures tampering is detected on next check
    validateStoredLicense(license.key)

    // Return true optimistically on first check, cache will be updated
    // If tampered, next hasValidLicense() call will return false
    return cachedValidation?.key === license.key ? cachedValidation.valid : true
  }

  /**
   * Async validation that updates cache
   */
  async function validateStoredLicense(key: string): Promise<boolean> {
    if (!validator) return true

    try {
      const result = await validator(key)
      cachedValidation = { key, valid: result.valid }

      // If invalid, clear the tampered license
      if (!result.valid) {
        console.warn('[License] Stored license failed signature verification - clearing')
        clearLicense()
      }

      return result.valid
    } catch (error) {
      console.error('[License] Validation error:', error)
      cachedValidation = { key, valid: false }
      return false
    }
  }

  /**
   * Explicitly verify stored license signature (async)
   * Call this on app startup to ensure license hasn't been tampered with
   */
  async function verifyStoredLicense(): Promise<boolean> {
    const license = getLicense()
    if (!license || !license.key) {
      return false
    }
    return validateStoredLicense(license.key)
  }

  function getLicenseKey(): string | null {
    const license = getLicense()
    return license?.key ?? null
  }

  return {
    saveLicense,
    getLicense,
    clearLicense,
    hasValidLicense,
    getLicenseKey,
    verifyStoredLicense,
  }
}

export type LicenseStore = ReturnType<typeof createLicenseStore>
