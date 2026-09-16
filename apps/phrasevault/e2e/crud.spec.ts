/**
 * PhraseVault CRUD E2E Tests
 *
 * Tests for phrase create, read, update, delete operations.
 * Every mutation runs against the disposable palette fixture, so the seeded two-row
 * database is the only starting state and counts are exact.
 * Run with: pnpm --filter phrasevault test:e2e
 */

import {
  expect,
  waitForModalVisible,
  waitForModalHidden,
  closeModalViaEscape,
  waitForToast,
} from '@spqrkapps/shared/e2e'
import type { ElectronApplication, Page } from '@spqrkapps/shared/e2e'
import type { PhraseRow } from '../src/types'
import {
  calls,
  createPaletteTest,
  seedPalette,
  installPickerProbe,
  pickerRequests,
  pickerQueries,
  resolvePicker,
  rejectPicker,
} from './palette-fixture'

const test = createPaletteTest()

/** Rows seeded by seedPalette: 'sig' and 'signature formal'. */
const SEEDED_ROWS = 2

test.beforeEach(({ electronApp, window }) => seedPalette(electronApp, window))

// =============================================================================
// Test Helpers
// =============================================================================

/** Real phrase rows only; the Create affordance and status rows are not phrases. */
const PHRASE_ROWS = '#phrase-list > .phrase-item[data-id]'

/**
 * Generate a unique phrase name for testing
 */
function uniquePhraseName(prefix = 'test'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/** Wait for a settled read so counts are read from a real result, not a stale list. */
async function expectReady(window: Page): Promise<void> {
  await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
}

/**
 * Wait for phrase list to contain a phrase with given text
 */
async function waitForPhraseInList(
  window: Page,
  phraseText: string,
  timeout = 5000
): Promise<boolean> {
  try {
    const phraseItem = window.locator(PHRASE_ROWS, { hasText: phraseText })
    await phraseItem.first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

/**
 * Count phrases in the list
 */
async function getPhraseCount(window: Page): Promise<number> {
  return window.locator(PHRASE_ROWS).count()
}

/**
 * Click the action button on a phrase item
 */
async function clickPhraseAction(
  window: Page,
  phraseText: string,
  action: 'copy' | 'edit'
): Promise<void> {
  const phraseItem = window.locator(PHRASE_ROWS, { hasText: phraseText }).first()
  await phraseItem.locator(`[data-action="${action}"]`).click()
}

/**
 * Open the three-dot menu on a phrase and click an action
 */
async function clickPhraseMenuAction(
  window: Page,
  phraseText: string,
  action: 'copy-id' | 'duplicate' | 'delete'
): Promise<void> {
  const phraseItem = window.locator(PHRASE_ROWS, { hasText: phraseText }).first()
  await phraseItem.waitFor({ state: 'visible', timeout: 5000 })

  // Click the three-dot menu button using dispatchEvent to bypass overlay issues
  await phraseItem.locator('button[title="More"]').dispatchEvent('click')

  const menu = phraseItem.locator('.phrase-menu')
  await menu.waitFor({ state: 'visible', timeout: 3000 })

  await menu.locator(`[data-action="${action}"]`).dispatchEvent('click')
}

// =============================================================================
// Add Phrase Tests
// =============================================================================

test.describe('Add Phrase', () => {
  test('can add a new plain text phrase', async ({ window }) => {
    const phraseName = uniquePhraseName('addtest')
    const expandedText = 'This is the expanded text for testing'

    // Click add button
    await window.locator('#add-phrase').click()

    // Wait for modal
    const modalOpened = await waitForModalVisible(window, '#modal-phrase', 5000)
    expect(modalOpened).toBe(true)

    // Fill form
    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill(expandedText)

    // Ensure plain text type is selected
    const plainRadio = window.locator('input[name="phraseType"][value="text"]')
    await plainRadio.check()

    // Save
    await window.locator('#saveButton').click()

    // Wait for modal to close
    const modalClosed = await waitForModalHidden(window, '#modal-phrase', 5000)
    expect(modalClosed).toBe(true)

    // Verify toast
    const toast = await waitForToast(window, 3000)
    expect(toast).not.toBeNull()

    // Verify phrase appears in list
    await expectReady(window)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS + 1)
    const phraseFound = await waitForPhraseInList(window, phraseName, 3000)
    expect(phraseFound).toBe(true)
  })

  test('can add a markdown phrase', async ({ window }) => {
    const phraseName = uniquePhraseName('mdtest')
    const expandedText = '# Heading\n\n**Bold** text'

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')

    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill(expandedText)

    // Select markdown type
    const mdRadio = window.locator('input[name="phraseType"][value="markdown"]')
    await mdRadio.check()

    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')

    const phraseFound = await waitForPhraseInList(window, phraseName)
    expect(phraseFound).toBe(true)
  })

  test('shows error for empty phrase name', async ({ window }) => {
    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')

    // Leave phrase empty, fill expanded text
    await window.locator('#expandedTextInput').fill('Some text')

    // Try to save
    await window.locator('#saveButton').click()

    // Modal should stay open (validation failed)
    await expect(window.locator('#modal-phrase.active')).toBeVisible()

    // Close modal
    await closeModalViaEscape(window)
  })

  test('shows error for duplicate phrase name', async ({ window }) => {
    // The seeded fixture always provides a real existing name.
    const firstPhrase = window.locator(`${PHRASE_ROWS} strong`).first()
    const existingName = await firstPhrase.textContent()
    expect(existingName).toBeTruthy()

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')

    // Try to add phrase with same name
    await window.locator('#phraseInput').fill(existingName as string)
    await window.locator('#expandedTextInput').fill('Duplicate test')
    await window.locator('#saveButton').click()

    // Should show error toast
    const toast = await waitForToast(window, 3000)
    expect(toast).not.toBeNull()

    // Modal should stay open
    await expect(window.locator('#modal-phrase.active')).toBeVisible()

    await closeModalViaEscape(window)
  })
})

// =============================================================================
// Edit Phrase Tests
// =============================================================================

test.describe('Edit Phrase', () => {
  test('can edit an existing phrase', async ({ window }) => {
    // First, create a phrase to edit
    const originalName = uniquePhraseName('editoriginal')
    const newName = uniquePhraseName('editnew')

    // Add the phrase
    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(originalName)
    await window.locator('#expandedTextInput').fill('Original text')
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')
    await waitForPhraseInList(window, originalName)

    // Now edit it
    await clickPhraseAction(window, originalName, 'edit')

    await waitForModalVisible(window, '#modal-phrase')

    // Verify modal shows existing values
    await expect(window.locator('#phraseInput')).toHaveValue(originalName)

    // Change values
    await window.locator('#phraseInput').fill(newName)
    await window.locator('#expandedTextInput').fill('Updated text')

    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')

    // Verify updated phrase in list
    const newPhraseFound = await waitForPhraseInList(window, newName)
    expect(newPhraseFound).toBe(true)
  })

  test('edit modal can be cancelled', async ({ window }) => {
    // Seeded rows are always present; a missing row must fail, not skip.
    const firstPhrase = window.locator(PHRASE_ROWS).first()
    await expect(firstPhrase).toBeVisible()

    // Click edit
    await firstPhrase.locator('[data-action="edit"]').click()

    await waitForModalVisible(window, '#modal-phrase')

    // Get original value
    const originalValue = await window.locator('#phraseInput').inputValue()

    // Modify but don't save
    await window.locator('#phraseInput').fill('ShouldNotSave')

    // Cancel via ESC
    await closeModalViaEscape(window)
    await waitForModalHidden(window, '#modal-phrase')

    // Verify original value still in list (phrase wasn't changed)
    const originalFound = await waitForPhraseInList(window, originalValue)
    expect(originalFound).toBe(true)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)
  })
})

// =============================================================================
// Delete Phrase Tests
// =============================================================================

test.describe('Delete Phrase', () => {
  test('can delete a phrase', async ({ window }) => {
    // Create a phrase to delete
    const phraseName = uniquePhraseName('deletetest')

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill('To be deleted')
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')
    await waitForPhraseInList(window, phraseName)

    // Delete it via menu
    await clickPhraseMenuAction(window, phraseName, 'delete')

    // Verify toast appears
    const toast = await waitForToast(window, 3000)
    expect(toast).not.toBeNull()

    // Phrase should be hidden immediately
    await expect(window.locator(PHRASE_ROWS, { hasText: phraseName })).toBeHidden()
  })
})

// =============================================================================
// Duplicate Phrase Tests
// =============================================================================

test.describe('Duplicate Phrase', () => {
  test('can duplicate a phrase', async ({ window }) => {
    // Create a phrase to duplicate
    const phraseName = uniquePhraseName('duporiginal')

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill('Original to duplicate')
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')
    await waitForPhraseInList(window, phraseName)

    await window.locator('#search').fill('')
    await expectReady(window)
    const countBefore = await getPhraseCount(window)
    expect(countBefore).toBe(SEEDED_ROWS + 1)

    // Duplicate via menu. Duplication puts the new name in the search field, so wait
    // for that before clearing; otherwise the clear races the duplicated-name event.
    await clickPhraseMenuAction(window, phraseName, 'duplicate')
    await expect(window.locator('#search')).toHaveValue(new RegExp(phraseName))
    await window.locator('#search').fill('')
    await expectReady(window)

    // Verify count increased
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(countBefore + 1)

    // Verify toast
    const toast = await waitForToast(window, 3000)
    expect(toast).not.toBeNull()
  })
})

// =============================================================================
// Search Tests
// =============================================================================

test.describe('Search Phrases', () => {
  test('search filters phrases by name', async ({ window }) => {
    // Create a phrase with unique name
    const uniqueName = uniquePhraseName('searchunique')

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(uniqueName)
    await window.locator('#expandedTextInput').fill('Searchable content')
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')

    // Clear search and get full count
    await window.locator('#search').fill('')
    await expectReady(window)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS + 1)

    // Search for our unique phrase
    await window.locator('#search').fill(uniqueName)
    await expectReady(window)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(1)

    // Verify it's the right phrase
    const phraseFound = await waitForPhraseInList(window, uniqueName)
    expect(phraseFound).toBe(true)
  })

  test('search filters by expanded text', async ({ window }) => {
    const phraseName = uniquePhraseName('searchexp')
    const uniqueContent = `unique_content_${Date.now()}`

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill(uniqueContent)
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')

    // Search by expanded text content
    await window.locator('#search').fill(uniqueContent)
    await expectReady(window)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(1)
  })

  test('P0 Create retains literal text and content focus; Cancel writes nothing',
    async ({ electronApp, window }) => {
      const name = '<b>"É  welcome"</b> ' + 'long name '.repeat(30)
      const raw = '  ' + name + '  '
      const expectedName = raw.trim()
      await window.locator('#search').fill(raw)
      await window.locator('#search').press('Enter')
      await expect(window.locator('#modal-phrase')).toBeVisible()
      await expect(window.locator('#phraseInput')).toHaveValue(expectedName)
      await expect(window.locator('#expandedTextInput')).toHaveValue('')
      await expect(window.locator('input[name="phraseType"][value="text"]')).toBeChecked()
      await expect(window.locator('#idInput')).toHaveValue('')
      await expect(window.locator('#expandedTextInput')).toBeFocused()
      expect(await calls(electronApp, 'phrases:add')).toEqual([])
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      expect(await calls(electronApp, 'phrases:incrementUsage')).toEqual([])
      await window.keyboard.press('Escape')
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await expect(window.locator('#search')).toHaveValue(raw)
      const create = window.locator('[data-palette-action="create"]')
      await expect(create).toHaveCount(1)
      await expect(create).toHaveAccessibleName('Create "' + expectedName + '"')
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(0)
      await expect(create.locator('b')).toHaveCount(0)
      expect(await calls(electronApp, 'phrases:add')).toEqual([])
      await create.click()
      await window.locator('#expandedTextInput').fill('A deliberately saved response')
      await window.locator('#saveButton').click()
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await expect.poll(async () => (await calls(electronApp, 'phrases:add')).length).toBe(1)
      // Leading/trailing whitespace remains in search and affects exact ranking, not storage.
      await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(1)
    })

  test('P0 focused Create Enter is single-shot and a normal Add still focuses name',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('welcome client')
      const create = window.locator('[data-palette-action="create"]')
      await expect(create).toBeVisible()
      await window.locator('#search').press('ArrowDown')
      await expect(create).toBeFocused()
      await create.press('Enter')
      await expect(window.locator('#expandedTextInput')).toBeFocused()
      expect(await calls(electronApp, 'phrases:add')).toEqual([])
      await window.keyboard.press('Escape')
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await window.locator('#add-phrase').click()
      await expect(window.locator('#phraseInput')).toBeFocused()
      await expect(window.locator('#phraseInput')).toHaveValue('')
    })

  test('P0 unresolved and failed searches never offer Create',
    async ({ electronApp, window }) => {
      const beforeSearch = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = true
        globalThis.__pvP0.failNextSearch = true
      })
      await window.locator('#search').fill('missing but unavailable')
      await window.locator('#search').press('Enter')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'loading')
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(0)
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount)).toBe(beforeSearch + 1)
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = false; globalThis.__pvP0.releaseAll() })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'error')
      await expect(window.locator('#phrase-list')).toContainText('Search failed. Try again.')
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(0)
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await window.locator('#search-btn').click()
      await expect(window.locator('[data-palette-action="create"]')).toHaveCount(1)
    })

  test('P0 a loading read keeps the last settled rows and says nothing new',
    async ({ electronApp, window }) => {
      // Settle a known list first: the retained paint is whatever last settled.
      await window.locator('#search').fill('')
      await expectReady(window)
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)
      const statusBefore = (await window.locator('#palette-status').textContent()) ?? ''

      const beforeSearch = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      await window.locator('#search').fill('signature formal')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'loading')
      await expect(window.locator('#search')).toHaveAttribute('aria-busy', 'true')
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount))
        .toBe(beforeSearch + 1)

      // The list is not blanked and no "Searching…" row is painted.
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)
      await expect(window.locator('#phrase-list > li.palette-status-row')).toHaveCount(0)
      await expect(window.locator('#palette-status')).toHaveText(statusBefore)

      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = false
        globalThis.__pvP0.releaseAll()
      })
      await expectReady(window)
      await expect(window.locator('#search')).toHaveAttribute('aria-busy', 'false')
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(1)
      await expect(window.locator(PHRASE_ROWS).first()).toContainText('signature formal')
    })

  test('P0 a retained row absent from the settled reply inserts nothing',
    async ({ electronApp, window }) => {
      const rows = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const sig = rows.find(row => row.phrase === 'sig')!
      await window.locator('#search').fill('sig')
      await expectReady(window)
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)

      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      // A query the retained 'sig' row cannot survive.
      await window.locator('#search').fill('signature formal')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'loading')
      await window.locator('#phrase-list > .phrase-item[data-id="' + String(sig.id) + '"]')
        .dblclick()

      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = false
        globalThis.__pvP0.releaseAll()
      })
      await expectReady(window)
      // The settled reply does not contain the double-clicked row, so the Enter
      // intent resolves to nothing rather than to whichever row is now first.
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      expect(await calls(electronApp, 'phrases:incrementUsage')).toEqual([])
      await expect(window.locator('#modal-phrase')).toBeHidden()
    })

  test('P0 a retained row that survives the settled reply still inserts',
    async ({ electronApp, window }) => {
      const rows = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const signature = rows.find(row => row.phrase === 'signature formal')!
      await window.locator('#search').fill('')
      await expectReady(window)

      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      await window.locator('#search').fill('signature formal')
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'loading')
      const retained = window.locator('#phrase-list > .phrase-item[data-id="' + String(signature.id) + '"]')
      await retained.click()
      await retained.press('Enter')

      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = false
        globalThis.__pvP0.releaseAll()
      })
      await expect.poll(async () => (await calls(electronApp, 'phrases:insertById')).length).toBe(1)
      expect(String((await calls(electronApp, 'phrases:insertById'))[0].data))
        .toBe(String(signature.id))
    })

  test('P0 a database switch during a held read shows no rows from the previous database',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('')
      await expectReady(window)
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)
      const staleIds = await window.locator(PHRASE_ROWS)
        .evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.id ?? ''))
      expect(staleIds).toHaveLength(SEEDED_ROWS)

      const beforeSearch = await electronApp.evaluate(() => globalThis.__pvP0.searchCount)
      await electronApp.evaluate(() => { globalThis.__pvP0.holdSearch = true })
      // A switch bumps the generation, so this loading window belongs to the new
      // database. Retention is same-generation only.
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('database:switched')
      })
      await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'loading')
      await expect.poll(() => electronApp.evaluate(() => globalThis.__pvP0.searchCount))
        .toBe(beforeSearch + 1)
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(0)
      for (const id of staleIds) {
        await expect(window.locator('#phrase-list [data-id="' + id + '"]')).toHaveCount(0)
      }

      await electronApp.evaluate(() => {
        globalThis.__pvP0.holdSearch = false
        globalThis.__pvP0.releaseAll()
      })
      await expectReady(window)
    })

  test('clearing search shows all phrases', async ({ window }) => {
    // Get full count first
    await window.locator('#search').fill('')
    await expectReady(window)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)

    // Filter
    await window.locator('#search').fill('signature')
    await expectReady(window)
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(1)

    // Clear using the clear button
    const clearBtn = window.locator('#search-clear')
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()
    await expectReady(window)

    // Should be back to full count
    await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)
  })
})

// =============================================================================
// Copy to Clipboard Tests
// =============================================================================

test.describe('Copy to Clipboard', () => {
  test('copy button shows success toast', async ({ window }) => {
    // Seeded rows are always present; a missing Copy control must fail, not skip.
    const firstPhrase = window.locator(PHRASE_ROWS).first()
    await expect(firstPhrase).toBeVisible()

    const copyBtn = firstPhrase.locator('[data-action="copy"]')
    await expect(copyBtn).toBeVisible()
    await copyBtn.click()

    // Verify toast appears
    const toast = await waitForToast(window, 3000)
    expect(toast).not.toBeNull()
    const toastText = await toast?.textContent()
    expect(toastText?.toLowerCase()).toContain('copied')
  })

  test('copy phrase with dynamic inserts shows prompt modal', async ({ window }) => {
    // Create a phrase with dynamic insert
    const phraseName = uniquePhraseName('dynamiccopy')
    const dynamicText = 'Hello {{input:Name=World}}!'

    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill(dynamicText)
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')
    await waitForPhraseInList(window, phraseName)

    // Click copy on our dynamic phrase
    await clickPhraseAction(window, phraseName, 'copy')

    // Dynamic modal should appear
    const dynamicModalOpened = await waitForModalVisible(window, '#modal-dynamic', 5000)
    expect(dynamicModalOpened).toBe(true)

    // Fill in the input
    const dynamicInput = window.locator('#modal-dynamic input').first()
    await dynamicInput.fill('TestName')

    // Submit
    await window.locator('#btn-dynamic-insert').click()

    // Modal should close
    await waitForModalHidden(window, '#modal-dynamic')

    // Toast should appear
    const toast = await waitForToast(window, 3000)
    expect(toast).not.toBeNull()
  })
})

// =============================================================================
// Phase 2 chrome: the single guarded blank Add entry point
// =============================================================================

test.describe('P2 blank Add', () => {
  for (const entry of ['button', 'accelerator'] as const) {
    test('P2 blank Add via ' + entry + ' preserves query and Cancel writes nothing',
      async ({ electronApp, window }) => {
        await window.locator('#search').fill('sig')
        await expect(window.locator(PHRASE_ROWS).first().locator('strong')).toHaveText('sig')
        if (entry === 'button') await window.locator('#add-phrase').click()
        else {
          const platform = await window.evaluate(() => window.platform)
          await window.keyboard.press(platform === 'darwin' ? 'Meta+n' : 'Control+n')
        }
        await expect(window.locator('#modal-phrase.active')).toHaveCount(1)
        await expect(window.locator('#phraseInput')).toHaveValue('')
        await expect(window.locator('#expandedTextInput')).toHaveValue('')
        await expect(window.locator('#idInput')).toHaveValue('')
        await expect(window.locator('input[name="phraseType"][value="text"]')).toBeChecked()
        await expect(window.locator('#phraseInput')).toBeFocused()
        await window.keyboard.press('Escape')
        await expect(window.locator('#modal-phrase')).toBeHidden()
        await expect(window.locator('#search')).toHaveValue('sig')
        expect(await calls(electronApp, 'phrases:add')).toEqual([])
        expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      })
  }

  test('P2 Add accelerator rejects modified, repeated and composing keys', async ({ window }) => {
    await window.locator('#search').focus()
    for (const guard of ['repeat', 'altKey', 'shiftKey', 'isComposing', 'otherModifier', 'noModifier']) {
      await window.evaluate(guard => {
        const mac = window.platform === 'darwin'
        const init: KeyboardEventInit = {
          key: 'n', bubbles: true, cancelable: true, ctrlKey: !mac, metaKey: mac,
        }
        if (guard === 'otherModifier') { init.ctrlKey = true; init.metaKey = true }
        else if (guard === 'noModifier') { init.ctrlKey = false; init.metaKey = false }
        else if (guard === 'repeat') init.repeat = true
        else if (guard === 'altKey') init.altKey = true
        else if (guard === 'shiftKey') init.shiftKey = true
        else init.isComposing = true
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', init))
      }, guard)
      await expect(window.locator('#modal-phrase')).toBeHidden()
    }
  })

  test('P2 Add accelerator yields to open modals, recording and composition',
    async ({ electronApp, window }) => {
      const platform = await window.evaluate(() => window.platform)
      const chord = platform === 'darwin' ? 'Meta+n' : 'Control+n'

      // Settings owns the stack: no second editor and no writes.
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.keyboard.press(chord)
      await expect(window.locator('#modal-phrase')).toBeHidden()

      // Record owns keyboard input while Settings is open.
      await window.locator('#shortcut-record-btn').click()
      await window.keyboard.press(chord)
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await window.locator('#shortcut-record-btn').click()
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()

      // A single blank editor is already open: the chord adds nothing.
      await window.locator('#add-phrase').click()
      await expect(window.locator('#modal-phrase.active')).toHaveCount(1)
      await window.keyboard.press(chord)
      await expect(window.locator('#modal-phrase.active')).toHaveCount(1)
      await window.keyboard.press('Escape')
      await expect(window.locator('#modal-phrase')).toBeHidden()

      // Composition in the search field blocks the chord.
      await window.locator('#search').focus()
      await window.evaluate(() => {
        document.getElementById('search')!
          .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      })
      await window.keyboard.press(chord)
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await window.evaluate(() => {
        document.getElementById('search')!
          .dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      })

      // openBlankPhrase also requires document.hasFocus() and !document.hidden.
      // Playwright's focus/visibility emulation pins both, so those two guards
      // are native gates rather than assertions this fixture can drive.

      expect(await calls(electronApp, 'phrases:add')).toEqual([])
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  test('P2 native Enter and Space activate each moved control without inserting',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('sig')
      await expect(window.locator(PHRASE_ROWS).first().locator('strong')).toHaveText('sig')

      // Search: flushes only. Never an editor, never an insert.
      for (const key of ['Enter', 'Space']) {
        await window.locator('#search-btn').focus()
        await window.keyboard.press(key)
        await expect(window.locator('#modal-phrase')).toBeHidden()
        await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
      }

      // Add: opens the blank editor from the keyboard.
      for (const key of ['Enter', 'Space']) {
        await window.locator('#add-phrase').focus()
        await window.keyboard.press(key)
        await expect(window.locator('#modal-phrase.active')).toHaveCount(1)
        await expect(window.locator('#phraseInput')).toHaveValue('')
        await window.keyboard.press('Escape')
        await expect(window.locator('#modal-phrase')).toBeHidden()
      }

      // Settings gear: opens Settings from the keyboard.
      for (const key of ['Enter', 'Space']) {
        await window.locator('#btn-settings').focus()
        await window.keyboard.press(key)
        await expect(window.locator('#modal-settings')).toBeVisible()
        await window.locator('#btn-settings-cancel').click()
        await expect(window.locator('#modal-settings')).toBeHidden()
      }

      await expect(window.locator('#search')).toHaveValue('sig')
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      expect(await calls(electronApp, 'phrases:add')).toEqual([])
    })
})

// =============================================================================
// ESC Key Behavior Tests
// =============================================================================

test.describe('ESC Key Priority', () => {
  test('ESC closes modal before affecting window', async ({ window }) => {
    // Open settings modal
    await window.locator('#btn-settings').click()
    await waitForModalVisible(window, '#modal-settings')

    // Press ESC
    await window.keyboard.press('Escape')

    // Modal should be closed
    const modalHidden = await waitForModalHidden(window, '#modal-settings', 2000)
    expect(modalHidden).toBe(true)

    // Window should still be visible (not minimized)
    const bodyVisible = await window.locator('body').isVisible()
    expect(bodyVisible).toBe(true)
  })

  test('ESC closes dynamic modal without affecting window', async ({ window }) => {
    // Create a phrase with dynamic content
    const phraseName = uniquePhraseName('esctest')
    await window.locator('#add-phrase').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phraseInput').fill(phraseName)
    await window.locator('#expandedTextInput').fill('{{input:Test}}')
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')
    await waitForPhraseInList(window, phraseName)

    // Click copy to trigger dynamic modal
    await clickPhraseAction(window, phraseName, 'copy')
    await waitForModalVisible(window, '#modal-dynamic')

    // Press ESC
    await window.keyboard.press('Escape')

    // Dynamic modal should be closed
    const dynamicHidden = await waitForModalHidden(window, '#modal-dynamic', 2000)
    expect(dynamicHidden).toBe(true)

    // Window should still be visible
    const bodyVisible = await window.locator('body').isVisible()
    expect(bodyVisible).toBe(true)
  })
})

// =============================================================================
// Wave 2 composer: labelled form, insert shelf, More disclosure and Cancel
//
// Every case drives the real composer through the disposable fixture. Native
// undo/redo is keyboard-driven; synthetic events appear only where a guard,
// not an edit transaction, is under test.
// =============================================================================

/** Exact literal and post-insert selection contract from the locked spec. */
const insertCases = [
  { id: 'date', token: '{{date}}', range: [8, 8], more: false },
  { id: 'time', token: '{{time}}', range: [8, 8], more: false },
  { id: 'clipboard', token: '{{clipboard}}', range: [13, 13], more: false },
  { id: 'field', token: '{{input:Label}}', range: [8, 13], more: false },
  { id: 'choice', token: '{{select:Tone=Formal,*Casual}}', range: [14, 28], more: false },
  { id: 'datetime', token: '{{datetime}}', range: [12, 12], more: true },
  { id: 'weekday', token: '{{weekday}}', range: [11, 11], more: true },
  { id: 'month', token: '{{month}}', range: [9, 9], more: true },
  { id: 'year', token: '{{year}}', range: [8, 8], more: true },
  { id: 'textarea', token: '{{textarea:Label}}', range: [11, 16], more: true },
] as const

/**
 * Open a blank composer and let its own delayed Name focus settle first, so a
 * later focus/typing step races nothing.
 */
async function openBlankComposer(window: Page): Promise<void> {
  await window.locator('#add-phrase').click()
  await expect(window.locator('#phraseInput')).toBeFocused()
}

/** Read the live textarea selection as a tuple. */
async function bodyRange(window: Page): Promise<number[]> {
  return window.locator('#expandedTextInput').evaluate(
    (el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
}

/**
 * Drive the real visibilitychange listener with document.hidden true for exactly
 * one synchronous dispatch, then hand the property back to the platform.
 */
async function hideDocument(window: Page): Promise<void> {
  await window.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    Reflect.deleteProperty(document, 'hidden')
  })
}

/**
 * Wait past the rendering turn the deferred composition insert would use, so a
 * "nothing was inserted" assertion cannot pass merely by running too early.
 */
async function settleFrames(window: Page): Promise<void> {
  await window.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

/**
 * Indexes of the composer's own empty-query reads among all held searches, so a
 * palette refresh under a nonempty query is never mistaken for a picker refresh.
 */
async function pickerReads(electronApp: ElectronApplication): Promise<number[]> {
  const queries = await pickerQueries(electronApp)
  return queries.flatMap((query, index) => (query === '' ? [index] : []))
}

test.describe('UI W2 insert shelf', () => {
  for (const entry of insertCases) {
    test('UI W2 literal and selection ' + entry.id, async ({ window }) => {
      await openBlankComposer(window)
      await expect(window.locator('#phraseInput')).toBeFocused()
      if (entry.more) await window.locator('#phrase-insert-more').click()
      const body = window.locator('#expandedTextInput')
      // Emoji and newline neighbours prove UTF-16 offsets replace only the
      // selected range and leave surrounding text intact.
      await body.fill('A\u{1F600}\nBC')
      await body.evaluate((el: HTMLTextAreaElement) => {
        el.focus()
        el.setSelectionRange(1, 5, 'backward')
      })
      await window.locator('#phrase-insert-' + entry.id).click()
      await expect(body).toHaveValue('A' + entry.token + 'C')
      await expect(body).toBeFocused()
      expect(await bodyRange(window)).toEqual(entry.range.map(offset => offset + 1))
      if (entry.more) await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
    })
  }

  for (const caret of ['start', 'middle', 'end'] as const) {
    test('UI W2 collapsed caret at ' + caret + ' inserts without disturbing text',
      async ({ window }) => {
        await openBlankComposer(window)
        const body = window.locator('#expandedTextInput')
        await body.fill('one\ntwo')
        const offset = caret === 'start' ? 0 : caret === 'middle' ? 3 : 7
        await body.evaluate((el: HTMLTextAreaElement, offset) => {
          el.focus()
          el.setSelectionRange(offset, offset)
        }, offset)
        await window.locator('#phrase-insert-date').click()
        const source = 'one\ntwo'
        await expect(body).toHaveValue(
          source.slice(0, offset) + '{{date}}' + source.slice(offset))
        expect(await bodyRange(window)).toEqual([offset + 8, offset + 8])
      })
  }

  test('UI W2 initial range is body end before the textarea is ever focused',
    async ({ window }) => {
      await window.locator('#search').fill('sig')
      await expect(window.locator(PHRASE_ROWS).first().locator('strong')).toHaveText('sig')
      // Edit opens with existing content; the shelf must append at the end
      // rather than at offset zero, without a prior textarea click.
      await window.locator(PHRASE_ROWS).first().locator('[data-action="edit"]').click()
      const body = window.locator('#expandedTextInput')
      const original = await body.inputValue()
      expect(original.length).toBeGreaterThan(0)
      await window.locator('#phrase-insert-time').click()
      await expect(body).toHaveValue(original + '{{time}}')
    })

  test('UI W2 blank Add starts the saved range at zero', async ({ window }) => {
    await openBlankComposer(window)
    await expect(window.locator('#phraseInput')).toBeFocused()
    await window.locator('#phrase-insert-date').click()
    await expect(window.locator('#expandedTextInput')).toHaveValue('{{date}}')
  })

  test('UI W2 keyboard Tab to a chip preserves the range', async ({ window }) => {
    await openBlankComposer(window)
    const body = window.locator('#expandedTextInput')
    await body.fill('alpha')
    await body.evaluate((el: HTMLTextAreaElement) => {
      el.focus()
      el.setSelectionRange(0, 5)
    })
    // Tab moves focus off the textarea; the saved range must survive and the
    // chip must be reachable and activatable from the keyboard alone. The shelf
    // precedes the editor, so backwards traversal reaches More and then Choice.
    await window.keyboard.press('Shift+Tab')
    await expect(window.locator('#phrase-insert-more')).toBeFocused()
    await window.keyboard.press('Shift+Tab')
    await expect(window.locator('#phrase-insert-choice')).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(body).toHaveValue('{{select:Tone=Formal,*Casual}}')
    await expect(body).toBeFocused()
    expect(await bodyRange(window)).toEqual([14, 28])
  })

  test('UI W2 repeated activation inserts a second independent token',
    async ({ window }) => {
      await openBlankComposer(window)
      const body = window.locator('#expandedTextInput')
      await body.focus()
      await window.locator('#phrase-insert-date').click()
      await window.locator('#phrase-insert-time').click()
      await expect(body).toHaveValue('{{date}}{{time}}')
      expect(await bodyRange(window)).toEqual([16, 16])
    })

  test('UI W2 backward multiline selection replaces only the selected text',
    async ({ window }) => {
      await openBlankComposer(window)
      const body = window.locator('#expandedTextInput')
      await body.fill('head\nmiddle\ntail')
      await body.evaluate((el: HTMLTextAreaElement) => {
        el.focus()
        el.setSelectionRange(5, 11, 'backward')
      })
      await window.locator('#phrase-insert-field').click()
      await expect(body).toHaveValue('head\n{{input:Label}}\ntail')
      expect(await bodyRange(window)).toEqual([13, 18])
    })

  test('UI W2 native undo isolates two inserts and adjacent typing', async ({ window }) => {
    await openBlankComposer(window)
    const body = window.locator('#expandedTextInput')
    await body.focus()
    await window.keyboard.type('before')
    await window.locator('#phrase-insert-date').click()
    await window.locator('#phrase-insert-time').click()
    await window.keyboard.type('after')
    await expect(body).toHaveValue('before{{date}}{{time}}after')
    const mac = await window.evaluate(() => window.platform === 'darwin')
    const undo = mac ? 'Meta+z' : 'Control+z'
    const redo = mac ? 'Meta+Shift+z' : 'Control+y'
    for (const value of ['before{{date}}{{time}}', 'before{{date}}', 'before']) {
      await window.keyboard.press(undo)
      await expect(body).toHaveValue(value)
    }
    await window.keyboard.press(redo)
    await expect(body).toHaveValue('before{{date}}')
    await window.keyboard.press(redo)
    await expect(body).toHaveValue('before{{date}}{{time}}')
  })

  test('UI W2 native undo restores a replaced typed selection', async ({ window }) => {
    await openBlankComposer(window)
    const body = window.locator('#expandedTextInput')
    await body.focus()
    await window.keyboard.type('beforeTARGETafter')
    await body.evaluate((el: HTMLTextAreaElement) => {
      el.focus()
      el.setSelectionRange(6, 12)
    })
    await window.locator('#phrase-insert-date').click()
    await expect(body).toHaveValue('before{{date}}after')
    const mac = await window.evaluate(() => window.platform === 'darwin')
    await window.keyboard.press(mac ? 'Meta+z' : 'Control+z')
    await expect(body).toHaveValue('beforeTARGETafter')
    await window.keyboard.press(mac ? 'Meta+Shift+z' : 'Control+y')
    await expect(body).toHaveValue('before{{date}}after')
  })

  test('UI W2 a rejected native edit keeps the draft and warns', async ({ window }) => {
    await openBlankComposer(window)
    const body = window.locator('#expandedTextInput')
    await body.fill('keep me')
    await body.evaluate((el: HTMLTextAreaElement) => {
      el.focus()
      el.setSelectionRange(0, 4)
    })
    // Only this failure-path case spies on the primitive. A refused command must
    // never be followed by a value/setRangeText fallback that destroys history.
    await window.evaluate(() => {
      document.execCommand = () => false
    })
    await window.locator('#phrase-insert-date').click()
    await expect(body).toHaveValue('keep me')
    expect(await bodyRange(window)).toEqual([0, 4])
    await expect(window.locator('.toast-container .toast'))
      .toContainText('Could not insert the token. Try again.')
  })

  test('UI W2 the clipboard token stays an unevaluated literal',
    async ({ electronApp, window }) => {
      const name = uniquePhraseName('clip')
      await openBlankComposer(window)
      await window.locator('#phraseInput').fill(name)
      await window.locator('#expandedTextInput').focus()
      await window.locator('#phrase-insert-clipboard').click()
      await expect(window.locator('#expandedTextInput')).toHaveValue('{{clipboard}}')
      // Editing never expands a token: no insertion or usage IPC, and the saved
      // draft still reopens as the literal. What main does at paste time is a
      // different boundary and is deliberately not claimed here.
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      expect(await calls(electronApp, 'phrases:incrementUsage')).toEqual([])
      await window.locator('#saveButton').click()
      await waitForModalHidden(window, '#modal-phrase')
      await waitForPhraseInList(window, name)
      await clickPhraseAction(window, name, 'edit')
      await waitForModalVisible(window, '#modal-phrase')
      await expect(window.locator('#expandedTextInput')).toHaveValue('{{clipboard}}')
    })
})

test.describe('UI W2 composer lifetime', () => {
  test('UI W2 More Escape precedes composer discard', async ({ electronApp, window }) => {
    await openBlankComposer(window)
    await window.locator('#phraseInput').fill('unsaved')
    await window.locator('#phrase-insert-more').click()
    await expect(window.locator('#phrase-insert-more')).toHaveAttribute('aria-expanded', 'true')
    await window.locator('#phrase-insert-year').focus()
    await window.keyboard.press('Escape')
    await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
    await expect(window.locator('#phrase-insert-more')).toBeFocused()
    await expect(window.locator('#modal-phrase')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.locator('#modal-phrase')).toBeHidden()
    expect(await calls(electronApp, 'phrases:add')).toEqual([])
    expect(await calls(electronApp, 'phrases:edit')).toEqual([])
  })

  test('UI W2 More stays open for interior clicks and inserts', async ({ window }) => {
    await openBlankComposer(window)
    await window.locator('#phrase-insert-more').click()
    const panel = window.locator('#phrase-insert-more-panel')
    await expect(panel).toBeVisible()
    await window.locator('#expandedTextInput').click()
    await expect(panel).toBeVisible()
    await window.locator('#phrase-insert-year').click()
    await expect(panel).toBeVisible()
    await expect(window.locator('#expandedTextInput')).toHaveValue('{{year}}')
    // Toggling More back closed retains focus on its own button.
    await window.locator('#phrase-insert-more').click()
    await expect(panel).toBeHidden()
    await expect(window.locator('#phrase-insert-more')).toBeFocused()
  })

  test('UI W2 hidden secondary controls never receive Tab', async ({ window }) => {
    await openBlankComposer(window)
    await window.locator('#expandedTextInput').focus()
    // The disclosure sits between the shelf and the editor, so a closed panel
    // that still took focus would be caught on the way back to More.
    await window.keyboard.press('Shift+Tab')
    await expect(window.locator('#phrase-insert-more')).toBeFocused()
    await window.locator('#phrase-insert-more').click()
    await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
    await expect(window.locator('#phrase-picker')).toBeEnabled()
    await window.locator('#expandedTextInput').focus()
    await window.keyboard.press('Shift+Tab')
    // Open, the same traversal reaches the picker instead of More. The picker is
    // the control reached before the textarea, and Retry is hidden.
    await expect(window.locator('#phrase-insert-more')).not.toBeFocused()
    await expect(window.locator('#phrase-picker')).toBeFocused()
    await expect(window.locator('#phrase-picker-retry')).toBeHidden()
  })

  test('UI W2 composition queues one edit after final input', async ({ window }) => {
    await openBlankComposer(window)
    const body = window.locator('#expandedTextInput')
    await body.focus()
    await body.dispatchEvent('compositionstart', { data: '' })
    // Synthetic activation tests the queue guard only; native IME is a separate gate.
    await window.locator('#phrase-insert-date').dispatchEvent('click')
    await window.locator('#phrase-insert-time').dispatchEvent('click')
    await expect(body).toBeFocused()
    await expect(body).toHaveValue('')
    await body.evaluate((el: HTMLTextAreaElement) => {
      el.value = '\u65E5\u672C'
      el.setSelectionRange(2, 2)
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '\u65E5\u672C' }))
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertCompositionText', data: '\u65E5\u672C', isComposing: false,
      }))
    })
    await expect(body).toHaveValue('\u65E5\u672C{{date}}')
  })

  /** Boundaries that end the whole form, not just the deferred token. */
  const CLOSING_BOUNDARIES = ['cancel', 'header', 'escape', 'backdrop', 'save'] as const
  // Pressing More is not a boundary any more: while a composition is live the
  // disclosure is a no-op, so it cannot close and cancel the queued token. Its
  // own contract is proved by the trusted-press test below.
  const QUEUE_BOUNDARIES = [
    ...CLOSING_BOUNDARIES, 'blur', 'hide', 'composition', 'reopen',
  ] as const

  for (const boundary of QUEUE_BOUNDARIES) {
    test('UI W2 queued composition insert is cancelled by ' + boundary,
      async ({ electronApp, window }) => {
        const closes = (CLOSING_BOUNDARIES as readonly string[]).includes(boundary)
        await openBlankComposer(window)
        const body = window.locator('#expandedTextInput')
        if (boundary === 'save') {
          await window.locator('#phraseInput').fill(uniquePhraseName('queued'))
        }
        await body.focus()
        await body.dispatchEvent('compositionstart', { data: '' })
        await window.locator('#phrase-insert-date').dispatchEvent('click')

        if (boundary === 'cancel') await window.locator('#btn-phrase-cancel').click()
        else if (boundary === 'header') await window.locator('#btn-phrase-close').click()
        else if (boundary === 'escape') await window.keyboard.press('Escape')
        // A real click on the overlay node, never a call into closePhraseModal.
        else if (boundary === 'backdrop') {
          await window.locator('#modal-phrase').click({ position: { x: 4, y: 4 } })
        } else if (boundary === 'save') await window.locator('#saveButton').click()
        else if (boundary === 'blur') {
          await window.evaluate(() => window.dispatchEvent(new Event('blur')))
        } else if (boundary === 'hide') await hideDocument(window)
        else if (boundary === 'reopen') {
          await window.evaluate(() => window.modals.openPhraseForm('', '', 'text', null, {}))
        } else await body.dispatchEvent('compositionstart', { data: '' })

        if (closes) await expect(window.locator('#modal-phrase')).toBeHidden()

        // Release the old composition after the boundary; nothing may leak.
        await body.evaluate((el: HTMLTextAreaElement) => {
          el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '\u3042' }))
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true, inputType: 'insertCompositionText', data: '\u3042', isComposing: false,
          }))
        })
        await settleFrames(window)
        // The draft is the composition's own text only; no token may appear.
        await expect(body).toHaveValue('')
        if (closes) {
          await openBlankComposer(window)
          await expect(window.locator('#expandedTextInput')).toHaveValue('')
        }
        if (boundary === 'save') {
          // A submitted form stored the draft it showed, without the queued token.
          const added = await calls(electronApp, 'phrases:add')
          expect(added).toHaveLength(1)
          expect((added[0].data as { newExpandedText: string }).newExpandedText).toBe('')
        }
      })
  }

  test('UI W2 a composing Escape closes neither More nor the composer',
    async ({ window }) => {
      await openBlankComposer(window)
      const body = window.locator('#expandedTextInput')
      await body.focus()
      await window.locator('#phrase-insert-more').click()
      await body.dispatchEvent('compositionstart', { data: '' })
      await window.locator('#phrase-insert-year').dispatchEvent('click')
      // A composition owns its own Escape before any disclosure or dismissal.
      await body.dispatchEvent('keydown', {
        key: 'Escape', isComposing: true, bubbles: true, cancelable: true,
      })
      await expect(window.locator('#modal-phrase')).toBeVisible()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      await body.evaluate((el: HTMLTextAreaElement) => {
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '\u3042' }))
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertCompositionText', data: '\u3042', isComposing: false,
        }))
      })
      // The token queued for that composition is still cancelled.
      await settleFrames(window)
      await expect(body).toHaveValue('')
    })

  test('UI W2 a real chip press during composition never moves focus',
    async ({ window }) => {
      await openBlankComposer(window)
      const body = window.locator('#expandedTextInput')
      await body.focus()
      await window.evaluate(() => {
        delete document.body.dataset.pvPointerPrevented
        document.addEventListener('pointerdown', (event) => {
          document.body.dataset.pvPointerPrevented = String(event.defaultPrevented)
        }, { once: true })
      })
      await body.dispatchEvent('compositionstart', { data: '' })
      // A trusted press, not a synthetic click: only the real pointerdown default
      // can steal focus from the textarea and settle the composition.
      await window.locator('#phrase-insert-date').hover()
      await window.mouse.down()
      expect(await window.evaluate(() => document.body.dataset.pvPointerPrevented)).toBe('true')
      await expect(body).toBeFocused()
      await window.mouse.up()
      // The click still arrives and queues exactly one token.
      await expect(body).toBeFocused()
      await expect(body).toHaveValue('')
      await body.evaluate((el: HTMLTextAreaElement) => {
        el.value = '\u65e5'
        el.setSelectionRange(1, 1)
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '\u65e5' }))
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertCompositionText', data: '\u65e5', isComposing: false,
        }))
      })
      await expect(body).toHaveValue('\u65e5{{date}}')
    })

  test('UI W2 a real More press during composition neither moves focus nor toggles',
    async ({ window }) => {
      await openBlankComposer(window)
      const body = window.locator('#expandedTextInput')
      await body.focus()
      await window.evaluate(() => {
        delete document.body.dataset.pvPointerPrevented
        document.addEventListener('pointerdown', (event) => {
          document.body.dataset.pvPointerPrevented = String(event.defaultPrevented)
        }, { once: true })
      })
      await body.dispatchEvent('compositionstart', { data: '' })
      // The chevron is the hit target a real pointer lands on at the right edge
      // of More, so the whole shelf contract is exercised, not just the label.
      await window.locator('#phrase-insert-more .phrase-insert-chevron').hover()
      await window.mouse.down()
      expect(await window.evaluate(() => document.body.dataset.pvPointerPrevented)).toBe('true')
      await expect(body).toBeFocused()
      await window.mouse.up()
      // The disclosure is a no-op while composing: focus, selection and the
      // panel are all left as the composition found them.
      await expect(body).toBeFocused()
      await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
      await expect(window.locator('#phrase-insert-more'))
        .toHaveAttribute('aria-expanded', 'false')
      await expect(body).toHaveValue('')
      await body.evaluate((el: HTMLTextAreaElement) => {
        el.value = '日'
        el.setSelectionRange(1, 1)
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日' }))
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertCompositionText', data: '日', isComposing: false,
        }))
      })
      await settleFrames(window)
      // Nothing was queued by the refused press, and More opens normally once
      // the user has finished composing.
      await expect(body).toHaveValue('日')
      await window.locator('#phrase-insert-more').click()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      await expect(window.locator('#phrase-insert-more')).toBeFocused()
    })

  test('UI W2 a More press during composition keeps the panel and its queued token',
    async ({ window }) => {
      await openBlankComposer(window)
      const body = window.locator('#expandedTextInput')
      await body.focus()
      await window.locator('#phrase-insert-more').click()
      await body.focus()
      await body.dispatchEvent('compositionstart', { data: '' })
      await window.locator('#phrase-insert-year').dispatchEvent('click')
      // Pressing More cannot collapse the panel mid-composition, so the queued
      // secondary token is not cancelled with it.
      await window.locator('#phrase-insert-more .phrase-insert-chevron').hover()
      await window.mouse.down()
      await window.mouse.up()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      await expect(body).toBeFocused()
      await body.evaluate((el: HTMLTextAreaElement) => {
        el.value = 'あ'
        el.setSelectionRange(1, 1)
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'あ' }))
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertCompositionText', data: 'あ', isComposing: false,
        }))
      })
      await settleFrames(window)
      await expect(body).toHaveValue('あ{{year}}')
    })

  test('UI W2 a backdrop click runs the same composer teardown as Cancel',
    async ({ electronApp, window }) => {
      const seeded = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const late: PhraseRow = { ...seeded[0], id: 9201, phrase: 'late row', short_id: 'late002' }
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      // A real click on the overlay node, never a call into closePhraseModal.
      await window.locator('#modal-phrase').click({ position: { x: 4, y: 4 } })
      await expect(window.locator('#modal-phrase')).toBeHidden()
      // Dismissal is a real close, so the disclosure collapses and the session is
      // invalidated instead of being merely hidden with the dialog.
      await expect(window.locator('#phrase-insert-more'))
        .toHaveAttribute('aria-expanded', 'false')
      await resolvePicker(electronApp, 0, [late])
      await openBlankComposer(window)
      await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
      await expect(window.locator('#phrase-picker option[value="9201"]')).toHaveCount(0)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(2)
      await expect(window.locator('#phrase-picker option[value="9201"]')).toHaveCount(0)
    })

  test('UI W2 the focused phrase select consumes its own Escape', async ({ window }) => {
    await openBlankComposer(window)
    await window.locator('#phrase-insert-more').click()
    const picker = window.locator('#phrase-picker')
    await expect(picker).toBeEnabled()
    await picker.focus()
    await window.keyboard.press('Escape')
    // The native control cancels its own interaction first; More survives it.
    await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
    await expect(window.locator('#modal-phrase')).toBeVisible()
    await expect(picker).toBeFocused()
    // Away from the select, Escape resumes closing the disclosure first.
    await window.locator('#phrase-insert-more').focus()
    await window.keyboard.press('Escape')
    await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
    await expect(window.locator('#modal-phrase')).toBeVisible()
  })

  test('UI W2 a second Escape on the focused phrase select closes More',
    async ({ window }) => {
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      const picker = window.locator('#phrase-picker')
      await expect(picker).toBeEnabled()
      await picker.focus()
      await window.keyboard.press('Escape')
      // The first Escape belongs to the control itself.
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      await expect(picker).toBeFocused()
      await window.keyboard.press('Escape')
      // A closed select that merely holds focus cannot swallow Escape forever:
      // the disclosure takes the second one and keeps the composer open.
      await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
      await expect(window.locator('#phrase-insert-more')).toBeFocused()
      await expect(window.locator('#modal-phrase')).toBeVisible()

      await window.locator('#phrase-insert-more').click()
      await expect(picker).toBeEnabled()
      await picker.focus()
      await window.keyboard.press('Escape')
      // Leaving the select rearms it, so its next Escape is again its own.
      await window.locator('#phrase-insert-datetime').focus()
      await picker.focus()
      await window.keyboard.press('Escape')
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      await expect(picker).toBeFocused()
    })

  test('UI W2 Cancel writes nothing and leaves the stored phrase unchanged',
    async ({ electronApp, window }) => {
      await window.locator(PHRASE_ROWS).first().locator('[data-action="edit"]').click()
      const body = window.locator('#expandedTextInput')
      const original = await body.inputValue()
      await window.locator('#phraseInput').fill('ShouldNotSave')
      await body.fill('should not persist')
      await window.locator('#btn-phrase-cancel').click()
      await expect(window.locator('#modal-phrase')).toBeHidden()
      expect(await calls(electronApp, 'phrases:edit')).toEqual([])
      expect(await calls(electronApp, 'phrases:add')).toEqual([])
      await window.locator(PHRASE_ROWS).first().locator('[data-action="edit"]').click()
      await expect(body).toHaveValue(original)
      await expect(window.locator(PHRASE_ROWS)).toHaveCount(SEEDED_ROWS)
    })

  test('UI W2 Enter is a newline and Ctrl/Cmd+Enter never saves',
    async ({ electronApp, window }) => {
      await openBlankComposer(window)
      await window.locator('#phraseInput').fill(uniquePhraseName('noaccel'))
      const body = window.locator('#expandedTextInput')
      await body.focus()
      await window.keyboard.type('one')
      await window.keyboard.press('Enter')
      await window.keyboard.type('two')
      await expect(body).toHaveValue('one\ntwo')
      const mac = await window.evaluate(() => window.platform === 'darwin')
      await window.keyboard.press(mac ? 'Meta+Enter' : 'Control+Enter')
      await expect(window.locator('#modal-phrase')).toBeVisible()
      expect(await calls(electronApp, 'phrases:add')).toEqual([])
      expect(await calls(electronApp, 'phrases:edit')).toEqual([])
    })

  test('UI W2 a fresh form resets More, range and resized height', async ({ window }) => {
    await openBlankComposer(window)
    await window.locator('#phrase-insert-more').click()
    await window.locator('#expandedTextInput').evaluate(
      (el: HTMLTextAreaElement) => { el.style.height = '260px' })
    await window.locator('#expandedTextInput').fill('draft body')
    await window.locator('#btn-phrase-cancel').click()
    await expect(window.locator('#modal-phrase')).toBeHidden()
    await openBlankComposer(window)
    await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
    await expect(window.locator('#phrase-insert-more')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.locator('#expandedTextInput')).toHaveValue('')
    expect(await window.locator('#expandedTextInput').evaluate(
      (el: HTMLTextAreaElement) => el.style.height)).toBe('')
    // The reset saved range must be the body end of the new, empty draft.
    await window.locator('#phrase-insert-date').click()
    await expect(window.locator('#expandedTextInput')).toHaveValue('{{date}}')
  })

  test('UI W2 a child modal keeps its own Escape', async ({ window }) => {
    const name = uniquePhraseName('child')
    await openBlankComposer(window)
    await window.locator('#phraseInput').fill(name)
    await window.locator('#expandedTextInput').fill('{{input:Test}}')
    await window.locator('#saveButton').click()
    await waitForModalHidden(window, '#modal-phrase')
    await waitForPhraseInList(window, name)
    await clickPhraseAction(window, name, 'copy')
    await waitForModalVisible(window, '#modal-dynamic')
    await window.keyboard.press('Escape')
    await waitForModalHidden(window, '#modal-dynamic')
  })

  test('UI W2 a child stacked over the composer keeps the delayed focus',
    async ({ window }) => {
      // Both openings happen in one task, so the composer's own delayed focus is
      // still pending while the child is already the topmost modal.
      await window.evaluate(() => {
        window.modals.openPhraseForm('', '', 'text', null, {})
        window.modals.openDynamicModal({
          phraseId: 1,
          phraseType: 'text',
          text: '{{input:Child}}',
          placeholders: [{ type: 'input', label: 'Child' }],
          clipboardContent: '',
        })
      })
      await waitForModalVisible(window, '#modal-dynamic')
      await expect(window.locator('#dynamic-field-0')).toBeFocused()
      // Long enough for the composer's rAF + 50 ms timer to have fired.
      await window.waitForTimeout(300)
      await expect(window.locator('#dynamic-field-0')).toBeFocused()
      await expect(window.locator('#phraseInput')).not.toBeFocused()
    })
})

test.describe('UI W2 raw persistence', () => {
  for (const format of ['text', 'markdown', 'html'] as const) {
    test('UI W2 raw ' + format + ' body survives Save and reopen', async ({ window }) => {
      const name = uniquePhraseName('raw' + format)
      const raw = '  \\{{date}}\n{{unknown:Label}}\n{{input:Label}}\n{{phrase:abc1234}}  '
      await openBlankComposer(window)
      await window.locator('#phraseInput').fill(name)
      await window.locator('#expandedTextInput').fill(raw)
      await window.locator('input[name="phraseType"][value="' + format + '"]').check()
      await window.locator('#saveButton').click()
      await waitForModalHidden(window, '#modal-phrase')
      await waitForPhraseInList(window, name)
      await clickPhraseAction(window, name, 'edit')
      await waitForModalVisible(window, '#modal-phrase')
      // Leading/trailing spaces, the escape and unknown tokens are stored raw.
      await expect(window.locator('#expandedTextInput')).toHaveValue(raw)
      await expect(window.locator('input[name="phraseType"][value="' + format + '"]')).toBeChecked()
    })
  }

  test('UI W2 the composer exposes visible labels instead of placeholders',
    async ({ window }) => {
      await openBlankComposer(window)
      await expect(window.locator('#phrase-name-label')).toHaveAttribute('for', 'phraseInput')
      await expect(window.locator('#phrase-expanded-label'))
        .toHaveAttribute('for', 'expandedTextInput')
      await expect(window.locator('#phrase-format-label')).toHaveText('Format')
      await expect(window.locator('#phraseInput')).not.toHaveAttribute('placeholder', /./)
      await expect(window.locator('#expandedTextInput')).not.toHaveAttribute('placeholder', /./)
      await expect(window.locator('#phrase-insert-shelf'))
        .toHaveAttribute('aria-label', 'Insert dynamic text')
    })
})

// =============================================================================
// Wave 2 phrase picker: one fresh validated read per More opening
// =============================================================================

test.describe('UI W2 picker', () => {
  test('UI W2 picker inserts one raw reference without changing palette',
    async ({ electronApp, window }) => {
      const rows = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const row = rows.find(entry => entry.phrase === 'signature formal')!
      const second = rows.find(entry => entry.phrase === 'sig')!
      await window.locator('#search').fill('sig')
      await expect(window.locator(PHRASE_ROWS).first().locator('strong')).toHaveText('sig')
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      const picker = window.locator('#phrase-picker')
      await expect(picker).toBeEnabled()
      await expect(picker).toHaveValue('')
      // A committed pick inserts by itself, then snaps back to the placeholder.
      await picker.selectOption(String(row.id))
      await expect(window.locator('#expandedTextInput'))
        .toHaveValue('{{phrase:' + row.short_id.toLowerCase() + '}}')
      await expect(picker).toHaveValue('')
      await expect(window.locator('#expandedTextInput')).toBeFocused()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      await expect(window.locator('#search')).toHaveValue('sig')
      // More is still open and the picker is still usable: a second committed
      // pick inserts exactly one more token.
      await expect(picker).toBeEnabled()
      await picker.selectOption(String(second.id))
      await expect(window.locator('#expandedTextInput')).toHaveValue(
        '{{phrase:' + row.short_id.toLowerCase() + '}}'
        + '{{phrase:' + second.short_id.toLowerCase() + '}}')
      await expect(picker).toHaveValue('')
      await expect(picker).toBeEnabled()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
      expect(await calls(electronApp, 'phrases:incrementUsage')).toEqual([])
    })

  test('UI W2 closed-select navigation moves the selection without inserting',
    async ({ electronApp, window }) => {
      // On macOS an arrow on a closed select opens the popup instead of moving
      // the selection, so the browse guard is inert there and this case has
      // nothing to observe.
      test.skip(process.platform === 'darwin',
        'A closed select opens its popup on macOS instead of moving the selection.')
      const rows = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      const picker = window.locator('#phrase-picker')
      await expect(picker).toBeEnabled()
      await expect(picker).toHaveValue('')

      // A closed native select changes its selection and dispatches `change`
      // inside the keydown task; the browse guard must swallow that change.
      await picker.focus()
      await picker.press('ArrowDown')
      await expect(picker).not.toHaveValue('')
      await expect(window.locator('#expandedTextInput')).toHaveValue('')

      const chosen = await picker.inputValue()
      const short = rows.find(entry => String(entry.id) === chosen)!.short_id.toLowerCase()
      // Enter on the closed select is the commit: exactly one insert, then snap back.
      await picker.press('Enter')
      await expect(window.locator('#expandedTextInput')).toHaveValue('{{phrase:' + short + '}}')
      await expect(picker).toHaveValue('')
      await expect(window.locator('#expandedTextInput')).toBeFocused()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      expect(await calls(electronApp, 'phrases:insertById')).toEqual([])
    })

  test('UI W2 picker omits the edited row', async ({ window }) => {
    const rows = await window.evaluate(() =>
      window.api.invoke<PhraseRow[]>('phrases:search', ''))
    const edited = rows.find(row => row.phrase === 'sig')!
    const other = rows.find(row => row.phrase === 'signature formal')!
    await window.locator(PHRASE_ROWS, { hasText: 'signature formal' }).first()
      .locator('[data-action="edit"]').click()
    await waitForModalVisible(window, '#modal-phrase')
    await window.locator('#phrase-insert-more').click()
    const picker = window.locator('#phrase-picker')
    await expect(picker).toBeEnabled()
    await expect(picker.locator('option[value="' + String(other.id) + '"]')).toHaveCount(0)
    await expect(picker.locator('option[value="' + String(edited.id) + '"]')).toHaveCount(1)
  })

  test('UI W2 picker reads an empty query without touching palette search',
    async ({ electronApp, window }) => {
      await window.locator('#search').fill('signature')
      await expectReady(window)
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      // A nonempty palette query keeps the picker's own '' read distinguishable
      // from any controller refresh.
      expect(await pickerQueries(electronApp)).toEqual([''])
      await expect(window.locator('#phrase-picker-status'))
        .toHaveText('Loading phrases…')
      await expect(window.locator('#phrase-picker')).toBeDisabled()
      await expect(window.locator('#search')).toHaveValue('signature')
    })

  test('UI W2 picker validates short IDs, duplicates and pending rows',
    async ({ electronApp, window }) => {
      const seeded = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const template = seeded[0]
      const maxId = Math.max(...seeded.map(row => Number(row.id)))
      const edited = seeded.find(row => row.phrase === 'signature formal')!
      const make = (id: number, phrase: string, shortId: string): PhraseRow => ({
        ...template, id, phrase, short_id: shortId,
      })
      const pending = seeded.find(row => row.phrase === 'sig')!
      const good = make(maxId + 6, '<img src=x>{{date}}', 'ZXCV123')
      const empty = make(maxId + 7, '', 'EMPTY07')
      const reply: PhraseRow[] = [
        make(Number(edited.id), 'edited row', 'edit001'),
        make(Number(edited.id), 'edited row', 'edit001'),
        make(maxId + 3, 'invalid', 'six123'),
        make(maxId + 4, 'invalid', 'abcd!23'),
        make(maxId + 5, 'duplicate', 'AbC1234'),
        make(Number(pending.id), 'pending row', 'pend001'),
        good,
        empty,
        make(maxId + 8, 'duplicate name', 'abc1234'),
      ]

      // A real pending deletion, so the exclusion set is the renderer's own and
      // the undo window is still open while the picker validates.
      await clickPhraseMenuAction(window, 'sig', 'delete')
      expect(await waitForToast(window, 3000)).not.toBeNull()
      await expect(window.locator(PHRASE_ROWS, { hasText: 'sig' })).toHaveCount(1)

      await installPickerProbe(electronApp)
      await window.locator(PHRASE_ROWS, { hasText: 'signature formal' }).first()
        .locator('[data-action="edit"]').click()
      await waitForModalVisible(window, '#modal-phrase')
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      await resolvePicker(electronApp, 0, reply)

      const picker = window.locator('#phrase-picker')
      await expect(picker).toBeEnabled()
      // Placeholder, then the two eligible rows in response order.
      await expect(picker.locator('option')).toHaveCount(3)
      const labels = await picker.locator('option').allTextContents()
      expect(labels.slice(1)).toEqual(['<img src=x>{{date}} (zxcv123)', 'empty07'])
      // Markup in a name stays literal text, never a node.
      await expect(picker.locator('img')).toHaveCount(0)
      await expect(picker.locator('option[value="' + String(good.id) + '"]')).toHaveCount(1)
      // The row awaiting its undo window is not an insertable reference.
      await expect(picker.locator('option[value="' + String(pending.id) + '"]')).toHaveCount(0)

      await picker.selectOption(String(good.id))
      await expect(window.locator('#expandedTextInput'))
        .toHaveValue(/\{\{phrase:zxcv123\}\}$/)
      await expect(picker).toHaveValue('')
    })

  test('UI W2 picker announces empty, error, retry and never inserts on retry',
    async ({ electronApp, window }) => {
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      await resolvePicker(electronApp, 0, [])
      await expect(window.locator('#phrase-picker-status'))
        .toHaveText('No other phrases available.')
      await expect(window.locator('#phrase-picker')).toBeDisabled()
      await expect(window.locator('#phrase-picker')).toHaveValue('')
      await expect(window.locator('#phrase-picker-retry')).toBeHidden()

      // Reopening is one fresh read; this one fails.
      await window.locator('#phrase-insert-more').click()
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(2)
      await rejectPicker(electronApp, 1)
      await expect(window.locator('#phrase-picker-status'))
        .toHaveText('Could not load phrases. Try again.')
      await expect(window.locator('#phrase-picker-retry')).toBeVisible()
      await expect(window.locator('#phrase-picker')).toBeDisabled()

      await window.locator('#phrase-picker-retry').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(3)
      expect(await pickerQueries(electronApp)).toEqual(['', '', ''])
      // Retry repeats the read; it is never an insertion intent.
      await expect(window.locator('#expandedTextInput')).toHaveValue('')
    })

  test('UI W2 a stale reply cannot repopulate a reopened picker',
    async ({ electronApp, window }) => {
      const seeded = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const template = seeded[0]
      const maxId = Math.max(...seeded.map(row => Number(row.id)))
      const preClose: PhraseRow = {
        ...template, id: maxId + 20, phrase: 'pre-close row', short_id: 'precls1',
      }
      const stale: PhraseRow = { ...template, id: maxId + 21, phrase: 'stale row', short_id: 'stale01' }
      const fresh: PhraseRow = { ...template, id: maxId + 22, phrase: 'fresh row', short_id: 'fresh02' }

      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      // Request 0 stays in flight on purpose: it is the late pre-close reply.
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      await expect(window.locator('#phrase-picker-status')).toHaveText('Loading phrases…')

      await window.locator('#phrase-insert-more').click()
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(2)
      await window.locator('#phrase-insert-more').click()
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(3)
      await resolvePicker(electronApp, 2, [fresh])
      await expect(window.locator('#phrase-picker')).toBeEnabled()

      // An abandoned read arrives late within the same form and is ignored.
      await resolvePicker(electronApp, 1, [stale])
      await expect(window.locator('#phrase-picker option')).toHaveCount(2)
      await expect(window.locator('#phrase-picker option[value="' + String(stale.id) + '"]'))
        .toHaveCount(0)

      // Close the whole composer while request 0 is still unanswered, then let it
      // reply: an older read cannot survive the close or reach the next form.
      await window.locator('#phrase-picker').selectOption(String(fresh.id))
      await window.locator('#btn-phrase-cancel').click()
      await expect(window.locator('#modal-phrase')).toBeHidden()
      await resolvePicker(electronApp, 0, [preClose])
      await expect(window.locator('#phrase-picker option[value="' + String(preClose.id) + '"]'))
        .toHaveCount(0)

      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(4)
      await expect(window.locator('#phrase-picker option[value="' + String(preClose.id) + '"]'))
        .toHaveCount(0)
      await expect(window.locator('#phrase-picker option[value="' + String(fresh.id) + '"]'))
        .toHaveCount(0)
      await resolvePicker(electronApp, 3, [])
      await expect(window.locator('#phrase-picker')).toHaveValue('')
      await expect(window.locator('#phrase-picker')).toBeDisabled()
    })

  test('UI W2 closing More cancels its request without refetching',
    async ({ electronApp, window }) => {
      const seeded = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const late: PhraseRow = { ...seeded[0], id: 9001, phrase: 'late row', short_id: 'late001' }
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      await window.locator('#phrase-insert-more').click()
      await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
      await resolvePicker(electronApp, 0, [late])
      // A closed disclosure neither applies the reply nor issues a new read.
      expect(await pickerRequests(electronApp)).toBe(1)
      await expect(window.locator('#phrase-picker option[value="9001"]')).toHaveCount(0)
    })

  test('UI W2 a committed deletion refreshes an open picker exactly once',
    async ({ electronApp, window }) => {
      const seeded = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const target = seeded.find(row => row.phrase === 'sig')!
      const remaining = seeded.filter(row => row.id !== target.id)
      // A nonempty palette query keeps the composer's own '' reads countable
      // apart from the list refresh the same committed event triggers.
      await window.locator('#search').fill('signature')
      await expectReady(window)
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerReads(electronApp)).toEqual([0])
      await resolvePicker(electronApp, 0, seeded)
      await expect(window.locator('#phrase-picker')).toBeEnabled()
      await expect(window.locator('#phrase-picker option[value="' + String(target.id) + '"]'))
        .toHaveCount(1)

      await window.evaluate(id => window.api.send('phrases:delete', id), target.id)
      await expect.poll(() => pickerReads(electronApp)).toHaveLength(2)
      await resolvePicker(electronApp, (await pickerReads(electronApp))[1], remaining)
      await expect(window.locator('#phrase-picker option[value="' + String(target.id) + '"]'))
        .toHaveCount(0)
      // Once, not once-or-more: this path issues its single refresh and nothing
      // duplicates it afterwards. Same-turn coalescing has its own test.
      await window.waitForTimeout(250)
      expect(await pickerReads(electronApp)).toHaveLength(2)
    })

  test('UI W2 two picker invalidations in one turn issue a single read',
    async ({ electronApp, window }) => {
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerReads(electronApp)).toEqual([0])
      await resolvePicker(electronApp, 0, [])
      // Two notifications in one task, as an acknowledged pending deletion
      // produces through syncPending and its own committed invalidation.
      await window.evaluate(() => {
        window.modals.invalidatePhrasePicker()
        window.modals.invalidatePhrasePicker()
      })
      await expect.poll(() => pickerReads(electronApp)).toHaveLength(2)
      // Exactly one extra read: without the coalescing guard the second
      // notification would schedule a duplicate microtask refresh.
      await window.waitForTimeout(250)
      expect(await pickerReads(electronApp)).toHaveLength(2)
    })

  test('UI W2 a picker option from an older database generation cannot insert',
    async ({ electronApp, window }) => {
      const seeded = await window.evaluate(() =>
        window.api.invoke<PhraseRow[]>('phrases:search', ''))
      const row: PhraseRow = { ...seeded[0], id: 9101, phrase: 'gen row', short_id: 'genrow1' }
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      await window.locator('#phrase-insert-more').click()
      await expect.poll(() => pickerRequests(electronApp)).toBe(1)
      await resolvePicker(electronApp, 0, [row])
      await expect(window.locator('#phrase-picker')).toBeEnabled()
      await expect(window.locator('#phrase-picker option[value="9101"]')).toHaveCount(1)

      // Silence only the notification, so the renderer's real availability
      // transitions still advance the database generation underneath a picker
      // that keeps showing its old row.
      await window.evaluate(() => {
        window.modals.invalidatePhrasePicker = () => {}
      })
      await electronApp.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        contents.send('database:status', false)
        contents.send('database:status', true)
      })
      // The restored database issues its own read at the new generation. That
      // held read is the observable proof the generation advanced; no sleep.
      await expect.poll(() => pickerRequests(electronApp)).toBe(2)
      await expect(window.locator('#phrase-picker option[value="9101"]')).toHaveCount(1)

      // The pick is committed only now, so it runs the insert guard: a reference
      // from a superseded generation is refused, not inserted.
      await window.locator('#phrase-picker').selectOption('9101')
      await expect(window.locator('#expandedTextInput')).toHaveValue('')
      await expect(window.locator('#phrase-picker')).toHaveValue('')
    })

  test('UI W2 an unavailable database issues no picker read',
    async ({ electronApp, window }) => {
      await installPickerProbe(electronApp)
      await openBlankComposer(window)
      // Drive the renderer's own availability transition through its real event.
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('database:status', false)
      })
      await window.locator('#phrase-insert-more').click()
      await expect(window.locator('#phrase-picker-status'))
        .toHaveText('Database unavailable.')
      await expect(window.locator('#phrase-picker')).toBeDisabled()
      await expect(window.locator('#phrase-picker')).toHaveValue('')
      expect(await pickerRequests(electronApp)).toBe(0)
    })
})
