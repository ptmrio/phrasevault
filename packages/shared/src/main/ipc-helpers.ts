/**
 * IPC Helper Utilities for Main Process
 *
 * Provides type-safe wrappers around Electron's IPC functions
 * with channel validation and broadcasting capabilities.
 *
 * @example
 * ```typescript
 * import {
 *   registerIPCHandler,
 *   registerIPCListener,
 *   broadcastToWindows
 * } from '@spqrkapps/shared/main'
 *
 * // Register a handler that returns a value
 * registerIPCHandler('config:get', async () => {
 *   return await loadConfig()
 * })
 *
 * // Register a listener for one-way messages
 * registerIPCListener('app:quit', () => {
 *   app.quit()
 * })
 *
 * // Broadcast to all windows
 * broadcastToWindows('theme:changed', 'dark')
 * ```
 */

import { ipcMain, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'

/**
 * Register a type-safe IPC handler for invoke calls
 * Handler can be async and return a value to the renderer
 *
 * @param channel - The IPC channel name (format: 'domain:action')
 * @param handler - Async function that handles the request and returns a response
 */
export function registerIPCHandler<TInput = unknown, TOutput = unknown>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, input: TInput) => Promise<TOutput> | TOutput
): void {
  ipcMain.handle(channel, handler)
}

/**
 * Register a type-safe IPC listener for one-way messages
 * Used for fire-and-forget communication from renderer
 *
 * @param channel - The IPC channel name (format: 'domain:action')
 * @param handler - Function that handles the message
 */
export function registerIPCListener<TInput = unknown>(
  channel: string,
  handler: (event: IpcMainEvent, input: TInput) => void
): void {
  ipcMain.on(channel, handler)
}

/**
 * Register a once-only IPC listener
 * Automatically removed after first message
 *
 * @param channel - The IPC channel name (format: 'domain:action')
 * @param handler - Function that handles the message
 */
export function registerIPCListenerOnce<TInput = unknown>(
  channel: string,
  handler: (event: IpcMainEvent, input: TInput) => void
): void {
  ipcMain.once(channel, handler)
}

/**
 * Broadcast a message to all open windows
 * Useful for state synchronization (theme changes, config updates, etc.)
 *
 * @param channel - The IPC channel name (format: 'domain:action')
 * @param data - Optional data to send with the message
 */
export function broadcastToWindows(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

/**
 * Send a message to a specific window
 *
 * @param window - The target BrowserWindow
 * @param channel - The IPC channel name
 * @param data - Optional data to send
 */
export function sendToWindow(
  window: BrowserWindow,
  channel: string,
  data?: unknown
): void {
  if (!window.isDestroyed()) {
    window.webContents.send(channel, data)
  }
}

/**
 * Send a message to the focused window
 * Returns false if no window is focused
 *
 * @param channel - The IPC channel name
 * @param data - Optional data to send
 * @returns True if message was sent, false if no focused window
 */
export function sendToFocusedWindow(channel: string, data?: unknown): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    focusedWindow.webContents.send(channel, data)
    return true
  }
  return false
}

/**
 * Remove an IPC handler registered with registerIPCHandler
 *
 * @param channel - The IPC channel name to remove handler for
 */
export function removeIPCHandler(channel: string): void {
  ipcMain.removeHandler(channel)
}

/**
 * Remove all IPC listeners for a channel registered with registerIPCListener
 *
 * @param channel - The IPC channel name to remove listeners for
 */
export function removeIPCListener(channel: string): void {
  ipcMain.removeAllListeners(channel)
}

/**
 * Remove a specific IPC listener function
 *
 * @param channel - The IPC channel name
 * @param handler - The specific handler function to remove
 */
export function removeIPCListenerFn(
  channel: string,
  handler: (event: IpcMainEvent, ...args: unknown[]) => void
): void {
  ipcMain.removeListener(channel, handler)
}

/**
 * Check if a handler is registered for a channel
 *
 * @param channel - The IPC channel name
 * @returns True if at least one listener exists
 */
export function hasIPCListener(channel: string): boolean {
  return ipcMain.listenerCount(channel) > 0
}

/**
 * Create a batch of related IPC handlers
 * Useful for grouping related functionality
 *
 * @example
 * ```typescript
 * const cleanup = registerIPCHandlers({
 *   'config:get': async () => loadConfig(),
 *   'config:set': async (_, data) => saveConfig(data),
 * })
 *
 * // Later, remove all handlers
 * cleanup()
 * ```
 *
 * @param handlers - Object mapping channel names to handler functions
 * @returns Cleanup function that removes all registered handlers
 */
export function registerIPCHandlers(
  handlers: Record<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown> | unknown>
): () => void {
  const channels = Object.keys(handlers)

  for (const channel of channels) {
    ipcMain.handle(channel, handlers[channel])
  }

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel)
    }
  }
}

/**
 * Create a batch of related IPC listeners
 *
 * @param listeners - Object mapping channel names to listener functions
 * @returns Cleanup function that removes all registered listeners
 */
export function registerIPCListeners(
  listeners: Record<string, (event: IpcMainEvent, input: unknown) => void>
): () => void {
  const entries = Object.entries(listeners)

  for (const [channel, handler] of entries) {
    ipcMain.on(channel, handler)
  }

  return () => {
    for (const [channel, handler] of entries) {
      ipcMain.removeListener(channel, handler)
    }
  }
}
