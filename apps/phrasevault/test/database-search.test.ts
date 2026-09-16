/**
 * Authoritative invoke reads plus connection/switch settlement.
 *
 * The mocks below replace native IO only. Ranking, lifecycle and IPC
 * registration all run from the real src/database.ts module.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PhraseRow } from '../src/types'

const fake = vi.hoisted(() => ({
  config: { dbPath: 'a.sqlite', initializeTables: false, firstRun: false },
  handles: new Map<string, (event: unknown, query: unknown) => Promise<PhraseRow[]>>(),
  ons: new Map<string, (event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void>(),
  reads: [] as Array<{ path: string; done: (error: Error | null, rows: PhraseRow[]) => void }>,
  deletes: [] as number[],
  failOpen: new Set<string>(),
  failRun: new Set<string>(),
  holdOpen: new Set<string>(),
  holdClose: new Set<string>(),
  holdAccess: false,
  accessPending: [] as Array<(error: Error | null) => void>,
  openCallbacks: new Map<string, (error: Error | null) => void>(),
  accessCalls: 0,
  opened: [] as string[],
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
      fake.accessCalls++
      if (fake.holdAccess) fake.accessPending.push(done)
      else queueMicrotask(() => done(null))
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
    constructor(readonly path: string, done: (error: Error | null) => void) {
      fake.opened.push(path)
      if (fake.holdOpen.has(path)) fake.openCallbacks.set(path, done)
      else queueMicrotask(() => done(fake.failOpen.has(path) ? new Error('open failed') : null))
    }
    configure(): void {}
    close(done: (error: Error | null) => void): void {
      if (!fake.holdClose.has(this.path)) queueMicrotask(() => done(null))
    }
    run(_sql: string, values: unknown, callback?: (error: Error | null) => void): this {
      const done = typeof values === 'function' ? (values as (error: Error | null) => void) : callback
      if (typeof values !== 'function' && Array.isArray(values) && _sql.includes('DELETE FROM phrases')) {
        fake.deletes.push(Number(values[0]))
      }
      queueMicrotask(() => done?.(fake.failRun.has(this.path) ? new Error('schema failed') : null))
      return this
    }
    get(sql: string, done: (error: Error | null, row: object) => void): void {
      queueMicrotask(() =>
        done(null, sql.includes('sqlite_master') ? { name: 'schema_version' } : { version: 1, count: 1 })
      )
    }
    all(_sql: string, done: (error: Error | null, rows: PhraseRow[]) => void): void {
      fake.reads.push({ path: this.path, done })
    }
  }
  return { default: { Database } }
})

const row: PhraseRow = {
  id: 1,
  phrase: 'sig',
  expanded_text: 'Best regards, Alex',
  type: 'text',
  short_id: 'sig-id',
  usageCount: 1,
  dateAdd: '',
  dateLastUsed: '',
  locked: 0,
}

beforeEach(() => {
  vi.resetModules()
  Object.assign(fake.config, { dbPath: 'a.sqlite', initializeTables: false, firstRun: false })
  fake.handles.clear()
  fake.ons.clear()
  fake.reads.length = 0
  fake.deletes.length = 0
  fake.opened.length = 0
  fake.status.length = 0
  fake.failOpen.clear()
  fake.failRun.clear()
  fake.holdOpen.clear()
  fake.holdClose.clear()
  fake.holdAccess = false
  fake.accessPending.length = 0
  fake.openCallbacks.clear()
  fake.accessCalls = 0
  global.databaseEvents = new EventEmitter()
  global.databaseEvents.on('database:status', (value) => fake.status.push(value as boolean))
})

async function readyDatabase() {
  const database = await import('../src/database')
  database.initDatabase()
  await vi.waitFor(() => expect(fake.status.at(-1)).toBe(true))
  return database
}

it('registers invoke, returns actual rows, and rejects a read error', async () => {
  await readyDatabase()
  const handler = fake.handles.get('phrases:search')
  expect(handler).toBeDefined()
  if (!handler) throw new Error('Missing search invoke handler')
  const statusBefore = [...fake.status]
  const accessBefore = fake.accessCalls
  const result = handler(null, 'sig')
  await vi.waitFor(() => expect(fake.reads).toHaveLength(1))
  fake.reads[0].done(null, [row])
  await expect(result).resolves.toEqual([row])
  const failure = handler(null, 'sig')
  const rejection = expect(failure).rejects.toThrow('read failed')
  await vi.waitFor(() => expect(fake.reads).toHaveLength(2))
  fake.reads[1].done(new Error('read failed'), [])
  await rejection
  await expect(handler(null, { query: 'sig' })).rejects.toThrow('Search query must be a string')
  expect(fake.status).toEqual(statusBefore)
  expect(fake.accessCalls).toBe(accessBefore)
})

it('rejects prior-connection replies and reads during a switch', async () => {
  const database = await readyDatabase()
  const old = database.searchPhrasesAsync('sig')
  const rejected = expect(old).rejects.toThrow('Database changed')
  await vi.waitFor(() => expect(fake.reads).toHaveLength(1))
  const switching = database.switchDatabase('b.sqlite')
  await expect(database.searchPhrasesAsync('sig')).rejects.toThrow('Database switching')
  await expect(switching).resolves.toEqual({ success: true })
  fake.reads[0].done(null, [row])
  await rejected
  const current = database.searchPhrasesAsync('sig')
  await vi.waitFor(() => expect(fake.reads).toHaveLength(2))
  expect(fake.reads[1].path).toBe('b.sqlite')
  fake.reads[1].done(null, [{ ...row, expanded_text: 'Database B' }])
  await expect(current).resolves.toEqual([{ ...row, expanded_text: 'Database B' }])
})

it.each(['open', 'schema'] as const)('restores A before returning a failed %s switch', async (kind) => {
  const database = await readyDatabase()
  if (kind === 'open') fake.failOpen.add('bad.sqlite')
  else fake.failRun.add('bad.sqlite')
  const result = await database.switchDatabase('bad.sqlite')
  expect(result.success).toBe(false)
  expect(fake.config.dbPath).toBe('a.sqlite')
  expect(fake.opened.at(-1)).toBe('a.sqlite')
  expect(fake.status.slice(-2)).toEqual([false, true])
  const restored = database.searchPhrasesAsync('sig')
  await vi.waitFor(() => expect(fake.reads).toHaveLength(1))
  expect(fake.reads[0].path).toBe('a.sqlite')
  fake.reads[0].done(null, [row])
  await expect(restored).resolves.toEqual([row])
})

it('times out opening B, restores A, and ignores the late B open', async () => {
  const database = await readyDatabase()
  fake.holdOpen.add('slow.sqlite')
  vi.useFakeTimers()
  try {
    const result = database.switchDatabase('slow.sqlite')
    const expected = expect(result).resolves.toEqual({ success: false, error: 'Timeout opening database' })
    await vi.advanceTimersByTimeAsync(10001)
    await expected
    expect(fake.config.dbPath).toBe('a.sqlite')
    const release = fake.openCallbacks.get('slow.sqlite')
    expect(release).toBeDefined()
    if (!release) throw new Error('Missing held open callback')
    release(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.status.at(-1)).toBe(true)
    expect(fake.config.dbPath).toBe('a.sqlite')
  } finally {
    vi.useRealTimers()
  }
})

it('a close callback that never arrives cannot block the next generation forever', async () => {
  const database = await readyDatabase()
  fake.holdClose.add('a.sqlite')
  vi.useFakeTimers()
  try {
    const result = database.switchDatabase('b.sqlite')
    await vi.advanceTimersByTimeAsync(10001)
    await expect(result).resolves.toEqual({ success: true })
    expect(fake.config.dbPath).toBe('b.sqlite')
    expect(fake.status.at(-1)).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

it('overlapping deletes both run and both acknowledge', async () => {
  await readyDatabase()
  fake.holdAccess = true
  const del = fake.ons.get('phrases:delete')
  expect(del).toBeDefined()
  if (!del) throw new Error('Missing phrases:delete handler')
  const first = { reply: vi.fn() }
  const second = { reply: vi.fn() }
  del(first, 1)
  del(second, 2)
  expect(fake.accessPending).toHaveLength(2)
  fake.accessPending[0](null)
  fake.accessPending[1](null)
  await vi.waitFor(() => expect(fake.deletes).toEqual([1, 2]))
  await vi.waitFor(() => {
    expect(first.reply).toHaveBeenCalledWith('phrases:deleted', 1)
    expect(second.reply).toHaveBeenCalledWith('phrases:deleted', 2)
  })
})

it('delete replies database:error when the file is inaccessible', async () => {
  await readyDatabase()
  fake.holdAccess = true
  const del = fake.ons.get('phrases:delete')
  expect(del).toBeDefined()
  if (!del) throw new Error('Missing phrases:delete handler')
  const event = { reply: vi.fn() }
  del(event, 1)
  expect(fake.accessPending).toHaveLength(1)
  vi.useFakeTimers()
  try {
    fake.accessPending[0](new Error('ENOENT'))
    await vi.advanceTimersByTimeAsync(0)
    expect(event.reply).toHaveBeenCalledWith('database:error', 'Failed to delete phrase')
    expect(fake.deletes).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
