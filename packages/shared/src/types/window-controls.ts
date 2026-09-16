/**
 * In-page window control types
 *
 * One definition consumed by main (the state publisher), the preload types,
 * and the renderer component. Main is the sole source of window state.
 */

/** The action a caption button performs when activated. */
export type WindowControlAction = 'minimize' | 'maximize' | 'close' | 'fullscreen' | 'zoom'

/** A full window-state snapshot published by main with a monotonic revision. */
export interface WindowControlsState {
  revision: number
  platform: 'win32' | 'darwin' | 'linux'
  focused: boolean
  maximized: boolean
  fullscreen: boolean
  transitioning: boolean
  canMinimize: boolean
  canMaximize: boolean
  canZoom: boolean
  canFullscreen: boolean
  canClose: boolean
}

/**
 * Renderer snapshot gate. A `window:get-state` reply must lose to a later
 * `window:state-changed` event: equal or older revisions are discarded.
 */
export function isNewerWindowState(
  next: Pick<WindowControlsState, 'revision'>,
  appliedRevision: number
): boolean {
  return next.revision > appliedRevision
}

/** Localized accessible names; each app maps its own i18n into this shape. */
export interface WindowControlLabels {
  group: string
  minimize: string
  maximize: string
  restore: string
  close: string
  enterFullScreen: string
  exitFullScreen: string
  zoom: string
}
