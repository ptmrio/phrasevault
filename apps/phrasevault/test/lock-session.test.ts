/**
 * lock.ts session: setup, unlock, backoff, timer, protect/unprotect, reveal.
 *
 * The fake VaultDb is a two-value store, which is all the module reads. Its gate
 * lets a test hold a query open so a lock or a database switch can land in the
 * middle of an in-flight operation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VaultError,
  applyTimeoutSetting,
  changePin,
  encryptFor,
  getVaultStatus,
  isUnlocked,
  lock,
  onLock,
  protect,
  revealRow,
  setVaultBroadcast,
  setVaultConfigAccess,
  setVaultDb,
  setupPin,
  unlock,
  unprotect,
} from '../src/services/lock'
import type { LockableRow, VaultDb } from '../src/services/lock'
import type { VaultStatus } from '../src/types'

const SLOW = { timeout: 60000 }

interface Gate {
  gate: Promise<void>
  release: () => void
  reached: Promise<void>
  reachedResolve: () => void
}

interface FakeState {
  envelope: string | null
  rows: Map<number, LockableRow>
  runs: Array<{ sql: string; params: readonly unknown[] }>
  hold: Gate | null
  holdRun: Gate | null
}

let state: FakeState
let broadcasts: VaultStatus[]
let timeout: { unlockTimeoutEnabled: boolean; unlockTimeoutMinutes: number }

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof VaultError ? error.code : `not-a-vault-error:${String(error)}`
  }
  return 'no-throw'
}

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return error instanceof VaultError ? error.code : `not-a-vault-error:${String(error)}`
  }
  return 'no-throw'
}

/** Let queued promise callbacks run; publish() from lock() is fire-and-forget. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/** Arm a one-shot gate that blocks the next vault_key write after it commits. */
function holdNextRun(): Gate {
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reachedResolve = (): void => {}
  const reached = new Promise<void>((resolve) => {
    reachedResolve = resolve
  })
  const held: Gate = { gate, release, reached, reachedResolve }
  state.holdRun = held
  return held
}

/** Arm a one-shot gate that blocks the next vault_key read. */
function holdNextEnvelopeRead(): Gate {
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reachedResolve = (): void => {}
  const reached = new Promise<void>((resolve) => {
    reachedResolve = resolve
  })
  const held: Gate = { gate, release, reached, reachedResolve }
  state.hold = held
  return held
}

function fakeDb(): VaultDb {
  return {
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
      if (sql.includes('FROM vault_key')) {
        const held = state.hold
        if (held) {
          state.hold = null
          held.reachedResolve()
          await held.gate
        }
        return (state.envelope === null ? undefined : { envelope: state.envelope }) as T | undefined
      }
      if (sql.includes('COUNT(*)')) {
        const count = [...state.rows.values()].filter((r) => r.locked === 1).length
        return { count } as unknown as T
      }
      if (sql.includes('FROM phrases')) return state.rows.get(params[0] as number) as T | undefined
      return undefined
    },
    async run(sql: string, params: readonly unknown[] = []): Promise<void> {
      state.runs.push({ sql, params })
      if (sql.includes('INTO vault_key') || sql.includes('UPDATE vault_key')) {
        state.envelope = params[0] as string
        const held = state.holdRun
        if (held) {
          state.holdRun = null
          held.reachedResolve()
          await held.gate
        }
        return
      }
      if (sql.includes('UPDATE phrases')) {
        const id = params[params.length - 1] as number
        const row = state.rows.get(id)
        if (!row) return
        if (sql.includes('locked = 1')) {
          state.rows.set(id, { ...row, locked: 1, expanded_text: '', expanded_cipher: params[0] as string })
        } else {
          state.rows.set(id, { ...row, locked: 0, expanded_text: params[0] as string, expanded_cipher: null })
        }
      }
    },
  }
}

beforeEach(() => {
  state = { envelope: null, rows: new Map(), runs: [], hold: null, holdRun: null }
  broadcasts = []
  timeout = { unlockTimeoutEnabled: true, unlockTimeoutMinutes: 15 }
  setVaultDb(fakeDb())
  setVaultConfigAccess({
    get: () => timeout,
    set: (next) => {
      timeout = next
    },
  })
  setVaultBroadcast((status) => {
    broadcasts.push(status)
  })
  lock()
})

afterEach(() => {
  lock()
  vi.useRealTimers()
  setVaultDb(null)
  setVaultConfigAccess(null)
  setVaultBroadcast(null)
})

describe('session', SLOW, () => {
  it('reports no-PIN status and refuses unlock', async () => {
    const status = await getVaultStatus()
    expect(status).toEqual({
      available: true,
      hasPin: false,
      unlocked: false,
      lockedCount: 0,
      timeoutEnabled: true,
      timeoutMinutes: 15,
      kdfSupported: true,
    })
    expect(await codeOfAsync(() => unlock('1234'))).toBe('no-pin')
  })

  it('reports unavailable with no database and never throws', async () => {
    setVaultDb(null)
    const status = await getVaultStatus()
    expect(status.available).toBe(false)
    expect(status.hasPin).toBe(false)
    expect(status.unlocked).toBe(false)
    expect(await codeOfAsync(() => unlock('1234'))).toBe('unavailable')
  })

  it('setupPin writes one envelope, leaves the session unlocked and broadcasts', async () => {
    await setupPin('1234')
    expect(state.envelope).not.toBeNull()
    expect(isUnlocked()).toBe(true)
    await flush()
    expect(broadcasts.at(-1)).toMatchObject({ hasPin: true, unlocked: true })
    expect(await codeOfAsync(() => setupPin('5678'))).toBe('has-pin')
    expect(await codeOfAsync(() => setupPin('1'))).toBe('has-pin')
  })

  it('rejects a PIN shorter than four characters at setup', async () => {
    expect(await codeOfAsync(() => setupPin('123'))).toBe('too-short')
    expect(state.envelope).toBeNull()
  })

  it('unlock accepts the right PIN and rejects the wrong one', async () => {
    await setupPin('1234')
    lock()
    expect(isUnlocked()).toBe(false)
    expect(await codeOfAsync(() => unlock('4321'))).toBe('wrong-pin')
    await unlock('1234')
    expect(isUnlocked()).toBe(true)
  })

  it('allows the first four failures immediately and throttles only from the fifth', async () => {
    await setupPin('1234')
    lock()
    for (let i = 0; i < 4; i++) {
      expect(await codeOfAsync(() => unlock('0000'))).toBe('wrong-pin')
    }
    // The fifth failure is itself answered, and carries the first retry window.
    let fifth: VaultError | null = null
    try {
      await unlock('0000')
    } catch (error) {
      fifth = error as VaultError
    }
    expect(fifth?.code).toBe('wrong-pin')
    expect(fifth?.retryAfterMs).toBe(5000)
    // Only now is a further attempt refused without deriving.
    expect(await codeOfAsync(() => unlock('1234'))).toBe('throttled')
  })

  it('changePin shares unlock backoff so a throttled vault cannot be guessed that way', async () => {
    await setupPin('1234')
    lock()
    for (let i = 0; i < 5; i++) {
      expect(await codeOfAsync(() => unlock('0000'))).toBe('wrong-pin')
    }
    expect(await codeOfAsync(() => changePin('1234', '5678'))).toBe('throttled')
  })

  it('applies the 5s/10s/20s/40s/60s backoff and resets on success', async () => {
    // Fake timers before the first derive so Date.now() moves with the clock.
    vi.useFakeTimers()
    await setupPin('1234')
    lock()
    for (let i = 0; i < 5; i++) expect(await codeOfAsync(() => unlock('0000'))).toBe('wrong-pin')

    const delays: number[] = []
    for (const expected of [5000, 10000, 20000, 40000, 60000, 60000]) {
      let thrown: VaultError | null = null
      try {
        await unlock('0000')
      } catch (error) {
        thrown = error as VaultError
      }
      expect(thrown?.code).toBe('throttled')
      delays.push(thrown?.retryAfterMs ?? -1)
      vi.advanceTimersByTime(expected)
      expect(await codeOfAsync(() => unlock('0000'))).toBe('wrong-pin')
    }
    expect(delays).toEqual([5000, 10000, 20000, 40000, 60000, 60000])

    // A success clears the counter, so the next wrong PIN is not throttled.
    vi.advanceTimersByTime(60000)
    await unlock('1234')
    lock()
    expect(await codeOfAsync(() => unlock('0000'))).toBe('wrong-pin')
  })

  it('lock zero-fills the DEK and is idempotent', async () => {
    await setupPin('1234')
    const row: LockableRow = {
      id: 1,
      short_id: 'abc1234',
      expanded_text: '',
      locked: 1,
      expanded_cipher: encryptFor('abc1234', 'secret'),
    }
    expect(revealRow(row)).toBe('secret')
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill')
    lock()
    expect(fillSpy).toHaveBeenCalledWith(0)
    fillSpy.mockClear()
    lock()
    expect(fillSpy).not.toHaveBeenCalled()
    fillSpy.mockRestore()
    expect(isUnlocked()).toBe(false)
    // A dropped key cannot decrypt, so the reveal is refused rather than wrong.
    expect(codeOf(() => revealRow(row))).toBe('locked')
  })

  it('notifies onLock listeners exactly once per lock transition', async () => {
    let notified = 0
    onLock(() => {
      notified++
    })
    await setupPin('1234')
    lock()
    lock()
    expect(notified).toBe(1)
  })

  it('arms an absolute timer that locks and broadcasts, and does not slide on use', async () => {
    vi.useFakeTimers()
    await setupPin('1234')
    vi.advanceTimersByTime(14 * 60_000)
    const row: LockableRow = {
      id: 1,
      short_id: 'abc1234',
      expanded_text: '',
      locked: 1,
      expanded_cipher: encryptFor('abc1234', 'secret'),
    }
    expect(revealRow(row)).toBe('secret')
    vi.advanceTimersByTime(60_000)
    expect(isUnlocked()).toBe(false)
    vi.useRealTimers()
    await flush()
    expect(broadcasts.at(-1)).toMatchObject({ unlocked: false })
  })

  it('applyTimeoutSetting re-arms while unlocked and is a no-op while locked', async () => {
    vi.useFakeTimers()
    await setupPin('1234')
    timeout = { unlockTimeoutEnabled: true, unlockTimeoutMinutes: 5 }
    applyTimeoutSetting()
    vi.advanceTimersByTime(5 * 60_000)
    expect(isUnlocked()).toBe(false)
    applyTimeoutSetting()
    expect(isUnlocked()).toBe(false)
  })

  it('a disabled timeout keeps the session open indefinitely', async () => {
    timeout = { unlockTimeoutEnabled: false, unlockTimeoutMinutes: 15 }
    vi.useFakeTimers()
    await setupPin('1234')
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(isUnlocked()).toBe(true)
  })

  it('changePin requires the current PIN, keeps the DEK and changes the salt', async () => {
    await setupPin('1234')
    const cipher = encryptFor('abc1234', 'secret')
    const before = JSON.parse(state.envelope!) as { salt: string }
    expect(await codeOfAsync(() => changePin('0000', '5678'))).toBe('wrong-pin')
    expect(await codeOfAsync(() => changePin('1234', '567'))).toBe('too-short')
    await changePin('1234', '5678')
    const after = JSON.parse(state.envelope!) as { salt: string }
    expect(after.salt).not.toBe(before.salt)
    // Same DEK: an existing row ciphertext still decrypts, without re-encryption.
    expect(revealRow({ id: 1, short_id: 'abc1234', expanded_text: '', locked: 1, expanded_cipher: cipher })).toBe(
      'secret'
    )
    lock()
    await unlock('5678')
    expect(revealRow({ id: 1, short_id: 'abc1234', expanded_text: '', locked: 1, expanded_cipher: cipher })).toBe(
      'secret'
    )
  })

  it('changePin refuses when the stored kdf is unsupported and leaves the envelope untouched', async () => {
    state.envelope = JSON.stringify({
      v: 1,
      kdf: 'blake3-kdf',
      params: {},
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
      iv: 'AAAAAAAAAAAAAAAA',
      ct: 'AA==',
      tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    })
    const before = state.envelope
    expect(await codeOfAsync(() => changePin('1234', '5678'))).toBe('unsupported-kdf')
    expect(state.envelope).toBe(before)
    expect((await getVaultStatus()).kdfSupported).toBe(false)
  })

  it('protect and unprotect require an unlocked session and write the invariant shape', async () => {
    state.rows.set(7, { id: 7, short_id: 'abc1234', expanded_text: 'secret', locked: 0, expanded_cipher: null })
    expect(await codeOfAsync(() => protect(7, 'abc1234', 'secret'))).toBe('no-pin')
    await setupPin('1234')
    await protect(7, 'abc1234', 'secret')
    const locked = state.rows.get(7)!
    expect(locked.locked).toBe(1)
    expect(locked.expanded_text).toBe('')
    expect(locked.expanded_cipher).toBeTruthy()
    expect(revealRow(locked)).toBe('secret')

    lock()
    expect(await codeOfAsync(() => unprotect(7, 'secret'))).toBe('locked')
    await unlock('1234')
    await unprotect(7, 'secret')
    expect(state.rows.get(7)).toMatchObject({ locked: 0, expanded_text: 'secret', expanded_cipher: null })
  })

  it('protect writes locked, body and cipher in one statement', async () => {
    await setupPin('1234')
    state.rows.set(7, { id: 7, short_id: 'abc1234', expanded_text: 'secret', locked: 0, expanded_cipher: null })
    state.runs.length = 0
    await protect(7, 'abc1234', 'secret')
    const updates = state.runs.filter((r) => r.sql.includes('UPDATE phrases'))
    expect(updates).toHaveLength(1)
    expect(updates[0].sql).toContain('locked = 1')
    expect(updates[0].sql).toContain("expanded_text = ''")
    expect(updates[0].sql).toContain('expanded_cipher = ?')
  })

  it('revealRow returns plaintext for an unlocked row without touching crypto', () => {
    expect(revealRow({ id: 1, short_id: 'abc1234', expanded_text: 'plain', locked: 0, expanded_cipher: null })).toBe(
      'plain'
    )
  })

  it('revealRow reports a damaged cipher as corrupt, not as locked', async () => {
    await setupPin('1234')
    expect(
      codeOf(() => revealRow({ id: 1, short_id: 'abc1234', expanded_text: '', locked: 1, expanded_cipher: 'not json' }))
    ).toBe('corrupt')
    expect(
      codeOf(() => revealRow({ id: 1, short_id: 'abc1234', expanded_text: '', locked: 1, expanded_cipher: null }))
    ).toBe('corrupt')
  })

  it('getVaultStatus counts locked rows', async () => {
    await setupPin('1234')
    state.rows.set(1, { id: 1, short_id: 'a', expanded_text: '', locked: 1, expanded_cipher: 'x' })
    state.rows.set(2, { id: 2, short_id: 'b', expanded_text: 'y', locked: 0, expanded_cipher: null })
    expect((await getVaultStatus()).lockedCount).toBe(1)
  })

  it('a lock landing inside an in-flight unlock does not resurrect the session', async () => {
    await setupPin('1234')
    lock()
    const gate = holdNextEnvelopeRead()
    const pending = unlock('1234')
    await gate.reached
    lock()
    gate.release()
    expect(await codeOfAsync(() => pending)).toBe('unavailable')
    expect(isUnlocked()).toBe(false)
  })

  it('a database switch inside an in-flight setup does not unlock against the replacement', async () => {
    const gate = holdNextEnvelopeRead()
    const pending = setupPin('1234')
    await gate.reached
    // switchDatabase retires the connection and installs the replacement.
    lock()
    setVaultDb(fakeDb())
    gate.release()
    expect(await codeOfAsync(() => pending)).toBe('unavailable')
    expect(isUnlocked()).toBe(false)
  })

  it('a lock landing inside an in-flight changePin neither unlocks nor rewrites the envelope', async () => {
    await setupPin('1234')
    const before = state.envelope
    lock()
    const gate = holdNextEnvelopeRead()
    const pending = changePin('1234', '5678')
    await gate.reached
    lock()
    gate.release()
    expect(await codeOfAsync(() => pending)).toBe('unavailable')
    expect(isUnlocked()).toBe(false)
    expect(state.envelope).toBe(before)
  })

  it('a lock after the envelope write keeps the new PIN and leaves the session locked', async () => {
    await setupPin('1234')
    const before = state.envelope
    const runGate = holdNextRun()
    const pending = changePin('1234', '5678')
    await runGate.reached
    lock()
    runGate.release()
    await pending
    expect(isUnlocked()).toBe(false)
    expect(state.envelope).not.toBe(before)
    await unlock('5678')
    expect(isUnlocked()).toBe(true)
  })
})
