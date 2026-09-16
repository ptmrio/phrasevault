/**
 * The composer footer and chip density gate.
 *
 * This is the measurement that authorizes the rank-1 density change. It runs at
 * exactly 800x600 at 1x and reads real DOM rectangles: three boxes "inside the
 * footer" is not enough, so the lock label is also asserted to be readable —
 * non-zero, not overlapping either button, and not overflowing its own box.
 *
 * Windows display scaling at 125% and 150% cannot be set from Playwright. That
 * remains a manual gate; setZoomFactor is deliberately not used as a stand-in,
 * because it changes CSS pixel size without reproducing OS text scaling.
 */
import * as path from 'path'
import { fileURLToPath } from 'url'
import { expect, waitForAppReady } from '@spqrkapps/shared/e2e'
import type { Page } from '@spqrkapps/shared/e2e'
import { createPaletteTest, seedPalette } from './palette-fixture'

void path
void fileURLToPath

const test = createPaletteTest()

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface FooterMetrics {
  devicePixelRatio: number
  viewport: { width: number; height: number }
  footer: Box & { scrollWidth: number; clientWidth: number }
  label: Box & { scrollWidth: number; clientWidth: number }
  cancel: Box
  save: Box
  bodyScrolls: boolean
  chips: Box[]
  shelfFits: boolean
  moreFits: boolean
  pickerFits: boolean
}

async function readMetrics(window: Page): Promise<FooterMetrics> {
  return window.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const fits = (selector: string): boolean => {
      const el = document.querySelector(selector)
      if (!el) return true
      return el.scrollWidth <= el.clientWidth + 1
    }
    const footer = document.querySelector('#modal-phrase .modal-footer') as HTMLElement
    const label = document.getElementById('phrase-lock-label') as HTMLElement
    const cancel = document.getElementById('btn-phrase-cancel') as HTMLElement
    const save = document.getElementById('saveButton') as HTMLElement
    const body = document.querySelector('#modal-phrase .modal-body') as HTMLElement
    return {
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      footer: { ...box(footer), scrollWidth: footer.scrollWidth, clientWidth: footer.clientWidth },
      label: { ...box(label), scrollWidth: label.scrollWidth, clientWidth: label.clientWidth },
      cancel: box(cancel),
      save: box(save),
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      // Only chips that are actually on screen: the ones still inside the
      // collapsed More panel have no box to measure.
      chips: [...document.querySelectorAll('#modal-phrase .phrase-insert-chip')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map(box),
      shelfFits: fits('#phrase-insert-shelf'),
      moreFits: fits('#modal-phrase #phrase-insert-more-panel'),
      pickerFits: fits('#modal-phrase .phrase-picker-row'),
    }
  })
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** The three footer children sit on one row when their vertical spans intersect. */
function sameRow(a: Box, b: Box): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height
}

function assertFooterIsOneRow(m: FooterMetrics, locale: string): void {
  // 1x only: a scaled run would not be measuring CSS pixels.
  expect(m.devicePixelRatio, `${locale} devicePixelRatio`).toBe(1)
  expect(m.viewport.width, `${locale} viewport width`).toBe(800)

  // Nothing in the footer is clipped.
  expect(m.footer.scrollWidth, `${locale} footer overflows`).toBeLessThanOrEqual(m.footer.clientWidth + 1)

  // All three share one row.
  expect(sameRow(m.label, m.cancel), `${locale} label/Cancel not on one row`).toBe(true)
  expect(sameRow(m.cancel, m.save), `${locale} Cancel/Save not on one row`).toBe(true)

  // Each is fully inside the footer box.
  for (const [name, child] of [
    ['label', m.label],
    ['cancel', m.cancel],
    ['save', m.save],
  ] as const) {
    expect(child.x, `${locale} ${name} left edge`).toBeGreaterThanOrEqual(m.footer.x - 1)
    expect(child.x + child.width, `${locale} ${name} right edge`).toBeLessThanOrEqual(
      m.footer.x + m.footer.width + 1
    )
  }

  // The lock label is actually readable, not merely present.
  expect(m.label.width, `${locale} lock label collapsed`).toBeGreaterThan(0)
  expect(m.label.height, `${locale} lock label height`).toBeGreaterThanOrEqual(24)
  expect(m.label.scrollWidth, `${locale} lock label text clipped`).toBeLessThanOrEqual(m.label.clientWidth + 1)
  expect(overlaps(m.label, m.cancel), `${locale} lock label overlaps Cancel`).toBe(false)
  expect(overlaps(m.label, m.save), `${locale} lock label overlaps Save`).toBe(false)
  expect(overlaps(m.cancel, m.save), `${locale} Cancel overlaps Save`).toBe(false)

  // Neither button was squeezed.
  expect(m.cancel.width, `${locale} Cancel shrank`).toBeGreaterThan(0)
  expect(m.save.width, `${locale} Save shrank`).toBeGreaterThan(0)
}

for (const locale of ['en', 'de', 'ja']) {
  test(`composer footer is one row at 800x600 1x in ${locale}`, async ({ electronApp, window }) => {
    await seedPalette(electronApp, window)
    await window.evaluate((lang) => window.api.invoke('i18n:changeLanguage', lang), locale)
    await window.setViewportSize({ width: 800, height: 600 })
    // The modal entry animation scales the dialog, so a rectangle read mid-flight
    // measures the transform rather than the layout.
    await window.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
    })

    await window.locator('#phrase-list > .phrase-item').first().locator('button[data-action="edit"]').click()
    await expect(window.locator('#modal-phrase')).toBeVisible()
    await expect(window.locator('#phrase-lock-label')).toBeVisible()

    const closed = await readMetrics(window)
    assertFooterIsOneRow(closed, locale)

    // The composer opens at the fresh 180px textarea without the body scrolling.
    expect(closed.bodyScrolls, `${locale} body scrolls when closed`).toBe(false)

    // Every chip clears the 24x24 WCAG 2.2 AA target minimum.
    for (const chip of closed.chips) {
      expect(chip.width, `${locale} chip width`).toBeGreaterThanOrEqual(24)
      expect(chip.height, `${locale} chip height`).toBeGreaterThanOrEqual(24)
    }
    expect(closed.shelfFits, `${locale} shelf overflows`).toBe(true)
    expect(closed.pickerFits, `${locale} picker row overflows`).toBe(true)

    // With More open the body may scroll, but the footer box must not move.
    const more = window.locator('#phrase-insert-more')
    if (await more.count()) {
      await more.click()
      await expect(window.locator('#phrase-insert-more-panel')).toBeVisible()
      const opened = await readMetrics(window)
      assertFooterIsOneRow(opened, `${locale} (More open)`)
      expect(opened.footer.y, `${locale} footer moved when More opened`).toBeCloseTo(closed.footer.y, 0)
      expect(opened.footer.height, `${locale} footer height changed`).toBeCloseTo(closed.footer.height, 0)
      expect(opened.moreFits, `${locale} More panel overflows`).toBe(true)
      for (const chip of opened.chips) {
        expect(chip.width, `${locale} More chip width`).toBeGreaterThanOrEqual(24)
        expect(chip.height, `${locale} More chip height`).toBeGreaterThanOrEqual(24)
      }
    }
  })
}
