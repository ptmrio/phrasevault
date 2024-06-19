import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { app, ipcMain, clipboard } from 'electron';
import state from './state.js';
import i18n from './i18n.js';
import { set } from 'electron-json-storage';

const dbPath = state.getConfig().dbPath;

let db;

export function initializeDatabase() {
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            return;
        }

        const initializeTables = state.getConfig().initializeTables;
        if (initializeTables) {
            db.run(`
                CREATE TABLE IF NOT EXISTS phrases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phrase TEXT,
                    expanded_text TEXT,
                    usageCount INTEGER DEFAULT 0,
                    dateAdd DATETIME DEFAULT CURRENT_TIMESTAMP,
                    dateLastUsed DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, insertInitialPhrases);
            state.setConfig({ initializeTables: false });
        }
    });
}


function insertInitialPhrases() {
    db.get('SELECT COUNT(*) AS count FROM phrases', (err, row) => {
        if (row && row.count === 0) {
            const phrases = [
                { phrase: i18n.t('Customer Thank You'), expanded_text: i18n.t('examplePhrase1') },
                { phrase: i18n.t('Out of Office'), expanded_text: i18n.t('examplePhrase2') },
                { phrase: i18n.t('ChatGPT Prompt'), expanded_text: i18n.t('examplePhrase3') },
                { phrase: i18n.t('MidJourney Art Prompt'), expanded_text: i18n.t('examplePhrase4') }
            ];
            const stmt = db.prepare('INSERT INTO phrases (phrase, expanded_text) VALUES (?, ?)');
            phrases.forEach(p => stmt.run(p.phrase, p.expanded_text));
            stmt.finalize();
        }
    });
}

export function checkDatabaseAccessibility(callback) {

    const firstRun = state.getConfig().firstRun;
    if (firstRun) {
        // create the database file if it doesn't exist
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, '');
        }

        state.setConfig({ firstRun: false });
    }

    fs.access(dbPath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK, (err) => {
        const accessible = !err;
        databaseEvents.emit('database-status', accessible);
        if (accessible) {
            if (!db) initializeDatabase();
        } else {
            setTimeout(() => checkDatabaseAccessibility(callback), 5000);
        }
        callback(accessible);
    });
}

function checkDuplicatePhrase(phrase, id, callback) {
    const query = id ? `SELECT * FROM phrases WHERE phrase = ? AND id != ?` : `SELECT * FROM phrases WHERE phrase = ?`;
    db.get(query, [phrase, id].filter(v => v), (err, row) => {
        if (err) {

            return callback(false);
        }
        callback(!!row);
    });
}

ipcMain.on('search-phrases', (event, searchText) => {
    checkDatabaseAccessibility(accessible => {
        if (!accessible) {
            return;
        }
        db.all(`SELECT * FROM phrases WHERE phrase LIKE ? OR expanded_text LIKE ? ORDER BY usageCount DESC`, 
            [`%${searchText}%`, `%${searchText}%`], (err, rows) => {
                if (err) {
                    event.reply('database-error', 'Error executing search');
                    return;
                }
                event.reply('phrases-list', rows);
            });
    });
});

ipcMain.on('get-phrase-by-id', (event, id) => {
    checkDatabaseAccessibility(accessible => {
        if (!accessible) {
            return;
        }
        db.get(`SELECT * FROM phrases WHERE id = ?`, [id], (err, row) => {
            if (err) {
                console.error(err.message);
                return;
            }
            event.reply('phrase-to-insert', row);
        });
    });
});

ipcMain.on('add-phrase', (event, { newPhrase, newExpandedText }) => {
    checkDatabaseAccessibility(accessible => {
        if (!accessible) {
            return;
        }
        checkDuplicatePhrase(newPhrase, null, isDuplicate => {
            if (isDuplicate) {
                event.reply('toast-message', { type: 'danger', message: i18n.t('Phrase already exists.') });
                return;
            }
            db.run(`INSERT INTO phrases (phrase, expanded_text) VALUES (?, ?)`, [newPhrase, newExpandedText], function(err) {
                if (err) {
                    event.reply('database-error', 'Failed to add phrase');
                    return;
                }
                event.reply('phrase-added', { id: this.lastID, phrase: newPhrase, expandedText: newExpandedText });
                event.reply('toast-message', { type: 'success', message: i18n.t('Phrase added successfully.') });
            });
        });
    });
});

ipcMain.on('edit-phrase', (event, { id, newPhrase, newExpandedText }) => {
    checkDatabaseAccessibility(accessible => {
        if (!accessible) {
            return;
        }
        checkDuplicatePhrase(newPhrase, id, isDuplicate => {
            if (isDuplicate) {
                event.reply('toast-message', { type: 'danger', message: i18n.t('Phrase already exists.') });
                return;
            }
            db.run(`UPDATE phrases SET phrase = ?, expanded_text = ? WHERE id = ?`, [newPhrase, newExpandedText, id], function(err) {
                if (err) {
                    event.reply('database-error', 'Failed to edit phrase');
                    return;
                }
                event.reply('phrase-edited', { id: id, phrase: newPhrase, expandedText: newExpandedText });
                event.reply('toast-message', { type: 'success', message: i18n.t('Phrase edited successfully.') });
            });
        });
    });
});

ipcMain.on('delete-phrase', (event, id) => {
    checkDatabaseAccessibility(accessible => {
        if (!accessible) {
            return;
        }
        db.run(`DELETE FROM phrases WHERE id = ?`, [id], function(err) {
            if (err) {
                event.reply('database-error', 'Failed to delete phrase');
                return;
            }
            event.reply('phrase-deleted', id);
            event.reply('toast-message', { type: 'success', message: i18n.t('Phrase deleted successfully.') });
        });
    });
});

ipcMain.on('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    event.reply('clipboard-updated');
});

ipcMain.on('increment-usage', (event, id) => {
    checkDatabaseAccessibility(accessible => {
        if (!accessible) {
            return;
        }
        db.run(`UPDATE phrases SET usageCount = usageCount + 1, dateLastUsed = CURRENT_TIMESTAMP WHERE id = ?`, [id], function(err) {
            if (err) {
                event.reply('database-error', 'Failed to increment usage');
                return;
            }
            event.reply('usage-incremented', id);
        });
    });
});

app.on('ready', () => {
    checkDatabaseAccessibility(() => {});
});

app.on('will-quit', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database connection', err);
        } else {
            console.log('Database connection closed');
        }
    });
});

export default db;