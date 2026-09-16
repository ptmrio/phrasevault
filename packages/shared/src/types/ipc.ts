/**
 * Shared IPC channel type definitions
 *
 * Provides type-safe IPC patterns for Electron apps.
 * Apps extend CommonIPCChannels with app-specific channels.
 *
 * @example
 * ```typescript
 * import type { IPCChannel, CommonIPCChannels, CreatePreloadAPI } from '@spqrkapps/shared/types'
 *
 * // Extend with app-specific channels
 * interface MyAppChannels extends CommonIPCChannels {
 *   'backup:run': void
 *   'backup:status': void
 * }
 *
 * // Create type-safe preload API
 * type MyAPI = CreatePreloadAPI<MyAppChannels>
 * ```
 */

/**
 * Base channel pattern for namespacing
 * All IPC channels must follow 'domain:action' format
 */
export type IPCChannel = `${string}:${string}`

/**
 * Theme mode options
 */
export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * Effective theme (resolved from system when 'system' is selected)
 */
export type EffectiveTheme = 'light' | 'dark'

/**
 * Common IPC channel definitions used by all apps
 * Apps extend this interface with app-specific channels
 */
export interface CommonIPCChannels {
  // Config
  'config:get': void
  'config:set': Record<string, unknown>
  'config:getLanguage': void

  // Theme
  'theme:get': void
  'theme:set': ThemeMode
  'theme:changed': EffectiveTheme

  // License
  'license:get': void
  'license:activate': string
  'license:deactivate': void
  'license:hasValid': void

  // Trial
  'trial:status': void
  'trial:shouldShowReminder': void
  'trial:markReminderShown': void

  // App
  'app:getInfo': void
}

/**
 * Type helper for defining IPC handler signatures
 *
 * @example
 * ```typescript
 * type GetConfigHandler = IPCHandler<void, AppConfig>
 * type SetConfigHandler = IPCHandler<Partial<AppConfig>, void>
 * ```
 */
export type IPCHandler<TInput = void, TOutput = void> = {
  input: TInput
  output: TOutput
}

/**
 * Type helper for defining channel payloads
 *
 * @example
 * ```typescript
 * type MyChannels = ChannelPayloads<{
 *   'config:get': IPCHandler<void, Config>
 *   'config:set': IPCHandler<Partial<Config>, void>
 * }>
 * ```
 */
export type ChannelPayloads<T extends Record<string, IPCHandler<unknown, unknown>>> = {
  [K in keyof T]: T[K]['input']
}

/**
 * Extract input type from channel definition
 */
export type ChannelInput<
  TChannels extends Record<string, unknown>,
  K extends keyof TChannels
> = TChannels[K]

/**
 * Preload API interface for type-safe renderer communication
 *
 * @example
 * ```typescript
 * declare global {
 *   interface Window {
 *     api: PreloadAPI<MyAppChannels>
 *   }
 * }
 * ```
 */
export interface PreloadAPI<TChannels extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Invoke an IPC channel and wait for response
   */
  invoke: <K extends keyof TChannels & string>(
    channel: K,
    data?: TChannels[K]
  ) => Promise<unknown>

  /**
   * Send a one-way message to main process
   */
  send: <K extends keyof TChannels & string>(
    channel: K,
    data?: TChannels[K]
  ) => void

  /**
   * Send a synchronous message to main process
   * Use sparingly - blocks renderer
   */
  sendSync: <K extends keyof TChannels & string>(
    channel: K,
    data?: TChannels[K]
  ) => unknown

  /**
   * Listen for messages from main process
   */
  receive: <K extends keyof TChannels & string>(
    channel: K,
    callback: (...args: unknown[]) => void
  ) => void

  /**
   * Listen for a single message from main process
   */
  receiveOnce: <K extends keyof TChannels & string>(
    channel: K,
    callback: (...args: unknown[]) => void
  ) => void

  /**
   * Remove all listeners for a channel
   */
  removeAllListeners: (channel: keyof TChannels & string) => void
}

/**
 * Type alias for backwards compatibility
 * @deprecated Use PreloadAPI instead
 */
export type CreatePreloadAPI<TChannels extends Record<string, unknown>> = PreloadAPI<TChannels>

/**
 * Utility to create a typed channel list from an interface
 *
 * @example
 * ```typescript
 * const VALID_CHANNELS = ['config:get', 'config:set', 'theme:get'] as const
 * type ValidChannels = typeof VALID_CHANNELS[number]
 * ```
 */
export type ChannelList<T extends Record<string, unknown>> = (keyof T & string)[]

/**
 * Extract channel names from channel interface as a readonly tuple type
 */
export type ChannelNames<T extends Record<string, unknown>> = readonly (keyof T & string)[]
