/**
 * The seven vault:* invoke handlers.
 *
 * Registration is injected so the contract can be driven without booting
 * Electron. Every payload is validated defensively and every failure is answered
 * with a VaultErrorCode — main never sends prose for these, the renderer maps
 * each code to an i18n key. `vault:changed` is a one-way broadcast and is
 * deliberately absent here.
 */
import {
  TIMEOUT_MINUTES,
  VaultError,
  applyTimeoutSetting,
  changePin,
  getVaultStatus,
  lock,
  revealRow,
  setTimeoutConfig,
  setupPin,
  unlock,
} from './services/lock'
import type { LockableRow } from './services/lock'
import type { ValidChannel, VaultBodyResult, VaultErrorCode, VaultResult } from './types'

export interface VaultIpcDeps {
  handle(channel: ValidChannel, listener: (event: unknown, payload: unknown) => Promise<unknown>): void
  /** Reads the row with its ciphertext. Main-only: PhraseRow cannot carry it. */
  getLockableRowById(id: number): Promise<LockableRow | null>
}

interface TimeoutPayload {
  enabled: boolean
  minutes: number
}

/** Only the five values the Security select offers are accepted. */
export function validateTimeoutPayload(payload: unknown): TimeoutPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const { enabled, minutes } = payload as { enabled?: unknown; minutes?: unknown }
  if (typeof enabled !== 'boolean') return null
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return null
  if (!(TIMEOUT_MINUTES as readonly number[]).includes(minutes)) return null
  return { enabled, minutes }
}

/** A PIN must be a string; whitespace is significant and is not trimmed. */
export function validatePinPayload(payload: unknown, field = 'pin'): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

export function validateIdPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const { id } = payload as { id?: unknown }
  if (typeof id !== 'number' || !Number.isInteger(id)) return null
  return id
}

function failure(error: unknown, fallback: VaultErrorCode): VaultResult {
  if (error instanceof VaultError) {
    return error.retryAfterMs === undefined
      ? { ok: false, error: error.code }
      : { ok: false, error: error.code, retryAfterMs: error.retryAfterMs }
  }
  // Not a VaultError: an infrastructure failure the user cannot act on. The
  // message is a driver/IO string, never a PIN, key or body, so it is safe to
  // log — and invisible otherwise, because the reply carries only a code.
  console.error('[vault] unexpected failure:', error instanceof Error ? error.message : String(error))
  return { ok: false, error: fallback }
}

export function registerVaultHandlers(deps: VaultIpcDeps): void {
  deps.handle('vault:getStatus', async () => getVaultStatus())

  deps.handle('vault:lock', async () => {
    lock()
    return getVaultStatus()
  })

  deps.handle('vault:setup', async (_event, payload): Promise<VaultResult> => {
    const pin = validatePinPayload(payload)
    if (pin === null) return { ok: false, error: 'too-short' }
    try {
      await setupPin(pin)
      return { ok: true }
    } catch (error) {
      return failure(error, 'unavailable')
    }
  })

  deps.handle('vault:unlock', async (_event, payload): Promise<VaultResult> => {
    const pin = validatePinPayload(payload)
    if (pin === null) return { ok: false, error: 'too-short' }
    try {
      await unlock(pin)
      return { ok: true }
    } catch (error) {
      return failure(error, 'unavailable')
    }
  })

  deps.handle('vault:changePin', async (_event, payload): Promise<VaultResult> => {
    const currentPin = validatePinPayload(payload, 'currentPin')
    const newPin = validatePinPayload(payload, 'newPin')
    if (currentPin === null || newPin === null) return { ok: false, error: 'too-short' }
    try {
      await changePin(currentPin, newPin)
      return { ok: true }
    } catch (error) {
      return failure(error, 'unavailable')
    }
  })

  deps.handle('vault:setTimeout', async (_event, payload): Promise<VaultResult> => {
    const next = validateTimeoutPayload(payload)
    if (!next) return { ok: false, error: 'unavailable' }
    try {
      setTimeoutConfig(next)
      applyTimeoutSetting()
      return { ok: true }
    } catch (error) {
      return failure(error, 'unavailable')
    }
  })

  deps.handle('vault:getPhraseBody', async (_event, payload): Promise<VaultBodyResult> => {
    const id = validateIdPayload(payload)
    if (id === null) return { ok: false, error: 'unavailable' }
    try {
      const row = await deps.getLockableRowById(id)
      if (!row) return { ok: false, error: 'unavailable' }
      return { ok: true, text: revealRow(row) }
    } catch (error) {
      const reply = failure(error, 'unavailable')
      return reply.ok ? { ok: false, error: 'unavailable' } : { ok: false, error: reply.error }
    }
  })
}
