/**
 * i18n utilities for Electron renderer
 * DOM translation and language management
 */
import i18next from 'i18next'
import type { InitOptions, TOptions, i18n as I18nInstance } from 'i18next'

export interface I18nOptions {
  /** Default/initial language */
  defaultLanguage: string
  /** Fallback language */
  fallbackLanguage: string
  /** Translation resources */
  resources?: Record<string, { translation: Record<string, string> }>
  /** Additional i18next options */
  options?: Partial<InitOptions>
}

let isInitialized = false

/**
 * Initialize i18n with the given options
 */
export async function initI18n(options: I18nOptions): Promise<I18nInstance> {
  if (isInitialized) {
    return i18next
  }

  await i18next.init({
    lng: options.defaultLanguage,
    fallbackLng: options.fallbackLanguage,
    interpolation: {
      escapeValue: false,
    },
    resources: options.resources,
    ...options.options,
  })

  isInitialized = true
  return i18next
}

/**
 * Translate a key
 */
export function t(key: string, options?: TOptions): string {
  return i18next.t(key, options)
}

/**
 * Change the current language
 */
export function changeLanguage(lang: string): Promise<void> {
  return i18next.changeLanguage(lang).then(() => {
    // Update DOM after language change
    updateDOM()
  })
}

/**
 * Get the current language
 */
export function getLanguage(): string {
  return i18next.language
}

/**
 * Update all DOM elements with data-i18n attributes
 */
export function updateDOM(): void {
  // data-i18n - replace text content
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (key) {
      el.textContent = t(key)
    }
  })

  // data-i18n-placeholder - replace placeholder
  document
    .querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')
    .forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder')
      if (key) {
        el.placeholder = t(key)
      }
    })

  // data-i18n-title - replace title attribute
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')
    if (key) {
      el.setAttribute('title', t(key))
    }
  })

  // data-i18n-aria-label - replace aria-label
  document
    .querySelectorAll<HTMLElement>('[data-i18n-aria-label]')
    .forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label')
      if (key) {
        el.setAttribute('aria-label', t(key))
      }
    })

  // data-i18n-value - replace value attribute
  document
    .querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-i18n-value]')
    .forEach((el) => {
      const key = el.getAttribute('data-i18n-value')
      if (key) {
        el.value = t(key)
      }
    })

  // data-i18n-html - replace innerHTML (use with caution)
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html')
    if (key) {
      el.innerHTML = t(key)
    }
  })
}

/**
 * Check if i18n is initialized
 */
export function isI18nInitialized(): boolean {
  return isInitialized
}

/**
 * Get the i18next instance for advanced use
 */
export function getI18nInstance(): I18nInstance {
  return i18next
}
