const { generateShortId } = require('./nanoid.js');

const upgrades = [
    { version: 1, upgrade: upgradeToV1 },
    { version: 2, upgrade: upgradeToV2 },
];

function upgradeToV1(db) {
    return new Promise((resolve, reject) => {
        // First, attempt to create the schema_version table
        db.run(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            )
        `, (err) => {
            if (err) {
                reject(err); 
            } else {
                db.run(`
                    ALTER TABLE phrases
                    ADD COLUMN type TEXT DEFAULT 'plain'
                `, (err) => {
                    if (err) {
                        reject(err); 
                    } else {
                        resolve(); 
                    }
                });
            }
        });
    });
}

/**
 * V2: Add short_id column for cross-insert references
 * Generates unique 7-character base36 IDs for all phrases
 */
function upgradeToV2(db) {
    return new Promise((resolve, reject) => {
        // 1. Add short_id column
        db.run(`ALTER TABLE phrases ADD COLUMN short_id TEXT`, (err) => {
            // Ignore "duplicate column" error (idempotent)
            if (err && !err.message.includes('duplicate column')) {
                reject(err);
                return;
            }
            
            // 2. Generate IDs for existing phrases without short_id
            db.all("SELECT id FROM phrases WHERE short_id IS NULL", (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (rows.length === 0) {
                    // No phrases to update, create index and finish
                    createShortIdIndex(db, resolve, reject);
                    return;
                }
                
                const stmt = db.prepare("UPDATE phrases SET short_id = ? WHERE id = ?");
                let completed = 0;
                let hasError = false;
                
                for (const row of rows) {
                    if (hasError) break;
                    stmt.run(generateShortId(), row.id, (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            reject(err);
                            return;
                        }
                        completed++;
                        if (completed === rows.length && !hasError) {
                            stmt.finalize(() => {
                                createShortIdIndex(db, resolve, reject);
                            });
                        }
                    });
                }
            });
        });
    });
}

function createShortIdIndex(db, resolve, reject) {
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_phrases_short_id ON phrases(short_id)", (err) => {
        if (err) {
            reject(err);
            return;
        }
        resolve();
    });
}

module.exports = { upgrades };
