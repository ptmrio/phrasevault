import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { app, ipcMain, clipboard } from "electron";
import state from "./state.js";
import i18n from "./i18n.js";
import { upgrades } from "./database-upgrades.js";
import { marked } from "marked";
import markedOptions from "./_partial/_marked-options.js";
import { set } from "electron-json-storage";

const dbPath = state.getConfig().dbPath;

const validTypes = ["plain", "markdown", "mdwysiwyg", "html"];

let db;

export function initializeDatabase() {
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
                                        const phrases = [
                                            { phrase: i18n.t("Customer Thank You"), expanded_text: i18n.t("examplePhrase1") },
                                            { phrase: i18n.t("Out of Office"), expanded_text: i18n.t("examplePhrase2") },
                                            { phrase: i18n.t("ChatGPT Prompt"), expanded_text: i18n.t("examplePhrase3") },
                                            { phrase: i18n.t("MidJourney Art Prompt"), expanded_text: i18n.t("examplePhrase4") },
                                        ];
                                        const stmt = db.prepare("INSERT INTO phrases (phrase, expanded_text) VALUES (?, ?)");
                                        phrases.forEach((p) => stmt.run(p.phrase, p.expanded_text));
                                        stmt.finalize(() => {
                                            searchPhrases("Customer Thank You", (err, rows) => {
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

export function checkDatabaseAccessibility(callback) {
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

function searchPhrases(searchText, callback) {
    checkDatabaseAccessibility((accessible) => {
        if (!accessible) {
            callback(new Error("Database not accessible"), null);
            return;
        }

        let exactMatchQuery = `SELECT * FROM phrases WHERE phrase = ? ORDER BY usageCount DESC`;
        let query;

        const words = searchText
            .split(" ")
            .map((word) => word.trim())
            .filter((word) => word.length > 0);

        if (words.length > 0) {
            const likeClauses = words.map((word) => `(phrase LIKE '%${word}%' OR expanded_text LIKE '%${word}%')`);
            query = `SELECT * FROM phrases WHERE ${likeClauses.join(" AND ")} ORDER BY usageCount DESC`;
        } else {
            query = "SELECT * FROM phrases ORDER BY usageCount DESC";
        }

        db.all(exactMatchQuery, [searchText], (err, exactRows) => {
            if (err) {
                callback(err, null);
                return;
            }

            db.all(query, (err, rows) => {
                if (err) {
                    callback(err, null);
                    return;
                }
                const combinedRows = [...exactRows, ...rows.filter((row) => !exactRows.some((er) => er.id === row.id))];
                const uniqueRows = combinedRows.filter((row, index, self) => self.findIndex((r) => r.id === row.id) === index);
                callback(null, uniqueRows);
            });
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

            db.run(`INSERT INTO phrases (phrase, expanded_text, type) VALUES (?, ?, ?)`, [newPhrase, newExpandedText, type], function (err) {
                if (err) {
                    event.reply("database-error", "Failed to add phrase");
                    return;
                }
                event.reply("phrase-added", { id: this.lastID, phrase: newPhrase, expandedText: newExpandedText });
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
            event.reply("toast-message", { type: "success", message: i18n.t("Phrase deleted successfully.") });
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
                event.reply("database-error", "Failed to increment usage");
                return;
            }
            event.reply("usage-incremented", id);
        });
    });
});

app.on("ready", () => {
    checkDatabaseAccessibility(() => {});
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

export default db;
