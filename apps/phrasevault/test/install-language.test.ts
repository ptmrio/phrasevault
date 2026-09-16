import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  INSTALL_LANGUAGE_FALLBACK,
  resolveInstallLanguage,
  shouldDetectInstallLanguage,
} from '../src/services/install-language'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const available = ['en', 'es', 'pt', 'fr', 'de', 'it', 'ja']

describe('shouldDetectInstallLanguage', () => {
  it('detects on a missing or empty language, not on a saved code', () => {
    expect(shouldDetectInstallLanguage('')).toBe(true)
    expect(shouldDetectInstallLanguage(null)).toBe(true)
    expect(shouldDetectInstallLanguage(undefined)).toBe(true)
    expect(shouldDetectInstallLanguage('en')).toBe(false)
    expect(shouldDetectInstallLanguage('de')).toBe(false)
  })
})

describe('resolveInstallLanguage', () => {
  it('picks the first supported base tag from preferred languages', () => {
    expect(resolveInstallLanguage(['de-DE', 'en-US'], available)).toBe('de')
    expect(resolveInstallLanguage(['de-AT'], available)).toBe('de')
    expect(resolveInstallLanguage(['pt-BR'], available)).toBe('pt')
    expect(resolveInstallLanguage(['nl-NL', 'de-DE'], available)).toBe('de')
  })

  it('falls back to English when nothing matches', () => {
    expect(resolveInstallLanguage(['sv-SE', 'nl-NL'], available)).toBe(INSTALL_LANGUAGE_FALLBACK)
    expect(resolveInstallLanguage([], available)).toBe('en')
    expect(resolveInstallLanguage(['', 'en-GB'], available)).toBe('en')
  })
})

describe('first-run wiring', () => {
  it('defaults language to empty so detection can run', () => {
    const config = read('src/services/config.ts')
    expect(config).toMatch(/language:\s*''/)
    expect(config).not.toMatch(/language:\s*'en'/)
  })

  it('resolves from preferred system languages and awaits changeLanguage before the database', () => {
    const main = read('src/main.ts')
    expect(main).toContain('shouldDetectInstallLanguage')
    expect(main).toContain('resolveInstallLanguage')
    expect(main).toContain('getPreferredSystemLanguages')
    expect(main).toContain('await i18n.changeLanguage(languageToUse)')
    const detectAt = main.indexOf('shouldDetectInstallLanguage(languageToUse)')
    const changeAt = main.indexOf('await i18n.changeLanguage(languageToUse)')
    const dbAt = main.indexOf('initDatabase()')
    expect(detectAt).toBeGreaterThan(-1)
    expect(changeAt).toBeGreaterThan(detectAt)
    expect(dbAt).toBeGreaterThan(changeAt)
  })
})
