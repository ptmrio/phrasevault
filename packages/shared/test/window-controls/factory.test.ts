import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const constructedOptions: Record<string, unknown>[] = []
const calls: string[] = []

class FakeWindow {
  webContents = { on: vi.fn(), send: vi.fn(), id: 1 }
  private handlers = new Map<string, (() => void)[]>()
  constructor(options: Record<string, unknown>) {
    constructedOptions.push(options)
    // Electron shows a window during construction when `show: true`.
    if (options.show === true) calls.push('show')
  }
  on(event: string, cb: () => void): this {
    calls.push(`on:${event}`)
    const list = this.handlers.get(event) ?? []
    list.push(cb)
    this.handlers.set(event, list)
    return this
  }
  once(event: string, cb: () => void): this {
    return this.on(event, cb)
  }
  emit(event: string): void {
    ;(this.handlers.get(event) ?? []).forEach((cb) => cb())
  }
  show = vi.fn(() => calls.push('show'))
  hide = vi.fn()
  loadFile = vi.fn()
  loadURL = vi.fn()
  isDestroyed = vi.fn(() => false)
  setWindowButtonVisibility = vi.fn((visible: boolean) =>
    calls.push(`setWindowButtonVisibility:${visible}`)
  )
}

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), off: vi.fn(), themeSource: 'system' },
}))

const basePlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  constructedOptions.length = 0
  calls.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  setPlatform(basePlatform)
})

describe('createMainWindow native chrome ban', () => {
  it('resolves no native caption options on win32', async () => {
    setPlatform('win32')
    const { createMainWindow } = await import('../../src/main/window')
    createMainWindow({ preloadPath: 'preload.cjs', htmlPath: 'index.html' })

    const options = constructedOptions[0]
    expect(options.frame).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'titleBarStyle')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'titleBarOverlay')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'trafficLightPosition')).toBe(false)
  })

  it('resolves no native caption options on darwin', async () => {
    setPlatform('darwin')
    const { createMainWindow } = await import('../../src/main/window')
    createMainWindow({ preloadPath: 'preload.cjs', htmlPath: 'index.html' })

    const options = constructedOptions[0]
    expect(options.frame).toBe(false)
    expect(options.show).toBe(false)
    expect(options.zoomToPageWidth).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(options, 'titleBarStyle')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'trafficLightPosition')).toBe(false)
  })

  it('browserWindowOptions cannot restore native chrome, and warns', async () => {
    setPlatform('win32')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createMainWindow } = await import('../../src/main/window')

    createMainWindow({
      preloadPath: 'preload.cjs',
      htmlPath: 'index.html',
      // The cast is the point: types alone are bypassable, the runtime delete is not.
      browserWindowOptions: {
        frame: true,
        titleBarStyle: 'hiddenInset',
        titleBarOverlay: { height: 32 },
        trafficLightPosition: { x: 0, y: 0 },
      } as never,
    })

    const options = constructedOptions[0]
    expect(options.frame).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'titleBarStyle')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'titleBarOverlay')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(options, 'trafficLightPosition')).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('browserWindowOptions'),
      expect.arrayContaining(['frame', 'titleBarStyle', 'titleBarOverlay', 'trafficLightPosition'])
    )
    warn.mockRestore()
  })

  it('hides the macOS native buttons before show and re-asserts on transitions', async () => {
    setPlatform('darwin')
    const { createMainWindow } = await import('../../src/main/window')
    const win = createMainWindow({
      preloadPath: 'preload.cjs',
      htmlPath: 'index.html',
      showImmediately: true,
    }) as unknown as FakeWindow

    expect(constructedOptions[0].show).toBe(false)
    expect(calls[0]).toBe('setWindowButtonVisibility:false')
    expect(calls.indexOf('setWindowButtonVisibility:false')).toBeLessThan(calls.indexOf('show'))
    expect(calls).toContain('on:show')
    expect(calls).toContain('on:enter-full-screen')
    expect(calls).toContain('on:leave-full-screen')

    for (const event of ['show', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.setWindowButtonVisibility.mockClear()
      win.emit(event)
      expect(win.setWindowButtonVisibility).toHaveBeenCalledWith(false)
    }
  })

  it('does not touch native buttons on win32', async () => {
    setPlatform('win32')
    const { createMainWindow } = await import('../../src/main/window')
    const win = createMainWindow({
      preloadPath: 'preload.cjs',
      htmlPath: 'index.html',
    }) as unknown as FakeWindow
    expect(win.setWindowButtonVisibility).not.toHaveBeenCalled()
  })

  it('darwin pass-through options cannot restore constructor show or disable page-width zoom', async () => {
    setPlatform('darwin')
    const { createMainWindow } = await import('../../src/main/window')
    createMainWindow({
      preloadPath: 'preload.cjs',
      htmlPath: 'index.html',
      showImmediately: false,
      browserWindowOptions: {
        show: true,
        zoomToPageWidth: false,
      } as never,
    })

    const options = constructedOptions[0]
    expect(options.show).toBe(false)
    expect(options.zoomToPageWidth).toBe(true)
    expect(calls[0]).toBe('setWindowButtonVisibility:false')
    expect(calls).not.toContain('show')
  })
})
