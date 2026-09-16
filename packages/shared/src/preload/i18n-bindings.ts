/**
 * i18n preload bindings
 * Exposes i18n functions via contextBridge
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface I18nAPI {
  t: (key: string, options?: Record<string, unknown>) => Promise<string>
  changeLanguage: (lang: string) => Promise<void>
  getLanguage: () => Promise<string>
}

/**
 * Expose i18n API to renderer via contextBridge
 * Use with main process handlers for i18n:translate, i18n:changeLanguage, i18n:getLanguage
 */
export function exposeI18n(): void {
  const api: I18nAPI = {
    t: (key: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke('i18n:translate', key, options),
    changeLanguage: (lang: string) =>
      ipcRenderer.invoke('i18n:changeLanguage', lang),
    getLanguage: () => ipcRenderer.invoke('i18n:getLanguage'),
  }

  contextBridge.exposeInMainWorld('i18n', api)
}

/**
 * Expose synchronous i18n API (requires sync IPC handlers)
 * Useful for inline translations
 */
export function exposeI18nSync(): void {
  const api = {
    t: (key: string, options?: Record<string, unknown>) =>
      ipcRenderer.sendSync('i18n:translate-sync', key, options) as string,
    changeLanguage: (lang: string) =>
      ipcRenderer.invoke('i18n:changeLanguage', lang),
    getLanguage: () =>
      ipcRenderer.sendSync('i18n:getLanguage-sync') as string,
  }

  contextBridge.exposeInMainWorld('i18n', api)
}

// Type augmentation for Window
declare global {
  interface Window {
    i18n?: I18nAPI
  }
}
