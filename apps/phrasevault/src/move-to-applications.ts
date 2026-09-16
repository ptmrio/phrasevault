/**
 * macOS "Move to Applications?" offer, isolated from Electron and dialogs.
 *
 * A copy run from the DMG, Downloads or the Desktop stops working once the
 * disk image is ejected, does not start at login, and gets Accessibility trust
 * for the wrong path. Offer the move before the Accessibility request so trust
 * lands on the moved copy. When the move succeeds Electron quits and relaunches
 * from /Applications, so the caller must stop starting up.
 */

export type MoveConflict = 'exists' | 'existsAndRunning'

export interface MoveToApplicationsDependencies {
  platform: string
  isPackaged: boolean
  launchedAtLogin: boolean
  isInApplicationsFolder(): boolean
  declined(): boolean
  setDeclined(): void
  confirm(): Promise<{ move: boolean; dontAskAgain: boolean }>
  move(conflictHandler: (conflict: MoveConflict) => boolean): boolean
  notifyOtherCopyRunning(): Promise<void>
  logError(message: string, error: unknown): void
}

export function shouldOfferMoveToApplications(
  deps: Pick<MoveToApplicationsDependencies, 'platform' | 'isPackaged' | 'launchedAtLogin' | 'isInApplicationsFolder' | 'declined'>
): boolean {
  return (
    deps.platform === 'darwin' &&
    deps.isPackaged &&
    !deps.launchedAtLogin &&
    !deps.declined() &&
    !deps.isInApplicationsFolder()
  )
}

/** Resolves true only when the move succeeded and the app is relaunching. */
export async function offerMoveToApplications(deps: MoveToApplicationsDependencies): Promise<boolean> {
  if (!shouldOfferMoveToApplications(deps)) return false

  const { move, dontAskAgain } = await deps.confirm()
  if (!move) {
    if (dontAskAgain) deps.setDeclined()
    return false
  }

  let otherCopyRunning = false
  let moved = false
  try {
    moved = deps.move((conflict) => {
      // An older copy that is not running is replaced (macOS moves it to the Trash).
      if (conflict === 'exists') return true
      // Electron would focus the running copy and quit this one. After the bundle
      // id change that copy can be 2.x, so cancel and ask the user to quit it.
      otherCopyRunning = true
      return false
    })
  } catch (error) {
    deps.logError('Failed to move PhraseVault to Applications:', error)
    return false
  }

  if (!moved && otherCopyRunning) await deps.notifyOtherCopyRunning()
  return moved
}
