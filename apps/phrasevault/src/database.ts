import fs from 'fs'
import path from 'path'
import sqlite3 from 'sqlite3'
import { app, ipcMain } from 'electron'
import { getConfig, setConfig } from './services/config'
import i18n from './i18n'
import { upgrades } from './database-upgrades'
import { generateShortId } from './nanoid'
import { extractPhraseRefs } from './dynamic-inserts'
import { filterPhrases } from './phrase-search'
import {
  VaultError,
  encryptFor,
  isUnlocked,
  publishVaultStatus,
  revealRow,
  setVaultDb,
  lock as vaultLock,
} from './services/lock'
import type { LockableRow } from './services/lock'
import type { Phrase, PhraseRow, PhraseType } from './types'

/**
 * Get the current database path from config.
 * Using a getter function instead of a constant allows hot-swapping databases.
 */
function getCurrentDbPath(): string {
  return getConfig().dbPath
}

const validTypes: PhraseType[] = ['text', 'markdown', 'mdwysiwyg', 'html']

let db: sqlite3.Database | null = null
let openedDbPath: string | null = null
let isSwitching = false

// Monotonic generation: every retire/open cycle invalidates earlier callbacks.
let databaseGeneration = 0
let databaseReady: Promise<void> = Promise.resolve()

function captureDb(): { connection: sqlite3.Database; generation: number } | null {
  const connection = db
  const generation = databaseGeneration
  if (!connection || isSwitching) return null
  return { connection, generation }
}

function isCapturedCurrent(connection: sqlite3.Database, generation: number): boolean {
  return db === connection && databaseGeneration === generation && !isSwitching
}

// Track retry abort state. First-access of overlapping CRUD must settle;
// only a scheduled inaccessible retry (or an explicit switch) is aborted.
let retryAbortController: { aborted: boolean; retrying: boolean } | null = null

interface VersionRow {
  version: number
}

interface CountRow {
  count: number
}

interface TableRow {
  name: string
}

/** The raw SELECT * shape, main-only. Never crosses IPC. */
interface RawPhraseRow extends PhraseRow {
  expanded_cipher: string | null
}

/**
 * The single projection from a stored row to the row the renderer may see.
 * Explicit field list on purpose: a column added later must be opted in here.
 * A locked row leaves with an empty body and no cipher column at all, so search
 * can only ever rank it by name.
 */
function toRendererRow(row: RawPhraseRow): PhraseRow {
  const locked: 0 | 1 = row.locked === 1 ? 1 : 0
  return {
    id: row.id,
    phrase: row.phrase,
    expanded_text: locked === 1 ? '' : row.expanded_text,
    type: row.type,
    short_id: row.short_id,
    usageCount: row.usageCount,
    dateAdd: row.dateAdd,
    dateLastUsed: row.dateLastUsed,
    locked,
  }
}

function runSql(connection: sqlite3.Database, sql: string, values: (string | number)[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, values, (error) => (error ? reject(error) : resolve()))
  })
}

function readOne<T>(connection: sqlite3.Database, sql: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    connection.get(sql, (error, row: T | undefined) => (error ? reject(error) : resolve(row)))
  })
}

/**
 * Hand lock.ts the ready connection. It is injected rather than imported so
 * lock.ts stays free of Electron and of this module (that would be a cycle).
 */
let vaultWiredConnection: sqlite3.Database | null = null

function installVaultDb(connection: sqlite3.Database): void {
  // Re-wiring the same connection would drop a perfectly good session, because
  // setVaultDb locks: the DEK belongs to the file being replaced, and here it
  // is not being replaced.
  if (vaultWiredConnection === connection) return
  vaultWiredConnection = connection
  setVaultDb({
    get: <T>(sql: string, params: readonly unknown[] = []) =>
      new Promise<T | undefined>((resolve, reject) => {
        connection.get(sql, params as unknown[], (error, row) =>
          error ? reject(error) : resolve(row as T | undefined)
        )
      }),
    run: (sql: string, params: readonly unknown[] = []) =>
      new Promise<void>((resolve, reject) => {
        connection.run(sql, params as unknown[], (error: Error | null) => (error ? reject(error) : resolve()))
      }),
  })
}

function initializeDatabase(): Promise<void> {
  const currentPath = getCurrentDbPath()
  if (db && openedDbPath === currentPath) return databaseReady
  const generation = ++databaseGeneration
  let connection: sqlite3.Database
  const opened = new Promise<void>((resolve, reject) => {
    connection = new sqlite3.Database(currentPath, (error) => (error ? reject(error) : resolve()))
  })
  db = connection!
  openedDbPath = currentPath
  const captured = db
  databaseReady = opened.then(async () => {
    if (generation !== databaseGeneration || db !== captured) throw new Error('Database changed')
    captured.configure('busyTimeout', 5000)
    await runSql(captured, 'PRAGMA journal_mode = DELETE')
    await runSql(captured, 'PRAGMA secure_delete = ON')
    if (getConfig().initializeTables) await initializeTables(captured)
    else await checkAndUpdateSchema(captured, currentPath)
    if (generation !== databaseGeneration || db !== captured) throw new Error('Database changed')
    setConfig({ initializeTables: false })
    installVaultDb(captured)
  })
  // Initialization is also started by callback-based CRUD availability checks.
  // Their callers receive status=false; keep the original rejection for invoke/switch callers.
  void databaseReady.catch(() => {})
  return databaseReady
}

async function initializeTables(connection: sqlite3.Database): Promise<void> {
  await runSql(connection, 'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  await runSql(connection, 'INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [
    upgrades[upgrades.length - 1].version,
  ])
  await runSql(
    connection,
    "CREATE TABLE IF NOT EXISTS phrases (id INTEGER PRIMARY KEY AUTOINCREMENT, phrase TEXT, expanded_text TEXT, type TEXT DEFAULT 'plain', short_id TEXT UNIQUE, usageCount INTEGER DEFAULT 0, dateAdd DATETIME DEFAULT CURRENT_TIMESTAMP, dateLastUsed DATETIME DEFAULT CURRENT_TIMESTAMP, locked INTEGER NOT NULL DEFAULT 0, expanded_cipher TEXT)"
  )
  await runSql(
    connection,
    'CREATE TABLE IF NOT EXISTS vault_key (id INTEGER PRIMARY KEY CHECK (id = 1), envelope TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
  )
  const count = await readOne<CountRow>(connection, 'SELECT COUNT(*) AS count FROM phrases')
  if (count?.count !== 0) return
  // Fixed short_id for phone so the signature cross-reference resolves.
  const phoneId = 'ph0n31d'
  const seeds: [string, string, string][] = [
    [i18n.t('email'), i18n.t('examplePhrase1'), generateShortId()],
    [i18n.t('phone'), i18n.t('examplePhrase2'), phoneId],
    [i18n.t('addr'), i18n.t('examplePhrase3'), generateShortId()],
    [i18n.t('sig'), i18n.t('examplePhrase4').replace('{{phrase:PHONE_ID}}', `{{phrase:${phoneId}}}`), generateShortId()],
    [i18n.t('ty'), i18n.t('examplePhrase5'), generateShortId()],
    [i18n.t('today'), i18n.t('examplePhrase6'), generateShortId()],
  ]
  for (const [name, content, shortId] of seeds) {
    await runSql(connection, 'INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (?, ?, ?, ?)', [
      name,
      content,
      'plain',
      shortId,
    ])
  }
}

async function checkAndUpdateSchema(connection: sqlite3.Database, dbPath: string): Promise<void> {
  try {
    const currentVersion = await getCurrentSchemaVersion(connection)
    let updated = false

    for (const upgrade of upgrades) {
      if (currentVersion < upgrade.version) {
        if (!updated) {
          await backupDatabase(dbPath)
          updated = true
        }
        await upgrade.upgrade(connection)
        await updateSchemaVersion(connection, upgrade.version)
      }
    }
    if (updated) {
      // Note: Removed showOnStartup flag - toast notification is sufficient feedback
      setTimeout(() => {
        global.databaseEvents.emit('ui:toast', {
          type: 'success',
          message: i18n.t('Database schema upgraded successfully'),
        })
      }, 1000)
    }
  } catch (error) {
    console.error('Error upgrading database schema:', error)
    global.databaseEvents.emit('ui:toast', {
      type: 'danger',
      message: i18n.t('Error upgrading database schema, but a backup was created.'),
    })
    throw error
  }
}

function getCurrentSchemaVersion(connection: sqlite3.Database): Promise<number> {
  return new Promise((resolve, reject) => {
    connection.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
      (err, table: TableRow | undefined) => {
        if (err) {
          reject(err)
        } else if (table) {
          connection.get(
            'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1',
            (err, row: VersionRow | undefined) => {
              if (err) {
                reject(err)
              } else {
                resolve(row ? row.version : 0)
              }
            }
          )
        } else {
          resolve(0) // Assume version 0 if the table doesn't exist
        }
      }
    )
  })
}

function updateSchemaVersion(connection: sqlite3.Database, version: number): Promise<void> {
  return runSql(connection, 'INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [version])
}

async function backupDatabase(dbPath: string): Promise<string> {
  const backupPath = path.join(path.dirname(dbPath), `phrasevault_backup_${Date.now()}.sqlite`)
  try {
    await fs.promises.copyFile(dbPath, backupPath)
    return backupPath
  } catch (error) {
    console.error('Failed to create database backup:', error)
    throw error
  }
}

/**
 * Close and invalidate the active connection. The generation is bumped *before*
 * close so a late callback from the retired connection can never be applied,
 * and a close callback that never arrives cannot block the next generation.
 */
async function retireDatabase(): Promise<void> {
  ++databaseGeneration
  // The DEK belongs to the file being closed, so the session dies with it.
  vaultWiredConnection = null
  vaultLock()
  setVaultDb(null)
  const retired = db
  db = null
  openedDbPath = null
  if (retired) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.error('Timed out closing retired database')
        resolve()
      }, 10000)
      retired.close((error) => {
        clearTimeout(timeout)
        if (error) console.error('Error closing database:', error)
        resolve()
      })
    })
  }
}

async function openReady(pathToOpen: string): Promise<void> {
  await fs.promises.access(pathToOpen, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      initializeDatabase(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Timeout opening database')), 10000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function checkDatabaseAccessibility(callback: (accessible: boolean) => void): void {
  // A switch owns the connection; reject rather than racing it.
  if (isSwitching) {
    callback(false)
    return
  }
  // Cancel a waiting retry loop, but do not abort an in-flight first access
  // of a sibling operation (two deletes must both run).
  if (retryAbortController?.retrying) {
    retryAbortController.aborted = true
  }
  const controller = { aborted: false, retrying: false }
  retryAbortController = controller

  const firstRun = getConfig().firstRun
  const currentPath = getCurrentDbPath()

  if (firstRun) {
    // create the database file if it doesn't exist
    if (!fs.existsSync(currentPath)) {
      fs.writeFileSync(currentPath, '')
    }

    setConfig({ firstRun: false })
  }

  fs.access(currentPath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK, async (err) => {
    // Don't continue if this check was aborted
    if (controller.aborted) return

    let accessible = !err
    if (accessible) {
      try {
        await initializeDatabase()
      } catch (initializationError) {
        console.error('Database initialization failed:', initializationError)
        accessible = false
        if (!controller.aborted && !isSwitching && openedDbPath === currentPath) await retireDatabase()
      }
    }
    if (controller.aborted) return
    global.databaseEvents.emit('database:status', accessible)
    callback(accessible)
    if (!accessible) {
      controller.retrying = true
      setTimeout(() => {
        if (!controller.aborted) checkDatabaseAccessibility(callback)
      }, 5000)
    }
  })
}

function checkDuplicatePhrase(
  connection: sqlite3.Database,
  phrase: string,
  id: number | null,
  callback: (isDuplicate: boolean) => void
): void {
  const query = id ? `SELECT * FROM phrases WHERE phrase = ? AND id != ?` : `SELECT * FROM phrases WHERE phrase = ?`
  connection.get(
    query,
    [phrase, id].filter((v) => v !== null),
    (err, row) => {
      if (err) {
        return callback(false)
      }
      callback(!!row)
    }
  )
}

/**
 * Generate a unique phrase name for duplication.
 * If "Copy of XY" exists, tries "Copy of XY (2)", "Copy of XY (3)", etc.
 */
function generateUniqueDuplicateName(
  connection: sqlite3.Database,
  originalPhrase: string,
  callback: (name: string) => void
): void {
  const baseName = i18n.t('Copy of') + ' ' + originalPhrase

  // Get all phrases that start with the base name pattern
  connection.all(`SELECT phrase FROM phrases WHERE phrase LIKE ?`, [baseName + '%'], (err, rows: Array<{ phrase: string }>) => {
    if (err) {
      // Fallback to simple name on error
      return callback(baseName)
    }

    const existingNames = new Set(rows.map((r) => r.phrase))

    // If base name doesn't exist, use it
    if (!existingNames.has(baseName)) {
      return callback(baseName)
    }

    // Find the next available number
    let counter = 2
    while (existingNames.has(`${baseName} (${counter})`)) {
      counter++
    }

    callback(`${baseName} (${counter})`)
  })
}

ipcMain.handle('phrases:search', async (_event, query: unknown): Promise<PhraseRow[]> => {
  if (typeof query !== 'string') throw new Error('Search query must be a string')
  return searchPhrasesAsync(query)
})

ipcMain.on('phrases:insertById', (event, id: number) => {
  checkDatabaseAccessibility((accessible) => {
    if (!accessible) {
      return
    }
    db!.get(`SELECT * FROM phrases WHERE id = ?`, [id], (err, row: PhraseRow | undefined) => {
      if (err) {
        console.error(err.message)
        return
      }
      global.databaseEvents.emit('phrases:insert', event, row)
    })
  })
})

/**
 * Encrypt a body for a save. Returns null when the row stays plaintext.
 * Throws when the session cannot serve the request, so the caller can refuse
 * *before* writing anything — a locked row must never touch disk in plaintext.
 */
function cipherForSave(
  locked: boolean,
  shortId: string,
  text: string,
  currentlyLocked = false
): string | null {
  // Unprotecting a stored ciphertext still needs the live DEK (the draft is
  // already plaintext in the renderer). Without this, locked:false after Lock
  // now / timeout writes the body in the clear.
  if ((locked || currentlyLocked) && !isUnlocked()) throw new VaultError('locked')
  if (!locked) return null
  return encryptFor(shortId, text)
}

type SaveEvent = { reply: (channel: string, payload?: unknown) => void }

function refuseLockedSave(event: SaveEvent, error: unknown): void {
  const key = error instanceof VaultError && error.code === 'corrupt' ? 'vault_error_corrupt' : 'vault_locked_toast'
  event.reply('ui:toast', { type: 'danger', message: i18n.t(key) })
}

ipcMain.on('phrases:add', (event, { newPhrase, newExpandedText, type, locked = false }: { newPhrase: string; newExpandedText: string; type: string; locked?: boolean }) => {
  checkDatabaseAccessibility((accessible) => {
    if (!accessible) {
      return
    }
    const captured = captureDb()
    if (!captured) return
    checkDuplicatePhrase(captured.connection, newPhrase, null, (isDuplicate) => {
      if (!isCapturedCurrent(captured.connection, captured.generation)) return
      if (isDuplicate) {
        event.reply('ui:toast', { type: 'danger', message: i18n.t('Phrase already exists.') })
        return
      }

      if (!validTypes.includes(type as PhraseType)) {
        event.reply('ui:toast', { type: 'danger', message: i18n.t('Invalid phrase type.') })
        return
      }

      const shortId = generateShortId()
      // Encrypt before the insert so a protected body is never written in the clear.
      let cipher: string | null
      try {
        cipher = cipherForSave(locked, shortId, newExpandedText)
      } catch (error) {
        refuseLockedSave(event, error)
        return
      }
      captured.connection.run(
        `INSERT INTO phrases (phrase, expanded_text, type, short_id, locked, expanded_cipher) VALUES (?, ?, ?, ?, ?, ?)`,
        [newPhrase, cipher ? '' : newExpandedText, type, shortId, cipher ? 1 : 0, cipher],
        function (err) {
          if (!isCapturedCurrent(captured.connection, captured.generation)) return
          if (err) {
            event.reply('database:error', 'Failed to add phrase')
            return
          }
          event.reply('phrases:added', {
            id: this.lastID,
            phrase: newPhrase,
            expandedText: cipher ? undefined : newExpandedText,
            shortId: shortId,
            locked: cipher ? 1 : 0,
          })
          publishVaultStatus()
          event.reply('ui:toast', { type: 'success', message: i18n.t('Phrase added successfully.') })
        }
      )
    })
  })
})

ipcMain.on('phrases:edit', (event, { id, newPhrase, newExpandedText, type, locked = false }: { id: number; newPhrase: string; newExpandedText: string; type: string; locked?: boolean }) => {
  checkDatabaseAccessibility((accessible) => {
    if (!accessible) {
      return
    }
    const captured = captureDb()
    if (!captured) return
    checkDuplicatePhrase(captured.connection, newPhrase, id, (isDuplicate) => {
      if (!isCapturedCurrent(captured.connection, captured.generation)) return
      if (isDuplicate) {
        event.reply('ui:toast', { type: 'danger', message: i18n.t('Phrase already exists.') })
        return
      }

      if (!validTypes.includes(type as PhraseType)) {
        event.reply('ui:toast', { type: 'danger', message: i18n.t('Invalid phrase type.') })
        return
      }

      // Check for self-reference
      captured.connection.get(
        `SELECT short_id, locked FROM phrases WHERE id = ?`,
        [id],
        (err, row: { short_id: string; locked: number } | undefined) => {
        if (!isCapturedCurrent(captured.connection, captured.generation)) return
        if (err || !row) {
          event.reply('database:error', 'Failed to edit phrase')
          return
        }

        const referencedIds = extractPhraseRefs(newExpandedText)
        if (row.short_id && referencedIds.includes(row.short_id.toLowerCase())) {
          event.reply('ui:toast', { type: 'danger', message: i18n.t('A phrase cannot reference itself.') })
          return
        }

        // Encrypt before the update so a protected body is never written in the clear.
        // Unticking the box takes the other branch and restores plaintext.
        let cipher: string | null
        try {
          cipher = cipherForSave(locked, row.short_id, newExpandedText, row.locked === 1)
        } catch (error) {
          refuseLockedSave(event, error)
          return
        }

        captured.connection.run(
          `UPDATE phrases SET phrase = ?, expanded_text = ?, type = ?, locked = ?, expanded_cipher = ? WHERE id = ?`,
          [newPhrase, cipher ? '' : newExpandedText, type, cipher ? 1 : 0, cipher, id],
          function (err) {
            if (!isCapturedCurrent(captured.connection, captured.generation)) return
            if (err) {
              event.reply('database:error', 'Failed to edit phrase')
              return
            }
            event.reply('phrases:edited', {
              id: id,
              phrase: newPhrase,
              expandedText: cipher ? undefined : newExpandedText,
              locked: cipher ? 1 : 0,
            })
            publishVaultStatus()
            event.reply('ui:toast', { type: 'success', message: i18n.t('Phrase edited successfully.') })
          }
        )
      })
    })
  })
})

ipcMain.on('phrases:delete', (event, id: number) => {
  checkDatabaseAccessibility((accessible) => {
    if (!accessible) {
      event.reply('database:error', 'Failed to delete phrase')
      return
    }
    // An older generation may still complete its own delete, but it must not
    // acknowledge against a reused ID in a newly opened database.
    const captured = captureDb()
    if (!captured) return
    captured.connection.run(`DELETE FROM phrases WHERE id = ?`, [id], function (error) {
      if (!isCapturedCurrent(captured.connection, captured.generation)) return
      if (error) {
        event.reply('database:error', 'Failed to delete phrase')
        return
      }
      event.reply('phrases:deleted', id)
      publishVaultStatus()
      // Toast with undo is handled in renderer
    })
  })
})

ipcMain.on('phrases:duplicate', (event, id: number) => {
  checkDatabaseAccessibility((accessible) => {
    if (!accessible) {
      return
    }
    const captured = captureDb()
    if (!captured) return
    captured.connection.get(`SELECT * FROM phrases WHERE id = ?`, [id], (err, row: RawPhraseRow | undefined) => {
      if (!isCapturedCurrent(captured.connection, captured.generation)) return
      if (err) {
        event.reply('database:error', 'Failed to duplicate phrase')
        return
      }
      if (!row) {
        event.reply('ui:toast', { type: 'danger', message: i18n.t('Phrase not found.') })
        return
      }

      generateUniqueDuplicateName(captured.connection, row.phrase, (duplicatePhrase) => {
        if (!isCapturedCurrent(captured.connection, captured.generation)) return
        const shortId = generateShortId()
        // A duplicate of a protected row stays protected, but is re-encrypted
        // under the *new* short_id so the AAD binding holds for the new row.
        let body: string
        let cipher: string | null
        try {
          body = revealRow({
            id: row.id,
            short_id: row.short_id,
            expanded_text: row.expanded_text,
            locked: row.locked === 1 ? 1 : 0,
            expanded_cipher: row.expanded_cipher,
          })
          cipher = cipherForSave(row.locked === 1, shortId, body)
        } catch (error) {
          refuseLockedSave(event, error)
          return
        }
        captured.connection.run(
          `INSERT INTO phrases (phrase, expanded_text, type, short_id, locked, expanded_cipher) VALUES (?, ?, ?, ?, ?, ?)`,
          [duplicatePhrase, cipher ? '' : body, row.type, shortId, cipher ? 1 : 0, cipher],
          function (err) {
            if (!isCapturedCurrent(captured.connection, captured.generation)) return
            if (err) {
              event.reply('database:error', 'Failed to duplicate phrase')
              return
            }
            event.reply('phrases:duplicated', {
              id: this.lastID,
              phrase: duplicatePhrase,
              expandedText: cipher ? undefined : body,
              shortId: shortId,
              locked: cipher ? 1 : 0,
            })
            publishVaultStatus()
            event.reply('ui:toast', { type: 'success', message: i18n.t('Phrase duplicated successfully.') })
          }
        )
      })
    })
  })
})

ipcMain.on('phrases:incrementUsage', (_event, id: number) => {
  checkDatabaseAccessibility((accessible) => {
    if (!accessible) {
      return
    }
    db!.run(`UPDATE phrases SET usageCount = usageCount + 1, dateLastUsed = CURRENT_TIMESTAMP WHERE id = ?`, [id], function (err) {
      if (err) {
        console.error('Failed to increment usage:', err)
      }
    })
  })
})

app.on('will-quit', () => {
  vaultWiredConnection = null
  vaultLock()
  setVaultDb(null)
  if (!db) {
    return
  }
  db.close((err) => {
    if (err) {
      console.error('Error closing database connection', err)
    }
    db = null
    openedDbPath = null
  })
})

/**
 * Hot-swap to a different database without app restart.
 * Closes existing connection, updates config, opens new database.
 * Includes rollback on failure and timeout protection.
 */
export async function switchDatabase(
  newPath: string,
  initTables = false
): Promise<{ success: boolean; error?: string }> {
  // Prevent concurrent switches
  if (isSwitching) return { success: false, error: 'Database switch already in progress' }
  isSwitching = true
  const previousPath = getConfig().dbPath
  const previousInitTables = getConfig().initializeTables
  // Cancel any pending retry loop from previous operations
  if (retryAbortController) retryAbortController.aborted = true
  // The DEK belongs to the file being closed, so the session dies with it.
  vaultWiredConnection = null
  vaultLock()
  setVaultDb(null)
  global.databaseEvents.emit('database:status', false)
  let available = false
  let result: { success: boolean; error?: string }
  try {
    await retireDatabase()
    setConfig({ dbPath: newPath, initializeTables: initTables })
    await openReady(newPath)
    available = true
    result = { success: true }
  } catch (error) {
    await retireDatabase()
    setConfig({ dbPath: previousPath, initializeTables: previousInitTables })
    try {
      await openReady(previousPath)
      available = true
    } catch (rollbackError) {
      await retireDatabase()
      console.error('Failed to restore database:', rollbackError)
    }
    result = { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    isSwitching = false
    global.databaseEvents.emit('database:status', available)
  }
  return result
}

export function initDatabase(): void {
  checkDatabaseAccessibility(() => {})
}

/**
 * Get a phrase by its short_id (for cross-insert resolution)
 */
export function getPhraseByShortId(shortId: string): Promise<Phrase | null> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    db.get('SELECT * FROM phrases WHERE short_id = ?', [shortId], (err, row: PhraseRow | undefined) => {
      if (err) reject(err)
      else if (!row) resolve(null)
      else {
        resolve({
          id: row.id,
          short_id: row.short_id,
          phrase: row.phrase,
          expanded_text: row.expanded_text,
          type: row.type as PhraseType,
          category_id: null,
          usage_count: row.usageCount,
          created_at: row.dateAdd,
          updated_at: row.dateLastUsed,
        })
      }
    })
  })
}

/**
 * Run multiple DB operations inside a single transaction (all-or-nothing).
 */
export function runInTransaction(fn: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    db.run('BEGIN TRANSACTION', async (beginErr) => {
      if (beginErr) {
        reject(beginErr)
        return
      }
      try {
        await fn()
        db!.run('COMMIT', (commitErr) => {
          if (commitErr) reject(commitErr)
          else resolve()
        })
      } catch (err) {
        db!.run('ROLLBACK', () => {
          reject(err)
        })
      }
    })
  })
}

/**
 * Get all phrases in usageCount DESC order from the current ready connection.
 * Rejects rather than resolving stale rows when the connection/generation moved on.
 */
export async function getAllPhrases(): Promise<PhraseRow[]> {
  if (isSwitching) throw new Error('Database switching')
  const connection = db
  const generation = databaseGeneration
  if (!connection) throw new Error('Database not initialized')
  await databaseReady
  const stillCurrent = (): boolean => !isSwitching && db === connection && databaseGeneration === generation
  if (!stillCurrent()) throw new Error('Database changed')
  return new Promise((resolve, reject) => {
    connection.all('SELECT * FROM phrases ORDER BY usageCount DESC', (error, rows: RawPhraseRow[]) => {
      if (!stillCurrent()) reject(new Error('Database changed'))
      else if (error) reject(error)
      // Search never decrypts, so a locked row can only ever rank by its name.
      else resolve(rows.map(toRendererRow))
    })
  })
}

/**
 * Authoritative search: the sole search read path, ranked by the shared matcher.
 */
export async function searchPhrasesAsync(searchText: string): Promise<PhraseRow[]> {
  return filterPhrases(await getAllPhrases(), searchText)
}

/**
 * Insert a phrase (for import). Returns the inserted row ID.
 */
export function insertPhrase(
  phrase: string,
  expandedText: string,
  type: PhraseType,
  shortId: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    // Import never protects a row: locked and the cipher column are forced.
    db.run(
      'INSERT INTO phrases (phrase, expanded_text, type, short_id, locked, expanded_cipher) VALUES (?, ?, ?, ?, 0, NULL)',
      [phrase, expandedText, type, shortId],
      function (err) {
        if (err) reject(err)
        else resolve(this.lastID)
      }
    )
  })
}

/**
 * Update a phrase by ID (for import overwrite). Preserves usageCount and dates.
 */
export function updatePhraseContent(
  id: number,
  phrase: string,
  expandedText: string,
  type: PhraseType
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    // Overwriting on import clears any protection: a plaintext body must never
    // be left sitting next to locked = 1 and a stale ciphertext.
    db.run(
      'UPDATE phrases SET phrase = ?, expanded_text = ?, type = ?, locked = 0, expanded_cipher = NULL WHERE id = ?',
      [phrase, expandedText, type, id],
      (err) => {
        if (err) reject(err)
        else resolve()
      }
    )
  })
}

/**
 * Raw row reads for main only. These carry expanded_cipher, so their results
 * must never be replied to the renderer — pass them to revealRow and send the
 * plaintext or nothing.
 */
/**
 * One read that carries everything main needs: the ciphertext plus the metadata
 * the copy/insert paths use, so no second lookup is needed just for `type`.
 */
export interface MainPhraseRow extends LockableRow {
  type: string
  phrase: string
}

const LOCKABLE_COLUMNS = 'id, short_id, phrase, type, expanded_text, locked, expanded_cipher'

function readLockableRow(sql: string, param: number | string): Promise<MainPhraseRow | null> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }
    db.get(sql, [param], (err, row: MainPhraseRow | undefined) => {
      if (err) reject(err)
      else resolve(row ? { ...row, locked: row.locked === 1 ? 1 : 0 } : null)
    })
  })
}

export function getLockableRowById(id: number): Promise<MainPhraseRow | null> {
  return readLockableRow(`SELECT ${LOCKABLE_COLUMNS} FROM phrases WHERE id = ?`, id)
}

export function getLockableRowByShortId(shortId: string): Promise<MainPhraseRow | null> {
  return readLockableRow(`SELECT ${LOCKABLE_COLUMNS} FROM phrases WHERE short_id = ?`, shortId)
}

export { db }
