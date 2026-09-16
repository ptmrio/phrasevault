/**
 * First-install language selection.
 *
 * Config defaults used to set `language: 'en'`, which made the
 * "unset → detect OS locale" branch in main unreachable. An empty
 * string means "not chosen yet"; persisted `'en'` stays a real choice.
 */

export const INSTALL_LANGUAGE_FALLBACK = 'en'

export function shouldDetectInstallLanguage(language: unknown): boolean {
  return typeof language !== 'string' || language.length === 0
}

/**
 * First supported base language from an ordered candidate list
 * (preferred UI languages, then Chromium locale, then regional locale).
 * Tags like `de-AT` and `pt-BR` match `de` / `pt`.
 */
export function resolveInstallLanguage(
  candidates: readonly string[],
  available: readonly string[],
  fallback = INSTALL_LANGUAGE_FALLBACK
): string {
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    const base = raw.split(/[-_]/)[0].toLowerCase()
    if (available.includes(base)) return base
  }
  return fallback
}
