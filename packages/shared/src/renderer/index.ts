/**
 * Renderer process utilities for Electron apps
 *
 * @example
 * ```typescript
 * import { showModal, showToast, t } from '@spqrkapps/shared/renderer'
 * ```
 */

// Modal
export {
  showModal,
  hideModal,
  hideAllModals,
  hideTopModal,
  hasOpenModals,
  getOpenModalCount,
  getOpenModals,
  isModalOpen,
  showConfirmModal,
  showAlertModal,
  showInputModal,
  showMarkdownModal,
  hideMarkdownModal,
  isMarkdownModalOpen,
  initModalCloseButtons,
  type MarkdownModalButton,
  type MarkdownModalOptions,
} from './modal'

// Toast
export {
  showToast,
  clearAllToasts,
  configureToasts,
  toast,
  type ToastType,
  type ToastPosition,
  type EntryDirection,
  type StackDirection,
  type ToastOptions,
  type ToastConfig,
  type ToastResult,
} from './toast'

// i18n
export {
  initI18n,
  t,
  changeLanguage,
  getLanguage,
  updateDOM,
  isI18nInitialized,
  getI18nInstance,
  type I18nOptions,
} from './i18n'

// Icons
export {
  createIcon,
  renderIcon,
  hasIcon,
  getIconNames,
  ICON_PATHS,
  type IconName,
  type IconSize,
  type IconOptions,
} from './icons'

// Window controls
export {
  initWindowControls,
  DEFAULT_WINDOW_CONTROL_LABELS,
  type WindowControlsBridge,
  type WindowControlsOptions,
  type WindowControlsHandle,
} from './window-controls'
