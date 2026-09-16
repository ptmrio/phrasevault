/**
 * The clipboard/paste operation, isolated from Electron and native modules.
 *
 * Ordering is the product contract: when synthetic paste is allowed, hide →
 * bring target to top → snapshot the clipboard → write → (on write failure)
 * restore the palette and report once, without pasting or counting usage →
 * 100ms → paste + usage → 100ms → restore the original clipboard formats. A
 * successful insert stays silent. When synthetic paste is denied, skip hide
 * and focus-return, leave the phrase on the clipboard, and toast once.
 *
 * Overlapping calls wait until the previous transaction finishes restoring
 * the clipboard. Resolving performPaste before that restore is what let a
 * second insert snapshot the first phrase as "original". Callers that read
 * the clipboard for {{clipboard}} must go through performPaste.enqueue so
 * they wait for that restore too. Phrase copy uses the same queue via
 * createPerformCopy so a copy cannot overwrite an in-flight paste.
 */

export interface PasteWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  hide(): void
  show(): void
  focus(): void
  restore(): void
}

export interface PasteDependencies {
  getWindow(): PasteWindow | null
  bringTargetToTop(): void
  readText(): Promise<string>
  readHtml(): Promise<string>
  writeText(text: string): Promise<void>
  writeFormats(text: string, html?: string): Promise<void>
  markdown(text: string): string
  paste(): void
  incrementUsage(id: number): void
  notifyRecovery(): void
  notifyAccessibilityDenied(): void
  logError(message: string, error: unknown): void
  canSyntheticPaste(): boolean
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function restoreClipboard(
  deps: PasteDependencies,
  originalText: string,
  originalHtml: string
): Promise<void> {
  try {
    await deps.writeFormats(originalText, originalHtml)
  } catch (error) {
    deps.logError('Failed to restore original clipboard content:', error)
  }
}

async function performOne(
  deps: PasteDependencies,
  phrase: { id: number; type: string },
  text: string,
  abortIf?: () => boolean
): Promise<void> {
  const win = deps.getWindow()
  const synthetic = deps.canSyntheticPaste()
  if (synthetic) {
    if (win && !win.isDestroyed()) win.hide()
    deps.bringTargetToTop()
  }

  let originalText = ''
  let originalHtml = ''
  try {
    originalText = await deps.readText()
    originalHtml = await deps.readHtml()
  } catch (error) {
    originalText = ''
    originalHtml = ''
    deps.logError('Failed to read clipboard content:', error)
  }

  // Lock now / timeout can land during the clipboard snapshot. A protected
  // body that was already decrypted must not be written after the session died.
  if (abortIf?.()) return

  try {
    if (phrase.type === 'markdown' || phrase.type === 'mdwysiwyg') {
      await deps.writeFormats(text, deps.markdown(text))
    } else if (phrase.type === 'html') {
      await deps.writeFormats(text, text)
    } else {
      await deps.writeText(text)
    }
  } catch (error) {
    deps.logError('Failed to write to clipboard:', error)
    // macOS app.hide() completes asynchronously: a show() in the same tick is
    // undone by the pending hide and the palette stays hidden. Let it settle.
    if (synthetic) await wait(100)
    // Recovery uses this window instance directly so the remembered target
    // window, query and selection all survive. Retry needs a new user action.
    const recovery = deps.getWindow()
    if (recovery && !recovery.isDestroyed()) {
      if (recovery.isMinimized()) recovery.restore()
      recovery.show()
      recovery.focus()
    }
    deps.notifyRecovery()
    return
  }

  if (abortIf?.()) {
    await restoreClipboard(deps, originalText, originalHtml)
    return
  }

  if (!synthetic) {
    deps.notifyAccessibilityDenied()
    return
  }

  await wait(100)
  if (abortIf?.()) {
    await restoreClipboard(deps, originalText, originalHtml)
    return
  }
  try {
    deps.paste()
    deps.incrementUsage(phrase.id)
  } catch (error) {
    deps.logError('Failed to simulate paste command:', error)
  }
  await wait(100)
  await restoreClipboard(deps, originalText, originalHtml)
}

export type PasteEnqueue = <T>(run: () => T | Promise<T>) => Promise<T>

export type PerformPaste = ((
  phrase: { id: number; type: string },
  text: string,
  abortIf?: () => boolean
) => Promise<void>) & { enqueue: PasteEnqueue }

export function createPerformPaste(deps: PasteDependencies): PerformPaste {
  let tail: Promise<void> = Promise.resolve()
  const enqueue: PasteEnqueue = (run) => {
    const next = tail.then(run, run)
    tail = Promise.resolve(next).then(
      () => undefined,
      () => undefined
    )
    return next
  }
  const performPaste = ((
    phrase: { id: number; type: string },
    text: string,
    abortIf?: () => boolean
  ) => enqueue(() => performOne(deps, phrase, text, abortIf))) as PerformPaste
  performPaste.enqueue = enqueue
  return performPaste
}

export function createPerformCopy(
  enqueue: PasteEnqueue,
  deps: Pick<PasteDependencies, 'writeText' | 'writeFormats' | 'markdown'>,
  abortError: () => Error = () => new Error('locked')
) {
  return function performCopy(
    type: string,
    text: string,
    abortIf?: () => boolean
  ): Promise<void> {
    return enqueue(async () => {
      if (abortIf?.()) throw abortError()
      if (type === 'markdown' || type === 'mdwysiwyg') {
        await deps.writeFormats(text, deps.markdown(text))
      } else if (type === 'html') {
        await deps.writeFormats(text, text)
      } else {
        await deps.writeText(text)
      }
    })
  }
}
