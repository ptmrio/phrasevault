/**
 * Shared in-page window-controls E2E spec body
 *
 * One set of cases reused by every app. It proves the native caption surfaces
 * are gone, the in-page cluster has the locked geometry, and an open modal
 * covers, disables and un-drags the whole bar.
 *
 * @example
 * ```typescript
 * registerWindowControlsTests(test, {
 *   openModal: async (window) => { await window.locator('#btn-settings').click() },
 *   modalSelector: '#modal-settings',
 *   closeModal: async (window) => { await window.locator('#btn-settings-cancel').click() },
 *   closePolicy: 'hide',
 * })
 * ```
 */

import { expect, expectNoConsoleErrors, type Page } from './fixtures'
import type { createElectronTest } from './fixtures'
import { waitForAppReady } from './utils'
import { assertCSSHealth } from './css-health'
import { waitForModalVisible, waitForModalHidden, isAnyModalVisible } from './modal-helpers'

export interface WindowControlsSpecOptions {
  /** Open this app's canonical modal from a clean window. */
  openModal: (window: Page) => Promise<void>
  /** The overlay selector `openModal` opens. */
  modalSelector: string
  /** Dismiss it again. */
  closeModal: (window: Page) => Promise<void>
  /**
   * What clicking Close with no modal open must do. 'hide' asserts the
   * process is still alive and the window is not visible (tray policy);
   * 'quit' asserts the window count drops to zero. The assertion is on the
   * documented behavior, never on process death.
   */
  closePolicy: 'hide' | 'quit'
}

/**
 * Apps can legitimately have a modal open at launch (a trial reminder, a
 * licence agreement). A modal blocks the caption by design, so every case
 * starts from a clean window.
 */
async function dismissStartupModals(window: Page): Promise<void> {
  // Startup modals are often deferred by a timer, so settle first: dismissing
  // "nothing" and then having a reminder appear mid-test is a real flake.
  await window.waitForTimeout(800)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!(await isAnyModalVisible(window))) return
    await window.keyboard.press('Escape')
    await window.waitForTimeout(400)
  }
}

export function registerWindowControlsTests(
  test: ReturnType<typeof createElectronTest>,
  options: WindowControlsSpecOptions
): void {
  test.describe('Window controls', () => {
    test('window controls replace the native caption', async ({ window, consoleErrors }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)

      // The native Windows Control Overlay is gone; if titleBarOverlay came back
      // this reports visible: true.
      const overlay = await window.evaluate(() => {
        const wco = (
          navigator as Navigator & {
            windowControlsOverlay?: { visible: boolean }
          }
        ).windowControlsOverlay
        return wco === undefined ? null : wco.visible
      })
      expect(overlay === null || overlay === false).toBe(true)

      // data-platform is on the document element, written at preload time.
      const platform = await window.evaluate(() => document.documentElement.dataset.platform)
      expect(platform === 'win32' || platform === 'darwin' || platform === 'linux').toBe(true)

      // No reserved voids: the bar spans the whole viewport.
      const bar = await window.evaluate(() => {
        const el = document.querySelector('.titlebar') as HTMLElement
        const box = el.getBoundingClientRect()
        const computed = getComputedStyle(document.documentElement)
        return {
          left: box.left,
          right: box.right,
          height: box.height,
          viewportWidth: globalThis.innerWidth,
          controlsWidth: computed.getPropertyValue('--titlebar-controls-width').trim(),
          trafficWidth: computed.getPropertyValue('--titlebar-traffic-lights-width').trim(),
          parent: el.parentElement?.tagName,
        }
      })
      expect(bar.left).toBe(0)
      expect(bar.right).toBe(bar.viewportWidth)
      expect(bar.height).toBe(32)
      expect(bar.controlsWidth).toBe('')
      expect(bar.trafficWidth).toBe('')
      expect(bar.parent).toBe('BODY')

      // Structural invariant: nothing between the bar (or any overlay) and <body>
      // may contain a fixed element, or the backdrop cannot cover the captions.
      const containing = await window.evaluate(() => {
        const bad: string[] = []
        const check = (el: Element | null) => {
          if (!el) return
          if (el.parentElement?.tagName !== 'BODY') bad.push(`${el.className}: parent is not BODY`)
          let node = el.parentElement
          while (node && node !== document.documentElement) {
            const s = getComputedStyle(node)
            const pairs: [string, string][] = [
              ['transform', s.transform],
              ['filter', s.filter],
              ['backdropFilter', s.backdropFilter],
              ['perspective', s.perspective],
              ['contain', s.contain],
              ['willChange', s.willChange],
            ]
            for (const [prop, value] of pairs) {
              if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
                bad.push(`${node.tagName}.${node.className}: ${prop}=${value}`)
              }
            }
            node = node.parentElement
          }
        }
        check(document.querySelector('.titlebar'))
        document.querySelectorAll('.modal-overlay').forEach(check)
        return bad
      })
      expect(containing).toEqual([])

      const group = window.locator('[data-testid="window-controls"]')
      await expect(group).toBeVisible()
      await expect(group).toHaveAttribute('role', 'group')

      const geometry = await window.evaluate(() => {
        const g = document.querySelector('[data-testid="window-controls"]') as HTMLElement
        const box = g.getBoundingClientRect()
        const cells = Array.from(g.querySelectorAll('.window-control')).map((c) => {
          const b = c.getBoundingClientRect()
          return { w: Math.round(b.width), h: Math.round(b.height) }
        })
        const first = g.querySelector('.window-control')!.getBoundingClientRect()
        return {
          cluster: g.dataset.platformCluster,
          width: Math.round(box.width),
          height: Math.round(box.height),
          left: Math.round(box.left),
          right: Math.round(box.right),
          viewportWidth: globalThis.innerWidth,
          cells,
          firstCircle: {
            x: Math.round(first.left + first.width / 2 - 6),
            y: Math.round(first.top + first.height / 2 - 6),
          },
          prevSibling: g.previousElementSibling?.className ?? '',
          nextSibling: g.nextElementSibling?.className ?? '',
        }
      })

      expect(geometry.cells).toHaveLength(3)
      expect(geometry.height).toBe(32)

      if (geometry.cluster === 'darwin') {
        expect(geometry.width).toBe(78)
        expect(geometry.left).toBe(0)
        geometry.cells.forEach((c) => expect(c).toEqual({ w: 20, h: 32 }))
        // The first circle lands exactly where the retired trafficLightPosition
        // put it: top-left (12, 10).
        expect(geometry.firstCircle).toEqual({ x: 12, y: 10 })
        expect(geometry.nextSibling).toContain('titlebar-left')
      } else {
        expect(geometry.width).toBe(138)
        expect(geometry.right).toBe(geometry.viewportWidth)
        geometry.cells.forEach((c) => expect(c).toEqual({ w: 46, h: 32 }))
        expect(geometry.prevSibling).toContain('titlebar-actions')
      }

      const expected =
        geometry.cluster === 'darwin'
          ? ['close', 'minimize', 'fullscreen']
          : ['minimize', 'maximize', 'close']
      for (const action of expected) {
        await expect(window.locator(`[data-testid="window-control-${action}"]`)).toHaveCount(1)
      }

      await assertCSSHealth(window)
      expectNoConsoleErrors(consoleErrors)
    })

    test('the maximize glyph follows main, not the click', async ({ electronApp, window }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)
      const cluster = await window.evaluate(
        () =>
          (document.querySelector('[data-testid="window-controls"]') as HTMLElement).dataset
            .platformCluster
      )
      test.skip(cluster === 'darwin', 'Windows-only: the darwin cluster has no maximize control')

      const group = window.locator('[data-testid="window-controls"]')
      const maximize = window.locator('[data-testid="window-control-maximize"]')

      // Labels are localized per app, so compare the swap rather than the words.
      const maximizeName = await maximize.getAttribute('aria-label')
      expect(maximizeName).toBeTruthy()

      // No DOM click: main drives the state.
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
      await expect(group).toHaveAttribute('data-maximized', 'true')
      await expect(maximize).not.toHaveAttribute('aria-label', maximizeName!)
      const restoreName = await maximize.getAttribute('aria-label')
      expect(restoreName).toBeTruthy()
      // The accessible name and the tooltip must move together.
      await expect(maximize).toHaveAttribute('title', restoreName!)

      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].unmaximize()
      )
      await expect(group).toHaveAttribute('data-maximized', 'false')
      await expect(maximize).toHaveAttribute('aria-label', maximizeName!)
    })

    test('blur reports an inactive window', async ({ electronApp, window }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)
      const group = window.locator('[data-testid="window-controls"]')
      await expect(group).toHaveAttribute('data-focused', 'true')
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur())
      await expect(group).toHaveAttribute('data-focused', 'false')
    })

    test('an open modal covers, disables and un-drags the caption', async ({
      electronApp,
      window,
      consoleErrors,
    }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)

      await options.openModal(window)
      expect(await waitForModalVisible(window, options.modalSelector, 3000)).toBe(true)

      await expect(window.locator('[data-testid="window-controls"]')).toBeVisible()
      for (const control of await window.locator('.window-control').all()) {
        await expect(control).toBeDisabled()
      }

      const blocked = await window.evaluate(() => {
        const el = document.querySelector('.titlebar') as HTMLElement
        return {
          flag: document.documentElement.dataset.modalOpen,
          inert: el.hasAttribute('inert'),
          appRegion: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim(),
        }
      })
      expect(blocked.flag).toBe('true')
      expect(blocked.inert).toBe(true)
      expect(blocked.appRegion).toBe('no-drag')

      // Raw mouse click at the Close cell, bypassing Playwright actionability so
      // the click really lands on the backdrop. Electron drag regions bypass
      // pointer events, so a z-1000 backdrop alone does not prove this.
      const box = (await window.locator('[data-testid="window-control-close"]').boundingBox())!
      await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await window.waitForTimeout(500)

      // The click landed on the backdrop, not on Close: the window is untouched.
      // The overlay's own backdrop-close then dismisses the modal, which is the
      // shared modal system's pre-existing dismiss path and is deliberately kept.
      expect(electronApp.windows().length).toBe(1)
      expect(
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible()
        )
      ).toBe(true)
      expect(
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMinimized()
        )
      ).toBe(false)

      expectNoConsoleErrors(consoleErrors)
    })

    test('keyboard never reaches the titlebar while a modal is open', async ({ window }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)
      await options.openModal(window)
      expect(await waitForModalVisible(window, options.modalSelector, 3000)).toBe(true)

      for (let i = 0; i < 20; i += 1) {
        await window.keyboard.press('Tab')
        const inTitlebar = await window.evaluate(
          () => document.activeElement?.closest('.titlebar') != null
        )
        expect(inTitlebar).toBe(false)
      }
    })

    test('the block is released after the modal closes', async ({ window }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)
      await options.openModal(window)
      expect(await waitForModalVisible(window, options.modalSelector, 3000)).toBe(true)

      await options.closeModal(window)
      expect(await waitForModalHidden(window, options.modalSelector, 3000)).toBe(true)

      // The block is released only after the exit transition completes, so wait
      // for the flag itself rather than for the overlay's opacity.
      await window.waitForFunction(
        () => document.documentElement.dataset.modalOpen === undefined,
        undefined,
        { timeout: 3000 }
      )

      const released = await window.evaluate(() => {
        const el = document.querySelector('.titlebar') as HTMLElement
        return {
          flag: document.documentElement.dataset.modalOpen,
          inert: el.hasAttribute('inert'),
          appRegion: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim(),
          anyDisabled: Array.from(document.querySelectorAll('.window-control')).some(
            (c) => (c as HTMLButtonElement).disabled
          ),
        }
      })
      expect(released.flag).toBeUndefined()
      expect(released.inert).toBe(false)
      expect(released.appRegion).toBe('drag')
      expect(released.anyDisabled).toBe(false)

      // An ordinary actionable Playwright click now succeeds.
      await window.locator('[data-testid="window-control-minimize"]').click()
    })

    test('close runs the app close policy', async ({ electronApp, window }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)
      await expect(window.locator('[data-testid="window-control-close"]')).toBeEnabled()

      // Arm the close waiter before clicking: a quit-policy app can tear the
      // page down inside click(), and a waiter armed afterwards never fires.
      const pageClosed = window.waitForEvent('close', { timeout: 5000 }).catch(() => undefined)
      await window.locator('[data-testid="window-control-close"]').click().catch(() => undefined)

      if (options.closePolicy === 'hide') {
        // The tray policy intercepts close; the process stays alive and the
        // window is merely hidden. Never assert on process death.
        await window.waitForTimeout(700)
        expect(window.isClosed()).toBe(false)
        expect(electronApp.windows().length).toBe(1)
        expect(
          await electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isVisible()
          )
        ).toBe(false)
      } else {
        // The app does not intercept close, so the window really goes away.
        await pageClosed
        expect(window.isClosed()).toBe(true)
        expect(electronApp.windows().length).toBe(0)
      }
    })

    test('macOS traffic lights drive fullscreen and zoom', async ({ electronApp, window }) => {
      await waitForAppReady(window)
      await dismissStartupModals(window)
      const cluster = await window.evaluate(
        () =>
          (document.querySelector('[data-testid="window-controls"]') as HTMLElement).dataset
            .platformCluster
      )
      test.skip(cluster !== 'darwin', 'macOS-only: the win32 cluster has no fullscreen or zoom')

      const group = window.locator('[data-testid="window-controls"]')
      const green = window.locator('[data-testid="window-control-fullscreen"]')
      const yellow = window.locator('[data-testid="window-control-minimize"]')
      const bar = window.locator('.titlebar')

      // Labels are localized per app, so compare the swap rather than the words.
      const enterName = await green.getAttribute('aria-label')
      expect(enterName).toBeTruthy()

      await green.click()
      await expect(group).toHaveAttribute('data-fullscreen', 'true')
      // The 32px bar stays visible in fullscreen so the exit control is reachable.
      await expect(bar).toBeVisible()
      await expect(green).not.toHaveAttribute('aria-label', enterName!)
      const exitName = await green.getAttribute('aria-label')
      await expect(green).toHaveAttribute('title', exitName!)
      await expect(yellow).toBeDisabled()
      expect(
        await electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isFullScreen()
        )
      ).toBe(true)

      await green.click()
      await expect(group).toHaveAttribute('data-fullscreen', 'false')
      await expect(green).toHaveAttribute('aria-label', enterName!)
      await expect(yellow).toBeEnabled()

      // Option outside fullscreen swaps the glyph, the label and the action together.
      await window.keyboard.down('Alt')
      await expect(green).toHaveAttribute('data-window-action', 'zoom')
      await expect(green).not.toHaveAttribute('aria-label', enterName!)
      const zoomName = await green.getAttribute('aria-label')
      await expect(green).toHaveAttribute('title', zoomName!)
      await green.click({ modifiers: ['Alt'] })
      await window.keyboard.up('Alt')
      await expect(group).toHaveAttribute('data-fullscreen', 'false')
      await expect(green).toHaveAttribute('data-window-action', 'fullscreen')
      await expect(green).toHaveAttribute('aria-label', enterName!)
    })
  })
}
