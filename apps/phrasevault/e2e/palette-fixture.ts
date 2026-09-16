/**
 * Disposable P0 palette fixture.
 *
 * Launches PhraseVault through e2e/palette-bootstrap.cjs so every test owns a fresh
 * userData directory, and exposes the bootstrap's recorded IPC calls to the spec.
 */
import * as path from 'node:path'
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElectronTest, expect, waitForAppReady } from '@spqrkapps/shared/e2e'
import type { ElectronApplication, Page } from '@spqrkapps/shared/e2e'
import type { PhraseRow, SettingsData } from '../src/types'

declare global {
  // eslint-disable-next-line no-var
  var __pvP0: {
    calls: Array<{ channel: string; data: unknown }>
    searchCount: number
    finishedSearches: number
    holdSearch: boolean
    failNextSearch: boolean
    passThroughInsert: boolean
    failClipboardWrite: boolean
    userData: string
    releaseAll(): void
    cloneDatabase(): Promise<string>
    brokenDatabase(): string
  }
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function createPaletteTest() {
  copyFileSync(path.join(appDir, 'e2e/palette-bootstrap.cjs'),
    path.join(appDir, 'dist/palette-p0-bootstrap.cjs'))
  return createElectronTest({
    appDir, appName: 'PhraseVault', mainScript: 'palette-p0-bootstrap.cjs',
  })
}

export async function calls(electronApp: ElectronApplication, channel: string) {
  return electronApp.evaluate((_electron, wanted) =>
    globalThis.__pvP0.calls.filter(call => call.channel === wanted), channel)
}

export async function seedPalette(electronApp: ElectronApplication, window: Page): Promise<void> {
  await waitForAppReady(window)
  await window.evaluate(() => window.api.invoke('i18n:changeLanguage', 'en'))
  await expect.poll(() => window.evaluate(async () => {
    try { return (await window.api.invoke<PhraseRow[]>('phrases:search', '')).length }
    catch { return -1 }
  })).toBeGreaterThan(0)
  await window.evaluate(async () => {
    const rows = await window.api.invoke<PhraseRow[]>('phrases:search', '')
    for (const row of rows) {
      await new Promise<void>(resolve => {
        window.api.receiveOnce('phrases:deleted', () => resolve())
        window.api.send('phrases:delete', row.id)
      })
    }
    for (const [newPhrase, newExpandedText] of [
      ['sig', 'Best regards, Alex'], ['signature formal', 'Kind regards, Alex'],
    ]) {
      await new Promise<void>(resolve => {
        window.api.receiveOnce('phrases:added', () => resolve())
        window.api.send('phrases:add', { newPhrase, newExpandedText, type: 'text' })
      })
    }
    const saved = await window.api.invoke<PhraseRow[]>('phrases:search', 'signature formal')
    window.api.send('phrases:incrementUsage', saved[0].id)
  })
  await expect.poll(() => window.evaluate(async () => {
    const rows = await window.api.invoke<PhraseRow[]>('phrases:search', 'signature formal')
    return rows[0].usageCount
  })).toBe(1)
  await window.locator('#search').fill('')
  await window.locator('#search-btn').click()
  await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
  await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(2)
  // Seeding raises real "Phrase added successfully." toasts. Let them expire so a
  // later toast assertion observes the toast under test, not a seeding leftover.
  await expect(window.locator('.toast-container .toast')).toHaveCount(0, { timeout: 12000 })
  await electronApp.evaluate(() => { globalThis.__pvP0.calls.length = 0 })
}

// =============================================================================
// Phase 2 chrome probe
//
// Controls the existing licensing IPC responses and external actions inside the
// disposable Electron process, so Settings layout/action tests never need a real
// key, a purchase, or a manufactured DOM state.
// =============================================================================

export interface ChromeLicenseStatus {
  hasLicense: boolean
  license: { payload?: { email?: string; id?: string } } | null
  trial: { active: boolean; daysRemaining: number; expired: boolean }
  isLegacyUser: boolean
}

export interface ChromeProbe {
  calls: Array<{ channel: string; data: unknown }>
  license: ChromeLicenseStatus
  activation: { success: boolean; error?: string }
  // Held license replies. A test can strand an activation, deactivation or
  // status read, drive Settings through close/reopen, and release the old reply
  // afterwards to observe who owns the completion.
  holdActivation: boolean
  activationReplies: Array<() => void>
  holdDeactivation: boolean
  deactivationReplies: Array<() => void>
  holdStatus: boolean
  statusReplies: Array<(status: ChromeLicenseStatus) => void>
  preferences?: PreferenceProbe
}

declare global {
  // eslint-disable-next-line no-var
  var __pvChrome: ChromeProbe
}

export const expiredLicense: ChromeLicenseStatus = {
  hasLicense: false, license: null, isLegacyUser: false,
  trial: { active: false, daysRemaining: 0, expired: true },
}

export async function installChromeProbe(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, license) => {
    const probe: ChromeProbe = {
      calls: [], license, activation: { success: false, error: 'Invalid license key' },
      holdActivation: false, activationReplies: [],
      holdDeactivation: false, deactivationReplies: [],
      holdStatus: false, statusReplies: [],
    }
    globalThis.__pvChrome = probe
    for (const channel of ['license:getStatus', 'license:activate', 'license:deactivate',
      'license:markReminderShown']) ipcMain.removeHandler(channel)
    ipcMain.handle('license:getStatus', async () => {
      // A held status read is answered with whatever the test releases, so two
      // in-flight reads can be resolved out of order.
      if (!probe.holdStatus) return probe.license
      return new Promise<ChromeLicenseStatus>(resolve => probe.statusReplies.push(resolve))
    })
    ipcMain.handle('license:activate', async (_event, key: string) => {
      probe.calls.push({ channel: 'license:activate', data: key })
      // The outcome is fixed when the call arrives, so a reply released later
      // still carries the result the test configured for that click.
      const result = probe.activation
      if (probe.holdActivation) {
        await new Promise<void>(resolve => probe.activationReplies.push(resolve))
      }
      if (result.success) probe.license = {
        ...probe.license, hasLicense: true,
        license: { payload: { email: 'fixture@example.test', id: 'fixture-license' } },
      }
      return result
    })
    ipcMain.handle('license:deactivate', async () => {
      probe.calls.push({ channel: 'license:deactivate', data: null })
      if (probe.holdDeactivation) {
        await new Promise<void>(resolve => probe.deactivationReplies.push(resolve))
      }
      probe.license = { ...probe.license, hasLicense: false, license: null }
      return { success: true }
    })
    ipcMain.handle('license:markReminderShown', () => {
      probe.calls.push({ channel: 'license:markReminderShown', data: null })
    })
    ipcMain.removeAllListeners('shell:openExternal')
    ipcMain.on('shell:openExternal', (_event, url: string) => {
      probe.calls.push({ channel: 'shell:openExternal', data: url })
    })
  }, expiredLicense)
}

export async function chromeCalls(electronApp: ElectronApplication, channel: string) {
  return electronApp.evaluate((_electron, wanted) =>
    globalThis.__pvChrome.calls.filter(call => call.channel === wanted), channel)
}

// =============================================================================
// Preference probe
//
// Intercepts only the existing main-process preference ports inside the
// disposable process, so renderer draft/preview/Save ordering can be observed
// with controlled Promises instead of sleeps. It never replaces a renderer
// function or writes a real OS startup entry or global shortcut.
// =============================================================================

export interface PreferenceProbe {
  committed: SettingsData
  holdConfig: boolean
  configReplies: Array<() => void>
  holdValidation: boolean
  validationReplies: Array<(result: { valid: boolean; error?: string }) => void>
  holdRegistration: boolean
  registrationReplies: Array<(result: { success: boolean; error?: string }) => void>
  registrationResult: { success: boolean; error?: string }
  rejectLanguage: boolean
}

export async function installSettingsProbe(
  electronApp: ElectronApplication, window: Page
): Promise<void> {
  const initial = await window.evaluate(() => new Promise<SettingsData>(resolve => {
    window.api.receiveOnce('config:init', value => resolve(value as SettingsData))
    window.api.send('config:get')
  }))
  await electronApp.evaluate(({ ipcMain, BrowserWindow }, initial) => {
    const probe = globalThis.__pvChrome
    const state: PreferenceProbe = {
      committed: initial, holdConfig: false, configReplies: [],
      holdValidation: false, validationReplies: [],
      holdRegistration: false, registrationReplies: [],
      registrationResult: { success: true }, rejectLanguage: false,
    }
    probe.preferences = state
    const web = BrowserWindow.getAllWindows()[0].webContents
    const record = (channel: string, data: unknown): void => {
      probe.calls.push({ channel, data })
    }
    for (const channel of ['theme:get', 'theme:set', 'config:getLanguage', 'config:get',
      'config:setAutostart', 'shortcut:get']) ipcMain.removeAllListeners(channel)
    for (const channel of ['shortcut:validate', 'shortcut:set', 'i18n:changeLanguage']) {
      ipcMain.removeHandler(channel)
    }
    ipcMain.on('theme:get', event => { event.returnValue = state.committed.theme })
    ipcMain.on('config:getLanguage', event => { event.returnValue = state.committed.language })
    ipcMain.on('shortcut:get', event => { event.returnValue = state.committed.summonShortcut })
    ipcMain.on('config:get', () => {
      record('config:get', null)
      const snapshot = { ...state.committed }
      const reply = (): void => { web.send('config:init', snapshot) }
      if (state.holdConfig) state.configReplies.push(reply)
      else reply()
    })
    ipcMain.on('theme:set', (_event, mode: SettingsData['theme']) => {
      record('theme:set', mode)
      state.committed.theme = mode
      web.send('theme:set', mode)
    })
    ipcMain.on('config:setAutostart', (_event, enabled: boolean) => {
      record('config:setAutostart', enabled)
      state.committed.autostart = enabled
    })
    ipcMain.handle('shortcut:validate', async (_event, accelerator: string) => {
      record('shortcut:validate', accelerator)
      if (!state.holdValidation) return { valid: true }
      return new Promise<{ valid: boolean; error?: string }>(
        resolve => state.validationReplies.push(resolve))
    })
    ipcMain.handle('shortcut:set', async (_event, accelerator: string) => {
      record('shortcut:set', accelerator)
      const result = state.holdRegistration
        ? await new Promise<{ success: boolean; error?: string }>(
          resolve => state.registrationReplies.push(resolve))
        : state.registrationResult
      if (result.success) {
        state.committed.summonShortcut = accelerator
        web.send('shortcut:changed', accelerator)
      }
      return result
    })
    ipcMain.handle('i18n:changeLanguage', (_event, language: string) => {
      record('i18n:changeLanguage', language)
      if (state.rejectLanguage) throw new Error('Injected language failure')
      state.committed.language = language
      web.send('i18n:languageChanged', language)
      return true
    })
    probe.calls.length = 0
  }, initial)
}

// =============================================================================
// Deferred phrases:search control
//
// Replaces only the existing phrases:search handler inside the disposable
// process, so a spec can hold and release individual reads and observe which
// reply a completion belongs to. Every search, including the palette's own
// refreshes, is queued: resolve each one explicitly.
// =============================================================================

export interface PickerProbe {
  queries: string[]
  replies: Array<{
    resolve: (rows: PhraseRow[]) => void
    reject: (error: Error) => void
  }>
}

declare global {
  // eslint-disable-next-line no-var
  var __pvPicker: PickerProbe
}

export async function installPickerProbe(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    globalThis.__pvPicker = { queries: [], replies: [] }
    ipcMain.removeHandler('phrases:search')
    ipcMain.handle('phrases:search', (_event, query: string) => {
      globalThis.__pvPicker.queries.push(query)
      return new Promise<PhraseRow[]>((resolve, reject) => {
        globalThis.__pvPicker.replies.push({ resolve, reject })
      })
    })
  })
}

/** Number of held reads so far. */
export async function pickerRequests(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(() => globalThis.__pvPicker.replies.length)
}

export async function pickerQueries(electronApp: ElectronApplication): Promise<string[]> {
  return electronApp.evaluate(() => [...globalThis.__pvPicker.queries])
}

/** Resolve one held read by index with an exact row list. */
export async function resolvePicker(
  electronApp: ElectronApplication, index: number, rows: PhraseRow[]
): Promise<void> {
  await electronApp.evaluate(({}, payload) => {
    globalThis.__pvPicker.replies[payload.index].resolve(payload.rows)
  }, { index, rows })
}

export async function rejectPicker(
  electronApp: ElectronApplication, index: number
): Promise<void> {
  await electronApp.evaluate(({}, index) => {
    globalThis.__pvPicker.replies[index].reject(new Error('Injected search failure'))
  }, index)
}

/**
 * Overflow rows for the maximum-scroll last-row gate only. The named chrome and
 * Create states keep the two-row fixture.
 */
export async function seedOverflow(window: Page, count = 40): Promise<void> {
  await window.evaluate(async count => {
    for (let index = 0; index < count; index++) {
      await new Promise<void>(resolve => {
        window.api.receiveOnce('phrases:added', () => resolve())
        window.api.send('phrases:add', {
          newPhrase: 'overflow ' + String(index).padStart(2, '0'),
          newExpandedText: 'Last-row readability fixture ' + index,
          type: 'text',
        })
      })
    }
  }, count)
  await window.locator('#search').fill('')
  await window.locator('#search-btn').click()
  await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
  await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(count + 2)
  await expect(window.locator('.toast-container .toast')).toHaveCount(0, { timeout: 12000 })
}
