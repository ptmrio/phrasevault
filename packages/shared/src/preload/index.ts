/**
 * Preload script utilities for Electron apps
 *
 * @example
 * ```typescript
 * import {
 *   createPreloadAPI,
 *   exposePreloadAPI,
 *   setupPreloadAPI,
 *   COMMON_CHANNELS,
 *   exposeI18n
 * } from '@spqrkapps/shared/preload'
 *
 * // Quick setup
 * const api = setupPreloadAPI('api', [
 *   ...COMMON_CHANNELS,
 *   'myapp:customChannel',
 * ] as const)
 *
 * exposeI18n()
 * ```
 */

// Channel Validator
export {
  createPreloadAPI,
  exposePreloadAPI,
  setupPreloadAPI,
  COMMON_CHANNELS,
  type ValidatedPreloadAPI,
  type CommonChannel,
} from './channel-validator'

// I18n
export { exposeI18n, exposeI18nSync, type I18nAPI } from './i18n-bindings'

// Platform
export { applyPlatformAttribute } from './platform'
