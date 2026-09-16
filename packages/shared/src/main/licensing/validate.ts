/**
 * License validation using Ed25519 signatures
 * Parameterized for use by any app
 */
import * as ed from '@noble/ed25519'
import * as crypto from 'crypto'

function sha512(message: Uint8Array): Uint8Array<ArrayBuffer> {
  const digest = crypto.createHash('sha512').update(message).digest()
  return new Uint8Array(digest) as Uint8Array<ArrayBuffer>
}

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = async (message: Uint8Array) => sha512(message)

export interface LicenseConfig {
  /** License key prefix (e.g., 'APP-', 'PHRASE-') */
  prefix: string
  /** Ed25519 public key in hex format */
  publicKeyHex: string
}

export interface LicensePayload {
  /** Number of seats (default: 1 for single-user apps) */
  seats?: number
  email: string
  issued: string
  id: string
  upgraded?: string
  app?: string
  /** App-specific extra data */
  [key: string]: unknown
}

export interface LicenseValidationResult {
  valid: boolean
  payload: LicensePayload | null
  error?: string
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = Buffer.from(base64, 'base64')
  return new Uint8Array(binary)
}

/**
 * Validate a license key with Ed25519 signature verification
 */
export async function validateLicense(
  licenseKey: string,
  config: LicenseConfig
): Promise<LicenseValidationResult> {
  try {
    // Check prefix
    if (!licenseKey.startsWith(config.prefix)) {
      return { valid: false, payload: null, error: 'Invalid license format' }
    }

    const encoded = licenseKey.slice(config.prefix.length)
    const parts = encoded.split('.')

    if (parts.length !== 2) {
      return { valid: false, payload: null, error: 'Invalid license format' }
    }

    const [payloadB64, signatureHex] = parts

    if (!payloadB64 || !signatureHex) {
      return { valid: false, payload: null, error: 'Invalid license format' }
    }

    const payloadBytes = base64ToBytes(payloadB64)
    const signature = hexToBytes(signatureHex)
    const publicKey = hexToBytes(config.publicKeyHex)

    // Verify Ed25519 signature
    const valid = await ed.verifyAsync(signature, payloadBytes, publicKey)

    if (!valid) {
      return { valid: false, payload: null, error: 'Invalid signature' }
    }

    // Parse payload
    const payloadJson = Buffer.from(payloadBytes).toString('utf8')
    const payload = JSON.parse(payloadJson) as LicensePayload

    // Validate payload structure (seats is optional, defaults to 1 for single-user apps)
    if (!payload.email || !payload.id || !payload.issued) {
      return { valid: false, payload: null, error: 'Invalid payload structure' }
    }
    // Default seats to 1 if not specified
    if (typeof payload.seats !== 'number') {
      payload.seats = 1
    }

    return { valid: true, payload }
  } catch (error) {
    return { valid: false, payload: null, error: `Validation error: ${error}` }
  }
}

/**
 * Validate license format without signature verification (for development/testing)
 */
export function validateLicenseFormat(
  licenseKey: string,
  prefix: string
): LicenseValidationResult {
  try {
    if (!licenseKey.startsWith(prefix)) {
      return { valid: false, payload: null, error: 'Invalid license format' }
    }

    const encoded = licenseKey.slice(prefix.length)
    const parts = encoded.split('.')

    if (parts.length !== 2) {
      return { valid: false, payload: null, error: 'Invalid license format' }
    }

    const [payloadB64] = parts
    if (!payloadB64) {
      return { valid: false, payload: null, error: 'Invalid license format' }
    }

    const payloadBytes = base64ToBytes(payloadB64)
    const payloadJson = Buffer.from(payloadBytes).toString('utf8')
    const payload = JSON.parse(payloadJson) as LicensePayload

    if (!payload.email || !payload.id || !payload.issued) {
      return { valid: false, payload: null, error: 'Invalid payload structure' }
    }
    // Default seats to 1 if not specified
    if (typeof payload.seats !== 'number') {
      payload.seats = 1
    }

    return { valid: true, payload }
  } catch (error) {
    return { valid: false, payload: null, error: `Format error: ${error}` }
  }
}
