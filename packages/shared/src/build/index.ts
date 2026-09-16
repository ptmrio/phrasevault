/**
 * Build utilities
 * Tools for code generation and build processes
 */

export {
  generateColorPalette,
  generateCSSVariables,
  generateAllColors,
  generateDarkModeColors,
  generateHarmony,
  interpolateColors,
  DEFAULT_COLORS,
  type ColorConfig,
  type PaletteOptions,
} from './generate-colors.js'

export {
  createForgeConfig,
  extendForgeConfig,
  DEFAULT_IGNORE_PATTERNS,
  type AppForgeConfig,
} from './forge-config.js'
