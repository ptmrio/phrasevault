import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const RAIL = ['preferences', 'database', 'security', 'about'] as const

describe('settings rail order', () => {
  it('lists Preferences, Database, Security, then About', () => {
    const html = read('templates/index.html')
    const tabs = [...html.matchAll(/\sid="settings-tab-([a-z]+)"/g)].map((match) => match[1])
    expect(tabs).toEqual([...RAIL])
    const panels = [...html.matchAll(/id="settings-(preferences|database|security|about)" role="tabpanel"/g)]
      .map((match) => match[1])
    expect(panels).toEqual([...RAIL])
  })

  it('keeps keyboard order identical to the rail', () => {
    const renderer = read('src/renderer.ts')
    expect(renderer).toContain("const SETTINGS_PANES = ['preferences', 'database', 'security', 'about']")
  })
})
