/**
 * Electron Forge base configuration
 * Apps extend this with their specific settings
 */

import type { ForgeConfig } from '@electron-forge/shared-types'
import type { MakerSquirrelConfig } from '@electron-forge/maker-squirrel'
import type { MakerDMGConfig } from '@electron-forge/maker-dmg'
import type { MakerZIPConfig } from '@electron-forge/maker-zip'

export interface AppForgeConfig {
  /** App display name */
  name: string
  /** App identifier (e.g., com.spqrkapps.example-app) */
  appId: string
  /** Publisher name for code signing */
  publisher?: string
  /** App icon path (without extension) */
  icon?: string
  /** Windows-specific squirrel config overrides */
  squirrel?: Partial<MakerSquirrelConfig>
  /** macOS DMG config overrides */
  dmg?: Partial<MakerDMGConfig>
  /** Additional files to package */
  extraResources?: string[]
  /** Ignore patterns for packaging */
  ignore?: (string | RegExp)[]
}

/**
 * Default ignore patterns for Electron packaging
 */
export const DEFAULT_IGNORE_PATTERNS: (string | RegExp)[] = [
  // Source files
  /^\/src\//,
  /\.ts$/,
  /\.tsx$/,
  /tsconfig.*\.json$/,

  // Development files
  /^\/\.git/,
  /^\/\.vscode/,
  /^\/\.idea/,
  /^\/node_modules\/\.cache/,

  // Test files
  /\.test\./,
  /\.spec\./,
  /^\/tests?\//,
  /^\/coverage\//,
  /__tests__/,

  // Build artifacts
  /^\/out\//,
  /^\/dist\//,
  /^\/Releases\//,

  // Config files
  /^\/\.env/,
  /^\/\.eslintrc/,
  /^\/\.prettierrc/,
  /^\/vitest\.config/,
  /^\/tailwind\.config/,

  // Documentation
  /^\/docs\//,
  /^\/README\.md$/,
  /^\/CHANGELOG\.md$/,
  /^\/LICENSE$/,

  // Temporary files
  /\.log$/,
  /\.tmp$/,
  /\.temp$/,
]

/**
 * Create base Forge configuration
 * Apps should extend this with their specific settings
 */
export function createForgeConfig(app: AppForgeConfig): ForgeConfig {
  const ignorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(app.ignore ?? []),
  ]

  return {
    packagerConfig: {
      name: app.name,
      executableName: app.name.toLowerCase().replace(/\s+/g, '-'),
      appBundleId: app.appId,
      icon: app.icon,
      asar: true,
      ignore: (path: string) => {
        if (!path) return false
        return ignorePatterns.some((pattern) =>
          typeof pattern === 'string'
            ? path.includes(pattern)
            : pattern.test(path)
        )
      },
      extraResource: app.extraResources,
      // Windows code signing (env vars)
      ...(process.platform === 'win32' && process.env.WINDOWS_CERTIFICATE_FILE
        ? {
            windowsSign: {
              certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
              certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
            },
          }
        : {}),
      // macOS code signing (env vars)
      ...(process.platform === 'darwin' && process.env.APPLE_IDENTITY
        ? {
            osxSign: {
              identity: process.env.APPLE_IDENTITY,
            },
            osxNotarize:
              process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD && process.env.APPLE_TEAM_ID
                ? {
                    appleId: process.env.APPLE_ID,
                    appleIdPassword: process.env.APPLE_ID_PASSWORD,
                    teamId: process.env.APPLE_TEAM_ID,
                  }
                : undefined,
          }
        : {}),
    },

    rebuildConfig: {},

    makers: [
      // Windows installer (Squirrel)
      {
        name: '@electron-forge/maker-squirrel',
        config: {
          name: app.name.replace(/\s+/g, ''),
          authors: app.publisher,
          setupIcon: app.icon ? `${app.icon}.ico` : undefined,
          iconUrl: app.icon
            ? `file://${process.cwd()}/${app.icon}.ico`
            : undefined,
          // Auto-update URL (if configured)
          ...(process.env.UPDATE_URL
            ? { remoteReleases: process.env.UPDATE_URL }
            : {}),
          ...app.squirrel,
        } satisfies MakerSquirrelConfig,
        platforms: ['win32'],
      },

      // macOS DMG
      {
        name: '@electron-forge/maker-dmg',
        config: {
          name: app.name,
          icon: app.icon ? `${app.icon}.icns` : undefined,
          format: 'ULFO',
          ...app.dmg,
        } satisfies MakerDMGConfig,
        platforms: ['darwin'],
      },

      // ZIP (cross-platform fallback)
      {
        name: '@electron-forge/maker-zip',
        config: {} satisfies MakerZIPConfig,
        platforms: ['darwin', 'linux'],
      },
    ],

    plugins: [
      // TypeScript compilation handled separately
    ],

    hooks: {
      // Pre-package hook for cleanup
      packageAfterCopy: async (_config, buildPath) => {
        // Remove any remaining TypeScript files
        const { rm } = await import('fs/promises')
        const { glob } = await import('glob')

        const tsFiles = await glob('**/*.ts', {
          cwd: buildPath,
          ignore: ['**/*.d.ts'],
        })

        for (const file of tsFiles) {
          await rm(`${buildPath}/${file}`, { force: true })
        }
      },
    },
  }
}

/**
 * Merge app-specific config with base
 */
export function extendForgeConfig(
  base: ForgeConfig,
  overrides: Partial<ForgeConfig>
): ForgeConfig {
  return {
    ...base,
    packagerConfig: {
      ...base.packagerConfig,
      ...overrides.packagerConfig,
    },
    rebuildConfig: {
      ...base.rebuildConfig,
      ...overrides.rebuildConfig,
    },
    makers: overrides.makers ?? base.makers,
    plugins: [...(base.plugins ?? []), ...(overrides.plugins ?? [])],
    hooks: {
      ...base.hooks,
      ...overrides.hooks,
    },
  }
}
