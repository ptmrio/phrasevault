/**
 * Schema v3: columns, vault_key, idempotency, and fresh/upgraded parity.
 *
 * Real sqlite3 against throwaway files. The fresh half of the parity check drives
 * the production `initializeTables` in src/database.ts (via initDatabase) rather
 * than restating its CREATE TABLE, so the two shapes cannot drift apart silently.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sqlite3 from 'sqlite3'
import { upgrades } from '../src/database-upgrades'

const fake = vi.hoisted(() => ({
  config: { dbPath: '', initializeTables: true, firstRun: false } as Record<string, unknown>,
  status: [] as boolean[],
}))

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}))
vi.mock('../src/services/config', () => ({
  getConfig: () => fake.config,
  setConfig: (values: Record<string, unknown>) => Object.assign(fake.config, values),
}))
vi.mock('../src/i18n', () => ({ default: { t: (key: string) => key } }))

const V2_PHRASES_SQL =
  'CREATE TABLE phrases (id INTEGER PRIMARY KEY AUTOINCREMENT, phrase TEXT, expanded_text TEXT, ' +
  "type TEXT DEFAULT 'plain', short_id TEXT UNIQUE, usageCount INTEGER DEFAULT 0, " +
  'dateAdd DATETIME DEFAULT CURRENT_TIMESTAMP, dateLastUsed DATETIME DEFAULT CURRENT_TIMESTAMP)'

let dir: string

function open(name: string): sqlite3.Database {
  return new sqlite3.Database(join(dir, name))
}

function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error: Error | null) => (error ? reject(error) : resolve()))
  })
}

function all<T>(db: sqlite3.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (error: Error | null, rows: T[]) => (error ? reject(error) : resolve(rows)))
  })
}

function close(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve) => db.close(() => resolve()))
}

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
}

async function columnShape(db: sqlite3.Database): Promise<string[]> {
  const info = await all<ColumnInfo>(db, 'PRAGMA table_info(phrases)')
  return info.map((c) => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value ?? 'NULL'}`).sort()
}

const v3 = upgrades.find((u) => u.version === 3)

beforeEach(() => {
  vi.resetModules()
  dir = mkdtempSync(join(tmpdir(), 'pv-v3-'))
  fake.status.length = 0
  global.databaseEvents = new EventEmitter()
  global.databaseEvents.on('database:status', (value) => fake.status.push(value as boolean))
})

afterEach(() => {
  // Windows keeps a handle on a just-closed sqlite file for a moment; the temp
  // directory is disposable either way.
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

/** Drive the production initializeTables against a real temp file. */
async function freshDatabase(name: string): Promise<sqlite3.Database> {
  const target = join(dir, name)
  await close(new sqlite3.Database(target))
  Object.assign(fake.config, { dbPath: target, initializeTables: true })
  const database = await import('../src/database')
  database.initDatabase()
  await vi.waitFor(() => expect(fake.status.at(-1)).toBe(true), { timeout: 5000 })
  await database.switchDatabase(target, false)
  return new sqlite3.Database(target)
}

describe('schema v3', () => {
  it('is the last entry in the upgrade ladder', () => {
    expect(upgrades[upgrades.length - 1].version).toBe(3)
  })

  it('adds both columns and vault_key to a v2 database and keeps existing rows unlocked', async () => {
    const db = open('v2.sqlite')
    await run(db, V2_PHRASES_SQL)
    await run(db, 'INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (?, ?, ?, ?)', [
      'sig',
      'Best regards, Alex',
      'text',
      'aaaaaaa',
    ])

    await v3!.upgrade(db)

    const rows = await all<{ locked: number; expanded_cipher: string | null; expanded_text: string }>(
      db,
      'SELECT locked, expanded_cipher, expanded_text FROM phrases'
    )
    expect(rows).toEqual([{ locked: 0, expanded_cipher: null, expanded_text: 'Best regards, Alex' }])

    const tables = await all<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vault_key'"
    )
    expect(tables).toHaveLength(1)

    const keys = await all<{ id: number }>(db, 'SELECT id FROM vault_key')
    expect(keys).toEqual([])
    await close(db)
  })

  it('is idempotent when re-run', async () => {
    const db = open('twice.sqlite')
    await run(db, V2_PHRASES_SQL)
    await v3!.upgrade(db)
    await expect(v3!.upgrade(db)).resolves.toBeUndefined()
    await close(db)
  })

  it('produces the same phrases shape as a freshly initialized v3 database', async () => {
    const upgraded = open('upgraded.sqlite')
    await run(upgraded, V2_PHRASES_SQL)
    await v3!.upgrade(upgraded)
    const upgradedShape = await columnShape(upgraded)
    await close(upgraded)

    const fresh = await freshDatabase('fresh.sqlite')
    const freshShape = await columnShape(fresh)
    const freshTables = await all<{ name: string }>(
      fresh,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vault_key'"
    )
    await close(fresh)

    expect(upgradedShape).toEqual(freshShape)
    expect(freshTables).toHaveLength(1)
  })

  it('seeds a fresh database with no locked rows', async () => {
    const fresh = await freshDatabase('seeded.sqlite')
    const rows = await all<{ locked: number; expanded_cipher: string | null }>(
      fresh,
      'SELECT locked, expanded_cipher FROM phrases'
    )
    await close(fresh)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.locked === 0 && r.expanded_cipher === null)).toBe(true)
  })

  it('rejects a second vault_key row', async () => {
    const db = open('vk.sqlite')
    await run(db, V2_PHRASES_SQL)
    await v3!.upgrade(db)
    await run(db, 'INSERT INTO vault_key (id, envelope) VALUES (1, ?)', ['{}'])
    await expect(run(db, 'INSERT INTO vault_key (id, envelope) VALUES (2, ?)', ['{}'])).rejects.toThrow()
    await close(db)
  })
})
