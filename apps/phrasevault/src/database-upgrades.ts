import { generateShortId } from './nanoid'
import type { Database } from 'sqlite3'

interface Upgrade {
  version: number
  upgrade: (db: Database) => Promise<void>
}

interface PhraseRow {
  id: number
}

export const upgrades: Upgrade[] = [
  { version: 1, upgrade: upgradeToV1 },
  { version: 2, upgrade: upgradeToV2 },
  { version: 3, upgrade: upgradeToV3 },
]

function upgradeToV1(db: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    // First, attempt to create the schema_version table
    db.run(
      `
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            )
        `,
      (err) => {
        if (err) {
          reject(err)
        } else {
          db.run(
            `
                    ALTER TABLE phrases
                    ADD COLUMN type TEXT DEFAULT 'plain'
                `,
            (err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            }
          )
        }
      }
    )
  })
}

/**
 * V2: Add short_id column for cross-insert references
 * Generates unique 7-character base36 IDs for all phrases
 */
function upgradeToV2(db: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    // 1. Add short_id column
    db.run(`ALTER TABLE phrases ADD COLUMN short_id TEXT`, (err) => {
      // Ignore "duplicate column" error (idempotent)
      if (err && !err.message.includes('duplicate column')) {
        reject(err)
        return
      }

      // 2. Generate IDs for existing phrases without short_id
      db.all('SELECT id FROM phrases WHERE short_id IS NULL', (err, rows: PhraseRow[]) => {
        if (err) {
          reject(err)
          return
        }

        if (rows.length === 0) {
          // No phrases to update, create index and finish
          createShortIdIndex(db, resolve, reject)
          return
        }

        const stmt = db.prepare('UPDATE phrases SET short_id = ? WHERE id = ?')
        let completed = 0
        let hasError = false

        for (const row of rows) {
          if (hasError) break
          stmt.run(generateShortId(), row.id, (err: Error | null) => {
            if (err && !hasError) {
              hasError = true
              reject(err)
              return
            }
            completed++
            if (completed === rows.length && !hasError) {
              stmt.finalize(() => {
                createShortIdIndex(db, resolve, reject)
              })
            }
          })
        }
      })
    })
  })
}

function createShortIdIndex(
  db: Database,
  resolve: () => void,
  reject: (err: Error) => void
): void {
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_phrases_short_id ON phrases(short_id)', (err) => {
    if (err) {
      reject(err)
      return
    }
    resolve()
  })
}

/**
 * V3: PIN lock. Adds the locked flag and the per-row ciphertext column, plus the
 * one-row vault_key table that carries the wrapped data key. Writes no rows: a
 * v2 database upgraded to v3 has zero locked rows and no key, which is exactly
 * the "no PIN set" state.
 */
function upgradeToV3(db: Database): Promise<void> {
  const steps = [
    'ALTER TABLE phrases ADD COLUMN locked INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE phrases ADD COLUMN expanded_cipher TEXT',
    'CREATE TABLE IF NOT EXISTS vault_key (id INTEGER PRIMARY KEY CHECK (id = 1), ' +
      'envelope TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
  ]
  return steps.reduce(
    (chain, sql) =>
      chain.then(
        () =>
          new Promise<void>((resolve, reject) => {
            db.run(sql, (err) => {
              // Ignore "duplicate column" so a re-run is a no-op (same rule as V2).
              if (err && !err.message.includes('duplicate column')) reject(err)
              else resolve()
            })
          })
      ),
    Promise.resolve()
  )
}
