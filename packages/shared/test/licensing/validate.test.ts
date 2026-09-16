import { describe, it, expect } from 'vitest'
import {
  validateLicense,
  validateLicenseFormat,
  type LicenseConfig,
  type LicensePayload,
} from '../../src/main/licensing/validate'
import * as ed from '@noble/ed25519'
import * as crypto from 'crypto'

// Test key pair generated for testing purposes only
// NEVER use these keys in production
const TEST_PRIVATE_KEY_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const TEST_PUBLIC_KEY_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'

const TEST_CONFIG: LicenseConfig = {
  prefix: 'TEST-',
  publicKeyHex: TEST_PUBLIC_KEY_HEX,
}

/**
 * Helper to create a valid signed license key for testing
 */
async function createTestLicense(payload: LicensePayload): Promise<string> {
  const payloadJson = JSON.stringify(payload)
  const payloadBytes = new TextEncoder().encode(payloadJson)
  const privateKey = hexToBytes(TEST_PRIVATE_KEY_HEX)
  const signature = await ed.signAsync(payloadBytes, privateKey)
  const payloadB64 = Buffer.from(payloadBytes).toString('base64')
  const signatureHex = bytesToHex(signature)
  return `TEST-${payloadB64}.${signatureHex}`
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

describe('validateLicense', () => {
  describe('format validation', () => {
    it('rejects license without correct prefix', async () => {
      const result = await validateLicense('WRONG-abc.def', TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.payload).toBeNull()
      expect(result.error).toBe('Invalid license format')
    })

    it('rejects license with missing signature part', async () => {
      const result = await validateLicense('TEST-abc', TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.payload).toBeNull()
      expect(result.error).toBe('Invalid license format')
    })

    it('rejects license with too many parts', async () => {
      const result = await validateLicense('TEST-abc.def.ghi', TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.payload).toBeNull()
      expect(result.error).toBe('Invalid license format')
    })

    it('rejects empty payload', async () => {
      const result = await validateLicense('TEST-.abc', TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.payload).toBeNull()
      expect(result.error).toBe('Invalid license format')
    })

    it('rejects empty signature', async () => {
      const result = await validateLicense('TEST-abc.', TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.payload).toBeNull()
      expect(result.error).toBe('Invalid license format')
    })
  })

  describe('signature verification', () => {
    it('accepts valid signature', async () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
        seats: 5,
      }
      const licenseKey = await createTestLicense(payload)

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(true)
      expect(result.payload).not.toBeNull()
      expect(result.payload?.email).toBe('test@example.com')
      expect(result.payload?.id).toBe('license-123')
      expect(result.payload?.seats).toBe(5)
    })

    it('rejects tampered payload', async () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
        seats: 5,
      }
      const licenseKey = await createTestLicense(payload)

      // Tamper with the payload by modifying seats count
      const tamperedPayload = { ...payload, seats: 999 }
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64')
      const [, signature] = licenseKey.slice(5).split('.')
      const tamperedLicense = `TEST-${tamperedPayloadB64}.${signature}`

      const result = await validateLicense(tamperedLicense, TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })

    it('rejects invalid signature bytes', async () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
      }
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
      // Use a random invalid signature
      const invalidSignature = '0'.repeat(128)
      const licenseKey = `TEST-${payloadB64}.${invalidSignature}`

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })

    it('rejects license signed with wrong private key', async () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
      }

      // Sign with a different key
      const wrongPrivateKey = hexToBytes('0'.repeat(64))
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
      const signature = await ed.signAsync(payloadBytes, wrongPrivateKey)
      const payloadB64 = Buffer.from(payloadBytes).toString('base64')
      const signatureHex = bytesToHex(signature)
      const licenseKey = `TEST-${payloadB64}.${signatureHex}`

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })
  })

  describe('payload validation', () => {
    it('rejects payload missing email', async () => {
      const payload = {
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
      }
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
      const privateKey = hexToBytes(TEST_PRIVATE_KEY_HEX)
      const signature = await ed.signAsync(payloadBytes, privateKey)
      const payloadB64 = Buffer.from(payloadBytes).toString('base64')
      const signatureHex = bytesToHex(signature)
      const licenseKey = `TEST-${payloadB64}.${signatureHex}`

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid payload structure')
    })

    it('rejects payload missing id', async () => {
      const payload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
      }
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
      const privateKey = hexToBytes(TEST_PRIVATE_KEY_HEX)
      const signature = await ed.signAsync(payloadBytes, privateKey)
      const payloadB64 = Buffer.from(payloadBytes).toString('base64')
      const signatureHex = bytesToHex(signature)
      const licenseKey = `TEST-${payloadB64}.${signatureHex}`

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid payload structure')
    })

    it('rejects payload missing issued date', async () => {
      const payload = {
        email: 'test@example.com',
        id: 'license-123',
      }
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
      const privateKey = hexToBytes(TEST_PRIVATE_KEY_HEX)
      const signature = await ed.signAsync(payloadBytes, privateKey)
      const payloadB64 = Buffer.from(payloadBytes).toString('base64')
      const signatureHex = bytesToHex(signature)
      const licenseKey = `TEST-${payloadB64}.${signatureHex}`

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid payload structure')
    })

    it('defaults seats to 1 when not specified', async () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
      }
      const licenseKey = await createTestLicense(payload)

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(true)
      expect(result.payload?.seats).toBe(1)
    })

    it('preserves optional fields', async () => {
      const payload: LicensePayload = {
        email: 'test@example.com',
        issued: '2025-01-01T00:00:00.000Z',
        id: 'license-123',
        seats: 10,
        upgraded: '2025-06-01T00:00:00.000Z',
        app: 'phrasevault',
      }
      const licenseKey = await createTestLicense(payload)

      const result = await validateLicense(licenseKey, TEST_CONFIG)

      expect(result.valid).toBe(true)
      expect(result.payload?.upgraded).toBe('2025-06-01T00:00:00.000Z')
      expect(result.payload?.app).toBe('phrasevault')
    })
  })

  describe('error handling', () => {
    it('handles invalid base64 payload', async () => {
      const result = await validateLicense('TEST-!!!invalid-base64!!!.abc', TEST_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Validation error')
    })

    it('handles invalid JSON in payload', async () => {
      const invalidJson = Buffer.from('not json').toString('base64')
      const fakeSignature = '0'.repeat(128)
      const result = await validateLicense(`TEST-${invalidJson}.${fakeSignature}`, TEST_CONFIG)

      expect(result.valid).toBe(false)
      // Will fail at signature verification or JSON parse
    })
  })
})

describe('validateLicenseFormat', () => {
  const TEST_PREFIX = 'FORMAT-'

  it('validates correct format without signature verification', () => {
    const payload: LicensePayload = {
      email: 'test@example.com',
      issued: '2025-01-01T00:00:00.000Z',
      id: 'license-123',
      seats: 3,
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    // Any signature will work since we're not verifying
    const licenseKey = `FORMAT-${payloadB64}.fakesignature`

    const result = validateLicenseFormat(licenseKey, TEST_PREFIX)

    expect(result.valid).toBe(true)
    expect(result.payload?.email).toBe('test@example.com')
    expect(result.payload?.seats).toBe(3)
  })

  it('rejects wrong prefix', () => {
    const payload = { email: 'test@example.com', issued: '2025-01-01', id: '123' }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    const licenseKey = `WRONG-${payloadB64}.sig`

    const result = validateLicenseFormat(licenseKey, TEST_PREFIX)

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid license format')
  })

  it('rejects missing parts', () => {
    const result = validateLicenseFormat('FORMAT-onlyonepart', TEST_PREFIX)

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid license format')
  })

  it('rejects invalid payload structure', () => {
    const payload = { email: 'test@example.com' } // missing id and issued
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    const licenseKey = `FORMAT-${payloadB64}.sig`

    const result = validateLicenseFormat(licenseKey, TEST_PREFIX)

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid payload structure')
  })

  it('defaults seats to 1', () => {
    const payload = { email: 'test@example.com', issued: '2025-01-01', id: '123' }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    const licenseKey = `FORMAT-${payloadB64}.sig`

    const result = validateLicenseFormat(licenseKey, TEST_PREFIX)

    expect(result.valid).toBe(true)
    expect(result.payload?.seats).toBe(1)
  })
})
