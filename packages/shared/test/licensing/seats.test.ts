import { describe, it, expect } from 'vitest'
import {
  getSeatStatus,
  formatSeatDisplay,
  singleUserProvider,
  type SeatCountProvider,
} from '../../src/main/licensing/seats'

describe('getSeatStatus', () => {
  describe('basic calculations', () => {
    it('calculates used seats as active + 1 (self)', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 2 }

      const status = getSeatStatus(5, provider)

      expect(status.used).toBe(3) // 2 active + 1 self
    })

    it('marks status ok when within limit', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 2 }

      const status = getSeatStatus(5, provider)

      expect(status.ok).toBe(true)
      expect(status.allowed).toBe(5)
    })

    it('marks status ok when exactly at limit', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 4 }

      const status = getSeatStatus(5, provider)

      expect(status.used).toBe(5)
      expect(status.ok).toBe(true)
    })

    it('marks status not ok when over limit', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 5 }

      const status = getSeatStatus(5, provider)

      expect(status.used).toBe(6)
      expect(status.ok).toBe(false)
    })
  })

  describe('unlimited seats', () => {
    it('treats -1 as unlimited', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 100 }

      const status = getSeatStatus(-1, provider)

      expect(status.unlimited).toBe(true)
      expect(status.ok).toBe(true)
      expect(status.used).toBe(101)
      expect(status.allowed).toBe(-1)
    })

    it('unlimited always ok regardless of count', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 999 }

      const status = getSeatStatus(-1, provider)

      expect(status.unlimited).toBe(true)
      expect(status.ok).toBe(true)
    })
  })

  describe('single user mode', () => {
    it('single user with 1 seat is ok', () => {
      const status = getSeatStatus(1, singleUserProvider)

      expect(status.used).toBe(1)
      expect(status.ok).toBe(true)
      expect(status.unlimited).toBe(false)
    })

    it('singleUserProvider returns 0 active', () => {
      expect(singleUserProvider.getActiveCount()).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('handles 0 allowed seats', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 0 }

      const status = getSeatStatus(0, provider)

      expect(status.used).toBe(1)
      expect(status.ok).toBe(false) // 1 > 0
    })

    it('handles large seat counts', () => {
      const provider: SeatCountProvider = { getActiveCount: () => 999 }

      const status = getSeatStatus(1000, provider)

      expect(status.used).toBe(1000)
      expect(status.ok).toBe(true)
    })
  })
})

describe('formatSeatDisplay', () => {
  it('formats limited seats as used / allowed', () => {
    const status = {
      used: 3,
      allowed: 5,
      ok: true,
      unlimited: false,
    }

    expect(formatSeatDisplay(status)).toBe('3 / 5')
  })

  it('formats unlimited seats with infinity symbol', () => {
    const status = {
      used: 10,
      allowed: -1,
      ok: true,
      unlimited: true,
    }

    expect(formatSeatDisplay(status)).toBe('10 / ∞')
  })

  it('formats single user correctly', () => {
    const status = {
      used: 1,
      allowed: 1,
      ok: true,
      unlimited: false,
    }

    expect(formatSeatDisplay(status)).toBe('1 / 1')
  })

  it('formats over-limit correctly', () => {
    const status = {
      used: 6,
      allowed: 5,
      ok: false,
      unlimited: false,
    }

    expect(formatSeatDisplay(status)).toBe('6 / 5')
  })
})

describe('singleUserProvider', () => {
  it('always returns 0 active seats', () => {
    expect(singleUserProvider.getActiveCount()).toBe(0)
  })

  it('works correctly with getSeatStatus', () => {
    const status = getSeatStatus(1, singleUserProvider)

    expect(status.used).toBe(1)
    expect(status.allowed).toBe(1)
    expect(status.ok).toBe(true)
    expect(status.unlimited).toBe(false)
  })
})

describe('Custom seat providers', () => {
  it('supports dynamic seat counting', () => {
    let activeCount = 0
    const dynamicProvider: SeatCountProvider = {
      getActiveCount: () => activeCount,
    }

    expect(getSeatStatus(5, dynamicProvider).used).toBe(1)

    activeCount = 3
    expect(getSeatStatus(5, dynamicProvider).used).toBe(4)

    activeCount = 10
    expect(getSeatStatus(5, dynamicProvider).ok).toBe(false)
  })

  it('calls getActiveCount each time', () => {
    let callCount = 0
    const countingProvider: SeatCountProvider = {
      getActiveCount: () => {
        callCount++
        return 0
      },
    }

    getSeatStatus(5, countingProvider)
    getSeatStatus(5, countingProvider)
    getSeatStatus(5, countingProvider)

    expect(callCount).toBe(3)
  })
})
