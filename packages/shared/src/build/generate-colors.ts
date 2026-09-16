/**
 * Color palette generator
 * Generates consistent color scales from base colors using culori
 *
 * Usage:
 *   npx tsx generate-colors.ts > ../css/colors.css
 *
 * Or programmatically:
 *   import { generateColorPalette, generateCSSVariables } from '@spqrkapps/shared/build'
 */

import {
  parse,
  formatHex,
  oklch,
  type Oklch,
  clampChroma,
  interpolate,
  samples,
} from 'culori'

export interface ColorConfig {
  /** Base color in any CSS format (hex, rgb, hsl, oklch) */
  base: string
  /** Name for the color (e.g., 'primary', 'danger') */
  name: string
}

export interface PaletteOptions {
  /** Shade levels to generate (default: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) */
  shades?: number[]
  /** Lightness values for each shade (0-1, light to dark) */
  lightnessMap?: Record<number, number>
  /** Whether to preserve chroma as much as possible */
  preserveChroma?: boolean
}

const DEFAULT_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

// Default lightness values in OKLCH (perceptually uniform)
const DEFAULT_LIGHTNESS_MAP: Record<number, number> = {
  50: 0.97,
  100: 0.93,
  200: 0.87,
  300: 0.78,
  400: 0.68,
  500: 0.55,
  600: 0.48,
  700: 0.40,
  800: 0.32,
  900: 0.24,
  950: 0.14,
}

/**
 * Convert any color to OKLCH
 */
function toOklch(color: string): Oklch | undefined {
  const parsed = parse(color)
  if (!parsed) return undefined
  return oklch(parsed)
}

/**
 * Generate a single shade from a base color
 */
function generateShade(
  baseOklch: Oklch,
  targetLightness: number,
  preserveChroma: boolean
): string {
  const shade: Oklch = {
    mode: 'oklch',
    l: targetLightness,
    c: baseOklch.c ?? 0,
    h: baseOklch.h,
  }

  // Adjust chroma based on lightness to prevent oversaturation at extremes
  if (!preserveChroma) {
    // Reduce chroma at very light and very dark ends
    const lightnessDistance = Math.abs(targetLightness - 0.5)
    const chromaScale = 1 - (lightnessDistance * 0.3)
    shade.c = (baseOklch.c ?? 0) * chromaScale
  }

  // Clamp to sRGB gamut
  const clamped = clampChroma(shade, 'oklch')
  return formatHex(clamped) ?? '#000000'
}

/**
 * Generate a full color palette from a base color
 */
export function generateColorPalette(
  config: ColorConfig,
  options: PaletteOptions = {}
): Map<number, string> {
  const {
    shades = DEFAULT_SHADES,
    lightnessMap = DEFAULT_LIGHTNESS_MAP,
    preserveChroma = false,
  } = options

  const baseOklch = toOklch(config.base)
  if (!baseOklch) {
    throw new Error(`Invalid color: ${config.base}`)
  }

  const palette = new Map<number, string>()

  for (const shade of shades) {
    const lightness = lightnessMap[shade]
    if (lightness === undefined) {
      throw new Error(`No lightness defined for shade ${shade}`)
    }
    palette.set(shade, generateShade(baseOklch, lightness, preserveChroma))
  }

  return palette
}

/**
 * Generate CSS custom properties for a color palette
 */
export function generateCSSVariables(
  config: ColorConfig,
  options: PaletteOptions = {}
): string {
  const palette = generateColorPalette(config, options)
  const lines: string[] = []

  for (const [shade, hex] of palette) {
    lines.push(`  --color-${config.name}-${shade}: ${hex};`)
  }

  return lines.join('\n')
}

/**
 * Generate CSS for multiple color palettes
 */
export function generateAllColors(
  colors: ColorConfig[],
  options: PaletteOptions = {}
): string {
  const sections: string[] = [
    '/**',
    ' * Generated color palette',
    ' * Do not edit directly - regenerate with generate-colors.ts',
    ' */',
    '',
    ':root {',
  ]

  for (const color of colors) {
    sections.push(`  /* ${color.name} */`)
    sections.push(generateCSSVariables(color, options))
    sections.push('')
  }

  // Remove trailing empty line and close
  sections.pop()
  sections.push('}')

  return sections.join('\n')
}

/**
 * Generate dark mode color variations
 * Slightly adjusts colors for better contrast in dark mode
 */
export function generateDarkModeColors(
  colors: ColorConfig[],
  options: PaletteOptions = {}
): string {
  const darkLightnessMap: Record<number, number> = {
    50: 0.12,
    100: 0.18,
    200: 0.24,
    300: 0.32,
    400: 0.42,
    500: 0.52,
    600: 0.62,
    700: 0.72,
    800: 0.82,
    900: 0.90,
    950: 0.95,
  }

  const darkOptions = { ...options, lightnessMap: darkLightnessMap }

  const sections: string[] = [
    '',
    '[data-theme="dark"] {',
  ]

  for (const color of colors) {
    sections.push(`  /* ${color.name} */`)
    sections.push(generateCSSVariables(color, darkOptions))
    sections.push('')
  }

  sections.pop()
  sections.push('}')

  return sections.join('\n')
}

/**
 * Generate complementary/analogous colors from a base
 */
export function generateHarmony(
  baseColor: string,
  type: 'complementary' | 'analogous' | 'triadic' | 'split-complementary'
): string[] {
  const base = toOklch(baseColor)
  if (!base || base.h === undefined) {
    throw new Error(`Invalid color for harmony: ${baseColor}`)
  }

  const hue = base.h
  let hues: number[]

  switch (type) {
    case 'complementary':
      hues = [hue, (hue + 180) % 360]
      break
    case 'analogous':
      hues = [(hue - 30 + 360) % 360, hue, (hue + 30) % 360]
      break
    case 'triadic':
      hues = [hue, (hue + 120) % 360, (hue + 240) % 360]
      break
    case 'split-complementary':
      hues = [hue, (hue + 150) % 360, (hue + 210) % 360]
      break
  }

  return hues.map((h) => {
    const color: Oklch = { mode: 'oklch', l: base.l, c: base.c, h }
    return formatHex(clampChroma(color, 'oklch')) ?? '#000000'
  })
}

/**
 * Interpolate between two colors
 */
export function interpolateColors(
  color1: string,
  color2: string,
  steps: number
): string[] {
  const c1 = parse(color1)
  const c2 = parse(color2)

  if (!c1 || !c2) {
    throw new Error('Invalid colors for interpolation')
  }

  const interpolator = interpolate([c1, c2], 'oklch')
  return samples(steps).map((t: number) => formatHex(interpolator(t)) ?? '#000000')
}

// Default SpqrkApps color configuration
export const DEFAULT_COLORS: ColorConfig[] = [
  { name: 'primary', base: '#3b82f6' },   // Blue
  { name: 'secondary', base: '#6b7280' }, // Gray
  { name: 'success', base: '#22c55e' },   // Green
  { name: 'warning', base: '#f59e0b' },   // Amber
  { name: 'danger', base: '#ef4444' },    // Red
  { name: 'info', base: '#06b6d4' },      // Cyan
]

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const css = generateAllColors(DEFAULT_COLORS)
  const darkCss = generateDarkModeColors(DEFAULT_COLORS)
  console.log(css)
  console.log(darkCss)
}
