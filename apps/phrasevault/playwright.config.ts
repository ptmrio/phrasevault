import { createPlaywrightConfig } from '@spqrkapps/shared/e2e'

export default createPlaywrightConfig({
  testDir: './e2e',
  timeout: 60000,
  outputDir: './e2e-results',
})
