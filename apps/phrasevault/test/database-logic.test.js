import { describe, it, expect } from 'vitest'
import { filterPhrases } from '../src/phrase-search'

/**
 * Database Logic Unit Tests
 *
 * Tests for pure logic functions extracted from database.ts.
 * These tests verify the algorithms without requiring a database connection.
 */

// =============================================================================
// SEARCH FILTERING LOGIC
// =============================================================================

describe('searchPhrases filtering logic', () => {
  const samplePhrases = [
    { id: 1, phrase: 'email', expanded_text: 'test@example.com' },
    { id: 2, phrase: 'phone', expanded_text: '+1 555-1234' },
    { id: 3, phrase: 'addr', expanded_text: '123 Main Street' },
    { id: 4, phrase: 'sig', expanded_text: 'Best regards,\nJohn' },
    { id: 5, phrase: 'ty', expanded_text: 'Thank you for your message' },
    { id: 6, phrase: 'meeting', expanded_text: 'Let\'s schedule a meeting' },
    { id: 7, phrase: 'Email Template', expanded_text: 'Dear Sir/Madam' },
  ]

  it('returns all phrases when search is empty', () => {
    const result = filterPhrases(samplePhrases, '')
    expect(result).toHaveLength(samplePhrases.length)
  })

  it('returns all phrases when search is whitespace only', () => {
    const result = filterPhrases(samplePhrases, '   ')
    expect(result).toHaveLength(samplePhrases.length)
  })

  it('finds exact phrase match', () => {
    const result = filterPhrases(samplePhrases, 'email')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].phrase).toBe('email')
  })

  it('exact match comes first', () => {
    const result = filterPhrases(samplePhrases, 'email')
    // 'email' should be first, 'Email Template' should follow
    expect(result[0].phrase).toBe('email')
  })

  it('matches partial phrase name', () => {
    const result = filterPhrases(samplePhrases, 'mai')
    // Should match 'email' and 'Email Template'
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('matches expanded_text content', () => {
    const result = filterPhrases(samplePhrases, 'Main Street')
    expect(result.length).toBe(1)
    expect(result[0].phrase).toBe('addr')
  })

  it('is case insensitive', () => {
    const result = filterPhrases(samplePhrases, 'EMAIL')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some((p) => p.phrase === 'email')).toBe(true)
  })

  it('handles multiple search tokens (AND logic)', () => {
    const result = filterPhrases(samplePhrases, 'email test')
    // Should match phrase with both 'email' and 'test' in phrase OR expanded_text
    expect(result.length).toBe(1)
    expect(result[0].phrase).toBe('email')
  })

  it('returns empty array when no match', () => {
    const result = filterPhrases(samplePhrases, 'nonexistent12345')
    expect(result).toHaveLength(0)
  })

  it('handles unicode normalization', () => {
    const phrasesWithUnicode = [
      { id: 1, phrase: 'café', expanded_text: 'Coffee shop' },
      { id: 2, phrase: 'cafe', expanded_text: 'Another coffee' },
    ]
    const result = filterPhrases(phrasesWithUnicode, 'café')
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps exact low-usage sig first and preserves database tie order', () => {
    const rows = [
      { id: 9, phrase: 'signature formal', expanded_text: 'Kind regards, Alex', usageCount: 90 },
      { id: 8, phrase: 'signature brief', expanded_text: 'Regards, Alex', usageCount: 90 },
      { id: 1, phrase: 'sig', expanded_text: 'Best regards, Alex', usageCount: 1 },
    ]
    expect(filterPhrases(rows, 'sig').map((row) => row.id)).toEqual([1, 9, 8])
    expect(filterPhrases(rows, ' sig ').map((row) => row.id)).toEqual([9, 8, 1])
    expect(filterPhrases(rows, ' \t\n').map((row) => row.id)).toEqual([9, 8, 1])
  })

  it('AND-matches across fields with NFC/case parity and no duplicate IDs', () => {
    const row = { id: 1, phrase: 'CAFÉ', expanded_text: 'Hello Alex' }
    const other = { id: 2, phrase: 'café extra', expanded_text: 'Hello Sam' }
    expect(filterPhrases([other, row, row], 'café ALEX')).toEqual([row])
    expect(filterPhrases([other, row, row], 'café')).toEqual([row, other])
    expect(filterPhrases([row], 'café missing')).toEqual([])
    expect(filterPhrases([row, row], '')).toEqual([row])
  })

  it('matches across phrase and expanded_text', () => {
    // Search for term that appears in expanded_text only
    const result = filterPhrases(samplePhrases, 'regards')
    expect(result.length).toBe(1)
    expect(result[0].phrase).toBe('sig')
  })
})

// =============================================================================
// DUPLICATE NAME GENERATION LOGIC
// =============================================================================

/**
 * Recreated duplicate name generation logic from database.ts
 */
function generateUniqueDuplicateName(originalPhrase, existingNames, copyOfText = 'Copy of') {
  const baseName = `${copyOfText} ${originalPhrase}`

  const existingSet = new Set(existingNames)

  // If base name doesn't exist, use it
  if (!existingSet.has(baseName)) {
    return baseName
  }

  // Find the next available number
  let counter = 2
  while (existingSet.has(`${baseName} (${counter})`)) {
    counter++
  }

  return `${baseName} (${counter})`
}

describe('generateUniqueDuplicateName logic', () => {
  it('returns "Copy of X" when no duplicates exist', () => {
    const result = generateUniqueDuplicateName('Original', [])
    expect(result).toBe('Copy of Original')
  })

  it('returns "Copy of X" when other names exist but not the copy', () => {
    const existing = ['Other Phrase', 'Another One']
    const result = generateUniqueDuplicateName('Original', existing)
    expect(result).toBe('Copy of Original')
  })

  it('returns "Copy of X (2)" when "Copy of X" already exists', () => {
    const existing = ['Copy of Original']
    const result = generateUniqueDuplicateName('Original', existing)
    expect(result).toBe('Copy of Original (2)')
  })

  it('returns "Copy of X (3)" when (2) also exists', () => {
    const existing = ['Copy of Original', 'Copy of Original (2)']
    const result = generateUniqueDuplicateName('Original', existing)
    expect(result).toBe('Copy of Original (3)')
  })

  it('handles gaps in numbering', () => {
    // If (2) is missing but (3) exists, should use (2)
    const existing = ['Copy of Original', 'Copy of Original (3)']
    const result = generateUniqueDuplicateName('Original', existing)
    expect(result).toBe('Copy of Original (2)')
  })

  it('handles large number sequences', () => {
    const existing = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? 'Copy of Original' : `Copy of Original (${i + 1})`
    )
    const result = generateUniqueDuplicateName('Original', existing)
    expect(result).toBe('Copy of Original (11)')
  })

  it('handles phrases with special characters', () => {
    const result = generateUniqueDuplicateName('Test (special)', [])
    expect(result).toBe('Copy of Test (special)')
  })

  it('handles empty original phrase', () => {
    const result = generateUniqueDuplicateName('', [])
    expect(result).toBe('Copy of ')
  })
})

// =============================================================================
// DUPLICATE CHECK LOGIC
// =============================================================================

/**
 * Logic for checking if a phrase name already exists
 */
function checkDuplicatePhrase(phrases, newPhrase, excludeId = null) {
  const normalizedNew = newPhrase.trim().toLowerCase()

  return phrases.some((p) => {
    if (excludeId !== null && p.id === excludeId) {
      return false // Skip the phrase being edited
    }
    return p.phrase.trim().toLowerCase() === normalizedNew
  })
}

describe('checkDuplicatePhrase logic', () => {
  const existingPhrases = [
    { id: 1, phrase: 'email' },
    { id: 2, phrase: 'Phone Number' },
    { id: 3, phrase: 'address' },
  ]

  it('returns true for exact duplicate', () => {
    const result = checkDuplicatePhrase(existingPhrases, 'email')
    expect(result).toBe(true)
  })

  it('returns true for case-insensitive duplicate', () => {
    const result = checkDuplicatePhrase(existingPhrases, 'EMAIL')
    expect(result).toBe(true)
  })

  it('returns true for duplicate with different whitespace', () => {
    const result = checkDuplicatePhrase(existingPhrases, '  email  ')
    expect(result).toBe(true)
  })

  it('returns false for unique phrase', () => {
    const result = checkDuplicatePhrase(existingPhrases, 'newphrase')
    expect(result).toBe(false)
  })

  it('returns false when editing same phrase (excludeId)', () => {
    // Editing phrase id=1, keeping the same name should be OK
    const result = checkDuplicatePhrase(existingPhrases, 'email', 1)
    expect(result).toBe(false)
  })

  it('returns true when editing but name matches different phrase', () => {
    // Editing phrase id=1, but trying to rename to 'address' (id=3)
    const result = checkDuplicatePhrase(existingPhrases, 'address', 1)
    expect(result).toBe(true)
  })

  it('handles empty phrases array', () => {
    const result = checkDuplicatePhrase([], 'anything')
    expect(result).toBe(false)
  })

  it('handles multi-word phrases', () => {
    const result = checkDuplicatePhrase(existingPhrases, 'phone number')
    expect(result).toBe(true)
  })
})

// =============================================================================
// VALID PHRASE TYPE CHECKING
// =============================================================================

const VALID_TYPES = ['text', 'markdown', 'mdwysiwyg', 'html']

function isValidPhraseType(type) {
  return VALID_TYPES.includes(type)
}

describe('phrase type validation', () => {
  it('accepts "text" as valid', () => {
    expect(isValidPhraseType('text')).toBe(true)
  })

  it('accepts "markdown" as valid', () => {
    expect(isValidPhraseType('markdown')).toBe(true)
  })

  it('accepts "mdwysiwyg" as valid', () => {
    expect(isValidPhraseType('mdwysiwyg')).toBe(true)
  })

  it('accepts "html" as valid', () => {
    expect(isValidPhraseType('html')).toBe(true)
  })

  it('rejects "plain" as invalid', () => {
    expect(isValidPhraseType('plain')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidPhraseType('')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isValidPhraseType(undefined)).toBe(false)
  })

  it('rejects unknown types', () => {
    expect(isValidPhraseType('richtext')).toBe(false)
    expect(isValidPhraseType('code')).toBe(false)
  })
})

// =============================================================================
// SHORT ID VALIDATION (for cross-inserts)
// =============================================================================

/**
 * Validates short_id format (7 character base36)
 */
function isValidShortId(shortId) {
  if (typeof shortId !== 'string') return false
  return /^[a-z0-9]{7}$/i.test(shortId)
}

describe('short_id validation', () => {
  it('accepts valid 7-char alphanumeric', () => {
    expect(isValidShortId('abc1234')).toBe(true)
    expect(isValidShortId('xyz9876')).toBe(true)
    expect(isValidShortId('0000000')).toBe(true)
    expect(isValidShortId('aaaaaaa')).toBe(true)
  })

  it('accepts uppercase (case insensitive)', () => {
    expect(isValidShortId('ABC1234')).toBe(true)
    expect(isValidShortId('AbC1234')).toBe(true)
  })

  it('rejects too short', () => {
    expect(isValidShortId('abc123')).toBe(false)
    expect(isValidShortId('')).toBe(false)
  })

  it('rejects too long', () => {
    expect(isValidShortId('abc12345')).toBe(false)
  })

  it('rejects invalid characters', () => {
    expect(isValidShortId('abc-123')).toBe(false)
    expect(isValidShortId('abc_123')).toBe(false)
    expect(isValidShortId('abc 123')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidShortId(null)).toBe(false)
    expect(isValidShortId(undefined)).toBe(false)
    expect(isValidShortId(1234567)).toBe(false)
  })
})
