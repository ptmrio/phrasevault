/**
 * Import write paths. No import may ever produce a protected row, and importing
 * over an existing protected row must clear the protection rather than leaving
 * locked = 1 next to a plaintext body — that combination breaks the row
 * invariant and would render as an empty phrase forever.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sqlite3 from 'sqlite3'

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
let vault: typeof import('../src/services/lock')
let database: typeof import('../src/database')

interface StoredRow {
  id: number
  phrase: string
  expanded_text: string
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
  dir = mkdtempSync(join(tmpdir(), 'pv-import-'))
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
  database = await import('../src/database')
  database.initDatabase()
  await vi.waitFor(() => expect(fake.status.at(-1)).toBe(true), { timeout: 10000 })
})

afterEach(() => {
  vault?.lock()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* Windows may still hold the file; the temp dir is disposable. */
  }
})

describe('import write paths', SLOW, () => {
  it('insertPhrase produces an unprotected row', async () => {
    const id = await database.insertPhrase('imported', 'a body', 'text', 'imp0001')
    const row = (await readAll()).find((r) => r.id === id)!
    expect(row.locked).toBe(0)
    expect(row.expanded_cipher).toBeNull()
    expect(row.expanded_text).toBe('a body')
  })

  it('overwriting a protected row on import clears the protection', async () => {
    await vault.setupPin('1234')
    const event = { reply: vi.fn() }
    fake.ons.get('phrases:add')!(event, {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    await vi.waitFor(() => expect(event.reply.mock.calls.some((c) => c[0] === 'phrases:added')).toBe(true), {
      timeout: 10000,
    })
    const added = event.reply.mock.calls.find((c) => c[0] === 'phrases:added')![1] as { id: number }

    const beforeRow = (await readAll()).find((r) => r.id === added.id)!
    expect(beforeRow.locked).toBe(1)

    await database.updatePhraseContent(added.id, 'api key', 'plain replacement', 'text')

    const row = (await readAll()).find((r) => r.id === added.id)!
    expect(row.locked).toBe(0)
    expect(row.expanded_cipher).toBeNull()
    expect(row.expanded_text).toBe('plain replacement')
    // The old ciphertext is gone, not merely shadowed.
    expect(JSON.stringify(row)).not.toContain('sk-live-secret')
  })

  it('an import over a protected row never leaves locked = 1 beside a plaintext body', async () => {
    await vault.setupPin('1234')
    const event = { reply: vi.fn() }
    fake.ons.get('phrases:add')!(event, {
      newPhrase: 'api key',
      newExpandedText: 'sk-live-secret',
      type: 'text',
      locked: true,
    })
    await vi.waitFor(() => expect(event.reply.mock.calls.some((c) => c[0] === 'phrases:added')).toBe(true), {
      timeout: 10000,
    })
    const added = event.reply.mock.calls.find((c) => c[0] === 'phrases:added')![1] as { id: number }
    await database.updatePhraseContent(added.id, 'api key', 'plain replacement', 'text')

    for (const row of await readAll()) {
      const invariantHolds = row.locked === 1 ? row.expanded_text === '' && !!row.expanded_cipher : true
      expect(invariantHolds).toBe(true)
    }
  })
})
