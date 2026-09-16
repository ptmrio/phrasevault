import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyPlatformAttribute } from '../../src/preload/platform'

type DocStub = {
  documentElement: { dataset: Record<string, string> } | null
  addEventListener: ReturnType<typeof vi.fn>
}

let doc: DocStub

beforeEach(() => {
  doc = {
    documentElement: { dataset: {} },
    addEventListener: vi.fn(),
  }
  vi.stubGlobal('document', doc)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyPlatformAttribute', () => {
  it('writes the platform on documentElement synchronously', () => {
    applyPlatformAttribute('win32')
    expect(doc.documentElement?.dataset.platform).toBe('win32')
    expect(doc.addEventListener).not.toHaveBeenCalled()
  })

  it('writes darwin without waiting for an event', () => {
    applyPlatformAttribute('darwin')
    expect(doc.documentElement?.dataset.platform).toBe('darwin')
  })

  it('falls back to DOMContentLoaded when documentElement is absent', () => {
    doc.documentElement = null
    applyPlatformAttribute('win32')
    expect(doc.addEventListener).toHaveBeenCalledWith(
      'DOMContentLoaded',
      expect.any(Function),
      { once: true }
    )

    doc.documentElement = { dataset: {} }
    const listener = doc.addEventListener.mock.calls[0][1] as () => void
    listener()
    expect(doc.documentElement.dataset.platform).toBe('win32')
  })

  it('defaults to the current process platform', () => {
    applyPlatformAttribute()
    expect(doc.documentElement?.dataset.platform).toBe(process.platform)
  })
})
