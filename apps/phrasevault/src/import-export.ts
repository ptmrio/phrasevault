/**
 * PhraseVault Import/Export Module
 * Unified parsers for PhraseVault JSON, TextExpander CSV, Espanso YAML
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getPhraseByShortId } from './database'
import type {
  Phrase,
  PhraseType,
  ImportedPhrase,
  ImportResult,
  ImportAnalysis,
  ImportConflict,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const MAX_FILE_SIZE = 10_000_000  // 10 MB
const MAX_PHRASE_COUNT = 10_000
const VALID_TYPES: PhraseType[] = ['text', 'markdown', 'mdwysiwyg', 'html']

// =============================================================================
// Format Detection
// =============================================================================

type FileFormat = 'phrasevault' | 'csv' | 'yaml' | 'unknown'

function detectFormat(filePath: string): FileFormat {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.json') return 'phrasevault'

  if (ext === '.csv') return 'csv'
  if (ext === '.yml' || ext === '.yaml') return 'yaml'

  return 'unknown'
}

// =============================================================================
// PhraseVault JSON Parser
// =============================================================================

function parsePhraseVaultJSON(content: string): ImportResult {
  const warnings: string[] = []
  let data: Record<string, unknown>

  try {
    data = JSON.parse(content)
  } catch {
    throw new Error('Invalid JSON file')
  }

  if (data.format !== 'phrasevault-export') {
    throw new Error('Not a PhraseVault export file')
  }

  if (!Array.isArray(data.phrases) || data.phrases.length === 0) {
    throw new Error('No phrases found in file')
  }

  if (data.phrases.length > MAX_PHRASE_COUNT) {
    throw new Error(`File contains ${data.phrases.length} phrases (max ${MAX_PHRASE_COUNT})`)
  }

  const phrases: ImportedPhrase[] = []
  let skipped = 0

  for (const raw of data.phrases) {
    // Validate required fields
    if (typeof raw.phrase !== 'string' || !raw.phrase.trim()) {
      skipped++
      continue
    }
    if (typeof raw.expanded_text !== 'string') {
      skipped++
      continue
    }

    // Clamp phrase name length
    const phraseName = raw.phrase.trim().substring(0, 500)
    const expandedText = raw.expanded_text.substring(0, 100_000)

    // Validate type (normalize legacy 'plain' → 'text')
    let type: PhraseType = 'text'
    const rawType = raw.type === 'plain' ? 'text' : raw.type
    if (typeof rawType === 'string' && VALID_TYPES.includes(rawType as PhraseType)) {
      type = rawType as PhraseType
    }

    // Validate short_id
    let shortId: string | undefined
    if (typeof raw.short_id === 'string' && /^[a-z0-9]{7}$/.test(raw.short_id)) {
      shortId = raw.short_id
    }

    phrases.push({
      phrase: phraseName,
      expanded_text: expandedText,
      type,
      short_id: shortId,
    })
  }

  if (skipped > 0) {
    warnings.push(`${skipped} phrases skipped (missing name or text)`)
  }

  return { phrases, warnings, skipped, source: 'phrasevault' }
}

// =============================================================================
// TextExpander CSV Parser
// =============================================================================

/**
 * Parse TextExpander CSV export.
 *
 * Format: 3 columns — abbreviation (phrase), snippet (expanded_text), label (ignored)
 * Also covers: Beeftext CSV, PhraseExpress CSV via Phrase Exporter
 *
 * Edge cases handled:
 * - UTF-8 BOM detection and stripping
 * - RFC 4180 quoted fields (double-quote escaping, multi-line values)
 * - Header row detection and skipping
 * - Fill-in syntax conversion
 * - Date macro conversion
 * - Special codes
 */
function parseTextExpanderCSV(content: string): ImportResult {
  const warnings: string[] = []

  // Strip UTF-8 BOM
  const cleaned = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content

  // Parse CSV with RFC 4180 support
  const rows = parseCSVRows(cleaned)

  if (rows.length === 0) {
    throw new Error('Empty CSV file')
  }

  // Detect and skip header row
  let startIndex = 0
  const firstRow = rows[0]
  if (firstRow.length >= 2) {
    const col0 = firstRow[0].toLowerCase().trim()
    const col1 = firstRow[1].toLowerCase().trim()
    if (
      (col0 === 'abbreviation' || col0 === 'keyword' || col0 === 'trigger') &&
      (col1 === 'snippet' || col1 === 'content' || col1 === 'replacement' || col1 === 'text')
    ) {
      startIndex = 1
    }
  }

  const phrases: ImportedPhrase[] = []
  let skipped = 0

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i]
    if (row.length < 2) {
      skipped++
      continue
    }

    const abbreviation = row[0].trim()
    let snippet = row[1]  // don't trim — preserves intentional whitespace

    if (!abbreviation) {
      skipped++
      continue
    }

    // Convert TextExpander fill-in syntax to PhraseVault placeholders
    snippet = convertTEFillin(snippet)

    // Convert date macros
    snippet = convertTEDateMacros(snippet)

    // Convert special codes
    snippet = snippet.replace(/%clipboard/g, '{{clipboard}}')
    snippet = snippet.replace(/%\|/g, '')   // cursor position — not supported, strip
    snippet = snippet.replace(/%%/g, '%')   // literal percent

    phrases.push({
      phrase: abbreviation.substring(0, 500),
      expanded_text: snippet.substring(0, 100_000),
      type: 'text',
    })
  }

  if (skipped > 0) {
    warnings.push(`${skipped} rows skipped (missing abbreviation or snippet)`)
  }

  return { phrases, warnings, skipped, source: 'textexpander' }
}

/**
 * RFC 4180 CSV parser — handles quoted fields with embedded newlines and commas
 */
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          field += '"'
          i += 2
        } else {
          // End of quoted field
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else {
      if (ch === '"' && field.length === 0) {
        // Start of quoted field
        inQuotes = true
        i++
      } else if (ch === ',') {
        current.push(field)
        field = ''
        i++
      } else if (ch === '\r') {
        // Handle \r\n or bare \r
        current.push(field)
        field = ''
        if (current.some(f => f.trim())) rows.push(current)
        current = []
        i++
        if (i < text.length && text[i] === '\n') i++
      } else if (ch === '\n') {
        current.push(field)
        field = ''
        if (current.some(f => f.trim())) rows.push(current)
        current = []
        i++
      } else {
        field += ch
        i++
      }
    }
  }

  // Handle remaining content
  current.push(field)
  if (current.some(f => f.trim())) rows.push(current)

  return rows
}

/**
 * Convert TextExpander fill-in syntax to PhraseVault placeholders
 *
 * %filltext:name=Name:default=John%     → {{input:Name=John}}
 * %fillarea:name=Notes%                 → {{textarea:Notes}}
 * %fillpopup:name=Color:Red:default=Blue:Green%  → {{select:Color=Red,*Blue,Green}}
 */
function convertTEFillin(text: string): string {
  // %filltext:name=X:default=Y%
  text = text.replace(/%filltext:name=([^:%]+)(?::default=([^%]*))?%/gi, (_m, name, def) => {
    return def ? `{{input:${name}=${def}}}` : `{{input:${name}}}`
  })

  // %fillarea:name=X:default=Y%
  text = text.replace(/%fillarea:name=([^:%]+)(?::default=([^%]*))?%/gi, (_m, name, def) => {
    return def ? `{{textarea:${name}=${def}}}` : `{{textarea:${name}}}`
  })

  // %fillpopup:name=X:A:default=B:C%
  text = text.replace(/%fillpopup:name=([^:%]+):([^%]+)%/gi, (_m, name, rest) => {
    // Parse colon-separated values, marking default
    const parts = (rest as string).split(':')
    const choices: string[] = []
    let defaultNext = false

    for (const part of parts) {
      if (part.startsWith('default=')) {
        choices.push('*' + part.substring(8))
        defaultNext = false
      } else if (part === 'default') {
        defaultNext = true
      } else {
        choices.push(defaultNext ? '*' + part : part)
        defaultNext = false
      }
    }

    return `{{select:${name}=${choices.join(',')}}}`
  })

  return text
}

/**
 * Convert TextExpander date macros to PhraseVault date placeholders
 */
function convertTEDateMacros(text: string): string {
  if (!text.includes('%')) return text

  // Full date/time patterns
  text = text.replace(/%Y[/-]%m[/-]%d/g, '{{date}}')

  // Individual macros (not part of fill-in syntax — already converted)
  text = text.replace(/%Y(?!ear)/g, '{{date:YYYY}}')
  text = text.replace(/%m(?!onth)/g, '{{date:MM}}')
  text = text.replace(/%d(?!efault|ay)/g, '{{date:DD}}')
  text = text.replace(/%H/g, '{{time:HH}}')
  text = text.replace(/%M/g, '{{time:mm}}')

  return text
}

// =============================================================================
// Espanso YAML Parser (lightweight — no js-yaml dependency)
// =============================================================================

/**
 * Parse Espanso match file.
 *
 * Uses line-by-line parsing (no js-yaml dependency).
 * Handles the common flat structure:
 *   matches:
 *     - trigger: ":sig"
 *       replace: "content"
 */
function parseEspansoYAML(content: string): ImportResult {
  const warnings: string[] = []
  const phrases: ImportedPhrase[] = []
  let skipped = 0

  const lines = content.split('\n')
  let inMatches = false
  let currentMatch: {
    trigger?: string
    replace?: string
    markdown?: string
    html?: string
    form?: string
    hasVars?: boolean
    hasRegex?: boolean
  } | null = null
  let currentKey: string | null = null
  let multilineBuffer = ''
  let isMultiline = false

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')  // strip CR

    // Detect matches: section
    if (/^matches:\s*$/.test(line.trim())) {
      inMatches = true
      continue
    }

    if (!inMatches) continue

    // New match block (- trigger: or - {)
    if (/^\s{2,4}-\s/.test(line)) {
      // Flush previous match
      if (currentMatch) {
        flushEspansoMatch(currentMatch, phrases, warnings)
        if (!currentMatch.trigger) skipped++
      }

      currentMatch = {}
      isMultiline = false

      // Inline trigger on same line as dash
      const triggerMatch = line.match(/-\s*trigger:\s*"?:?([^"]*)"?\s*$/)
      if (triggerMatch) {
        currentMatch.trigger = triggerMatch[1].trim()
      }
      continue
    }

    if (!currentMatch) continue

    // Handle multiline continuation
    if (isMultiline) {
      const indent = line.search(/\S/)
      if (indent >= 6 || line.trim() === '') {
        multilineBuffer += (multilineBuffer ? '\n' : '') + line.trimStart()
        continue
      } else {
        // End of multiline
        if (currentKey && currentMatch) {
          ;(currentMatch as Record<string, string>)[currentKey] = multilineBuffer
        }
        isMultiline = false
        multilineBuffer = ''
        currentKey = null
      }
    }

    // Key: value parsing
    const kvMatch = line.match(/^\s+(trigger|replace|markdown|html|form):\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]
      let value = kvMatch[2].trim()

      // Check for multiline indicators
      if (value === '|' || value === '>') {
        isMultiline = true
        currentKey = key
        multilineBuffer = ''
        continue
      }

      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      // Strip leading colon from triggers
      if (key === 'trigger' && value.startsWith(':')) {
        value = value.substring(1)
      }

      ;(currentMatch as Record<string, string>)[key] = value
      continue
    }

    // Detect unsupported features
    if (/^\s+vars:\s*$/.test(line)) {
      if (currentMatch) currentMatch.hasVars = true
    }
    if (/^\s+regex:\s/.test(line)) {
      if (currentMatch) currentMatch.hasRegex = true
    }
  }

  // Flush any pending multiline buffer
  if (isMultiline && currentKey && currentMatch) {
    ;(currentMatch as Record<string, string>)[currentKey] = multilineBuffer
  }

  // Flush last match
  if (currentMatch) {
    flushEspansoMatch(currentMatch, phrases, warnings)
    if (!currentMatch.trigger) skipped++
  }

  if (skipped > 0) {
    warnings.push(`${skipped} matches skipped (missing trigger or content)`)
  }

  return { phrases, warnings, skipped, source: 'espanso' }
}

function flushEspansoMatch(
  match: {
    trigger?: string
    replace?: string
    markdown?: string
    html?: string
    form?: string
    hasVars?: boolean
    hasRegex?: boolean
  },
  phrases: ImportedPhrase[],
  warnings: string[]
): void {
  if (!match.trigger) return

  // Skip regex-based matches
  if (match.hasRegex) {
    warnings.push(`Skipped regex match: "${match.trigger}"`)
    return
  }

  // Warn about vars (still import the base content)
  if (match.hasVars) {
    warnings.push(`"${match.trigger}" has variables that may not convert fully`)
  }

  // Determine content and type
  let expandedText: string
  let type: PhraseType

  if (match.form) {
    // Convert [[field]] to {{input:field}}
    expandedText = match.form.replace(/\[\[(\w+)\]\]/g, '{{input:$1}}')
    type = 'text'
  } else if (match.html) {
    expandedText = match.html
    type = 'html'
  } else if (match.markdown) {
    expandedText = match.markdown
    type = 'markdown'
  } else if (match.replace) {
    expandedText = match.replace
    type = 'text'
  } else {
    warnings.push(`Skipped "${match.trigger}" (no content)`)
    return
  }

  phrases.push({
    phrase: match.trigger.substring(0, 500),
    expanded_text: expandedText.substring(0, 100_000),
    type,
  })
}

// =============================================================================
// Unified Parse Entry Point
// =============================================================================

export function parseImportFile(filePath: string): ImportResult {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(stat.size / 1_000_000).toFixed(1)} MB, max 10 MB)`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const format = detectFormat(filePath)

  switch (format) {
    case 'phrasevault':
      return parsePhraseVaultJSON(content)
    case 'csv':
      return parseTextExpanderCSV(content)
    case 'yaml':
      return parseEspansoYAML(content)
    default:
      throw new Error('Unsupported file format. Use .json, .csv, .yml, or .yaml')
  }
}

// =============================================================================
// Import Analysis (conflict detection by short_id only)
// =============================================================================

export async function analyzeImport(
  filePath: string
): Promise<ImportAnalysis> {
  const result = parseImportFile(filePath)
  const fileName = path.basename(filePath)

  const newPhrases: ImportedPhrase[] = []
  const conflicts: ImportConflict[] = []
  const warnings = [...result.warnings]

  // Detect duplicate short_ids within the imported file
  const seenIds = new Set<string>()
  let intraFileDupes = 0

  for (const imported of result.phrases) {
    if (imported.short_id) {
      // Check for intra-file duplicate short_ids
      if (seenIds.has(imported.short_id)) {
        imported.short_id = undefined  // will get a fresh ID on insert
        intraFileDupes++
      } else {
        seenIds.add(imported.short_id)
      }

      // Check against existing DB phrases
      if (imported.short_id) {
        const existing = await getPhraseByShortId(imported.short_id)
        if (existing) {
          conflicts.push({ imported, existing })
          continue
        }
      }
    }
    newPhrases.push(imported)
  }

  if (intraFileDupes > 0) {
    warnings.push(`${intraFileDupes} duplicate IDs within file (will be assigned new IDs)`)
  }

  return {
    fileName,
    source: result.source,
    total: result.phrases.length,
    newPhrases,
    conflicts,
    warnings,
    skipped: result.skipped,
  }
}

// =============================================================================
// Export
// =============================================================================

interface ExportData {
  format: 'phrasevault-export'
  version: 1
  app_version: string
  exported_at: string
  phrases: Array<{
    phrase: string
    expanded_text: string
    type: PhraseType
    short_id: string
  }>
}

export function buildExportData(phrases: Phrase[]): ExportData {
  return {
    format: 'phrasevault-export',
    version: 1,
    app_version: app.getVersion(),
    exported_at: new Date().toISOString(),
    phrases: phrases.map(p => ({
      phrase: p.phrase,
      expanded_text: p.expanded_text,
      type: p.type,
      short_id: p.short_id,
    })),
  }
}

export function exportToFile(filePath: string, data: ExportData): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
