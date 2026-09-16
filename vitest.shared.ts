import { defineConfig } from 'vitest/config'

export const sharedTestConfig = defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    testTimeout: 10000
  }
})
