// e2e/palette-bootstrap.cjs (CommonJS is required by the Electron test bootstrap)
//
// Disposable P0 palette bootstrap. Sets a throwaway userData directory before any
// app module loads, then records/intercepts a small set of IPC requests so tests can
// observe real production behaviour without driving a native paste.
const { app, ipcMain, clipboard } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// A relaunch test needs the same profile twice, so an explicit directory wins
// over the disposable one. Everything else still gets a throwaway per launch.
const userData = process.env.PV_E2E_USERDATA
  ? (fs.mkdirSync(process.env.PV_E2E_USERDATA, { recursive: true }), process.env.PV_E2E_USERDATA)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'phrasevault-p0-'))
app.setPath('userData', userData)

const releases = []
globalThis.__pvP0 = {
  calls: [],
  searchCount: 0,
  finishedSearches: 0,
  holdSearch: false,
  failNextSearch: false,
  passThroughInsert: false,
  failClipboardWrite: false,
  userData,
  releaseAll() { releases.splice(0).forEach(resolve => resolve()) },
}
const state = globalThis.__pvP0

const on = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, listener) => {
  if (['phrases:insertById', 'phrases:copyToClipboard', 'phrases:incrementUsage', 'phrases:add'].includes(channel)) {
    return on(channel, (event, data) => {
      state.calls.push({ channel, data })
      if (channel !== 'phrases:insertById' || state.passThroughInsert) listener(event, data)
    })
  }
  return on(channel, listener)
}

const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => {
  if (channel !== 'phrases:search') return handle(channel, listener)
  return handle(channel, async (event, query) => {
    state.searchCount++
    const rejectThis = state.failNextSearch
    state.failNextSearch = false
    const outcome = Promise.resolve().then(() => {
      if (rejectThis) throw new Error('Injected read failure')
      return listener(event, query)
    }).then(rows => ({ ok: true, rows }), error => ({ ok: false, error }))
    if (state.holdSearch) await new Promise(resolve => releases.push(resolve))
    const result = await outcome
    state.finishedSearches++
    if (!result.ok) throw result.error
    return result.rows
  })
}

const writeText = clipboard.writeText.bind(clipboard)
const write = clipboard.write.bind(clipboard)
clipboard.writeText = async text => {
  if (state.failClipboardWrite) {
    state.failClipboardWrite = false
    throw new Error('Injected clipboard write failure')
  }
  return writeText(text)
}
clipboard.write = async items => {
  if (state.failClipboardWrite) {
    state.failClipboardWrite = false
    throw new Error('Injected clipboard write failure')
  }
  return write(items)
}

// robotPaste is a test call record, not an IPC channel.
const robot = require('@hurdlegroup/robotjs')
robot.keyTap = (key, modifiers) => state.calls.push({ channel: 'robotPaste', data: { key, modifiers } })

// Test-only database transitions, confined to the freshly created userData directory.
state.cloneDatabase = async () => {
  const destination = path.join(userData, 'palette-b.sqlite')
  fs.copyFileSync(path.join(userData, 'phrasevault.sqlite'), destination)
  const sqlite3 = require('sqlite3')
  await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(destination, error => {
      if (error) { reject(error); return }
      connection.run('UPDATE phrases SET expanded_text = ? WHERE phrase = ?', ['Database B response', 'sig'], error => {
        connection.close(closeError => error || closeError ? reject(error || closeError) : resolve())
      })
    })
  })
  return destination
}
state.brokenDatabase = () => {
  const destination = path.join(userData, 'invalid.sqlite')
  fs.writeFileSync(destination, 'not a sqlite database')
  return destination
}

require('./main.cjs')
