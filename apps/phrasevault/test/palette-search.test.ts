/**
 * Palette request policy: 75ms coalescing, version/generation freshness,
 * one Enter intent and selection/Create targeting.
 *
 * The harness controls completions only; ranking and policy are production code.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPaletteSearch } from '../src/palette-search'
import type { PaletteTarget } from '../src/palette-search'
import type { PhraseRow } from '../src/types'

const row = (id: number, phrase: string): PhraseRow => ({
  id,
  phrase,
  expanded_text: phrase,
  type: 'text',
  short_id: String(id),
  usageCount: 0,
  dateAdd: '',
  dateLastUsed: '',
  locked: 0,
})

function harness() {
  const calls: Array<{
    query: string
    resolve: (rows: PhraseRow[]) => void
    reject: (error: Error) => void
  }> = []
  const render = vi.fn()
  const onError = vi.fn()
  const activate = vi.fn<(target: PaletteTarget) => void>()
  const allowed = { value: true }
  const search = createPaletteSearch({
    read: (query) => new Promise<PhraseRow[]>((resolve, reject) => calls.push({ query, resolve, reject })),
    render,
    onError,
    activate,
    canActivate: () => allowed.value,
  })
  return { calls, render, onError, activate, allowed, search }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('dispatches only the latest typing burst at 75ms', async () => {
  const h = harness()
  h.search.setQuery('s')
  await vi.advanceTimersByTimeAsync(25)
  h.search.setQuery('si')
  h.search.setQuery('sig')
  expect(h.search.getState().phase).toBe('loading')
  expect(h.search.getState().rows).toEqual([])
  await vi.advanceTimersByTimeAsync(74)
  expect(h.calls).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(h.calls.map((call) => call.query)).toEqual(['sig'])
})

it('keeps one active plus the latest query without an a-b-a alias', async () => {
  const h = harness()
  h.search.setQuery('a', true)
  h.search.setQuery('b')
  h.search.setQuery('a')
  await vi.advanceTimersByTimeAsync(75)
  expect(h.calls).toHaveLength(1)
  h.calls[0].resolve([row(1, 'old a')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.calls.map((call) => call.query)).toEqual(['a', 'a'])
  expect(h.search.getState().phase).toBe('loading')
  h.calls[1].resolve([row(2, 'fresh a')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().rows.map((value) => value.id)).toEqual([2])
})

it('flushes once, reuses the running current read, and preserves error state', async () => {
  const h = harness()
  h.search.setQuery('sig')
  h.search.flush()
  h.search.flush()
  expect(h.calls).toHaveLength(1)
  h.calls[0].reject(new Error('offline'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().phase).toBe('error')
  expect(h.onError).toHaveBeenCalledOnce()
  h.search.flush()
  expect(h.calls).toHaveLength(2)
})

it('starts B without waiting for A and discards the same ID from A', async () => {
  const h = harness()
  h.search.setQuery('sig', true)
  h.search.reset('sig', true)
  expect(h.calls).toHaveLength(2)
  h.calls[1].resolve([row(1, 'database B')])
  await vi.advanceTimersByTimeAsync(0)
  h.calls[0].resolve([row(1, 'database A')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().rows[0].phrase).toBe('database B')
})

// ---------------------------------------------------------------------------
// Selection and the single cancellable Enter intent
// ---------------------------------------------------------------------------

it('renders before activating once and reuses an in-flight Enter', async () => {
  const h = harness()
  h.search.setQuery('sig')
  h.search.enter()
  h.search.enter()
  expect(h.calls).toHaveLength(1)
  h.calls[0].resolve([row(1, 'sig')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().target).toEqual({ kind: 'phrase', id: 1 })
  expect(h.activate).toHaveBeenCalledExactlyOnceWith({ kind: 'phrase', id: 1 })
  expect(h.render.mock.invocationCallOrder.at(-1)).toBeLessThan(h.activate.mock.invocationCallOrder[0])
})

it.each([
  'query edit',
  'control focus',
  'composition',
  'modal',
  'blur',
  'hide',
  'Escape',
  'database error',
  'switch',
] as const)('cancels pending Enter on %s', async (interruption) => {
  const h = harness()
  h.search.setQuery('sig')
  h.search.enter()
  if (interruption === 'query edit') h.search.setQuery('signature')
  else if (interruption === 'database error') h.search.fail()
  else if (interruption === 'switch') h.search.reset('', false)
  else h.search.cancelEnter()
  h.calls[0].resolve([row(1, 'sig')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.activate).not.toHaveBeenCalled()
})

it('blank search Enter is inert but an explicitly focused row can insert', async () => {
  const h = harness()
  h.search.setQuery(' \t', true)
  h.search.enter()
  h.calls[0].resolve([row(1, 'sig')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().target).toBeNull()
  expect(h.activate).not.toHaveBeenCalled()
  h.search.focusPhrase(1)
  h.search.enter()
  expect(h.activate).toHaveBeenCalledExactlyOnceWith({ kind: 'phrase', id: 1 })
})

it('offers Create only for confirmed no matches, preserving the trimmed name', async () => {
  const h = harness()
  h.search.setQuery('  <b>É  Name</b>  ')
  h.search.enter()
  expect(h.search.getState().target).toBeNull()
  h.calls[0].resolve([])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.activate).toHaveBeenCalledExactlyOnceWith({ kind: 'create', name: '<b>É  Name</b>' })
})

it('keeps pending deletions excluded through read completion and restores them on Undo', async () => {
  const h = harness()
  const pending = row(1, 'sig')
  h.search.setPending([pending])
  h.search.setQuery('sig', true)
  h.calls[0].resolve([pending])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().target).toBeNull()
  h.search.setPending([])
  expect(h.search.getState().target).toEqual({ kind: 'phrase', id: 1 })
  h.search.setPending([pending])
  h.search.refresh()
  h.calls[1].resolve([])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().target).toBeNull()
  h.search.setPending([])
  expect(h.search.getState().target).toEqual({ kind: 'create', name: 'sig' })
})

it('cancels a pending action when current read fails or the last-moment guard fails', async () => {
  const h = harness()
  h.search.setQuery('sig')
  h.search.enter()
  h.calls[0].reject(new Error('offline'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.activate).not.toHaveBeenCalled()
  h.search.setQuery('sig')
  h.search.enter()
  h.allowed.value = false
  h.calls[1].resolve([row(1, 'sig')])
  await vi.advanceTimersByTimeAsync(0)
  h.allowed.value = true
  expect(h.activate).not.toHaveBeenCalled()
})

it('import refresh invalidates even the same raw query and a queued Enter', async () => {
  const h = harness()
  h.search.setQuery('sig')
  h.search.enter()
  h.search.refresh()
  h.calls[0].resolve([row(1, 'before import')])
  await vi.advanceTimersByTimeAsync(0)
  h.calls[1].resolve([row(2, 'after import')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().target).toEqual({ kind: 'phrase', id: 2 })
  expect(h.activate).not.toHaveBeenCalled()
})

it('does not dispatch a search after fail without user input', async () => {
  const h = harness()
  h.search.setQuery('sig', true)
  h.calls[0].resolve([row(1, 'sig')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.calls).toHaveLength(1)
  h.search.fail()
  expect(h.search.getState().phase).toBe('error')
  expect(h.search.getState().target).toBeNull()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.calls).toHaveLength(1)
  expect(h.search.getState().phase).toBe('error')
})

// ---------------------------------------------------------------------------
// Loading keeps the last settled list; a database switch does not
// ---------------------------------------------------------------------------

it('keeps the settled rows through the next loading window', async () => {
  const h = harness()
  h.search.setQuery('sig', true)
  h.calls[0].resolve([row(1, 'sig'), row(2, 'signature formal')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().rows.map((value) => value.id)).toEqual([1, 2])
  h.search.setQuery('signature')
  // Ordinary typing publishes loading over the rows already on screen.
  expect(h.search.getState().phase).toBe('loading')
  expect(h.search.getState().rows.map((value) => value.id)).toEqual([1, 2])
  // A loading state is never an Enter target, retained rows included.
  expect(h.search.getState().target).toBeNull()
  await vi.advanceTimersByTimeAsync(75)
  h.calls[1].resolve([row(2, 'signature formal')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().rows.map((value) => value.id)).toEqual([2])
})

it('shows no rows from the previous database after a switch', async () => {
  const h = harness()
  h.search.setQuery('sig', true)
  h.calls[0].resolve([row(1, 'database A')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.search.getState().rows).toHaveLength(1)
  h.search.reset('sig', true)
  expect(h.search.getState().rows).toEqual([])
  // An unavailable switch is equally empty.
  h.search.reset('sig', false)
  expect(h.search.getState().phase).toBe('unavailable')
  expect(h.search.getState().rows).toEqual([])
})

it('refuses a focused row that the settled result does not contain', async () => {
  const h = harness()
  h.search.setQuery('sig', true)
  h.calls[0].resolve([row(1, 'sig'), row(2, 'signature formal')])
  await vi.advanceTimersByTimeAsync(0)
  // A retained row is focused during the next loading window.
  h.search.setQuery('signature', true)
  h.search.focusPhrase(1)
  h.calls[1].resolve([row(2, 'signature formal')])
  await vi.advanceTimersByTimeAsync(0)
  // Never the first fresh row: refusing is the only outcome consistent with
  // "stale visible rows never become the Enter target".
  expect(h.search.getState().target).toBeNull()
  h.search.focusPhrase(2)
  expect(h.search.getState().target).toEqual({ kind: 'phrase', id: 2 })
})

it('keeps a pending Enter when the same retained row is refocused', async () => {
  const h = harness()
  h.search.setQuery('sig', true)
  h.calls[0].resolve([row(1, 'sig'), row(2, 'signature formal')])
  await vi.advanceTimersByTimeAsync(0)
  h.search.setQuery('sig', true)
  h.search.focusPhrase(1)
  h.search.enter()
  // Renderer rebuild focuses the replacement node of the same row.
  h.search.focusPhrase(1)
  h.calls[1].resolve([row(1, 'sig'), row(2, 'signature formal')])
  await vi.advanceTimersByTimeAsync(0)
  expect(h.activate).toHaveBeenCalledExactlyOnceWith({ kind: 'phrase', id: 1 })
})
