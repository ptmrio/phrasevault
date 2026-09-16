import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('app:hideToTray rename', () => {
  const preload = read('src/preload.ts')
  const types = read('src/types.ts')
  const main = read('src/main.ts')
  const renderer = read('src/renderer.ts')

  it('declares the app-local channel in preload and types', () => {
    expect(preload).toContain("'app:hideToTray'")
    expect(types).toContain("| 'app:hideToTray'")
  })

  it('no longer declares window:minimize locally', () => {
    // window:minimize now comes from COMMON_CHANNELS with plain-OS-minimize
    // semantics; a local duplicate would resurrect the tray meaning.
    expect(preload).not.toContain("'window:minimize'")
    expect(types).not.toContain("| 'window:minimize'")
  })

  it('main listens on app:hideToTray and not on window:minimize', () => {
    expect(main).toContain("ipcMain.on('app:hideToTray'")
    expect(main).not.toContain("ipcMain.on('window:minimize'")
  })

  it('the Escape path sends app:hideToTray', () => {
    expect(renderer).toContain("window.api.send('app:hideToTray')")
    expect(renderer).not.toContain("window.api.send('window:minimize')")
  })
})
