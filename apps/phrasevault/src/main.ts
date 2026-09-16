import {
  app,
  Menu,
  globalShortcut,
  BrowserWindow,
  ipcMain,
  clipboard,
  ClipboardItem,
  screen,
  shell,
  dialog,
  systemPreferences,
} from 'electron'
import { setupTestTimeout, registerMarkdownHandlers, registerWindowHandlers, renderMarkdown, handleThemeChange, registerShellHandlers, enforceSingleInstance, createLicenseSystem, setAutostart, wasLaunchedAtLogin, syncAutostart, DEFAULT_AUTOSTART_ARGS, registerI18nHandlers, registerLicenseHandlers, updateTrayMenu, updateTrayTooltip, toggleWindow } from '@spqrkapps/shared/main'
import { VelopackApp } from 'velopack'
import { windowManager } from 'node-window-manager'
import { platform } from 'os'
import path from 'path'
import fs from 'fs'
import EventEmitter from 'events'
import robot from '@hurdlegroup/robotjs'
import {
  createWindow,
  createTray,
  hideToTray,
  showFromTray,
  showBackgroundNotification,
  getMainWindow,
  getTray,
  getAppRoot,
} from './window'
import {
  getConfig,
  setConfig,
  addRecentFile,
  getBalloonShown,
  setBalloonShown,
  shouldShowLicenseAgreement,
  acceptLicenseAgreement,
} from './services/config'
import { resolveInstallLanguage, shouldDetectInstallLanguage } from './services/install-language'
import { initDatabase, getLockableRowById, getLockableRowByShortId, switchDatabase } from './database'
import { registerVaultHandlers } from './vault-ipc'
import {
  VaultError,
  isUnlocked,
  onLock,
  revealRow,
  setVaultBroadcast,
  setVaultConfigAccess,
} from './services/lock'
import { clearPendingPrompt, holdPendingPrompt, takePendingPrompt } from './pending-prompt'
import { splitExportRows } from './export-filter'
import { createPerformCopy, createPerformPaste } from './paste'
import { offerMoveToApplications } from './move-to-applications'
import i18n, { availableLanguages } from './i18n'
import * as dynamicInserts from './dynamic-inserts'
import type {
  ThemeMode,
  PhraseType,
  DynamicPromptData,
  DynamicPromptResponse,
  ImportConfirmation,
  VaultStatus,
} from './types'
import type { LockableRow } from './services/lock'

// Handle Velopack lifecycle events FIRST - before any other code runs
VelopackApp.build()
  .onFirstRun(() => {
    import('./nsis-cleanup').then(({ uninstallLegacyNsis }) => {
      uninstallLegacyNsis()
    })
  })
  .run()

if (process.platform === 'win32') {
  app.setAppUserModelId('PhraseVault')
}

// Create licensing system for PhraseVault
const licensing = createLicenseSystem({
  prefix: 'PV-',
  // Ed25519 public key for license verification
  publicKeyHex: '42b0a284160c6c6f54d9854d0bcd9d4de84cbc50da2dccda3902b4d422410a4a',
  trialDays: 14,
  reminderStartDays: 5,
  storeName: 'phrasevault',
})

// Detect legacy honor-system users who need to migrate to cryptographic licenses
// Returns true if user has config.purchased=true but no valid cryptographic license
function shouldShowLegacyMigration(): boolean {
  const config = getConfig()
  // User claimed purchased via honor system but doesn't have a real license key
  return config.purchased === true && !licensing.store.hasValidLicense()
}

// Clear the legacy purchased flag after successful license activation
function clearLegacyPurchasedFlag(): void {
  const config = getConfig()
  if (config.purchased) {
    setConfig({ purchased: false })
    console.log('[License] Cleared legacy purchased flag after cryptographic license activation')
  }
}

class DatabaseEvents extends EventEmitter {}
const databaseEvents = new DatabaseEvents()

interface PreviousWindow {
  path: string
  getBounds(): { x: number; y: number; width: number; height: number }
  bringToTop(): void
}

let previousWindow: PreviousWindow | null = null
let mainWindow: BrowserWindow | null = null
let currentSummonShortcut: string = 'CommandOrControl+.'

function isSyntheticPasteTrusted(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

global.databaseEvents = databaseEvents
global.isQuitting = false

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

function setTheme(theme: ThemeMode): void {
  const win = getMainWindow()
  handleThemeChange(win, theme)
  if (win && win.webContents) {
    win.webContents.send('theme:set', theme)
  }
  setConfig({ theme })
}

// Note: setLanguage functionality now handled by registerI18nHandlers

// Autostart uses shared DEFAULT_AUTOSTART_ARGS from @spqrkapps/shared/main

// Enforce single instance - if another instance is running, this will quit
if (!enforceSingleInstance({
  onSecondInstance: () => {
    showFromTray()
  },
})) {
  // enforceSingleInstance() already called app.quit() - nothing more to do
  // The process will exit, so code below won't run
}

/**
 * Blocked shortcuts that would break critical system functionality
 */
const BLOCKED_SHORTCUTS = new Set([
  'Alt+Tab',
  'Alt+F4',
])

/**
 * Validates an accelerator string for use as a summon shortcut
 */
function validateShortcut(accelerator: string): { valid: boolean; error?: string } {
  // Must have at least one modifier
  const hasModifier = /CommandOrControl|Control|Ctrl|Command|Cmd|Alt|Shift/i.test(accelerator)
  if (!hasModifier) {
    return { valid: false, error: 'Shortcut must include at least one modifier (Ctrl, Alt, or Shift)' }
  }

  // Normalize for blocked check
  const normalized = accelerator
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Command/gi, 'Ctrl')
    .replace(/Cmd/gi, 'Ctrl')

  // Check against blocked shortcuts
  if (BLOCKED_SHORTCUTS.has(normalized)) {
    return { valid: false, error: 'This shortcut is reserved by the system' }
  }

  return { valid: true }
}

/**
 * Handler for the summon shortcut - shows PhraseVault window
 */
function summonHandler(): void {
  if (!isSyntheticPasteTrusted()) {
    previousWindow = null
  } else {
    const previousWindowCandidate = windowManager.getActiveWindow()
    if (previousWindowCandidate && previousWindowCandidate.path) {
      const normalizedPath = path.normalize(previousWindowCandidate.path)
      const pathParts = normalizedPath.split(path.sep)
      const filename = pathParts[pathParts.length - 1].toLowerCase()

      const isPhraseVaultExecutable =
        process.platform === 'darwin'
          ? filename === 'phrasevault' || normalizedPath.toLowerCase().includes('phrasevault.app')
          : filename === 'phrasevault.exe'
      const isLocalElectronExecutable =
        process.platform === 'darwin'
          ? normalizedPath.toLowerCase().includes(path.join('electron.app', 'contents', 'macos', 'electron'))
          : normalizedPath.toLowerCase().includes(path.join('phrasevault-electron', 'node_modules', 'electron', 'dist', 'electron.exe'))

      if (!isPhraseVaultExecutable && !isLocalElectronExecutable) {
        previousWindow = previousWindowCandidate as PreviousWindow
      }
    }
  }

  if (previousWindow) {
    const bounds = previousWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)

    let { width, height } = mainWindow!.getBounds()
    const maxWidth = display.bounds.width * 0.9
    const maxHeight = display.bounds.height * 0.9

    if (width > maxWidth) {
      width = maxWidth
    }
    if (height > maxHeight) {
      height = maxHeight
    }

    const x = display.bounds.x + (display.bounds.width - width) / 2
    const y = display.bounds.y + (display.bounds.height - height) / 2

    if (mainWindow!.isMaximized()) {
      mainWindow!.unmaximize()
    }

    mainWindow!.setBounds({ x, y, width, height })
  } else {
    if (mainWindow!.isMaximized()) {
      mainWindow!.unmaximize()
    }
    mainWindow!.center()
  }
  mainWindow!.show()
  mainWindow!.focus()
  mainWindow!.webContents.send('ui:focusSearch')
}

/**
 * Registers the summon shortcut with Electron's globalShortcut
 */
function registerSummonShortcut(accelerator: string): boolean {
  // Unregister existing shortcut first
  if (currentSummonShortcut) {
    globalShortcut.unregister(currentSummonShortcut)
  }

  const success = globalShortcut.register(accelerator, summonHandler)
  if (success) {
    currentSummonShortcut = accelerator
    console.log(`[Shortcut] Registered summon shortcut: ${accelerator}`)
  } else {
    console.error(`[Shortcut] Failed to register: ${accelerator}`)
    // Try to re-register the previous shortcut
    if (currentSummonShortcut && currentSummonShortcut !== accelerator) {
      globalShortcut.register(currentSummonShortcut, summonHandler)
    }
  }
  return success
}

app.whenReady().then(async () => {
    setupTestTimeout()

    // Register markdown handlers for modal content
    const markdownBasePath = path.join(getAppRoot(), 'templates', 'markdown')
    registerMarkdownHandlers({ basePath: markdownBasePath })

    const config = getConfig()
    let languageToUse = config.language

    // Sync autostart on first run after NSIS->Velopack migration
    syncAutostart(config.autostart, DEFAULT_AUTOSTART_ARGS)

    const launchedAtLogin = wasLaunchedAtLogin()

    if (shouldDetectInstallLanguage(languageToUse)) {
      languageToUse = resolveInstallLanguage(
        [...app.getPreferredSystemLanguages(), app.getLocale(), app.getSystemLocale()],
        availableLanguages
      )
      setConfig({ language: languageToUse })
    }

    await i18n.changeLanguage(languageToUse)

    // Before the Accessibility request, so trust lands on the moved copy.
    const relaunching = await offerMoveToApplications({
      platform: process.platform,
      isPackaged: app.isPackaged,
      launchedAtLogin,
      isInApplicationsFolder: () => app.isInApplicationsFolder(),
      declined: () => getConfig().moveToApplicationsDeclined === true,
      setDeclined: () => setConfig({ moveToApplicationsDeclined: true }),
      confirm: async () => {
        const { response, checkboxChecked } = await dialog.showMessageBox({
          type: 'question',
          buttons: [i18n.t('move_to_applications_move'), i18n.t('move_to_applications_not_now')],
          defaultId: 0,
          cancelId: 1,
          message: i18n.t('move_to_applications_title'),
          detail: i18n.t('move_to_applications_detail'),
          checkboxLabel: i18n.t('move_to_applications_dont_ask'),
        })
        return { move: response === 0, dontAskAgain: checkboxChecked }
      },
      move: (conflictHandler) => app.moveToApplicationsFolder({ conflictHandler }),
      notifyOtherCopyRunning: async () => {
        await dialog.showMessageBox({ type: 'info', message: i18n.t('move_to_applications_running') })
      },
      logError: (message, error) => console.error(message, error),
    })
    // Electron quits and relaunches from /Applications; do not start this copy.
    if (relaunching) return

    if (!launchedAtLogin) {
      windowManager.requestAccessibility()
    }

    // Initialize database AFTER language is set so example phrases use correct translations
    initDatabase()

    mainWindow = createWindow({ launchedAtLogin })
    createTray()

    // Register shared window-control handlers and the window-state publisher
    registerWindowHandlers({ getWindow: () => getMainWindow() })

    // Register shared shell handlers (shell:openExternal, showItemInFolder, openPath)
    registerShellHandlers()

    // Register shared i18n handlers for IPC-based translation
    registerI18nHandlers({
      mainWindow,
      i18next: i18n,
      setConfig: (lang) => setConfig({ language: lang }),
      availableLanguages,
      notifyChannel: 'i18n:languageChanged',
      onLanguageChanged: () => {
        const currentTray = getTray()
        if (!currentTray) return
        const isMacPlatform = process.platform === 'darwin'
        const shortcutKey = isMacPlatform ? '⌘.' : 'Ctrl+.'
        updateTrayTooltip(currentTray, i18n.t('PhraseVault is running in the background. Press {{shortcut}} to show/hide.', { shortcut: shortcutKey }))
        updateTrayMenu(currentTray, [
          {
            label: i18n.t('Show/Hide'),
            click: () => { if (mainWindow) toggleWindow(mainWindow) },
          },
          {
            label: i18n.t('Quit'),
            click: () => { global.isQuitting = true; app.quit() },
          },
        ])
      },
    })

    mainWindow.webContents.on('did-finish-load', () => {
      setTheme(config.theme)
      mainWindow!.webContents.send('i18n:languageChanged', languageToUse)

      // Show license agreement first if not accepted (skip in test mode)
      const isTestMode = process?.env?.NODE_ENV?.trim() === 'test'
      if (!isTestMode && shouldShowLicenseAgreement()) {
        mainWindow!.webContents.send('license:showAgreement')
      } else if (!isTestMode && shouldShowLegacyMigration()) {
        // Show legacy migration modal for honor-system users
        mainWindow!.webContents.send('license:showLegacyMigration')
      }
      // Purchase reminder is now pull-based (renderer calls license:shouldShowReminder)
    })

    if (process?.env?.NODE_ENV?.trim() === 'development') {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        mainWindow!.webContents.toggleDevTools()
      })
    }

    // Register summon shortcut from config
    currentSummonShortcut = config.summonShortcut || 'CommandOrControl+.'
    registerSummonShortcut(currentSummonShortcut)

    ipcMain.on('app:hideToTray', () => {
      hideToTray()
      const currentTray = getTray()
      if (currentTray && !getBalloonShown()) {
        showBackgroundNotification('PhraseVault', i18n.t('PhraseVault is running in the background.'), currentTray)
        setBalloonShown(true)
      }
      if (previousWindow) {
        previousWindow.bringToTop()
      }
    })

    // Platform-aware menu bar
    const isMac = process.platform === 'darwin'
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      // App menu (macOS only)
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                {
                  label: i18n.t('Settings') + '...',
                  accelerator: 'CmdOrCtrl+,',
                  click: () => {
                    const win = getMainWindow()
                    if (win && !win.isDestroyed()) {
                      win.webContents.send('ui:openSettings')
                    }
                  },
                },
                { type: 'separator' as const },
                { role: 'services' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      // Edit menu - use role for automatic OS localization
      { role: 'editMenu' as const },
      // Window menu (macOS only) - use role for automatic OS localization
      ...(isMac ? [{ role: 'windowMenu' as const }] : []),
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

    // macOS: re-show window when dock icon is clicked (activate is macOS-only)
    if (isMac) {
      app.on('activate', (_event, hasVisibleWindows) => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createWindow()
        } else if (mainWindow && !hasVisibleWindows) {
          showFromTray()
        }
      })
    }

    databaseEvents.on('phrases:insert', async (_event: unknown, row: MainRow | undefined) => {
      if (!row) return
      const phraseType = row.type as PhraseType
      let resolved: ResolvedBody
      try {
        resolved = await resolveForUse(row)
      } catch (error) {
        reportResolveFailure(error)
        return
      }
      let textToInsert = resolved.text

      // Step 2: Check for dynamic content (date, input, etc.)
      if (dynamicInserts.hasDynamicContent(textToInsert)) {
        const currentClipboard = await performPaste.enqueue(() => clipboard.readText())
        if (resolved.containsProtected && !isUnlocked()) {
          reportResolveFailure(new VaultError('locked'))
          return
        }
        const placeholders = dynamicInserts.parsePlaceholders(textToInsert)
        const promptable = dynamicInserts.getPromptablePlaceholders(placeholders)

        if (promptable.length > 0) {
          // Need user input - show prompt modal
          const win = getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(
              'prompt:show',
              buildPromptPayload({
                phraseId: row.id,
                phraseType,
                operation: 'insert',
                text: textToInsert,
                containsProtected: resolved.containsProtected,
                placeholders: promptable,
                clipboardContent: currentClipboard,
              })
            )
          }
          return // Wait for response via IPC
        }

        // No prompts needed - resolve auto placeholders only
        textToInsert = dynamicInserts.processPhrase(textToInsert, currentClipboard, {}, i18n.language)
      }

      if (resolved.containsProtected && !isUnlocked()) {
        reportResolveFailure(new VaultError('locked'))
        return
      }

      // Proceed with paste
      await performPaste({ id: row.id, type: phraseType }, textToInsert, () =>
        resolved.containsProtected && !isUnlocked()
      )
    })
  })

  type MainRow = LockableRow & { type: string; phrase: string }

  interface ResolvedBody {
    text: string
    /** True when the root row or any nested target was protected. */
    containsProtected: boolean
  }

  /** The three danger toasts a failed reveal can produce. */
  type ResolveFailureKey = 'vault_locked_toast' | 'vault_locked_reference' | 'vault_error_corrupt'

  class ResolveFailure extends Error {
    constructor(readonly key: ResolveFailureKey) {
      super(key)
    }
  }

  function resolveFailureKey(error: unknown, stage: 'root' | 'reference'): ResolveFailureKey {
    if (error instanceof VaultError && error.code === 'corrupt') return 'vault_error_corrupt'
    return stage === 'root' ? 'vault_locked_toast' : 'vault_locked_reference'
  }

  /**
   * Reveal a row and resolve its cross-inserts, both through revealRow. A target
   * that cannot be opened aborts the whole insert or copy: no paste, no clipboard
   * write, no usage increment, no partially resolved text.
   */
  async function resolveForUse(row: MainRow): Promise<ResolvedBody> {
    let containsProtected = row.locked === 1
    let text: string
    try {
      text = revealRow(row)
    } catch (error) {
      throw new ResolveFailure(resolveFailureKey(error, 'root'))
    }
    if (dynamicInserts.hasCrossInserts(text)) {
      const visitedIds = new Set<string>()
      if (row.short_id) visitedIds.add(row.short_id) // Prevent self-reference
      try {
        text = await dynamicInserts.resolveCrossInserts(
          text,
          getLockableRowByShortId,
          visitedIds,
          10,
          revealRow,
          () => {
            containsProtected = true
          }
        )
      } catch (error) {
        throw new ResolveFailure(resolveFailureKey(error, 'reference'))
      }
    }
    return { text, containsProtected }
  }

  function sendToast(type: 'success' | 'danger', message: string): void {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('ui:toast', { type, message })
  }

  databaseEvents.on('database:status', (statusData: boolean) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('database:status', statusData)
  })

  databaseEvents.on('ui:toast', (message: { type: string; message: string }) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('ui:toast', message)
  })

  /** Exactly one danger toast per aborted operation. */
  function reportResolveFailure(error: unknown): void {
    const key = error instanceof ResolveFailure ? error.key : 'vault_locked_toast'
    sendToast('danger', i18n.t(key))
  }

  /**
   * The placeholder array that actually crosses this wire is the parser's own
   * shape, which is what the renderer has always received here.
   */
  type PromptPlaceholders = ReturnType<typeof dynamicInserts.getPromptablePlaceholders>
  type PromptPayload = Omit<DynamicPromptData, 'placeholders'> & { placeholders: PromptPlaceholders }

  /**
   * A payload that involves a protected body carries an opaque handle instead of
   * the text, even while unlocked — the secret never reaches the renderer.
   */
  function buildPromptPayload(args: {
    phraseId: number
    phraseType: PhraseType
    operation: 'insert' | 'copy'
    text: string
    containsProtected: boolean
    placeholders: PromptPlaceholders
    clipboardContent: string
  }): PromptPayload {
    const base = {
      phraseId: args.phraseId,
      phraseType: args.phraseType,
      placeholders: args.placeholders,
      clipboardContent: args.clipboardContent,
    }
    if (!args.containsProtected) return { ...base, text: args.text }
    return {
      ...base,
      placeholders: dynamicInserts.redactProtectedPromptPlaceholders(args.placeholders),
      pendingId: holdPendingPrompt({
        phraseId: args.phraseId,
        phraseType: args.phraseType,
        operation: args.operation,
        text: args.text,
      }),
    }
  }

  /** Recover the text a prompt response refers to, honouring the handle. */
  function textForPromptResponse(
    data: DynamicPromptResponse,
    operation: 'insert' | 'copy'
  ): string | null {
    if (typeof data.pendingId === 'string') {
      return takePendingPrompt(data.pendingId, {
        phraseId: data.phraseId,
        phraseType: data.phraseType,
        operation,
      })
    }
    return typeof data.text === 'string' ? data.text : null
  }

  async function readClipboardHtml(): Promise<string> {
    try {
      const items = await clipboard.read()
      const found = items.find((item) => item.types.includes('text/html'))
      if (!found) return ''
      const payload = await found.getType('text/html')
      if (payload instanceof Blob) return payload.text()
      return ''
    } catch {
      return ''
    }
  }

  async function writeClipboardFormats(text: string, html?: string): Promise<void> {
    if (html) {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': text,
          'text/html': html,
        }),
      ])
      return
    }
    await clipboard.writeText(text)
  }

  const performPaste = createPerformPaste({
    getWindow: getMainWindow,
    canSyntheticPaste: () => isSyntheticPasteTrusted(),
    bringTargetToTop: () => {
      if (process.platform === 'darwin') {
        app.hide()
        return
      }
      previousWindow?.bringToTop()
    },
    readText: () => clipboard.readText(),
    readHtml: readClipboardHtml,
    writeText: (text) => clipboard.writeText(text),
    writeFormats: writeClipboardFormats,
    markdown: (text) => renderMarkdown(text) as string,
    paste: () => {
      // Demo catch point: log before robotjs paste (untestable via E2E)
      if (process?.env?.NODE_ENV?.trim() === 'development') {
        console.log('[DEMO-CATCH] Paste triggered:', { timestamp: new Date().toISOString() })
      }
      robot.keyTap('v', platform() === 'darwin' ? ['command'] : ['control'])
    },
    incrementUsage: (id) => {
      ipcMain.emit('phrases:incrementUsage', null, id)
    },
    notifyRecovery: () => {
      sendToast('danger', i18n.t('palette_clipboard_failed'))
    },
    notifyAccessibilityDenied: () => {
      sendToast('danger', i18n.t('palette_accessibility_denied'))
    },
    logError: (message, error) => console.error(message, error),
  })

  const performCopy = createPerformCopy(
    performPaste.enqueue,
    {
      writeText: (text) => clipboard.writeText(text),
      writeFormats: writeClipboardFormats,
      markdown: (text) => renderMarkdown(text) as string,
    },
    () => new VaultError('locked')
  )

  // Handle dynamic prompt response
  ipcMain.on('prompt:response', (_event, data: DynamicPromptResponse) => {
    const { phraseId, phraseType, values, clipboardContent } = data

    // Escape/Cancel drops the held plaintext straight away.
    if (data.cancelled) {
      clearPendingPrompt()
      return
    }

    const text = textForPromptResponse(data, 'insert')
    if (text === null) {
      // A handle that no longer matches means the session lapsed or was replaced.
      sendToast('danger', i18n.t('vault_locked_toast'))
      return
    }

    const protectedPrompt = typeof data.pendingId === 'string'
    if (protectedPrompt && !isUnlocked()) {
      sendToast('danger', i18n.t('vault_locked_toast'))
      return
    }

    const prompted = protectedPrompt
      ? dynamicInserts.remapProtectedSelectValues(text, values)
      : values
    const processedText = dynamicInserts.processPhrase(text, clipboardContent, prompted, i18n.language)

    void performPaste({ id: phraseId, type: phraseType }, processedText, () =>
      protectedPrompt && !isUnlocked()
    )
  })

  ipcMain.on('theme:get', (event) => {
    event.returnValue = getConfig().theme
  })

  ipcMain.on('config:getLanguage', (event) => {
    event.returnValue = getConfig().language || 'en'
  })

  ipcMain.on('theme:set', (_event, theme: ThemeMode) => {
    setTheme(theme)
  })

  // ===========================================================================
  // Vault (PIN lock)
  //
  // The session DEK is RAM-only in lock.ts. Nothing here reads, logs or forwards
  // a key, an envelope or a PIN; failures answer with a code the renderer maps
  // to an i18n key, never with prose.
  // ===========================================================================

  setVaultConfigAccess({
    get: () => {
      const config = getConfig()
      return {
        unlockTimeoutEnabled: config.unlockTimeoutEnabled,
        unlockTimeoutMinutes: config.unlockTimeoutMinutes,
      }
    },
    set: (next) => setConfig(next),
  })

  setVaultBroadcast((status: VaultStatus) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('vault:changed', status)
  })

  // Locking drops any placeholder text main is still holding for the renderer.
  onLock(clearPendingPrompt)

  registerVaultHandlers({
    handle: (channel, listener) => {
      ipcMain.handle(channel, listener)
    },
    getLockableRowById,
  })

  // Payload is the numeric id only. The renderer never sends a body again:
  // main reads the row and reveals it, so a locked body cannot leave this process.
  ipcMain.on('phrases:copyToClipboard', async (event, id: unknown) => {
    if (typeof id !== 'number' || !Number.isInteger(id)) return
    try {
      const row = await getLockableRowById(id)
      if (!row) {
        sendToast('danger', i18n.t('Phrase not found.'))
        return
      }
      const phraseType = row.type as PhraseType

      let resolved: ResolvedBody
      try {
        resolved = await resolveForUse(row)
      } catch (error) {
        reportResolveFailure(error)
        return
      }
      let textToCopy = resolved.text

      // Step 2: Check for dynamic content (date, input, etc.)
      if (dynamicInserts.hasDynamicContent(textToCopy)) {
        const currentClipboard = await performPaste.enqueue(() => clipboard.readText())
        if (resolved.containsProtected && !isUnlocked()) {
          reportResolveFailure(new VaultError('locked'))
          return
        }
        const placeholders = dynamicInserts.parsePlaceholders(textToCopy)
        const promptable = dynamicInserts.getPromptablePlaceholders(placeholders)

        if (promptable.length > 0) {
          // Need user input - show prompt modal for copy operation
          const win = getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(
              'prompt:showForCopy',
              buildPromptPayload({
                phraseId: row.id,
                phraseType,
                operation: 'copy',
                text: textToCopy,
                containsProtected: resolved.containsProtected,
                placeholders: promptable,
                clipboardContent: currentClipboard,
              })
            )
          }
          return // Wait for response via prompt:copyResponse IPC
        }

        // No prompts needed - resolve auto placeholders only
        textToCopy = dynamicInserts.processPhrase(textToCopy, currentClipboard, {}, i18n.language)
      }

      if (resolved.containsProtected && !isUnlocked()) {
        reportResolveFailure(new VaultError('locked'))
        return
      }

      // Proceed with copy
      await performCopy(phraseType, textToCopy, () => resolved.containsProtected && !isUnlocked())
      ipcMain.emit('phrases:incrementUsage', event, row.id)

      sendToast('success', i18n.t('Copied to clipboard'))
    } catch (error) {
      if (error instanceof VaultError && error.code === 'locked') {
        sendToast('danger', i18n.t('vault_locked_toast'))
        return
      }
      console.error('Failed to copy to clipboard:', error)
    }
  })

  ipcMain.on('phrases:copyId', async (_event, shortId: unknown) => {
    if (typeof shortId !== 'string' || !/^[a-z0-9]{7}$/i.test(shortId)) {
      sendToast('danger', i18n.t('Failed to copy'))
      return
    }
    try {
      await performCopy('text', `{{phrase:${shortId}}}`)
      sendToast('success', i18n.t('Phrase ID copied'))
    } catch (error) {
      console.error('Failed to copy phrase id:', error)
      sendToast('danger', i18n.t('Failed to copy'))
    }
  })

  // Handle dynamic prompt response for copy operation
  ipcMain.on('prompt:copyResponse', async (_event, data: DynamicPromptResponse) => {
    const { phraseId, phraseType, values, clipboardContent } = data

    if (data.cancelled) {
      clearPendingPrompt()
      return
    }

    const text = textForPromptResponse(data, 'copy')
    if (text === null) {
      sendToast('danger', i18n.t('vault_locked_toast'))
      return
    }

    const protectedPrompt = typeof data.pendingId === 'string'
    if (protectedPrompt && !isUnlocked()) {
      sendToast('danger', i18n.t('vault_locked_toast'))
      return
    }

    const prompted = protectedPrompt
      ? dynamicInserts.remapProtectedSelectValues(text, values)
      : values
    const processedText = dynamicInserts.processPhrase(text, clipboardContent, prompted, i18n.language)

    try {
      await performCopy(phraseType, processedText, () => protectedPrompt && !isUnlocked())
    } catch (error) {
      if (error instanceof VaultError && error.code === 'locked') {
        sendToast('danger', i18n.t('vault_locked_toast'))
        return
      }
      console.error('Failed to copy to clipboard:', error)
      return
    }

    // Increment usage count
    if (typeof phraseId === 'number') {
      ipcMain.emit('phrases:incrementUsage', null, phraseId)
    }

    sendToast('success', i18n.t('Copied to clipboard'))
  })

  ipcMain.on('config:get', (event) => {
    const config = getConfig()
    event.sender.send('config:init', {
      theme: config.theme || 'system',
      language: config.language || 'en',
      autostart: config.autostart ?? true,
      version: app.getVersion(),
      platform: process.platform,
      summonShortcut: config.summonShortcut || 'CommandOrControl+.',
    })
  })

  // =============================================================================
  // Shortcut IPC Handlers
  // =============================================================================

  ipcMain.on('shortcut:get', (event) => {
    event.returnValue = currentSummonShortcut
  })

  ipcMain.handle('shortcut:validate', (_event, accelerator: string) => {
    return validateShortcut(accelerator)
  })

  ipcMain.handle('shortcut:set', (_event, accelerator: string) => {
    const validation = validateShortcut(accelerator)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const success = registerSummonShortcut(accelerator)
    if (success) {
      setConfig({ summonShortcut: accelerator })
      const win = getMainWindow()
      if (win && win.webContents) {
        win.webContents.send('shortcut:changed', accelerator)
      }
      return { success: true }
    }

    return { success: false, error: 'Shortcut is already in use by another application' }
  })

  // Note: i18n:changeLanguage is handled by registerI18nHandlers

  ipcMain.on('config:setAutostart', (_event, enabled: boolean) => {
    setConfig({ autostart: enabled })
    setAutostart(enabled, DEFAULT_AUTOSTART_ARGS)
    const win = getMainWindow()
    if (win && win.webContents) {
      win.webContents.send('ui:toast', {
        type: 'success',
        message: enabled ? i18n.t('Autostart enabled') : i18n.t('Autostart disabled'),
      })
    }
  })

  ipcMain.on('database:new', async () => {
    const win = getMainWindow()
    const options: Electron.SaveDialogOptions = {
      title: i18n.t('Create New Database'),
      defaultPath: 'phrasevault.sqlite',
      buttonLabel: i18n.t('Create'),
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
    }

    try {
      const result = await dialog.showSaveDialog(win!, options)
      if (!result.canceled && result.filePath) {
        const newDbPath = result.filePath.endsWith('.sqlite')
          ? result.filePath
          : result.filePath + '.sqlite'

        // Create empty file
        fs.writeFileSync(newDbPath, '')

        // Hot-swap to new database
        const switchResult = await switchDatabase(newDbPath, true)

        if (switchResult.success) {
          addRecentFile(newDbPath)
          win?.webContents.send('database:switched')
          win?.webContents.send('ui:toast', {
            type: 'success',
            message: i18n.t('Database created successfully'),
          })
        } else {
          // Clean up failed file
          try {
            fs.unlinkSync(newDbPath)
          } catch {
            /* ignore cleanup error */
          }
          win?.webContents.send('ui:toast', {
            type: 'danger',
            message: i18n.t('Failed to create database') + ': ' + switchResult.error,
          })
        }
      }
    } catch (err) {
      console.error('Failed to create new database:', err)
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Failed to create database'),
      })
    }
  })

  ipcMain.on('database:open', async () => {
    const win = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: i18n.t('Open Database'),
      buttonLabel: i18n.t('Open'),
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
      properties: ['openFile'],
    }

    try {
      const result = await dialog.showOpenDialog(win!, options)
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]

        // Hot-swap to selected database
        const switchResult = await switchDatabase(selectedPath)

        if (switchResult.success) {
          addRecentFile(selectedPath)
          win?.webContents.send('database:switched')
          win?.webContents.send('ui:toast', {
            type: 'success',
            message: i18n.t('Database opened successfully'),
          })
        } else {
          win?.webContents.send('ui:toast', {
            type: 'danger',
            message: i18n.t('Failed to open database') + ': ' + switchResult.error,
          })
        }
      }
    } catch (err) {
      console.error('Failed to open database:', err)
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Failed to open database'),
      })
    }
  })

  ipcMain.on('database:openRecent', async (_event, filePath: string) => {
    const win = getMainWindow()

    // Verify file exists before switching
    if (!fs.existsSync(filePath)) {
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Database file not found'),
      })
      return
    }

    // Hot-swap to recent database
    const switchResult = await switchDatabase(filePath)

    if (switchResult.success) {
      addRecentFile(filePath)
      win?.webContents.send('database:switched')
      win?.webContents.send('ui:toast', {
        type: 'success',
        message: i18n.t('Database opened successfully'),
      })
    } else {
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Failed to open database') + ': ' + switchResult.error,
      })
    }
  })

  ipcMain.on('database:getRecent', (event) => {
    const config = getConfig()
    event.sender.send('database:recentList', config.recentFiles || [])
  })

  ipcMain.on('database:showInFolder', () => {
    const dbPath = getConfig().dbPath
    const win = getMainWindow()
    if (fs.existsSync(dbPath)) {
      shell.showItemInFolder(dbPath)
    } else if (fs.existsSync(path.dirname(dbPath))) {
      shell.openPath(path.dirname(dbPath))
    } else {
      if (win && win.webContents) {
        win.webContents.send('ui:toast', {
          type: 'danger',
          message: i18n.t('Neither the database file nor the folder exists.'),
        })
      }
    }
  })

  // =============================================================================
  // Import/Export IPC Handlers
  // =============================================================================

  ipcMain.on('phrases:export', async (_event, request: { mode: 'all' | 'filtered'; searchText?: string }) => {
    const win = getMainWindow()
    const { buildExportData, exportToFile } = await import('./import-export')
    const { getAllPhrases, searchPhrasesAsync } = await import('./database')

    try {
      // Get phrases based on mode
      const allRows = request.mode === 'filtered' && request.searchText
        ? await searchPhrasesAsync(request.searchText)
        : await getAllPhrases()

      // Protected rows leave the export in both modes and in both session
      // states. Ciphertext is never exported either.
      const { exportable: rows, omitted } = splitExportRows(allRows)

      if (allRows.length === 0) {
        win?.webContents.send('ui:toast', {
          type: 'warning',
          message: i18n.t('No phrases to export'),
        })
        return
      }

      // Everything selected was protected: say so rather than writing an empty file.
      if (rows.length === 0) {
        win?.webContents.send('ui:toast', {
          type: 'warning',
          message: i18n.t('vault_export_omitted', { count: omitted }),
        })
        return
      }

      // Map PhraseRow to Phrase for export
      // Normalize legacy 'plain' type to 'text'
      const phrases = rows.map(r => ({
        id: r.id,
        short_id: r.short_id,
        phrase: r.phrase,
        expanded_text: r.expanded_text,
        type: (r.type === 'plain' ? 'text' : r.type) as PhraseType,
        category_id: null,
        usage_count: r.usageCount,
        created_at: r.dateAdd,
        updated_at: r.dateLastUsed,
      }))

      const today = new Date().toISOString().split('T')[0]
      const defaultName = `phrasevault-export-${today}.json`

      const result = await dialog.showSaveDialog(win!, {
        title: i18n.t('Export Phrases'),
        defaultPath: defaultName,
        buttonLabel: i18n.t('Export'),
        filters: [
          { name: 'JSON', extensions: ['json'] },
        ],
      })

      if (result.canceled || !result.filePath) return

      const data = buildExportData(phrases)
      exportToFile(result.filePath, data)

      win?.webContents.send('ui:toast', {
        type: 'success',
        message: i18n.t('Exported {{count}} phrases', { count: phrases.length }),
      })
      if (omitted > 0) {
        win?.webContents.send('ui:toast', {
          type: 'warning',
          message: i18n.t('vault_export_omitted', { count: omitted }),
        })
      }
    } catch (err) {
      console.error('Export failed:', err)
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Export failed'),
      })
    }
  })

  ipcMain.on('phrases:importFile', async () => {
    const win = getMainWindow()
    const { analyzeImport } = await import('./import-export')

    try {
      const result = await dialog.showOpenDialog(win!, {
        title: i18n.t('Import Phrases'),
        buttonLabel: i18n.t('Import'),
        filters: [
          { name: 'All Supported', extensions: ['json', 'csv', 'yml', 'yaml'] },
          { name: 'PhraseVault JSON', extensions: ['json'] },
          { name: 'TextExpander CSV', extensions: ['csv'] },
          { name: 'Espanso YAML', extensions: ['yml', 'yaml'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) return

      const analysis = await analyzeImport(result.filePaths[0])
      win?.webContents.send('phrases:importPreview', analysis)
    } catch (err) {
      console.error('Import analysis failed:', err)
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Failed to read import file') + ': ' + (err instanceof Error ? err.message : String(err)),
      })
    }
  })

  ipcMain.on('phrases:importConfirm', async (_event, confirmation: ImportConfirmation) => {
    const win = getMainWindow()
    const { insertPhrase, updatePhraseContent, runInTransaction } = await import('./database')
    const { generateShortId } = await import('./nanoid')
    const { extractPhraseRefs } = await import('./dynamic-inserts')

    try {
      let imported = 0
      let updated = 0
      let skipped = 0

      await runInTransaction(async () => {
        // Insert new phrases
        for (const p of confirmation.newPhrases) {
          const shortId = p.short_id || generateShortId()

          // Self-reference check: skip if expanded_text references its own short_id
          const refs = extractPhraseRefs(p.expanded_text)
          if (refs.includes(shortId.toLowerCase())) {
            skipped++
            continue
          }

          await insertPhrase(p.phrase, p.expanded_text, p.type, shortId)
          imported++
        }

        // Handle conflicts based on user choices
        for (const conflict of confirmation.conflicts) {
          if (conflict.action === 'overwrite') {
            // Self-reference check: reject overwrite if expanded_text references its own short_id
            const refs = extractPhraseRefs(conflict.imported.expanded_text)
            const existingShortId = conflict.imported.short_id
            if (existingShortId && refs.includes(existingShortId.toLowerCase())) {
              skipped++
              continue
            }

            await updatePhraseContent(
              conflict.existingId,
              conflict.imported.phrase,
              conflict.imported.expanded_text,
              conflict.imported.type
            )
            updated++
          } else {
            skipped++
          }
        }
      })

      // Refresh phrase list
      win?.webContents.send('phrases:importComplete', { imported, updated, skipped })

      // Build result message
      const parts: string[] = []
      if (imported > 0) parts.push(i18n.t('{{count}} imported', { count: imported }))
      if (updated > 0) parts.push(i18n.t('{{count}} updated', { count: updated }))
      if (skipped > 0) parts.push(i18n.t('{{count}} skipped', { count: skipped }))

      win?.webContents.send('ui:toast', {
        type: 'success',
        message: parts.join(', '),
      })
    } catch (err) {
      console.error('Import failed:', err)
      win?.webContents.send('ui:toast', {
        type: 'danger',
        message: i18n.t('Import failed') + ': ' + (err instanceof Error ? err.message : String(err)),
      })
    }
  })

  // Licensing IPC handlers (cryptographic validation)
  registerLicenseHandlers({
    licensing,
    trialPrefix: 'license',
    onActivated: () => {
      clearLegacyPurchasedFlag()
    },
  })

  // Get full license status (for Settings UI)
  ipcMain.handle('license:getStatus', () => {
    const license = licensing.store.getLicense()
    const trial = licensing.trial.getTrialStatus()
    return {
      hasLicense: licensing.store.hasValidLicense(),
      license: license,
      trial: trial,
      isLegacyUser: shouldShowLegacyMigration(),
    }
  })


  ipcMain.on('license:accept', () => {
    acceptLicenseAgreement()
    // Purchase reminder check is now pull-based (renderer handles it)
  })

  ipcMain.on('license:decline', () => {
    app.quit()
  })


// Handle system-initiated quit (macOS shutdown, Cmd+Q, etc.)
app.on('before-quit', () => {
  global.isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
