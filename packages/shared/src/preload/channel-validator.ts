/**
 * Preload Channel Validator
 *
 * Provides secure IPC communication with channel whitelisting.
 * Only channels explicitly listed in validChannels can be used.
 *
 * @example
 * ```typescript
 * import { createPreloadAPI, exposePreloadAPI } from '@spqrkapps/shared/preload'
 *
 * // Define valid channels for this app
 * const VALID_CHANNELS = [
 *   'config:get',
 *   'config:set',
 *   'theme:get',
 *   'theme:set',
 *   'theme:changed',
 * ] as const
 *
 * // Create validated API
 * const api = createPreloadAPI(VALID_CHANNELS)
 *
 * // Expose to renderer
 * exposePreloadAPI('api', api)
 * ```
 */

import { ipcRenderer, contextBridge } from 'electron'

/**
 * Type for the validated preload API
 */
export interface ValidatedPreloadAPI {
  /**
   * Invoke an IPC handler and wait for response
   * @throws Error if channel is not in whitelist
   */
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>

  /**
   * Send a one-way message to main process
   * Invalid channels are silently ignored with console warning
   */
  send: (channel: string, data?: unknown) => void

  /**
   * Send a synchronous message to main process
   * Use sparingly - blocks renderer
   * Invalid channels return undefined with console warning
   */
  sendSync: <T = unknown>(channel: string, ...args: unknown[]) => T | undefined

  /**
   * Listen for messages from main process
   * Invalid channels are silently ignored with console warning
   */
  receive: (channel: string, callback: (...args: unknown[]) => void) => void

  /**
   * Listen for a single message from main process
   * Listener is automatically removed after first message
   * Invalid channels are silently ignored with console warning
   */
  receiveOnce: (channel: string, callback: (...args: unknown[]) => void) => void

  /**
   * Remove all listeners for a channel
   */
  removeAllListeners: (channel: string) => void

  /**
   * Remove a specific listener for a channel
   */
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void
}

/**
 * Creates a validated preload API with channel whitelisting
 *
 * Only channels in the validChannels array can be used.
 * Invalid channels throw errors for invoke() and log warnings for other methods.
 *
 * @param validChannels - Array of allowed channel names (use `as const` for type safety)
 * @returns Validated preload API object
 *
 * @example
 * ```typescript
 * const CHANNELS = ['config:get', 'config:set', 'app:getInfo'] as const
 * const api = createPreloadAPI(CHANNELS)
 *
 * // In renderer:
 * await window.api.invoke('config:get')      // Works
 * await window.api.invoke('secret:hack')     // Throws error
 * ```
 */
export function createPreloadAPI<TChannels extends readonly string[]>(
  validChannels: TChannels
): ValidatedPreloadAPI {
  // Create a Set for O(1) lookup
  const channelSet = new Set<string>(validChannels)
  const listenerWrappers = new WeakMap<
    (...args: unknown[]) => void,
    (event: unknown, ...args: unknown[]) => void
  >()

  const wrapListener = (
    callback: (...args: unknown[]) => void
  ): ((event: unknown, ...args: unknown[]) => void) => {
    const existing = listenerWrappers.get(callback)
    if (existing) return existing
    const wrapper = (_event: unknown, ...args: unknown[]): void => {
      callback(...args)
    }
    listenerWrappers.set(callback, wrapper)
    return wrapper
  }

  const isValidChannel = (channel: string): boolean => {
    return channelSet.has(channel)
  }

  const api: ValidatedPreloadAPI = {
    invoke: async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
      if (!isValidChannel(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`)
      }
      return ipcRenderer.invoke(channel, ...args) as Promise<T>
    },

    send: (channel: string, data?: unknown): void => {
      if (!isValidChannel(channel)) {
        console.warn(`[IPC] Invalid channel blocked: ${channel}`)
        return
      }
      ipcRenderer.send(channel, data)
    },

    sendSync: <T = unknown>(channel: string, ...args: unknown[]): T | undefined => {
      if (!isValidChannel(channel)) {
        console.warn(`[IPC] Invalid channel blocked: ${channel}`)
        return undefined
      }
      return ipcRenderer.sendSync(channel, ...args) as T
    },

    receive: (channel: string, callback: (...args: unknown[]) => void): void => {
      if (!isValidChannel(channel)) {
        console.warn(`[IPC] Invalid channel blocked: ${channel}`)
        return
      }
      ipcRenderer.on(channel, wrapListener(callback))
    },

    receiveOnce: (channel: string, callback: (...args: unknown[]) => void): void => {
      if (!isValidChannel(channel)) {
        console.warn(`[IPC] Invalid channel blocked: ${channel}`)
        return
      }
      ipcRenderer.once(channel, wrapListener(callback))
    },

    removeAllListeners: (channel: string): void => {
      // Allow removing listeners for any channel (cleanup should always work)
      if (isValidChannel(channel)) {
        ipcRenderer.removeAllListeners(channel)
      }
    },

    removeListener: (channel: string, callback: (...args: unknown[]) => void): void => {
      if (!isValidChannel(channel)) return
      ipcRenderer.removeListener(channel, wrapListener(callback))
    }
  }

  return api
}

/**
 * Expose preload API to renderer via contextBridge
 *
 * @param apiName - Name to expose in window object (e.g., 'api' → window.api)
 * @param api - The validated preload API from createPreloadAPI
 *
 * @example
 * ```typescript
 * const api = createPreloadAPI(VALID_CHANNELS)
 * exposePreloadAPI('api', api)
 *
 * // In renderer: window.api.invoke('channel', data)
 * ```
 */
export function exposePreloadAPI(
  apiName: string,
  api: ValidatedPreloadAPI
): void {
  contextBridge.exposeInMainWorld(apiName, api)
}

/**
 * Create and expose preload API in one step
 *
 * @param apiName - Name to expose in window object
 * @param validChannels - Array of allowed channel names
 * @returns The created API (useful for type declarations)
 *
 * @example
 * ```typescript
 * const api = setupPreloadAPI('api', [
 *   'config:get',
 *   'config:set',
 *   'theme:changed',
 * ] as const)
 *
 * // Declare types for renderer
 * declare global {
 *   interface Window {
 *     api: typeof api
 *   }
 * }
 * ```
 */
export function setupPreloadAPI<TChannels extends readonly string[]>(
  apiName: string,
  validChannels: TChannels
): ValidatedPreloadAPI {
  const api = createPreloadAPI(validChannels)
  exposePreloadAPI(apiName, api)
  return api
}

/**
 * Common IPC channels used by most apps
 * Import and spread into your app's channel list
 *
 * @example
 * ```typescript
 * const APP_CHANNELS = [
 *   ...COMMON_CHANNELS,
 *   'backup:run',
 *   'backup:status',
 * ] as const
 * ```
 */
export const COMMON_CHANNELS = [
  // Config
  'config:get',
  'config:set',
  'config:getLanguage',
  // Theme
  'theme:get',
  'theme:set',
  'theme:changed',
  'theme:getEffective',
  // i18n
  'i18n:translate',
  'i18n:translate-sync',
  'i18n:changeLanguage',
  'i18n:getLanguage',
  'i18n:getLanguage-sync',
  'i18n:getAvailableLanguages',
  'i18n:languageChanged',
  // License
  'license:get',
  'license:activate',
  'license:deactivate',
  'license:hasValid',
  'license:getStatus',  // Used by PhraseVault
  'license:getTrialStatus',
  'license:shouldShowReminder',
  'license:markReminderShown',
  'license:showAgreement',
  'license:showLegacyMigration',  // Legacy migration modal
  'license:accept',
  'license:decline',
  // Trial (alternative namespace - used by ExampleApp)
  'trial:status',
  'trial:shouldShowReminder',
  'trial:markReminderShown',
  // Shell
  'shell:openExternal',
  'shell:showItemInFolder',
  // Window
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:zoom',
  'window:set-fullscreen',
  'window:get-state',
  'window:state-changed',
  // Markdown
  'markdown:readFile',
  'markdown:render',
  'markdown:content',
  // App
  'app:getInfo',
] as const

/**
 * Type for common channels
 */
export type CommonChannel = typeof COMMON_CHANNELS[number]
