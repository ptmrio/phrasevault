# Dynamic Inserts Implementation Plan

## Status: ✅ Implemented

See `src/dynamic-inserts.js` for the implementation.

---

## Overview

Add dynamic placeholder support to PhraseVault phrases. When a phrase containing placeholders is inserted, PhraseVault processes them—either automatically (dates, clipboard) or via a single unified prompt modal (inputs, selections).

## Design Goals

1. **Easy for non-techies**: Simple, memorable syntax
2. **Quick for power users**: Full keyboard navigation, batch prompts in one modal
3. **Non-conflicting**: Syntax unlikely to appear in normal text
4. **Escapable**: Users can insert literal placeholder text when needed

---

## Syntax Design

### Chosen Syntax: `{{type:options}}`

**Rationale:**
- Double curly braces `{{...}}` are rare in everyday text
- Familiar to users of template engines (Handlebars, Mustache)
- Clear visual distinction from normal text
- Single `{` can appear in code/JSON, double is safer

### Escape Syntax: `\{{...}}`

Prefix with backslash to insert literally: `\{{date}}` → `{{date}}`

---

## Placeholder Types

### 1. Date/Time (Auto-resolved)

| Placeholder | Output Example | Description |
|-------------|----------------|-------------|
| `{{date}}` | `2026-01-13` | Today (ISO format) |
| `{{date:short}}` | `1/13/26` | Short locale format |
| `{{date:long}}` | `January 13, 2026` | Long locale format |
| `{{date:+7}}` | `2026-01-20` | 7 days from today |
| `{{date:-1}}` | `2026-01-12` | Yesterday |
| `{{date:-7\|long}}` | `January 6, 2026` | Offset + format combo |
| `{{time}}` | `14:30` | Current time (24h) |
| `{{time:12h}}` | `2:30 PM` | 12-hour format |
| `{{datetime}}` | `2026-01-13 14:30` | Date + time |
| `{{datetime:-1\|short}}` | `1/12/26 14:30` | Yesterday, short format |
| `{{weekday}}` | `Monday` | Day name |
| `{{month}}` | `January` | Month name |
| `{{year}}` | `2026` | Year |

**Offset + Format Combinations (pipe separator):**
```
{{date:-7|long}}        → January 6, 2026 (7 days ago, long format)
{{date:+30|DD/MM/YYYY}} → 12/02/2026 (30 days ahead, custom format)
{{datetime:-1|short}}   → 1/12/26 2:30 PM (yesterday, short)
{{date:0|MM/DD/YYYY}}   → 01/13/2026 (today, US format)
```

**Custom format support:**
```
{{date:YYYY-MM-DD}}     → 2026-01-13
{{date:DD/MM/YYYY}}     → 13/01/2026
{{date:MMM D, YYYY}}    → Jan 13, 2026
{{time:HH:mm:ss}}       → 14:30:45
```

### 2. Clipboard (Auto-resolved)

| Placeholder | Description |
|-------------|-------------|
| `{{clipboard}}` | Current clipboard text content |

### 3. Text Input (Prompted)

| Placeholder | Description |
|-------------|-------------|
| `{{input}}` | Simple text input |
| `{{input:Name}}` | Labeled input field |
| `{{input:Name=John}}` | Input with default value |
| `{{input:Email=}}` | Empty default (just shows label) |

**Multi-line:**
```
{{textarea:Description}}
{{textarea:Notes=Default text here}}
```

### 4. Selection/Dropdown (Prompted)

| Placeholder | Description |
|-------------|-------------|
| `{{select:Option1,Option2,Option3}}` | Dropdown selection |
| `{{select:Status=Draft,Review,Published}}` | Labeled dropdown |
| `{{select:Priority=Low,*Medium,High}}` | `*` marks default |

### 5. Reusable Variables

When the same placeholder name appears multiple times, prompt once and reuse:

```
Dear {{input:Name}},

Thank you for contacting us, {{input:Name}}.
```

User is prompted for "Name" once, value inserted in both places.

---

## Implementation Architecture

### File Changes Overview

```
src/
├── dynamic-inserts.js       # NEW: Core parsing and processing
├── main.js                  # Modify: integrate processing before paste
├── renderer.js              # Modify: show prompt modal via IPC
├── _partial/
│   └── _renderer-modal.js   # Modify: add dynamic insert prompt modal
├── preload.js               # Modify: add IPC channels
templates/
└── index.html               # Modify: add prompt modal HTML
locales/
└── *.js                     # Modify: add translation keys
```

---

## Core Module: `src/dynamic-inserts.js`

```javascript
/**
 * Dynamic Inserts Module
 * Parses and processes placeholder syntax in phrase text
 */

// Regex to match placeholders (non-escaped)
const PLACEHOLDER_REGEX = /(?<!\\)\{\{([^}]+)\}\}/g;
const ESCAPE_REGEX = /\\\{\{([^}]+)\}\}/g;

/**
 * Parse a phrase and extract all placeholders
 * @param {string} text - The phrase text
 * @returns {Array<{raw: string, type: string, label: string, options: any, index: number}>}
 */
function parsePlaceholders(text) {
    const placeholders = [];
    let match;
    
    while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
        const raw = match[0];
        const content = match[1];
        const parsed = parseContent(content);
        
        placeholders.push({
            raw,
            index: match.index,
            ...parsed
        });
    }
    
    return placeholders;
}

/**
 * Parse placeholder content into structured data
 * @param {string} content - Content inside {{...}}
 * @returns {{type: string, label: string, options: any}}
 */
function parseContent(content) {
    // Split on first colon
    const colonIndex = content.indexOf(':');
    
    if (colonIndex === -1) {
        // Simple type like {{date}}, {{clipboard}}, {{input}}
        return { type: content.toLowerCase(), label: '', options: null };
    }
    
    const type = content.substring(0, colonIndex).toLowerCase();
    const rest = content.substring(colonIndex + 1);
    
    switch (type) {
        case 'date':
        case 'time':
        case 'datetime':
            return { type, label: '', options: rest };
            
        case 'input':
        case 'textarea':
            return parseInputOptions(type, rest);
            
        case 'select':
            return parseSelectOptions(rest);
            
        default:
            // Unknown type, treat as input with label
            return { type: 'input', label: content, options: null };
    }
}

/**
 * Parse input/textarea options: "Label=Default"
 */
function parseInputOptions(type, rest) {
    const eqIndex = rest.indexOf('=');
    if (eqIndex === -1) {
        return { type, label: rest, options: { default: '' } };
    }
    return {
        type,
        label: rest.substring(0, eqIndex),
        options: { default: rest.substring(eqIndex + 1) }
    };
}

/**
 * Parse select options: "Label=Opt1,*Opt2,Opt3" or "Opt1,Opt2,Opt3"
 */
function parseSelectOptions(rest) {
    const eqIndex = rest.indexOf('=');
    let label = '';
    let optionsStr = rest;
    
    if (eqIndex !== -1) {
        label = rest.substring(0, eqIndex);
        optionsStr = rest.substring(eqIndex + 1);
    }
    
    const choices = optionsStr.split(',').map(opt => {
        const isDefault = opt.startsWith('*');
        return {
            value: isDefault ? opt.substring(1) : opt,
            default: isDefault
        };
    });
    
    return { type: 'select', label, options: { choices } };
}

/**
 * Check if phrase has any dynamic placeholders
 */
function hasDynamicContent(text) {
    return PLACEHOLDER_REGEX.test(text);
}

/**
 * Get placeholders that need user prompts (not auto-resolvable)
 */
function getPromptablePlaceholders(placeholders) {
    const promptTypes = ['input', 'textarea', 'select'];
    const seen = new Set();
    
    return placeholders.filter(p => {
        if (!promptTypes.includes(p.type)) return false;
        
        // Deduplicate by label (for reusable variables)
        const key = `${p.type}:${p.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Resolve auto-resolvable placeholders (date, time, clipboard)
 * @param {string} text - The phrase text
 * @param {string} clipboardContent - Current clipboard content
 * @returns {string} - Text with auto placeholders resolved
 */
function resolveAutoPlaceholders(text, clipboardContent = '') {
    return text.replace(PLACEHOLDER_REGEX, (match, content) => {
        const parsed = parseContent(content);
        
        switch (parsed.type) {
            case 'date':
                return formatDate(parsed.options);
            case 'time':
                return formatTime(parsed.options);
            case 'datetime':
                return formatDateTime(parsed.options);
            case 'weekday':
                return new Date().toLocaleDateString(undefined, { weekday: 'long' });
            case 'month':
                return new Date().toLocaleDateString(undefined, { month: 'long' });
            case 'year':
                return new Date().getFullYear().toString();
            case 'clipboard':
                return clipboardContent;
            default:
                return match; // Leave for prompted resolution
        }
    });
}

/**
 * Format date with options
 */
function formatDate(options) {
    let date = new Date();
    
    if (!options) {
        return date.toISOString().split('T')[0]; // YYYY-MM-DD
    }
    
    // Handle offset: +7, -1
    const offsetMatch = options.match(/^([+-])(\d+)$/);
    if (offsetMatch) {
        const days = parseInt(offsetMatch[2]) * (offsetMatch[1] === '-' ? -1 : 1);
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    }
    
    // Preset formats
    switch (options) {
        case 'short':
            return date.toLocaleDateString();
        case 'long':
            return date.toLocaleDateString(undefined, { 
                year: 'numeric', month: 'long', day: 'numeric' 
            });
        default:
            // Custom format string
            return formatCustomDate(date, options);
    }
}

/**
 * Custom date formatting
 */
function formatCustomDate(date, format) {
    const tokens = {
        'YYYY': date.getFullYear(),
        'YY': String(date.getFullYear()).slice(-2),
        'MMMM': date.toLocaleDateString(undefined, { month: 'long' }),
        'MMM': date.toLocaleDateString(undefined, { month: 'short' }),
        'MM': String(date.getMonth() + 1).padStart(2, '0'),
        'M': date.getMonth() + 1,
        'DD': String(date.getDate()).padStart(2, '0'),
        'D': date.getDate(),
        'dddd': date.toLocaleDateString(undefined, { weekday: 'long' }),
        'ddd': date.toLocaleDateString(undefined, { weekday: 'short' }),
    };
    
    let result = format;
    // Sort by length descending to replace longer tokens first
    Object.keys(tokens)
        .sort((a, b) => b.length - a.length)
        .forEach(token => {
            result = result.replace(new RegExp(token, 'g'), tokens[token]);
        });
    
    return result;
}

/**
 * Format time with options
 */
function formatTime(options) {
    const now = new Date();
    
    if (options === '12h') {
        return now.toLocaleTimeString(undefined, { 
            hour: 'numeric', minute: '2-digit', hour12: true 
        });
    }
    
    if (options && options.includes(':')) {
        return formatCustomTime(now, options);
    }
    
    // Default: 24h HH:mm
    return now.toLocaleTimeString(undefined, { 
        hour: '2-digit', minute: '2-digit', hour12: false 
    });
}

/**
 * Custom time formatting
 */
function formatCustomTime(date, format) {
    const tokens = {
        'HH': String(date.getHours()).padStart(2, '0'),
        'H': date.getHours(),
        'hh': String(date.getHours() % 12 || 12).padStart(2, '0'),
        'h': date.getHours() % 12 || 12,
        'mm': String(date.getMinutes()).padStart(2, '0'),
        'm': date.getMinutes(),
        'ss': String(date.getSeconds()).padStart(2, '0'),
        's': date.getSeconds(),
        'A': date.getHours() >= 12 ? 'PM' : 'AM',
        'a': date.getHours() >= 12 ? 'pm' : 'am',
    };
    
    let result = format;
    Object.keys(tokens)
        .sort((a, b) => b.length - a.length)
        .forEach(token => {
            result = result.replace(new RegExp(token, 'g'), tokens[token]);
        });
    
    return result;
}

/**
 * Format datetime
 */
function formatDateTime(options) {
    const date = formatDate(null);
    const time = formatTime(null);
    return `${date} ${time}`;
}

/**
 * Apply user-provided values to prompted placeholders
 * @param {string} text - Text with remaining placeholders
 * @param {Object} values - Map of label -> value
 * @returns {string}
 */
function applyPromptedValues(text, values) {
    return text.replace(PLACEHOLDER_REGEX, (match, content) => {
        const parsed = parseContent(content);
        
        if (['input', 'textarea', 'select'].includes(parsed.type)) {
            const key = parsed.label || parsed.type;
            if (values.hasOwnProperty(key)) {
                return values[key];
            }
        }
        
        return match;
    });
}

/**
 * Unescape literal placeholders
 */
function unescapePlaceholders(text) {
    return text.replace(ESCAPE_REGEX, '{{$1}}');
}

/**
 * Full processing pipeline
 * @param {string} text - Original phrase text
 * @param {string} clipboardContent - Clipboard content
 * @param {Object} promptedValues - User-provided values (empty if no prompts needed)
 * @returns {string} - Fully processed text
 */
function processPhrase(text, clipboardContent, promptedValues = {}) {
    // 1. Resolve auto placeholders
    let result = resolveAutoPlaceholders(text, clipboardContent);
    
    // 2. Apply prompted values
    result = applyPromptedValues(result, promptedValues);
    
    // 3. Unescape literal placeholders
    result = unescapePlaceholders(result);
    
    return result;
}

module.exports = {
    parsePlaceholders,
    hasDynamicContent,
    getPromptablePlaceholders,
    resolveAutoPlaceholders,
    applyPromptedValues,
    unescapePlaceholders,
    processPhrase
};
```

---

## Main Process Changes: `src/main.js`

### Modify `insert-text` Event Handler

```javascript
// Add at top with other requires
const dynamicInserts = require('./dynamic-inserts.js');

// In the databaseEvents.on("insert-text", ...) handler:

databaseEvents.on("insert-text", async (event, phrase) => {
    let textToInsert = phrase.expanded_text;
    
    // Check for dynamic content
    if (dynamicInserts.hasDynamicContent(textToInsert)) {
        const clipboardContent = clipboard.readText();
        
        // Parse and check for prompts needed
        const placeholders = dynamicInserts.parsePlaceholders(textToInsert);
        const promptable = dynamicInserts.getPromptablePlaceholders(placeholders);
        
        if (promptable.length > 0) {
            // Need user input - send to renderer for modal
            mainWindow.webContents.send('show-dynamic-prompt', {
                phraseId: phrase.id,
                phraseType: phrase.type,
                text: textToInsert,
                placeholders: promptable,
                clipboardContent
            });
            return; // Wait for response via IPC
        }
        
        // No prompts needed - resolve auto placeholders
        textToInsert = dynamicInserts.processPhrase(textToInsert, clipboardContent, {});
    }
    
    // Continue with existing paste logic...
    mainWindow.hide();
    // ... rest of existing code
});

// Add new IPC handler for prompt responses
ipcMain.on('dynamic-prompt-response', (event, data) => {
    const { phraseId, phraseType, text, values, clipboardContent } = data;
    
    // Process with user values
    const processedText = dynamicInserts.processPhrase(text, clipboardContent, values);
    
    // Create phrase object and trigger insert
    const phrase = {
        id: phraseId,
        type: phraseType,
        expanded_text: processedText
    };
    
    // Hide window and paste (reuse existing logic)
    mainWindow.hide();
    if (previousWindow) {
        previousWindow.bringToTop();
    }
    
    // ... existing clipboard/paste logic with phrase.expanded_text = processedText
});

ipcMain.on('dynamic-prompt-cancel', () => {
    // User cancelled - just hide window
    mainWindow.hide();
    if (previousWindow) {
        previousWindow.bringToTop();
    }
});
```

---

## Preload Changes: `src/preload.js`

Add new IPC channels:

```javascript
// In validChannels arrays:
const validSendChannels = [
    // ... existing channels
    "dynamic-prompt-response",
    "dynamic-prompt-cancel"
];

const validReceiveChannels = [
    // ... existing channels  
    "show-dynamic-prompt"
];
```

---

## Renderer Changes: `src/_partial/_renderer-modal.js`

Add the Dynamic Prompt Modal functions:

```javascript
// =============================================================================
// Dynamic Prompt Modal
// =============================================================================

let dynamicModal, dynamicModalClose, dynamicModalTitle, dynamicModalForm, dynamicModalSubmit;
let currentDynamicData = null;

function initDynamicModal() {
    dynamicModal = document.getElementById('dynamicPromptModal');
    dynamicModalClose = dynamicModal.querySelector('.dynamic-close');
    dynamicModalTitle = document.getElementById('dynamic-modal-title');
    dynamicModalForm = document.getElementById('dynamic-form');
    dynamicModalSubmit = document.getElementById('dynamic-submit');
    
    dynamicModalClose.addEventListener('click', closeDynamicModal);
    dynamicModalSubmit.addEventListener('click', submitDynamicForm);
    
    // Handle Enter key to submit, Tab to navigate
    dynamicModalForm.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            submitDynamicForm();
        }
    });
    
    // ESC to cancel
    dynamicModal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDynamicModal();
        }
    });
}

function openDynamicModal(data) {
    currentDynamicData = data;
    dynamicModalTitle.textContent = window.i18n.t('Fill in Details');
    dynamicModalForm.innerHTML = '';
    
    // Build form fields for each promptable placeholder
    data.placeholders.forEach((p, index) => {
        const fieldId = `dynamic-field-${index}`;
        const label = p.label || window.i18n.t(p.type === 'textarea' ? 'Text' : 'Value');
        
        const wrapper = document.createElement('div');
        wrapper.className = 'form-field';
        
        const labelEl = document.createElement('label');
        labelEl.htmlFor = fieldId;
        labelEl.textContent = label;
        wrapper.appendChild(labelEl);
        
        let input;
        
        if (p.type === 'select') {
            input = document.createElement('select');
            input.className = 'input';
            p.options.choices.forEach(choice => {
                const option = document.createElement('option');
                option.value = choice.value;
                option.textContent = choice.value;
                if (choice.default) option.selected = true;
                input.appendChild(option);
            });
        } else if (p.type === 'textarea') {
            input = document.createElement('textarea');
            input.className = 'input';
            input.rows = 3;
            input.value = p.options?.default || '';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'input';
            input.value = p.options?.default || '';
        }
        
        input.id = fieldId;
        input.dataset.label = p.label || p.type;
        wrapper.appendChild(input);
        
        dynamicModalForm.appendChild(wrapper);
    });
    
    showModal(dynamicModal);
    
    // Focus first input
    setTimeout(() => {
        const firstInput = dynamicModalForm.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();
    }, 50);
}

function closeDynamicModal() {
    hideModal(dynamicModal, () => {
        dynamicModalForm.innerHTML = '';
        currentDynamicData = null;
    });
    
    // Notify main process of cancel
    window.electron.send('dynamic-prompt-cancel');
}

function submitDynamicForm() {
    if (!currentDynamicData) return;
    
    // Collect values from form
    const values = {};
    dynamicModalForm.querySelectorAll('input, select, textarea').forEach(el => {
        values[el.dataset.label] = el.value;
    });
    
    // Send response to main process
    window.electron.send('dynamic-prompt-response', {
        phraseId: currentDynamicData.phraseId,
        phraseType: currentDynamicData.phraseType,
        text: currentDynamicData.text,
        values,
        clipboardContent: currentDynamicData.clipboardContent
    });
    
    // Close modal without sending cancel
    hideModal(dynamicModal, () => {
        dynamicModalForm.innerHTML = '';
        currentDynamicData = null;
    });
}

// Add to init function:
function init(elements) {
    // ... existing init code
    
    initDynamicModal();
    
    // Listen for dynamic prompt requests
    window.electron.receive('show-dynamic-prompt', (data) => {
        openDynamicModal(data);
    });
}

// Add to module exports:
window.modals = {
    // ... existing exports
    openDynamicModal,
    closeDynamicModal
};
```

---

## HTML Changes: `templates/index.html`

Add the Dynamic Prompt Modal:

```html
<!-- Dynamic Prompt Modal -->
<div id="dynamicPromptModal" class="modal">
    <div class="modal-content dynamic-modal-content">
        <div class="modal-header">
            <h2 id="dynamic-modal-title" data-i18n="Fill in Details">Fill in Details</h2>
            <button class="btn btn-ghost btn-icon dynamic-close">
                <svg class="icon">
                    <use href="#icon-x"></use>
                </svg>
            </button>
        </div>
        <form id="dynamic-form" class="dynamic-form">
            <!-- Fields generated dynamically -->
        </form>
        <div class="modal-footer">
            <button type="button" id="dynamic-submit" class="btn btn-primary">
                <svg class="icon">
                    <use href="#icon-check"></use>
                </svg>
                <span data-i18n="Insert">Insert</span>
            </button>
        </div>
    </div>
</div>
```

---

## SCSS Changes: `assets/scss/_modal.scss`

Add styles for the dynamic modal:

```scss
// Dynamic Prompt Modal
.dynamic-modal-content {
    max-width: 400px;
}

.dynamic-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 0;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    
    label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-secondary);
    }
    
    .input {
        width: 100%;
    }
    
    select.input {
        cursor: pointer;
    }
}
```

---

## Localization: `locales/en.js`

Add new translation keys:

```javascript
// Dynamic inserts
"Fill in Details": "Fill in Details",
"Insert": "Insert",
"Value": "Value",
"Text": "Text",
```

---

## Implementation Order

### Phase 1: Core Parser (No UI)
- [ ] Create `src/dynamic-inserts.js` with parsing logic
- [ ] Add unit tests for parser
- [ ] Test date/time/clipboard auto-resolution

### Phase 2: Auto-Resolution Only
- [ ] Integrate into `main.js` insert flow
- [ ] Test auto placeholders (date, time, clipboard) work correctly
- [ ] Verify escaped placeholders work

### Phase 3: Prompt Modal
- [ ] Add modal HTML to `index.html`
- [ ] Add modal styles to SCSS
- [ ] Implement modal JS in `_renderer-modal.js`
- [ ] Add IPC channels to preload

### Phase 4: Full Integration
- [ ] Wire up prompted placeholders to modal
- [ ] Handle modal responses in main process
- [ ] Test reusable variables (same label = one prompt)
- [ ] Add translations

### Phase 5: Polish
- [ ] Keyboard navigation testing
- [ ] Tab order verification
- [ ] ESC to cancel
- [ ] Enter to submit
- [ ] Edge cases (empty values, special characters)

---

## Usage Examples

### Date Signatures
```
Phrase: "Date Signature"
Expanded Text: "Signed on {{date:long}} by {{input:Name}}"
Result: "Signed on January 13, 2026 by [user input]"
```

### Email Template
```
Phrase: "Follow-up Email"
Expanded Text: "Dear {{input:Recipient}},

Following up on our {{select:Topic=meeting,call,email}} from {{date:-1:long}}.

Best regards,
{{input:Your Name=John}}"
```

### Code Snippet with Clipboard
```
Phrase: "Console Log"
Expanded Text: "console.log('{{input:Label}}:', {{clipboard}});"
```

### Meeting Notes
```
Phrase: "Meeting Notes"
Expanded Text: "# Meeting Notes - {{date}}

**Attendees:** {{input:Attendees}}
**Topic:** {{input:Topic}}

## Notes
{{textarea:Notes}}

## Action Items
- {{input:Action 1}}
- {{input:Action 2}}"
```

---

## Future Considerations

Not in scope for initial implementation, but possible extensions:

1. **Cursor positioning**: `{{cursor}}` to place cursor after insert
2. **Conditional text**: `{{if:condition}}...{{endif}}`
3. **Transformations**: `{{input:Name|uppercase}}`
4. **Saved defaults**: Remember last-used values per phrase
5. **Nested snippets**: `{{phrase:other-phrase-name}}`
