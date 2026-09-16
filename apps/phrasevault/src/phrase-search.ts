/**
 * PhraseVault phrase ranking.
 *
 * Single authoritative matcher for both database search paths and their tests.
 * Semantics are unchanged from the original inline implementation: NFC + lowercase
 * normalization, whitespace-split AND tokens across name and content, exact
 * normalized full-name matches first, then the caller's incoming order
 * (usageCount DESC including its tie order), with no duplicate IDs.
 */

export interface SearchablePhrase {
  id: number
  phrase: string | null
  expanded_text: string | null
}

export function filterPhrases<T extends SearchablePhrase>(
  rows: readonly T[],
  rawQuery: string
): T[] {
  const norm = (value: string | null): string => (value ?? '').normalize('NFC').toLowerCase()
  const query = norm(rawQuery)
  const tokens = query.split(/\s+/).filter(Boolean)
  const matching = rows.filter((row) =>
    tokens.every((token) => norm(row.phrase).includes(token) || norm(row.expanded_text).includes(token))
  )
  const exact = tokens.length ? matching.filter((row) => norm(row.phrase) === query) : []
  const seen = new Set<number>()
  return [...exact, ...matching].filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}
