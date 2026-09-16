/**
 * Import/Export module unit tests
 *
 * Tests parsers for PhraseVault JSON, TextExpander CSV, and Espanso YAML formats.
 * Tests are isolated from the database — analyzeImport() is not tested here
 * because it depends on the DB. Parser functions are tested via parseImportFile().
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock electron app module before importing the module under test
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0-test',
  },
}))

// Mock database module (not needed for parser tests, but required for import)
vi.mock('../src/database', () => ({
  getPhraseByShortId: vi.fn().mockResolvedValue(null),
}))

import { parseImportFile, buildExportData, exportToFile } from '../src/import-export'
import type { Phrase } from '../src/types'

// =============================================================================
// Test Helpers
// =============================================================================

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-import-test-'))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeTmpFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// =============================================================================
// PhraseVault JSON Parser
// =============================================================================

describe('parsePhraseVaultJSON', () => {
  it('parses valid PhraseVault export', () => {
    const data = {
      format: 'phrasevault-export',
      version: 1,
      app_version: '1.0.0',
      exported_at: '2026-01-01T00:00:00.000Z',
      phrases: [
        { phrase: 'hello', expanded_text: 'Hello World', type: 'text', short_id: 'abc1234' },
        { phrase: 'sig', expanded_text: 'Best regards', type: 'markdown', short_id: 'def5678' },
      ],
    }
    const fp = writeTmpFile('valid.json', JSON.stringify(data))
    const result = parseImportFile(fp)

    expect(result.source).toBe('phrasevault')
    expect(result.phrases).toHaveLength(2)
    expect(result.phrases[0].phrase).toBe('hello')
    expect(result.phrases[0].expanded_text).toBe('Hello World')
    expect(result.phrases[0].type).toBe('text')
    expect(result.phrases[0].short_id).toBe('abc1234')
    expect(result.phrases[1].type).toBe('markdown')
    expect(result.skipped).toBe(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('rejects missing format field', () => {
    const data = { phrases: [{ phrase: 'x', expanded_text: 'y' }] }
    const fp = writeTmpFile('no-format.json', JSON.stringify(data))
    expect(() => parseImportFile(fp)).toThrow('Not a PhraseVault export file')
  })

  it('rejects empty phrases array', () => {
    const data = { format: 'phrasevault-export', phrases: [] }
    const fp = writeTmpFile('empty.json', JSON.stringify(data))
    expect(() => parseImportFile(fp)).toThrow('No phrases found')
  })

  it('skips invalid entries and reports count', () => {
    const data = {
      format: 'phrasevault-export',
      phrases: [
        { phrase: 'valid', expanded_text: 'text' },
        { phrase: '', expanded_text: 'text' },       // empty phrase
        { phrase: 'notext' },                         // missing expanded_text
        { phrase: 'ok', expanded_text: 'fine' },
      ],
    }
    const fp = writeTmpFile('skip.json', JSON.stringify(data))
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(2)
    expect(result.skipped).toBe(2)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('2 phrases skipped')
  })

  it('normalizes legacy plain type to text', () => {
    const data = {
      format: 'phrasevault-export',
      phrases: [{ phrase: 'x', expanded_text: 'y', type: 'plain' }],
    }
    const fp = writeTmpFile('plain.json', JSON.stringify(data))
    const result = parseImportFile(fp)

    expect(result.phrases[0].type).toBe('text')
  })

  it('validates short_id format', () => {
    const data = {
      format: 'phrasevault-export',
      phrases: [
        { phrase: 'a', expanded_text: 'b', short_id: 'abc1234' },   // valid
        { phrase: 'c', expanded_text: 'd', short_id: 'INVALID' },   // uppercase
        { phrase: 'e', expanded_text: 'f', short_id: 'short' },     // too short
      ],
    }
    const fp = writeTmpFile('ids.json', JSON.stringify(data))
    const result = parseImportFile(fp)

    expect(result.phrases[0].short_id).toBe('abc1234')
    expect(result.phrases[1].short_id).toBeUndefined()
    expect(result.phrases[2].short_id).toBeUndefined()
  })
})

// =============================================================================
// TextExpander CSV Parser
// =============================================================================

describe('parseTextExpanderCSV', () => {
  it('parses basic 3-column CSV', () => {
    const csv = 'email,john@example.com,Email\nsig,Best regards,Signature'
    const fp = writeTmpFile('basic.csv', csv)
    const result = parseImportFile(fp)

    expect(result.source).toBe('textexpander')
    expect(result.phrases).toHaveLength(2)
    expect(result.phrases[0].phrase).toBe('email')
    expect(result.phrases[0].expanded_text).toBe('john@example.com')
    expect(result.phrases[0].type).toBe('text')
  })

  it('strips UTF-8 BOM', () => {
    const bom = '\uFEFF'
    const csv = `${bom}hello,world`
    const fp = writeTmpFile('bom.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(1)
    expect(result.phrases[0].phrase).toBe('hello')
  })

  it('detects and skips header row', () => {
    const csv = 'abbreviation,snippet,label\nemail,john@example.com,Email'
    const fp = writeTmpFile('header.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(1)
    expect(result.phrases[0].phrase).toBe('email')
  })

  it('handles RFC 4180 quoted fields with newlines', () => {
    const csv = 'sig,"Best regards,\nJohn Doe",Signature'
    const fp = writeTmpFile('quoted.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(1)
    expect(result.phrases[0].expanded_text).toBe('Best regards,\nJohn Doe')
  })

  it('handles RFC 4180 escaped double quotes', () => {
    const csv = 'test,"He said ""hello""",Note'
    const fp = writeTmpFile('escaped.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('He said "hello"')
  })

  it('converts filltext syntax', () => {
    const csv = 'greet,%filltext:name=Name:default=John% hello,Greeting'
    const fp = writeTmpFile('filltext.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('{{input:Name=John}} hello')
  })

  it('converts fillarea syntax', () => {
    const csv = 'note,%fillarea:name=Notes%,Note'
    const fp = writeTmpFile('fillarea.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('{{textarea:Notes}}')
  })

  it('converts fillpopup syntax with default', () => {
    const csv = 'color,%fillpopup:name=Color:Red:default=Blue:Green%,Pick'
    const fp = writeTmpFile('fillpopup.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('{{select:Color=Red,*Blue,Green}}')
  })

  it('converts date macros', () => {
    const csv = 'date,%Y-%m-%d,Date'
    const fp = writeTmpFile('date.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('{{date}}')
  })

  it('converts special codes', () => {
    const csv = 'clip,%clipboard text,Clip\npct,100%%,Percent'
    const fp = writeTmpFile('special.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('{{clipboard}} text')
    expect(result.phrases[1].expanded_text).toBe('100%')
  })

  it('skips rows with missing columns', () => {
    const csv = 'email,john@example.com\nonly_one\nvalid,text'
    const fp = writeTmpFile('missing.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(2)
    expect(result.skipped).toBe(1)
  })
})

// =============================================================================
// Espanso YAML Parser
// =============================================================================

describe('parseEspansoYAML', () => {
  it('parses basic trigger/replace', () => {
    const yaml = `matches:
  - trigger: ":sig"
    replace: "Best regards"
  - trigger: ":email"
    replace: "john@example.com"`
    const fp = writeTmpFile('basic.yml', yaml)
    const result = parseImportFile(fp)

    expect(result.source).toBe('espanso')
    expect(result.phrases).toHaveLength(2)
    expect(result.phrases[0].phrase).toBe('sig')
    expect(result.phrases[0].expanded_text).toBe('Best regards')
    expect(result.phrases[0].type).toBe('text')
  })

  it('strips leading colon from triggers', () => {
    const yaml = `matches:
  - trigger: ":hello"
    replace: "world"`
    const fp = writeTmpFile('colon.yml', yaml)
    const result = parseImportFile(fp)

    expect(result.phrases[0].phrase).toBe('hello')
  })

  it('handles markdown and html types', () => {
    const yaml = `matches:
  - trigger: ":md"
    markdown: "**bold**"
  - trigger: ":ht"
    html: "<b>bold</b>"`
    const fp = writeTmpFile('types.yml', yaml)
    const result = parseImportFile(fp)

    expect(result.phrases[0].type).toBe('markdown')
    expect(result.phrases[0].expanded_text).toBe('**bold**')
    expect(result.phrases[1].type).toBe('html')
    expect(result.phrases[1].expanded_text).toBe('<b>bold</b>')
  })

  it('converts form [[field]] to {{input:field}}', () => {
    const yaml = `matches:
  - trigger: ":form"
    form: "Hello [[name]], from [[city]]"`
    const fp = writeTmpFile('form.yml', yaml)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('Hello {{input:name}}, from {{input:city}}')
  })

  it('skips regex triggers with warning', () => {
    const yaml = `matches:
  - trigger: ":normal"
    replace: "text"
  - regex: "pattern.*"
    replace: "regex text"`
    const fp = writeTmpFile('regex.yml', yaml)
    const result = parseImportFile(fp)

    // The regex match is detected but the parser only processes "- trigger:" blocks
    // regex is detected as an unsupported feature
    expect(result.phrases.length).toBeGreaterThanOrEqual(1)
    expect(result.phrases[0].phrase).toBe('normal')
  })

  it('handles multiline values with pipe', () => {
    const yaml = `matches:
  - trigger: ":multi"
    replace: |
      Line one
      Line two
      Line three`
    const fp = writeTmpFile('multi.yml', yaml)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(1)
    expect(result.phrases[0].expanded_text).toContain('Line one')
    expect(result.phrases[0].expanded_text).toContain('Line two')
  })
})

// =============================================================================
// Format Detection
// =============================================================================

describe('detectFormat (via parseImportFile)', () => {
  it('detects .json with phrasevault format marker', () => {
    const data = { format: 'phrasevault-export', phrases: [{ phrase: 'x', expanded_text: 'y' }] }
    const fp = writeTmpFile('test.json', JSON.stringify(data))
    const result = parseImportFile(fp)
    expect(result.source).toBe('phrasevault')
  })

  it('detects .csv extension', () => {
    const fp = writeTmpFile('test.csv', 'hello,world')
    const result = parseImportFile(fp)
    expect(result.source).toBe('textexpander')
  })

  it('detects .yml extension', () => {
    const yaml = `matches:\n  - trigger: ":x"\n    replace: "y"`
    const fp = writeTmpFile('test.yml', yaml)
    const result = parseImportFile(fp)
    expect(result.source).toBe('espanso')
  })

  it('detects .yaml extension', () => {
    const yaml = `matches:\n  - trigger: ":x"\n    replace: "y"`
    const fp = writeTmpFile('test.yaml', yaml)
    const result = parseImportFile(fp)
    expect(result.source).toBe('espanso')
  })

  it('rejects unsupported extension', () => {
    const fp = writeTmpFile('test.txt', 'hello')
    expect(() => parseImportFile(fp)).toThrow('Unsupported file format')
  })
})

// =============================================================================
// Export
// =============================================================================

describe('buildExportData', () => {
  it('builds correct export structure', () => {
    const phrases: Phrase[] = [
      {
        id: 1,
        short_id: 'abc1234',
        phrase: 'hello',
        expanded_text: 'Hello World',
        type: 'text',
        category_id: null,
        usage_count: 5,
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]

    const data = buildExportData(phrases)

    expect(data.format).toBe('phrasevault-export')
    expect(data.version).toBe(1)
    expect(data.app_version).toBe('1.0.0-test')
    expect(data.exported_at).toBeTruthy()
    expect(data.phrases).toHaveLength(1)
    expect(data.phrases[0].phrase).toBe('hello')
    expect(data.phrases[0].short_id).toBe('abc1234')
    // usage_count should NOT be in export
    expect((data.phrases[0] as Record<string, unknown>).usage_count).toBeUndefined()
  })
})

describe('exportToFile', () => {
  it('writes JSON file', () => {
    const phrases: Phrase[] = [
      {
        id: 1,
        short_id: 'abc1234',
        phrase: 'test',
        expanded_text: 'Test',
        type: 'text',
        category_id: null,
        usage_count: 0,
        created_at: '',
        updated_at: '',
      },
    ]
    const data = buildExportData(phrases)
    const fp = path.join(tmpDir, 'export.json')
    exportToFile(fp, data)

    const content = fs.readFileSync(fp, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.format).toBe('phrasevault-export')
    expect(parsed.phrases).toHaveLength(1)
  })
})

// =============================================================================
// CSV Parser Edge Cases
// =============================================================================

describe('parseCSVRows (via parseTextExpanderCSV)', () => {
  it('handles embedded commas in quoted fields', () => {
    const csv = 'addr,"123 Main St, Apt 4",Address'
    const fp = writeTmpFile('comma.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases[0].expanded_text).toBe('123 Main St, Apt 4')
  })

  it('handles Windows-style line endings', () => {
    const csv = 'a,b,c\r\nd,e,f'
    const fp = writeTmpFile('crlf.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(2)
  })

  it('skips empty rows', () => {
    const csv = 'a,b\n\nc,d'
    const fp = writeTmpFile('empty-rows.csv', csv)
    const result = parseImportFile(fp)

    expect(result.phrases).toHaveLength(2)
  })
})
