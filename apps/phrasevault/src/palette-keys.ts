/**
 * Palette key eligibility and IME composition state.
 *
 * Split out of the renderer so the policy is testable without a DOM: only an
 * unmodified, non-repeating key may commit a palette action, and the key event
 * that commits an IME composition must not also activate the palette.
 */

export interface PaletteKey {
  key: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}

export interface CompositionGuard {
  start(): void
  end(): void
  keyup(key: string): void
  blocks(event: PaletteKey): boolean
  isActive(): boolean
}

export function isPlainPaletteKey(event: PaletteKey): boolean {
  return !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

export function createCompositionGuard(): CompositionGuard {
  let composing = false
  let committing = false
  let release: ReturnType<typeof setTimeout> | undefined
  return {
    start(): void {
      composing = true
      committing = false
      clearTimeout(release)
    },
    end(): void {
      composing = false
      committing = true
      // Keyboard IME still delivers the commit key in this turn (blocked).
      // Mouse/touch compositionend has no following keyup; release on the next macrotask.
      clearTimeout(release)
      release = setTimeout(() => {
        committing = false
      }, 0)
    },
    // The commit key's own keyup also releases the guard.
    keyup(_key: string): void {
      if (!composing) committing = false
    },
    blocks(event: PaletteKey): boolean {
      return composing || committing || event.isComposing || event.keyCode === 229
    },
    isActive(): boolean {
      return composing || committing
    },
  }
}
