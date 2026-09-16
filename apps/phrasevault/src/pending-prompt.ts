/**
 * The prompt handle for protected phrases.
 *
 * When a phrase that involves a protected body needs placeholder values, main
 * keeps the resolved plaintext here and sends the renderer an opaque id instead.
 * Only one placeholder dialog can be open at a time, so this is a single slot
 * rather than a map: a replacement prompt, a cancel, a lock or a database switch
 * all drop the previous secret. The plaintext therefore survives in main RAM for
 * at most the lifetime of the DEK that produced it.
 */
import { randomBytes } from 'node:crypto'
import type { PhraseType } from './types'

export type PromptOperation = 'insert' | 'copy'

export interface PendingPromptMatch {
  phraseId: number
  phraseType: PhraseType
  operation: PromptOperation
}

interface PendingPrompt extends PendingPromptMatch {
  id: string
  text: string
}

let pending: PendingPrompt | null = null

/** Replaces any previous slot and returns the handle the renderer echoes back. */
export function holdPendingPrompt(entry: PendingPromptMatch & { text: string }): string {
  const id = randomBytes(16).toString('hex')
  pending = { ...entry, id }
  return id
}

/**
 * Consumes the slot. Every field must agree — a handle alone is not enough to
 * pull the plaintext for a different phrase, type or operation.
 */
export function takePendingPrompt(id: unknown, match: PendingPromptMatch): string | null {
  if (typeof id !== 'string' || !pending || pending.id !== id) return null
  if (
    pending.phraseId !== match.phraseId ||
    pending.phraseType !== match.phraseType ||
    pending.operation !== match.operation
  ) {
    return null
  }
  const { text } = pending
  pending = null
  return text
}

/** Called on cancel, on lock, and on a database switch. */
export function clearPendingPrompt(): void {
  pending = null
}

/** Test/diagnostic only. Never returns the held text. */
export function peekPendingPromptId(): string | null {
  return pending?.id ?? null
}
