/**
 * CSS Health Check Utilities for E2E Tests
 *
 * Tests to verify CSS is properly loaded and applied.
 */

import type { Page } from '@playwright/test'

export interface CSSHealthCheckResult {
  passed: boolean
  issues: string[]
}

/**
 * Critical CSS variables that should be defined
 */
const CRITICAL_CSS_VARIABLES = [
  '--bg-primary',
  '--bg-secondary',
  '--text-primary',
  '--text-muted',
  '--border-color',
  '--color-primary-500',
  '--color-secondary-500',
  // Window controls
  '--wc-cell-w',
  '--wc-close-hover',
  '--wc-close-active',
  '--wc-mac-close',
  '--wc-mac-minimize',
  '--wc-mac-zoom',
  '--wc-mac-inactive',
  '--wc-mac-glyph',
]

/**
 * Check that critical CSS variables are defined (not empty or 'undefined')
 */
export async function checkCSSVariables(page: Page): Promise<CSSHealthCheckResult> {
  const issues: string[] = []

  const results = await page.evaluate((vars) => {
    const computed = getComputedStyle(document.documentElement)
    return vars.map(varName => ({
      name: varName,
      value: computed.getPropertyValue(varName).trim()
    }))
  }, CRITICAL_CSS_VARIABLES)

  for (const { name, value } of results) {
    if (!value || value === 'undefined' || value === '') {
      issues.push(`CSS variable ${name} is not defined`)
    }
  }

  return { passed: issues.length === 0, issues }
}

/**
 * Check that stylesheets loaded without errors
 */
export async function checkStylesheetsLoaded(page: Page): Promise<CSSHealthCheckResult> {
  const issues: string[] = []

  const stylesheetInfo = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    const styles = Array.from(document.querySelectorAll('style'))

    return {
      linkedStylesheets: links.map(link => ({
        href: (link as HTMLLinkElement).href,
        loaded: (link as HTMLLinkElement).sheet !== null
      })),
      inlineStyleCount: styles.length,
      totalRules: [...links, ...styles].reduce((sum, el) => {
        try {
          const sheet = (el as HTMLLinkElement | HTMLStyleElement).sheet
          return sum + (sheet?.cssRules?.length || 0)
        } catch {
          return sum
        }
      }, 0)
    }
  })

  // Check linked stylesheets loaded
  for (const sheet of stylesheetInfo.linkedStylesheets) {
    if (!sheet.loaded) {
      issues.push(`Stylesheet failed to load: ${sheet.href}`)
    }
  }

  // Should have some CSS rules
  if (stylesheetInfo.totalRules < 10) {
    issues.push(`Very few CSS rules loaded (${stylesheetInfo.totalRules}). CSS may not be working.`)
  }

  return { passed: issues.length === 0, issues }
}

/**
 * Check that body doesn't have default browser styles
 * (indicates CSS is applying)
 */
export async function checkBodyNotDefaultStyles(page: Page): Promise<CSSHealthCheckResult> {
  const issues: string[] = []

  const bodyStyles = await page.evaluate(() => {
    const computed = getComputedStyle(document.body)
    return {
      backgroundColor: computed.backgroundColor,
      fontFamily: computed.fontFamily,
      margin: computed.margin,
    }
  })

  // Body should not have default white background (rgba(0, 0, 0, 0) is transparent default)
  // This is a loose check - just verifying SOMETHING is set
  const isDefaultBg = bodyStyles.backgroundColor === 'rgba(0, 0, 0, 0)'
  if (isDefaultBg) {
    issues.push('Body has no background color set (CSS may not be loaded)')
  }

  // Should have a custom font family, not just default serif
  const isDefaultFont = bodyStyles.fontFamily === 'serif' || bodyStyles.fontFamily === '"Times New Roman"'
  if (isDefaultFont) {
    issues.push('Body has default browser font (CSS may not be loaded)')
  }

  return { passed: issues.length === 0, issues }
}

/**
 * Check for console CSS errors
 */
export async function collectCSSErrors(page: Page): Promise<string[]> {
  const errors: string[] = []

  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' && (
      text.includes('CSS') ||
      text.includes('stylesheet') ||
      text.includes('style') ||
      text.includes('font')
    )) {
      errors.push(text)
    }
  })

  return errors
}

/**
 * Run all CSS health checks
 */
export async function runCSSHealthChecks(page: Page): Promise<{
  allPassed: boolean
  results: Record<string, CSSHealthCheckResult>
}> {
  const results: Record<string, CSSHealthCheckResult> = {
    cssVariables: await checkCSSVariables(page),
    stylesheetsLoaded: await checkStylesheetsLoaded(page),
    bodyStyles: await checkBodyNotDefaultStyles(page),
  }

  const allPassed = Object.values(results).every(r => r.passed)

  return { allPassed, results }
}

/**
 * Assert CSS health checks pass, throw detailed error if not
 */
export async function assertCSSHealth(page: Page): Promise<void> {
  const { allPassed, results } = await runCSSHealthChecks(page)

  if (!allPassed) {
    const allIssues = Object.entries(results)
      .filter(([, r]) => !r.passed)
      .flatMap(([name, r]) => r.issues.map(issue => `[${name}] ${issue}`))

    throw new Error(`CSS health check failed:\n${allIssues.join('\n')}`)
  }
}

/**
 * Component style expectations for verification
 */
export interface ComponentStyleCheck {
  selector: string
  description: string
  checks: {
    property: string
    // Check passes if computed value does NOT match any of these
    notValues?: string[]
    // Check passes if computed value DOES match any of these (regex supported)
    matchesPattern?: string
  }[]
}

/**
 * Default component style checks for shared UI components
 * Note: Button styles use combined selectors (.btn.btn-primary) because
 * Tailwind v4 @utility creates separate classes - .btn has padding,
 * .btn-primary has only color/background.
 * Excludes FAB buttons (:not(.btn-fab)) which intentionally have 0 padding.
 */
export const DEFAULT_COMPONENT_CHECKS: ComponentStyleCheck[] = [
  {
    selector: '.btn.btn-primary:not(.btn-fab):not(.btn-icon)',
    description: 'Primary button',
    checks: [
      { property: 'backgroundColor', notValues: ['rgba(0, 0, 0, 0)', 'transparent', ''] },
      { property: 'padding', notValues: ['0px', ''] },
    ]
  },
  {
    selector: '.btn.btn-secondary:not(.btn-fab):not(.btn-icon)',
    description: 'Secondary button',
    checks: [
      { property: 'padding', notValues: ['0px', ''] },
    ]
  },
  {
    selector: '.btn.btn-danger:not(.btn-fab):not(.btn-icon)',
    description: 'Danger button',
    checks: [
      { property: 'backgroundColor', notValues: ['rgba(0, 0, 0, 0)', 'transparent', ''] },
    ]
  },
  {
    selector: '.input',
    description: 'Input field',
    checks: [
      { property: 'padding', notValues: ['0px', ''] },
      { property: 'borderWidth', notValues: ['0px'] },
    ]
  },
  {
    // Check modal overlay - the outer container that covers the screen
    selector: '.modal-overlay',
    description: 'Modal overlay',
    checks: [
      { property: 'position', matchesPattern: '^(fixed|absolute)$' },
    ]
  },
]

/**
 * Check that UI components have proper computed styles
 */
export async function checkComponentStyles(
  page: Page,
  checks: ComponentStyleCheck[] = DEFAULT_COMPONENT_CHECKS
): Promise<CSSHealthCheckResult> {
  const issues: string[] = []

  for (const check of checks) {
    const exists = await page.locator(check.selector).first().isVisible().catch(() => false)

    if (!exists) {
      // Component not present on page - skip (not an error)
      continue
    }

    const styles = await page.evaluate((selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const computed = getComputedStyle(el)
      return {
        backgroundColor: computed.backgroundColor,
        padding: computed.padding,
        borderWidth: computed.borderWidth,
        position: computed.position,
        color: computed.color,
        fontFamily: computed.fontFamily,
      }
    }, check.selector)

    if (!styles) continue

    for (const styleCheck of check.checks) {
      const value = styles[styleCheck.property as keyof typeof styles]

      if (styleCheck.notValues && styleCheck.notValues.includes(value)) {
        issues.push(
          `${check.description} (${check.selector}): ${styleCheck.property} has unstyled value "${value}"`
        )
      }

      if (styleCheck.matchesPattern && !new RegExp(styleCheck.matchesPattern).test(value)) {
        issues.push(
          `${check.description} (${check.selector}): ${styleCheck.property} "${value}" doesn't match expected pattern`
        )
      }
    }
  }

  return { passed: issues.length === 0, issues }
}

/**
 * Assert component styles are properly applied
 */
export async function assertComponentStyles(
  page: Page,
  checks?: ComponentStyleCheck[]
): Promise<void> {
  const result = await checkComponentStyles(page, checks)

  if (!result.passed) {
    throw new Error(`Component style check failed:\n${result.issues.join('\n')}`)
  }
}
