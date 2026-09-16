/**
 * Main process utilities for Electron apps
 *
 * @example
 * ```typescript
 * import {
 *   createLicenseSystem,
 *   createConfigService,
 *   createMainWindow,
 *   setTheme
 * } from '@spqrkapps/shared/main'
 * ```
 */

// Licensing
export * from './licensing'

// Config
export { createConfigService, type BaseConfigSchema, type ConfigServiceOptions, type ConfigService } from './config'

// JsonStore (low-level storage)
export { JsonStore, createJsonStore, type JsonStoreOptions } from './json-store'

// Window
export {
  createMainWindow,
  isDarkMode,
  type WindowOptions,
  type SafeBrowserWindowOptions,
} from './window'

// Window State
export { createWindowStateManager, type WindowState, type WindowStateManager } from './window-state'

// Tray
export {
  createTray,
  toggleWindow,
  hideToTray,
  showFromTray,
  updateTrayTooltip,
  updateTrayMenu,
  type TrayOptions,
} from './tray'

// Notifications
export { showNotification, shouldNotify, type NotificationOptions } from './notifications'

// Theme
export {
  setTheme,
  getTheme,
  getEffectiveTheme,
  isDarkMode as isSystemDarkMode,
  setupThemeListener,
  handleThemeChange,
  type ThemeMode,
} from './theme'

// Autostart
export {
  setAutostart,
  getAutostartStatus,
  wasLaunchedAtLogin,
  isAutostartSupported,
  syncAutostart,
  shouldShowWindowOnStartup,
  DEFAULT_AUTOSTART_ARGS,
  type AutostartConfig,
  type AutostartOptions,
  type StartupVisibilityOptions,
} from './autostart'

// Logger
export { createLogger, createAppLogger, type Logger, type LoggerOptions, type LogLevel, type AppLogger } from './logger'

// Single Instance
export {
  enforceSingleInstance,
  releaseSingleInstanceLock,
  type SingleInstanceOptions,
} from './single-instance'

// Shell
export {
  openExternal,
  openExternalSync,
  showItemInFolder,
  openPath,
  trashItem,
  beep,
} from './shell'

// IPC Helpers
export {
  registerIPCHandler,
  registerIPCListener,
  registerIPCListenerOnce,
  broadcastToWindows,
  sendToWindow,
  sendToFocusedWindow,
  removeIPCHandler,
  removeIPCListener,
  removeIPCListenerFn,
  hasIPCListener,
  registerIPCHandlers,
  registerIPCListeners,
} from './ipc-helpers'

// Standard IPC Handler Registrations
export {
  registerThemeHandlers,
  registerI18nHandlers,
  registerWindowHandlers,
  registerShellHandlers,
  registerAppInfoHandlers,
  registerLicenseHandlers,
  type ThemeHandlerOptions,
  type I18nHandlerOptions,
  type WindowHandlerOptions,
  type AppInfoHandlerOptions,
  type LicenseHandlerOptions,
} from './ipc-handlers'

// Dev Mode (testing utilities)
export { setupTestTimeout, setupDevMode } from './dev-mode'

// Markdown
export {
  registerMarkdownHandlers,
  renderMarkdown,
  renderMarkdownFile,
  MARKDOWN_IPC_CHANNELS,
  type MarkdownOptions,
  type MarkdownContentResponse,
} from './markdown'
