/**
 * Write paths: add, edit, duplicate, export filtering, import.
 *
 * These drive the real ipcMain handlers registered by src/database.ts against a
 * real sqlite3 file, then read the stored rows back with a second connection —
 * so the assertions are about what is actually on disk, not about the shape of
 * the SQL that put it there.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sqlite3 from 'sqlite3'
import { splitExportRows } from '../src/export-filter'
import type { PhraseRow } from '../src/types'

const SLOW = { timeout: 120000 }

const fake = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  ons: new Map<string, (event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void>(),
  handles: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
  status: [] as boolean[],
}))

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: {
    on: (name: string, handler: (event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void) => {
      fake.ons.set(name, handler)
    },
    handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      fake.handles.set(name, handler)
    },
  },
}))
vi.mock('../src/services/config', () => ({
  getConfig: () => fake.config,
  setConfig: (values: Record<string, unknown>) => Object.assign(fake.config, values),
}))
vi.mock('../src/i18n', () => ({ default: { t: (key: string) => key } }))

let dir: string
let dbPath: string
/**
 * vi.resetModules() gives each test a fresh module graph, so the lock service
 * must be taken from the same graph as database.ts — a statically imported copy
 * would be a different instance with no database wired into it.
 */
let vault: typeof import('../src/services/lock')

interface StoredRow {
  id: number
  phrase: string
  expanded_text: string
  short_id: string
  type: string
  locked: number
  expanded_cipher: string | null
}

function readAll(): Promise<StoredRow[]> {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY)
    connection.all('SELECT * FROM phrases ORDER BY id', (error: Error | null, rows: StoredRow[]) => {
      connection.close(() => (error ? reject(error) : resolve(rows)))
    })
  })
}

beforeEach(async () => {
  vi.resetModules()
  dir = mkdtempSync(join(tmpdir(), 'pv-write-'))
  dbPath = join(dir, 'phrases.sqlite')
  await new Promise<void>((resolve) => new sqlite3.Database(dbPath).close(() => resolve()))
  Object.assign(fake.config, {
    dbPath,
    initializeTables: true,
    firstRun: false,
    unlockTimeoutEnabled: false,
    unlockTimeoutMinutes: 15,
  })
  fake.ons.clear()
  fake.handles.clear()
  fake.status.length = 0
  global.databaseEvents = new EventEmitter()
  global.databaseEvents.on('database:status', (value) => fake.status.push(value as boolean))

  vault = await import('../src/services/lock')
  const database = await import('../src/database')
  database.initDatabase()
  await vi.waitFor(() => expect(fake.status.at(-1)).toBe(true), { timeout: 10000 })

  // Same wiring main.ts performs at app-ready.
  const { registerVaultHandlers } = await import('../src/vault-ipc')
  registerVaultHandlers({
    handle: (channel, listener) => {
      fake.handles.set(channel, listener)
    },
    getLockableRowById: database.getLockableRowById,
  })
})

afterEach(() => {
  vault?.lock()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* Windows may still hold the file; the temp dir is disposable. */
  }
})

/** Fire a registered ipcMain.on handler and wait for one of its replies. */
function send(channel: string, payload: unknown): { reply: ReturnType<typeof vi.fn> } {
  const handler = fake.ons.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  const event = { reply: vi.fn() }
  handler(event, payload)
  return event
}

function replyFor(event: { reply: ReturnType<typeof vi.fn> }, channel: string): unknown {
  const call = event.reply.mock.calls.find((c) => c[0] === channel)
  return call?.[1]
}

async function waitForReply(event: { reply: ReturnType<typeof vi.fn> }, channel: string): Promise<unknown> {
  await vi.waitFor(() => expect(event.reply.mock.calls.some((c) => c[0] === channel)).toBe(true), { timeout: 10000 })
  return replyFor(event, channel)
}

describe('add', SLOW, () => {
  it('stores a protected row as ciphertext with an empty body, and omits it from the reply', async () => {
    await vault.setupPin('1234')
    const event = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    const added = (await waitForReply(event, 'phrases:added')) as { expandedText?: string; locked: number }

    expect(added.expandedText).toBeUndefined()
    expect(added.locked).toBe(1)

    const rows = await readAll()
    const stored = rows.find((r) => r.phrase === 'api key')!
    expect(stored.locked).toBe(1)
    expect(stored.expanded_text).toBe('')
    expect(stored.expanded_cipher).toBeTruthy()
    expect(stored.expanded_cipher).not.toContain('sk-live-secret')
  })

  it('never writes the plaintext of a protected row, even transiently', async () => {
    await vault.setupPin('1234')
    const event = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    await waitForReply(event, 'phrases:added')
    const dump = JSON.stringify(await readAll())
    expect(dump).not.toContain('sk-live-secret')
  })

  it('stores an ordinary row unchanged', async () => {
    const event = send('phrases:add', {
      newPhrase: 'my signature',
      newExpandedText: 'Best regards',
      type: 'text',
      locked: false,
    })
    const added = (await waitForReply(event, 'phrases:added')) as { expandedText?: string; locked: number }
    expect(added.expandedText).toBe('Best regards')
    expect(added.locked).toBe(0)

    const stored = (await readAll()).find((r) => r.phrase === 'my signature')!
    expect(stored.locked).toBe(0)
    expect(stored.expanded_text).toBe('Best regards')
    expect(stored.expanded_cipher).toBeNull()
  })

  it('refuses to protect while the session is locked and writes no row at all', async () => {
    await vault.setupPin('1234')
    vault.lock()
    const before = (await readAll()).length
    const event = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    await vi.waitFor(() => expect(event.reply).toHaveBeenCalled(), { timeout: 10000 })
    expect(replyFor(event, 'ui:toast')).toEqual({ type: 'danger', message: 'vault_locked_toast' })
    expect(replyFor(event, 'phrases:added')).toBeUndefined()
    expect((await readAll()).length).toBe(before)
  })
})

describe('edit', SLOW, () => {
  async function addPlain(name: string, body: string): Promise<number> {
    const event = send('phrases:add', { newPhrase: name, newExpandedText: body, type: 'text', locked: false })
    const added = (await waitForReply(event, 'phrases:added')) as { id: number }
    return added.id
  }

  it('protects an existing row on save and omits the body from the reply', async () => {
    const id = await addPlain('api key', 'placeholder')
    await vault.setupPin('1234')
    const event = send('phrases:edit', {
      id,
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    const edited = (await waitForReply(event, 'phrases:edited')) as { expandedText?: string; locked: number }
    expect(edited.expandedText).toBeUndefined()
    expect(edited.locked).toBe(1)

    const stored = (await readAll()).find((r) => r.id === id)!
    expect(stored.locked).toBe(1)
    expect(stored.expanded_text).toBe('')
    expect(JSON.stringify(stored)).not.toContain('sk-live-secret')
  })

  it('unticking the box restores plaintext and clears the ciphertext', async () => {
    const id = await addPlain('api key', 'placeholder')
    await vault.setupPin('1234')
    await waitForReply(
      send('phrases:edit', {
        id,
        newPhrase: 'api key',
        newExpandedText: 'sk-live-secret',
        type: 'text',
        locked: true,
      }),
      'phrases:edited'
    )

    const event = send('phrases:edit', {
      id,
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: false,
    })
    const edited = (await waitForReply(event, 'phrases:edited')) as { expandedText?: string; locked: number }
    expect(edited.expandedText).toBe('sk-live-secret')
    expect(edited.locked).toBe(0)

    const stored = (await readAll()).find((r) => r.id === id)!
    expect(stored.locked).toBe(0)
    expect(stored.expanded_text).toBe('sk-live-secret')
    expect(stored.expanded_cipher).toBeNull()
  })

  it('refuses unprotecting a stored ciphertext when the session lapsed', async () => {
    await vault.setupPin('1234')
    const addEvent = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    const added = (await waitForReply(addEvent, 'phrases:added')) as { id: number }
    vault.lock()
    const event = send('phrases:edit', {
      id: added.id,
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: false,
    })
    await vi.waitFor(() => expect(event.reply).toHaveBeenCalled(), { timeout: 10000 })
    expect(replyFor(event, 'ui:toast')).toEqual({ type: 'danger', message: 'vault_locked_toast' })
    expect(replyFor(event, 'phrases:edited')).toBeUndefined()
    const stored = (await readAll()).find((r) => r.id === added.id)!
    expect(stored.locked).toBe(1)
    expect(stored.expanded_text).toBe('')
    expect(stored.expanded_cipher).toBeTruthy()
  })

  it('refuses a protecting save when the session lapsed, leaving the row as it was', async () => {
    const id = await addPlain('api key', 'placeholder')
    await vault.setupPin('1234')
    vault.lock()
    const event = send('phrases:edit', {
      id,
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    await vi.waitFor(() => expect(event.reply).toHaveBeenCalled(), { timeout: 10000 })
    expect(replyFor(event, 'ui:toast')).toEqual({ type: 'danger', message: 'vault_locked_toast' })
    expect(replyFor(event, 'phrases:edited')).toBeUndefined()

    const stored = (await readAll()).find((r) => r.id === id)!
    expect(stored.locked).toBe(0)
    expect(stored.expanded_text).toBe('placeholder')
  })
})

describe('duplicate', SLOW, () => {
  it('keeps a protected duplicate protected and re-encrypts under the new short_id', async () => {
    await vault.setupPin('1234')
    const addEvent = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    const added = (await waitForReply(addEvent, 'phrases:added')) as { id: number; shortId: string }

    const dupEvent = send('phrases:duplicate', added.id)
    const duplicated = (await waitForReply(dupEvent, 'phrases:duplicated')) as {
      id: number
      shortId: string
      expandedText?: string
      locked: number
    }
    expect(duplicated.expandedText).toBeUndefined()
    expect(duplicated.locked).toBe(1)
    expect(duplicated.shortId).not.toBe(added.shortId)

    const rows = await readAll()
    const source = rows.find((r) => r.id === added.id)!
    const copy = rows.find((r) => r.id === duplicated.id)!
    expect(copy.locked).toBe(1)
    expect(copy.expanded_text).toBe('')
    // Re-encrypted, not copied: a fresh IV under a different AAD.
    expect(copy.expanded_cipher).not.toBe(source.expanded_cipher)

    // And the copy really is readable through its own short_id binding.
    const getBody = fake.handles.get('vault:getPhraseBody')!
    expect(await getBody({}, { id: duplicated.id })).toEqual({ ok: true, text: 'sk-live-secret' })
  })

  it('duplicates an ordinary row unchanged', async () => {
    const addEvent = send('phrases:add', {
      newPhrase: 'my signature',
      newExpandedText: 'Best regards',
      type: 'text',
      locked: false,
    })
    const added = (await waitForReply(addEvent, 'phrases:added')) as { id: number }
    const dupEvent = send('phrases:duplicate', added.id)
    const duplicated = (await waitForReply(dupEvent, 'phrases:duplicated')) as {
      expandedText?: string
      locked: number
    }
    expect(duplicated.expandedText).toBe('Best regards')
    expect(duplicated.locked).toBe(0)
  })

  it('refuses to duplicate a protected row while locked', async () => {
    await vault.setupPin('1234')
    const addEvent = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    const added = (await waitForReply(addEvent, 'phrases:added')) as { id: number }
    vault.lock()

    const dupEvent = send('phrases:duplicate', added.id)
    await vi.waitFor(() => expect(dupEvent.reply).toHaveBeenCalled(), { timeout: 10000 })
    expect(replyFor(dupEvent, 'ui:toast')).toEqual({ type: 'danger', message: 'vault_locked_toast' })
    expect(replyFor(dupEvent, 'phrases:duplicated')).toBeUndefined()
  })
})

describe('round trip', SLOW, () => {
  it('a protected body survives lock and unlock and is unreachable in between', async () => {
    await vault.setupPin('1234')
    const event = send('phrases:add', {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    const added = (await waitForReply(event, 'phrases:added')) as { id: number }
    const getBody = fake.handles.get('vault:getPhraseBody')!

    expect(await getBody({}, { id: added.id })).toEqual({ ok: true, text: 'sk-live-secret' })
    vault.lock()
    expect(vault.isUnlocked()).toBe(false)
    expect(await getBody({}, { id: added.id })).toEqual({ ok: false, error: 'locked' })
    await vault.unlock('1234')
    expect(await getBody({}, { id: added.id })).toEqual({ ok: true, text: 'sk-live-secret' })
  })

  it('search never returns a protected body while unlocked', async () => {
    await vault.setupPin('1234')
    await waitForReply(
      send('phrases:add', {
        newPhrase: 'api key',
        newExpandedText: 'sk-live-secret',
        type: 'text',
        locked: true,
      }),
      'phrases:added'
    )
    const search = fake.handles.get('phrases:search')!
    expect(vault.isUnlocked()).toBe(true)

    const byBody = (await search({}, 'sk-live')) as PhraseRow[]
    expect(byBody).toEqual([])

    const byName = (await search({}, 'api key')) as PhraseRow[]
    expect(byName).toHaveLength(1)
    expect(byName[0].expanded_text).toBe('')
    expect(JSON.stringify(byName)).not.toContain('sk-live-secret')
  })
})

describe('export filtering', () => {
  const row = (id: number, locked: 0 | 1): PhraseRow => ({
    id,
    phrase: `p${id}`,
    expanded_text: locked ? '' : `body${id}`,
    type: 'text',
    short_id: `s${id}`,
    usageCount: 0,
    dateAdd: '',
    dateLastUsed: '',
    locked,
  })

  it('drops protected rows and counts them', () => {
    const { exportable, omitted } = splitExportRows([row(1, 0), row(2, 1), row(3, 1)])
    expect(exportable.map((r) => r.id)).toEqual([1])
    expect(omitted).toBe(2)
  })

  it('reports the count even when everything selected was protected', () => {
    const { exportable, omitted } = splitExportRows([row(1, 1)])
    expect(exportable).toEqual([])
    expect(omitted).toBe(1)
  })

  it('leaves an all-plaintext selection alone', () => {
    const { exportable, omitted } = splitExportRows([row(1, 0), row(2, 0)])
    expect(exportable).toHaveLength(2)
    expect(omitted).toBe(0)
  })
})
