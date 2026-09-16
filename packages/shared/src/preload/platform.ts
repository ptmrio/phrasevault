/**
 * Platform attribute for the renderer
 *
 * Writes `data-platform` on the document element at preload time, so
 * `[data-platform="win32"]` / `[data-platform="darwin"]` selectors match on the
 * very first painted frame. A DOMContentLoaded-only write is one frame late and
 * can paint unstyled chrome.
 */
export function applyPlatformAttribute(platform: NodeJS.Platform = process.platform): void {
  const write = () => {
    const root = document.documentElement
    if (root) root.dataset.platform = platform
  }

  if (document.documentElement) {
    write()
    return
  }

  document.addEventListener('DOMContentLoaded', write, { once: true })
}
