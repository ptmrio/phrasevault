/**
 * Shared E2E test utilities
 */

import { expect, type Page, type ElectronApplication } from '@playwright/test'

/**
 * Wait for an element to be visible with custom timeout
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<boolean> {
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

/**
 * Get app version from Electron main process
 */
export async function getAppVersion(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ app }) => app.getVersion())
}

/**
 * Get app name from Electron main process
 */
export async function getAppName(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ app }) => app.getName())
}

/**
 * Get app path from Electron main process
 */
export async function getAppPath(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(async ({ app }) => app.getAppPath())
}

/**
 * Check if app is packaged
 */
export async function isPackaged(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(async ({ app }) => app.isPackaged)
}

/**
 * Get window bounds
 */
export async function getWindowBounds(
  electronApp: ElectronApplication,
  page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const browserWindow = await electronApp.browserWindow(page)
  return browserWindow.evaluate((bw) => bw.getBounds())
}

/**
 * Check if window is maximized
 */
export async function isWindowMaximized(
  electronApp: ElectronApplication,
  page: Page
): Promise<boolean> {
  const browserWindow = await electronApp.browserWindow(page)
  return browserWindow.evaluate((bw) => bw.isMaximized())
}

/**
 * Check if window is visible
 */
export async function isWindowVisible(
  electronApp: ElectronApplication,
  page: Page
): Promise<boolean> {
  const browserWindow = await electronApp.browserWindow(page)
  return browserWindow.evaluate((bw) => bw.isVisible())
}

/**
 * Take a screenshot with a standardized name
 */
export async function takeScreenshot(
  page: Page,
  name: string,
  options?: { fullPage?: boolean }
): Promise<Buffer> {
  return page.screenshot({
    path: `screenshots/${name}.png`,
    fullPage: options?.fullPage ?? false,
  })
}

/**
 * Common UI element selectors used across apps
 */
export const CommonSelectors = {
  // Title bar (apps use .titlebar, legacy used .title-bar)
  titleBar: '.titlebar, .title-bar, [data-testid="title-bar"]',
  minimizeBtn: '#btn-minimize, [data-testid="minimize-btn"]',
  maximizeBtn: '#btn-maximize, [data-testid="maximize-btn"]',
  closeBtn: '#btn-close, [data-testid="close-btn"]',

  // Modals
  modal: '.modal-overlay',
  modalContent: '.modal-body',
  modalClose: '.modal-close, [data-testid="modal-close"]',

  // Settings (apps use #modal-settings, legacy used #settings-modal)
  settingsBtn: '#btn-settings, [data-testid="settings-btn"]',
  settingsModal: '#modal-settings, #settings-modal, [data-testid="settings-modal"]',

  // Theme
  themeToggle: '#theme-toggle, [data-testid="theme-toggle"]',

  // License
  licenseBtn: '#btn-license, [data-testid="license-btn"]',
  licenseModal: '#license-modal, [data-testid="license-modal"]',

  // Toast
  toast: '.toast, [data-testid="toast"]',
}

/**
 * Wait for app to be fully initialized
 * Waits for common indicators that the app is ready
 */
export async function waitForAppReady(page: Page, timeout = 10000): Promise<void> {
  // Wait for body to be visible
  await page.locator('body').waitFor({ state: 'visible', timeout })

  // Wait for any loading indicators to disappear
  const loadingIndicator = page.locator('.loading, [data-loading="true"]')
  const hasLoading = await loadingIndicator.count()
  if (hasLoading > 0) {
    await loadingIndicator.waitFor({ state: 'hidden', timeout })
  }

  // Small delay to ensure JS initialization
  await page.waitForTimeout(500)
}

/**
 * Single-launch hello-world: process, first window, title, preload bridge, no Node in renderer.
 * Fails if contextIsolation is off (require leaks) or preload did not expose window.api.
 */
export async function assertHelloWorld(
  page: Page,
  electronApp: ElectronApplication,
  title: RegExp,
): Promise<void> {
  expect(electronApp.process()?.pid).toBeTruthy()
  await waitForAppReady(page)
  await expect(page.locator('body')).toBeVisible()
  await expect(page).toHaveTitle(title)
  const probe = await page.evaluate(() => {
    const w = window as Window & { api?: { invoke?: unknown }; require?: unknown }
    return {
      hasInvoke: typeof w.api?.invoke === 'function',
      requireType: typeof w.require,
    }
  })
  expect(probe.hasInvoke).toBe(true)
  expect(probe.requireType).toBe('undefined')

  const prefs = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const last = (
      win.webContents as Electron.WebContents & {
        getLastWebPreferences?: () => Electron.WebPreferences
      }
    ).getLastWebPreferences?.()
    if (!last) return null
    return {
      contextIsolation: last.contextIsolation,
      nodeIntegration: last.nodeIntegration,
    }
  })
  expect(prefs).toBeTruthy()
  expect(prefs?.contextIsolation).toBe(true)
  expect(prefs?.nodeIntegration).toBe(false)
}
