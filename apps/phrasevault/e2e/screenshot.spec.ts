/**
 * Screenshot capture tests for PhraseVault
 *
 * The three original captures stay as structural references. The P0 block adds
 * actual computed-contrast assertions and the six named Phase 1 states. Animation
 * is asserted before any helper suppresses animations.
 */
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  closeModalViaEscape,
  createElectronTest,
  expect,
  waitForAppReady,
} from '@spqrkapps/shared/e2e'
import type { ElectronApplication, Page } from '@spqrkapps/shared/e2e'
import {
  chromeCalls, createPaletteTest, expiredLicense, installChromeProbe, seedOverflow, seedPalette,
} from './palette-fixture'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const screenshotsDir = path.join(__dirname, '..', 'screenshots')

const test = createElectronTest({
  appDir: path.join(__dirname, '..'),
  appName: 'PhraseVault',
})

async function prepareViewport(window: Page): Promise<void> {
  await waitForAppReady(window)
  const reminder = window.locator('#modal-purchase-reminder.active')
  if (await reminder.count()) {
    // Escape only hides the dialog. "Remind Me Later" invokes
    // license:markReminderShown, so clicking it would reschedule a real
    // profile's reminder as a side effect of taking a screenshot.
    await closeModalViaEscape(window)
    await reminder.waitFor({ state: 'hidden', timeout: 5000 })
  }
  await window.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  })
}

test('1-light-mode', async ({ window }) => {
  await prepareViewport(window)

  await window.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await window.locator('html.light, html:not(.dark)').waitFor({ state: 'attached', timeout: 2000 }).catch(() => {})

  await window.screenshot({ path: path.join(screenshotsDir, 'light-mode.png') })
  console.log('Captured: light-mode.png')
})

test('2-dark-mode', async ({ window }) => {
  await prepareViewport(window)

  await window.evaluate(() => {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
  })
  await window.locator('html.dark').waitFor({ state: 'attached', timeout: 2000 })

  await window.screenshot({ path: path.join(screenshotsDir, 'dark-mode.png') })
  console.log('Captured: dark-mode.png')
})

test('3-settings-modal', async ({ window }) => {
  await prepareViewport(window)

  const settingsBtn = window.locator('#btn-settings')
  await settingsBtn.click()

  const modal = window.locator('#modal-settings.active')
  await modal.waitFor({ state: 'visible', timeout: 5000 })

  await window.screenshot({ path: path.join(screenshotsDir, 'settings-modal.png') })
  console.log('Captured: settings-modal.png')
})

test('4-edit-phrase-modal', async ({ window }) => {
  await prepareViewport(window)

  const editBtn = window.locator('#phrase-list .edit-button, [data-action="edit"]').first()
  await editBtn.waitFor({ state: 'visible', timeout: 5000 })
  await editBtn.click()

  const modal = window.locator('#modal-phrase.active')
  await modal.waitFor({ state: 'visible', timeout: 5000 })

  await window.screenshot({ path: path.join(screenshotsDir, 'edit-phrase-modal.png') })
  console.log('Captured: edit-phrase-modal.png')
})

// =============================================================================
// P0 contrast, selection and the six named Phase 1 states
// =============================================================================

const paletteTest = createPaletteTest()

// The four original captures run against the real profile. Clearing a reminder
// to take a screenshot must therefore answer nothing: #btn-purchase-reminder-later
// invokes license:markReminderShown, which would move a developer's or customer's
// reminder schedule. Escape is the shared, non-persisting route.
paletteTest('P2 screenshot preparation clears the reminder without marking it',
  async ({ electronApp, window }) => {
    await installChromeProbe(electronApp)
    await window.evaluate(() => window.modals.openPurchaseReminderModal())
    await expect(window.locator('#modal-purchase-reminder.active')).toHaveCount(1)
    await prepareViewport(window)
    await expect(window.locator('#modal-purchase-reminder')).toBeHidden()
    expect(await chromeCalls(electronApp, 'license:markReminderShown')).toEqual([])
  })

/**
 * Measure the actual composited contrast of a rendered subject.
 * The element's own background and every ancestor background are flattened over
 * white, so the result reflects what is really on screen, not token intent.
 */
async function readContrast(
  window: Page,
  selector: string,
  property: 'color' | 'outlineColor' = 'color',
  pseudo: string | null = null
): Promise<{ ratio: number; opacity: number[] }> {
  return window.evaluate(({ selector, property, pseudo }) => {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element) throw new Error('Missing contrast subject: ' + selector)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('No canvas context for CSS color conversion')
    const rgba = (value: string): number[] => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value)
    }
    const over = (front: number[], back: number[]): number[] =>
      front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3])).concat(1)
    const ancestors: HTMLElement[] = []
    for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.unshift(current)
    const opacity = ancestors.map(node => Number(getComputedStyle(node).opacity))
    let background = [255, 255, 255, 1]
    for (const ancestor of ancestors) background = over(rgba(getComputedStyle(ancestor).backgroundColor), background)
    const foreground = over(rgba(getComputedStyle(element, pseudo)[property]), background)
    const luminance = (color: number[]): number => {
      const linear = color.slice(0, 3).map(value => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const a = luminance(foreground)
    const b = luminance(background)
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), opacity }
  }, { selector, property, pseudo })
}

/**
 * Let the subject's own CSS transitions finish before it is measured. `.btn`
 * inherits `transition: all 0.15s ease`, so a focus ring travels through
 * intermediate colours; polling alone can catch one of those on the way to a
 * failing settled colour and call it a pass.
 */
async function settleStyles(window: Page, selector: string): Promise<void> {
  await window.evaluate(async (selector) => {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element) throw new Error('Missing contrast subject: ' + selector)
    await new Promise(resolve => requestAnimationFrame(resolve))
    await Promise.all(element.getAnimations()
      .map(animation => animation.finished.catch(() => undefined)))
  }, selector)
}

/**
 * The shared overlay animates `.modal` from scale(0.98). Measuring a box before
 * that transition settles reports a scaled, subpixel-shifted rectangle.
 */
async function settleDialog(window: Page, selector = '#modal-settings .modal'): Promise<void> {
  await expect(window.locator(selector)).toBeVisible()
  await settleStyles(window, selector)
  // scale(1) computes to the identity matrix, never to `none`.
  await expect(window.locator(selector)).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
}

async function requireContrast(window: Page, selector: string, threshold: number,
  property: 'color' | 'outlineColor' = 'color', pseudo: string | null = null): Promise<void> {
  // readContrast uses querySelector, which happily returns a display:none node.
  // Only a visible, settled subject is evidence about what a user actually sees.
  await expect(window.locator(selector).first()).toBeVisible()
  await settleStyles(window, selector)
  await expect.poll(async () => (await readContrast(window, selector, property, pseudo)).ratio)
    .toBeGreaterThanOrEqual(threshold)
  // Current scoped subjects are opaque; fail explicitly if styling adds opacity.
  // Do not silently call an opaque color calculation a composited measurement.
  await expect.poll(async () => (await readContrast(window, selector, property, pseudo)).opacity.every(value => value === 1))
    .toBe(true)
}


// =============================================================================
// P2 measured geometry
//
// These assert real boxes at the 800x600 window floor. They detect clipping,
// retained FAB clearance and undersized hit areas; they do not and cannot
// establish native OS caption behaviour.
// =============================================================================

/** Strict containment: no "visible enough" fallback. */
async function expectWithin(window: Page, subject: string, viewport: string): Promise<void> {
  const item = window.locator(subject)
  await expect(item).toHaveCount(1)
  await expect(item).toBeVisible()
  const box = await item.boundingBox()
  const frame = await window.locator(viewport).boundingBox()
  expect(box).not.toBeNull()
  expect(frame).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(frame!.x)
  expect(box!.y).toBeGreaterThanOrEqual(frame!.y)
  expect(box!.x + box!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(frame!.y + frame!.height)
}

async function useMinimumWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win.isMaximized()) win.unmaximize()
    win.setSize(800, 600)
  })
}

paletteTest('UI W1 geometry keeps status and gear inside the titlebar reservation',
  async ({ electronApp, window }) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    // The nested colour-only badge is gone; status is its own 28px sibling.
    await expect(window.locator('#status-indicator')).toHaveCount(0)
    await expect(window.locator('#btn-settings #db-status-glyph')).toHaveCount(0)
    for (const id of ['#btn-db-status', '#btn-settings']) {
      await expectWithin(window, id, '#title-bar')
      const box = await window.locator(id).boundingBox()
      expect([box!.width, box!.height], id).toEqual([28, 28])
      await expect(window.locator(id)).toHaveCSS('-webkit-app-region', 'no-drag')
    }
    for (const id of ['#db-status-glyph', '#btn-settings > .icon-main']) {
      const glyph = await window.locator(id).boundingBox()
      expect([glyph!.width, glyph!.height], id).toEqual([16, 16])
      await expectWithin(window, id, id === '#db-status-glyph' ? '#btn-db-status' : '#btn-settings')
    }
    await expect(window.locator('#title-bar')).toHaveCSS('height', '32px')
    const geometry = await window.evaluate(() => {
      const bar = document.getElementById('title-bar')!.getBoundingClientRect()
      const actions = document.querySelector('.titlebar-actions')!.getBoundingClientRect()
      const status = document.getElementById('btn-db-status')!.getBoundingClientRect()
      const gear = document.getElementById('btn-settings')!.getBoundingClientRect()
      const cluster = document
        .querySelector('[data-testid="window-controls"]')!
        .getBoundingClientRect()
      return {
        platform: window.platform, width: innerWidth,
        left: bar.left, right: bar.right,
        actionsWidth: actions.width, actionsLeft: actions.left, actionsRight: actions.right,
        statusLeft: status.left, gearLeft: gear.left, gearRight: gear.right,
        clusterWidth: cluster.width, clusterLeft: cluster.left, clusterRight: cluster.right,
      }
    })
    // 12 + 28 + 8 + 28 + 12: the two actions occupy exactly 88px.
    expect(geometry.actionsWidth).toBe(88)
    expect(geometry.gearLeft - geometry.statusLeft).toBe(36)
    // The bar now spans the whole window: the caption is in-page, so there is
    // no native void to reserve. The 138px / 78px slot is taken by the
    // .window-controls cluster inside the bar instead.
    expect(geometry.left).toBe(0)
    expect(geometry.right).toBe(geometry.width)
    if (geometry.platform === 'win32') {
      expect(geometry.clusterWidth).toBe(138)
      expect(geometry.clusterRight).toBe(geometry.width)
      expect(geometry.gearRight).toBeLessThanOrEqual(geometry.clusterLeft - 12)
      // The locked Windows slot at the 800px floor, unchanged by the move.
      expect([geometry.actionsLeft, geometry.actionsRight]).toEqual([574, 662])
    } else if (geometry.platform === 'darwin') {
      expect(geometry.clusterWidth).toBe(78)
      expect(geometry.clusterLeft).toBe(0)
      expect(geometry.gearRight).toBeLessThanOrEqual(geometry.width - 12)
    }
  })

paletteTest('P2 geometry gives search its own slots and a stable Add',
  async ({ electronApp, window }) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)

    const emptyAdd = await window.locator('#add-phrase').boundingBox()
    const longQuery = 'q'.repeat(200)
    await window.locator('#search').fill(longQuery)
    await expect(window.locator('#search-clear')).toBeVisible()
    const busyAdd = await window.locator('#add-phrase').boundingBox()
    expect(busyAdd).toEqual(emptyAdd)

    for (const id of ['#search-btn', '#search-clear', '#add-phrase']) {
      await expectWithin(window, id, '.palette-search')
    }
    const search = await window.locator('#search-btn').boundingBox()
    const clear = await window.locator('#search-clear').boundingBox()
    expect(search!.width).toBeGreaterThanOrEqual(28)
    expect(search!.height).toBeGreaterThanOrEqual(28)
    expect(clear!.width).toBeGreaterThanOrEqual(28)
    expect(clear!.height).toBeGreaterThanOrEqual(28)
    expect(busyAdd!.width).toBe(40)

    // The reserved text region never passes under a control.
    const text = await window.evaluate(() => {
      const input = document.getElementById('search')!
      const style = getComputedStyle(input)
      const box = input.getBoundingClientRect()
      return {
        left: box.left + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.paddingRight),
      }
    })
    expect(text.left).toBeGreaterThanOrEqual(search!.x + search!.width)
    expect(text.right).toBeLessThanOrEqual(clear!.x)
    expect(text.right).toBeLessThanOrEqual(busyAdd!.x)

    // Tab order follows visual order, never the retired FAB order.
    await window.locator('#search-btn').focus()
    await window.keyboard.press('Tab')
    await expect(window.locator('#search')).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(window.locator('#search-clear')).toBeFocused()
    await window.keyboard.press('Tab')
    await expect(window.locator('#add-phrase')).toBeFocused()
    await window.keyboard.press('Shift+Tab')
    await expect(window.locator('#search-clear')).toBeFocused()
    await window.locator('#search').fill('')
    await expect(window.locator('#search-clear')).toBeHidden()
    await window.locator('#search').focus()
    await window.keyboard.press('Tab')
    await expect(window.locator('#add-phrase')).toBeFocused()
  })

paletteTest('P2 geometry last row and More remain usable at maximum scroll',
  async ({ electronApp, window }) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await seedOverflow(window)
    const list = window.locator('#phrase-list')
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    const last = '#phrase-list > .phrase-item:last-child'
    await window.locator(last).focus()
    await expectWithin(window, last, '#phrase-list')
    const lastBox = await window.locator(last).boundingBox()
    const listBox = await list.boundingBox()
    const bottomGap = listBox!.y + listBox!.height - lastBox!.y - lastBox!.height
    expect(bottomGap).toBeGreaterThanOrEqual(0)
    expect(bottomGap).toBeLessThanOrEqual(8)
    for (const selector of ['[data-action="copy"]', '[data-action="edit"]', 'button[title="More"]']) {
      await expectWithin(window, last + ' ' + selector, '#phrase-list')
    }
    const name = await window.locator(last + ' strong').innerText()
    await window.locator(last + ' button[title="More"]').click()
    await expectWithin(window, last + ' .phrase-menu', '#phrase-list')
    await window.locator(last + ' [data-action="duplicate"]').click()
    await expect(window.locator('#search')).toHaveValue('Copy of ' + name)
    await expect(window.locator('#phrase-list > .phrase-item').first().locator('strong'))
      .toHaveText('Copy of ' + name)
  })

// English plus the longest existing locale and the CJK one: label wrapping must
// not create horizontal scrolling or push the footer out of the dialog.
for (const locale of ['en', 'de', 'ja'] as const) {
  paletteTest('P2 geometry keeps Settings readable at the window floor in ' + locale,
    async ({ electronApp, window }, testInfo) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await installChromeProbe(electronApp)
    await testInfo.attach('locale', { body: locale, contentType: 'text/plain' })
    if (locale !== 'en') {
      const changed = window.evaluate(() => new Promise<string>(resolve => {
        window.api.receiveOnce('i18n:languageChanged', value => resolve(String(value)))
      }))
      await window.evaluate(value => window.api.invoke('i18n:changeLanguage', value), locale)
      expect(await changed).toBe(locale)
    }
    await window.locator('#btn-settings').click()
    await expect(window.locator('#modal-settings')).toBeVisible()
    await settleDialog(window)

    const layout = '#settings-layout'
    const dialog = '#modal-settings .modal'
    const footer = '#modal-settings .modal-footer'
    const banner = '#license-section-trial'
    const rail = '#settings-tabs'

    for (const selector of ['#shortcut-input', '#shortcut-record-btn', '#shortcut-reset-btn',
      '#settings-theme', '#language-select', '#autostart-section .toggle-switch']) {
      await expectWithin(window, selector, '#settings-preferences')
    }
    for (const control of ['#settings-theme', '#language-select'] as const) {
      const alignment = await window.locator(control).evaluate((element) => {
        const field = element.closest('.settings-field.settings-preference-row')
        const label = field?.querySelector('.settings-label')
        if (!(field instanceof HTMLElement) || !(label instanceof HTMLElement)) {
          return { alignItems: '', delta: Number.POSITIVE_INFINITY }
        }
        const labelBox = label.getBoundingClientRect()
        const controlBox = element.getBoundingClientRect()
        return {
          alignItems: getComputedStyle(field).alignItems,
          delta: Math.abs(
            (labelBox.top + labelBox.bottom) / 2 - (controlBox.top + controlBox.bottom) / 2
          ),
        }
      })
      expect(alignment.alignItems, control + ' ' + locale).toBe('center')
      expect(alignment.delta, control + ' ' + locale + ' label/control midlines').toBeLessThan(2)
    }
    for (const pane of ['preferences', 'database', 'security', 'about']) {
      await expectWithin(window, '#settings-tab-' + pane, rail)
    }
    await expectWithin(window, rail, layout)
    await expectWithin(window, banner, dialog)
    await expectWithin(window, footer, dialog)
    await expectWithin(window, '#btn-settings-cancel', footer)
    await expectWithin(window, '#btn-settings-save', footer)

    const noHorizontalScroll = async (): Promise<void> => {
      for (const selector of [dialog, layout, banner, footer, rail,
        '#settings-preferences']) {
        const overflow = await window.locator(selector).evaluate(
          element => element.scrollWidth - element.clientWidth)
        expect(overflow, selector + ' scrolls horizontally').toBeLessThanOrEqual(0)
      }
    }
    await noHorizontalScroll()

    const boxOf = async (selector: string) => window.locator(selector).boundingBox()

    // The rail layout itself never scrolls: only the selected panel may.
    expect(await window.locator(layout).evaluate(
      element => element.scrollHeight <= element.clientHeight)).toBe(true)

    const railBox = await boxOf(rail)
    const bannerBox = await boxOf(banner)
    const footerBox = await boxOf(footer)
    expect(railBox!.width).toBe(132)

    for (const pane of ['database', 'security', 'about'] as const) {
      await window.locator('#settings-tab-' + pane).click()
      await expect(window.locator('#settings-' + pane)).toBeVisible()
      await expect(window.locator('#settings-layout [role="tabpanel"]:visible')).toHaveCount(1)
      const panel = '#settings-' + pane
      await window.locator(panel).evaluate(element => { element.scrollTop = element.scrollHeight })
      // Switching panes and scrolling one never moves the fixed chrome.
      expect(await boxOf(rail), pane).toEqual(railBox)
      expect(await boxOf(banner), pane).toEqual(bannerBox)
      expect(await boxOf(footer), pane).toEqual(footerBox)
      expect(await window.locator(layout).evaluate(element => element.scrollTop)).toBe(0)
      await expectWithin(window, banner, dialog)
      await expectWithin(window, footer, dialog)
      await noHorizontalScroll()
    }

    await expect(window.locator('#new-db-btn')).toBeAttached()
    await expect(window.locator('#check-updates-btn')).toBeVisible()
    await expectWithin(window, '#version-text', '#settings-about')

    // A real inline activation error grows the pinned row; the footer stays put.
    await window.locator('#license-key-input').fill('')
    await window.locator('#license-activate-btn').click()
    await expect(window.locator('#license-error')).toBeVisible()
    await expectWithin(window, banner, dialog)
    await expectWithin(window, footer, dialog)
    expect(await boxOf(footer)).toEqual(footerBox)
    const layoutAfterError = await boxOf(layout)
    expect(layoutAfterError!.y + layoutAfterError!.height).toBeLessThanOrEqual(footerBox!.y + 1)
    await noHorizontalScroll()

    await window.screenshot({
      path: path.join(screenshotsDir, 'palette-p2-settings-locale-' + locale + '.png'),
    })
  })
}

// English at the 800x600 floor with the ordinary trial band and no error: all
// four preference groups must fit without scrolling their panel.
paletteTest('UI W1 ordinary English Preferences fits without panel scroll',
  async ({ electronApp, window }) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await installChromeProbe(electronApp)
    await electronApp.evaluate(() => {
      globalThis.__pvChrome.license = {
        hasLicense: false, license: null, isLegacyUser: false,
        trial: { active: true, daysRemaining: 7, expired: false },
      }
    })
    await window.locator('#btn-settings').click()
    await expect(window.locator('#modal-settings')).toBeVisible()
    await expect(window.locator('#license-section-trial')).toBeVisible()
    await expect(window.locator('#license-error')).toBeHidden()
    await settleDialog(window)
    expect((await window.locator('#modal-settings .modal').boundingBox())!.width).toBe(640)
    expect((await window.locator('#settings-tabs').boundingBox())!.width).toBe(132)
    for (const selector of ['#shortcut-section', '#settings-theme', '#language-select',
      '#autostart-section']) {
      await expectWithin(window, selector, '#settings-preferences')
    }
    expect(await window.locator('#settings-preferences').evaluate(
      el => el.scrollHeight <= el.clientHeight)).toBe(true)
    await expectWithin(window, '#btn-settings-save', '#modal-settings .modal')
  })

paletteTest('UI W1 geometry scrolls Database alone', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await useMinimumWindow(electronApp)
  await installChromeProbe(electronApp)
  await window.locator('#btn-settings').click()
  await expect(window.locator('#settings-tab-preferences')).toBeFocused()
  await settleDialog(window)
  expect((await window.locator('#modal-settings .modal').boundingBox())!.width).toBe(640)
  expect((await window.locator('#settings-tabs').boundingBox())!.width).toBe(132)
  expect(await window.locator('#settings-preferences').evaluate(
    el => el.scrollHeight <= el.clientHeight)).toBe(true)
  await window.evaluate(() => window.api.invoke('i18n:changeLanguage', 'de'))
  await window.locator('#license-activate-btn').click()
  await expect(window.locator('#license-error')).toBeVisible()
  await window.locator('#settings-tab-database').click()
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('database:recentList',
      Array.from({ length: 5 }, (_, i) => 'C:\\fixture\\' + 'long-directory-'.repeat(12) + i + '.db'))
  })
  await expect(window.locator('#recent-databases button')).toHaveCount(5)
  const fixed = ['#settings-tabs', '#license-section-trial', '#modal-settings .modal-footer']
  const before = await Promise.all(fixed.map(id => window.locator(id).boundingBox()))
  // German transfer labels, five long recents and an actual inline error exercise overflow.
  const panel = window.locator('#settings-database')
  expect(await panel.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await panel.evaluate(el => { el.scrollTop = el.scrollHeight })
  expect(await Promise.all(fixed.map(id => window.locator(id).boundingBox()))).toEqual(before)
  expect(await window.locator('#settings-layout').evaluate(el => el.scrollTop)).toBe(0)
  for (const id of ['#modal-settings .modal', '#settings-layout', '#settings-database',
    '#license-section-trial']) {
    expect(await window.locator(id).evaluate(el => el.scrollWidth <= el.clientWidth), id).toBe(true)
  }
  // Recents truncate on screen but keep their full path for assistive tech.
  const first = window.locator('#recent-databases button').first()
  const full = 'C:\\fixture\\' + 'long-directory-'.repeat(12) + '0.db'
  await expect(first).toHaveAttribute('title', full)
  await expect(first).toHaveAccessibleName(full)
  await expectWithin(window, '#btn-settings-save', '#modal-settings .modal')
})

paletteTest('P0 actual light/dark contrast and row animation', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await installChromeProbe(electronApp)
  for (const dark of [false, true]) {
    await setCommittedTheme(window, dark)
    await window.locator('#search').fill('')
    await window.locator('#search-btn').click()
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
    await requireContrast(window, '#phrase-list > .phrase-item strong', 4.5)
    await requireContrast(window, '#phrase-list > .phrase-item .phrase-action svg', 3)
    await window.locator('#search').fill('sig')
    // Selection is painted by focus, so the selected state has to be reached the
    // way a user reaches it. The first row keeps its own selector afterwards:
    // focusing a nested action drops the parent row out of `.is-selected`.
    const firstRow = '#phrase-list > .phrase-item:first-child'
    await expect(window.locator(firstRow).locator('strong')).toHaveText('sig')
    await window.locator('#search').press('ArrowDown')
    await expect(window.locator(firstRow)).toBeFocused()
    await expect(window.locator('.phrase-item.is-selected strong')).toHaveText('sig')
    await expect(window.locator('.phrase-item').first()).toHaveCSS('animation-name', 'none')
    await expect(window.locator('.phrase-item.is-selected')).toHaveCSS('outline-width', '2px')
    await expect(window.locator('.phrase-item.is-selected')).toHaveCSS('outline-offset', '-2px')
    await requireContrast(window, '.phrase-item.is-selected strong', 4.5)
    await requireContrast(window, '.phrase-item.is-selected .palette-enter-hint', 4.5)
    await requireContrast(window, '.phrase-item.is-selected', 3, 'outlineColor')
    const action = window.locator(firstRow + ' .phrase-action').first()
    await action.hover()
    await requireContrast(window, firstRow + ' .phrase-action svg', 3)
    // Reach the action by keyboard: the ring is :focus-visible, so a programmatic
    // focus after a pointer move would never match it in Chromium.
    await window.locator(firstRow).focus()
    await window.keyboard.press('Tab')
    await expect(action).toBeFocused()
    await expect(window.locator('.phrase-item.is-selected')).toHaveCount(0)
    await expect(action).toHaveCSS('outline-width', '2px')
    await expect(action).toHaveCSS('outline-style', 'solid')
    await requireContrast(window, firstRow + ' .phrase-action', 3, 'outlineColor')

    // Palette chrome: meaningful icons and the status dot.
    await requireContrast(window, '#search-btn svg', 3)
    await requireContrast(window, '#add-phrase svg', 3)
    await requireContrast(window, '#btn-settings .icon-main', 3)
    await requireContrast(window, '#search-clear svg', 3)
    await window.locator('#search-btn').hover()
    await requireContrast(window, '#search-btn svg', 3)
    await window.locator('#btn-settings').hover()
    await requireContrast(window, '#btn-settings .icon-main', 3)
    await window.locator('#btn-db-status').hover()
    await requireContrast(window, '#db-status-glyph', 3)
    for (const selector of ['#search-btn', '#search-clear', '#add-phrase', '#btn-settings',
      '#btn-db-status']) {
      await window.locator(selector).focus()
      await expect(window.locator(selector)).toHaveCSS('outline-width', '2px')
      await requireContrast(window, selector, 3, 'outlineColor')
    }

    // The three real database glyph states, driven through their actual events.
    for (const state of ['loading', 'available', 'error'] as const) {
      await electronApp.evaluate((({ BrowserWindow }, state) => {
        const web = BrowserWindow.getAllWindows()[0].webContents
        if (state === 'error') web.send('database:error', 'contrast fixture')
        else web.send('database:status', state === 'available')
      }), state)
      await expect(window.locator('#btn-db-status')).toHaveAttribute('data-state', state)
      await requireContrast(window, '#db-status-glyph', 3)
      await window.locator('#btn-db-status').hover()
      await requireContrast(window, '#db-status-glyph', 3)
    }
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('database:status', true)
    })
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
    await window.locator('#search').fill('sig')
    await expect(window.locator('#phrase-list > .phrase-item').first().locator('strong'))
      .toHaveText('sig')

    await window.locator('#btn-settings').click()
    await expect(window.locator('#modal-settings')).toBeVisible()
    // Name the visible copy. `.settings-hint` and `.settings-label` both start
    // with a node the user never reads - the display:none #license-error and the
    // sr-only license-key label - so the loose descendant selectors would leave
    // the real hints and preference labels unmeasured.
    await requireContrast(window, '#license-status-trial', 4.5)
    await requireContrast(window, '#license-section-trial [data-i18n="license_hint_prefix"]', 4.5)
    await requireContrast(window, '#license-recovery-link', 4.5)
    await requireContrast(window, '#shortcut-hint', 4.5)
    for (const control of ['shortcut-input', 'settings-theme', 'language-select',
      'autostart-toggle']) {
      await requireContrast(window, '#settings-preferences label[for="' + control + '"]', 4.5)
    }
    await requireContrast(window, '#btn-settings-cancel', 4.5)
    await requireContrast(window, '#btn-settings-save', 4.5)
    // Reach the rail by keyboard: the ring is :focus-visible, so a programmatic
    // focus after a pointer move would never match it in Chromium.
    for (const pane of ['preferences', 'database', 'security', 'about']) {
      const tab = '#settings-tab-' + pane
      await requireContrast(window, tab, 4.5)
      await window.locator(tab).click()
      await expect(window.locator(tab)).toHaveAttribute('aria-selected', 'true')
      // Selected tint must keep its own label readable and its edge visible.
      await requireContrast(window, tab, 4.5)
      await window.keyboard.press('ArrowUp')
      await window.keyboard.press('ArrowDown')
      await expect(window.locator(tab)).toBeFocused()
      await expect(window.locator(tab)).toHaveCSS('outline-width', '2px')
      await requireContrast(window, tab, 3, 'outlineColor')
    }
    await window.locator('#settings-tab-database').click()
    await expect(window.locator('#settings-status-text')).toBeVisible()
    await requireContrast(window, '#settings-status-text', 4.5)
    await requireContrast(window, '#settings-status-indicator svg', 3)
    // Panel content is only measurable once selected: the export hint needs the
    // same threshold as every other hint, not just a colour-inequality check.
    await requireContrast(window, '#modal-settings .settings-hint[data-i18n="export_hint"]', 4.5)
    await window.locator('#license-key-input').fill('')
    await window.locator('#license-activate-btn').click()
    await expect(window.locator('#license-error')).toBeVisible()
    await requireContrast(window, '#license-error', 4.5)
    const hintColor = await window.locator('#modal-settings .settings-hint[data-i18n="export_hint"]').evaluate(
      (element) => getComputedStyle(element).color)
    const errorColor = await window.locator('#license-error').evaluate(
      (element) => getComputedStyle(element).color)
    expect(errorColor).not.toBe(hintColor)
    await window.locator('#btn-settings-cancel').click()
    await expect(window.locator('#modal-settings')).toBeHidden()

    const unselected = window.locator('.phrase-item:not(.is-selected)').first()
    await unselected.hover()
    await requireContrast(window, '.phrase-item:not(.is-selected) strong', 4.5)
    await requireContrast(window, '.phrase-item:not(.is-selected) .phrase-action svg', 3)
    await window.locator('#search').fill('welcome client')
    const create = window.locator('[data-palette-action="create"]')
    await expect(create).toBeVisible()
    await create.focus()
    await expect(create).toHaveCSS('outline-width', '2px')
    await requireContrast(window, '[data-palette-action="create"]', 4.5)
    await requireContrast(window, '[data-palette-action="create"]', 3, 'outlineColor')
  }
})

// =============================================================================
// P2 named states
//
// Six states per mode, captured at the 800x600 floor on the actual platform.
// The P0 behavioural assertions (row animation, selection, search focus) run
// before any animation suppression. The saved palette-p0-*.png files stay as
// comparison references and are never overwritten here.
// =============================================================================

type ShotState = 'chrome' | 'create' | 'last-row' |
  'settings-expired' | 'settings-licensed' | 'settings-database-overflow'

const licensedStatus = {
  ...expiredLicense, hasLicense: true,
  license: { payload: { email: 'fixture@example.test', id: 'fixture-license' } },
}

async function setCommittedTheme(window: Page, dark: boolean): Promise<void> {
  await window.evaluate(mode => window.api.send('theme:set', mode), dark ? 'dark' : 'light')
  await expect.poll(() =>
    window.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(dark)
}

const suppressAnimation = (window: Page): Promise<unknown> => window.addStyleTag({
  content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
})

for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light'

  paletteTest('P2 named states ' + mode, async ({ electronApp, window }, testInfo) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await installChromeProbe(electronApp)
    await setCommittedTheme(window, dark)
    const platform = await electronApp.evaluate(() => process.platform)

    const capture = async (state: ShotState): Promise<void> => {
      const metadata = await window.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio, platform: window.platform,
        effectiveTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      }))
      const bounds = await electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
      expect([bounds.width, bounds.height]).toEqual([800, 600])
      const license = await electronApp.evaluate(() => globalThis.__pvChrome.license)
      await testInfo.attach(state + '-metadata', {
        body: JSON.stringify({ ...metadata, bounds, license }), contentType: 'application/json',
      })
      await window.screenshot({
        path: path.join(screenshotsDir, 'palette-p2-' + state + '-' + platform + '-' + mode + '.png'),
      })
    }

    // Chrome: matched sig, search owns focus, nothing preselected, no FABs.
    const started = Date.now()
    await window.locator('#search').fill('sig')
    await expect(window.locator('#phrase-list > .phrase-item').first().locator('strong'))
      .toHaveText('sig')
    await expect(window.locator('#search')).toBeFocused()
    await expect(window.locator('.phrase-item').first()).toHaveCSS('animation-name', 'none')
    await expect(window.locator('#phrase-list .is-selected')).toHaveCount(0)
    await expect(window.locator('.palette-enter-hint:visible')).toHaveCount(0)
    await expect(window.locator('.btn-fab')).toHaveCount(0)
    await expect(window.locator('.titlebar-actions > #btn-settings')).toBeVisible()
    await expect(window.locator('.palette-search > #search-btn')).toBeVisible()
    await expect(window.locator('.palette-search > #add-phrase')).toBeVisible()
    await expect(window.locator('#search-clear')).toBeVisible()
    await testInfo.attach('query-latency', {
      body: JSON.stringify({ query: 'sig', fixtureRows: 2, observedMilliseconds: Date.now() - started }),
      contentType: 'application/json',
    })
    // Only now may the screenshot helper suppress unrelated transitions.
    await suppressAnimation(window)
    await capture('chrome')

    // Create: successful, current, non-empty no-match. Add stays separate.
    await window.locator('#search').fill('welcome client')
    await expect(window.locator('[data-palette-action="create"]')).toBeVisible()
    await expect(window.locator('[data-palette-action="create"].is-selected')).toHaveCount(0)
    await expect(window.locator('#phrase-list > .phrase-item')).toHaveCount(0)
    await expect(window.locator('#add-phrase')).toBeVisible()
    await capture('create')

    // Settings, expired trial: pinned activation row above daily preferences.
    await window.locator('#search').fill('')
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')
    await window.locator('#btn-settings').click()
    await expect(window.locator('#modal-settings')).toBeVisible()
    await expect(window.locator('#license-status-trial')).toHaveText('Trial expired')
    await expect(window.locator('#license-buy-btn')).toBeVisible()
    await expect(window.locator('#settings-tab-preferences'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(window.locator('#settings-database')).toBeHidden()
    await expect(window.locator('#settings-about')).toBeHidden()
    await expect(window.locator('#btn-settings-save')).toHaveText('Save preferences')
    await capture('settings-expired')

    // Database at its scroll end with five long recents: the rail, the pinned
    // band and the footer must all stay exactly where they were.
    await window.locator('#settings-tab-database').click()
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('database:recentList',
        Array.from({ length: 5 }, (_, i) =>
          'C:\\fixture\\' + 'long-directory-'.repeat(12) + i + '.db'))
    })
    await expect(window.locator('#recent-databases button')).toHaveCount(5)
    await expect(window.locator('#new-db-btn')).toBeVisible()
    await window.locator('#settings-database').evaluate(
      element => { element.scrollTop = element.scrollHeight })
    await expect(window.locator('#settings-tabs')).toBeVisible()
    await expect(window.locator('#license-section-trial')).toBeVisible()
    await expect(window.locator('#modal-settings .modal-footer')).toBeVisible()
    await capture('settings-database-overflow')
    await window.locator('#btn-settings-cancel').click()
    await expect(window.locator('#modal-settings')).toBeHidden()

    // Licensed: no activation banner, Preferences selected, others hidden.
    await electronApp.evaluate((_electron, status) => {
      globalThis.__pvChrome.license = status
    }, licensedStatus)
    await window.locator('#btn-settings').click()
    await expect(window.locator('#modal-settings')).toBeVisible()
    await expect(window.locator('#license-section-trial')).toBeHidden()
    await expect(window.locator('#settings-preferences #settings-theme')).toBeVisible()
    await expect(window.locator('#settings-database')).toBeHidden()
    await expect(window.locator('#settings-about')).toBeHidden()
    await capture('settings-licensed')
  })

  // =========================================================================
  // Wave 1 named matrix: status states, the four license bands, the Database
  // overflow and the licensed About pane, at the actual 800x600 floor.
  // =========================================================================

  paletteTest('UI W1 named states ' + mode, async ({ electronApp, window }, testInfo) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await installChromeProbe(electronApp)
    await setCommittedTheme(window, dark)
    const platform = await electronApp.evaluate(() => process.platform)

    const capture = async (name: string): Promise<void> => {
      const metadata = await window.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio, platform: window.platform, locale: document.documentElement.lang,
        effectiveTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      }))
      const bounds = await electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
      expect([bounds.width, bounds.height]).toEqual([800, 600])
      const license = await electronApp.evaluate(() => globalThis.__pvChrome.license)
      await testInfo.attach(name + '-metadata', {
        body: JSON.stringify({ ...metadata, bounds, license, fixture: 'palette-bootstrap' }),
        contentType: 'application/json',
      })
      await window.screenshot({
        path: path.join(screenshotsDir, 'ui-w1-' + name + '-' + platform + '-' + mode + '.png'),
      })
    }

    // P0 animation must be settled before the helper suppresses transitions.
    await window.locator('#search').fill('sig')
    await expect(window.locator('#phrase-list > .phrase-item').first().locator('strong'))
      .toHaveText('sig')
    await expect(window.locator('.phrase-item').first()).toHaveCSS('animation-name', 'none')
    await suppressAnimation(window)
    await window.locator('#search').fill('')
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')

    for (const state of ['available', 'loading', 'error'] as const) {
      await electronApp.evaluate(({ BrowserWindow }, state) => {
        const web = BrowserWindow.getAllWindows()[0].webContents
        if (state === 'error') web.send('database:error', 'named capture fixture')
        else web.send('database:status', state === 'available')
      }, state)
      await expect(window.locator('#btn-db-status')).toHaveAttribute('data-state', state)
      await expect(window.locator('.titlebar-actions > #btn-db-status + #btn-settings'))
        .toHaveCount(1)
      await capture('status-' + state)
    }
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('database:status', true)
    })
    await expect(window.locator('#phrase-list')).toHaveAttribute('data-phase', 'ready')

    const bands = [
      ['trial', { ...expiredLicense, trial: { active: true, daysRemaining: 7, expired: false } }],
      ['expired', expiredLicense],
      ['unlicensed', {
        ...expiredLicense, trial: { active: false, daysRemaining: 0, expired: false },
      }],
      ['licensed', licensedStatus],
    ] as const

    for (const [name, status] of bands) {
      await electronApp.evaluate((_electron, status) => {
        globalThis.__pvChrome.license = status
      }, status)
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await expect(window.locator('#settings-tab-preferences'))
        .toHaveAttribute('aria-selected', 'true')
      await expect(window.locator('#license-section-trial'))
        .toBeVisible({ visible: name !== 'licensed' })
      await expect(window.locator('#btn-settings-save')).toBeVisible()
      await capture('preferences-' + name)
      if (name === 'licensed') {
        await window.locator('#settings-tab-about').click()
        await expect(window.locator('#license-email')).toHaveText('fixture@example.test')
        await expect(window.locator('#license-deactivate-btn')).toBeVisible()
        await expect(window.locator('#check-updates-btn')).toBeVisible()
        await expect(window.locator('#version-text')).toBeVisible()
        await capture('about')
      }
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()
    }

    // Activation error band: a real empty-key submission, not a manufactured node.
    await electronApp.evaluate(() => {
      globalThis.__pvChrome.license = {
        hasLicense: false, license: null, isLegacyUser: false,
        trial: { active: false, daysRemaining: 0, expired: true },
      }
    })
    await window.locator('#btn-settings').click()
    await window.locator('#license-key-input').fill('')
    await window.locator('#license-activate-btn').click()
    await expect(window.locator('#license-error')).toBeVisible()
    await capture('preferences-activation-error')

    // Database overflow: five long recents, panel scrolled to its end.
    await window.locator('#settings-tab-database').click()
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('database:recentList',
        Array.from({ length: 5 }, (_, i) =>
          'C:\\fixture\\' + 'long-directory-'.repeat(12) + i + '.db'))
    })
    await expect(window.locator('#recent-databases button')).toHaveCount(5)
    await window.locator('#settings-database').evaluate(
      element => { element.scrollTop = element.scrollHeight })
    await expect(window.locator('#settings-tabs')).toBeVisible()
    await expect(window.locator('#modal-settings .modal-footer')).toBeVisible()
    await capture('database-overflow')
  })

  paletteTest('P2 named last row ' + mode, async ({ electronApp, window }, testInfo) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await installChromeProbe(electronApp)
    await setCommittedTheme(window, dark)
    const platform = await electronApp.evaluate(() => process.platform)
    await seedOverflow(window)

    const list = window.locator('#phrase-list')
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    const last = '#phrase-list > .phrase-item:last-child'
    await window.locator(last).focus()
    await expect(window.locator(last)).toBeFocused()
    await expect(window.locator(last + ' [data-action="copy"]')).toBeVisible()
    await expect(window.locator(last + ' [data-action="edit"]')).toBeVisible()
    await expect(window.locator(last + ' button[title="More"]')).toBeVisible()
    await expect(window.locator('.phrase-menu[data-state="open"]')).toHaveCount(0)
    await expect(window.locator('.phrase-item').first()).toHaveCSS('animation-name', 'none')
    await suppressAnimation(window)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })

    const metadata = await window.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio, platform: window.platform,
      effectiveTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    }))
    const bounds = await electronApp.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
    expect([bounds.width, bounds.height]).toEqual([800, 600])
    const license = await electronApp.evaluate(() => globalThis.__pvChrome.license)
    await testInfo.attach('last-row-metadata', {
      body: JSON.stringify({ ...metadata, bounds, license }), contentType: 'application/json',
    })
    await window.screenshot({
      path: path.join(screenshotsDir, 'palette-p2-last-row-' + platform + '-' + mode + '.png'),
    })
  })
}



// =============================================================================
// Wave 2 composer geometry and named captures
// =============================================================================

paletteTest('UI W2 geometry keeps the composer footer fixed',
  async ({ electronApp, window }) => {
    await seedPalette(electronApp, window)
    await useMinimumWindow(electronApp)
    await window.locator('#add-phrase').click()
    await expect(window.locator('#phraseInput')).toBeFocused()
    await expect(window.locator('#phrase-name-label')).toHaveAttribute('for', 'phraseInput')
    await expect(window.locator('#phrase-expanded-label'))
      .toHaveAttribute('for', 'expandedTextInput')
    await expect(window.locator('#phrase-format-label')).toHaveText('Format')
    await settleDialog(window, '#modal-phrase .modal')

    // Closed English shelf at 180px shows the whole form without body scroll.
    const body = window.locator('#modal-phrase .modal-body')
    expect(await body.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
    expect((await window.locator('#expandedTextInput').boundingBox())!.height).toBe(180)
    const footer = await window.locator('#modal-phrase .modal-footer').boundingBox()

    await window.locator('#phrase-insert-more').click()
    await window.locator('#expandedTextInput').evaluate(
      (el: HTMLTextAreaElement) => { el.style.height = '260px' })
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    // Only the body scrolls: the footer box never moves.
    expect(await window.locator('#modal-phrase .modal-footer').boundingBox()).toEqual(footer)
    await expectWithin(window, '#phrase-format', '#modal-phrase .modal-body')
    await expectWithin(window, '#saveButton', '#modal-phrase .modal')
    await expectWithin(window, '#btn-phrase-cancel', '#modal-phrase .modal')
    for (const id of ['#modal-phrase .modal', '#phrase-insert-shelf', '#phrase-insert-more-panel']) {
      expect(await window.locator(id).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }

    // Cancel writes nothing and a fresh form resets the dragged height.
    await window.locator('#btn-phrase-cancel').click()
    await expect(window.locator('#modal-phrase')).toBeHidden()
    await window.locator('#add-phrase').click()
    await expect(window.locator('#phrase-insert-more-panel')).toBeHidden()
    // The reopened dialog animates from scale(0.98); measure the settled box.
    await settleDialog(window, '#modal-phrase .modal')
    expect((await window.locator('#expandedTextInput').boundingBox())!.height).toBe(180)
  })

for (const dark of [false, true]) {
  const composerMode = dark ? 'dark' : 'light'

  paletteTest('UI W2 named composer ' + composerMode,
    async ({ electronApp, window }, testInfo) => {
      await seedPalette(electronApp, window)
      await useMinimumWindow(electronApp)
      await installChromeProbe(electronApp)
      await setCommittedTheme(window, dark)
      const platform = await electronApp.evaluate(() => process.platform)

      const capture = async (state: 'composer' | 'more' | 'more-fresh'): Promise<void> => {
        const metadata = await window.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          devicePixelRatio, platform: window.platform,
          effectiveTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        }))
        const bounds = await electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
        expect([bounds.width, bounds.height]).toEqual([800, 600])
        const license = await electronApp.evaluate(() => globalThis.__pvChrome.license)
        await testInfo.attach('ui-w2-' + state + '-metadata', {
          body: JSON.stringify({ ...metadata, bounds, license, locale: 'en' }),
          contentType: 'application/json',
        })
        await window.screenshot({
          path: path.join(screenshotsDir,
            'ui-w2-' + state + '-' + platform + '-' + composerMode + '.png'),
        })
      }

      await window.locator('#add-phrase').click()
      await expect(window.locator('#phraseInput')).toBeFocused()
      await window.locator('#phraseInput').fill('welcome reply')
      const editor = window.locator('#expandedTextInput')
      await editor.focus()
      await window.locator('#phrase-insert-date').click()
      await window.locator('#phrase-insert-field').click()
      // Raw literals, never evaluated values.
      await expect(editor).toHaveValue('{{date}}{{input:Label}}')
      await expect(window.locator('input[name="phraseType"][value="text"]')).toBeChecked()
      await expect(window.locator('#btn-phrase-cancel')).toBeVisible()
      await settleDialog(window, '#modal-phrase .modal')

      // Chip and label text must be readable on the dialog surface it sits on.
      await requireContrast(window, '#phrase-insert-date', 4.5)
      await requireContrast(window, '#phrase-name-label', 4.5)
      await requireContrast(window, '#phrase-format-label', 4.5)
      await suppressAnimation(window)
      await capture('composer')

      await window.locator('#phrase-insert-more').click()
      await expect(window.locator('#phrase-picker')).toBeEnabled()
      await requireContrast(window, '#phrase-insert-year', 4.5)
      expect(await window.locator('#modal-phrase .modal-body').evaluate(el => el.scrollTop)).toBe(0)
      await capture('more-fresh')
      await editor.evaluate((el: HTMLTextAreaElement) => { el.style.height = '260px' })
      await window.locator('#modal-phrase .modal-body').evaluate(
        el => { el.scrollTop = el.scrollHeight })
      await expectWithin(window, '#phrase-format', '#modal-phrase .modal-body')
      await expectWithin(window, '#saveButton', '#modal-phrase .modal')
      await capture('more')
    })
}

async function waitForVaultReady(window: Page): Promise<void> {
  await expect.poll(async () => window.evaluate(async () => {
    const status = await window.api.invoke<{ available: boolean }>('vault:getStatus')
    return status.available
  }), { timeout: 20000 }).toBe(true)
}

for (const dark of [false, true]) {
  const vaultMode = dark ? 'dark' : 'light'

  paletteTest('named vault PIN and Security ' + vaultMode,
    async ({ electronApp, window }, testInfo) => {
      await seedPalette(electronApp, window)
      await waitForVaultReady(window)
      await useMinimumWindow(electronApp)
      await installChromeProbe(electronApp)
      await setCommittedTheme(window, dark)
      const platform = await electronApp.evaluate(() => process.platform)

      const capture = async (name: string): Promise<void> => {
        const metadata = await window.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          devicePixelRatio, platform: window.platform,
          effectiveTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        }))
        const bounds = await electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
        expect([bounds.width, bounds.height]).toEqual([800, 600])
        const license = await electronApp.evaluate(() => globalThis.__pvChrome.license)
        await testInfo.attach(name + '-metadata', {
          body: JSON.stringify({ ...metadata, bounds, license, locale: 'en' }),
          contentType: 'application/json',
        })
        await window.screenshot({
          path: path.join(screenshotsDir, name + '-' + platform + '-' + vaultMode + '.png'),
        })
      }

      await suppressAnimation(window)
      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#settings-tab-security').click()
      await expect(window.locator('#settings-security')).toBeVisible()
      await expect(window.locator('#vault-empty-hint')).toBeVisible()
      await settleDialog(window)
      await capture('vault-security-empty')
      await window.locator('#btn-settings-cancel').click()
      await expect(window.locator('#modal-settings')).toBeHidden()

      await window.locator('#add-phrase').click()
      await expect(window.locator('#phraseInput')).toBeFocused()
      await window.locator('#phraseInput').fill('api key')
      await window.locator('#expandedTextInput').fill('sk-live-DO-NOT-LEAK-9713')
      await window.locator('#phrase-lock').check()
      await expect(window.locator('#modal-vault-pin')).toBeVisible()
      await settleDialog(window, '#modal-vault-pin .modal')
      await capture('vault-pin-setup')
      await window.locator('#vault-pin-new').fill('1234')
      await window.locator('#vault-pin-confirm').fill('1234')
      await window.locator('#btn-vault-pin-submit').click()
      await expect(window.locator('#modal-vault-pin')).toBeHidden({ timeout: 20000 })
      await window.locator('#saveButton').click()
      await expect(window.locator('#modal-phrase')).toBeHidden()

      await window.evaluate(() => window.api.invoke('vault:lock'))
      const row = window.locator('#phrase-list > .phrase-item', { hasText: 'api key' })
      await expect(row.locator('.phrase-lock-glyph')).toBeVisible()
      await row.locator('button[data-action="copy"]').click()
      await expect(window.locator('#modal-vault-pin')).toBeVisible()
      await settleDialog(window, '#modal-vault-pin .modal')
      await capture('vault-pin-unlock')
      await window.locator('#vault-pin-new').fill('1234')
      await window.locator('#btn-vault-pin-submit').click()
      await expect(window.locator('#modal-vault-pin')).toBeHidden({ timeout: 20000 })

      await window.locator('#btn-settings').click()
      await expect(window.locator('#modal-settings')).toBeVisible()
      await window.locator('#settings-tab-security').click()
      await expect(window.locator('#settings-security')).toBeVisible()
      await expect(window.locator('#btn-vault-change-pin')).toBeEnabled()
      await settleDialog(window)
      await capture('vault-security-configured')
      await window.locator('#btn-vault-change-pin').click()
      await expect(window.locator('#modal-vault-pin')).toBeVisible()
      await settleDialog(window, '#modal-vault-pin .modal')
      await capture('vault-pin-change')
    })
}

// =============================================================================
// Wave 0 shared token hygiene
//
// These measure rendered consumers, not custom-property text: a token can carry
// the right name and still be swallowed by `outline: none` or a collapsed
// surface.
//
// Scope matters as much as rendering. #modal-settings and #modal-phrase carry
// PhraseVault-local --border-light and the :root block carries a local
// --text-muted, so a subject inside them proves the local role, not the shared
// mapping. Subjects that do prove the shared mapping are marked "shared probe"
// and are all outside those scopes: #search::placeholder for --text-tertiary,
// #modal-purchase-reminder for --border-light, and the dynamic prompt for
// --focus-ring. Surfaces are a PhraseVault-local group after the Wave 0
// fallback, so their probes prove the local table plus a live hover.
// =============================================================================

paletteTest('UI W0 surfaces distinguish canvas secondary and elevated', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await installChromeProbe(electronApp)
  await setCommittedTheme(window, false)
  await window.locator('#btn-settings').click()
  await expect(window.locator('#settings-tab-preferences')).toBeFocused()
  await window.mouse.move(0, 0)
  const selectors = ['#license-key-input', '#btn-settings-cancel', '#modal-settings .modal']
  for (const selector of selectors) await settleStyles(window, selector)
  const colors = await Promise.all(selectors.map(selector =>
    window.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor)))
  expect(new Set(colors).size).toBe(3)
  expect(colors[2]).toBe('rgb(255, 255, 255)')
  // The shared secondary button rests on --bg-secondary and hovers on
  // --bg-tertiary. Mapping both onto one shade deletes the hover state for
  // every .btn-secondary, which is exactly what promoting the wave's surface
  // candidate did. Cancel is a plain shared .btn-secondary with no local fill.
  const cancel = window.locator('#btn-settings-cancel')
  await settleStyles(window, '#btn-settings-cancel')
  const restFill = await cancel.evaluate(el => getComputedStyle(el).backgroundColor)
  await cancel.hover()
  await settleStyles(window, '#btn-settings-cancel')
  await expect.poll(async () => cancel.evaluate(el => getComputedStyle(el).backgroundColor))
    .not.toBe(restFill)
  await window.mouse.move(0, 0)
  await settleStyles(window, '#btn-settings-cancel')
  await expect.poll(async () => cancel.evaluate(el => getComputedStyle(el).backgroundColor))
    .toBe(restFill)
  await requireContrast(window, '#shortcut-hint', 4.5)
  await requireContrast(window, '#license-status-trial', 4.5)
  await window.locator('#btn-settings-cancel').click()
  await expect(window.locator('#modal-settings')).toBeHidden()
  await setCommittedTheme(window, true)
  await window.locator('#btn-settings').click()
  await window.locator('#settings-tab-database').click()
  // Wave 1 local regression only: #modal-settings overrides --border-light, so
  // this cannot fail on a shared-mapping revert.
  const rule = await window.locator('#settings-tabs').evaluate(el => {
    const style = getComputedStyle(el)
    return { width: style.borderRightWidth, color: style.borderRightColor }
  })
  expect(rule.width).toBe('1px')
  expect(rule.color).not.toBe(await window.locator('#modal-settings .modal')
    .evaluate(el => getComputedStyle(el).backgroundColor))
  await window.locator('#btn-settings-cancel').click()
  await expect(window.locator('#modal-settings')).toBeHidden()
  // Shared --border-light probe in both themes. The purchase reminder carries
  // no PhraseVault override, so it renders the shared mapping. Pre-wave dark
  // made the rule identical to the fill; pre-wave light used secondary-100 on
  // a white dialog, which is a weaker but still distinct rule — both must fail
  // if their shared mapping reverts.
  for (const dark of [true, false]) {
    await setCommittedTheme(window, dark)
    await window.evaluate(() => window.modals.openPurchaseReminderModal())
    await expect(window.locator('#modal-purchase-reminder.active')).toHaveCount(1)
    await settleStyles(window, '#modal-purchase-reminder .modal')
    const shared = await window.locator('#modal-purchase-reminder .modal-footer').evaluate(el => {
      const style = getComputedStyle(el)
      return { width: style.borderTopWidth, color: style.borderTopColor }
    })
    expect(shared.width).toBe('1px')
    expect(shared.color).not.toBe(await window.locator('#modal-purchase-reminder .modal')
      .evaluate(el => getComputedStyle(el).backgroundColor))
    await closeModalViaEscape(window)
    await expect(window.locator('#modal-purchase-reminder')).toBeHidden()
  }
})

// Neutral text roles on their real surfaces, in both modes.
//
// Only the placeholder proves the shared mapping. --text-muted is overridden in
// PhraseVault's own :root/.dark, so every muted subject below is a Wave 1 local
// regression and stays green on a shared revert; they are kept because the
// local roles still have to measure.
paletteTest('UI W0 tertiary and muted text stay readable', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await installChromeProbe(electronApp)
  for (const dark of [false, true]) {
    await setCommittedTheme(window, dark)
    // Shared --text-tertiary probe: .input::placeholder on #search, which sits
    // in the main window outside both locally corrected dialogs. Read through
    // the pseudo-element, since the element's own color is --text-primary.
    await requireContrast(window, '#search', 4.5, 'color', '::placeholder')
    await window.locator('#btn-settings').click()
    await expect(window.locator('#modal-settings')).toBeVisible()
    await requireContrast(window, '#shortcut-hint', 4.5)
    await requireContrast(window, '#license-status-trial', 4.5)
    await window.locator('#settings-tab-about').click()
    await requireContrast(window, '#modal-settings .settings-version', 4.5)
    await window.locator('#settings-tab-preferences').click()
    await window.locator('#btn-settings-cancel').click()
    await expect(window.locator('#modal-settings')).toBeHidden()
  }
})

paletteTest('UI W0 focus survives input filled and checked consumers', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await installChromeProbe(electronApp)
  for (const dark of [false, true]) {
    await setCommittedTheme(window, dark)
    await window.locator('#add-phrase').click()
    await expect(window.locator('#phraseInput')).toBeFocused()
    // Establish keyboard modality without forcing :focus-visible in CSS.
    await window.keyboard.press('Tab')
    await window.keyboard.press('Shift+Tab')
    await expect(window.locator('#phraseInput')).toBeFocused()
    await settleStyles(window, '#phraseInput')
    expect(await window.locator('#phraseInput').evaluate(el => {
      const style = getComputedStyle(el)
      return [el.matches(':focus-visible'), style.outlineStyle, style.outlineWidth,
        style.outlineOffset]
    })).toEqual([true, 'solid', '2px', '-2px'])
    await requireContrast(window, '#phraseInput', 3, 'outlineColor')
    await window.locator('#saveButton').focus()
    await settleStyles(window, '#saveButton')
    expect(await window.locator('#saveButton').evaluate(el => {
      const style = getComputedStyle(el)
      return style.outlineColor === style.color && style.outlineOffset === '-2px'
    })).toBe(true)
    await requireContrast(window, '#saveButton', 3, 'outlineColor')
    await window.locator('#saveButton').hover()
    await requireContrast(window, '#saveButton', 3, 'outlineColor')
    const radio = window.locator('input[name="phraseType"][value="text"]')
    await radio.focus()
    await expect(radio).toBeChecked()
    await settleStyles(window, 'input[name="phraseType"][value="text"]')
    expect(await radio.evaluate(el => getComputedStyle(el).outlineOffset)).toBe('2px')
    // The dialog close keeps its outward ring on the semantic colour.
    await window.locator('#modal-phrase .modal-close').focus()
    await settleStyles(window, '#modal-phrase .modal-close')
    expect(await window.locator('#modal-phrase .modal-close').evaluate(el => {
      const style = getComputedStyle(el)
      return [style.outlineStyle, style.outlineWidth, style.outlineOffset]
    })).toEqual(['solid', '2px', '2px'])
    await requireContrast(window, '#modal-phrase .modal-close', 3, 'outlineColor')
    await window.locator('#btn-phrase-cancel').click()
    await expect(window.locator('#modal-phrase')).toBeHidden()
  }
})

paletteTest('UI W0 focus reaches the shared dynamic input', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await setCommittedTheme(window, true)
  await window.locator('#add-phrase').click()
  await window.locator('#phraseInput').fill('focus dynamic fixture')
  await window.locator('#expandedTextInput').fill('Hello {{input:Name=World}}!')
  await window.locator('#saveButton').click()
  await expect(window.locator('#modal-phrase')).toBeHidden()
  const row = window.locator('#phrase-list > .phrase-item', { hasText: 'focus dynamic fixture' })
  await expect(row).toBeVisible()
  await row.locator('[data-action="copy"]').click()
  const field = window.locator('#dynamic-field-0')
  await expect(field).toBeFocused()
  await window.keyboard.press('Tab')
  await window.keyboard.press('Shift+Tab')
  await expect(field).toBeFocused()
  await settleStyles(window, '#dynamic-field-0')
  const actual = await field.evaluate(el => {
    const sample = document.createElement('span')
    sample.style.color = 'var(--palette-outline)'
    el.parentElement!.appendChild(sample)
    const expected = getComputedStyle(sample).color
    sample.remove()
    const style = getComputedStyle(el)
    return { visible: el.matches(':focus-visible'), style: style.outlineStyle,
      width: style.outlineWidth, colorMatches: style.outlineColor === expected }
  })
  expect(actual).toEqual({ visible: true, style: 'solid', width: '2px', colorMatches: true })
  await requireContrast(window, '#dynamic-field-0', 3, 'outlineColor')
  await window.keyboard.press('Escape')
  await expect(window.locator('#modal-dynamic')).toBeHidden()
})

// Forced colors must keep a visible system-adjusted ring; nothing may opt out
// of the system palette to preserve an authored one.
paletteTest('UI W0 forced colors keep a visible system outline', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await window.emulateMedia({ forcedColors: 'active' })
  await window.locator('#add-phrase').click()
  await expect(window.locator('#phraseInput')).toBeFocused()
  await window.keyboard.press('Tab')
  await window.keyboard.press('Shift+Tab')
  await expect(window.locator('#phraseInput')).toBeFocused()
  await settleStyles(window, '#phraseInput')
  // Forced colors substitutes the system ring, including its own width, so the
  // authored 2px is not the subject: only a visible solid outline and the
  // absence of an opt-out are.
  const forced = await window.locator('#phraseInput').evaluate(el => {
    const style = getComputedStyle(el)
    return { adjust: style.forcedColorAdjust, style: style.outlineStyle,
      width: parseFloat(style.outlineWidth) }
  })
  expect(forced.adjust).toBe('auto')
  expect(forced.style).toBe('solid')
  expect(forced.width).toBeGreaterThanOrEqual(2)
  await window.emulateMedia({ forcedColors: 'none' })
  await window.locator('#btn-phrase-cancel').click()
  await expect(window.locator('#modal-phrase')).toBeHidden()
})
