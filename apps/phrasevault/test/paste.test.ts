/**
 * Clipboard-write failure recovery through the real paste body.
 *
 * Side effects are injected; no native module or main.ts is loaded.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPerformCopy, createPerformPaste } from '../src/paste'

function setup() {
  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
  }
  const deps = {
    getWindow: () => win,
    bringTargetToTop: vi.fn(),
    readText: vi.fn(async () => 'original text'),
    readHtml: vi.fn(async () => '<b>original</b>'),
    writeText: vi.fn(async (_text: string) => {}),
    writeFormats: vi.fn(async (_text: string, _html?: string) => {}),
    markdown: vi.fn((text: string) => '<p>' + text + '</p>'),
    paste: vi.fn(),
    incrementUsage: vi.fn(),
    notifyRecovery: vi.fn(),
    notifyAccessibilityDenied: vi.fn(),
    canSyntheticPaste: vi.fn(() => true),
    logError: vi.fn(),
  }
  const perform = createPerformPaste(deps)
  return { win, deps, perform, copy: createPerformCopy(perform.enqueue, deps) }
}

function liveClipboard(h: ReturnType<typeof setup>) {
  let clip = 'original text'
  let html = '<b>original</b>'
  const pasted: string[] = []
  h.deps.readText.mockImplementation(async () => clip)
  h.deps.readHtml.mockImplementation(async () => html)
  h.deps.writeText.mockImplementation(async (text) => {
    clip = text
  })
  h.deps.writeFormats.mockImplementation(async (text, nextHtml) => {
    clip = text
    html = nextHtml ?? ''
  })
  h.deps.paste.mockImplementation(() => {
    pasted.push(clip)
  })
  return {
    pasted,
    get clip() {
      return clip
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it.each(['text', 'html', 'markdown', 'mdwysiwyg'])('recovers a rejected %s write exactly once', async (type) => {
  const h = setup()
  if (type === 'text') h.deps.writeText.mockRejectedValueOnce(new Error('denied'))
  else h.deps.writeFormats.mockRejectedValueOnce(new Error('denied'))
  const done = h.perform({ id: 7, type }, 'response')
  await vi.runAllTimersAsync()
  await done
  expect(h.win.hide).toHaveBeenCalledOnce()
  expect(h.win.show).toHaveBeenCalledOnce()
  expect(h.win.focus).toHaveBeenCalledOnce()
  expect(h.deps.notifyRecovery).toHaveBeenCalledOnce()
  expect(h.deps.paste).not.toHaveBeenCalled()
  expect(h.deps.incrementUsage).not.toHaveBeenCalled()
  expect(h.deps.bringTargetToTop).toHaveBeenCalledOnce()
})

it('lets the hide settle 100ms before restoring the palette', async () => {
  const h = setup()
  h.deps.writeText.mockRejectedValueOnce(new Error('denied'))
  const done = h.perform({ id: 7, type: 'text' }, 'response')
  await vi.advanceTimersByTimeAsync(99)
  expect(h.win.show).not.toHaveBeenCalled()
  expect(h.deps.notifyRecovery).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await done
  expect(h.win.show).toHaveBeenCalledOnce()
  expect(h.deps.notifyRecovery).toHaveBeenCalledOnce()
})

it.each(['text', 'html', 'markdown', 'mdwysiwyg'])('keeps both 100ms delays and silence for %s', async (type) => {
  const h = setup()
  const done = h.perform({ id: 7, type }, 'response')
  expect(h.deps.paste).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(99)
  expect(h.deps.paste).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(h.deps.paste).toHaveBeenCalledOnce()
  expect(h.deps.incrementUsage).toHaveBeenCalledExactlyOnceWith(7)
  const writesAfterPaste = h.deps.writeFormats.mock.calls.length
  await vi.advanceTimersByTimeAsync(99)
  expect(h.deps.writeFormats).toHaveBeenCalledTimes(writesAfterPaste)
  await vi.advanceTimersByTimeAsync(1)
  await done
  expect(h.deps.writeFormats).toHaveBeenLastCalledWith('original text', '<b>original</b>')
  expect(h.deps.notifyRecovery).not.toHaveBeenCalled()
  expect(h.win.show).not.toHaveBeenCalled()
})

it('recovers a minimized palette without replacing the remembered target', async () => {
  const h = setup()
  h.win.isMinimized = () => true
  h.deps.writeText.mockRejectedValueOnce(new Error('denied'))
  const done = h.perform({ id: 7, type: 'text' }, 'response')
  await vi.runAllTimersAsync()
  await done
  expect(h.win.restore).toHaveBeenCalledOnce()
  expect(h.deps.bringTargetToTop).toHaveBeenCalledOnce()
})

it('does not write a protected body if the session dies during the clipboard snapshot', async () => {
  const h = setup()
  let unlocked = true
  h.deps.readText.mockImplementation(async () => {
    unlocked = false
    return 'original text'
  })
  await h.perform({ id: 7, type: 'text' }, 'sk-live-secret', () => !unlocked)
  await vi.runAllTimersAsync()
  expect(h.deps.writeText).not.toHaveBeenCalled()
  expect(h.deps.paste).not.toHaveBeenCalled()
  expect(h.deps.incrementUsage).not.toHaveBeenCalled()
})

it('restores the clipboard and skips paste if the session dies after the write', async () => {
  const h = setup()
  let unlocked = true
  h.deps.writeText.mockImplementation(async () => {
    unlocked = false
  })
  await h.perform({ id: 7, type: 'text' }, 'sk-live-secret', () => !unlocked)
  await vi.runAllTimersAsync()
  expect(h.deps.writeText).toHaveBeenCalledOnce()
  expect(h.deps.paste).not.toHaveBeenCalled()
  expect(h.deps.writeFormats).toHaveBeenCalledWith('original text', '<b>original</b>')
})

it.each(['text', 'html', 'markdown', 'mdwysiwyg'])('leaves a %s phrase on the clipboard when synthetic paste is denied', async (type) => {
  const h = setup()
  h.deps.canSyntheticPaste = vi.fn(() => false)
  await h.perform({ id: 7, type }, 'snippet')
  await vi.runAllTimersAsync()
  expect(h.win.hide).not.toHaveBeenCalled()
  expect(h.win.show).not.toHaveBeenCalled()
  expect(h.win.focus).not.toHaveBeenCalled()
  expect(h.win.restore).not.toHaveBeenCalled()
  expect(h.deps.bringTargetToTop).not.toHaveBeenCalled()
  expect(h.deps.paste).not.toHaveBeenCalled()
  expect(h.deps.incrementUsage).not.toHaveBeenCalled()
  expect(h.deps.notifyAccessibilityDenied).toHaveBeenCalledOnce()
  expect(h.deps.notifyRecovery).not.toHaveBeenCalled()
  if (type === 'text') {
    expect(h.deps.writeText).toHaveBeenCalledExactlyOnceWith('snippet')
    expect(h.deps.writeFormats).not.toHaveBeenCalled()
  } else if (type === 'html') {
    expect(h.deps.writeFormats).toHaveBeenCalledExactlyOnceWith('snippet', 'snippet')
  } else {
    expect(h.deps.writeFormats).toHaveBeenCalledExactlyOnceWith('snippet', '<p>snippet</p>')
  }
})

it.each(['text', 'html', 'markdown', 'mdwysiwyg'])('still recovers a rejected %s write when synthetic paste is denied', async (type) => {
  const h = setup()
  h.deps.canSyntheticPaste = vi.fn(() => false)
  if (type === 'text') h.deps.writeText.mockRejectedValueOnce(new Error('denied'))
  else h.deps.writeFormats.mockRejectedValueOnce(new Error('denied'))
  await h.perform({ id: 7, type }, 'snippet')
  await vi.runAllTimersAsync()
  expect(h.win.hide).not.toHaveBeenCalled()
  expect(h.deps.bringTargetToTop).not.toHaveBeenCalled()
  expect(h.win.show).toHaveBeenCalledOnce()
  expect(h.deps.notifyRecovery).toHaveBeenCalledOnce()
  expect(h.deps.notifyAccessibilityDenied).not.toHaveBeenCalled()
  expect(h.deps.paste).not.toHaveBeenCalled()
  expect(h.deps.incrementUsage).not.toHaveBeenCalled()
})

it('skips the Accessibility toast if the session dies during snapshot while synthetic paste is denied', async () => {
  const h = setup()
  h.deps.canSyntheticPaste = vi.fn(() => false)
  let unlocked = true
  h.deps.readText.mockImplementation(async () => {
    unlocked = false
    return 'original text'
  })
  await h.perform({ id: 7, type: 'text' }, 'sk-live-secret', () => !unlocked)
  await vi.runAllTimersAsync()
  expect(h.win.hide).not.toHaveBeenCalled()
  expect(h.deps.writeText).not.toHaveBeenCalled()
  expect(h.deps.notifyAccessibilityDenied).not.toHaveBeenCalled()
})

it('restores the clipboard and skips the Accessibility toast if the session dies after a denied write', async () => {
  const h = setup()
  h.deps.canSyntheticPaste = vi.fn(() => false)
  let unlocked = true
  h.deps.writeText.mockImplementation(async () => {
    unlocked = false
  })
  await h.perform({ id: 7, type: 'text' }, 'sk-live-secret', () => !unlocked)
  await vi.runAllTimersAsync()
  expect(h.deps.writeText).toHaveBeenCalledOnce()
  expect(h.deps.paste).not.toHaveBeenCalled()
  expect(h.deps.writeFormats).toHaveBeenCalledWith('original text', '<b>original</b>')
  expect(h.deps.notifyAccessibilityDenied).not.toHaveBeenCalled()
})

it('serializes overlapping inserts so the second does not steal the first clipboard', async () => {
  const h = setup()
  const live = liveClipboard(h)

  const first = h.perform({ id: 1, type: 'text' }, 'A')
  await vi.advanceTimersByTimeAsync(50)
  const second = h.perform({ id: 2, type: 'text' }, 'B')
  await vi.runAllTimersAsync()
  await Promise.all([first, second])
  expect(live.pasted).toEqual(['A', 'B'])
  expect(live.clip).toBe('original text')
  expect(h.deps.incrementUsage.mock.calls.map((call) => call[0])).toEqual([1, 2])
})

it('keeps {{clipboard}} expansion on the user clipboard while another paste is in flight', async () => {
  const h = setup()
  const live = liveClipboard(h)

  const first = h.perform({ id: 1, type: 'text' }, 'A')
  await vi.advanceTimersByTimeAsync(50)
  const second = h.perform.enqueue(() => h.deps.readText()).then((clipForB) =>
    h.perform({ id: 2, type: 'text' }, `B: ${clipForB}`)
  )
  await vi.runAllTimersAsync()
  await Promise.all([first, second])
  expect(live.pasted).toEqual(['A', 'B: original text'])
  expect(live.clip).toBe('original text')
})

it.each([50, 150])('queued copy at %sms does not replace an in-flight paste', async (gap) => {
  const h = setup()
  const live = liveClipboard(h)

  const first = h.perform({ id: 1, type: 'text' }, 'A')
  await vi.advanceTimersByTimeAsync(gap)
  const copied = h.copy('text', 'B')
  await vi.runAllTimersAsync()
  await Promise.all([first, copied])
  expect(live.pasted).toEqual(['A'])
  expect(live.clip).toBe('B')
})

it('skips a queued copy if the session dies while waiting for paste to finish', async () => {
  const h = setup()
  const live = liveClipboard(h)
  let locked = false

  const first = h.perform({ id: 1, type: 'text' }, 'A', () => false)
  await vi.advanceTimersByTimeAsync(50)
  const copied = h.copy('text', 'secret', () => locked)
  locked = true
  await vi.runAllTimersAsync()
  await first
  await expect(copied).rejects.toThrow('locked')
  expect(live.pasted).toEqual(['A'])
  expect(live.clip).toBe('original text')
})
