/**
 * Export filtering.
 *
 * Protected rows never leave the database — not their plaintext and not their
 * ciphertext — in either export mode and whether or not the session happens to
 * be unlocked. The count of what was left out is reported to the user rather
 * than silently dropped.
 */
import type { PhraseRow } from './types'

export interface ExportSelection {
  exportable: PhraseRow[]
  omitted: number
}

export function splitExportRows(rows: readonly PhraseRow[]): ExportSelection {
  const exportable = rows.filter((row) => row.locked !== 1)
  return { exportable, omitted: rows.length - exportable.length }
}
