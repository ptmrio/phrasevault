import { expect, it, vi } from 'vitest'
import { createCompositionGuard, isPlainPaletteKey } from '../src/palette-keys'

const enter = {
  key: 'Enter',
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
}

it('suppresses the composition commit key even after compositionend', () => {
  const guard = createCompositionGuard()
  guard.start()
  expect(guard.blocks({ ...enter, key: 'ArrowDown' })).toBe(true)
  guard.end()
  expect(guard.blocks(enter)).toBe(true)
  guard.keyup('Enter')
  expect(guard.blocks(enter)).toBe(false)
  expect(guard.blocks({ ...enter, keyCode: 229 })).toBe(true)
})

it('does not eat a fresh Enter after an IME committed by another key', () => {
  const guard = createCompositionGuard()
  guard.start()
  guard.end()
  guard.keyup(' ')
  expect(guard.blocks(enter)).toBe(false)
})

it('does not leave mouse-committed composition blocking Enter or isActive', async () => {
  vi.useFakeTimers()
  try {
    const guard = createCompositionGuard()
    guard.start()
    guard.end()
    expect(guard.blocks(enter)).toBe(true)
    expect(guard.isActive()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(guard.blocks(enter)).toBe(false)
    expect(guard.isActive()).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it.each(['repeat', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)(
  'rejects %s for palette activation',
  (flag) => {
    expect(isPlainPaletteKey({ ...enter, [flag]: true })).toBe(false)
  }
)

it('accepts an unmodified non-repeating key', () => {
  expect(isPlainPaletteKey(enter)).toBe(true)
})
