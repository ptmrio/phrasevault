/**
 * Dynamic Inserts Module
 * Parses and processes placeholder syntax in phrase text
 * 
 * Syntax: {{type:options}}
 * Escape: \{{...}} to insert literally
 */

// Regex to match placeholders (not preceded by backslash)
const PLACEHOLDER_REGEX = /(?<!\\)\{\{([^}]+)\}\}/g;
const ESCAPE_REGEX = /\\\{\{([^}]+)\}\}/g;

// Regex for cross-insert phrase references (7-char base36 short_id)
const PHRASE_REF_REGEX = /(?<!\\)\{\{phrase:([a-z0-9]{7})\}\}/gi;

/**
 * Parse a phrase and extract all placeholders
 * @param {string} text - The phrase text
 * @returns {Array<{raw: string, type: string, label: string, options: any, index: number}>}
 */
function parsePlaceholders(text) {
    const placeholders = [];
    // Reset regex lastIndex for fresh search
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    let match;

    while ((match = regex.exec(text)) !== null) {
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
 * Types that support locale modifier
 */
const LOCALE_SUPPORTED_TYPES = ['date', 'time', 'datetime', 'weekday', 'month', 'year'];

/**
 * Parse placeholder content into structured data
 * @param {string} content - Content inside {{...}}
 * @returns {{type: string, label: string, options: any, locale: string|undefined}}
 */
function parseContent(content) {
    // First, determine the type to check if locale is supported
    const colonIndex = content.indexOf(':');
    const atIndex = content.lastIndexOf('@');
    
    // Extract potential type (before : or @ or end)
    let potentialType;
    if (colonIndex !== -1) {
        potentialType = content.substring(0, colonIndex).toLowerCase();
    } else if (atIndex !== -1) {
        potentialType = content.substring(0, atIndex).toLowerCase();
    } else {
        potentialType = content.toLowerCase();
    }
    
    // Only parse locale for supported types
    let locale = undefined;
    let contentWithoutLocale = content;
    
    if (LOCALE_SUPPORTED_TYPES.includes(potentialType) && atIndex !== -1) {
        locale = content.substring(atIndex + 1);
        contentWithoutLocale = content.substring(0, atIndex);
    }

    const colonIdx = contentWithoutLocale.indexOf(':');

    if (colonIdx === -1) {
        // Simple type like {{date}}, {{date@de}}, {{clipboard}}, {{input}}
        return { type: contentWithoutLocale.toLowerCase(), label: '', options: null, locale };
    }

    const type = contentWithoutLocale.substring(0, colonIdx).toLowerCase();
    const rest = contentWithoutLocale.substring(colonIdx + 1);

    switch (type) {
        case 'date':
        case 'time':
        case 'datetime':
            return { type, label: '', options: rest, locale };

        case 'input':
        case 'textarea':
            return { ...parseInputOptions(type, rest), locale: undefined };

        case 'select':
            return { ...parseSelectOptions(rest), locale: undefined };

        default:
            // Unknown type, treat as input with full content as label
            return { type: 'input', label: content, options: { default: '' }, locale: undefined };
    }
}

/**
 * Parse input/textarea options: "Label" or "Label=Default"
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
 * Parse select options: "Label=Opt1,*Opt2,Opt3" or "Opt1,*Opt2,Opt3"
 * Asterisk marks default selection
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
        const trimmed = opt.trim();
        const isDefault = trimmed.startsWith('*');
        return {
            value: isDefault ? trimmed.substring(1) : trimmed,
            default: isDefault
        };
    });

    return { type: 'select', label, options: { choices } };
}

/**
 * Check if phrase has any dynamic placeholders
 * @param {string} text
 * @returns {boolean}
 */
function hasDynamicContent(text) {
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    return regex.test(text);
}

/**
 * Get placeholders that need user prompts (not auto-resolvable)
 * Deduplicates by label for reusable variables
 * @param {Array} placeholders
 * @returns {Array}
 */
function getPromptablePlaceholders(placeholders) {
    const promptTypes = ['input', 'textarea', 'select'];
    const seen = new Map();

    return placeholders.filter(p => {
        if (!promptTypes.includes(p.type)) return false;

        // Use label as key, or generate unique key for unlabeled
        const key = p.label || `__${p.type}_${seen.size}`;
        if (seen.has(key)) return false;
        seen.set(key, true);
        return true;
    });
}

/**
 * Resolve auto-resolvable placeholders (date, time, clipboard, etc.)
 * @param {string} text - The phrase text
 * @param {string} clipboardContent - Current clipboard content
 * @returns {string} - Text with auto placeholders resolved
 */
function resolveAutoPlaceholders(text, clipboardContent = '') {
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    return text.replace(regex, (match, content) => {
        const parsed = parseContent(content);

        switch (parsed.type) {
            case 'date':
                return formatDate(parsed.options, parsed.locale);
            case 'time':
                return formatTime(parsed.options, parsed.locale);
            case 'datetime':
                return formatDateTime(parsed.options, parsed.locale);
            case 'weekday':
                return new Date().toLocaleDateString(parsed.locale, { weekday: 'long' });
            case 'month':
                return new Date().toLocaleDateString(parsed.locale, { month: 'long' });
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
 * Format date as local YYYY-MM-DD
 * @param {Date} date
 * @returns {string}
 */
function toLocalISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse date/datetime options string with pipe separator
 * Supports: offset, format, or offset|format combinations
 * Examples: "+7", "long", "-7|long", "+3|DD/MM/YYYY"
 * @param {string|null} options
 * @returns {{ offset: number|null, format: string|null }}
 */
function parseDateOptions(options) {
    if (!options) {
        return { offset: null, format: null };
    }

    // Check for pipe separator (offset|format)
    const pipeIndex = options.indexOf('|');
    if (pipeIndex !== -1) {
        const offsetPart = options.substring(0, pipeIndex).trim();
        const formatPart = options.substring(pipeIndex + 1).trim();
        return {
            offset: parseOffset(offsetPart),
            format: formatPart || null
        };
    }

    // No pipe - could be offset OR format
    const offset = parseOffset(options);
    if (offset !== null) {
        return { offset, format: null };
    }

    // It's a format string
    return { offset: null, format: options };
}

/**
 * Parse offset string (+7, -3, 0) to number
 * @param {string} str
 * @returns {number|null}
 */
function parseOffset(str) {
    const match = str.match(/^([+-]?)(\d+)$/);
    if (match) {
        const value = parseInt(match[2]);
        return match[1] === '-' ? -value : value;
    }
    return null;
}

/**
 * Format date with options
 * Supports: offset, format, or offset|format combinations
 * Examples: "+7", "long", "-7|long", "+3|DD/MM/YYYY"
 * @param {string|null} options - Format options
 * @param {string|undefined} locale - Locale code (e.g., 'de', 'en-US')
 * @returns {string}
 */
function formatDate(options, locale) {
    let date = new Date();
    const parsed = parseDateOptions(options);

    // Apply offset if present
    if (parsed.offset !== null) {
        date.setDate(date.getDate() + parsed.offset);
    }

    // No format specified - use default
    if (!parsed.format) {
        if (locale) {
            return date.toLocaleDateString(locale);
        }
        return toLocalISODate(date);
    }

    // Apply format
    return applyDateFormat(date, parsed.format, locale);
}

/**
 * Apply a format string to a date
 * @param {Date} date
 * @param {string} format - 'short', 'long', or custom format
 * @param {string|undefined} locale
 * @returns {string}
 */
function applyDateFormat(date, format, locale) {
    switch (format) {
        case 'short':
            return date.toLocaleDateString(locale);
        case 'long':
            return date.toLocaleDateString(locale, {
                year: 'numeric', month: 'long', day: 'numeric'
            });
        default:
            return formatCustomDate(date, format, locale);
    }
}

/**
 * Custom date formatting with tokens
 * @param {Date} date
 * @param {string} format
 * @param {string|undefined} locale
 */
function formatCustomDate(date, format, locale) {
    const tokens = {
        'YYYY': date.getFullYear(),
        'YY': String(date.getFullYear()).slice(-2),
        'MMMM': date.toLocaleDateString(locale, { month: 'long' }),
        'MMM': date.toLocaleDateString(locale, { month: 'short' }),
        'MM': String(date.getMonth() + 1).padStart(2, '0'),
        'M': date.getMonth() + 1,
        'DD': String(date.getDate()).padStart(2, '0'),
        'D': date.getDate(),
        'dddd': date.toLocaleDateString(locale, { weekday: 'long' }),
        'ddd': date.toLocaleDateString(locale, { weekday: 'short' }),
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
 * @param {string|null} options
 * @param {string|undefined} locale - Locale code (e.g., 'de', 'en-US')
 * @returns {string}
 */
function formatTime(options, locale) {
    const now = new Date();

    if (options === '12h') {
        return now.toLocaleTimeString(locale, {
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    if (options && options.includes(':')) {
        return formatCustomTime(now, options);
    }

    // Default: 24h HH:mm
    return now.toLocaleTimeString(locale, {
        hour: '2-digit', minute: '2-digit', hour12: false
    });
}

/**
 * Custom time formatting with tokens
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
 * Format datetime (date + time)
 * Supports: offset, format, or offset|format combinations
 * Examples: "-1", "short", "-1|short"
 * @param {string|null} options
 * @param {string|undefined} locale - Locale code (e.g., 'de', 'en-US')
 */
function formatDateTime(options, locale) {
    let date = new Date();
    const parsed = parseDateOptions(options);

    // Apply offset if present
    if (parsed.offset !== null) {
        date.setDate(date.getDate() + parsed.offset);
    }

    // Determine format style
    const format = parsed.format || 'default';

    switch (format) {
        case 'short':
            return date.toLocaleString(locale, {
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        case 'long':
            return date.toLocaleString(locale, {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        default:
            // Default: date + time in standard format
            const dateStr = toLocalISODate(date);
            const timeStr = date.toLocaleTimeString(locale, {
                hour: '2-digit', minute: '2-digit', hour12: false
            });
            return `${dateStr} ${timeStr}`;
    }
}

/**
 * Apply user-provided values to prompted placeholders
 * @param {string} text - Text with remaining placeholders
 * @param {Object} values - Map of label -> value
 * @returns {string}
 */
function applyPromptedValues(text, values) {
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    return text.replace(regex, (match, content) => {
        const parsed = parseContent(content);

        if (['input', 'textarea', 'select'].includes(parsed.type)) {
            // Try label first, then fall back to type-based key
            const key = parsed.label || parsed.type;
            if (values.hasOwnProperty(key)) {
                return values[key];
            }
            // Also check with index suffix for unlabeled fields
            for (const [k, v] of Object.entries(values)) {
                if (k.startsWith(`__${parsed.type}_`)) {
                    return v;
                }
            }
        }

        return match;
    });
}

/**
 * Unescape literal placeholders (\{{...}} → {{...}})
 * @param {string} text
 * @returns {string}
 */
function unescapePlaceholders(text) {
    return text.replace(ESCAPE_REGEX, '{{$1}}');
}

/**
 * Full processing pipeline
 * @param {string} text - Original phrase text
 * @param {string} clipboardContent - Clipboard content
 * @param {Object} promptedValues - User-provided values
 * @returns {string} - Fully processed text
 */
function processPhrase(text, clipboardContent, promptedValues = {}) {
    // 1. Resolve auto placeholders (date, time, clipboard)
    let result = resolveAutoPlaceholders(text, clipboardContent);

    // 2. Apply prompted values (input, textarea, select)
    result = applyPromptedValues(result, promptedValues);

    // 3. Unescape literal placeholders
    result = unescapePlaceholders(result);

    return result;
}

// ============================================
// CROSS-INSERT (NESTED PHRASES) FUNCTIONS
// ============================================

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
 * Resolve cross-insert references recursively
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
            continue; // Leave placeholder unresolved
        }

        try {
            const phrase = await getPhraseByShortId(shortId);
            if (!phrase) {
                console.warn(`Phrase not found: ${shortId}`);
                continue; // Leave placeholder unresolved
            }

            const newVisited = new Set(visitedIds);
            newVisited.add(shortId);

            let resolvedContent = phrase.expanded_text;
            
            // Recursively resolve nested cross-inserts
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
    parsePlaceholders,
    hasDynamicContent,
    getPromptablePlaceholders,
    resolveAutoPlaceholders,
    applyPromptedValues,
    unescapePlaceholders,
    processPhrase,
    // Cross-insert functions
    hasCrossInserts,
    extractPhraseRefs,
    resolveCrossInserts,
    // Exported for testing
    parseDateOptions,
    formatDate,
    formatDateTime,
    formatTime
};
