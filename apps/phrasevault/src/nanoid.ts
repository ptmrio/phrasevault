/**
 * Simple short ID generator (no external dependencies)
 * Generates 7-character base36 lowercase IDs
 */

import crypto from 'crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
export const SHORT_ID_LENGTH = 7

/**
 * Generate a random short ID
 * Uses crypto for secure randomness
 */
export function generateShortId(): string {
  let result = ''
  const randomValues = new Uint8Array(SHORT_ID_LENGTH)
  crypto.randomFillSync(randomValues)

  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += ALPHABET[randomValues[i] % ALPHABET.length]
  }

  return result
}
