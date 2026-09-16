#!/usr/bin/env node
/**
 * Shared App Icon Generator
 *
 * Generates consistent app icons across all SpqrkApps Electron apps.
 * Ensures visual consistency with standardized sizing, padding, and corner radius.
 *
 * Usage:
 *   node packages/shared/bin/generate-app-icons.cjs --config icons.config.json
 *
 * Or import and call directly:
 *   const { generateIcons } = require('@spqrkapps/shared/bin/generate-app-icons.cjs')
 *   generateIcons({ appName: 'MyApp', ... })
 *
 * ============================================================================
 * ICON CONFIG (icons.config.json)
 * ============================================================================
 *
 * Required fields:
 *   - appName: string - App name for logging
 *   - outputDir: string - Output directory (relative to config file)
 *   - colors: { start: string, end: string } - Gradient colors (hex)
 *
 * Icon content (one of these is required):
 *   - iconPath: string - Single SVG path data (d attribute) for simple icons
 *   - iconContent: string - Raw SVG content for complex multi-element designs
 *                           (multiple paths, groups, transforms, etc.)
 *
 * Optional fields:
 *   - iconCenter: { x: number, y: number } - Visual center of icon in 24x24 viewBox
 *                 Default: { x: 12, y: 12 }
 *                 TIP: Calculate from icon bounds: x = (minX + maxX) / 2
 *   - strokeWidth: number - For outline/stroke style icons (only with iconPath)
 *   - generateTray: boolean - Generate tray icons (default: true)
 *
 * ============================================================================
 * SIZING STRATEGY (DO NOT CHANGE)
 * ============================================================================
 *
 * All apps use these standard parameters for visual consistency:
 *   - Canvas: 1024x1024 with 200px corner radius
 *   - Icon scale: 28x (24x24 icon becomes 672x672)
 *   - Tray: 256x256 with 50px corner radius, 7x scale
 *
 * The icon is centered using: translate((512 - iconCenter.x * 28), (512 - iconCenter.y * 28))
 *
 * ============================================================================
 * EXAMPLES
 * ============================================================================
 *
 * Simple single-path icon (stroke style):
 * {
 *   "appName": "ExampleApp",
 *   "outputDir": "./assets/img",
 *   "colors": { "start": "#2563eb", "end": "#1e40af" },
 *   "iconPath": "M12 1L3 5v6c0 5.55...",
 *   "iconCenter": { "x": 12, "y": 12 },
 *   "strokeWidth": 2
 * }
 *
 * Complex multi-element icon:
 * {
 *   "appName": "PhraseVault",
 *   "outputDir": "./assets/img",
 *   "colors": { "start": "#E85D04", "end": "#9D4A04" },
 *   "iconContent": "<g fill=\"none\" stroke=\"white\"...><path.../><path.../></g>",
 *   "iconCenter": { "x": 12, "y": 12.5 }
 * }
 *
 * ============================================================================
 * TITLEBAR ICON
 * ============================================================================
 *
 * After generating icons, update the app's titlebar SVG in templates/index.html
 * to match. Use the same paths/structure but with:
 *   - class="w-4 h-4 text-primary-500 flex-shrink-0"
 *   - viewBox="0 0 24 24"
 *   - stroke="currentColor" (for outline style) or fill="currentColor" (for filled)
 */

const fs = require('fs')
const path = require('path')

// Check for sharp
let sharp
try {
  sharp = require('sharp')
} catch (e) {
  console.error('Missing dependency: sharp')
  console.error('Run: pnpm add -D sharp')
  process.exit(1)
}

// Check for png2icons (creates proper multi-size ICO and ICNS)
let png2icons
try {
  png2icons = require('png2icons')
} catch (e) {
  console.error('Missing dependency: png2icons')
  console.error('Run: pnpm add -D png2icons')
  process.exit(1)
}

// Standard sizes for all apps (includes Windows DPI scaling sizes)
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]

// png2icons automatically generates: 16, 24, 32, 48, 64, 72, 96, 128, 256 for ICO

// Standard visual parameters
const CANVAS_SIZE = 1024
const CORNER_RADIUS = 200
const ICON_SCALE = 28
const TRAY_CANVAS_SIZE = 256
const TRAY_CORNER_RADIUS = 50
const TRAY_SCALE = 7

/**
 * Generate path attributes based on fill vs stroke mode
 */
function getPathAttrs(strokeWidth) {
  if (strokeWidth) {
    return `fill="none" stroke="white" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`
  }
  return `fill-rule="evenodd" fill="white"`
}

/**
 * Generate the main app icon SVG
 * Supports either iconPath (single path) or iconContent (raw SVG content for multi-element designs)
 */
function generateIconSvg(config) {
  const { colors, iconPath, iconContent, iconCenter = { x: 12, y: 12 }, strokeWidth } = config

  // Calculate translation to center the icon
  const translateX = (CANVAS_SIZE / 2) - (iconCenter.x * ICON_SCALE)
  const translateY = (CANVAS_SIZE / 2) - (iconCenter.y * ICON_SCALE)

  // Build icon content - either raw content or single path
  let iconElement
  if (iconContent) {
    // Raw SVG content for complex multi-element designs
    iconElement = iconContent
  } else {
    const pathAttrs = getPathAttrs(strokeWidth)
    iconElement = `<path d="${iconPath}" ${pathAttrs}/>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.start}"/>
      <stop offset="100%" style="stop-color:${colors.end}"/>
    </linearGradient>
  </defs>

  <!-- Background with rounded corners and gradient -->
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" rx="${CORNER_RADIUS}" fill="url(#bgGradient)"/>

  <!-- App icon - centered -->
  <g transform="translate(${translateX}, ${translateY}) scale(${ICON_SCALE})">
    ${iconElement}
  </g>
</svg>`
}

/**
 * Generate the tray icon SVG (colorful version with gradient background)
 * Supports either iconPath (single path) or iconContent (raw SVG content for multi-element designs)
 */
function generateTraySvg(config) {
  const { colors, iconPath, iconContent, iconCenter = { x: 12, y: 12 }, strokeWidth } = config

  // Calculate translation for tray size
  const translateX = (TRAY_CANVAS_SIZE / 2) - (iconCenter.x * TRAY_SCALE)
  const translateY = (TRAY_CANVAS_SIZE / 2) - (iconCenter.y * TRAY_SCALE)

  // Build icon content - either raw content or single path
  let iconElement
  if (iconContent) {
    // Raw SVG content for complex multi-element designs
    iconElement = iconContent
  } else {
    // Scale stroke width for tray (tray scale is 1/4 of icon scale)
    const trayStrokeWidth = strokeWidth ? strokeWidth * (TRAY_SCALE / ICON_SCALE) : null
    const pathAttrs = getPathAttrs(trayStrokeWidth)
    iconElement = `<path d="${iconPath}" ${pathAttrs}/>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TRAY_CANVAS_SIZE}" height="${TRAY_CANVAS_SIZE}" viewBox="0 0 ${TRAY_CANVAS_SIZE} ${TRAY_CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="trayBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.start}"/>
      <stop offset="100%" style="stop-color:${colors.end}"/>
    </linearGradient>
  </defs>

  <!-- Background with rounded corners -->
  <rect width="${TRAY_CANVAS_SIZE}" height="${TRAY_CANVAS_SIZE}" rx="${TRAY_CORNER_RADIUS}" fill="url(#trayBgGradient)"/>

  <!-- App icon - centered -->
  <g transform="translate(${translateX}, ${translateY}) scale(${TRAY_SCALE})">
    ${iconElement}
  </g>
</svg>`
}

/**
 * Generate all icons for an app
 */
async function generateIcons(config) {
  const { appName, outputDir, colors, iconPath, iconContent, iconCenter, strokeWidth, generateTray = true } = config

  console.log(`Generating ${appName} app icons...\n`)
  if (iconContent) {
    console.log(`Using custom iconContent (multi-element SVG)\n`)
  } else if (strokeWidth) {
    console.log(`Using outline/stroke style (strokeWidth: ${strokeWidth})\n`)
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const iconSvg = generateIconSvg({ colors, iconPath, iconContent, iconCenter, strokeWidth })
  const traySvg = generateTray ? generateTraySvg({ colors, iconPath, iconContent, iconCenter, strokeWidth }) : null

  // Save source SVGs
  const svgPath = path.join(outputDir, 'icon-source.svg')
  fs.writeFileSync(svgPath, iconSvg)
  console.log('Created: icon-source.svg')

  if (traySvg) {
    const traySvgPath = path.join(outputDir, 'tray-source.svg')
    fs.writeFileSync(traySvgPath, traySvg)
    console.log('Created: tray-source.svg')
  }

  // Generate PNG icons at various sizes
  console.log('\nGenerating PNG icons...')
  for (const size of SIZES) {
    const filename = size === 1024 ? 'icon.png' : `icon_${size}x${size}.png`
    const outputPath = path.join(outputDir, filename)

    await sharp(Buffer.from(iconSvg))
      .resize(size, size)
      .png()
      .toFile(outputPath)

    console.log(`  ✓ ${filename}`)
  }

  // Generate tray icons
  if (traySvg) {
    console.log('\nGenerating tray icons...')

    // Standard tray (16x16)
    await sharp(Buffer.from(traySvg))
      .resize(16, 16)
      .png()
      .toFile(path.join(outputDir, 'tray-icon.png'))
    console.log('  ✓ tray-icon.png (16x16)')

    // @2x tray (32x32)
    await sharp(Buffer.from(traySvg))
      .resize(32, 32)
      .png()
      .toFile(path.join(outputDir, 'tray-icon@2x.png'))
    console.log('  ✓ tray-icon@2x.png (32x32)')
  }

  // Generate Windows .ico and macOS .icns using png2icons (cross-platform)
  // png2icons creates ICO with sizes: 16, 24, 32, 48, 64, 72, 96, 128, 256
  // png2icons creates ICNS with sizes: 16, 32, 64, 128, 256, 512, 1024 (including @2x)
  const iconPngPath = path.join(outputDir, 'icon.png')
  const iconPngBuffer = fs.readFileSync(iconPngPath)

  console.log('\nGenerating Windows .ico (16, 24, 32, 48, 64, 72, 96, 128, 256px)...')
  try {
    const icoBuffer = png2icons.createICO(iconPngBuffer, png2icons.BICUBIC, 0, true, true)
    if (icoBuffer) {
      fs.writeFileSync(path.join(outputDir, 'icon.ico'), icoBuffer)
      console.log('  ✓ icon.ico')
    } else {
      console.log('  ⚠ Failed to create icon.ico')
    }
  } catch (e) {
    console.log('  ⚠ Could not generate .ico:', e.message)
  }

  // Generate tray.ico from tray PNG
  if (traySvg) {
    console.log('\nGenerating tray.ico...')
    try {
      const trayPngPath = path.join(outputDir, 'tray-icon@2x.png')
      const trayPngBuffer = fs.readFileSync(trayPngPath)
      const trayIcoBuffer = png2icons.createICO(trayPngBuffer, png2icons.BICUBIC, 0, true, true)
      if (trayIcoBuffer) {
        fs.writeFileSync(path.join(outputDir, 'tray.ico'), trayIcoBuffer)
        console.log('  ✓ tray.ico')
      } else {
        console.log('  ⚠ Failed to create tray.ico')
      }
    } catch (e) {
      console.error('  ⚠ Failed to create tray.ico:', e.message)
    }
  }

  // Generate macOS .icns (works on all platforms with png2icons)
  console.log('\nGenerating macOS .icns...')
  try {
    const icnsBuffer = png2icons.createICNS(iconPngBuffer, png2icons.BICUBIC, 0)
    if (icnsBuffer) {
      fs.writeFileSync(path.join(outputDir, 'icon.icns'), icnsBuffer)
      console.log('  ✓ icon.icns')
    } else {
      console.log('  ⚠ Failed to create icon.icns')
    }
  } catch (e) {
    console.log('  ⚠ Could not generate .icns:', e.message)
  }

  console.log(`\n✅ Icon generation complete!`)
  console.log(`   Output directory: ${outputDir}`)
}

// CLI support
if (require.main === module) {
  const args = process.argv.slice(2)
  const configIndex = args.indexOf('--config')

  if (configIndex === -1 || !args[configIndex + 1]) {
    console.error('Usage: generate-app-icons.cjs --config <config.json>')
    process.exit(1)
  }

  const configPath = path.resolve(args[configIndex + 1])
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  // Resolve outputDir relative to config file
  if (config.outputDir && !path.isAbsolute(config.outputDir)) {
    config.outputDir = path.resolve(path.dirname(configPath), config.outputDir)
  }

  generateIcons(config).catch(console.error)
}

module.exports = { generateIcons, generateIconSvg, generateTraySvg }
