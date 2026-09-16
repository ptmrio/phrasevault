/**
 * Seat counting for license enforcement
 */

export interface SeatStatus {
  used: number
  allowed: number
  ok: boolean
  unlimited: boolean
}

export interface SeatCountProvider {
  /** Return the number of active seats/devices (excluding self) */
  getActiveCount: () => number
}

/**
 * Get seat status based on license and active count
 * @param allowedSeats - Number of allowed seats from license (-1 for unlimited)
 * @param provider - Provider that returns active seat count
 */
export function getSeatStatus(
  allowedSeats: number,
  provider: SeatCountProvider
): SeatStatus {
  const activeCount = provider.getActiveCount()
  const used = activeCount + 1 // active + self

  // -1 means unlimited seats
  const unlimited = allowedSeats === -1
  const ok = unlimited || used <= allowedSeats

  return {
    used,
    allowed: allowedSeats,
    ok,
    unlimited,
  }
}

/**
 * Format seat display for UI
 */
export function formatSeatDisplay(status: SeatStatus): string {
  if (status.unlimited) {
    return `${status.used} / ∞`
  }
  return `${status.used} / ${status.allowed}`
}

/**
 * Simple seat provider that always returns 0 active seats (single-user mode)
 */
export const singleUserProvider: SeatCountProvider = {
  getActiveCount: () => 0,
}
