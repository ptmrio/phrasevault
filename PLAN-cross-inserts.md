# Cross-Insert (Nested Phrases) Implementation Plan

## Status: ✅ Implemented

See `src/dynamic-inserts.js` (cross-insert functions), `src/nanoid.js` (ID generator), and `src/database-upgrades.js` (V2 schema).

---

## Overview

Allow phrases to reference and include other phrases using a simple ID-based syntax. Referenced phrases are resolved recursively, including their dynamic placeholders.

---

## Design Goals

1. **User-friendly IDs**: Short, memorable NanoID identifiers (not raw DB integers)
2. **Simple syntax**: Consistent with existing `{{type}}` pattern
3. **Recursive resolution**: Nested phrases can contain their own dynamic inserts
4. **Cycle protection**: Prevent infinite loops from circular references
5. **Easy discovery**: "Copy ID" in the three-dots menu for quick access

---

## Syntax Design

### Chosen Syntax: `{{phrase:ID}}`

| Syntax | Example | Description |
|--------|---------|-------------|
| `{{phrase:a1b2c3d}}` | Inserts phrase with short_id `a1b2c3d` | NanoID reference |

**Rationale:**
- Consistent with existing `{{type:options}}` pattern
- `phrase` keyword is clear and unambiguous
- NanoID is stable, portable (survives DB export/import), looks professional

---

## NanoID Implementation

### Why NanoID over Raw Database ID?

| Aspect | Raw DB ID | NanoID |
|--------|-----------|--------|
| Appearance | `42` | `a1b2c3d` |
| User perception | "Arbitrary number" | "Real identifier" |
| Portability | Breaks on DB reimport | Survives export/import |
| Collision risk | N/A (auto-increment) | Negligible at 7 chars |
| Professional feel | Low | High (YouTube, Notion style) |

### NanoID Specification

| Property | Value | Rationale |
|----------|-------|-----------|
| **Length** | 7 characters | Short enough for UX, safe for <100k phrases |
| **Alphabet** | `0123456789abcdefghijklmnopqrstuvwxyz` (base36) | Lowercase only = no confusion (l/I, 0/O) |
| **Collision probability** | 1% at 100k IDs generated over decades | More than sufficient |
| **Generation** | On phrase creation | One-time, stored in DB |

### Collision Math (7 chars, base36)

```
Total combinations: 36^7 = 78,364,164,096 (~78 billion)
At 10,000 phrases: collision probability ≈ 0.0000006%
At 100,000 phrases: collision probability ≈ 0.00006%
```

**Verdict:** 7 characters is more than safe for a personal/small-team phrase manager.

---

## Database Schema Change

### New Column: `short_id`

```sql
ALTER TABLE phrases ADD COLUMN short_id TEXT UNIQUE;
```

### Migration Strategy (Schema Version 2)

1. Add `short_id` column (nullable initially)
2. Generate NanoID for all existing phrases
3. Add UNIQUE constraint
4. New phrases get NanoID at creation time

---

## Database Upgrade Routine Analysis

### Current Implementation Review

**File:** `src/database-upgrades.js`

```javascript
const upgrades = [
    { version: 1, upgrade: upgradeToV1 },
];
```

**File:** `src/database.js` - `checkAndUpdateSchema()`

| Step | Status | Notes |
|------|--------|-------|
| 1. Get current version | ✅ Solid | Handles missing table |
| 2. Backup before upgrade | ✅ Solid | Creates timestamped backup |
| 3. Run upgrades sequentially | ✅ Solid | Compares version numbers |
| 4. Update version after each | ✅ Solid | INSERT OR REPLACE |
| 5. Show toast on success | ✅ Solid | User feedback |
| 6. Error handling | ⚠️ Partial | Catches error but backup already made |

### Potential Issues Identified

| Issue | Severity | Fix Needed? |
|-------|----------|-------------|
| V1 upgrade rejects on existing column | Low | SQLite ignores duplicate ADD COLUMN with IF NOT EXISTS |
| No transaction wrapping | Medium | Add for V2 (data modification) |
| Backup path not shown to user | Low | Nice to have |

### Recommendation for V2 Upgrade

Wrap the upgrade in a transaction for safety:

```javascript
function upgradeToV2(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            // 1. Add column
            db.run(`ALTER TABLE phrases ADD COLUMN short_id TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    db.run("ROLLBACK");
                    reject(err);
                    return;
                }
                
                // 2. Generate IDs for existing phrases
                db.all("SELECT id FROM phrases WHERE short_id IS NULL", (err, rows) => {
                    if (err) {
                        db.run("ROLLBACK");
                        reject(err);
                        return;
                    }
                    
                    const stmt = db.prepare("UPDATE phrases SET short_id = ? WHERE id = ?");
                    for (const row of rows) {
                        stmt.run(generateNanoId(), row.id);
                    }
                    stmt.finalize(() => {
                        // 3. Create unique index
                        db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_phrases_short_id ON phrases(short_id)", (err) => {
                            if (err) {
                                db.run("ROLLBACK");
                                reject(err);
                                return;
                            }
                            db.run("COMMIT", resolve);
                        });
                    });
                });
            });
        });
    });
}
```

---

## UI Changes

### 1. Three-Dots Menu: Add "Copy ID"

Location: `src/renderer.js` - phrase list item menu

```
┌─────────────────────┐
│ 📋 Duplicate Phrase │
│ 🔗 Copy ID          │  ← NEW
│ 🗑️ Delete Phrase    │
└─────────────────────┘
```

**Behavior:**
- Copies `{{phrase:a1b2c3d}}` to clipboard (ready to paste)
- Shows toast: "Phrase ID copied"

### 2. Edit Modal: Show ID (Read-only)

Location: `templates/index.html` - edit phrase modal

```
┌──────────────────────────────────┐
│ Edit Phrase                      │
├──────────────────────────────────┤
│ ID: a1b2c3d  [Copy]              │  ← NEW (small, subtle)
│                                  │
│ Title: ___________________       │
│ Content: _________________       │
└──────────────────────────────────┘
```

**Behavior:**
- Shows phrase short_id in small text
- "Copy" button copies `{{phrase:a1b2c3d}}` to clipboard

---

## Processing Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    CROSS-INSERT FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User selects phrase                                     │
│          ↓                                                  │
│  2. Parse for {{phrase:ID}} placeholders                    │
│          ↓                                                  │
│  3. For each reference:                                     │
│     a. Fetch phrase from database                           │
│     b. Check cycle (track visited IDs)                      │
│     c. Recursively process nested phrase                    │
│     d. Replace placeholder with resolved content            │
│          ↓                                                  │
│  4. Process remaining dynamic inserts (date, input, etc.)   │
│          ↓                                                  │
│  5. Show prompt modal if needed                             │
│          ↓                                                  │
│  6. Paste final result                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Cycle Detection

Prevent infinite loops:
```javascript
function resolveCrossInserts(text, visitedIds = new Set()) {
    // If we've seen this ID before, we have a cycle
    if (visitedIds.has(currentId)) {
        return '{{phrase:' + currentId + '}}'; // Leave unresolved
    }
    visitedIds.add(currentId);
    // ... resolve and recurse
}
```

---

## Implementation Details

### Files to Modify

| File | Changes |
|------|---------|
| `src/database-upgrades.js` | Add V2 upgrade with `short_id` column + NanoID generation |
| `src/database.js` | Add `getPhraseByShortId()`, generate NanoID on insert |
| `src/dynamic-inserts.js` | Add `resolveCrossInserts()` with short_id lookup |
| `src/main.js` | Pass database lookup function to dynamic-inserts |
| `src/renderer.js` | Add "Copy ID" menu item, pass short_id to UI |
| `templates/index.html` | Add ID display in edit modal |
| `locales/*.js` | Add translation keys |

### New Dependency

```bash
npm install nanoid
```

**Note:** Use nanoid's `customAlphabet` for base36 lowercase-only IDs.

---

## Code Snippets

### 0. NanoID Generator Utility

**File:** `src/nanoid.js` (new file)

```javascript
const { customAlphabet } = require('nanoid');

// Base36 lowercase alphabet (no uppercase to avoid confusion)
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const SHORT_ID_LENGTH = 7;

const generateShortId = customAlphabet(alphabet, SHORT_ID_LENGTH);

module.exports = { generateShortId, SHORT_ID_LENGTH };
```

### 1. Database Upgrade V2

**File:** `src/database-upgrades.js`

```javascript
const { generateShortId } = require('./nanoid.js');

const upgrades = [
    { version: 1, upgrade: upgradeToV1 },
    { version: 2, upgrade: upgradeToV2 },
];

function upgradeToV2(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
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
                        createUniqueIndex(db, resolve, reject);
                        return;
                    }
                    
                    const stmt = db.prepare("UPDATE phrases SET short_id = ? WHERE id = ?");
                    let completed = 0;
                    
                    for (const row of rows) {
                        stmt.run(generateShortId(), row.id, (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            completed++;
                            if (completed === rows.length) {
                                stmt.finalize(() => {
                                    createUniqueIndex(db, resolve, reject);
                                });
                            }
                        });
                    }
                });
            });
        });
    });
}

function createUniqueIndex(db, resolve, reject) {
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_phrases_short_id ON phrases(short_id)", (err) => {
        if (err) {
            reject(err);
            return;
        }
        resolve();
    });
}

module.exports = { upgrades };
```

### 2. Database: Add `getPhraseByShortId()` and modify insert

**File:** `src/database.js`

```javascript
const { generateShortId } = require('./nanoid.js');

// New function to fetch by short_id
function getPhraseByShortId(shortId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM phrases WHERE short_id = ?", [shortId], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

// Modify addPhrase to include short_id generation
function addPhrase(phrase, expanded_text, type = "plain", callback) {
    const shortId = generateShortId();
    db.run(
        "INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES (?, ?, ?, ?)",
        [phrase, expanded_text, type, shortId],
        function (err) {
            if (err) {
                callback(err);
            } else {
                callback(null, { id: this.lastID, short_id: shortId });
            }
        }
    );
}

// Add to exports
module.exports = {
    // ... existing exports
    getPhraseByShortId
};
```

### 3. Dynamic Inserts: Cross-Insert with NanoID

**File:** `src/dynamic-inserts.js`

```javascript
// Regex for NanoID-based phrase references (7 alphanumeric chars)
const PHRASE_REF_REGEX = /(?<!\\)\{\{phrase:([a-z0-9]{7})\}\}/gi;

/**
 * Check if text contains cross-insert references
 * @param {string} text
 * @returns {boolean}
 */
function hasCrossInserts(text) {
    const regex = new RegExp(PHRASE_REF_REGEX.source, 'gi');
    return regex.test(text);
}

/**
 * Extract all phrase short_ids referenced in text
 * @param {string} text
 * @returns {string[]}
 */
function extractPhraseRefs(text) {
    const regex = new RegExp(PHRASE_REF_REGEX.source, 'gi');
    const ids = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        ids.push(match[1].toLowerCase());
    }
    return ids;
}

/**
 * Resolve cross-insert references
 * @param {string} text - Text with {{phrase:short_id}} placeholders
 * @param {Function} getPhraseByShortId - Async function to fetch phrase
 * @param {Set<string>} visitedIds - Track visited short_ids for cycle detection
 * @param {number} maxDepth - Maximum nesting depth (default: 10)
 * @returns {Promise<string>}
 */
async function resolveCrossInserts(text, getPhraseByShortId, visitedIds = new Set(), maxDepth = 10) {
    if (maxDepth <= 0) {
        console.warn('Cross-insert max depth reached');
        return text;
    }

    const regex = new RegExp(PHRASE_REF_REGEX.source, 'gi');
    let result = text;
    
    // Collect all matches first
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push({
            full: match[0],
            shortId: match[1].toLowerCase()
        });
    }

    // Resolve each reference
    for (const { full, shortId } of matches) {
        // Cycle detection
        if (visitedIds.has(shortId)) {
            console.warn(`Circular reference detected: ${shortId}`);
            continue;
        }

        try {
            const phrase = await getPhraseByShortId(shortId);
            if (!phrase) {
                console.warn(`Phrase not found: ${shortId}`);
                continue;
            }

            const newVisited = new Set(visitedIds);
            newVisited.add(shortId);

            let resolvedContent = phrase.expanded_text;
            if (hasCrossInserts(resolvedContent)) {
                resolvedContent = await resolveCrossInserts(
                    resolvedContent, 
                    getPhraseByShortId, 
                    newVisited, 
                    maxDepth - 1
                );
            }

            result = result.replace(full, resolvedContent);
        } catch (error) {
            console.error(`Error resolving phrase ${shortId}:`, error);
        }
    }

    return result;
}

module.exports = {
    // ... existing exports
    hasCrossInserts,
    extractPhraseRefs,
    resolveCrossInserts
};
```

### 4. Main Process: Integrate Cross-Inserts

**File:** `src/main.js`

```javascript
const { getPhraseByShortId } = require("./database.js");

databaseEvents.on("insert-text", async (event, phrase) => {
    let textToInsert = phrase.expanded_text;

    // Step 1: Resolve cross-inserts first
    if (dynamicInserts.hasCrossInserts(textToInsert)) {
        textToInsert = await dynamicInserts.resolveCrossInserts(
            textToInsert,
            getPhraseByShortId,
            new Set([phrase.short_id]) // Prevent self-reference
        );
    }

    // Step 2: Process dynamic content (existing code)
    if (dynamicInserts.hasDynamicContent(textToInsert)) {
        // ... existing dynamic insert handling
    }

    performPaste(phrase, textToInsert);
});
```

### 5. Renderer: Copy ID with short_id

**File:** `src/renderer.js`

```javascript
// The phrase object now includes short_id from database
// Update menu item to use short_id

const copyIdItem = document.createElement("div");
copyIdItem.className = "menu-item";
copyIdItem.setAttribute("data-action", "copy-id");
copyIdItem.setAttribute("data-short-id", phrase.short_id);
const svgLink = createSvgIcon("icon-link");
const spanCopyId = document.createElement("span");
spanCopyId.textContent = window.i18n.t("Copy ID");
copyIdItem.appendChild(svgLink);
copyIdItem.appendChild(spanCopyId);
menu.appendChild(copyIdItem);

// In click handler
if (action === "copy-id") {
    const shortId = e.currentTarget.getAttribute("data-short-id");
    const idText = `{{phrase:${shortId}}}`;
    navigator.clipboard.writeText(idText).then(() => {
        window.modals.showToast(window.i18n.t("Phrase ID copied"), "success");
    });
    menu.style.display = "none";
    return;
}
```

### 6. Localization: Add Translation Keys

**File:** `locales/en.js` (and all other locale files)

```javascript
// Add to translation object
"Copy ID": "Copy ID",
"Phrase ID copied": "Phrase ID copied",
"Phrase not found": "Phrase not found",
```

**German (`de.js`):**
```javascript
"Copy ID": "ID kopieren",
"Phrase ID copied": "Phrasen-ID kopiert",
"Phrase not found": "Phrase nicht gefunden",
```

---

## Test Cases

### Unit Tests (Vitest)

**File:** `test/dynamic-inserts.test.js`

```javascript
describe('cross-inserts', () => {
    const mockGetPhrase = async (shortId) => {
        const phrases = {
            'abc1234': { short_id: 'abc1234', expanded_text: 'Hello World' },
            'def5678': { short_id: 'def5678', expanded_text: 'Date: {{date}}' },
            'ghi9012': { short_id: 'ghi9012', expanded_text: 'Nested: {{phrase:abc1234}}' },
            'jkl3456': { short_id: 'jkl3456', expanded_text: 'Circular: {{phrase:mno7890}}' },
            'mno7890': { short_id: 'mno7890', expanded_text: 'Back: {{phrase:jkl3456}}' }
        };
        return phrases[shortId] || null;
    };

    it('detects cross-insert syntax', () => {
        expect(hasCrossInserts('{{phrase:abc1234}}')).toBe(true);
        expect(hasCrossInserts('plain text')).toBe(false);
    });

    it('extracts phrase short_ids', () => {
        const ids = extractPhraseRefs('{{phrase:abc1234}} and {{phrase:def5678}}');
        expect(ids).toEqual(['abc1234', 'def5678']);
    });

    it('resolves simple reference', async () => {
        const result = await resolveCrossInserts('Say: {{phrase:abc1234}}', mockGetPhrase);
        expect(result).toBe('Say: Hello World');
    });

    it('resolves nested references', async () => {
        const result = await resolveCrossInserts('{{phrase:ghi9012}}', mockGetPhrase);
        expect(result).toBe('Nested: Hello World');
    });

    it('handles missing phrase gracefully', async () => {
        const result = await resolveCrossInserts('{{phrase:zzz9999}}', mockGetPhrase);
        expect(result).toBe('{{phrase:zzz9999}}');
    });

    it('detects circular references', async () => {
        const result = await resolveCrossInserts('{{phrase:jkl3456}}', mockGetPhrase);
        // Should not infinite loop, leaves second reference unresolved
        expect(result).toContain('{{phrase:');
    });

    it('preserves dynamic inserts in referenced phrases', async () => {
        const result = await resolveCrossInserts('{{phrase:def5678}}', mockGetPhrase);
        expect(result).toBe('Date: {{date}}');
    });
});
```

### Manual Test SQL

**File:** `test/test-phrases.sql`

After schema upgrade, test phrases will have auto-generated short_ids:
```sql
-- Cross-insert test phrases (short_id will be auto-generated)
INSERT INTO phrases (phrase, expanded_text, type, short_id) VALUES
('Signature Base', 'Best regards,\nJohn Doe', 'plain', 'sig0001'),
('Email with Sig', 'Thank you for your message.\n\n{{phrase:sig0001}}', 'plain', 'eml0001'),
('Nested Date', 'Today is {{date}}. {{phrase:sig0001}}', 'plain', 'nst0001');
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Self-reference `{{phrase:abc1234}}` | Ignored (starting short_id in visitedIds) |
| Circular A→B→A | Second occurrence left unresolved |
| Missing phrase short_id | Placeholder left as-is |
| Invalid ID format (not 7 chars) | Placeholder left as-is |
| Deeply nested (>10 levels) | Stops at max depth |
| Cross-insert + dynamic | Dynamic resolved after cross-insert |
| Escaped `\{{phrase:abc1234}}` | Renders as literal `{{phrase:abc1234}}` |

---

## Implementation Checklist

### Phase 0: Database Schema
- [ ] Install nanoid: `npm install nanoid`
- [ ] Create `src/nanoid.js` utility
- [ ] Add V2 upgrade to `database-upgrades.js`
- [ ] Update `addPhrase()` to generate short_id
- [ ] Add `getPhraseByShortId()` function
- [ ] Test upgrade on existing database

### Phase 1: Core Logic
- [ ] Add cross-insert functions to dynamic-inserts.js
- [ ] Integrate into main.js insert-text handler
- [ ] Add unit tests for cross-inserts

### Phase 2: UI
- [ ] Add "Copy ID" to three-dots menu
- [ ] Add ID display to edit modal (optional)
- [ ] Add translation keys to all 6 locales
- [ ] Update renderer to pass short_id

### Phase 3: Testing
- [ ] Run unit tests
- [ ] Test schema upgrade (fresh DB + existing DB)
- [ ] Manual testing with nested phrases
- [ ] Test circular reference protection
- [ ] Test with dynamic inserts in nested phrases

---

## Future Enhancements

1. **Alias support**: `{{phrase:my-signature}}` using phrase title
   - Requires title uniqueness or disambiguation UI
   - More user-friendly but less stable (title changes break references)

2. **Preview in editor**: Show resolved preview when editing
   - Requires async preview generation

3. **Dependency graph**: Show which phrases reference which
   - Useful for understanding impact of edits

4. **Bulk ID display**: Show IDs in phrase list on hover/option
