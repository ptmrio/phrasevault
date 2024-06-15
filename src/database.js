const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { app, ipcMain, clipboard } = require('electron');
const state = require('./state');

const dbPath = state.getConfig().dbPath;

// Create the database file if it does not exist
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, '');
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to database');
    }
});

// Ensure tables are created
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS phrases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phrase TEXT,
            expanded_text TEXT,
            usageCount INTEGER DEFAULT 0,
            dateAdd DATETIME DEFAULT CURRENT_TIMESTAMP,
            dateLastUsed DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Insert example phrases if the table is empty
    db.get('SELECT COUNT(*) AS count FROM phrases', (err, row) => {
        if (row.count === 0) {
            const examplePhrases = [
                {
                    phrase: "Customer Thank You",
                    expanded_text: "Dear [Customer Name],\n\nThank you for your recent purchase from our store. We hope you are happy with your purchase. If you have any questions or need further assistance, please don't hesitate to contact us.\n\nBest regards,\n[Your Company]"
                },
                {
                    phrase: "Out of Office",
                    expanded_text: "Hello,\n\nI am currently out of the office and will not be available until [Date]. For immediate assistance, please contact [Alternative Contact] at [Contact Information].\n\nThank you,\n[Your Name]"
                },
                {
                    phrase: "ChatGPT Prompt",
                    expanded_text: "Can you provide a summary of the latest developments in artificial intelligence research, focusing on key breakthroughs and emerging trends?"
                },
                {
                    phrase: "MidJourney Art Prompt",
                    expanded_text: "Create an abstract digital painting that represents the fusion of nature and technology, using vibrant colors and intricate details to illustrate the harmony between these two elements."
                }
            ];

            const stmt = db.prepare('INSERT INTO phrases (phrase, expanded_text) VALUES (?, ?)');
            examplePhrases.forEach(entry => {
                stmt.run(entry.phrase, entry.expanded_text);
            });
            stmt.finalize();
        }
    });
});

function checkDuplicatePhrase(phrase, id, callback) {
    const query = id ? `SELECT * FROM phrases WHERE phrase = ? AND id != ?` : `SELECT * FROM phrases WHERE phrase = ?`;
    const params = id ? [phrase, id] : [phrase];
    db.get(query, params, (err, row) => {
        if (err) {
            console.error(err.message);
            return;
        }
        callback(row ? true : false);
    });
}

ipcMain.on('search-phrases', (event, searchText) => {
    db.all(`SELECT * FROM phrases WHERE phrase LIKE ? OR expanded_text LIKE ? ORDER BY usageCount DESC, dateAdd DESC LIMIT 25`, [`%${searchText}%`, `%${searchText}%`], (err, rows) => {
        if (err) {
            console.error(err.message);
            return;
        }
        event.reply('phrases-list', rows);
    });
});

ipcMain.on('get-phrase-by-id', (event, id) => {
    db.get(`SELECT * FROM phrases WHERE id = ?`, [id], (err, row) => {
        if (err) {
            console.error(err.message);
            return;
        }
        event.reply('phrase-to-insert', row);
    });
});


ipcMain.on('add-phrase', (event, { newPhrase, newExpandedText }) => {
    checkDuplicatePhrase(newPhrase, null, (isDuplicate) => {
        if (isDuplicate) {
            event.reply('toast-message', { type: 'danger', message: 'Phrase already exists.' });
            return;
        }
        db.run(`INSERT INTO phrases (phrase, expanded_text) VALUES (?, ?)`, [newPhrase, newExpandedText], function(err) {
            if (err) {
                console.error(err.message);
                return;
            }
            event.reply('phrase-added', { id: this.lastID, phrase: newPhrase, expandedText: newExpandedText });
            event.reply('toast-message', { type: 'success', message: 'Phrase added successfully.' });
        });
    });
});

ipcMain.on('edit-phrase', (event, { id, newPhrase, newExpandedText }) => {
    checkDuplicatePhrase(newPhrase, id, (isDuplicate) => {
        if (isDuplicate) {
            event.reply('toast-message', { type: 'danger', message: 'Phrase already exists.' });
            return;
        }
        db.run(`UPDATE phrases SET phrase = ?, expanded_text = ? WHERE id = ?`, [newPhrase, newExpandedText, id], function(err) {
            if (err) {
                console.error(err.message);
                return;
            }
            event.reply('phrase-edited', { id: id, phrase: newPhrase, expandedText: newExpandedText });
            event.reply('toast-message', { type: 'success', message: 'Phrase edited successfully.' });
        });
    });
});


ipcMain.on('delete-phrase', (event, id) => {
    db.run(`DELETE FROM phrases WHERE id = ?`, [id], function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        event.reply('phrase-deleted', id);
        event.reply('toast-message', { type: 'success', message: 'Phrase deleted successfully.' });
    });
});

ipcMain.on('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    event.reply('clipboard-updated');
});

ipcMain.on('increment-usage', (event, id) => {
    db.run(`UPDATE phrases SET usageCount = usageCount + 1, dateLastUsed = CURRENT_TIMESTAMP WHERE id = ?`, [id], function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        event.reply('usage-incremented', id);
    });
});

// Close the database connection properly
app.on('will-quit', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database connection', err);
        } else {
            console.log('Database connection closed');
        }
    });
});

module.exports = db;
