/**
 * PhraseVault palette request controller.
 *
 * Owns 75ms trailing coalescing, request versions and database generations,
 * the visible selection target, and at most one cancellable Enter intent.
 * It holds no phrase cache: every settled query is answered by the caller's
 * authoritative read.
 */
import { filterPhrases } from './phrase-search'
import type { PhraseRow } from './types'

export interface SearchStamp {
  version: number
  generation: number
}

export interface SearchState extends SearchStamp {
  query: string
  phase: 'loading' | 'ready' | 'error' | 'unavailable'
  rows: readonly PhraseRow[]
}

export type PaletteTarget = { kind: 'phrase'; id: number } | { kind: 'create'; name: string }

export interface PaletteState extends SearchState {
  target: PaletteTarget | null
}

export interface SearchOptions {
  read: (query: string) => Promise<PhraseRow[]>
  render: (state: PaletteState) => void
  onError: (error: unknown) => void
  canActivate: () => boolean
  activate: (target: PaletteTarget) => void
}

export interface PaletteSearch {
  getState(): PaletteState
  setQuery(query: string, immediate?: boolean): void
  flush(): void
  refresh(): void
  reset(query: string, available: boolean): void
  fail(): void
  enter(): void
  cancelEnter(): void
  focusPhrase(id: number | null): void
  setPending(rows: readonly PhraseRow[]): void
}

export function createPaletteSearch(options: SearchOptions): PaletteSearch {
  let state: SearchState = { query: '', version: 0, generation: 0, phase: 'unavailable', rows: [] }
  let available = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let due = false
  let flight: SearchStamp | null = null
  let focusedId: number | null = null
  let pendingRows: readonly PhraseRow[] = []
  let intent: SearchStamp | null = null

  const matches = (stamp: SearchStamp): boolean =>
    stamp.version === state.version && stamp.generation === state.generation

  function target(): PaletteTarget | null {
    if (state.phase !== 'ready') return null
    const pendingIds = new Set(pendingRows.map((row) => row.id))
    const visible = state.rows.filter((row) => !pendingIds.has(row.id))
    if (focusedId !== null) {
      // Rows are now retained through a loading window, so a focused row can
      // outlive the result that produced it. Refuse rather than fall through to
      // whichever row the fresh result happens to put first.
      if (visible.some((row) => row.id === focusedId)) return { kind: 'phrase', id: focusedId }
      return null
    }
    if (!state.query.trim()) return null
    if (visible.length) return { kind: 'phrase', id: visible[0].id }
    // Rows hidden only by a pending deletion are not proof of zero stored matches.
    if (state.rows.length || filterPhrases(pendingRows, state.query).length) return null
    return { kind: 'create', name: state.query.trim() }
  }

  const getState = (): PaletteState => ({ ...state, rows: [...state.rows], target: target() })
  const publish = (): void => options.render(getState())
  const cancelEnter = (): void => {
    intent = null
  }

  function activateCurrent(): void {
    const current = target()
    if (current && options.canActivate()) options.activate(current)
  }

  function dispatch(): void {
    if (!available || !due || flight) return
    due = false
    const stamp: SearchStamp = { version: state.version, generation: state.generation }
    const query = state.query
    flight = stamp
    const complete = (): void => {
      if (flight !== stamp) return
      flight = null
      dispatch()
    }
    // The async wrapper also converts a synchronous reader exception into rejection.
    void (async () => options.read(query))()
      .then(
        (rows) => {
          if (!matches(stamp)) return
          state = { ...state, phase: 'ready', rows }
          publish()
          if (intent && matches(intent)) {
            intent = null
            activateCurrent()
          }
        },
        (error) => {
          if (!matches(stamp)) return
          cancelEnter()
          state = { ...state, phase: 'error', rows: [] }
          options.onError(error)
          publish()
        }
      )
      .finally(complete)
  }

  function setQuery(query: string, immediate = false): void {
    cancelEnter()
    clearTimeout(timer)
    focusedId = null
    state = {
      ...state,
      query,
      version: state.version + 1,
      // The last settled list stays on screen while the next read is in flight;
      // an unavailable database has nothing settled to keep.
      phase: available ? 'loading' : 'unavailable',
      rows: available ? state.rows : [],
    }
    due = immediate
    publish()
    if (immediate) dispatch()
    else
      timer = setTimeout(() => {
        due = true
        dispatch()
      }, 75)
  }

  function flush(): void {
    if (state.phase === 'ready') return
    if (state.phase === 'error') {
      setQuery(state.query, true)
      return
    }
    clearTimeout(timer)
    // A matching in-flight read is reused; setting due would dispatch a duplicate.
    if (flight && matches(flight)) return
    due = true
    dispatch()
  }

  function reset(query: string, nextAvailable: boolean): void {
    cancelEnter()
    clearTimeout(timer)
    flight = null
    due = false
    available = nextAvailable
    // A database switch must not show the previous database's rows, so the
    // generation bump clears them before setQuery can retain them.
    state = { ...state, generation: state.generation + 1, rows: [] }
    setQuery(query, nextAvailable)
  }

  function fail(): void {
    cancelEnter()
    clearTimeout(timer)
    flight = null
    due = false
    available = true
    focusedId = null
    // Keep the query; do not schedule a read. Retry only via input or flush (search button).
    state = {
      ...state,
      generation: state.generation + 1,
      phase: 'error',
      rows: [],
    }
    publish()
  }

  function enter(): void {
    if (!options.canActivate()) return
    if (state.phase === 'ready') {
      activateCurrent()
      return
    }
    if (!state.query.trim() || state.phase !== 'loading') return
    intent = { version: state.version, generation: state.generation }
    flush()
  }

  function focusPhrase(id: number | null): void {
    // A renderer rebuild focuses the replacement node of the same row. That
    // must not cancel a pending Enter recorded against this query version.
    if (id !== focusedId) cancelEnter()
    focusedId = id
    publish()
  }

  function setPending(rows: readonly PhraseRow[]): void {
    cancelEnter()
    pendingRows = [...rows]
    if (rows.some((row) => row.id === focusedId)) focusedId = null
    publish()
  }

  return {
    getState,
    setQuery,
    flush,
    refresh: () => setQuery(state.query, true),
    reset,
    fail,
    enter,
    cancelEnter,
    focusPhrase,
    setPending,
  }
}
