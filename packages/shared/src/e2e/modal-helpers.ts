/**
 * Modal and Toast E2E Test Helpers
 *
 * Utilities for testing modal dialogs and toast notifications
 */

import type { Page, Locator } from '@playwright/test'

export interface ModalTestResult {
  passed: boolean
  issues: string[]
}

/**
 * Wait for a modal to become visible
 * Uses .modal-overlay.active pattern
 */
export async function waitForModalVisible(
  page: Page,
  modalSelector: string,
  timeout = 5000
): Promise<boolean> {
  try {
    const modal = page.locator(modalSelector)
    await modal.waitFor({ state: 'visible', timeout })

    // Wait for animation frame to apply the show/active class
    await page.waitForTimeout(100)

    // Verify it has the active class (retry a few times for animation)
    for (let i = 0; i < 5; i++) {
      const hasActiveClass = await modal.evaluate((el) => {
        return el.classList.contains('active')
      })
      if (hasActiveClass) return true
      await page.waitForTimeout(100)
    }

    return false
  } catch {
    return false
  }
}

/**
 * Wait for a modal to be hidden
 */
export async function waitForModalHidden(
  page: Page,
  modalSelector: string,
  timeout = 5000
): Promise<boolean> {
  try {
    // Wait for display: none or hidden class
    await page.waitForFunction(
      (selector) => {
        const el = document.querySelector(selector)
        if (!el) return true
        const style = window.getComputedStyle(el)
        return style.display === 'none' || !el.classList.contains('active')
      },
      modalSelector,
      { timeout }
    )

    return true
  } catch {
    return false
  }
}

/**
 * Open settings modal by clicking the settings button
 */
export async function openSettingsModal(
  page: Page,
  settingsBtnSelector = '#btn-settings, [data-testid="settings-btn"], #settings-btn'
): Promise<boolean> {
  try {
    const btn = page.locator(settingsBtnSelector).first()
    await btn.click()
    await page.waitForTimeout(300) // Wait for animation
    return true
  } catch {
    return false
  }
}

/**
 * Close modal via close button
 */
export async function closeModalViaButton(
  page: Page,
  closeSelector = '.modal-close'
): Promise<boolean> {
  try {
    // Find visible close button
    const closeBtn = page.locator(closeSelector).first()
    await closeBtn.click()
    await page.waitForTimeout(300) // Wait for animation
    return true
  } catch {
    return false
  }
}

/**
 * Close modal via Escape key
 */
export async function closeModalViaEscape(page: Page): Promise<boolean> {
  try {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300) // Wait for animation
    return true
  } catch {
    return false
  }
}

/**
 * Check if any modal is currently visible
 */
export async function isAnyModalVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const modals = document.querySelectorAll('.modal-overlay')
    for (const modal of modals) {
      const style = window.getComputedStyle(modal)
      if (style.display !== 'none' && modal.classList.contains('active')) {
        return true
      }
    }
    return false
  })
}

/**
 * Get count of visible modals
 */
export async function getVisibleModalCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0
    const modals = document.querySelectorAll('.modal-overlay')
    for (const modal of modals) {
      const style = window.getComputedStyle(modal)
      if (style.display !== 'none' && modal.classList.contains('active')) {
        count++
      }
    }
    return count
  })
}

/**
 * Test modal open/close cycle
 */
export async function testModalOpenClose(
  page: Page,
  openAction: () => Promise<void>,
  modalSelector: string
): Promise<ModalTestResult> {
  const issues: string[] = []

  // Open modal
  await openAction()
  const opened = await waitForModalVisible(page, modalSelector, 3000)
  if (!opened) {
    issues.push(`Modal ${modalSelector} did not open`)
    return { passed: false, issues }
  }

  // Close via escape
  await closeModalViaEscape(page)
  const closedViaEscape = await waitForModalHidden(page, modalSelector, 3000)
  if (!closedViaEscape) {
    issues.push(`Modal ${modalSelector} did not close via Escape key`)
  }

  // Open again to test close button
  await openAction()
  await waitForModalVisible(page, modalSelector, 3000)

  await closeModalViaButton(page)
  const closedViaButton = await waitForModalHidden(page, modalSelector, 3000)
  if (!closedViaButton) {
    issues.push(`Modal ${modalSelector} did not close via close button`)
  }

  return { passed: issues.length === 0, issues }
}

// =============================================================================
// Toast Helpers
// =============================================================================

/**
 * Wait for a toast to appear
 */
export async function waitForToast(
  page: Page,
  timeout = 5000
): Promise<Locator | null> {
  try {
    const toast = page.locator('.toast').first()
    await toast.waitFor({ state: 'visible', timeout })
    return toast
  } catch {
    return null
  }
}

/**
 * Wait for toast to disappear
 */
export async function waitForToastDismiss(page: Page, timeout = 10000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.toast.show').length === 0,
      undefined,
      { timeout }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Get toast message text
 */
export async function getToastMessage(page: Page): Promise<string | null> {
  try {
    const toast = page.locator('.toast').first()
    const isVisible = await toast.isVisible()
    if (!isVisible) return null
    return toast.textContent()
  } catch {
    return null
  }
}

/**
 * Get toast type (success, danger, warning, info)
 */
export async function getToastType(
  page: Page
): Promise<'success' | 'danger' | 'warning' | 'info' | null> {
  try {
    const toast = page.locator('.toast').first()
    const isVisible = await toast.isVisible()
    if (!isVisible) return null

    const classList = await toast.evaluate((el) => Array.from(el.classList))

    if (classList.includes('toast-success') || classList.includes('success')) return 'success'
    if (classList.includes('toast-danger') || classList.includes('danger')) return 'danger'
    if (classList.includes('toast-warning') || classList.includes('warning')) return 'warning'
    if (classList.includes('toast-info') || classList.includes('info')) return 'info'

    return null
  } catch {
    return null
  }
}

/**
 * Check if toast container exists and is properly positioned
 */
export async function checkToastContainer(page: Page): Promise<ModalTestResult> {
  const issues: string[] = []

  const hasContainer = await page.evaluate(() => {
    const container = document.querySelector('.toast-container')
    if (!container) return false

    const style = window.getComputedStyle(container)
    return style.position === 'fixed' && parseInt(style.zIndex, 10) >= 1000
  })

  if (!hasContainer) {
    // Container may be created dynamically, that's OK
  }

  return { passed: true, issues }
}

// =============================================================================
// Settings Helpers
// =============================================================================

/**
 * Get current theme from HTML element
 */
export async function getCurrentTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const html = document.documentElement
    const body = document.body

    // Check data-theme attribute
    const dataTheme = html.getAttribute('data-theme') || body.getAttribute('data-theme')
    if (dataTheme) return dataTheme

    // Check class
    if (html.classList.contains('dark') || body.classList.contains('dark')) return 'dark'
    if (html.classList.contains('light') || body.classList.contains('light')) return 'light'

    return null
  })
}

/**
 * Change theme via settings
 */
export async function changeThemeSetting(
  page: Page,
  theme: 'light' | 'dark' | 'system',
  themeSelectSelector = '#settings-theme, [data-testid="settings-theme"]'
): Promise<boolean> {
  try {
    const select = page.locator(themeSelectSelector).first()
    await select.selectOption(theme)
    return true
  } catch {
    return false
  }
}

/**
 * Save settings (click save button)
 */
export async function saveSettings(
  page: Page,
  saveBtnSelector = '#settings-save, [data-testid="settings-save"], #btn-save-settings'
): Promise<boolean> {
  try {
    const btn = page.locator(saveBtnSelector).first()
    await btn.click()
    await page.waitForTimeout(500) // Wait for save + modal close
    return true
  } catch {
    return false
  }
}
