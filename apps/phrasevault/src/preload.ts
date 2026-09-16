import { contextBridge } from 'electron'
import { createPreloadAPI, COMMON_CHANNELS, applyPlatformAttribute } from '@spqrkapps/shared/preload'

/**
 * PhraseVault-specific IPC channels
 */
const PHRASEVAULT_CHANNELS = [
  // Phrases
  'phrases:search',
  'phrases:add',
  'phrases:edit',
  'phrases:delete',
  'phrases:duplicate',
  'phrases:copyToClipboard',
  'phrases:copyId',
  'phrases:incrementUsage',
  'phrases:insert',
  'phrases:insertById',
  'phrases:list',
  'phrases:added',
  'phrases:duplicated',
  'phrases:edited',
  'phrases:deleted',
  'phrases:export',
  'phrases:importFile',
  'phrases:importConfirm',
  'phrases:importPreview',
  'phrases:importComplete',
  // Config extensions
  'config:init',
  'config:setAutostart',
  // Database
  'database:new',
  'database:open',
  'database:openRecent',
  'database:getRecent',
  'database:recentList',
  'database:showInFolder',
  'database:status',
  'database:error',
  'database:switched',
  // UI
  'ui:toast',
  'ui:focusSearch',
  'ui:openSettings',
  // App
  'app:hideToTray',
  // License extensions
  'license:showLegacyMigration',
  'license:getStatus',
  // Dynamic Prompts
  'prompt:show',
  'prompt:response',
  'prompt:showForCopy',
  'prompt:copyResponse',
  // Vault (PIN lock)
  'vault:getStatus',
  'vault:setup',
  'vault:unlock',
  'vault:lock',
  'vault:changePin',
  'vault:setTimeout',
  'vault:getPhraseBody',
  'vault:changed',
  // Shortcut
  'shortcut:get',
  'shortcut:set',
  'shortcut:validate',
  'shortcut:changed',
] as const

/**
 * All valid channels for PhraseVault
 */
const VALID_CHANNELS = [
  ...COMMON_CHANNELS,
  ...PHRASEVAULT_CHANNELS,
] as const

// Create and expose the validated API
const api = createPreloadAPI(VALID_CHANNELS)
contextBridge.exposeInMainWorld('api', api)

// Expose platform immediately for CSS styling (avoids async flash)
contextBridge.exposeInMainWorld('platform', process.platform)

// Set the platform data attribute on <html> at preload time, before first paint
applyPlatformAttribute()
