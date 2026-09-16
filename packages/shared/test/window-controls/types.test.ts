import { describe, it, expect } from 'vitest'
import { isNewerWindowState } from '../../src/types/window-controls'

describe('isNewerWindowState', () => {
  it('keeps a later revision and discards equal or older snapshots', () => {
    expect(isNewerWindowState({ revision: 4 }, 3)).toBe(true)
    expect(isNewerWindowState({ revision: 3 }, 3)).toBe(false)
    expect(isNewerWindowState({ revision: 2 }, 3)).toBe(false)
  })
})
