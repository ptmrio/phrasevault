const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { app, ipcMain, clipboard } = require("electron");
const state = require("./state.js");
const i18n = require("./i18n.js");
const { upgrades } = require("./database-upgrades.js");
const { marked } = require("marked");
const markedOptions = require("./_partial/_marked-options.js");
const { set } = require("electron-json-storage");
const { generateShortId } = require("./nanoid.js");
const { extractPhraseRefs } = require("./dynamic-inserts.js");

const dbPath = state.getConfig().dbPath;

const validTypes = ["plain", "markdown", "mdwysiwyg", "html"];

let db;

function initializeDatabase() {
    db = new sqlite3.Database(dbPath, async (err) => {
        if (err) {
            console.error("Error opening database:", err);
            return;
        }

        const initializeTables = state.getConfig().initializeTables;
        if (initializeTables) {
            db.run(
                `
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY
                )
            `,
                (err) => {
                    if (err) {
                        console.error("Error creating schema_version table:", err);
                        return;
                    }

                    const lastVersion = upgrades[upgrades.length - 1].version;
                    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [lastVersion], (err) => {
                        if (err) {
                            console.error("Error inserting schema version:", err);
                            return;
                        }

                        db.run(
                            `
                        CREATE TABLE IF NOT EXISTS phrases (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            phrase TEXT,
                            expanded_text TEXT,
                            type TEXT DEFAULT 'plain',
                            short_id TEXT UNIQUE,
                            usageCount INTEGER DEFAULT 0,
                            dateAdd DATETIME DEFAULT CURRENT_TIMESTAMP,
                            dateLastUsed DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `,
                            (err) => {
                                if (err) {
                                    console.error("Error creating phrases table:", err);
                                    return;
                                }

                                db.get("SELECT COUNT(*) AS count FROM phrases", (err, row) => {
                                    if (err) {
                                        console.error("Error counting phrases:", err);
                                        return;
                                    }

                                    if (row && row.count === 0) {
                                        // Fixed short_id for phone so signature cross-reference works
                                        const phoneId = "ph0n31d";
                                        const phrases = [
                                            { phrase: i18n.t("email"), expanded_text: i18n.t("examplePhrase1"), type: "plain", short_id: generateShortId() },
                                            { phrase: i18n.t("phone"), expanded_text: i18n.t("examplePhrase2"), type: "plain", short_id: phoneId },
                                            { phrase: i18n.t("addr"), expanded_text: i18n.t("examplePhrase3"), type: "plain", short_id: generateShortId() },
                                            { phrase: i18n.t("sig"), expanded_text: i18n.t("examplePhrase4").replace("{{phrase:PHONE_ID}}", `{{phrase:${phoneId}}}`), type: "plain", short_id: generateShortId() },
                                            { phrase: i18n.t("ty"), expanded_text: i18n.t("examplePhrase5"), type: "plain", short_id: generateShortId() },
                                            { phrase: i18n.t("today"), expanded_text: i18n.t("examplePhrase6"), type: "plain", short_id: generateShortId() },
                                        ];
                                        const stmt = db.prepare("INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (?, ?, ?, ?)");
                                        phrases.forEach((p) => stmt.run(p.phrase, p.expanded_text, p.type, p.short_id));
                                        stmt.finalize(() => {
                                            searchPhrases("", (err, rows) => {
                                                if (err) {
                                                    console.error("Error executing initial search:", err);
                                                }
                                            });
                                        });
                                    }

                                    state.setConfig({ initializeTables: false });
                                });
                            }
                        );
                    });
                }
            );
        } else {
            checkAndUpdateSchema();
        }
    });
}

async function checkAndUpdateSchema() {
    try {
        const currentVersion = await getCurrentSchemaVersion();
        let updated = false;
        let backupPath = null;

        for (const upgrade of upgrades) {
            if (currentVersion < upgrade.version) {
                if (!updated) {
                    backupPath = await backupDatabase();
                    updated = true;
                }
                await upgrade.upgrade(db);
                await updateSchemaVersion(upgrade.version);
            }
        }
        if (updated) {
            state.setConfig({ showOnStartup: true });
            setTimeout(() => {
                databaseEvents.emit("toast-message", {
                    type: "success",
                    message: i18n.t("Database schema upgraded successfully"),
                });
            }, 1000);
        }
    } catch (error) {
        console.error("Error upgrading database schema:", error);
        databaseEvents.emit("toast-message", {
            type: "danger",
            message: i18n.t("Error upgrading database schema, but a backup was created."),
        });
    }
}

function getCurrentSchemaVersion() {
    return new Promise((resolve, reject) => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'", (err, table) => {
            if (err) {
                reject(err);
            } else if (table) {
                db.get("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1", (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row ? row.version : 0);
                    }
                });
            } else {
                resolve(0); // Assume version 0 if the table doesn't exist
            }
        });
    });
}

function updateSchemaVersion(version) {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [version], (err) => {
            if (err) reject(err);
            resolve();
        });
    });
}

async function backupDatabase() {
    const dbPath = state.getConfig().dbPath;
    const backupPath = path.join(path.dirname(dbPath), `phrasevault_backup_${Date.now()}.sqlite`);
    try {
        await fs.promises.copyFile(dbPath, backupPath);
        return backupPath;
    } catch (error) {
        console.error("Failed to create database backup:", error);
        throw error;
    }
}

function checkDatabaseAccessibility(callback) {
    const firstRun = state.getConfig().firstRun;
    if (firstRun) {
        // create the database file if it doesn't exist
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, "");
        }

        state.setConfig({ firstRun: false });
    }

    fs.access(dbPath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK, (err) => {
        const accessible = !err;
        databaseEvents.emit("database-status", accessible);
        if (accessible) {
            initializeDatabase();
        } else {
            setTimeout(() => checkDatabaseAccessibility(callback), 5000);
        }
        callback(accessible);
    });
}

function checkDuplicatePhrase(phrase, id, callback) {
    const query = id ? `SELECT * FROM phrases WHERE phrase = ? AND id != ?` : `SELECT * FROM phrases WHERE phrase = ?`;
    db.get(
        query,
        [phrase, id].filter((v) => v),
        (err, row) => {
            if (err) {
                return callback(false);
            }
            callback(!!row);
        }
    );
}

/**
 * Generate a unique phrase name for duplication.
 * If "Copy of XY" exists, tries "Copy of XY (2)", "Copy of XY (3)", etc.
 */
function generateUniqueDuplicateName(originalPhrase, callback) {
    const baseName = i18n.t("Copy of") + " " + originalPhrase;

    // Get all phrases that start with the base name pattern
    db.all(`SELECT phrase FROM phrases WHERE phrase LIKE ?`, [baseName + "%"], (err, rows) => {
        if (err) {
            // Fallback to simple name on error
            return callback(baseName);
        }

        const existingNames = new Set(rows.map((r) => r.phrase));

        // If base name doesn't exist, use it
        if (!existingNames.has(baseName)) {
            return callback(baseName);
        }

        // Find the next available number
        let counter = 2;
        while (existingNames.has(`${baseName} (${counter})`)) {
            counter++;
        }

        callback(`${baseName} (${counter})`);
    });
}

function searchPhrases(searchText, callback) {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            callback(new Error("Database not accessible"), null);
            return;
        }

        const norm = (s) => (s ?? "").normalize("NFC").toLowerCase();
        const tokens = norm(searchText).split(/\s+/).filter(Boolean);

        db.all("SELECT * FROM phrases ORDER BY usageCount DESC", (err, rows) => {
            if (err) {
                callback(err, null);
                return;
            }

            if (!tokens.length) {
                callback(null, rows);
                return;
            }

            const nSearch = norm(searchText);

            const exactRows = rows.filter((r) => norm(r.phrase) === nSearch);

            const filtered = rows.filter((r) => {
                const p = norm(r.phrase);
                const e = norm(r.expanded_text);
                // every token must be found in either phrase or expanded_text
                return tokens.every((t) => p.includes(t) || e.includes(t));
            });

            // exact first, then others without dupes
            const unique = [...exactRows, ...filtered.filter((r) => !exactRows.some((er) => er.id === r.id))];

            callback(null, unique);
        });
    });
}

ipcMain.on("search-phrases", (event, searchText) => {
    searchPhrases(searchText, (err, rows) => {
        if (err) {
            event.reply("database-error", "Error executing search");
            return;
        }
        event.reply("phrases-list", rows);
    });
});

ipcMain.on("insert-phrase-by-id", (event, id) => {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            return;
        }
        db.get(`SELECT * FROM phrases WHERE id = ?`, [id], (err, row) => {
            if (err) {
                console.error(err.message);
                return;
            }
            databaseEvents.emit("insert-text", event, row);
        });
    });
});

ipcMain.on("add-phrase", (event, { newPhrase, newExpandedText, type }) => {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            return;
        }
        checkDuplicatePhrase(newPhrase, null, (isDuplicate) => {
            if (isDuplicate) {
                event.reply("toast-message", { type: "danger", message: i18n.t("Phrase already exists.") });
                return;
            }

            if (!validTypes.includes(type)) {
                event.reply("toast-message", { type: "danger", message: i18n.t("Invalid phrase type.") });
                return;
            }

            const shortId = generateShortId();
            db.run(`INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (?, ?, ?, ?)`, [newPhrase, newExpandedText, type, shortId], function (err) {
                if (err) {
                    event.reply("database-error", "Failed to add phrase");
                    return;
                }
                event.reply("phrase-added", { id: this.lastID, phrase: newPhrase, expandedText: newExpandedText, shortId: shortId });
                event.reply("toast-message", { type: "success", message: i18n.t("Phrase added successfully.") });
            });
        });
    });
});

ipcMain.on("edit-phrase", (event, { id, newPhrase, newExpandedText, type }) => {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            return;
        }
        checkDuplicatePhrase(newPhrase, id, (isDuplicate) => {
            if (isDuplicate) {
                event.reply("toast-message", { type: "danger", message: i18n.t("Phrase already exists.") });
                return;
            }

            if (!validTypes.includes(type)) {
                event.reply("toast-message", { type: "danger", message: i18n.t("Invalid phrase type.") });
                return;
            }

            // Check for self-reference
            db.get(`SELECT short_id FROM phrases WHERE id = ?`, [id], (err, row) => {
                if (err || !row) {
                    event.reply("database-error", "Failed to edit phrase");
                    return;
                }

                const referencedIds = extractPhraseRefs(newExpandedText);
                if (row.short_id && referencedIds.includes(row.short_id.toLowerCase())) {
                    event.reply("toast-message", { type: "danger", message: i18n.t("A phrase cannot reference itself.") });
                    return;
                }

                db.run(`UPDATE phrases SET phrase = ?, expanded_text = ?, type = ? WHERE id = ?`, [newPhrase, newExpandedText, type, id], function (err) {
                    if (err) {
                        event.reply("database-error", "Failed to edit phrase");
                        return;
                    }
                    event.reply("phrase-edited", { id: id, phrase: newPhrase, expandedText: newExpandedText });
                    event.reply("toast-message", { type: "success", message: i18n.t("Phrase edited successfully.") });
                });
            });
        });
    });
});

ipcMain.on("delete-phrase", (event, id) => {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            return;
        }
        db.run(`DELETE FROM phrases WHERE id = ?`, [id], function (err) {
            if (err) {
                event.reply("database-error", "Failed to delete phrase");
                return;
            }
            event.reply("phrase-deleted", id);
            // Toast with undo is handled in renderer
        });
    });
});

ipcMain.on("duplicate-phrase", (event, id) => {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            return;
        }
        db.get(`SELECT * FROM phrases WHERE id = ?`, [id], (err, row) => {
            if (err) {
                event.reply("database-error", "Failed to duplicate phrase");
                return;
            }
            if (!row) {
                event.reply("toast-message", { type: "danger", message: i18n.t("Phrase not found.") });
                return;
            }

            generateUniqueDuplicateName(row.phrase, (duplicatePhrase) => {
                const shortId = generateShortId();
                db.run(`INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (?, ?, ?, ?)`, [duplicatePhrase, row.expanded_text, row.type, shortId], function (err) {
                    if (err) {
                        event.reply("database-error", "Failed to duplicate phrase");
                        return;
                    }
                    event.reply("phrase-duplicated", { id: this.lastID, phrase: duplicatePhrase, expandedText: row.expanded_text, shortId: shortId });
                    event.reply("toast-message", { type: "success", message: i18n.t("Phrase duplicated successfully.") });
                });
            });
        });
    });
});

ipcMain.on("copy-to-clipboard", (event, phrase) => {
    if (phrase.type === "markdown") {
        marked.setOptions(markedOptions);
        let htmlText = marked(phrase.expanded_text);

        clipboard.write({
            text: phrase.expanded_text,
            html: htmlText,
        });
    } else {
        clipboard.writeText(phrase.expanded_text);
    }

    ipcMain.emit("increment-usage", event, phrase.id);
});

ipcMain.on("increment-usage", (event, id) => {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            return;
        }
        db.run(`UPDATE phrases SET usageCount = usageCount + 1, dateLastUsed = CURRENT_TIMESTAMP WHERE id = ?`, [id], function (err) {
            if (err) {
                console.error("Failed to increment usage:", err);
            }
        });
    });
});

app.on("will-quit", () => {
    if (!db) {
        return;
    }
    db.close((err) => {
        if (err) {
            console.error("Error closing database connection", err);
        } else {
            console.log("Database connection closed");
        }
    });
});

function initDatabase() {
    checkDatabaseAccessibility(() => {});
}

/**
 * Get a phrase by its short_id (for cross-insert resolution)
 * @param {string} shortId - 7-character short ID
 * @returns {Promise<Object|null>}
 */
function getPhraseByShortId(shortId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        db.get("SELECT * FROM phrases WHERE short_id = ?", [shortId], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

module.exports = { db, initDatabase, getPhraseByShortId };
