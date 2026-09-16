/**
 * In-page window controls
 *
 * Renders the Windows minimize / maximize-restore / close cluster or the
 * macOS close / minimize / fullscreen traffic lights as ordinary buttons
 * inside the 32px `.titlebar`. Main owns the state; this module only renders
 * it and forwards commands.
 */
import {
  isNewerWindowState,
  type WindowControlAction,
  type WindowControlLabels,
  type WindowControlsState,
} from '../types/window-controls'

export interface WindowControlsBridge {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
  receive: (channel: string, callback: (...args: unknown[]) => void) => void
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void
}

export interface WindowControlsOptions {
  /** The `.titlebar` element the cluster mounts into. */
  container: HTMLElement
  /** Localized accessible names; merged over the English defaults. */
  labels?: Partial<WindowControlLabels>
  /** Defaults to `window.api`. */
  api?: WindowControlsBridge
}

export interface WindowControlsHandle {
  /** The `.window-controls` group element. */
  element: HTMLElement
  setLabels(labels: Partial<WindowControlLabels>): void
  getState(): WindowControlsState | null
  destroy(): void
}

export const DEFAULT_WINDOW_CONTROL_LABELS: WindowControlLabels = {
  group: 'Window controls',
  minimize: 'Minimize',
  maximize: 'Maximize',
  restore: 'Restore Down',
  close: 'Close',
  enterFullScreen: 'Enter Full Screen',
  exitFullScreen: 'Exit Full Screen',
  zoom: 'Zoom',
}

/**
 * Caption glyph paths: 10x10 pixel-crisp win32 shapes and 12x12 stroked macOS
 * shapes. They deliberately do not live in the shared Tabler ICON_PATHS
 * registry, whose contract is 24x24 stroke icons rendered through createIcon.
 */
const WINDOW_CONTROL_GLYPHS = {
  win32: {
    minimize: 'M0 5.5 H10',
    maximize: 'M0.5 0.5 H9.5 V9.5 H0.5 Z',
    restore: 'M2.5 0.5 H9.5 V7.5 H7.5 M0.5 2.5 H7.5 V9.5 H0.5 Z',
    close: 'M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5',
  },
  darwin: {
    close: 'M3.5 3.5 L8.5 8.5 M8.5 3.5 L3.5 8.5',
    minimize: 'M3 6 H9',
    enterFullScreen: 'M6.6 3.2 H8.8 V5.4 M8.8 3.2 L6.2 5.8 M5.4 8.8 H3.2 V6.6 M3.2 8.8 L5.8 6.2',
    exitFullScreen: 'M8.6 5.6 H6.4 V3.4 M6.4 5.6 L8.8 3.2 M3.4 6.4 H5.6 V8.6 M5.6 6.4 L3.2 8.8',
    zoom: 'M6 3.4 V8.6 M3.4 6 H8.6',
  },
} as const

const SVG_NS = 'http://www.w3.org/2000/svg'

function makeGlyph(viewBox: string, d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', viewBox)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  return svg
}

function makeControl(action: WindowControlAction, testid: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'window-control'
  button.dataset.windowAction = action
  button.setAttribute('data-testid', testid)
  return button
}

export function initWindowControls(options: WindowControlsOptions): WindowControlsHandle {
  const { container } = options
  const api = options.api ?? (window as unknown as { api: WindowControlsBridge }).api

  let labels: WindowControlLabels = { ...DEFAULT_WINDOW_CONTROL_LABELS, ...options.labels }
  let state: WindowControlsState | null = null
  let appliedRevision = -1
  let optionHeld = false

  const isDarwin = document.documentElement.dataset.platform === 'darwin'
  const cluster: 'win32' | 'darwin' = isDarwin ? 'darwin' : 'win32'

  const group = document.createElement('div')
  group.className = 'window-controls'
  group.setAttribute('role', 'group')
  group.setAttribute('data-testid', 'window-controls')
  group.dataset.platformCluster = cluster
  group.dataset.maximized = 'false'
  group.dataset.fullscreen = 'false'
  group.dataset.focused = 'true'

  // Windows: minimize, maximize, close - Close outermost.
  // macOS: close, minimize, fullscreen - leftmost first.
  // DOM order equals visual order on both, so the natural tab order does too.
  const minimizeBtn = makeControl('minimize', 'window-control-minimize')
  const closeBtn = makeControl('close', 'window-control-close')
  const maximizeBtn = isDarwin ? null : makeControl('maximize', 'window-control-maximize')
  const fullscreenBtn = isDarwin ? makeControl('fullscreen', 'window-control-fullscreen') : null

  const controls: HTMLButtonElement[] = isDarwin
    ? [closeBtn, minimizeBtn, fullscreenBtn as HTMLButtonElement]
    : [minimizeBtn, maximizeBtn as HTMLButtonElement, closeBtn]
  controls.forEach((control) => group.appendChild(control))

  function setGlyph(button: HTMLButtonElement | null, viewBox: string, d: string): void {
    if (!button) return
    button.replaceChildren(makeGlyph(viewBox, d))
  }

  function setName(button: HTMLButtonElement | null, name: string): void {
    if (!button) return
    button.setAttribute('aria-label', name)
    button.title = name
  }

  function render(): void {
    group.setAttribute('aria-label', labels.group)

    const focused = state?.focused ?? true
    const maximized = state?.maximized ?? false
    const fullscreen = state?.fullscreen ?? false
    const blocked = document.documentElement.dataset.modalOpen === 'true'

    group.dataset.focused = String(focused)
    group.dataset.maximized = String(maximized)
    group.dataset.fullscreen = String(fullscreen)

    if (isDarwin) {
      setGlyph(closeBtn, '0 0 12 12', WINDOW_CONTROL_GLYPHS.darwin.close)
      setName(closeBtn, labels.close)

      setGlyph(minimizeBtn, '0 0 12 12', WINDOW_CONTROL_GLYPHS.darwin.minimize)
      setName(minimizeBtn, labels.minimize)

      // Option outside fullscreen turns the green button into Zoom. The glyph,
      // the aria-label, the title, and the action all change together.
      const zooming = optionHeld && !fullscreen && (state?.canZoom ?? false)
      if (fullscreenBtn) {
        fullscreenBtn.dataset.windowAction = zooming ? 'zoom' : 'fullscreen'
        if (zooming) {
          setGlyph(fullscreenBtn, '0 0 12 12', WINDOW_CONTROL_GLYPHS.darwin.zoom)
          setName(fullscreenBtn, labels.zoom)
        } else if (fullscreen) {
          setGlyph(fullscreenBtn, '0 0 12 12', WINDOW_CONTROL_GLYPHS.darwin.exitFullScreen)
          setName(fullscreenBtn, labels.exitFullScreen)
        } else {
          setGlyph(fullscreenBtn, '0 0 12 12', WINDOW_CONTROL_GLYPHS.darwin.enterFullScreen)
          setName(fullscreenBtn, labels.enterFullScreen)
        }
      }
    } else {
      setGlyph(minimizeBtn, '0 0 10 10', WINDOW_CONTROL_GLYPHS.win32.minimize)
      setName(minimizeBtn, labels.minimize)

      setGlyph(
        maximizeBtn,
        '0 0 10 10',
        maximized ? WINDOW_CONTROL_GLYPHS.win32.restore : WINDOW_CONTROL_GLYPHS.win32.maximize
      )
      setName(maximizeBtn, maximized ? labels.restore : labels.maximize)

      setGlyph(closeBtn, '0 0 10 10', WINDOW_CONTROL_GLYPHS.win32.close)
      setName(closeBtn, labels.close)
    }

    // A blocked bar disables everything; otherwise availability comes only from
    // the published capabilities, never from a guess about the last click.
    minimizeBtn.disabled = blocked || !(state?.canMinimize ?? true)
    closeBtn.disabled = blocked || !(state?.canClose ?? true)
    if (maximizeBtn) maximizeBtn.disabled = blocked || !(state?.canMaximize ?? true)
    if (fullscreenBtn) {
      const available =
        optionHeld && !fullscreen ? (state?.canZoom ?? false) : (state?.canFullscreen ?? true)
      fullscreenBtn.disabled = blocked || !available
    }
  }

  function applyState(next: WindowControlsState): void {
    if (!isNewerWindowState(next, appliedRevision)) return
    appliedRevision = next.revision
    state = next
    render()
  }

  const onStateChanged = (...args: unknown[]): void => {
    const next = args[0] as WindowControlsState | undefined
    if (next && typeof next.revision === 'number') applyState(next)
  }

  // Subscribe before asking, then discard a get-state reply that lost the race.
  api.receive('window:state-changed', onStateChanged)
  void api.invoke<WindowControlsState | null>('window:get-state').then((snapshot) => {
    if (snapshot && typeof snapshot.revision === 'number') applyState(snapshot)
  })

  const onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest('.window-control')
    if (!(target instanceof HTMLButtonElement) || target.disabled) return
    const action = target.dataset.windowAction as WindowControlAction | undefined

    switch (action) {
      case 'minimize':
        void api.invoke('window:minimize')
        return
      case 'maximize':
        void api.invoke('window:maximize')
        return
      case 'close':
        void api.invoke('window:close')
        return
      case 'zoom':
        void api.invoke('window:zoom')
        return
      case 'fullscreen':
        void api.invoke('window:set-fullscreen', { fullscreen: !(state?.fullscreen ?? false) })
        return
      default:
        return
    }
  }

  // Option tracking: keyboard, plus the pointer event's own altKey so a click
  // that arrives without a prior keydown still reads correctly.
  const setOption = (held: boolean): void => {
    if (optionHeld === held) return
    optionHeld = held
    render()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') setOption(true)
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') setOption(false)
  }
  const onPointerDown = (event: PointerEvent): void => setOption(event.altKey)
  // A window blur can strand a held modifier and a hover state.
  const onWindowBlur = (): void => setOption(false)

  group.addEventListener('click', onClick)
  if (isDarwin) {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    group.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onWindowBlur)
  }

  // Windows: after .titlebar-actions. macOS: before .titlebar-left.
  if (isDarwin) container.insertBefore(group, container.firstChild)
  else container.appendChild(group)

  // Real `disabled` on every control while a modal is open. The attribute is
  // set synchronously by the modal manager; this observer runs in the following
  // microtask checkpoint, still before the overlay's first painted frame.
  const modalObserver = new MutationObserver(() => render())
  modalObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-modal-open'],
  })

  render()

  return {
    element: group,
    setLabels(next: Partial<WindowControlLabels>): void {
      labels = { ...labels, ...next }
      render()
    },
    getState(): WindowControlsState | null {
      return state
    },
    destroy(): void {
      api.removeListener('window:state-changed', onStateChanged)
      group.removeEventListener('click', onClick)
      if (isDarwin) {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        group.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('blur', onWindowBlur)
      }
      modalObserver.disconnect()
      group.remove()
    },
  }
}
