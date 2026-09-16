import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  createLicenseSystem,
  setDevTrialDays,
  type LicenseSystemConfig,
  type LicensePayload,
} from '../../src/main/licensing/index'
import * as ed from '@noble/ed25519'
import * as crypto from 'crypto'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir),
  },
}))

let testDir: string

// Test key pair generated for testing purposes only
const TEST_PRIVATE_KEY_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const TEST_PUBLIC_KEY_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'

const testConfig: LicenseSystemConfig = {
  prefix: 'TEST-',
  publicKeyHex: TEST_PUBLIC_KEY_HEX,
  trialDays: 14,
  reminderStartDays: 5,
  storeName: 'license-system-test',
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function createTestLicense(payload: LicensePayload): Promise<string> {
  const payloadJson = JSON.stringify(payload)
  const payloadBytes = new TextEncoder().encode(payloadJson)
  const privateKey = hexToBytes(TEST_PRIVATE_KEY_HEX)
  const signature = await ed.signAsync(payloadBytes, privateKey)
  const payloadB64 = Buffer.from(payloadBytes).toString('base64')
  const signatureHex = bytesToHex(signature)
  return `TEST-${payloadB64}.${signatureHex}`
}

function cleanup() {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `license-system-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(testDir, { recursive: true })
  setDevTrialDays(null)
})

afterEach(() => {
  cleanup()
  setDevTrialDays(null)
})

describe('createLicenseSystem', () => {
  describe('factory function', () => {
    it('creates a complete license system', () => {
      const system = createLicenseSystem(testConfig)

      expect(system.trial).toBeDefined()
      expect(system.store).toBeDefined()
      expect(system.validate).toBeDefined()
      expect(system.validateAndStore).toBeDefined()
      expect(system.getStatus).toBeDefined()
    })
  })

  describe('validate', () => {
    it('validates correct license', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
        seats: 5,
      }
      const licenseKey = await createTestLicense(payload)

      const result = await system.validate(licenseKey)

      expect(result.valid).toBe(true)
      expect(result.payload?.email).toBe('test@example.com')
    })

    it('rejects invalid license', async () => {
      const system = createLicenseSystem(testConfig)

      const result = await system.validate('TEST-invalid.key')

      expect(result.valid).toBe(false)
    })

    it('does not store license on validation', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
      }
      const licenseKey = await createTestLicense(payload)

      await system.validate(licenseKey)

      expect(system.store.getLicense()).toBeNull()
    })
  })

  describe('validateAndStore', () => {
    it('validates and stores valid license', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'store@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-456',
        seats: 3,
      }
      const licenseKey = await createTestLicense(payload)

      const result = await system.validateAndStore(licenseKey)

      expect(result.valid).toBe(true)
      expect(system.store.getLicense()).not.toBeNull()
      expect(system.store.getLicense()?.payload.email).toBe('store@example.com')
    })

    it('does not store invalid license', async () => {
      const system = createLicenseSystem(testConfig)

      const result = await system.validateAndStore('TEST-invalid.key')

      expect(result.valid).toBe(false)
      expect(system.store.getLicense()).toBeNull()
    })

    it('stores license key along with payload', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-789',
      }
      const licenseKey = await createTestLicense(payload)

      await system.validateAndStore(licenseKey)

      expect(system.store.getLicenseKey()).toBe(licenseKey)
    })
  })

  describe('getStatus', () => {
    it('returns combined status without license', () => {
      const system = createLicenseSystem(testConfig)

      const status = system.getStatus()

      expect(status.hasLicense).toBe(false)
      expect(status.trial.active).toBe(true)
      expect(status.trial.daysRemaining).toBe(14)
      expect(status.license).toBeNull()
    })

    it('returns combined status with license', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'status@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-status',
        seats: 5,
      }
      const licenseKey = await createTestLicense(payload)

      await system.validateAndStore(licenseKey)
      const status = system.getStatus()

      expect(status.hasLicense).toBe(true)
      expect(status.license).not.toBeNull()
      expect(status.license?.payload.email).toBe('status@example.com')
    })

    it('reflects trial status', () => {
      // Write expired trial data
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'license-system-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: fifteenDaysAgo }))

      const system = createLicenseSystem(testConfig)
      const status = system.getStatus()

      expect(status.trial.expired).toBe(true)
      expect(status.trial.daysRemaining).toBe(0)
    })
  })

  describe('integration: trial and license interaction', () => {
    it('license bypasses expired trial', async () => {
      // Set up expired trial
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'license-system-test-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: fifteenDaysAgo }))

      const system = createLicenseSystem(testConfig)

      // Verify trial is expired
      expect(system.getStatus().trial.expired).toBe(true)
      expect(system.getStatus().hasLicense).toBe(false)

      // Add license
      const payload: LicensePayload = {
        email: 'licensed@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-bypass',
      }
      const licenseKey = await createTestLicense(payload)
      await system.validateAndStore(licenseKey)

      // License should be valid despite expired trial
      const status = system.getStatus()
      expect(status.hasLicense).toBe(true)
      expect(status.trial.expired).toBe(true) // Trial still shows expired
    })

    it('clearing license returns to trial', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'clear@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-clear',
      }
      const licenseKey = await createTestLicense(payload)

      await system.validateAndStore(licenseKey)
      expect(system.getStatus().hasLicense).toBe(true)

      system.store.clearLicense()

      expect(system.getStatus().hasLicense).toBe(false)
      expect(system.getStatus().trial.active).toBe(true)
    })
  })

  describe('tamper prevention integration', () => {
    it('detects tampered stored license key on verification', async () => {
      const system = createLicenseSystem(testConfig)
      const payload: LicensePayload = {
        email: 'tamper@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-tamper',
        seats: 1,
      }
      const licenseKey = await createTestLicense(payload)

      await system.validateAndStore(licenseKey)
      expect(system.getStatus().hasLicense).toBe(true)

      // Manually tamper with the stored license key (corrupt the signature)
      const filePath = path.join(testDir, 'license-system-test-license.json')
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      // Corrupt the signature portion of the key (after the '.')
      const [payloadPart] = data.license.key.split('.')
      data.license.key = `${payloadPart}.${'f'.repeat(128)}` // Invalid signature
      fs.writeFileSync(filePath, JSON.stringify(data))

      // Create new system instance to load tampered data
      const system2 = createLicenseSystem(testConfig)

      // Verify stored license should detect tampering
      const isValid = await system2.store.verifyStoredLicense()

      expect(isValid).toBe(false)
      expect(system2.store.getLicense()).toBeNull() // Should be cleared
    })
  })

  describe('config options', () => {
    it('respects custom trial days', () => {
      const customConfig: LicenseSystemConfig = {
        ...testConfig,
        trialDays: 30,
        storeName: 'custom-trial-days',
      }

      const system = createLicenseSystem(customConfig)
      const status = system.getStatus()

      expect(status.trial.daysRemaining).toBe(30)
    })

    it('respects custom reminder days', () => {
      const customConfig: LicenseSystemConfig = {
        ...testConfig,
        reminderStartDays: 3,
        storeName: 'custom-reminder-days',
      }

      // Set up trial with 4 days remaining (outside 3-day reminder window)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      const filePath = path.join(testDir, 'custom-reminder-days-trial.json')
      fs.writeFileSync(filePath, JSON.stringify({ firstLaunch: tenDaysAgo }))

      const system = createLicenseSystem(customConfig)

      expect(system.trial.shouldShowReminder()).toBe(false)
    })

    it('uses correct store name for license and trial', () => {
      const customConfig: LicenseSystemConfig = {
        ...testConfig,
        storeName: 'unique-store-name',
      }

      const system = createLicenseSystem(customConfig)
      system.trial.getTrialStatus() // Initialize trial

      // Check that files are created with correct names
      expect(fs.existsSync(path.join(testDir, 'unique-store-name-trial.json'))).toBe(true)
    })
  })
})
