/**
 * Shared E2E testing utilities for Electron apps
 *
 * @example
 * ```typescript
 * import {
 *   createElectronTest,
 *   expect,
 *   expectNoConsoleErrors,
 *   waitForAppReady,
 *   CommonSelectors,
 * } from '@spqrkapps/shared/e2e'
 *
 * const test = createElectronTest({
 *   appDir: path.join(__dirname, '..'),
 *   appName: 'MyApp',
 * })
 *
 * test('app launches without errors', async ({ window, consoleErrors }) => {
 *   await waitForAppReady(window)
 *   expectNoConsoleErrors(consoleErrors)
 * })
 * ```
 */

export {
  createElectronTest,
  expect,
  electron,
  expectNoConsoleErrors,
  expectNoConsoleWarnings,
  type ElectronTestFixtures,
  type ElectronWorkerFixtures,
  type ConsoleError,
  type ElectronApplication,
  type Page,
  type ConsoleMessage,
} from './fixtures'

export {
  waitForElement,
  waitForAppReady,
  assertHelloWorld,
  getAppVersion,
  getAppName,
  getAppPath,
  isPackaged,
  getWindowBounds,
  isWindowMaximized,
  isWindowVisible,
  takeScreenshot,
  CommonSelectors,
} from './utils'

export {
  createPlaywrightConfig,
  defineConfig,
  type ElectronPlaywrightConfigOptions,
} from './playwright.base'

export {
  checkCSSVariables,
  checkStylesheetsLoaded,
  checkBodyNotDefaultStyles,
  runCSSHealthChecks,
  assertCSSHealth,
  checkComponentStyles,
  assertComponentStyles,
  DEFAULT_COMPONENT_CHECKS,
  type CSSHealthCheckResult,
  type ComponentStyleCheck,
} from './css-health'

export {
  waitForModalVisible,
  waitForModalHidden,
  openSettingsModal,
  closeModalViaButton,
  closeModalViaEscape,
  isAnyModalVisible,
  getVisibleModalCount,
  testModalOpenClose,
  waitForToast,
  waitForToastDismiss,
  getToastMessage,
  getToastType,
  checkToastContainer,
  getCurrentTheme,
  changeThemeSetting,
  saveSettings,
  type ModalTestResult,
} from './modal-helpers'

export {
  registerWindowControlsTests,
  type WindowControlsSpecOptions,
} from './window-controls-spec'
