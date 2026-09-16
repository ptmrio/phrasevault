import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('phrases:copyId', () => {
  const preload = read('src/preload.ts')
  const types = read('src/types.ts')
  const main = read('src/main.ts')
  const renderer = read('src/renderer.ts')

  it('declares the channel in preload and types', () => {
    expect(preload).toContain("'phrases:copyId'")
    expect(types).toContain("| 'phrases:copyId'")
  })

  it('main copies the phrase token through the paste queue', () => {
    expect(main).toContain("ipcMain.on('phrases:copyId'")
    expect(main).toContain('await performCopy(')
    expect(main).toContain('{{phrase:${shortId}}}')
  })

  it('the More menu sends phrases:copyId instead of writing the clipboard itself', () => {
    expect(renderer).toContain("window.api.send('phrases:copyId', shortId)")
    expect(renderer).not.toContain('navigator.clipboard')
  })
})
