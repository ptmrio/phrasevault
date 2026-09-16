/**
 * The vault channel contract.
 *
 * The handlers under test are the ones production registers: registerVaultHandlers
 * is given a fake `handle` and the replies it produces are inspected directly. The
 * preload allowlist is read by importing the real preload module and capturing the
 * array it hands to createPreloadAPI, so a channel that exists only in a comment
 * cannot pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getVaultStatus,
  isUnlocked,
  lock,
  protect,
  setVaultBroadcast,
  setVaultConfigAccess,
  setVaultDb,
} from '../src/services/lock'
import type { LockableRow, VaultDb } from '../src/services/lock'
import { registerVaultHandlers } from '../src/vault-ipc'
import type { ValidChannel, VaultBodyResult, VaultResult, VaultStatus } from '../src/types'

/** Every vault channel, typed: an unlisted name would not compile. */
const VAULT_CHANNELS: ValidChannel[] = [
  'vault:getStatus',
  'vault:setup',
  'vault:unlock',
  'vault:lock',
  'vault:changePin',
  'vault:setTimeout',
  'vault:getPhraseBody',
  'vault:changed',
]

const INVOKE_CHANNELS = VAULT_CHANNELS.filter((c) => c !== 'vault:changed')

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

let handlers: Map<string, Handler>
let rows: Map<number, LockableRow>
let envelope: string | null
let timeoutConfig: { unlockTimeoutEnabled: boolean; unlockTimeoutMinutes: number }
let broadcasts: VaultStatus[]

function fakeDb(): VaultDb {
  return {
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
      if (sql.includes('FROM vault_key')) return (envelope === null ? undefined : { envelope }) as T | undefined
      if (sql.includes('COUNT(*)')) {
        return { count: [...rows.values()].filter((r) => r.locked === 1).length } as unknown as T
      }
      if (sql.includes('FROM phrases')) return rows.get(params[0] as number) as T | undefined
      return undefined
    },
    async run(sql: string, params: readonly unknown[] = []): Promise<void> {
      if (sql.includes('INTO vault_key') || sql.includes('UPDATE vault_key')) {
        envelope = params[0] as string
        return
      }
      if (sql.includes('UPDATE phrases')) {
        const id = params[params.length - 1] as number
        const row = rows.get(id)
        if (!row) return
        if (sql.includes('locked = 1')) {
          rows.set(id, { ...row, locked: 1, expanded_text: '', expanded_cipher: params[0] as string })
        } else {
          rows.set(id, { ...row, locked: 0, expanded_text: params[0] as string, expanded_cipher: null })
        }
      }
    },
  }
}

function invoke(channel: ValidChannel, payload?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler({}, payload)
}

beforeEach(() => {
  handlers = new Map()
  rows = new Map()
  envelope = null
  timeoutConfig = { unlockTimeoutEnabled: true, unlockTimeoutMinutes: 15 }
  broadcasts = []
  setVaultDb(fakeDb())
  setVaultConfigAccess({
    get: () => timeoutConfig,
    set: (next) => {
      timeoutConfig = next
    },
  })
  setVaultBroadcast((status) => {
    broadcasts.push(status)
  })
  lock()
  registerVaultHandlers({
    handle: (channel, handler) => {
      handlers.set(channel, handler)
    },
    getLockableRowById: async (id) => rows.get(id) ?? null,
  })
})

afterEach(() => {
  lock()
  setVaultDb(null)
  setVaultConfigAccess(null)
  setVaultBroadcast(null)
})

describe('registration', { timeout: 60000 }, () => {
  it('registers exactly the seven invoke channels and never vault:changed', () => {
    expect([...handlers.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort())
    expect(handlers.has('vault:changed')).toBe(false)
  })

  it('every vault channel uses domain:action form', () => {
    for (const channel of VAULT_CHANNELS) expect(channel).toMatch(/^vault:[a-zA-Z]+$/)
  })

  it('is listed in the preload allowlist that production actually builds', async () => {
    const captured: string[][] = []
    vi.doMock('electron', () => ({ contextBridge: { exposeInMainWorld: vi.fn() } }))
    vi.doMock('@spqrkapps/shared/preload', () => ({
      createPreloadAPI: (channels: readonly string[]) => {
        captured.push([...channels])
        return {}
      },
      COMMON_CHANNELS: [] as string[],
      applyPlatformAttribute: vi.fn(),
    }))
    vi.resetModules()
    await import('../src/preload')
    expect(captured).toHaveLength(1)
    for (const channel of VAULT_CHANNELS) expect(captured[0]).toContain(channel)
    vi.doUnmock('electron')
    vi.doUnmock('@spqrkapps/shared/preload')
    vi.resetModules()
  })
})

describe('payload validation', { timeout: 60000 }, () => {
  it('vault:setTimeout accepts only the five allowed values', async () => {
    expect(await invoke('vault:setTimeout', { enabled: true, minutes: 15 })).toEqual({ ok: true })
    expect(timeoutConfig).toEqual({ unlockTimeoutEnabled: true, unlockTimeoutMinutes: 15 })
    expect(await invoke('vault:setTimeout', { enabled: false, minutes: 1440 })).toEqual({ ok: true })
    expect(timeoutConfig).toEqual({ unlockTimeoutEnabled: false, unlockTimeoutMinutes: 1440 })

    const before = { ...timeoutConfig }
    for (const bad of [0, 7, 60.5, -15, 100000, '15', null, undefined, NaN]) {
      expect(await invoke('vault:setTimeout', { enabled: true, minutes: bad })).toEqual({
        ok: false,
        error: 'unavailable',
      })
    }
    expect(await invoke('vault:setTimeout', { enabled: 'yes', minutes: 15 })).toEqual({
      ok: false,
      error: 'unavailable',
    })
    expect(await invoke('vault:setTimeout', null)).toEqual({ ok: false, error: 'unavailable' })
    // A refused payload changes nothing.
    expect(timeoutConfig).toEqual(before)
  })

  it('vault:setup and vault:unlock accept only string PINs', async () => {
    for (const bad of [1234, null, undefined, {}, []]) {
      expect(await invoke('vault:setup', { pin: bad })).toEqual({ ok: false, error: 'too-short' })
      expect(await invoke('vault:unlock', { pin: bad })).toEqual({ ok: false, error: 'too-short' })
    }
    expect(await invoke('vault:setup', undefined)).toEqual({ ok: false, error: 'too-short' })
    expect(envelope).toBeNull()
  })

  it('vault:getPhraseBody accepts only finite integer ids', async () => {
    for (const bad of ['7', 7.5, NaN, Infinity, null, undefined]) {
      expect(await invoke('vault:getPhraseBody', { id: bad })).toEqual({ ok: false, error: 'unavailable' })
    }
  })

  it('vault:changePin requires two string PINs', async () => {
    expect(await invoke('vault:changePin', { currentPin: 1234, newPin: '5678' })).toEqual({
      ok: false,
      error: 'too-short',
    })
    expect(await invoke('vault:changePin', { currentPin: '1234', newPin: null })).toEqual({
      ok: false,
      error: 'too-short',
    })
  })
})

describe('handler behaviour', { timeout: 120000 }, () => {
  it('vault:getStatus reports the no-PIN state', async () => {
    expect(await invoke('vault:getStatus')).toMatchObject({
      available: true,
      hasPin: false,
      unlocked: false,
      lockedCount: 0,
    })
  })

  it('vault:setup creates the PIN, leaves the session unlocked, and refuses a second setup', async () => {
    expect(await invoke('vault:setup', { pin: '1234' })).toEqual({ ok: true })
    expect(isUnlocked()).toBe(true)
    expect(await invoke('vault:getStatus')).toMatchObject({ hasPin: true, unlocked: true })
    expect(await invoke('vault:setup', { pin: '5678' })).toEqual({ ok: false, error: 'has-pin' })
  })

  it('vault:setup refuses a PIN shorter than four characters', async () => {
    expect(await invoke('vault:setup', { pin: '123' })).toEqual({ ok: false, error: 'too-short' })
    expect(envelope).toBeNull()
  })

  it('vault:unlock answers wrong-pin without prose and vault:lock returns the new status', async () => {
    await invoke('vault:setup', { pin: '1234' })
    await invoke('vault:lock')
    expect(isUnlocked()).toBe(false)
    expect(await invoke('vault:unlock', { pin: '4321' })).toEqual({ ok: false, error: 'wrong-pin' })
    expect(await invoke('vault:unlock', { pin: '1234' })).toEqual({ ok: true })
    const status = (await invoke('vault:lock')) as VaultStatus
    expect(status.unlocked).toBe(false)
    expect(isUnlocked()).toBe(false)
  })

  it('vault:unlock carries retryAfterMs once throttled', async () => {
    await invoke('vault:setup', { pin: '1234' })
    await invoke('vault:lock')
    for (let i = 0; i < 4; i++) {
      expect(await invoke('vault:unlock', { pin: '0000' })).toEqual({ ok: false, error: 'wrong-pin' })
    }
    const fifth = (await invoke('vault:unlock', { pin: '0000' })) as VaultResult
    expect(fifth).toMatchObject({ ok: false, error: 'wrong-pin', retryAfterMs: 5000 })
    const sixth = (await invoke('vault:unlock', { pin: '1234' })) as VaultResult
    expect(sixth).toMatchObject({ ok: false, error: 'throttled' })
    expect(sixth).toHaveProperty('retryAfterMs')
  })

  it('vault:changePin needs the current PIN and keeps existing ciphertext readable', async () => {
    await invoke('vault:setup', { pin: '1234' })
    rows.set(3, { id: 3, short_id: 'abc1234', expanded_text: 'plain', locked: 0, expanded_cipher: null })
    await protect(3, 'abc1234', 'sk-live-secret')

    expect(await invoke('vault:changePin', { currentPin: '0000', newPin: '5678' })).toEqual({
      ok: false,
      error: 'wrong-pin',
    })
    expect(await invoke('vault:changePin', { currentPin: '1234', newPin: '5678' })).toEqual({ ok: true })
    await invoke('vault:lock')
    expect(await invoke('vault:unlock', { pin: '5678' })).toEqual({ ok: true })
    expect(await invoke('vault:getPhraseBody', { id: 3 })).toEqual({ ok: true, text: 'sk-live-secret' })
  })

  it('vault:getPhraseBody refuses a locked row while locked and returns it once unlocked', async () => {
    await invoke('vault:setup', { pin: '1234' })
    rows.set(3, { id: 3, short_id: 'abc1234', expanded_text: 'plain', locked: 0, expanded_cipher: null })
    await protect(3, 'abc1234', 'sk-live-secret')
    await invoke('vault:lock')

    const refused = (await invoke('vault:getPhraseBody', { id: 3 })) as VaultBodyResult
    expect(refused).toEqual({ ok: false, error: 'locked' })
    expect(JSON.stringify(refused)).not.toContain('sk-live-secret')

    await invoke('vault:unlock', { pin: '1234' })
    expect(await invoke('vault:getPhraseBody', { id: 3 })).toEqual({ ok: true, text: 'sk-live-secret' })
  })

  it('vault:getPhraseBody returns an unprotected body without a PIN and reports a missing row', async () => {
    rows.set(4, { id: 4, short_id: 'zzz9999', expanded_text: 'ordinary', locked: 0, expanded_cipher: null })
    expect(await invoke('vault:getPhraseBody', { id: 4 })).toEqual({ ok: true, text: 'ordinary' })
    expect(await invoke('vault:getPhraseBody', { id: 999 })).toEqual({ ok: false, error: 'unavailable' })
  })

  it('reports a damaged ciphertext as corrupt rather than as a wrong PIN', async () => {
    await invoke('vault:setup', { pin: '1234' })
    rows.set(5, { id: 5, short_id: 'abc1234', expanded_text: '', locked: 1, expanded_cipher: 'not json' })
    expect(await invoke('vault:getPhraseBody', { id: 5 })).toEqual({ ok: false, error: 'corrupt' })
  })

  it('broadcasts the status after every state change', async () => {
    broadcasts.length = 0
    await invoke('vault:setup', { pin: '1234' })
    await invoke('vault:lock')
    await invoke('vault:unlock', { pin: '1234' })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(broadcasts.length).toBeGreaterThanOrEqual(3)
    expect(broadcasts.at(-1)).toMatchObject({ hasPin: true, unlocked: true })
  })

  it('never puts prose in an error reply', async () => {
    const codes = new Set([
      'locked',
      'no-pin',
      'has-pin',
      'wrong-pin',
      'too-short',
      'throttled',
      'unsupported-kdf',
      'corrupt',
      'unavailable',
    ])
    const replies = [
      await invoke('vault:unlock', { pin: '1234' }),
      await invoke('vault:setup', { pin: '1' }),
      await invoke('vault:getPhraseBody', { id: 'x' }),
      await invoke('vault:changePin', { currentPin: '1234', newPin: '5678' }),
    ] as VaultResult[]
    for (const reply of replies) {
      expect(reply.ok).toBe(false)
      if (!reply.ok) expect(codes.has(reply.error)).toBe(true)
    }
  })

  it('a status read never throws when the database goes away', async () => {
    setVaultDb(null)
    expect(await invoke('vault:getStatus')).toMatchObject({ available: false, hasPin: false, unlocked: false })
    expect(await invoke('vault:unlock', { pin: '1234' })).toEqual({ ok: false, error: 'unavailable' })
  })

  it('vault:setTimeout re-arms the live session without unlocking or locking it', async () => {
    await invoke('vault:setup', { pin: '1234' })
    expect(await invoke('vault:setTimeout', { enabled: true, minutes: 60 })).toEqual({ ok: true })
    expect(isUnlocked()).toBe(true)
    expect((await getVaultStatus()).timeoutMinutes).toBe(60)
  })
})
