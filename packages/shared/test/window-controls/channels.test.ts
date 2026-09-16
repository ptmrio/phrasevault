import { describe, it, expect, vi } from 'vitest'

const invoke = vi.fn(() => Promise.resolve(undefined))

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    send: vi.fn(),
    sendSync: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    removeListener: vi.fn(),
  },
  contextBridge: { exposeInMainWorld: vi.fn() },
}))

const WINDOW_CHANNELS = [
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:zoom',
  'window:set-fullscreen',
  'window:get-state',
  'window:state-changed',
] as const

describe('COMMON_CHANNELS window group', () => {
  it('contains all seven window channels exactly once', async () => {
    const { COMMON_CHANNELS } = await import('../../src/preload/channel-validator')
    for (const channel of WINDOW_CHANNELS) {
      expect(COMMON_CHANNELS.filter((c) => c === channel)).toEqual([channel])
    }
    expect(COMMON_CHANNELS.filter((c) => c.startsWith('window:'))).toHaveLength(7)
  })

  it('has no duplicate entries at all', async () => {
    const { COMMON_CHANNELS } = await import('../../src/preload/channel-validator')
    expect(new Set(COMMON_CHANNELS).size).toBe(COMMON_CHANNELS.length)
  })

  it('validates window:zoom and rejects window:destroy', async () => {
    const { createPreloadAPI, COMMON_CHANNELS } = await import(
      '../../src/preload/channel-validator'
    )
    const api = createPreloadAPI(COMMON_CHANNELS)

    await expect(api.invoke('window:destroy')).rejects.toThrow()
    await expect(api.invoke('window:zoom')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('window:zoom')
  })

  it('removeListener unsubscribes the same wrapper receive() registered', async () => {
    const electron = await import('electron')
    const { createPreloadAPI, COMMON_CHANNELS } = await import(
      '../../src/preload/channel-validator'
    )
    const api = createPreloadAPI(COMMON_CHANNELS)
    const callback = vi.fn()

    api.receive('window:state-changed', callback)
    const wrapper = vi.mocked(electron.ipcRenderer.on).mock.calls[0][1]
    expect(typeof wrapper).toBe('function')

    api.removeListener('window:state-changed', callback)
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      'window:state-changed',
      wrapper
    )
  })
})
