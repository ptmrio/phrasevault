import { defineConfig, mergeConfig } from 'vitest/config'
import { sharedTestConfig } from '../../vitest.shared'

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/main/licensing/**/*.ts'],
      },
    },
  })
)
