/**
 * PIN lock end to end.
 *
 * These drive the real UI and the real database. The leak assertions look at the
 * rendered DOM and at actual IPC payloads rather than at internal state, because
 * the contract is precisely "the body does not leave main".
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { electron, expect, waitForAppReady } from '@spqrkapps/shared/e2e'
import type { Page } from '@spqrkapps/shared/e2e'
import { calls, createPaletteTest, seedPalette } from './palette-fixture'
import type { PhraseRow, VaultBodyResult, VaultResult, VaultStatus } from '../src/types'

const test = createPaletteTest()
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SECRET = 'sk-live-DO-NOT-LEAK-9713'
const PIN = '1234'

async function suppressAnimation(window: Page): Promise<void> {
  await window.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  })
}

/** Create one protected phrase through the composer, including PIN setup. */
async function createProtectedPhrase(window: Page, name = 'api key'): Promise<void> {
  await window.locator('#add-phrase').first().click()
  await expect(window.locator('#modal-phrase')).toBeVisible()
  await window.locator('#phraseInput').fill(name)
  await window.locator('#expandedTextInput').fill(SECRET)

  await window.locator('#phrase-lock').check()
  await expect(window.locator('#modal-vault-pin')).toBeVisible()
  await window.locator('#vault-pin-new').fill(PIN)
  await window.locator('#vault-pin-confirm').fill(PIN)
  await window.locator('#btn-vault-pin-submit').click()
  await expect(window.locator('#modal-vault-pin')).toBeHidden({ timeout: 20000 })
  await expect(window.locator('#phrase-lock')).toBeChecked()

  await window.locator('#saveButton').click()
  await expect(window.locator('#modal-phrase')).toBeHidden()
}

async function status(window: Page): Promise<VaultStatus> {
  return window.evaluate(() => window.api.invoke<VaultStatus>('vault:getStatus'))
}

/** The vault is only usable once database.ts has handed lock.ts a connection. */
async function waitForVaultReady(window: Page): Promise<void> {
  await expect.poll(async () => (await status(window)).available, { timeout: 20000 }).toBe(true)
}

test('the setup dialog enforces a 4-character minimum and a matching confirm', async ({ window }) => {
  await waitForAppReady(window)
  await waitForVaultReady(window)
  await suppressAnimation(window)
  await window.locator('#add-phrase').first().click()
  await window.locator('#phraseInput').fill('api key')
  await window.locator('#expandedTextInput').fill(SECRET)

  await window.locator('#phrase-lock').check()
  await expect(window.locator('#modal-vault-pin')).toBeVisible()

  // Too short.
  await window.locator('#vault-pin-new').fill('123')
  await window.locator('#vault-pin-confirm').fill('123')
  await window.locator('#btn-vault-pin-submit').click()
  await expect(window.locator('#vault-pin-error')).toBeVisible()
  await expect(window.locator('#modal-vault-pin')).toBeVisible()

  // Mismatched confirm.
  await window.locator('#vault-pin-new').fill('1234')
  await window.locator('#vault-pin-confirm').fill('4321')
  await window.locator('#btn-vault-pin-submit').click()
  await expect(window.locator('#vault-pin-error')).toBeVisible()
  await expect(window.locator('#modal-vault-pin')).toBeVisible()

  // No PIN was created by any of that.
  expect((await status(window)).hasPin).toBe(false)
})

test('cancelling setup unchecks the box and changes nothing', async ({ window }) => {
  await waitForAppReady(window)
  await waitForVaultReady(window)
  await suppressAnimation(window)
  await window.locator('#add-phrase').first().click()
  await window.locator('#phraseInput').fill('api key')
  await window.locator('#expandedTextInput').fill(SECRET)

  await window.locator('#phrase-lock').check()
  await expect(window.locator('#modal-vault-pin')).toBeVisible()
  await window.locator('#btn-vault-pin-cancel').click()
  await expect(window.locator('#modal-vault-pin')).toBeHidden()

  await expect(window.locator('#phrase-lock')).not.toBeChecked()
  expect((await status(window)).hasPin).toBe(false)
  // The draft survives the cancelled dialog.
  await expect(window.locator('#expandedTextInput')).toHaveValue(SECRET)
})

test('a protected row shows a lock glyph and its body is nowhere in the DOM', async ({
  electronApp,
  window,
}) => {
  await seedPalette(electronApp, window)
  await suppressAnimation(window)
  await createProtectedPhrase(window)

  const row = window.locator('#phrase-list > .phrase-item', { hasText: 'api key' })
  await expect(row).toBeVisible()
  await expect(row.locator('.phrase-lock-glyph')).toBeVisible()

  const html = await window.evaluate(() => document.documentElement.outerHTML)
  expect(html).not.toContain(SECRET)

  // Not even while the session is unlocked: search never decrypts.
  expect((await status(window)).unlocked).toBe(true)
  const rows = await window.evaluate(() => window.api.invoke<PhraseRow[]>('phrases:search', ''))
  expect(JSON.stringify(rows)).not.toContain(SECRET)
  const locked = rows.find((r) => r.phrase === 'api key')
  expect(locked?.locked).toBe(1)
  expect(locked?.expanded_text).toBe('')
})

test('search does not match a substring that exists only inside a protected body', async ({
  electronApp,
  window,
}) => {
  await seedPalette(electronApp, window)
  await suppressAnimation(window)
  await createProtectedPhrase(window)

  const found = await window.evaluate(() => window.api.invoke<PhraseRow[]>('phrases:search', 'DO-NOT-LEAK'))
  expect(found).toEqual([])

  // The same row is still reachable by its name.
  const byName = await window.evaluate(() => window.api.invoke<PhraseRow[]>('phrases:search', 'api key'))
  expect(byName.length).toBe(1)
})

test('copying a protected row while locked asks for the PIN, then sends only the id', async ({
  electronApp,
  window,
}) => {
  await seedPalette(electronApp, window)
  await suppressAnimation(window)
  await createProtectedPhrase(window)

  // Lock the session again, the way the tray Lock now does.
  await window.evaluate(() => window.api.invoke('vault:lock'))
  await expect.poll(async () => (await status(window)).unlocked).toBe(false)
  await electronApp.evaluate(() => {
    globalThis.__pvP0.calls.length = 0
  })

  const row = window.locator('#phrase-list > .phrase-item', { hasText: 'api key' })
  await row.locator('button[data-action="copy"]').click()

  // The PIN is asked for first, and nothing has been copied yet.
  await expect(window.locator('#modal-vault-pin')).toBeVisible()
  expect(await calls(electronApp, 'phrases:copyToClipboard')).toEqual([])

  await window.locator('#vault-pin-new').fill(PIN)
  await window.locator('#btn-vault-pin-submit').click()
  await expect(window.locator('#modal-vault-pin')).toBeHidden({ timeout: 20000 })

  // Exactly one copy, carrying the numeric id only.
  await expect.poll(async () => (await calls(electronApp, 'phrases:copyToClipboard')).length).toBe(1)
  const copyCalls = await calls(electronApp, 'phrases:copyToClipboard')
  expect(typeof copyCalls[0].data).toBe('number')
  expect(JSON.stringify(copyCalls)).not.toContain(SECRET)
})

test('cancelling the PIN on a protected copy copies nothing at all', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await suppressAnimation(window)
  await createProtectedPhrase(window)
  await window.evaluate(() => window.api.invoke('vault:lock'))
  await expect.poll(async () => (await status(window)).unlocked).toBe(false)
  await electronApp.evaluate(() => {
    globalThis.__pvP0.calls.length = 0
  })

  const row = window.locator('#phrase-list > .phrase-item', { hasText: 'api key' })
  await row.locator('button[data-action="copy"]').click()
  await expect(window.locator('#modal-vault-pin')).toBeVisible()
  await window.locator('#btn-vault-pin-cancel').click()
  await expect(window.locator('#modal-vault-pin')).toBeHidden()

  expect(await calls(electronApp, 'phrases:copyToClipboard')).toEqual([])
})

test('unticking the box on save restores plaintext', async ({ electronApp, window }) => {
  await seedPalette(electronApp, window)
  await suppressAnimation(window)
  await createProtectedPhrase(window)

  const row = window.locator('#phrase-list > .phrase-item', { hasText: 'api key' })
  await row.locator('button[data-action="edit"]').click()
  await expect(window.locator('#modal-phrase')).toBeVisible()
  // Editing a protected row round-trips through main to fill the textarea.
  await expect(window.locator('#expandedTextInput')).toHaveValue(SECRET)
  await expect(window.locator('#phrase-lock')).toBeChecked()

  await window.locator('#phrase-lock').uncheck()
  await window.locator('#saveButton').click()
  await expect(window.locator('#modal-phrase')).toBeHidden()

  await expect
    .poll(async () => {
      const rows = await window.evaluate(() => window.api.invoke<PhraseRow[]>('phrases:search', 'api key'))
      return rows[0]?.expanded_text
    })
    .toBe(SECRET)
  await expect.poll(async () => (await status(window)).lockedCount).toBe(0)
})

test('the Security panel is reachable and its actions are correctly disabled with no PIN', async ({
  window,
}) => {
  await waitForAppReady(window)
  await waitForVaultReady(window)
  await suppressAnimation(window)
  await window.locator('#btn-settings').click()
  await expect(window.locator('#modal-settings')).toBeVisible()

  await window.locator('#settings-tab-security').click()
  await expect(window.locator('#settings-security')).toBeVisible()
  await expect(window.locator('#vault-empty-hint')).toBeVisible()
  await expect(window.locator('#btn-vault-lock-now')).toBeDisabled()
  await expect(window.locator('#btn-vault-change-pin')).toBeDisabled()
  await expect(window.locator('#vault-timeout-toggle')).toBeDisabled()
})

/**
 * The real "lock on full quit" proof: two launches against the same profile.
 * A RAM-only DEK needs no code to die with the process, so this is the only
 * thing that can demonstrate it.
 */
test('a full quit ends the session while the PIN and the ciphertext survive', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'phrasevault-relaunch-'))
  const mainPath = path.join(appDir, 'dist', 'palette-p0-bootstrap.cjs')
  const launch = async () =>
    electron.launch({
      args: [mainPath],
      env: { ...process.env, NODE_ENV: 'test', PV_E2E_USERDATA: profile },
    })

  let app = await launch()
  let window = await app.firstWindow()
  await waitForAppReady(window)
  await waitForVaultReady(window)

  const created = await window.evaluate(
    async ([pin, secret]) => {
      const setup = await window.api.invoke<VaultResult>('vault:setup', { pin })
      if (!setup.ok) return { ok: false as const, id: 0, why: JSON.stringify(setup) }
      await new Promise<void>((resolve) => {
        window.api.receiveOnce('phrases:added', () => resolve())
        window.api.send('phrases:add', {
          newPhrase: 'relaunch key',
          newExpandedText: secret,
          type: 'text',
          locked: true,
        })
      })
      const rows = await window.api.invoke<PhraseRow[]>('phrases:search', 'relaunch key')
      return { ok: true as const, id: rows[0].id, why: '' }
    },
    [PIN, SECRET] as const
  )
  expect(created.why).toBe('')
  expect(created.ok).toBe(true)

  const before = await window.evaluate(() => window.api.invoke<VaultStatus>('vault:getStatus'))
  expect(before).toMatchObject({ hasPin: true, unlocked: true, lockedCount: 1 })
  await app.close()

  // Second launch, same profile.
  app = await launch()
  window = await app.firstWindow()
  await waitForAppReady(window)
  await waitForVaultReady(window)

  const after = await window.evaluate(() => window.api.invoke<VaultStatus>('vault:getStatus'))
  expect(after).toMatchObject({ hasPin: true, unlocked: false, lockedCount: 1 })

  // The actual protected row is refused, not some invented id.
  const refused = await window.evaluate(
    (id) => window.api.invoke<VaultBodyResult>('vault:getPhraseBody', { id }),
    created.id
  )
  expect(refused).toEqual({ ok: false, error: 'locked' })

  // And the same PIN still opens it, so nothing was lost with the process.
  const unlocked = await window.evaluate(
    (pin) => window.api.invoke<VaultResult>('vault:unlock', { pin }),
    PIN
  )
  expect(unlocked).toEqual({ ok: true })
  const revealed = await window.evaluate(
    (id) => window.api.invoke<VaultBodyResult>('vault:getPhraseBody', { id }),
    created.id
  )
  expect(revealed).toEqual({ ok: true, text: SECRET })

  await app.close()
  fs.rmSync(profile, { recursive: true, force: true })
})
