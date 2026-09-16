#!/usr/bin/env node
/**
 * Third-Party License Generator
 *
 * Generates THIRD_PARTY_NOTICES.md from license-checker-rseidelsohn output.
 *
 * Usage:
 *   node generate-thirdparty.js --skip-package example-app
 *   node generate-thirdparty.js --skip-package phrasevault --manual-dir assets/licenses
 *
 * Requires:
 *   First run: npx license-checker-rseidelsohn --json --production > licenses.json
 */

import fs from 'fs'
import path from 'path'

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    skipPackage: null,
    input: 'licenses.json',
    output: 'THIRD_PARTY_NOTICES.md',
    manualLicensesDir: path.join(process.cwd(), 'assets', 'licenses'),
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--skip-package' || arg === '-s') {
      options.skipPackage = args[++i]
    } else if (arg === '--input' || arg === '-i') {
      options.input = args[++i]
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i]
    } else if (arg === '--manual-dir' || arg === '-m') {
      options.manualLicensesDir = path.resolve(process.cwd(), args[++i])
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp() {
  console.log(`
Third-Party License Generator
==============================

Generates THIRD_PARTY_NOTICES.md from license-checker-rseidelsohn output.

Prerequisites:
  npx license-checker-rseidelsohn --json --production > licenses.json

Usage:
  node generate-thirdparty.js [options]

Options:
  -s, --skip-package <name>   Skip packages starting with this name (e.g., example-app)
  -i, --input <file>          Input licenses.json file (default: licenses.json)
  -o, --output <file>         Output file (default: THIRD_PARTY_NOTICES.md)
  -m, --manual-dir <dir>      Directory with manual license .md files (default: assets/licenses)
  -h, --help                  Show this help

Examples:
  # ExampleApp
  node generate-thirdparty.js --skip-package example-app

  # PhraseVault with custom output
  node generate-thirdparty.js --skip-package phrasevault -o docs/licenses.md

  # ExampleApp
  node generate-thirdparty.js --skip-package example-app
`)
}

/**
 * Clean up README noise from license text
 */
function cleanLicenseText(text) {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, '')                    // inline images ![alt](url)
    .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '')         // badge links [![alt](url)](link)
    .replace(/^\[[\w-]+\]:\s*https?:\/\/[^\s]*\.(svg|png|jpg|jpeg|gif|webp|ico)[^\s]*$/gim, '') // reference-style image definitions
    .replace(/^\[[\w-]+\]:\s*https?:\/\/(img\.shields\.io|badges\.|badge\.)[^\s]*$/gim, '')    // badge service URLs
    .replace(/```[\s\S]*?```/g, '')                     // code blocks
    .replace(/<img[^>]*>/gi, '')                        // img tags
    .replace(/^#{1,3}\s*(install|installation|usage|example|api|getting started|contributing|changelog|documentation|features|todo|test).*$/gim, '')
    .replace(/^\s*[-*]\s+\[.*?\]\(#.*?\)\s*$/gm, '')    // TOC links
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const inputPath = path.resolve(process.cwd(), options.input)
  const outputPath = path.resolve(process.cwd(), options.output)

  // Read licenses.json
  let licenses
  try {
    const content = fs.readFileSync(inputPath, 'utf8')
    licenses = JSON.parse(content)
  } catch (err) {
    console.error(`Error reading ${options.input}: ${err.message}`)
    console.log('\nMake sure to run first:')
    console.log('  npx license-checker-rseidelsohn --json --production > licenses.json')
    process.exit(1)
  }

  let output = '# Third Party Licenses\n\n'
  let packageCount = 0

  for (const [pkg, info] of Object.entries(licenses)) {
    // Skip own package
    if (options.skipPackage && pkg.startsWith(`${options.skipPackage}@`)) {
      continue
    }

    packageCount++
    output += `## ${pkg}\n\n`
    output += `- **License:** ${info.licenses || 'Unknown'}\n`
    if (info.repository) output += `- **Repository:** ${info.repository}\n`
    if (info.publisher) output += `- **Publisher:** ${info.publisher}\n`
    output += '\n'

    // Include actual license text if available
    if (info.licenseFile && fs.existsSync(info.licenseFile)) {
      const text = cleanLicenseText(fs.readFileSync(info.licenseFile, 'utf8'))
      output += `### License Text\n${text}\n`
    }

    output += '---\n\n'
  }

  // Append manual licenses from assets/licenses/
  let manualCount = 0
  if (fs.existsSync(options.manualLicensesDir)) {
    const manualFiles = fs.readdirSync(options.manualLicensesDir).filter(f => f.endsWith('.md'))
    for (const file of manualFiles) {
      const filePath = path.join(options.manualLicensesDir, file)
      const content = fs.readFileSync(filePath, 'utf8').trim()
      const name = path.basename(file, '.md')
      output += `## ${name}\n\n${content}\n\n---\n\n`
      manualCount++
    }
  }

  fs.writeFileSync(outputPath, output)
  console.log(`Generated ${options.output}`)
  console.log(`  - ${packageCount} npm packages`)
  if (manualCount > 0) {
    console.log(`  - ${manualCount} manual license(s) from ${path.relative(process.cwd(), options.manualLicensesDir)}`)
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
