import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  createLicenseStore,
  type LicenseValidator,
} from '../../src/main/licensing/store'
import type { LicensePayload } from '../../src/main/licensing/validate'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir),
  },
}))

let testDir: string

function cleanup() {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `license-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  cleanup()
})

const TEST_PREFIX = 'TEST-'

const testPayload: LicensePayload = {
  email: 'test@example.com',
  issued: '2025-01-01T00:00:00.000Z',
  id: 'license-123',
  seats: 5,
}

/**
 * Create a properly formatted license key.
 * Format: PREFIX-{base64(payload)}.{signature}
 * The store uses validateLicenseFormat which doesn't verify signatures,
 * so we can use a dummy signature for testing.
 */
function createTestKey(payload: LicensePayload, prefix: string = TEST_PREFIX): string {
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson).toString('base64')
  const dummySignature = '0'.repeat(128) // Ed25519 signatures are 64 bytes = 128 hex chars
  return `${prefix}${payloadB64}.${dummySignature}`
}

const testKey = createTestKey(testPayload)

describe('createLicenseStore', () => {
  describe('basic operations', () => {
    it('creates store with required options', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })
      expect(store).toBeDefined()
      expect(store.getLicense()).toBeNull()
    })

    it('saves and retrieves license with payload extracted from key', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })

      store.saveLicense(testKey, testPayload)
      const license = store.getLicense()

      expect(license).not.toBeNull()
      expect(license?.key).toBe(testKey)
      expect(license?.payload.email).toBe('test@example.com')
      expect(license?.payload.seats).toBe(5)
      expect(license?.activatedAt).toBeDefined()
      expect(license?.timestamp).toBeDefined()
    })

    it('returns null for non-existent license', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })

      expect(store.getLicense()).toBeNull()
    })

    it('clears license', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })
      store.saveLicense(testKey, testPayload)

      expect(store.getLicense()).not.toBeNull()

      store.clearLicense()

      expect(store.getLicense()).toBeNull()
    })

    it('getLicenseKey returns key or null', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })

      expect(store.getLicenseKey()).toBeNull()

      store.saveLicense(testKey, testPayload)

      expect(store.getLicenseKey()).toBe(testKey)
    })
  })

  describe('payload extraction security', () => {
    it('payload is extracted from key, not stored separately', () => {
      const store = createLicenseStore({ storeName: 'security-test', prefix: TEST_PREFIX })
      store.saveLicense(testKey, testPayload)

      // Read the raw file to verify payload is NOT stored
      const filePath = path.join(testDir, 'security-test-license.json')
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'))

      // The stored data should NOT have a payload field
      expect(rawData.license.payload).toBeUndefined()
      expect(rawData.license.key).toBe(testKey)
      expect(rawData.license.activatedAt).toBeDefined()
      expect(rawData.license.timestamp).toBeDefined()
    })

    it('tampering with stored data does not affect extracted payload', () => {
      const store = createLicenseStore({ storeName: 'tamper-test', prefix: TEST_PREFIX })
      store.saveLicense(testKey, testPayload)

      // Attempt to tamper by writing a fake payload field (should be ignored)
      const filePath = path.join(testDir, 'tamper-test-license.json')
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      rawData.license.payload = { email: 'hacker@evil.com', seats: 999, issued: '2025-01-01', id: 'fake' }
      fs.writeFileSync(filePath, JSON.stringify(rawData))

      // Create new store to load from disk
      const store2 = createLicenseStore({ storeName: 'tamper-test', prefix: TEST_PREFIX })
      const license = store2.getLicense()

      // Payload should come from the key, not the tampered field
      expect(license?.payload.email).toBe('test@example.com')
      expect(license?.payload.seats).toBe(5)
    })

    it('returns null for malformed key', () => {
      const store = createLicenseStore({ storeName: 'malformed-test', prefix: TEST_PREFIX })

      // Write data with invalid key format
      const filePath = path.join(testDir, 'malformed-test-license.json')
      fs.writeFileSync(filePath, JSON.stringify({
        license: {
          key: 'INVALID-not-a-valid-key',
          activatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        }
      }))

      // Create store to load malformed data
      const store2 = createLicenseStore({ storeName: 'malformed-test', prefix: TEST_PREFIX })

      expect(store2.getLicense()).toBeNull()
      expect(store2.hasValidLicense()).toBe(false)
    })

    it('returns null for key with wrong prefix', () => {
      const store = createLicenseStore({ storeName: 'prefix-test', prefix: 'OTHER-' })

      // Save key with TEST- prefix, but store expects OTHER- prefix
      const filePath = path.join(testDir, 'prefix-test-license.json')
      fs.writeFileSync(filePath, JSON.stringify({
        license: {
          key: testKey, // Has TEST- prefix
          activatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        }
      }))

      const store2 = createLicenseStore({ storeName: 'prefix-test', prefix: 'OTHER-' })

      expect(store2.getLicense()).toBeNull()
    })
  })

  describe('hasValidLicense without validator', () => {
    it('returns true for stored license with valid key', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })
      store.saveLicense(testKey, testPayload)

      expect(store.hasValidLicense()).toBe(true)
    })

    it('returns false for empty store', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })

      expect(store.hasValidLicense()).toBe(false)
    })

    it('returns false after clearing', () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })
      store.saveLicense(testKey, testPayload)
      store.clearLicense()

      expect(store.hasValidLicense()).toBe(false)
    })
  })

  describe('hasValidLicense with validator', () => {
    it('uses cache after save (valid)', () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: true, payload: testPayload })
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      store.saveLicense(testKey, testPayload)

      // Cache should be set on save, so hasValidLicense should return true immediately
      expect(store.hasValidLicense()).toBe(true)
      // Validator should not be called because cache was set on save
      expect(validator).not.toHaveBeenCalled()
    })

    it('validates on first check and updates cache', async () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: true, payload: testPayload })

      // Manually write license to simulate loading from disk
      const filePath = path.join(testDir, 'test-app-license.json')
      fs.writeFileSync(filePath, JSON.stringify({
        license: {
          key: testKey,
          activatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        }
      }))

      // Create store to load from disk (no cache)
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      // First call - optimistically returns true and triggers background validation
      const result = store.hasValidLicense()
      expect(result).toBe(true)

      // Wait for async validation
      await new Promise(resolve => setTimeout(resolve, 50))

      // Validator should have been called
      expect(validator).toHaveBeenCalledWith(testKey)
    })

    it('clears license when validation fails', async () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: false, payload: null, error: 'Tampered' })

      // Write license to disk
      const filePath = path.join(testDir, 'test-app-license.json')
      fs.writeFileSync(filePath, JSON.stringify({
        license: {
          key: testKey,
          activatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        }
      }))

      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      // Trigger validation
      store.hasValidLicense()

      // Wait for async validation to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      // License should be cleared
      expect(store.getLicense()).toBeNull()
    })

    it('cache invalidation on clear', async () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: true, payload: testPayload })
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      store.saveLicense(testKey, testPayload)
      expect(store.hasValidLicense()).toBe(true)

      store.clearLicense()

      expect(store.hasValidLicense()).toBe(false)
    })
  })

  describe('verifyStoredLicense', () => {
    it('returns false when no license stored', async () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: true, payload: testPayload })
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      const result = await store.verifyStoredLicense()

      expect(result).toBe(false)
      expect(validator).not.toHaveBeenCalled()
    })

    it('verifies valid license', async () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: true, payload: testPayload })
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      store.saveLicense(testKey, testPayload)
      const result = await store.verifyStoredLicense()

      expect(result).toBe(true)
      expect(validator).toHaveBeenCalledWith(testKey)
    })

    it('clears invalid license on verification', async () => {
      const validator: LicenseValidator = vi.fn().mockResolvedValue({ valid: false, payload: null, error: 'Invalid' })
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      store.saveLicense(testKey, testPayload)
      const result = await store.verifyStoredLicense()

      expect(result).toBe(false)
      expect(store.getLicense()).toBeNull()
    })

    it('returns true without validator', async () => {
      const store = createLicenseStore({ storeName: 'test-app', prefix: TEST_PREFIX })

      store.saveLicense(testKey, testPayload)
      const result = await store.verifyStoredLicense()

      expect(result).toBe(true)
    })

    it('handles validator errors gracefully', async () => {
      const validator: LicenseValidator = vi.fn().mockRejectedValue(new Error('Network error'))
      const store = createLicenseStore({
        storeName: 'test-app',
        prefix: TEST_PREFIX,
        validator,
      })

      store.saveLicense(testKey, testPayload)
      const result = await store.verifyStoredLicense()

      expect(result).toBe(false)
    })
  })

  describe('persistence', () => {
    it('persists license across store instances', () => {
      const store1 = createLicenseStore({ storeName: 'persist-test', prefix: TEST_PREFIX })
      store1.saveLicense(testKey, testPayload)

      // Create new store instance
      const store2 = createLicenseStore({ storeName: 'persist-test', prefix: TEST_PREFIX })
      const license = store2.getLicense()

      expect(license).not.toBeNull()
      expect(license?.key).toBe(testKey)
      expect(license?.payload.email).toBe('test@example.com')
    })

    it('handles missing key in stored data', () => {
      // Write malformed data without key
      const filePath = path.join(testDir, 'edge-test-license.json')
      fs.writeFileSync(filePath, JSON.stringify({
        license: {
          activatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        }
      }))

      // Create store to load data
      const store = createLicenseStore({ storeName: 'edge-test', prefix: TEST_PREFIX })

      expect(store.getLicense()).toBeNull()
      expect(store.hasValidLicense()).toBe(false)
    })
  })

  describe('activation metadata', () => {
    it('records activation timestamp', () => {
      const store = createLicenseStore({ storeName: 'timestamp-test', prefix: TEST_PREFIX })
      const before = Date.now()

      store.saveLicense(testKey, testPayload)

      const license = store.getLicense()
      const after = Date.now()

      expect(license?.timestamp).toBeGreaterThanOrEqual(before)
      expect(license?.timestamp).toBeLessThanOrEqual(after)
    })

    it('records activation date as ISO string', () => {
      const store = createLicenseStore({ storeName: 'iso-test', prefix: TEST_PREFIX })

      store.saveLicense(testKey, testPayload)

      const license = store.getLicense()
      expect(license?.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })
})
