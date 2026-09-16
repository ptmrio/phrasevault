/**
 * Dynamic Inserts Module
 * Parses and processes placeholder syntax in phrase text
 *
 * Syntax: {{type:options}}
 * Escape: \{{...}} to insert literally
 */


// Regex to match placeholders (not preceded by backslash)
const PLACEHOLDER_REGEX = /(?<!\\)\{\{([^}]+)\}\}/g
const ESCAPE_REGEX = /\\\{\{([^}]+)\}\}/g

// Regex for cross-insert phrase references (7-char base36 short_id)
const PHRASE_REF_REGEX = /(?<!\\)\{\{phrase:([a-z0-9]{7})\}\}/gi

interface ParsedPlaceholder {
  raw: string
  type: string
  label: string
  options: PlaceholderOptions | null
  locale?: string
  index: number
}

interface PlaceholderOptions {
  default?: string
  choices?: Array<{ value: string; default: boolean }>
}

interface DateParseResult {
  offset: number | null
  format: string | null
}

type DateTimeTokens = Record<string, string | number>

/**
 * Parse a phrase and extract all placeholders
 */
export function parsePlaceholders(text: string): ParsedPlaceholder[] {
  const placeholders: ParsedPlaceholder[] = []
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g')
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0]
    const content = match[1]
    const parsed = parseContent(content)

    placeholders.push({
      raw,
      index: match.index,
      ...parsed,
    })
  }

  return placeholders
}

/**
 * Types that support locale modifier
 */
const LOCALE_SUPPORTED_TYPES = ['date', 'time', 'datetime', 'weekday', 'month', 'year']

/**
 * Parse placeholder content into structured data
 */
function parseContent(content: string): Omit<ParsedPlaceholder, 'raw' | 'index'> {
  // First, determine the type to check if locale is supported
  const colonIndex = content.indexOf(':')
  const atIndex = content.lastIndexOf('@')

  // Extract potential type (before : or @ or end)
  let potentialType: string
  if (colonIndex !== -1) {
    potentialType = content.substring(0, colonIndex).toLowerCase()
  } else if (atIndex !== -1) {
    potentialType = content.substring(0, atIndex).toLowerCase()
  } else {
    potentialType = content.toLowerCase()
  }

  // Only parse locale for supported types
  let locale: string | undefined = undefined
  let contentWithoutLocale = content

  if (LOCALE_SUPPORTED_TYPES.includes(potentialType) && atIndex !== -1) {
    locale = content.substring(atIndex + 1)
    contentWithoutLocale = content.substring(0, atIndex)
  }

  const colonIdx = contentWithoutLocale.indexOf(':')

  if (colonIdx === -1) {
    // Simple type like {{date}}, {{date@de}}, {{clipboard}}, {{input}}
    return { type: contentWithoutLocale.toLowerCase(), label: '', options: null, locale }
  }

  const type = contentWithoutLocale.substring(0, colonIdx).toLowerCase()
  const rest = contentWithoutLocale.substring(colonIdx + 1)

  switch (type) {
    case 'date':
    case 'time':
    case 'datetime':
      return { type, label: '', options: { default: rest }, locale }

    case 'input':
    case 'textarea':
      return { ...parseInputOptions(type, rest), locale: undefined }

    case 'select':
      return { ...parseSelectOptions(rest), locale: undefined }

    default:
      // Unknown type, treat as input with full content as label
      return { type: 'input', label: content, options: { default: '' }, locale: undefined }
  }
}

/**
 * Parse input/textarea options: "Label" or "Label=Default"
 */
function parseInputOptions(
  type: string,
  rest: string
): { type: string; label: string; options: PlaceholderOptions } {
  const eqIndex = rest.indexOf('=')
  if (eqIndex === -1) {
    return { type, label: rest, options: { default: '' } }
  }
  return {
    type,
    label: rest.substring(0, eqIndex),
    options: { default: rest.substring(eqIndex + 1) },
  }
}

/**
 * Parse select options: "Label=Opt1,*Opt2,Opt3" or "Opt1,*Opt2,Opt3"
 * Asterisk marks default selection
 */
function parseSelectOptions(rest: string): { type: string; label: string; options: PlaceholderOptions } {
  const eqIndex = rest.indexOf('=')
  let label = ''
  let optionsStr = rest

  if (eqIndex !== -1) {
    label = rest.substring(0, eqIndex)
    optionsStr = rest.substring(eqIndex + 1)
  }

  const choices = optionsStr.split(',').map((opt) => {
    const trimmed = opt.trim()
    const isDefault = trimmed.startsWith('*')
    return {
      value: isDefault ? trimmed.substring(1) : trimmed,
      default: isDefault,
    }
  })

  return { type: 'select', label, options: { choices } }
}

/**
 * Check if phrase has any dynamic placeholders
 */
export function hasDynamicContent(text: string): boolean {
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g')
  return regex.test(text)
}

/**
 * Get placeholders that need user prompts (not auto-resolvable)
 * Deduplicates by label for reusable variables
 */
export function getPromptablePlaceholders(placeholders: ParsedPlaceholder[]): ParsedPlaceholder[] {
  const promptTypes = ['input', 'textarea', 'select']
  const seen = new Map<string, boolean>()

  return placeholders.filter((p) => {
    if (!promptTypes.includes(p.type)) return false

    // Use label as key, or generate unique key for unlabeled
    const key = p.label || `__${p.type}_${seen.size}`
    if (seen.has(key)) return false
    seen.set(key, true)
    return true
  })
}

/**
 * Drop token contents that would leak a protected body through prompt UI
 * (`{{input:API key=sk-…}}`, defaults, and select option values). Labels stay
 * so the form can still be filled; select choices become 0-based indexes and
 * are mapped back in main before `processPhrase`.
 */
export function redactProtectedPromptPlaceholders(placeholders: ParsedPlaceholder[]): ParsedPlaceholder[] {
  return placeholders.map((placeholder) => ({
    ...placeholder,
    raw: `{{${placeholder.type}}}`,
    options: placeholder.options
      ? {
          choices: placeholder.options.choices?.map((_choice, index) => ({
            value: String(index),
            default: false,
          })),
        }
      : null,
  }))
}

/**
 * Restore real select option text from the indexes the renderer was shown.
 * Unknown or non-index submissions are left alone so a compromised renderer
 * cannot pick a value that was never in the token.
 */
export function remapProtectedSelectValues(
  text: string,
  values: Record<string, string>
): Record<string, string> {
  const next = { ...values }
  for (const placeholder of getPromptablePlaceholders(parsePlaceholders(text))) {
    if (placeholder.type !== 'select' || !placeholder.options?.choices?.length) continue
    const key = placeholder.label || placeholder.type
    const submitted = next[key]
    if (submitted === undefined) continue
    const index = Number(submitted)
    if (!Number.isInteger(index) || index < 0 || index >= placeholder.options.choices.length) {
      delete next[key]
      continue
    }
    next[key] = placeholder.options.choices[index].value
  }
  return next
}

/**
 * Resolve auto-resolvable placeholders (date, time, clipboard, etc.)
 * @param text - The text containing placeholders
 * @param clipboardContent - Current clipboard content for {{clipboard}}
 * @param defaultLocale - App language to use when no @locale is specified in placeholder
 */
export function resolveAutoPlaceholders(text: string, clipboardContent = '', defaultLocale?: string): string {
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g')
  return text.replace(regex, (match, content) => {
    const parsed = parseContent(content)
    const options = parsed.options?.default || null
    // Use explicit @locale from placeholder, or fall back to app language
    const locale = parsed.locale || defaultLocale

    switch (parsed.type) {
      case 'date':
        return formatDate(options, locale)
      case 'time':
        return formatTime(options, locale)
      case 'datetime':
        return formatDateTime(options, locale)
      case 'weekday':
        return new Date().toLocaleDateString(locale, { weekday: 'long' })
      case 'month':
        return new Date().toLocaleDateString(locale, { month: 'long' })
      case 'year':
        return new Date().getFullYear().toString()
      case 'clipboard':
        return clipboardContent
      default:
        return match // Leave for prompted resolution
    }
  })
}

/**
 * Format date as local YYYY-MM-DD
 */
function toLocalISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Parse date/datetime options string with pipe separator
 * Supports: offset, format, or offset|format combinations
 * Examples: "+7", "long", "-7|long", "+3|DD/MM/YYYY"
 */
export function parseDateOptions(options: string | null): DateParseResult {
  if (!options) {
    return { offset: null, format: null }
  }

  // Check for pipe separator (offset|format)
  const pipeIndex = options.indexOf('|')
  if (pipeIndex !== -1) {
    const offsetPart = options.substring(0, pipeIndex).trim()
    const formatPart = options.substring(pipeIndex + 1).trim()
    return {
      offset: parseOffset(offsetPart),
      format: formatPart || null,
    }
  }

  // No pipe - could be offset OR format
  const offset = parseOffset(options)
  if (offset !== null) {
    return { offset, format: null }
  }

  // It's a format string
  return { offset: null, format: options }
}

/**
 * Parse offset string (+7, -3, 0) to number
 */
function parseOffset(str: string): number | null {
  const match = str.match(/^([+-]?)(\d+)$/)
  if (match) {
    const value = parseInt(match[2], 10)
    return match[1] === '-' ? -value : value
  }
  return null
}

/**
 * Format date with options
 * Supports: offset, format, or offset|format combinations
 * Examples: "+7", "long", "-7|long", "+3|DD/MM/YYYY"
 */
export function formatDate(options: string | null, locale?: string): string {
  const date = new Date()
  const parsed = parseDateOptions(options)

  // Apply offset if present
  if (parsed.offset !== null) {
    date.setDate(date.getDate() + parsed.offset)
  }

  // No format specified - use default
  if (!parsed.format) {
    if (locale) {
      return date.toLocaleDateString(locale)
    }
    return toLocalISODate(date)
  }

  // Apply format
  return applyDateFormat(date, parsed.format, locale)
}

/**
 * Apply a format string to a date
 */
function applyDateFormat(date: Date, format: string, locale?: string): string {
  switch (format) {
    case 'short':
      return date.toLocaleDateString(locale)
    case 'long':
      return date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    default:
      return formatCustomDate(date, format, locale)
  }
}

/**
 * Custom date formatting with tokens
 */
function formatCustomDate(date: Date, format: string, locale?: string): string {
  const tokens: DateTimeTokens = {
    YYYY: date.getFullYear(),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: date.toLocaleDateString(locale, { month: 'long' }),
    MMM: date.toLocaleDateString(locale, { month: 'short' }),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    M: date.getMonth() + 1,
    DD: String(date.getDate()).padStart(2, '0'),
    D: date.getDate(),
    dddd: date.toLocaleDateString(locale, { weekday: 'long' }),
    ddd: date.toLocaleDateString(locale, { weekday: 'short' }),
  }

  let result = format
  // Sort by length descending to replace longer tokens first
  Object.keys(tokens)
    .sort((a, b) => b.length - a.length)
    .forEach((token) => {
      result = result.replace(new RegExp(token, 'g'), String(tokens[token]))
    })

  return result
}

/**
 * Format time with options
 */
export function formatTime(options: string | null, locale?: string): string {
  const now = new Date()

  if (options === '12h') {
    return now.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  if (options && options.includes(':')) {
    return formatCustomTime(now, options)
  }

  // Default: 24h HH:mm
  return now.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Custom time formatting with tokens
 */
function formatCustomTime(date: Date, format: string): string {
  const tokens: DateTimeTokens = {
    HH: String(date.getHours()).padStart(2, '0'),
    H: date.getHours(),
    hh: String(date.getHours() % 12 || 12).padStart(2, '0'),
    h: date.getHours() % 12 || 12,
    mm: String(date.getMinutes()).padStart(2, '0'),
    m: date.getMinutes(),
    ss: String(date.getSeconds()).padStart(2, '0'),
    s: date.getSeconds(),
    A: date.getHours() >= 12 ? 'PM' : 'AM',
    a: date.getHours() >= 12 ? 'pm' : 'am',
  }

  let result = format
  Object.keys(tokens)
    .sort((a, b) => b.length - a.length)
    .forEach((token) => {
      result = result.replace(new RegExp(token, 'g'), String(tokens[token]))
    })

  return result
}

/**
 * Format datetime (date + time)
 * Supports: offset, format, or offset|format combinations
 * Examples: "-1", "short", "-1|short"
 */
export function formatDateTime(options: string | null, locale?: string): string {
  const date = new Date()
  const parsed = parseDateOptions(options)

  // Apply offset if present
  if (parsed.offset !== null) {
    date.setDate(date.getDate() + parsed.offset)
  }

  // Determine format style
  const format = parsed.format || 'default'

  switch (format) {
    case 'short':
      return date.toLocaleString(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    case 'long':
      return date.toLocaleString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    default: {
      // Default: date + time in standard format
      const dateStr = toLocalISODate(date)
      const timeStr = date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      return `${dateStr} ${timeStr}`
    }
  }
}

/**
 * Apply user-provided values to prompted placeholders
 */
export function applyPromptedValues(text: string, values: Record<string, string>): string {
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g')
  return text.replace(regex, (match, content) => {
    const parsed = parseContent(content)

    if (['input', 'textarea', 'select'].includes(parsed.type)) {
      // Try label first, then fall back to type-based key
      const key = parsed.label || parsed.type
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key]
      }
      // Also check with index suffix for unlabeled fields
      for (const [k, v] of Object.entries(values)) {
        if (k.startsWith(`__${parsed.type}_`)) {
          return v
        }
      }
    }

    return match
  })
}

/**
 * Unescape literal placeholders (\{{...}} → {{...}})
 */
export function unescapePlaceholders(text: string): string {
  return text.replace(ESCAPE_REGEX, '{{$1}}')
}

/**
 * Full processing pipeline
 * @param text - The phrase text with placeholders
 * @param clipboardContent - Current clipboard content for {{clipboard}}
 * @param promptedValues - User-provided values for input/textarea/select placeholders
 * @param defaultLocale - App language to use for date/time formatting when no @locale specified
 */
export function processPhrase(
  text: string,
  clipboardContent: string,
  promptedValues: Record<string, string> = {},
  defaultLocale?: string
): string {
  // 1. Resolve auto placeholders (date, time, clipboard)
  let result = resolveAutoPlaceholders(text, clipboardContent, defaultLocale)

  // 2. Apply prompted values (input, textarea, select)
  result = applyPromptedValues(result, promptedValues)

  // 3. Unescape literal placeholders
  result = unescapePlaceholders(result)

  return result
}

// ============================================
// CROSS-INSERT (NESTED PHRASES) FUNCTIONS
// ============================================

/**
 * Check if text contains cross-insert references
 */
export function hasCrossInserts(text: string): boolean {
  const regex = new RegExp(PHRASE_REF_REGEX.source, 'gi')
  return regex.test(text)
}

/**
 * Extract all phrase short_ids referenced in text
 */
export function extractPhraseRefs(text: string): string[] {
  const regex = new RegExp(PHRASE_REF_REGEX.source, 'gi')
  const ids: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    ids.push(match[1].toLowerCase())
  }
  return ids
}

/**
 * A cross-insert target as main reads it, including the columns that decide
 * whether the body has to be decrypted before it can be spliced in.
 */
export interface CrossInsertTarget {
  id: number
  short_id: string
  expanded_text: string
  locked: 0 | 1
  expanded_cipher: string | null
}

/**
 * Resolve cross-insert references recursively.
 *
 * `reveal` defaults to the stored plaintext, so existing callers are unchanged;
 * main passes lock.ts's revealRow. A reveal failure is deliberately *not*
 * caught: a `{{phrase:x}}` whose target cannot be opened aborts the whole
 * insert or copy rather than silently leaving a hole, so no partially resolved
 * text can reach the clipboard. Missing, circular and lookup-error targets keep
 * their existing behaviour of leaving the placeholder in place.
 */
export async function resolveCrossInserts(
  text: string,
  getPhraseByShortId: (shortId: string) => Promise<CrossInsertTarget | null>,
  visitedIds: Set<string> = new Set(),
  maxDepth = 10,
  reveal: (target: CrossInsertTarget) => string = (target) => target.expanded_text,
  onProtected?: () => void
): Promise<string> {
  if (maxDepth <= 0) {
    console.warn('Cross-insert max depth reached')
    return text
  }

  const regex = new RegExp(PHRASE_REF_REGEX.source, 'gi')
  let result = text

  // Collect all matches first
  const matches: Array<{ full: string; shortId: string }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      full: match[0],
      shortId: match[1].toLowerCase(),
    })
  }

  // Resolve each reference
  for (const { full, shortId } of matches) {
    // Cycle detection
    if (visitedIds.has(shortId)) {
      console.warn(`Circular reference detected: ${shortId}`)
      continue // Leave placeholder unresolved
    }

    let phrase: CrossInsertTarget | null
    try {
      phrase = await getPhraseByShortId(shortId)
    } catch (error) {
      console.error(`Error resolving phrase ${shortId}:`, error)
      continue // Leave placeholder unresolved
    }
    if (!phrase) {
      console.warn(`Phrase not found: ${shortId}`)
      continue // Leave placeholder unresolved
    }

    const newVisited = new Set(visitedIds)
    newVisited.add(shortId)

    if (phrase.locked === 1) onProtected?.()

    // Outside the catch above on purpose: a locked or corrupt target must abort.
    let resolvedContent = reveal(phrase)

    // Recursively resolve nested cross-inserts
    if (hasCrossInserts(resolvedContent)) {
      resolvedContent = await resolveCrossInserts(
        resolvedContent,
        getPhraseByShortId,
        newVisited,
        maxDepth - 1,
        reveal,
        onProtected
      )
    }

    // Replacement function, not a string: $& / $` / $' in a resolved body are
    // literal text and cannot splice the surrounding phrase into the result.
    result = result.replace(full, () => resolvedContent)
  }

  return result
}
