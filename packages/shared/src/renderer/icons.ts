/**
 * Shared Icon Utilities
 *
 * Provides consistent SVG icon creation across all apps using Tabler Icons.
 * All icons use 24x24 viewBox with stroke-based rendering.
 *
 * @example
 * ```typescript
 * import { createIcon, renderIcon } from '@spqrkapps/shared/renderer'
 *
 * // Create SVG element
 * const icon = createIcon('settings', { size: 'md' })
 * button.appendChild(icon)
 *
 * // Or render as HTML string
 * element.innerHTML = renderIcon('trash', { size: 'sm', class: 'text-red-500' })
 * ```
 */

import { ICON_PATHS, type IconName } from './icon-paths'

export type { IconName } from './icon-paths'
export { ICON_PATHS } from './icon-paths'

/**
 * Icon size presets using Tailwind classes
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const SIZE_CLASSES: Record<IconSize, string> = {
  xs: 'w-3 h-3',     // 12px
  sm: 'w-4 h-4',     // 16px
  md: 'w-5 h-5',     // 20px (default)
  lg: 'w-6 h-6',     // 24px
  xl: 'w-8 h-8',     // 32px
  '2xl': 'w-12 h-12', // 48px
  '3xl': 'w-16 h-16', // 64px
}

/**
 * Options for icon creation
 */
export interface IconOptions {
  /** Size preset (default: 'md') */
  size?: IconSize
  /** Additional CSS classes */
  class?: string
  /** Stroke width (default: 2) */
  strokeWidth?: number
  /** Accessible label for interactive icons */
  ariaLabel?: string
}

/**
 * Create an SVG icon element
 *
 * @param name - Icon name from ICON_PATHS
 * @param options - Customization options
 * @returns SVG element ready to append to DOM
 *
 * @example
 * ```typescript
 * const icon = createIcon('settings')
 * button.appendChild(icon)
 *
 * const largeIcon = createIcon('home', { size: 'lg', class: 'text-primary-500' })
 * ```
 */
export function createIcon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const {
    size = 'md',
    class: className = '',
    strokeWidth = 2,
    ariaLabel,
  } = options

  const path = ICON_PATHS[name]
  if (!path) {
    console.warn(`[Icons] Unknown icon: ${name}`)
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', `${SIZE_CLASSES[size]} ${className}`.trim())
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', String(strokeWidth))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  if (ariaLabel) {
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', ariaLabel)
  } else {
    svg.setAttribute('aria-hidden', 'true')
  }

  svg.innerHTML = path || ''
  return svg
}

/**
 * Render an icon as an HTML string
 *
 * Useful for innerHTML assignments or template literals.
 *
 * @param name - Icon name from ICON_PATHS
 * @param options - Customization options
 * @returns SVG markup as string
 *
 * @example
 * ```typescript
 * button.innerHTML = `${renderIcon('plus')} Add Item`
 *
 * const template = `
 *   <div class="alert">
 *     ${renderIcon('alert-circle', { size: 'sm' })}
 *     <span>Warning message</span>
 *   </div>
 * `
 * ```
 */
export function renderIcon(name: IconName, options: IconOptions = {}): string {
  const {
    size = 'md',
    class: className = '',
    strokeWidth = 2,
    ariaLabel,
  } = options

  const path = ICON_PATHS[name]
  if (!path) {
    console.warn(`[Icons] Unknown icon: ${name}`)
    return ''
  }

  const classes = `${SIZE_CLASSES[size]} ${className}`.trim()
  const ariaAttrs = ariaLabel
    ? `role="img" aria-label="${escapeAttr(ariaLabel)}"`
    : 'aria-hidden="true"'

  return `<svg class="${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${ariaAttrs}>${path}</svg>`
}

/**
 * Check if an icon name exists
 */
export function hasIcon(name: string): name is IconName {
  return name in ICON_PATHS
}

/**
 * Get all available icon names
 */
export function getIconNames(): IconName[] {
  return Object.keys(ICON_PATHS) as IconName[]
}

/**
 * Escape HTML attribute value
 */
function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
