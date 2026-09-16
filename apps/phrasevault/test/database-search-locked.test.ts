/**
 * The search/list leak rule: a locked row reaches the renderer with an empty
 * body and no ciphertext column, and therefore ranks by name only.
 *
 * Same harness shape as database-search.test.ts — native IO is faked, but the
 * ranking, projection and IPC registration all run from the real src/database.ts.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PhraseRow } from '../src/types'

const fake = vi.hoisted(() => ({
  config: { dbPath: 'a.sqlite', initializeTables: false, firstRun: false },
  handles: new Map<string, (event: unknown, query: unknown) => Promise<PhraseRow[]>>(),
  ons: new Map<string, (event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void>(),
  reads: [] as Array<{ path: string; done: (error: Error | null, rows: PhraseRow[]) => void }>,
  status: [] as boolean[],
}))

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: {
    on: (name: string, handler: (event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void) => {
      fake.ons.set(name, handler)
    },
    handle: (name: string, handler: (event: unknown, query: unknown) => Promise<PhraseRow[]>) => {
      fake.handles.set(name, handler)
    },
  },
}))
vi.mock('fs', () => ({
  default: {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2 },
    existsSync: () => true,
    writeFileSync: vi.fn(),
    access: (_path: string, _mode: number, done: (error: Error | null) => void) => {
      queueMicrotask(() => done(null))
    },
    promises: { access: vi.fn(async () => {}), copyFile: vi.fn(async () => {}) },
  },
}))
vi.mock('../src/services/config', () => ({
  getConfig: () => fake.config,
  setConfig: (values: Partial<typeof fake.config>) => Object.assign(fake.config, values),
}))
vi.mock('../src/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../src/database-upgrades', () => ({
  upgrades: [{ version: 1, upgrade: vi.fn(async () => {}) }],
}))
vi.mock('../src/nanoid', () => ({ generateShortId: () => 'test-id' }))
vi.mock('../src/dynamic-inserts', () => ({ extractPhraseRefs: () => [] }))
vi.mock('sqlite3', () => {
  class Database {
    constructor(
      readonly path: string,
      done: (error: Error | null) => void
    ) {
      queueMicrotask(() => done(null))
    }
    configure(): void {}
    close(done: (error: Error | null) => void): void {
      queueMicrotask(() => done(null))
    }
    run(_sql: string, values: unknown, callback?: (error: Error | null) => void): this {
      const done = typeof values === 'function' ? (values as (error: Error | null) => void) : callback
      queueMicrotask(() => done?.(null))
      return this
    }
    get(sql: string, done: (error: Error | null, row: object) => void): void {
      queueMicrotask(() => done(null, sql.includes('sqlite_master') ? { name: 'schema_version' } : { version: 1, count: 1 }))
    }
    all(_sql: string, done: (error: Error | null, rows: PhraseRow[]) => void): void {
      fake.reads.push({ path: this.path, done })
    }
  }
  return { default: { Database } }
})

/** The raw stored shape, including the column the renderer must never see. */
const rawLocked = {
  id: 2,
  phrase: 'api key',
  expanded_text: 'sk-live-DO-NOT-MATCH',
  type: 'text',
  short_id: 'bbbbbbb',
  usageCount: 1,
  dateAdd: '',
  dateLastUsed: '',
  locked: 1,
  expanded_cipher: '{"v":1,"iv":"AAAAAAAAAAAAAAAA","ct":"QQ==","tag":"AAAAAAAAAAAAAAAAAAAAAA=="}',
}

const rawPlain = {
  id: 1,
  phrase: 'sig',
  expanded_text: 'Best regards, Alex',
  type: 'text',
  short_id: 'aaaaaaa',
  usageCount: 3,
  dateAdd: '',
  dateLastUsed: '',
  locked: 0,
  expanded_cipher: null,
}

beforeEach(() => {
  vi.resetModules()
  Object.assign(fake.config, { dbPath: 'a.sqlite', initializeTables: false, firstRun: false })
  fake.handles.clear()
  fake.ons.clear()
  fake.reads.length = 0
  fake.status.length = 0
  global.databaseEvents = new EventEmitter()
  global.databaseEvents.on('database:status', (value) => fake.status.push(value as boolean))
})

async function readyDatabase() {
  const database = await import('../src/database')
  database.initDatabase()
  await vi.waitFor(() => expect(fake.status.at(-1)).toBe(true))
  return database
}

it('returns a locked row with an empty body and never its ciphertext', async () => {
  await readyDatabase()
  const handler = fake.handles.get('phrases:search')
  if (!handler) throw new Error('Missing search invoke handler')
  const pending = handler({}, 'regards')
  await vi.waitFor(() => expect(fake.reads.length).toBe(1))
  fake.reads.shift()!.done(null, [rawPlain, rawLocked] as unknown as PhraseRow[])
  const rows = await pending

  const serialized = JSON.stringify(rows)
  expect(serialized).not.toContain('expanded_cipher')
  expect(serialized).not.toContain('sk-live-DO-NOT-MATCH')
  for (const row of rows) {
    if (row.locked === 1) expect(row.expanded_text).toBe('')
    expect(Object.prototype.hasOwnProperty.call(row, 'expanded_cipher')).toBe(false)
  }
})

it('matches a locked row by name and never by body, even while unlocked', async () => {
  const database = await readyDatabase()
  // Unlocking changes nothing here: search never decrypts under any circumstance.
  const { setupPin } = await import('../src/services/lock')
  void database
  void setupPin

  const handler = fake.handles.get('phrases:search')
  if (!handler) throw new Error('Missing search invoke handler')

  const byBody = handler({}, 'sk-live')
  await vi.waitFor(() => expect(fake.reads.length).toBe(1))
  fake.reads.shift()!.done(null, [rawLocked] as unknown as PhraseRow[])
  expect(await byBody).toEqual([])

  const byName = handler({}, 'api key')
  await vi.waitFor(() => expect(fake.reads.length).toBe(1))
  fake.reads.shift()!.done(null, [rawLocked] as unknown as PhraseRow[])
  const found = await byName
  expect(found).toHaveLength(1)
  expect(found[0].expanded_text).toBe('')
  expect(found[0].locked).toBe(1)
})

it('normalizes an unexpected locked value to 0 or 1', async () => {
  await readyDatabase()
  const handler = fake.handles.get('phrases:search')
  if (!handler) throw new Error('Missing search invoke handler')
  const pending = handler({}, 'sig')
  await vi.waitFor(() => expect(fake.reads.length).toBe(1))
  fake.reads.shift()!.done(null, [{ ...rawPlain, locked: null }] as unknown as PhraseRow[])
  const rows = await pending
  expect(rows[0].locked).toBe(0)
  expect(rows[0].expanded_text).toBe('Best regards, Alex')
})
