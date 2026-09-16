import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WindowControlsState } from '../../src/types/window-controls'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const removedHandlers: string[] = []
const fromWebContents = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }),
    removeHandler: vi.fn((channel: string) => {
      removedHandlers.push(channel)
      handlers.delete(channel)
    }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  BrowserWindow: { fromWebContents },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn(), openPath: vi.fn() },
  app: {
    quit: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => ''),
    isPackaged: false,
  },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn(), off: vi.fn(), themeSource: 'system' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
}))

function makeWindow() {
  const listeners = new Map<string, (() => void)[]>()
  const win = {
    sent: [] as { channel: string; payload: WindowControlsState }[],
    webContents: {
      id: 7,
      send: (channel: string, payload: WindowControlsState) => {
        win.sent.push({ channel, payload })
      },
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    isMaximized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isMinimizable: vi.fn(() => true),
    isMaximizable: vi.fn(() => true),
    isFullScreenable: vi.fn(() => true),
    isClosable: vi.fn(() => true),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    setFullScreen: vi.fn(),
    on(event: string, cb: () => void) {
      const list = listeners.get(event) ?? []
      list.push(cb)
      listeners.set(event, list)
      return this
    },
    removeListener: vi.fn(),
    emit(event: string) {
      const list = listeners.get(event) ?? []
      list.forEach((cb) => cb())
    },
  }
  return win
}

type FakeWindow = ReturnType<typeof makeWindow>

function eventFor(win: FakeWindow) {
  return { sender: win.webContents, senderFrame: { parent: null } }
}

const ALL_CHANNELS = [
  'window:close',
  'window:get-state',
  'window:maximize',
  'window:minimize',
  'window:set-fullscreen',
  'window:zoom',
]

const basePlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  handlers.clear()
  removedHandlers.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  setPlatform(basePlatform)
})

describe('registerWindowHandlers', () => {
  it('registers all six invoke channels and removes them plus its listeners on cleanup', async () => {
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)

    const cleanup = registerWindowHandlers({ getWindow: () => win as never })
    expect([...handlers.keys()].sort()).toEqual([...ALL_CHANNELS].sort())

    cleanup()
    expect([...removedHandlers].sort()).toEqual([...ALL_CHANNELS].sort())
    expect(win.removeListener).toHaveBeenCalled()
    expect(win.webContents.removeListener).toHaveBeenCalledWith(
      'did-finish-load',
      expect.any(Function)
    )
  })

  it('close uses win.close(), never destroy and never app.quit', async () => {
    const electron = await import('electron')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    await handlers.get('window:close')!(eventFor(win))
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(win.destroy).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('ignores a command whose sender maps to a different window', async () => {
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    const other = makeWindow()
    fromWebContents.mockReturnValue(other)
    registerWindowHandlers({ getWindow: () => win as never })

    await handlers.get('window:minimize')!(eventFor(other))
    expect(win.minimize).not.toHaveBeenCalled()
    expect(other.minimize).not.toHaveBeenCalled()
  })

  it('ignores a command from a non-main frame', async () => {
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    await handlers.get('window:minimize')!({
      sender: win.webContents,
      senderFrame: { parent: { id: 'iframe' } },
    })
    expect(win.minimize).not.toHaveBeenCalled()
  })

  it('publishes a monotonically increasing revision, and get-state does not advance it', async () => {
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    win.emit('focus')
    win.emit('maximize')
    const revisions = win.sent.map((s) => s.payload.revision)
    expect(win.sent.every((s) => s.channel === 'window:state-changed')).toBe(true)
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b))
    expect(new Set(revisions).size).toBe(revisions.length)

    const snapshot = (await handlers.get('window:get-state')!(eventFor(win))) as WindowControlsState
    // A get-state reply must never look newer than the last published event,
    // so the renderer's `revision >` guard discards a losing race.
    expect(snapshot.revision).toBe(revisions[revisions.length - 1])
  })

  it('reports darwin capabilities and refuses maximize on darwin', async () => {
    setPlatform('darwin')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    const state = (await handlers.get('window:get-state')!(eventFor(win))) as WindowControlsState
    expect(state.platform).toBe('darwin')
    expect(state.canMaximize).toBe(false)
    expect(state.canZoom).toBe(true)
    expect(state.canFullscreen).toBe(true)

    await handlers.get('window:maximize')!(eventFor(win))
    expect(win.maximize).not.toHaveBeenCalled()
  })

  it('refuses zoom and fullscreen on win32 and reports them unavailable', async () => {
    setPlatform('win32')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    const state = (await handlers.get('window:get-state')!(eventFor(win))) as WindowControlsState
    expect(state.canZoom).toBe(false)
    expect(state.canFullscreen).toBe(false)

    await handlers.get('window:zoom')!(eventFor(win))
    expect(win.maximize).not.toHaveBeenCalled()

    await handlers.get('window:set-fullscreen')!(eventFor(win), { fullscreen: true })
    expect(win.setFullScreen).not.toHaveBeenCalled()
  })

  it('validates the set-fullscreen payload and serializes overlapping requests', async () => {
    setPlatform('darwin')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    await handlers.get('window:set-fullscreen')!(eventFor(win), { fullscreen: 'yes' })
    await handlers.get('window:set-fullscreen')!(eventFor(win), null)
    await handlers.get('window:set-fullscreen')!(eventFor(win), undefined)
    expect(win.setFullScreen).not.toHaveBeenCalled()

    await handlers.get('window:set-fullscreen')!(eventFor(win), { fullscreen: true })
    expect(win.setFullScreen).toHaveBeenCalledWith(true)

    const during = (await handlers.get('window:get-state')!(eventFor(win))) as WindowControlsState
    expect(during.transitioning).toBe(true)

    // A second request while the first is in flight is dropped.
    await handlers.get('window:set-fullscreen')!(eventFor(win), { fullscreen: false })
    expect(win.setFullScreen).toHaveBeenCalledTimes(1)

    win.isFullScreen.mockReturnValue(true)
    win.emit('enter-full-screen')
    const after = (await handlers.get('window:get-state')!(eventFor(win))) as WindowControlsState
    expect(after.transitioning).toBe(false)
    expect(after.fullscreen).toBe(true)
    expect(after.canMinimize).toBe(false)
    expect(after.canClose).toBe(true)
    expect(after.canZoom).toBe(false)

    await handlers.get('window:minimize')!(eventFor(win))
    expect(win.minimize).not.toHaveBeenCalled()
  })

  it('refuses close and reports canClose false while a fullscreen transition is in flight', async () => {
    setPlatform('darwin')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    await handlers.get('window:set-fullscreen')!(eventFor(win), { fullscreen: true })
    const during = (await handlers.get('window:get-state')!(eventFor(win))) as WindowControlsState
    expect(during.transitioning).toBe(true)
    expect(during.canClose).toBe(false)
    expect(during.canMinimize).toBe(false)

    await handlers.get('window:close')!(eventFor(win))
    expect(win.close).not.toHaveBeenCalled()
  })

  it('reattaches listeners when getWindow() later returns a replacement window', async () => {
    setPlatform('darwin')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const first = makeWindow()
    const replacement = makeWindow()
    let current = first
    fromWebContents.mockImplementation((contents) =>
      contents === replacement.webContents ? replacement : first
    )
    registerWindowHandlers({ getWindow: () => current as never })

    current = replacement
    fromWebContents.mockReturnValue(replacement)
    await handlers.get('window:set-fullscreen')!(eventFor(replacement), { fullscreen: true })
    expect(replacement.setFullScreen).toHaveBeenCalledWith(true)

    replacement.isFullScreen.mockReturnValue(true)
    replacement.emit('enter-full-screen')
    const after = (await handlers.get('window:get-state')!(
      eventFor(replacement)
    )) as WindowControlsState
    expect(after.transitioning).toBe(false)
    expect(after.fullscreen).toBe(true)
    expect(first.removeListener).toHaveBeenCalled()
  })

  it('clears a stuck transition and rebinds after the watched window is destroyed', async () => {
    setPlatform('darwin')
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const first = makeWindow()
    const replacement = makeWindow()
    let current = first
    fromWebContents.mockReturnValue(first)
    registerWindowHandlers({ getWindow: () => current as never })

    await handlers.get('window:set-fullscreen')!(eventFor(first), { fullscreen: true })
    const during = (await handlers.get('window:get-state')!(eventFor(first))) as WindowControlsState
    expect(during.transitioning).toBe(true)

    first.isDestroyed.mockReturnValue(true)
    current = replacement
    fromWebContents.mockReturnValue(replacement)

    const after = (await handlers.get('window:get-state')!(
      eventFor(replacement)
    )) as WindowControlsState
    expect(after.transitioning).toBe(false)
    expect(after.canClose).toBe(true)

    await handlers.get('window:close')!(eventFor(replacement))
    expect(replacement.close).toHaveBeenCalledTimes(1)
  })

  it('ignores every command on a destroyed window', async () => {
    const { registerWindowHandlers } = await import('../../src/main/ipc-handlers')
    const win = makeWindow()
    win.isDestroyed.mockReturnValue(true)
    fromWebContents.mockReturnValue(win)
    registerWindowHandlers({ getWindow: () => win as never })

    await handlers.get('window:minimize')!(eventFor(win))
    await handlers.get('window:close')!(eventFor(win))
    expect(win.minimize).not.toHaveBeenCalled()
    expect(win.close).not.toHaveBeenCalled()
  })
})
