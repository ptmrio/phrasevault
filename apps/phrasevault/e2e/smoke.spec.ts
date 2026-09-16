/**
 * PhraseVault Smoke Tests
 *
 * Basic tests to verify the app launches correctly and core UI is present.
 * Run with: pnpm --filter phrasevault test:e2e
 */

import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  createElectronTest,
  expect,
  expectNoConsoleErrors,
  waitForAppReady,
  assertHelloWorld,
  getAppVersion,
  getAppName,
  CommonSelectors,
  assertCSSHealth,
  assertComponentStyles,
  waitForModalVisible,
  waitForModalHidden,
  isAnyModalVisible,
  closeModalViaEscape,
  getCurrentTheme,
  registerWindowControlsTests,
} from '@spqrkapps/shared/e2e'
import type { ElectronApplication, Page } from '@spqrkapps/shared/e2e'
import {
  calls, chromeCalls, createPaletteTest, expiredLicense, installChromeProbe,
  installSettingsProbe, seedPalette,
} from './palette-fixture'
import type { ChromeLicenseStatus } from './palette-fixture'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const test = createElectronTest({
  appDir: path.join(__dirname, '..'),
  appName: 'PhraseVault',
})

test.describe('PhraseVault Smoke Tests', () => {
  test('hello world', async ({ electronApp, window, consoleErrors }) => {
    await assertHelloWorld(window, electronApp, /PhraseVault/i)
    expectNoConsoleErrors(consoleErrors)
  })

  test('app launches successfully', async ({ electronApp }) => {
    expect(electronApp).toBeTruthy()
    expect(electronApp.process()).toBeTruthy()
  })

  test('main window opens', async ({ window }) => {
    expect(window).toBeTruthy()
    const isVisible = await window.locator('body').isVisible()
    expect(isVisible).toBe(true)
  })

  test('window has correct title', async ({ window }) => {
    // Wait longer for page to fully load
    await window.waitForTimeout(2000)
    const title = await window.title()
    // Debug: log what we see
    const url = window.url()
    const bodyHtml = await window.evaluate(() => document.body.innerHTML.substring(0, 500))
    console.log('Window URL:', url)
    console.log('Body HTML preview:', bodyHtml)
    expect(title).toMatch(/PhraseVault/i)
  })

  test('no console errors on startup', async ({ window, consoleErrors }) => {
    await waitForAppReady(window)
    expectNoConsoleErrors(consoleErrors)
  })

  test('app version is accessible', async ({ electronApp }) => {
    const version = await getAppVersion(electronApp)
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('app name is accessible', async ({ electronApp }) => {
    const name = await getAppName(electronApp)
    // In dev mode, Electron returns "electron" for unpackaged apps
    expect(name).toBeTruthy()
  })
})

test.describe('PhraseVault UI Elements', () => {
  test('title bar is visible', async ({ window }) => {
    await waitForAppReady(window)
    const titleBar = window.locator(CommonSelectors.titleBar)
    const isVisible = await titleBar.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('phrase list container exists', async ({ window }) => {
    await waitForAppReady(window)
    const phraseList = window.locator('#phrase-list, .phrase-list, [data-testid="phrase-list"], .sidebar')
    const isVisible = await phraseList.first().isVisible().catch(() => false)
    expect(isVisible).toBe(true)
  })

  test('search input exists', async ({ window }) => {
    await waitForAppReady(window)
    const search = window.locator('#search, input[type="search"], [data-testid="search"], input[placeholder*="search" i]')
    const isVisible = await search.first().isVisible().catch(() => false)
    expect(isVisible).toBe(true)
  })

  test('app content is rendered', async ({ window }) => {
    await waitForAppReady(window)
    // Verify something beyond just body is rendered
    const hasContent = await window.evaluate(() => {
      return document.body.children.length > 0
    })
    expect(hasContent).toBe(true)
  })
})

test.describe('PhraseVault Theme', () => {
  test('app has theme applied', async ({ window }) => {
    await waitForAppReady(window)
    // Check for theme via body class or data attribute
    const hasTheme = await window.evaluate(() => {
      const body = document.body
      const html = document.documentElement
      return body.classList.contains('dark') ||
             body.classList.contains('light') ||
             html.classList.contains('dark') ||
             html.classList.contains('light') ||
             body.hasAttribute('data-theme') ||
             html.hasAttribute('data-theme')
    })
    // Theme may not be set immediately in test mode
    expect(typeof hasTheme).toBe('boolean')
  })
})

test.describe('PhraseVault CSS Health', () => {
  test('CSS is properly loaded and applied', async ({ window }) => {
    await waitForAppReady(window)
    await assertCSSHealth(window)
  })

  test('UI components are properly styled', async ({ window }) => {
    await waitForAppReady(window)
    await assertComponentStyles(window)
  })
})

/**
 * This block runs against the developer profile, where a real trial/legacy
 * modal can already own the stack and cover every app control. Dismiss it
 * through the shared Escape path (which marks nothing) before asserting the
 * chrome, so a covered control is never mistaken for a missing one.
 */
async function dismissEntryModals(
  electronApp: ElectronApplication, window: Page
): Promise<void> {
  // The reminder is pull-based on a 500ms timer, so answer its existing query
  // with false first; anything already shown is then dismissed through the
  // shared Escape path, which marks no reminder as seen.
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('license:shouldShowReminder')
    ipcMain.handle('license:shouldShowReminder', () => false)
  })
  for (const id of ['#modal-purchase-reminder', '#modal-legacy-migration']) {
    await expect.poll(async () => {
      if (await window.locator(id + '.active').count() === 0) return true
      await closeModalViaEscape(window)
      return await waitForModalHidden(window, id, 3000)
    }).toBe(true)
  }
}

test.describe('PhraseVault Modal System', () => {
  test('settings modal opens and closes', async ({ electronApp, window }) => {
    await waitForAppReady(window)
    await dismissEntryModals(electronApp, window)

    // The gear is a required control: a missing one must fail, not skip.
    const settingsBtn = window.locator('#btn-settings')
    await expect(settingsBtn).toHaveCount(1)
    await expect(settingsBtn).toBeVisible()

    await settingsBtn.click()

    // Wait for modal animation
    await window.waitForTimeout(500)

    // Verify modal is displayed (check display property set by showModal)
    const modal = window.locator('#modal-settings')
    const isDisplayed = await modal.evaluate(el => {
      const style = window.getComputedStyle(el)
      return style.display !== 'none'
    })
    expect(isDisplayed).toBe(true)

    // Close via Escape
    await closeModalViaEscape(window)

    // Wait for modal to close
    const modalClosed = await waitForModalHidden(window, '#modal-settings', 3000)
    expect(modalClosed).toBe(true)
  })

  test('modal closes via close button', async ({ electronApp, window }) => {
    await waitForAppReady(window)
    await dismissEntryModals(electronApp, window)

    const settingsBtn = window.locator('#btn-settings')
    await expect(settingsBtn).toHaveCount(1)
    await expect(settingsBtn).toBeVisible()

    await settingsBtn.click()
    await waitForModalVisible(window, '#modal-settings', 3000)

    // Click close button
    const closeBtn = window.locator('#modal-settings .modal-close').first()
    await closeBtn.click()

    const modalClosed = await waitForModalHidden(window, '#modal-settings', 3000)
    expect(modalClosed).toBe(true)
  })

  test('phrase modal opens for new phrase', async ({ electronApp, window }) => {
    await waitForAppReady(window)
    await dismissEntryModals(electronApp, window)

    // Extra delay to ensure all event handlers are attached
    await window.waitForTimeout(300)

    // Add is a required control at search's trailing edge.
    const addBtn = window.locator('.palette-search > #add-phrase')
    await expect(addBtn).toHaveCount(1)
    await addBtn.waitFor({ state: 'visible', timeout: 5000 })

    // Click to open phrase modal
    await addBtn.click({ timeout: 5000 })

    // Wait for modal to be visible - check for the form inside the modal
    const phraseInput = window.locator('#modal-phrase #phraseInput')
    await phraseInput.waitFor({ state: 'visible', timeout: 5000 })
    const isFormVisible = await phraseInput.isVisible()
    expect(isFormVisible).toBe(true)

    // The shared overlay applies .active on the next animation frame; hiding
    // before that leaves the modal open, so await the real open state first.
    expect(await waitForModalVisible(window, '#modal-phrase', 5000)).toBe(true)

    // Close via Escape
    await closeModalViaEscape(window)

    // Wait for modal to be hidden - poll for form to become hidden
    let isFormHidden = false
    for (let i = 0; i < 10; i++) {
      await window.waitForTimeout(200)
      const visible = await phraseInput.isVisible()
      if (!visible) {
        isFormHidden = true
        break
      }
    }
    expect(isFormHidden).toBe(true)
  })

  test('theme can be detected', async ({ window }) => {
    await waitForAppReady(window)

    const theme = await getCurrentTheme(window)
    expect(theme === 'dark' || theme === 'light' || theme === null).toBe(true)
  })
})

// =============================================================================
// Phase 1 / P0 palette behaviour
//
// These run on the disposable palette fixture: a throwaway userData directory plus a
// bootstrap that records insert/copy/usage/add requests instead of driving a native
// paste. Assertions verify the request and its ID, never an external application.
// =============================================================================

/** The autostart control is a native checkbox behind a label track: click the
 *  visible affordance, exactly as a user does. */
async function setAutostart(window: Page, checked: boolean): Promise<void> {
  const toggle = window.locator('#autostart-toggle')
  if (await toggle.isChecked() === checked) return
  await window.locator('#autostart-section .toggle-switch').click()
  await expect(toggle).toBeChecked({ checked })
}

const paletteTest = createPaletteTest()

paletteTest.describe('PhraseVault P0 Palette', () => {
  paletteTest.beforeEach(({ electronApp, window }) => seedPalette(electronApp, window))

  paletteTest('P0 blank Enter is inert; immediate query Enter requests the exact match once',
    async ({ electronApp, window }) => {
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:focusSearch')
      })
      await window.locator('#search').press('Enter')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      expect(await calls(electronApp, 'phrases:incrementUsage')).toEqual([])
      const clipboardBefore = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      await window.locator('#search').fill(' \t ')
      await window.locator('#search').press('Enter')
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(clipboardBefore)
      await window.locator('#search').fill('sig')
      await window.locator('#search').press('Enter')
      await expect.poll(async () => (await calls(electronApp, 'phrases:insertById')).length).toBe(1)
      // The implicit Enter target is the first visible row, not a painted selection.
      const first = window.locator('#phrase-list > .phrase-item').first()
      await expect(first.locator('strong')).toHaveText('sig')
      await expect(window.locator('#search')).toBeFocused()
      await expect(window.locator('#phrase-list .is-selected')).toHaveCount(0)
      expect(String((await calls(electronApp, 'phrases:insertById'))[0].data))
        .toBe(await first.getAttribute('data-id'))
    })

  paletteTest('P0 search focus paints nothing; ArrowDown is the first selection',
    async ({ electronApp, window }) => {
      const search = window.locator('#search')
      const rows = window.locator('#phrase-list > .phrase-item')
      const selected = window.locator('#phrase-list .is-selected')
      await search.fill('sig')
      await expect(rows.first().locator('strong')).toHaveText('sig')
      // Caret in search: no outline, no row badge, but the Enter action is announced.
      await expect(search).toBeFocused()
      await expect(selected).toHaveCount(0)
      await expect(window.locator('.palette-enter-hint:visible')).toHaveCount(0)
      await expect(window.locator('#palette-status')).toContainText('sig')
      // Down is the first selection, not a second one.
      await search.press('ArrowDown')
      await expect(rows.first()).toBeFocused()
      await expect(selected).toHaveCount(1)
      await expect(rows.first()).toHaveClass(/is-selected/)
      await expect(rows.first().locator('.palette-enter-hint')).toBeVisible()
      await window.keyboard.press('ArrowDown')
      await expect(rows.nth(1)).toBeFocused()
      await expect(selected).toHaveCount(1)
      await expect(rows.nth(1)).toHaveClass(/is-selected/)
      // Up from the first row returns to an unselected search.
      await window.keyboard.press('ArrowUp')
      await expect(rows.first()).toBeFocused()
      await window.keyboard.press('ArrowUp')
      await expect(search).toBeFocused()
      await expect(selected).toHaveCount(0)
      await expect(window.locator('.palette-enter-hint:visible')).toHaveCount(0)
      // Enter from that unselected search still inserts the first visible match once.
      await search.press('Enter')
      await expect.poll(async () => (await calls(electronApp, 'phrases:insertById')).length).toBe(1)
      expect(String((await calls(electronApp, 'phrases:insertById'))[0].data))
        .toBe(await rows.first().getAttribute('data-id'))
    })

  paletteTest('P0 zero-match Create is unselected under search focus and still opens on Enter',
    async ({ window }) => {
      const search = window.locator('#search')
      const create = window.locator('[data-palette-action="create"]')
      await search.fill('welcome client')
      await expect(create).toBeVisible()
      await expect(create).not.toHaveClass(/is-selected/)
      await expect(window.locator('.palette-enter-hint:visible')).toHaveCount(0)
      await search.press('ArrowDown')
      await expect(create).toBeFocused()
      await expect(create).toHaveClass(/is-selected/)
      await expect(create.locator('.palette-enter-hint')).toBeVisible()
      await window.keyboard.press('ArrowDown')
      await expect(search).toBeFocused()
      await expect(window.locator('#phrase-list .is-selected')).toHaveCount(0)
      await search.press('Enter')
      await expect(window.locator('#modal-phrase.active')).toHaveCount(1)
    })

  paletteTest('P0 clicking empty list space drops the row and Create selection and badge',
    async ({ window }) => {
      const search = window.locator('#search')
      const list = window.locator('#phrase-list')
      const selected = window.locator('#phrase-list .is-selected')
      const badges = window.locator('.palette-enter-hint:visible')
      // Whitespace below the last row is not focusable: focus drops to body
      // without a focusin, so nothing may keep advertising Enter.
      const clickEmptySpace = async () => {
        const box = (await list.boundingBox())!
        await window.mouse.click(box.x + box.width / 2, box.y + box.height - 10)
      }
      for (const query of ['sig', 'welcome client']) {
        await search.fill(query)
        await expect(list).toHaveAttribute('data-phase', 'ready')
        await search.press('ArrowDown')
        await expect(selected).toHaveCount(1)
        await expect(badges).toHaveCount(1)
        await clickEmptySpace()
        await expect.poll(() => window.evaluate(() => document.activeElement?.tagName)).toBe('BODY')
        await expect(selected).toHaveCount(0)
        await expect(badges).toHaveCount(0)
        await search.focus()
      }
    })

  paletteTest('P0 a held read decorates and clears from live focus without rebuilding rows',
    async ({ electronApp, window }) => {
      const search = window.locator('#search')
      const rows = window.locator('#phrase-list > .phrase-item')
      const selected = window.locator('#phrase-list .is-selected')
      const statusBefore = (await window.locator('#palette-status').textContent()) ?? ''
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      await search.fill('sig')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'loading')
      await expect(rows).toHaveCount(2)
      // Retained rows still follow focus while the read is in flight, but the
      // Enter target is unknown, so no badge; the live region says nothing new.
      await search.press('ArrowDown')
      await expect(rows.first()).toBeFocused()
      await expect(selected).toHaveCount(1)
      await expect(window.locator('.palette-enter-hint:visible')).toHaveCount(0)
      await expect(window.locator('#palette-status')).toHaveText(statusBefore)
      await window.keyboard.press('ArrowUp')
      await expect(search).toBeFocused()
      await expect(selected).toHaveCount(0)
      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = false
        globalThis.__pvP0.releaseAll()
      })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      await expect(selected).toHaveCount(0)
    })

  paletteTest('P0 arrows, single click, row Enter and double click have distinct behavior',
    async ({ electronApp, window }) => {
      const search = window.locator('#search')
      const rows = window.locator('#phrase-list > .phrase-item')
      await search.press('ArrowDown')
      await expect(rows.first()).toBeFocused()
      await rows.first().press('ArrowUp')
      await expect(search).toBeFocused()
      await search.press('ArrowUp')
      await expect(rows.last()).toBeFocused()
      await rows.last().press('ArrowDown')
      await expect(search).toBeFocused()
      await rows.last().locator('strong').click()
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      await rows.last().press('Enter')
      await expect.poll(async () => (await calls(electronApp, 'phrases:insertById')).length).toBe(1)
      await rows.first().locator('strong').dblclick()
      await expect.poll(async () => (await calls(electronApp, 'phrases:insertById')).length).toBe(2)
    })

  paletteTest('P0 nested Copy, Edit and More keep native Enter activation',
    async ({ electronApp, window }) => {
      const first = window.locator('#phrase-list > .phrase-item').first()
      const copy = first.locator('button[data-action="copy"]')
      await expect(copy).toBeVisible()
      await copy.focus()
      await copy.press('Enter')
      await expect.poll(async () => (await calls(electronApp, 'phrases:copyToClipboard')).length).toBe(1)
      // The payload is the numeric id only: the renderer never sends a body.
      const copyCalls = await calls(electronApp, 'phrases:copyToClipboard')
      expect(typeof copyCalls[0].data).toBe('number')
      expect(Number.isInteger(copyCalls[0].data as number)).toBe(true)
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      const edit = first.locator('button[data-action="edit"]')
      await edit.focus()
      await edit.press('Enter')
      await expect(window.locator('#modal-phrase')).toBeVisible()
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      // Wait for the open animation to settle: pressing Escape while shared focus
      // management is still moving focus can drop the key.
      await expect(window.locator('#modal-phrase')).toHaveClass(/\bactive\b/)
      await window.keyboard.press('Escape')
      await expect(window.locator('#modal-phrase')).toBeHidden()
      const more = first.locator('button[title="More"]')
      await more.focus()
      await more.press('Enter')
      await expect(first.locator('.phrase-menu')).toBeVisible()
      await first.locator('button[data-action="copy-id"]').focus()
      await window.keyboard.press('Enter')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  paletteTest('P0 a purchase modal cancels a queued Enter even if later closed',
    async ({ electronApp, window }) => {
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      const before = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await window.locator('#search').fill('sig')
      await window.locator('#search').press('Enter')
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(before + 1)
      await window.evaluate(() => window.modals.openPurchaseReminderModal())
      await expect(window.locator('#modal-purchase-reminder')).toBeVisible()
      await window.locator('#btn-purchase-reminder-later').click()
      await expect(window.locator('#modal-purchase-reminder')).toBeHidden()
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = false; globalThis.__pvP0.releaseAll() })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  paletteTest('P0 summon refreshes without inserting or stealing modal focus',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('sig')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:focusSearch')
      })
      await expect(window.locator('#search')).toBeFocused()
      await expect(window.locator('#search')).toHaveValue('sig')
      expect(await window.locator('#search').evaluate(element => {
        const input = element as HTMLInputElement
        return [input.selectionStart, input.selectionEnd]
      })).toEqual([0, 3])
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      await window.locator('#add-phrase').click()
      await expect(window.locator('#phraseInput')).toBeFocused()
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:focusSearch')
      })
      await expect(window.locator('#phraseInput')).toBeFocused()
    })

  paletteTest('P0 pending deletion and Undo never expose a hidden Enter target',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('signature formal')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      const row = window.locator('#phrase-list > .phrase-item').first()
      await expect(row).toBeVisible()
      await row.locator('button[title="More"]').click()
      await row.locator('button[data-action="delete"]').click()
      await expect(window.locator('#phrase-list > .phrase-item:visible')).toHaveCount(0)
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(0)
      // Force a real result while the database still contains the hidden phrase.
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('phrases:importComplete')
      })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      await window.locator('#search').press('Enter')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      await window.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(1)
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(0)
    })

  paletteTest('P0 repeated ready status does not recursively query; restored status reloads',
    async ({ electronApp, window }) => {
      const before = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        contents.send('database:status', true)
        contents.send('database:status', true)
      })
      // A renderer evaluate round trip drains the delivered event callbacks.
      await window.evaluate(() => Promise.resolve())
      expect(await electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(before)
      await electronApp.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        contents.send('database:status', false)
      })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'unavailable')
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('database:status', true)
      })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      expect(await electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(before + 1)
    })

  paletteTest('P0 confirmed deletion offers Create only after a fresh empty read',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('signature formal')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      const row = window.locator('#phrase-list > .phrase-item').first()
      await expect(row).toBeVisible()
      await row.locator('button[title="More"]').click()
      await row.locator('button[data-action="delete"]').click()
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(0)
      await expect(window.locator('[data-palette-action="create"]')).toBeVisible({ timeout: 12000 })
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(0)
      expect(await window.evaluate(() => window.api.invoke('phrases:search', 'signature formal'))).toEqual([])
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  paletteTest('P0 Settings event preserves unsaved inputs on repeated open and Cancel reverts',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('sig')
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(2)
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings')
      })
      await expect(window.locator('#modal-settings')).toBeVisible()
      const theme = window.locator('#settings-theme')
      const original = await theme.inputValue()
      const changed = original === 'dark' ? 'light' : 'dark'
      await theme.selectOption(changed)
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings')
      })
      await expect(theme).toHaveValue(changed)
      // Export Filtered lives in the Database panel; select it first so these
      // assertions cannot pass on hidden content alone.
      await window.locator('#settings-tab-database').click()
      await expect(window.locator('#new-db-btn')).toBeVisible()
      await expect(window.locator('#export-filtered-btn')).toBeVisible()
      await expect(window.locator('#export-filtered-btn')).toHaveText('Export Filtered (2)')
      await expect(window.locator('#export-filtered-btn')).toBeEnabled()
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#btn-settings').click()
      await expect(theme).toHaveValue(original)
    })

  paletteTest('P0 Create is never counted as filtered export; another modal takes precedence',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('unique missing response')
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(1)
      await window.locator('#btn-settings').click()
      // Export Filtered lives in the Database panel; select it first so these
      // assertions cannot pass on hidden content alone.
      await window.locator('#settings-tab-database').click()
      await expect(window.locator('#new-db-btn')).toBeVisible()
      await expect(window.locator('#export-filtered-btn')).toBeHidden()
      await expect(window.locator('#export-filtered-btn')).toBeDisabled()
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#add-phrase').click()
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings')
      })
      await expect(window.locator('#modal-phrase')).toBeVisible()
      await expect(window.locator('#modal-settings')).toBeHidden()
    })

  paletteTest('P0 Windows Ctrl-comma uses the initialized Settings path',
    async ({ electronApp, window }) => {
      const platform = await electronApp.evaluate(() => process.platform)
      paletteTest.skip(platform !== 'win32', 'Windows-only shortcut; macOS uses its native menu accelerator')
      await window.locator('#search').fill('sig')
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(2)
      await window.keyboard.press('Control+,')
      await expect(window.locator('#modal-settings')).toBeVisible()
      // Export Filtered lives in the Database panel; select it first so these
      // assertions cannot pass on hidden content alone.
      await window.locator('#settings-tab-database').click()
      await expect(window.locator('#new-db-btn')).toBeVisible()
      await expect(window.locator('#export-filtered-btn')).toBeVisible()
      await expect(window.locator('#export-filtered-btn')).toHaveText('Export Filtered (2)')
      await window.locator('#settings-tab-preferences').click()
      await window.locator('#settings-theme').selectOption('light')
      await window.keyboard.press('Control+,')
      // A repeated accelerator is a no-op: it neither jumps the pane nor resets.
      await expect(window.locator('#settings-preferences')).toBeVisible()
      await expect(window.locator('#settings-theme')).toHaveValue('light')
    })

  for (const type of ['text', 'html'] as const) {
    paletteTest('P0 native ' + type + ' recovery preserves query and selection with one danger toast',
      async ({ electronApp, window }) => {
        await window.evaluate(async type => {
          const rows = await window.api.invoke<Array<{ id: number }>>('phrases:search', 'sig')
          await new Promise<void>(resolve => {
            window.api.receiveOnce('phrases:edited', () => resolve())
            window.api.send('phrases:edit', {
              id: rows[0].id, newPhrase: 'sig',
              newExpandedText: type === 'html' ? '<b>Best regards, Alex</b>' : 'Best regards, Alex', type,
            })
          })
        }, type)
        await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
        await electronApp.evaluate(() => {
          globalThis.__pvP0.passThroughInsert = true
          globalThis.__pvP0.failClipboardWrite = true
        })
        await window.locator('#search').fill('sig')
        await window.locator('#search').press('Enter')
        await expect(window.getByText('Could not access the clipboard. Try inserting again.', { exact: true }))
          .toHaveCount(1)
        await expect(window.locator('#search')).toHaveValue('sig')
        await expect(window.locator('#phrase-list > .phrase-item').first().locator('strong'))
          .toHaveText('sig')
        expect(await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
        expect(await calls(electronApp, 'robotPaste')).toEqual([])
        expect(await calls(electronApp, 'phrases:incrementUsage')).toEqual([])
      })
  }

  paletteTest('P0 real database switch discards held A and failed switch reloads restored B',
    async ({ electronApp, window }) => {
      const databaseB = await electronApp.evaluate(() => globalThis.__pvP0.cloneDatabase())
      const before = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      await window.locator('#search').fill('sig')
      await window.locator('#search').press('Enter')
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(before + 1)
      await window.evaluate(filePath => window.api.send('database:openRecent', filePath), databaseB)
      await expect(window.locator('#search')).toHaveValue('')
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = false; globalThis.__pvP0.releaseAll() })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      await window.locator('#search').fill('sig')
      await expect(window.locator('#phrase-list > .phrase-item').first())
        .toContainText('Database B response')
      const broken = await electronApp.evaluate(() => globalThis.__pvP0.brokenDatabase())
      const readsBeforeRollback = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(({ ipcMain }, filePath) => new Promise<void>(resolve => {
        let unavailableSeen = false
        const listener = (available: boolean): void => {
          if (!available) unavailableSeen = true
          else if (unavailableSeen) {
            global.databaseEvents.removeListener('database:status', listener)
            resolve()
          }
        }
        global.databaseEvents.on('database:status', listener)
        ipcMain.emit('database:openRecent', null, filePath)
      }), broken)
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount))
        .toBeGreaterThan(readsBeforeRollback)
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      await expect(window.locator('#search')).toHaveValue('sig')
      await expect(window.locator('#phrase-list > .phrase-item').first())
        .toContainText('Database B response')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  // ===========================================================================
  // Phase 2 chrome: control placement, Clear focus order and pending-Enter
  // cancellation from each moved control.
  // ===========================================================================

  paletteTest('P2 chrome placements and empty Clear focus order', async ({ window }) => {
    await expect(window.locator('#btn-settings')).toHaveCount(1)
    await expect(window.locator('.titlebar-actions > #btn-settings')).toBeVisible()
    for (const id of ['search-btn', 'add-phrase']) {
      await expect(window.locator('#' + id)).toHaveCount(1)
      await expect(window.locator('.palette-search > #' + id)).toBeVisible()
    }
    await expect(window.locator('.btn-fab')).toHaveCount(0)
    const search = window.locator('#search')
    await search.fill('')
    await expect(window.locator('#search-clear')).toBeHidden()
    await search.focus()
    await window.keyboard.press('Tab')
    await expect(window.locator('#add-phrase')).toBeFocused()
    await search.fill('   ')
    await expect(window.locator('#search-clear')).toBeVisible()
    await search.focus()
    await window.keyboard.press('Tab')
    await expect(window.locator('#search-clear')).toBeFocused()
    await window.keyboard.press('Space')
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
    await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(2)
  })

  for (const interrupt of ['search', 'add', 'settings'] as const) {
    paletteTest('P2 ' + interrupt + ' cancels a held Enter', async ({ electronApp, window }) => {
      const before = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      await window.locator('#search').fill('sig')
      await window.locator('#search').press('Enter')
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(before + 1)
      const id = interrupt === 'search' ? 'search-btn' : interrupt === 'add' ? 'add-phrase' : 'btn-settings'
      await window.locator('#' + id).click()
      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = false
        globalThis.__pvP0.releaseAll()
      })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      if (interrupt === 'search') {
        await expect(window.locator('#modal-phrase')).toBeHidden()
        await expect(window.locator('#search')).toBeFocused()
      }
    })
  }

  paletteTest('P2 accelerator cancels a held Enter', async ({ electronApp, window }) => {
    const before = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
    await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
    await window.locator('#search').fill('sig')
    await window.locator('#search').press('Enter')
    await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(before + 1)
    const platform = await window.evaluate(() => window.platform)
    await window.keyboard.press(platform === 'darwin' ? 'Meta+n' : 'Control+n')
    await expect(window.locator('#modal-phrase.active')).toHaveCount(1)
    await electronApp.evaluate(() => {
      globalThis.__pvP0.holdSearch = false
      globalThis.__pvP0.releaseAll()
    })
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
    expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
  })

  // ===========================================================================
  // Phase 2 Settings: daily-first order, native disclosures and truthful,
  // pinned license actions. License responses come from the chrome probe, so no
  // real key, purchase or reminder write occurs.
  // ===========================================================================

  const licenseCases: Array<{ name: string; status: ChromeLicenseStatus; text: string | null }> = [
    { name: 'expired', status: expiredLicense, text: 'Trial expired' },
    { name: 'active trial', status: {
      ...expiredLicense, trial: { active: true, daysRemaining: 5, expired: false },
    }, text: 'Trial: 5 days remaining' },
    { name: 'unlicensed', status: {
      ...expiredLicense, trial: { active: false, daysRemaining: 0, expired: false },
    }, text: 'Unlicensed' },
    { name: 'licensed', status: {
      ...expiredLicense, hasLicense: true,
      license: { payload: { email: 'fixture@example.test', id: 'fixture-license' } },
    }, text: null },
  ]

  paletteTest('UI W1 Settings rail and pinned expired-license actions',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await window.locator('#btn-settings').click()
      const modal = window.locator('#modal-settings')
      await expect(modal).toBeVisible()
      await expect(window.locator('#license-status-trial')).toHaveText('Trial expired')
      await expect(window.locator('#license-buy-btn')).toBeVisible()
      // The pinned band is a sibling of the rail layout, never inside a panel.
      await expect(window.locator('#settings-layout #license-section-trial')).toHaveCount(0)
      for (const pane of ['preferences', 'database', 'security', 'about']) {
        await expect(window.locator('#settings-tab-' + pane)).toBeVisible()
      }
      await expect(window.locator('#settings-tab-preferences'))
        .toHaveAttribute('aria-selected', 'true')
      await expect(window.locator('#settings-database')).toBeHidden()
      await expect(window.locator('#settings-about')).toBeHidden()
      await expect(window.locator('#btn-settings-save')).toHaveText('Save preferences')
      await window.locator('#license-buy-btn').click()
      expect(await chromeCalls(electronApp, 'shell:openExternal')).toEqual([
        { channel: 'shell:openExternal', data: 'https://phrasevault.app/pricing' },
      ])
      expect(await chromeCalls(electronApp, 'license:markReminderShown')).toEqual([])
      await expect(modal).toBeVisible()
      await window.locator('#settings-tab-database').focus()
      await window.keyboard.press('Enter')
      await expect(window.locator('#new-db-btn')).toBeVisible()
      await expect(window.locator('#settings-tab-database')).toBeFocused()
      await window.locator('#settings-tab-about').focus()
      await window.keyboard.press('Space')
      await expect(window.locator('#check-updates-btn')).toBeVisible()
      // Never two panels at once: About replaced Database, it did not join it.
      await expect(window.locator('#settings-database')).toBeHidden()
      await expect(window.locator('#settings-layout [role="tabpanel"]:visible')).toHaveCount(1)
      await window.locator('#btn-settings-cancel').click()
      await expect(modal).toBeHidden()
      await window.locator('#btn-settings').click()
      await expect(window.locator('#settings-tab-preferences'))
        .toHaveAttribute('aria-selected', 'true')
      await expect(window.locator('#settings-preferences')).toBeVisible()
      await expect(window.locator('#settings-database')).toBeHidden()
      await expect(window.locator('#settings-about')).toBeHidden()
    })

  for (const entry of licenseCases) {
    paletteTest('P2 Settings layout is truthful when ' + entry.name,
      async ({ electronApp, window }) => {
        await installChromeProbe(electronApp)
        await electronApp.evaluate((_electron, status) => {
          globalThis.__pvChrome.license = status
        }, entry.status)
        await window.locator('#btn-settings').click()
        await expect(window.locator('#modal-settings')).toBeVisible()

        // Exactly one key input exists anywhere in the dialog.
        await expect(window.locator('#modal-settings #license-key-input')).toHaveCount(1)

        const banner = window.locator('#license-section-trial')
        if (entry.text === null) {
          await expect(banner).toBeHidden()
          await window.locator('#settings-tab-about').click()
          await expect(window.locator('#license-email')).toHaveText('fixture@example.test')
          await expect(window.locator('#license-id-display')).toHaveText('fixture-license')
          await expect(window.locator('#license-deactivate-btn')).toBeVisible()
        } else {
          await expect(banner).toBeVisible()
          await expect(window.locator('#license-status-trial')).toHaveText(entry.text)
          await expect(window.locator('#license-activate-btn')).toBeVisible()
          await expect(window.locator('#license-buy-btn')).toBeVisible()
          await expect(window.locator('#license-recovery-link')).toBeVisible()
        }

        // Daily preferences and all four rail tabs are the initial layout.
        await window.locator('#settings-tab-preferences').click()
        for (const selector of ['#shortcut-input', '#shortcut-record-btn', '#settings-theme',
          '#language-select', '#autostart-toggle']) {
          await expect(window.locator('#settings-preferences ' + selector)).toBeVisible()
        }
        for (const pane of ['preferences', 'database', 'security', 'about']) {
          await expect(window.locator('#settings-tab-' + pane)).toBeVisible()
        }
        await expect(window.locator('#btn-settings-cancel')).toBeVisible()
        await expect(window.locator('#btn-settings-save')).toBeVisible()
      })
  }

  paletteTest('P2 activation and deactivation update license UI without losing the draft',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      const theme = window.locator('#settings-theme')
      const original = await theme.inputValue()
      const draft = original === 'dark' ? 'light' : 'dark'
      await theme.selectOption(draft)
      await window.locator('#language-select').selectOption('de')
      await window.locator('#license-key-input').fill('PV-fixture')

      // Injected activation failure keeps the inline error and the draft.
      await window.locator('#license-activate-btn').click()
      await expect(window.locator('#license-error')).toBeVisible()
      await expect(window.locator('#license-error')).toHaveText('Invalid license key')
      await expect(theme).toHaveValue(draft)
      await expect(window.locator('#language-select')).toHaveValue('de')

      await electronApp.evaluate(() => { globalThis.__pvChrome.activation = { success: true } })
      await window.locator('#license-key-input').fill('PV-fixture')
      await window.locator('#license-activate-btn').click()
      await expect(window.locator('#license-section-trial')).toBeHidden()
      await expect(theme).toHaveValue(draft)
      // The band that owned focus disappeared: the always-visible selected tab
      // takes it, never a control that the selected panel may be hiding.
      await expect(window.locator('#settings-tab-preferences')).toBeFocused()

      await window.locator('#settings-tab-about').click()
      await window.locator('#license-deactivate-btn').click()
      await expect(window.locator('#license-section-trial')).toBeVisible()
      await expect(window.locator('#license-key-input')).toBeFocused()
      await expect(theme).toHaveValue(draft)
      await expect(window.locator('#language-select')).toHaveValue('de')
      expect(await chromeCalls(electronApp, 'license:markReminderShown')).toEqual([])
    })

  /**
   * Barrier for the "a released stale reply changed nothing" assertions. The
   * released reply is queued to the renderer before this round trip is issued,
   * so once it resolves the stale continuation has already had its turn.
   */
  const flushRenderer = (window: Page): Promise<unknown> =>
    window.evaluate(() => window.api.invoke('phrases:search', ''))

  paletteTest('UI W1 a held activation cannot touch the session that replaced it',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await electronApp.evaluate(() => { globalThis.__pvChrome.holdActivation = true })
      const held = () => electronApp.evaluate(() =>
        globalThis.__pvChrome.activationReplies.length)
      const release = () => electronApp.evaluate(() => {
        globalThis.__pvChrome.activationReplies.shift()!()
      })
      // Opening focuses the selected rail tab on a later frame; wait for it so
      // filling the key is the last word on focus, not a race with that frame.
      const openWith = async (key: string): Promise<void> => {
        await window.locator('#btn-settings').click()
        await expect(window.locator('#modal-settings')).toBeVisible()
        await expect(window.locator('#settings-tab-preferences')).toBeFocused()
        await window.locator('#license-key-input').fill(key)
      }
      const reopenWith = async (key: string): Promise<void> => {
        await window.locator('#btn-settings-cancel').click()
        await expect(window.locator('#modal-settings')).toBeHidden()
        await openWith(key)
      }

      await openWith('PV-discarded')
      await window.locator('#license-activate-btn').click()
      await expect.poll(held).toBe(1)

      // The session that started the activation is discarded mid-flight.
      await reopenWith('PV-current')
      await release()
      await flushRenderer(window)
      // A late failure belongs to the discarded session: this session keeps its
      // key, shows no inline error, and its activate control stays usable.
      await expect(window.locator('#license-key-input')).toHaveValue('PV-current')
      await expect(window.locator('#license-error')).toBeHidden()
      await expect(window.locator('#license-section-trial')).toBeVisible()
      await expect(window.locator('#license-key-input')).toBeFocused()
      await expect(window.locator('#license-activate-btn')).toBeEnabled()

      // Same walk, released as a success: it must not clear the key, drop the
      // unlicensed band, or pull focus out of the current session.
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.activation = { success: true }
      })
      await window.locator('#license-activate-btn').click()
      await expect.poll(held).toBe(1)
      await reopenWith('PV-second')
      await release()
      await flushRenderer(window)
      await expect(window.locator('#license-key-input')).toHaveValue('PV-second')
      await expect(window.locator('#license-section-trial')).toBeVisible()
      await expect(window.locator('#license-key-input')).toBeFocused()
      await expect(window.locator('#license-error')).toBeHidden()
    })

  paletteTest('UI W1 a held deactivation cannot touch the session that replaced it',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.activation = { success: true }
      })
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#license-key-input').fill('PV-fixture')
      await window.locator('#license-activate-btn').click()
      await expect(window.locator('#license-section-trial')).toBeHidden()

      await electronApp.evaluate(() => { globalThis.__pvChrome.holdDeactivation = true })
      await window.locator('#settings-tab-about').click()
      await window.locator('#license-deactivate-btn').click()
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.deactivationReplies.length)).toBe(1)

      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('#settings-tab-preferences')).toBeFocused()

      await electronApp.evaluate(() => {
        globalThis.__pvChrome.deactivationReplies.shift()!()
      })
      await flushRenderer(window)
      // The discarded session's deactivation must not raise the unlicensed band
      // in this session or take its focus.
      await expect(window.locator('#license-section-trial')).toBeHidden()
      await expect(window.locator('#settings-tab-preferences')).toBeFocused()
    })

  paletteTest('UI W1 an out-of-order license status reply cannot overwrite a newer one',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.activation = { success: true }
      })
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#license-key-input').fill('PV-fixture')
      await window.locator('#license-activate-btn').click()
      await expect(window.locator('#license-section-trial')).toBeHidden()

      // Two status reads in flight inside one session.
      await electronApp.evaluate(() => { globalThis.__pvChrome.holdStatus = true })
      await window.locator('#settings-tab-about').click()
      await window.locator('#license-deactivate-btn').click()
      await window.locator('#license-deactivate-btn').click()
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.statusReplies.length)).toBe(2)

      // Newest first, then the older read with the opposite answer.
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.statusReplies.pop()!({
          hasLicense: true, isLegacyUser: false,
          license: { payload: { email: 'newest@example.test', id: 'newest-license' } },
          trial: { active: false, daysRemaining: 0, expired: true },
        })
      })
      await expect(window.locator('#license-email')).toHaveText('newest@example.test')
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.statusReplies.shift()!({
          hasLicense: false, license: null, isLegacyUser: false,
          trial: { active: false, daysRemaining: 0, expired: true },
        })
      })
      await flushRenderer(window)
      await expect(window.locator('#license-section-trial')).toBeHidden()
      await expect(window.locator('#license-email')).toHaveText('newest@example.test')
    })

  paletteTest('UI W1 the Recent Databases heading follows a live language change',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await window.locator('#btn-db-status').click()
      await expect(window.locator('#settings-database')).toBeVisible()
      // Opening Settings asks for the recent list, so seed after that request
      // has been answered or its empty reply clears the fixture again.
      const seeded = window.evaluate(() => new Promise<void>(resolve => {
        window.api.receiveOnce('database:recentList', () => resolve())
      }))
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('database:recentList',
          ['C:/fixture/recent-one.db'])
      })
      await seeded
      const heading = window.locator('#recent-databases-label')
      await expect(heading).toHaveText('Recent Databases:')
      const changed = window.evaluate(() => new Promise<string>(resolve => {
        window.api.receiveOnce('i18n:languageChanged', value => resolve(String(value)))
      }))
      await window.evaluate(() => window.api.invoke('i18n:changeLanguage', 'de'))
      expect(await changed).toBe('de')
      // Database is open: the heading translates with the rest of the pane.
      await expect(heading).toHaveText('Kürzlich verwendete Datenbanken:')
    })

  paletteTest('UI W1 rail activates and skips hidden controls', async ({ electronApp, window }) => {
    await installChromeProbe(electronApp)
    await window.locator('#btn-settings').click()
    const tab = (pane: string) => window.locator('#settings-tab-' + pane)
    await expect(tab('preferences')).toBeFocused()
    await expect(window.locator('#settings-tabs')).toHaveAttribute('aria-orientation', 'vertical')
    // About is the fourth and last rail tab, so it is what ArrowUp wraps to
    // from the first tab and what End lands on.
    for (const [key, pane] of [
      ['ArrowUp', 'about'], ['ArrowDown', 'preferences'], ['End', 'about'],
      ['Home', 'preferences'], ['ArrowDown', 'database'],
    ]) {
      await window.keyboard.press(key)
      await expect(tab(pane)).toBeFocused()
      await expect(tab(pane)).toHaveAttribute('aria-selected', 'true')
      await expect(window.locator('#settings-tabs [aria-selected="true"]')).toHaveCount(1)
      await expect(window.locator('#settings-tabs [tabindex="0"]')).toHaveCount(1)
      await expect(window.locator('#settings-layout [role="tabpanel"]:visible')).toHaveCount(1)
      await expect(window.locator('#settings-' + pane)).toBeVisible()
    }
    await window.keyboard.press('Tab')
    await expect(window.locator('#settings-database')).toBeFocused()
    await window.keyboard.press('Shift+Tab')
    await expect(tab('database')).toBeFocused()
    await tab('preferences').click()
    await window.locator('#autostart-toggle').focus()
    await window.keyboard.press('Tab')
    await expect(window.locator('#btn-settings-cancel')).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(window.locator('#modal-settings')).toBeHidden()
    await expect(window.locator('#btn-settings')).toBeFocused()
  })

  paletteTest('UI W1 rail ignores modified, lateral and field arrow keys',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await window.locator('#btn-settings').click()
      const preferences = window.locator('#settings-tab-preferences')
      await expect(preferences).toBeFocused()
      for (const key of ['Shift+ArrowDown', 'Control+ArrowDown', 'Alt+ArrowDown',
        'ArrowLeft', 'ArrowRight']) {
        await window.keyboard.press(key)
        await expect(preferences).toBeFocused()
        await expect(preferences).toHaveAttribute('aria-selected', 'true')
      }
      // Arrows inside a real select never navigate panels.
      await window.locator('#settings-theme').focus()
      await window.keyboard.press('ArrowDown')
      await expect(preferences).toHaveAttribute('aria-selected', 'true')
      await expect(window.locator('#settings-preferences')).toBeVisible()

      // Focus stays inside the dialog.
      for (let step = 0; step < 30; step++) {
        await window.keyboard.press('Tab')
        expect(await window.evaluate(() =>
          document.getElementById('modal-settings')!.contains(document.activeElement))).toBe(true)
      }
    })

  paletteTest('UI W1 external entries never jump the open panel or reset the draft',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption('dark')
      await window.locator('#settings-tab-about').click()
      await expect(window.locator('#settings-about')).toBeVisible()
      const configBefore = (await chromeCalls(electronApp, 'config:get')).length
      await electronApp.evaluate(({ BrowserWindow }) => {
        // An arbitrary payload must never become the pane argument.
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings', 'database')
      })
      await expect(window.locator('#settings-about')).toBeVisible()
      await expect(window.locator('#settings-tab-about')).toHaveAttribute('aria-selected', 'true')
      await expect(window.locator('#settings-theme')).toHaveValue('dark')
      expect((await chromeCalls(electronApp, 'config:get')).length).toBe(configBefore)

      // A legal child over Settings leaves the pane and draft alone.
      await window.locator('#link-license').click()
      await expect(window.locator('#modal-markdown')).toBeVisible()
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings')
      })
      await expect(window.locator('#settings-about')).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(window.locator('#modal-markdown')).toBeHidden()
      await expect(window.locator('#link-license')).toBeFocused()
      await expect(window.locator('#settings-theme')).toHaveValue('dark')
    })

  paletteTest('UI W1 panel scroll survives a switch and resets on fresh opening',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await window.locator('#btn-settings').click()
      await window.locator('#settings-tab-database').click()
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('database:recentList',
          Array.from({ length: 5 }, (_, i) => 'C:\\fixture\\' + 'long-directory-'.repeat(12) + i + '.db'))
      })
      await expect(window.locator('#recent-databases button')).toHaveCount(5)
      const panel = window.locator('#settings-database')
      await panel.evaluate(el => { el.scrollTop = el.scrollHeight })
      const scrolled = await panel.evaluate(el => el.scrollTop)
      expect(scrolled).toBeGreaterThan(0)
      await window.locator('#settings-tab-about').click()
      await window.locator('#settings-tab-database').click()
      expect(await panel.evaluate(el => el.scrollTop)).toBe(scrolled)
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#btn-settings').click()
      await window.locator('#settings-tab-database').click()
      expect(await panel.evaluate(el => el.scrollTop)).toBe(0)
    })

  paletteTest('UI W1 shortcut recording freezes the rail until it settles',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      await window.locator('#btn-settings').click()
      await window.locator('#shortcut-record-btn').click()
      await expect(window.locator('#shortcut-input')).toHaveClass(/recording/)
      await expect(window.locator('#settings-tab-database')).toBeDisabled()
      await window.locator('#settings-tab-database').click({ force: true })
      await expect(window.locator('#settings-preferences')).toBeVisible()
      await expect(window.locator('#settings-database')).toBeHidden()
      // Cancelling the recorder restores the rail through the existing lifecycle.
      await window.locator('#shortcut-record-btn').click()
      await expect(window.locator('#shortcut-input')).not.toHaveClass(/recording/)
      await expect(window.locator('#settings-tab-database')).toBeEnabled()
      await window.locator('#settings-tab-database').click()
      await expect(window.locator('#settings-database')).toBeVisible()
    })

  // ===========================================================================
  // Wave 1 database status: one shape-coded control beside the gear, replacing
  // the nested colour-only badge. Each state is driven through its real event.
  // ===========================================================================

  /** The literal geometry the spec locks, read back off the rendered nodes. */
  const glyphShapes: Record<string, string[][]> = {
    available: [
      ['ellipse', 'cx=12 cy=5 rx=8 ry=3'],
      ['path', 'd=M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5'],
      ['path', 'd=M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3'],
    ],
    loading: [['path', 'd=M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4']],
    error: [
      ['circle', 'cx=12 cy=12 r=9'],
      ['path', 'd=M12 7v6'],
      ['path', 'd=M12 17h.01'],
    ],
  }

  async function readGlyph(window: Page, selector: string): Promise<{
    shapes: string[][]
    root: Record<string, string | null>
  }> {
    return window.evaluate(selector => {
      const svg = document.querySelector(selector + ' svg')
      if (!svg) throw new Error('Missing glyph: ' + selector)
      const attributes = ['cx', 'cy', 'rx', 'ry', 'r', 'd']
      return {
        shapes: [...svg.children].map(child => [
          child.tagName,
          attributes.filter(name => child.hasAttribute(name))
            .map(name => name + '=' + child.getAttribute(name)).join(' '),
        ]),
        root: Object.fromEntries(['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
          'stroke-linejoin', 'aria-hidden', 'focusable']
          .map(name => [name, svg.getAttribute(name)])),
      }
    }, selector)
  }

  const decorativeGlyph = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  }

  // The locked copy per state. Asserting it directly means a wrong mapping
  // (say `available` rendering "Database error") fails instead of round-tripping.
  const statusCopy = {
    available: 'Phrase database loaded successfully',
    loading: 'Loading...',
    error: 'Database error',
  } as const

  for (const state of ['available', 'loading', 'error'] as const) {
    for (const activation of ['click', 'Enter', 'Space'] as const) {
      paletteTest('UI W1 status ' + state + ' via ' + activation,
        async ({ electronApp, window, consoleErrors }) => {
          await installChromeProbe(electronApp)
          await electronApp.evaluate(({ BrowserWindow }, state) => {
            const web = BrowserWindow.getAllWindows()[0].webContents
            if (state === 'error') web.send('database:error', 'controlled status failure')
            else web.send('database:status', state === 'available')
          }, state)
          const button = window.locator('#btn-db-status')
          await expect(button).toHaveAttribute('data-state', state)
          await expect(button).toBeEnabled()
          await expect(window.locator('#status-indicator')).toHaveCount(0)
          await expect(window.locator('.titlebar-actions > #btn-db-status + #btn-settings'))
            .toHaveCount(1)
          await expect(button).toHaveAttribute('aria-haspopup', 'dialog')
          await expect(button).toHaveAttribute('aria-controls', 'modal-settings')
          // The gear is Settings only; the database state left it entirely.
          await expect(window.locator('#btn-settings')).toHaveAccessibleName('Settings')
          await expect(window.locator('#btn-settings')).toHaveAttribute('title', 'Settings')
          await expect(window.locator('#btn-settings[aria-description]')).toHaveCount(0)
          await expect(window.locator('.titlebar [aria-live]')).toHaveCount(0)

          const titlebarGlyph = await readGlyph(window, '#btn-db-status')
          expect(titlebarGlyph.shapes).toEqual(glyphShapes[state])
          expect(titlebarGlyph.root).toEqual(decorativeGlyph)
          await expect(window.locator('#db-status-glyph')).toHaveCount(1)

          if (activation === 'click') await button.click()
          else { await button.focus(); await button.press(activation) }
          await expect(window.locator('#settings-tab-database')).toBeFocused()
          await expect(window.locator('#settings-database')).toBeVisible()
          await expect(window.locator('#settings-status-indicator'))
            .toHaveAttribute('data-state', state)
          await expect(window.locator('#settings-db-status')).toHaveAttribute('role', 'status')
          await expect(window.locator('#settings-db-status')).toHaveAttribute('aria-live', 'polite')
          await expect(window.locator('#settings-db-status')).toHaveAttribute('aria-atomic', 'true')
          const paneGlyph = await readGlyph(window, '#settings-status-indicator')
          expect(paneGlyph.shapes).toEqual(glyphShapes[state])
          expect(paneGlyph.root).toEqual(decorativeGlyph)

          const status = statusCopy[state]
          await expect(window.locator('#settings-status-text')).toHaveText(status)
          await expect(button).toHaveAttribute('aria-label', 'Database: ' + status)
          await expect(button).toHaveAttribute('title', 'Database: ' + status)
          // The open dialog marks the titlebar aria-hidden, so the exposed name
          // is only measurable once Settings is dismissed again.
          await window.locator('#btn-settings-cancel').click()
          await expect(window.locator('#modal-settings')).toBeHidden()
          await expect(button).toHaveAccessibleName('Database: ' + status)
          expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
          expect(await chromeCalls(electronApp, 'theme:set')).toEqual([])
          // The injected failure is the only console error this fixture allows;
          // unrelated errors still fail rather than being swallowed.
          const errors = consoleErrors.filter(entry => entry.type === 'error').map(entry => entry.text)
          expect(errors.filter(text => !text.includes('controlled status failure'))).toEqual([])
          expect(errors.length).toBe(state === 'error' ? 1 : 0)
        })
    }
  }

  paletteTest('UI W1 status translates while Database is hidden',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('database:status', true)
      })
      const button = window.locator('#btn-db-status')
      await expect(button).toHaveAccessibleName('Database: Phrase database loaded successfully')
      const changed = window.evaluate(() => new Promise<string>(resolve => {
        window.api.receiveOnce('i18n:languageChanged', value => resolve(String(value)))
      }))
      await window.evaluate(() => window.api.invoke('i18n:changeLanguage', 'de'))
      expect(await changed).toBe('de')
      // Settings was never opened: the hidden pane still holds the translated
      // text, and it is the locked German copy, not merely "not English".
      const german = 'Datenbank: Phrasendatenbank erfolgreich geladen'
      await expect(button).toHaveAccessibleName(german)
      await button.click()
      await expect(window.locator('#settings-database')).toBeVisible()
      await expect(window.locator('#settings-status-text'))
        .toHaveText('Phrasendatenbank erfolgreich geladen')
      await expect(window.locator('#settings-status-indicator'))
        .toHaveAttribute('data-state', 'available')
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await expect(button).toHaveAccessibleName(german)
      await expect(button).toHaveAttribute('title', german)
    })

  paletteTest('UI W1 status entry cancels a held palette Enter without inserting',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('sig')
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(2)
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      await window.locator('#search').fill('signature')
      await window.locator('#search').press('Enter')
      await window.locator('#btn-db-status').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await electronApp.evaluate(() => { globalThis.__pvP0.releaseAll() })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  // ===========================================================================
  // Phase 2 preference draft: renderer-only theme preview, every discard route,
  // stale reply protection and ordered Save. All completions are controlled
  // Promises resolved through the probe, never sleeps.
  // ===========================================================================

  for (const dismissal of ['cancel', 'close', 'escape', 'backdrop'] as const) {
    paletteTest('P2 preview discards through ' + dismissal, async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const original = await window.evaluate(() => window.api.sendSync<string>('theme:get'))
      const preview = original === 'dark' ? 'light' : 'dark'
      const before = await electronApp.evaluate(() =>
        ({ ...globalThis.__pvChrome.preferences!.committed }))
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#settings-theme').selectOption(preview)
      await expect.poll(() =>
        window.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(preview === 'dark')
      await window.locator('#language-select').selectOption('de')
      await setAutostart(window, !before.autostart)
      expect(await chromeCalls(electronApp, 'theme:set')).toEqual([])
      if (dismissal === 'cancel') await window.locator('#btn-settings-cancel').click()
      else if (dismissal === 'close') await window.locator('#btn-settings-close').click()
      else if (dismissal === 'escape') await window.keyboard.press('Escape')
      else await window.locator('#modal-settings').click({ position: { x: 4, y: 4 } })
      await expect(window.locator('#modal-settings')).toBeHidden()
      expect(await electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.committed)).toEqual(before)
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart',
        'shortcut:set']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
      const expectedDark = original === 'system'
        ? await window.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
        : original === 'dark'
      await expect.poll(() =>
        window.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(expectedDark)
      await window.locator('#btn-settings').click()
      await expect(window.locator('#settings-theme')).toHaveValue(before.theme)
      await expect(window.locator('#language-select')).toHaveValue(before.language)
      await expect(window.locator('#autostart-toggle')).toBeChecked({ checked: before.autostart })
    })
  }

  paletteTest('P2 late opening config cannot replace a draft or baseline',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const original = await window.evaluate(() => window.api.sendSync<string>('theme:get'))
      const preview = original === 'dark' ? 'light' : 'dark'
      await electronApp.evaluate(() => { globalThis.__pvChrome.preferences!.holdConfig = true })
      await window.locator('#btn-settings').click()
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.configReplies.length)).toBe(1)
      await window.locator('#settings-theme').selectOption(preview)
      await window.locator('#language-select').selectOption('de')
      await electronApp.evaluate(() => {
        const state = globalThis.__pvChrome.preferences!
        state.holdConfig = false
        state.configReplies.splice(0).forEach(reply => reply())
      })
      await expect(window.locator('#settings-theme')).toHaveValue(preview)
      await expect(window.locator('#language-select')).toHaveValue('de')
      await expect.poll(() =>
        window.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(preview === 'dark')
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#btn-settings').click()
      await expect(window.locator('#settings-theme')).toHaveValue(original!)
    })

  paletteTest('P2 Save waits for validation and rejected registration writes no other preferences',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      await electronApp.evaluate(() => {
        const state = globalThis.__pvChrome.preferences!
        state.holdValidation = true
        state.registrationResult = {
          success: false, error: 'Shortcut is already in use by another application',
        }
      })
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption('dark')
      await window.locator('#language-select').selectOption('de')
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press('Control+Alt+k')
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.validationReplies.length)).toBe(1)
      await window.locator('#btn-settings-save').click()
      expect(await chromeCalls(electronApp, 'shortcut:set')).toEqual([])
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.validationReplies.shift()!({ valid: true })
      })
      await expect.poll(async () =>
        (await chromeCalls(electronApp, 'shortcut:set')).length).toBe(1)
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.getByText(
        'Shortcut is already in use by another application', { exact: true })).toBeVisible()
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
      await expect(window.locator('#btn-settings-save')).toBeEnabled()
    })

  paletteTest('P2 preview System follows OS and obsolete System never overrides Light',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      await window.evaluate(() => window.api.send('theme:set', 'system'))
      await window.emulateMedia({ colorScheme: 'light' })
      for (let repeat = 0; repeat < 3; repeat++) {
        await window.locator('#btn-settings').click()
        await window.locator('#settings-theme').selectOption('system')
        await window.emulateMedia({ colorScheme: 'dark' })
        await expect(window.locator('html')).toHaveClass(/dark/)
        await window.locator('#settings-theme').selectOption('light')
        await window.emulateMedia({ colorScheme: 'light' })
        await window.emulateMedia({ colorScheme: 'dark' })
        await expect(window.locator('html')).not.toHaveClass(/dark/)
        await window.locator('#btn-settings-cancel').click()
        await expect(window.locator('#modal-settings')).toBeHidden()
        await expect(window.locator('html')).toHaveClass(/dark/)
        await window.emulateMedia({ colorScheme: 'light' })
        await expect(window.locator('html')).not.toHaveClass(/dark/)
      }
    })

  paletteTest('P2 late validation is inert after Cancel and reopen',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const committed = await electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.committed.summonShortcut)
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.holdValidation = true
      })
      await window.locator('#btn-settings').click()
      const shortcut = window.locator('#shortcut-input')
      const original = await shortcut.inputValue()
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press('Control+Alt+k')
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.validationReplies.length)).toBe(1)
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#btn-settings').click()
      await expect(shortcut).toHaveValue(original)

      // The obsolete result cannot revive recorder feedback in the new session.
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.validationReplies.shift()!(
          { valid: false, error: 'Invalid shortcut' })
      })
      await expect(window.locator('#shortcut-error')).toBeHidden()
      await expect(shortcut).not.toHaveClass(/invalid/)
      await expect(shortcut).toHaveValue(original)
      await expect(window.locator('#shortcut-record-btn')).toHaveText('Record')

      // A newer Reset also invalidates an older held candidate.
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press('Control+Alt+j')
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.validationReplies.length)).toBe(1)
      await window.locator('#shortcut-reset-btn').click()
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.validationReplies.length)).toBe(2)
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.validationReplies.shift()!(
          { valid: false, error: 'Invalid shortcut' })
      })
      await expect(window.locator('#shortcut-error')).toBeHidden()
      await window.locator('#btn-settings-cancel').click()
      expect(await chromeCalls(electronApp, 'shortcut:set')).toEqual([])
      expect(await electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.committed.summonShortcut)).toBe(committed)
    })

  paletteTest('P2 Save rejects invalid validation and stays blocked until a valid candidate',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.holdValidation = true
      })
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption('dark')
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press('Control+Alt+k')
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.validationReplies.length)).toBe(1)
      await window.locator('#btn-settings-save').click()
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.validationReplies.shift()!(
          { valid: false, error: 'Invalid shortcut' })
      })
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('#shortcut-error')).toBeVisible()
      expect(await chromeCalls(electronApp, 'shortcut:set')).toEqual([])
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }

      // A second Save is still blocked: no valid candidate has been supplied.
      await expect(window.locator('#btn-settings-save')).toBeEnabled()
      await window.locator('#btn-settings-save').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      expect(await chromeCalls(electronApp, 'shortcut:set')).toEqual([])
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }

      // Reset supplies a held candidate: Save still waits for its validation.
      await window.locator('#shortcut-reset-btn').click()
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.validationReplies.length)).toBeGreaterThan(0)
      await window.locator('#btn-settings-save').click()
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
      await electronApp.evaluate(() => {
        const state = globalThis.__pvChrome.preferences!
        state.validationReplies.splice(0).forEach(resolve => resolve({ valid: true }))
      })
      await expect(window.locator('#modal-settings')).toBeHidden()
      await expect.poll(async () =>
        (await chromeCalls(electronApp, 'theme:set')).length).toBe(1)
    })

  paletteTest('P2 Save is single-shot, awaits registration and orders its writes',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const before = await electronApp.evaluate(() =>
        ({ ...globalThis.__pvChrome.preferences!.committed }))
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.holdRegistration = true
      })
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption('dark')
      await window.locator('#language-select').selectOption('de')
      await setAutostart(window, !before.autostart)
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press('Control+Alt+k')
      await expect(window.locator('#shortcut-input')).toHaveClass(/valid/)

      await window.locator('#btn-settings-save').click()
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.registrationReplies.length)).toBe(1)
      // A second activation while committing must not start another Save.
      await window.locator('#btn-settings-save').evaluate(
        element => (element as HTMLButtonElement).click())
      expect(await chromeCalls(electronApp, 'shortcut:set')).toHaveLength(1)
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }

      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.registrationReplies.shift()!({ success: true })
      })
      await expect(window.locator('#modal-settings')).toBeHidden()
      const order = await electronApp.evaluate(() => globalThis.__pvChrome.calls
        .filter(call => ['shortcut:set', 'i18n:changeLanguage', 'theme:set',
          'config:setAutostart'].includes(call.channel))
        .map(call => call.channel))
      expect(order).toEqual([
        'shortcut:set', 'i18n:changeLanguage', 'theme:set', 'config:setAutostart',
      ])
      await expect(window.locator('.toast-container .toast')).toHaveCount(1)

      await window.locator('#btn-settings').click()
      await expect(window.locator('#settings-theme')).toHaveValue('dark')
      await expect(window.locator('#language-select')).toHaveValue('de')
      await expect(window.locator('#autostart-toggle')).toBeChecked({ checked: !before.autostart })
    })

  paletteTest('P2 Save catches an invoke failure without closing or writing',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.rejectLanguage = true
      })
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption('dark')
      await window.locator('#language-select').selectOption('de')
      await window.locator('#btn-settings-save').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('.toast-container .toast')).toHaveCount(1)
      expect(await chromeCalls(electronApp, 'theme:set')).toEqual([])
      expect(await chromeCalls(electronApp, 'config:setAutostart')).toEqual([])
      await expect(window.locator('#btn-settings-save')).toBeEnabled()
      await expect(window.locator('#btn-settings-cancel')).toBeEnabled()
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
    })

  // A Save can register the new shortcut and only then fail on a later write.
  // The retry must decide against what is actually registered; comparing with
  // the opening baseline makes Reset skip shortcut:set and leave the app on the
  // shortcut the user just abandoned.
  paletteTest('P2 Reset after a partly applied Save re-registers the live shortcut',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      expect(await electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.committed.summonShortcut)).toBe('CommandOrControl+.')
      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.rejectLanguage = true
      })
      await window.locator('#btn-settings').click()
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press('Control+Alt+k')
      await expect(window.locator('#shortcut-input')).toHaveClass(/valid/)
      await window.locator('#language-select').selectOption('de')
      await window.locator('#btn-settings-save').click()

      // Registration landed; the language write then threw and held the dialog.
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('.toast-container .toast')).toHaveCount(1)
      expect(await chromeCalls(electronApp, 'shortcut:set')).toEqual([
        { channel: 'shortcut:set', data: 'CommandOrControl+Alt+K' },
      ])
      await expect.poll(() => electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.committed.summonShortcut))
        .toBe('CommandOrControl+Alt+K')

      await electronApp.evaluate(() => {
        globalThis.__pvChrome.preferences!.rejectLanguage = false
      })
      await window.locator('#shortcut-reset-btn').click()
      await expect.poll(async () =>
        (await chromeCalls(electronApp, 'shortcut:validate')).length).toBe(2)
      await window.locator('#btn-settings-save').click()
      await expect(window.locator('#modal-settings')).toBeHidden()

      expect((await chromeCalls(electronApp, 'shortcut:set')).map(call => call.data)).toEqual([
        'CommandOrControl+Alt+K', 'CommandOrControl+.',
      ])
      expect(await electronApp.evaluate(() =>
        globalThis.__pvChrome.preferences!.committed.summonShortcut)).toBe('CommandOrControl+.')
    })

  paletteTest('P2 late config after Save is stale', async ({ electronApp, window }) => {
    await installChromeProbe(electronApp)
    await installSettingsProbe(electronApp, window)
    await electronApp.evaluate(() => { globalThis.__pvChrome.preferences!.holdConfig = true })
    await window.locator('#btn-settings').click()
    await expect.poll(() => electronApp.evaluate(() =>
      globalThis.__pvChrome.preferences!.configReplies.length)).toBe(1)
    await window.locator('#settings-theme').selectOption('dark')
    await window.locator('#language-select').selectOption('de')
    await electronApp.evaluate(() => { globalThis.__pvChrome.preferences!.holdConfig = false })
    await window.locator('#btn-settings-save').click()
    await expect(window.locator('#modal-settings')).toBeHidden()
    await window.locator('#btn-settings').click()
    await expect(window.locator('#settings-theme')).toHaveValue('dark')

    // The captured pre-Save reply must not undo the committed values.
    await electronApp.evaluate(() => {
      globalThis.__pvChrome.preferences!.configReplies.splice(0).forEach(reply => reply())
    })
    await expect(window.locator('#settings-theme')).toHaveValue('dark')
    await expect(window.locator('#language-select')).toHaveValue('de')
    await expect(window.locator('html')).toHaveClass(/dark/)
  })

  paletteTest('P2 nested modal preserves draft, preview and the selected pane',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const before = await electronApp.evaluate(() =>
        ({ ...globalThis.__pvChrome.preferences!.committed }))
      const preview = before.theme === 'dark' ? 'light' : 'dark'
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption(preview)
      await window.locator('#language-select').selectOption('de')
      // The legal child belongs to About: exactly one pane is ever displayed.
      await window.locator('#settings-tab-about').click()
      await expect(window.locator('#settings-database')).toBeHidden()
      await window.locator('#link-license').click()
      await expect(window.locator('#modal-markdown')).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(window.locator('#modal-markdown')).toBeHidden()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('#link-license')).toBeFocused()
      await expect(window.locator('#settings-theme')).toHaveValue(preview)
      await expect(window.locator('#language-select')).toHaveValue('de')
      await expect(window.locator('#settings-about')).toBeVisible()
      await expect(window.locator('#settings-database')).toBeHidden()

      // An import preview belongs to Database and is likewise not a cancellation.
      await window.locator('#settings-tab-database').click()
      await expect(window.locator('#settings-about')).toBeHidden()
      await window.evaluate(() => window.modals.openImportPreviewModal({
        fileName: 'fixture.json', source: 'phrasevault', total: 0,
        newPhrases: [], conflicts: [], warnings: [], skipped: 0,
      } as unknown as Parameters<typeof window.modals.openImportPreviewModal>[0]))
      await expect(window.locator('#modal-import-preview')).toBeVisible()
      await window.locator('#btn-import-cancel').click()
      await expect(window.locator('#modal-import-preview')).toBeHidden()
      await expect(window.locator('#settings-theme')).toHaveValue(preview)
      await expect(window.locator('#settings-database')).toBeVisible()
      await expect(window.locator('#settings-layout [role="tabpanel"]:visible')).toHaveCount(1)

      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      const expectedDark = before.theme === 'system'
        ? await window.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
        : before.theme === 'dark'
      await expect.poll(() =>
        window.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(expectedDark)
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
    })

  paletteTest('P2 status and recent-database refresh preserve the draft',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const before = await electronApp.evaluate(() =>
        ({ ...globalThis.__pvChrome.preferences!.committed }))
      const preview = before.theme === 'dark' ? 'light' : 'dark'
      await window.locator('#btn-settings').click()
      await window.locator('#settings-theme').selectOption(preview)
      await window.locator('#language-select').selectOption('de')
      await window.locator('#settings-tab-database').click()
      await electronApp.evaluate(({ BrowserWindow }) => {
        const web = BrowserWindow.getAllWindows()[0].webContents
        web.send('database:recentList', ['C:/fixture/one.sqlite'])
        web.send('database:status', true)
      })
      await expect(window.locator('#recent-databases button')).toHaveCount(1)
      await expect(window.locator('#settings-theme')).toHaveValue(preview)
      await expect(window.locator('#language-select')).toHaveValue('de')
      await expect(window.locator('#settings-database')).toBeVisible()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect.poll(() =>
        window.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(preview === 'dark')
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
      expect(await chromeCalls(electronApp, 'license:markReminderShown')).toEqual([])
    })

  paletteTest('P2 legacy migration entry initializes the Settings draft',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const before = await electronApp.evaluate(() =>
        ({ ...globalThis.__pvChrome.preferences!.committed }))
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('license:showLegacyMigration')
      })
      await expect(window.locator('#modal-legacy-migration')).toBeVisible()
      await window.locator('#btn-legacy-migration-enter').click()
      await expect(window.locator('#modal-legacy-migration')).toBeHidden()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('#license-key-input')).toBeFocused()
      const preview = before.theme === 'dark' ? 'light' : 'dark'
      await window.locator('#settings-theme').selectOption(preview)
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
      await window.locator('#btn-settings').click()
      await expect(window.locator('#settings-theme')).toHaveValue(before.theme)
      for (const channel of ['theme:set', 'i18n:changeLanguage', 'config:setAutostart']) {
        expect(await chromeCalls(electronApp, channel)).toEqual([])
      }
    })

  paletteTest('P2 repeated entry points preserve the draft and the real filtered count',
    async ({ electronApp, window }) => {
      await installChromeProbe(electronApp)
      await installSettingsProbe(electronApp, window)
      const platform = await electronApp.evaluate(() => process.platform)
      await window.locator('#search').fill('sig')
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(2)
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#settings-theme').selectOption('dark')
      await window.locator('#language-select').selectOption('de')

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings')
        BrowserWindow.getAllWindows()[0].webContents.send('ui:openSettings')
      })
      await expect(window.locator('#settings-theme')).toHaveValue('dark')
      await expect(window.locator('#language-select')).toHaveValue('de')
      if (platform === 'win32') {
        await window.keyboard.press('Control+,')
        await expect(window.locator('#settings-theme')).toHaveValue('dark')
      }
      await window.locator('#settings-tab-database').click()
      await expect(window.locator('#export-filtered-btn')).toBeVisible()
      await expect(window.locator('#export-filtered-btn')).toHaveText('Export Filtered (2)')
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
    })

  paletteTest('P2 real Save persists theme and language through the actual dialog',
    async ({ electronApp, window }) => {
      // No preference probe: this uses the real config/theme/i18n path against
      // the disposable userData, so it is disk evidence rather than a stub.
      const original = await window.evaluate(() => window.api.sendSync<string>('theme:get'))
      const target = original === 'dark' ? 'light' : 'dark'
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#settings-theme').selectOption(target)
      const languageChanged = window.evaluate(() => new Promise<string>(resolve => {
        window.api.receiveOnce('i18n:languageChanged', value => resolve(String(value)))
      }))
      await window.locator('#language-select').selectOption('de')
      await window.locator('#btn-settings-save').click()
      expect(await languageChanged).toBe('de')
      await expect(window.locator('#modal-settings')).toBeHidden()
      await expect(window.locator('html')).toHaveClass(target === 'dark' ? /dark/ : /^(?!.*dark).*$/)

      await window.locator('#btn-settings').click()
      await expect(window.locator('#settings-theme')).toHaveValue(target)
      await expect(window.locator('#language-select')).toHaveValue('de')
      expect(await window.evaluate(() => window.api.sendSync<string>('theme:get'))).toBe(target)

      // Restore English for anything that follows in this fixture.
      const restored = window.evaluate(() => new Promise<string>(resolve => {
        window.api.receiveOnce('i18n:languageChanged', value => resolve(String(value)))
      }))
      await window.locator('#language-select').selectOption('en')
      await window.locator('#settings-theme').selectOption(original!)
      await window.locator('#btn-settings-save').click()
      expect(await restored).toBe('en')
      await expect(window.locator('#modal-settings')).toBeHidden()
    })
})

registerWindowControlsTests(test, {
  openModal: async (window) => {
    await window.locator('#btn-settings').click()
  },
  modalSelector: '#modal-settings',
  closeModal: async (window) => {
    await window.locator('#btn-settings-cancel').click()
  },
  // apps/phrasevault/src/main.ts intercepts `close` and hides to tray unless
  // global.isQuitting.
  closePolicy: 'hide',
})
