/**
 * The prompt handle: one slot, matched on every field, cleared on every exit.
 *
 * Only one placeholder dialog can be open at a time, so main keeps a single
 * slot rather than a map. The resolved plaintext of a protected phrase lives
 * here instead of being shipped to the renderer.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { clearPendingPrompt, holdPendingPrompt, peekPendingPromptId, takePendingPrompt } from '../src/pending-prompt'

const insert = { phraseId: 7, phraseType: 'text' as const, operation: 'insert' as const }

beforeEach(() => {
  clearPendingPrompt()
})

describe('pending prompt slot', () => {
  it('hands back the held text exactly once', () => {
    const id = holdPendingPrompt({ ...insert, text: 'sk-live-secret' })
    expect(takePendingPrompt(id, insert)).toBe('sk-live-secret')
    expect(takePendingPrompt(id, insert)).toBeNull()
  })

  it('issues an unguessable id that is different every time', () => {
    const a = holdPendingPrompt({ ...insert, text: 'one' })
    const b = holdPendingPrompt({ ...insert, text: 'two' })
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(16)
  })

  it('refuses an id that does not match the slot', () => {
    const id = holdPendingPrompt({ ...insert, text: 'secret' })
    expect(takePendingPrompt('not-the-id', insert)).toBeNull()
    // The real handle still works: a wrong guess must not consume the slot.
    expect(takePendingPrompt(id, insert)).toBe('secret')
  })

  it('refuses a matching id whose phrase, type or operation disagrees', () => {
    const id = holdPendingPrompt({ ...insert, text: 'secret' })
    expect(takePendingPrompt(id, { ...insert, phraseId: 8 })).toBeNull()
    expect(takePendingPrompt(id, { ...insert, phraseType: 'html' })).toBeNull()
    expect(takePendingPrompt(id, { ...insert, operation: 'copy' })).toBeNull()
    expect(takePendingPrompt(id, insert)).toBe('secret')
  })

  it('a replacement prompt drops the previous secret', () => {
    const first = holdPendingPrompt({ ...insert, text: 'first-secret' })
    const second = holdPendingPrompt({ ...insert, text: 'second-secret' })
    expect(takePendingPrompt(first, insert)).toBeNull()
    expect(takePendingPrompt(second, insert)).toBe('second-secret')
  })

  it('clearPendingPrompt drops the slot, and is what lock and switch call', () => {
    const id = holdPendingPrompt({ ...insert, text: 'secret' })
    expect(peekPendingPromptId()).toBe(id)
    clearPendingPrompt()
    expect(peekPendingPromptId()).toBeNull()
    expect(takePendingPrompt(id, insert)).toBeNull()
  })

  it('separates an insert from a copy of the same phrase', () => {
    const copyId = holdPendingPrompt({ ...insert, operation: 'copy', text: 'copy-secret' })
    expect(takePendingPrompt(copyId, insert)).toBeNull()
    expect(takePendingPrompt(copyId, { ...insert, operation: 'copy' })).toBe('copy-secret')
  })
})
