/**
 * macOS "Move to Applications?" offer through the real decision and flow.
 *
 * Electron and dialogs are injected; nothing native is loaded.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  offerMoveToApplications,
  shouldOfferMoveToApplications,
  type MoveConflict,
} from '../src/move-to-applications'

function setup(overrides: Partial<Parameters<typeof offerMoveToApplications>[0]> = {}) {
  const deps = {
    platform: 'darwin',
    isPackaged: true,
    launchedAtLogin: false,
    isInApplicationsFolder: vi.fn(() => false),
    declined: vi.fn(() => false),
    setDeclined: vi.fn(),
    confirm: vi.fn(async () => ({ move: true, dontAskAgain: false })),
    move: vi.fn((_handler: (conflict: MoveConflict) => boolean) => true),
    notifyOtherCopyRunning: vi.fn(async () => {}),
    logError: vi.fn(),
    ...overrides,
  }
  return deps
}

describe('shouldOfferMoveToApplications', () => {
  it('offers only a packaged darwin copy outside Applications', () => {
    expect(shouldOfferMoveToApplications(setup())).toBe(true)
  })

  it.each([
    ['on Windows', { platform: 'win32' }],
    ['in dev and e2e', { isPackaged: false }],
    ['when launched at login', { launchedAtLogin: true }],
    ['after Don\'t ask again', { declined: vi.fn(() => true) }],
    ['when already in Applications', { isInApplicationsFolder: vi.fn(() => true) }],
  ])('stays silent %s', async (_label, overrides) => {
    const deps = setup(overrides)
    expect(shouldOfferMoveToApplications(deps)).toBe(false)
    await expect(offerMoveToApplications(deps)).resolves.toBe(false)
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.move).not.toHaveBeenCalled()
  })

  it('does not ask the OS where the app lives on Windows', () => {
    const deps = setup({ platform: 'win32' })
    shouldOfferMoveToApplications(deps)
    expect(deps.isInApplicationsFolder).not.toHaveBeenCalled()
  })
})

describe('offerMoveToApplications', () => {
  it('moves and reports the relaunch when the user accepts', async () => {
    const deps = setup()
    await expect(offerMoveToApplications(deps)).resolves.toBe(true)
    expect(deps.move).toHaveBeenCalledOnce()
    expect(deps.setDeclined).not.toHaveBeenCalled()
  })

  it('keeps running in place on Not Now and asks again next launch', async () => {
    const deps = setup({ confirm: vi.fn(async () => ({ move: false, dontAskAgain: false })) })
    await expect(offerMoveToApplications(deps)).resolves.toBe(false)
    expect(deps.move).not.toHaveBeenCalled()
    expect(deps.setDeclined).not.toHaveBeenCalled()
  })

  it('remembers Don\'t ask again', async () => {
    const deps = setup({ confirm: vi.fn(async () => ({ move: false, dontAskAgain: true })) })
    await expect(offerMoveToApplications(deps)).resolves.toBe(false)
    expect(deps.setDeclined).toHaveBeenCalledOnce()
  })

  it('replaces an older copy that is not running', async () => {
    let answer: boolean | undefined
    const deps = setup({
      move: vi.fn((handler: (conflict: MoveConflict) => boolean) => {
        answer = handler('exists')
        return true
      }),
    })
    await expect(offerMoveToApplications(deps)).resolves.toBe(true)
    expect(answer).toBe(true)
    expect(deps.notifyOtherCopyRunning).not.toHaveBeenCalled()
  })

  it('cancels and explains when another copy is running from Applications', async () => {
    let answer: boolean | undefined
    const deps = setup({
      move: vi.fn((handler: (conflict: MoveConflict) => boolean) => {
        answer = handler('existsAndRunning')
        return false
      }),
    })
    await expect(offerMoveToApplications(deps)).resolves.toBe(false)
    expect(answer).toBe(false)
    expect(deps.notifyOtherCopyRunning).toHaveBeenCalledOnce()
  })

  it('keeps running in place if the user cancels the authorization prompt', async () => {
    const deps = setup({ move: vi.fn(() => false) })
    await expect(offerMoveToApplications(deps)).resolves.toBe(false)
    expect(deps.notifyOtherCopyRunning).not.toHaveBeenCalled()
    expect(deps.logError).not.toHaveBeenCalled()
  })

  it('logs a failed move and keeps running in place', async () => {
    const deps = setup({ move: vi.fn(() => { throw new Error('EPERM') }) })
    await expect(offerMoveToApplications(deps)).resolves.toBe(false)
    expect(deps.logError).toHaveBeenCalledOnce()
  })
})
