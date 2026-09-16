/**
 * NSIS Legacy Cleanup (Robust)
 *
 * Goals:
 * - Kill legacy PhraseVault processes (<= 2.2.1) before DB init to prevent lock conflicts
 * - Remove legacy autostart entries and shortcuts
 * - Leave legacy uninstall entry in Settings > Apps for manual removal
 * - Silent operation: failures are logged but never interrupt app startup
 *
 * Safety:
 * - Never kills current PID
 * - Never touches Velopack installation (%LOCALAPPDATA%\PhraseVault\)
 * - Version-gated (<= 2.2.1) with heuristic fallback for Program Files paths
 * - 30-second overall timeout prevents startup hangs
 * - All operations are best-effort with try-catch guards
 */

import { execFileSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

const APP_EXE = 'PhraseVault.exe'
const RUN_VALUE = 'PhraseVault'
const SHORTCUT_NAME = 'PhraseVault.lnk'
const LEGACY_MAX_VERSION = '2.2.1'

const LOG_PATH = path.join(os.tmpdir(), 'phrasevault-nsis-cleanup.log')

// Overall cleanup timeout (30 seconds max)
const CLEANUP_TIMEOUT_MS = 30000
let _cleanupStartTime: number | null = null

interface LegacyRegistryInfo {
  installLocation: string
  displayVersion: string
  regPath: string
}

interface ProcessInfo {
  ProcessId: number
  ExecutablePath?: string
  CommandLine?: string
}

interface KillResult {
  killed: number
  remainingLegacy: number
}

function isCleanupTimedOut(): boolean {
  if (!_cleanupStartTime) return false
  return Date.now() - _cleanupStartTime > CLEANUP_TIMEOUT_MS
}

function checkTimeout(operation: string): boolean {
  if (isCleanupTimedOut()) {
    log(`Cleanup timeout exceeded during ${operation}, aborting`, 'WARN')
    return true
  }
  return false
}

function log(message: string, level = 'INFO'): void {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} [${level}] ${message}\n`)
  } catch {
    // Silent fail
  }
}

function psEncode(script: string): string {
  return Buffer.from(String(script), 'utf16le').toString('base64')
}

function runPS(script: string, timeoutMs = 10000): string {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncode(script)], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    log(`PowerShell failed: ${(e as Error)?.message || e}`, 'WARN')
    return ''
  }
}

function runExe(file: string, args: string[], timeoutMs = 5000): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return ''
  }
}

function normalizeVersion(v: string | null | undefined): number[] | null {
  if (!v) return null
  const m = String(v).trim().match(/\d+/g)
  if (!m) return null
  const parts = m.slice(0, 4).map((x) => Number(x))
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts
}

function compareVersions(a: string, b: string): number | null {
  const A = normalizeVersion(a)
  const B = normalizeVersion(b)
  if (!A || !B) return null

  const len = Math.max(A.length, B.length)
  for (let i = 0; i < len; i++) {
    const av = A[i] ?? 0
    const bv = B[i] ?? 0
    if (av < bv) return -1
    if (av > bv) return 1
  }
  return 0
}

function isVersionLessThanOrEqual(a: string, b: string): boolean {
  const c = compareVersions(a, b)
  return c === null ? false : c <= 0
}

function isUnderVelopackPath(p: string): boolean {
  const lap = (process.env.LOCALAPPDATA || '').toLowerCase()
  if (!lap) return false

  const pLower = String(p || '').toLowerCase()
  const velopackPath = path.join(lap, 'phrasevault').toLowerCase()

  return pLower.startsWith(velopackPath + '\\') || pLower.startsWith(velopackPath + '/')
}

function isLikelyProgramFilesPath(p: string): boolean {
  const s = String(p || '').toLowerCase()
  return s.includes('\\program files\\') || s.includes('\\program files (x86)\\')
}

function isSquirrelPath(p: string): boolean {
  const lap = (process.env.LOCALAPPDATA || '').toLowerCase()
  if (!lap) return false

  const pLower = String(p || '').toLowerCase()
  const squirrelPath = path.join(lap, 'programs', 'phrasevault').toLowerCase()

  return pLower.startsWith(squirrelPath + '\\') || pLower.startsWith(squirrelPath + '/')
}

function extractExeFromCommandLine(cmdLine: string): string {
  if (!cmdLine) return ''
  const s = String(cmdLine).trim()
  if (!s) return ''

  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    return end > 1 ? s.slice(1, end) : ''
  }

  const idx = s.indexOf(' ')
  return idx === -1 ? s : s.slice(0, idx)
}

let _legacyRegistryInfo: LegacyRegistryInfo | null = null
let _legacyRegistryChecked = false

function findLegacyNsisRegistryEntry(): LegacyRegistryInfo | null {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$paths = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$found = $null
foreach ($p in $paths) {
    if ($found) { break }
    $found = Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object {
        $_.Publisher -eq 'Petermeir Web Solutions' -and
        $_.DisplayName -like 'PhraseVault*'
    } | Select-Object -First 1 @{N='RegPath';E={$_.PSPath -replace 'Microsoft.PowerShell.Core\\\\Registry::',''}}, DisplayVersion, InstallLocation, DisplayName
}
if ($found) { $found | ConvertTo-Json -Compress }
`

  const result = runPS(script, 8000).trim()

  if (!result) {
    log('No legacy registry entry found via Publisher/DisplayName search')
    return null
  }

  try {
    const entry = JSON.parse(result)

    if (!entry.DisplayName) {
      return null
    }

    log(`Found registry entry: "${entry.DisplayName}" v${entry.DisplayVersion} at ${entry.RegPath}`)

    if (!entry.DisplayVersion || !isVersionLessThanOrEqual(entry.DisplayVersion, LEGACY_MAX_VERSION)) {
      log(`Registry version ${entry.DisplayVersion} > ${LEGACY_MAX_VERSION}, not legacy`)
      return null
    }

    if (!entry.InstallLocation) {
      log(`No InstallLocation in registry entry`)
      return null
    }

    const exePath = path.join(entry.InstallLocation, APP_EXE)
    if (!fs.existsSync(entry.InstallLocation) && !fs.existsSync(exePath)) {
      log(`InstallLocation not found on disk: ${entry.InstallLocation}`)
      return null
    }

    return {
      installLocation: entry.InstallLocation,
      displayVersion: entry.DisplayVersion,
      regPath: entry.RegPath,
    }
  } catch (e) {
    log(`Failed to parse registry JSON: ${(e as Error)?.message}`, 'WARN')
    return null
  }
}

function getLegacyRegistryInfo(): LegacyRegistryInfo | null {
  if (!_legacyRegistryChecked) {
    _legacyRegistryInfo = findLegacyNsisRegistryEntry()
    _legacyRegistryChecked = true
  }
  return _legacyRegistryInfo
}

function isUnderInstallLocation(exePath: string, installLocation: string): boolean {
  if (!exePath || !installLocation) return false

  const exeNorm = path.normalize(exePath).toLowerCase()
  const locNorm = path.normalize(installLocation).toLowerCase().replace(/[\\/]+$/, '')

  return exeNorm.startsWith(locNorm + path.sep)
}

const versionCache = new Map<string, string>()

function getFileProductVersion(exePath: string): string {
  const key = String(exePath || '').toLowerCase()
  if (!key) return ''
  if (versionCache.has(key)) return versionCache.get(key)!

  const out = runPS(
    `
$ErrorActionPreference='SilentlyContinue'
$p='${String(exePath).replace(/'/g, "''")}'
if (Test-Path -LiteralPath $p) {
  try { (Get-Item -LiteralPath $p).VersionInfo.ProductVersion } catch { '' }
} else { '' }
`,
    2500
  ).trim()

  versionCache.set(key, out)
  return out
}

function isLegacyExePath(exePath: string): boolean {
  if (!exePath) {
    return false
  }

  const exe = String(exePath)
  const exeLower = exe.toLowerCase()
  const currentExeLower = String(process.execPath || '').toLowerCase()

  if (exeLower === currentExeLower) {
    return false
  }

  if (isUnderVelopackPath(exe)) {
    return false
  }

  const regInfo = getLegacyRegistryInfo()
  if (regInfo?.installLocation) {
    return isUnderInstallLocation(exe, regInfo.installLocation)
  }

  const isSquirrel = isSquirrelPath(exe)
  const isProgramFiles = isLikelyProgramFilesPath(exe)

  if (!isSquirrel && !isProgramFiles) {
    return false
  }

  const ver = getFileProductVersion(exe)

  if (ver) {
    return isVersionLessThanOrEqual(ver, LEGACY_MAX_VERSION)
  }

  return true
}

function getPhraseVaultProcesses(): ProcessInfo[] {
  const script = `
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='${APP_EXE}'" |
  Select-Object ProcessId, ExecutablePath, CommandLine |
  ConvertTo-Json -Compress
`
  const json = runPS(script, 5000).trim()

  if (!json) {
    return []
  }
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  } catch {
    return []
  }
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // Fallback: busy wait
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      return true
    }
    return false
  }
}

function forceKillPid(pid: number): boolean {
  const wasRunning = isPidRunning(pid)

  if (!wasRunning) {
    return true
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Continue to fallback
  }

  sleepSync(100)
  if (!isPidRunning(pid)) {
    return true
  }

  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    // Continue checking
  }

  for (let i = 0; i < 10; i++) {
    if (!isPidRunning(pid)) {
      return true
    }
    sleepSync(200)
  }

  return !isPidRunning(pid)
}

function getLegacyProcesses(): ProcessInfo[] {
  const procs = getPhraseVaultProcesses()

  return procs.filter((p) => {
    const pid = Number(p?.ProcessId)

    if (!pid) return false
    if (pid === process.pid) return false

    let exePath = (p?.ExecutablePath || '').trim()

    if (!exePath) {
      exePath = extractExeFromCommandLine(p?.CommandLine || '')
    }

    if (!exePath) return false

    return isLegacyExePath(exePath)
  })
}

function killLegacyProcesses(): KillResult {
  const maxAttempts = 3
  let totalKilled = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (checkTimeout('kill attempt ' + attempt)) {
      break
    }

    try {
      const legacyProcs = getLegacyProcesses()

      if (legacyProcs.length === 0) {
        log(attempt === 1 ? 'No legacy processes found' : 'All legacy processes verified dead')
        return { killed: totalKilled, remainingLegacy: 0 }
      }

      log(`Found ${legacyProcs.length} legacy process(es) (attempt ${attempt}/${maxAttempts})`)

      for (const p of legacyProcs) {
        if (checkTimeout('killing PID')) break

        const pid = Number(p.ProcessId)
        if (forceKillPid(pid)) {
          totalKilled++
        }
      }

      sleepSync(500)
    } catch (e) {
      log(`killLegacyProcesses attempt ${attempt} failed: ${(e as Error)?.message || e}`, 'WARN')
    }
  }

  const remaining = getLegacyProcesses()
  log(`killLegacyProcesses: killed=${totalKilled}, remainingLegacy=${remaining.length}`)
  return { killed: totalKilled, remainingLegacy: remaining.length }
}

function readRunValue(runKey: string): string {
  const val = runPS(
    `
$ErrorActionPreference='SilentlyContinue'
try {
  (Get-ItemProperty -Path '${runKey.replace(/'/g, "''")}' -Name '${RUN_VALUE}' -ErrorAction SilentlyContinue).'${RUN_VALUE}'
} catch { '' }
`,
    2000
  ).trim()
  return val || ''
}

function removeLegacyAutostart(): void {
  const keys = ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']

  for (const key of keys) {
    try {
      const cmdLine = readRunValue(key)
      if (!cmdLine) continue

      const exePath = extractExeFromCommandLine(cmdLine)
      if (!exePath) continue

      if (!isLegacyExePath(exePath)) {
        log(`Keeping autostart (${key}) target not legacy: ${exePath}`)
        continue
      }

      log(`Removing legacy autostart from ${key}: ${cmdLine}`)
      runExe('reg', ['delete', key.replace('HKCU:\\', 'HKCU\\').replace('HKLM:\\', 'HKLM\\'), '/v', RUN_VALUE, '/f'], 2000)
    } catch (e) {
      log(`removeLegacyAutostart failed (${key}): ${(e as Error)?.message || e}`, 'WARN')
    }
  }
}

interface KnownFolders {
  Desktop: string
  Programs: string
  CommonDesktop: string
  CommonPrograms: string
}

function getKnownFolders(): KnownFolders {
  const json = runPS(
    `
$ErrorActionPreference='SilentlyContinue'
$h=@{
  Desktop=[Environment]::GetFolderPath('Desktop')
  Programs=[Environment]::GetFolderPath('Programs')
  CommonDesktop=[Environment]::GetFolderPath('CommonDesktopDirectory')
  CommonPrograms=[Environment]::GetFolderPath('CommonPrograms')
}
$h | ConvertTo-Json -Compress
`,
    2000
  ).trim()

  try {
    const obj = json ? JSON.parse(json) : {}
    return {
      Desktop: obj.Desktop || path.join(os.homedir(), 'Desktop'),
      Programs: obj.Programs || path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      CommonDesktop: obj.CommonDesktop || path.join('C:', 'Users', 'Public', 'Desktop'),
      CommonPrograms: obj.CommonPrograms || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    }
  } catch {
    return {
      Desktop: path.join(os.homedir(), 'Desktop'),
      Programs: path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      CommonDesktop: path.join('C:', 'Users', 'Public', 'Desktop'),
      CommonPrograms: path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    }
  }
}

function readShortcutTarget(lnkPath: string): string {
  const out = runPS(
    `
$ErrorActionPreference='SilentlyContinue'
try {
  $sh=New-Object -ComObject WScript.Shell
  $sc=$sh.CreateShortcut('${String(lnkPath).replace(/'/g, "''")}')
  $sc.TargetPath
} catch { '' }
`,
    2500
  ).trim()
  return out || ''
}

function removeLegacyShortcuts(): void {
  const f = getKnownFolders()

  const candidates = [
    path.join(f.Desktop, SHORTCUT_NAME),
    path.join(f.Programs, SHORTCUT_NAME),
    path.join(f.CommonDesktop, SHORTCUT_NAME),
    path.join(f.CommonPrograms, SHORTCUT_NAME),
    path.join(f.Programs, 'PhraseVault', SHORTCUT_NAME),
    path.join(f.CommonPrograms, 'PhraseVault', SHORTCUT_NAME),
  ]

  for (const lnk of candidates) {
    try {
      if (!lnk || !fs.existsSync(lnk)) continue

      const target = readShortcutTarget(lnk)
      if (!target) {
        log(`Shortcut target unreadable, keeping: ${lnk}`, 'WARN')
        continue
      }

      if (!isLegacyExePath(target)) {
        log(`Keeping shortcut (not legacy): ${lnk} -> ${target}`)
        continue
      }

      log(`Removing legacy shortcut: ${lnk} -> ${target}`)
      try {
        fs.unlinkSync(lnk)
      } catch (e) {
        log(`Failed to delete shortcut ${lnk}: ${(e as Error)?.message || e}`, 'WARN')
      }
    } catch (e) {
      log(`removeLegacyShortcuts failed (${lnk}): ${(e as Error)?.message || e}`, 'WARN')
    }
  }
}

function writeDoneFlag(dir: string, doneFile: string, regInfo: LegacyRegistryInfo | null): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      doneFile,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        cleanedVersion: regInfo?.displayVersion || 'unknown',
        installLocation: regInfo?.installLocation || 'unknown',
      })
    )
    log(`Done flag written: ${doneFile}`)
  } catch (e) {
    log(`Failed to write done flag: ${(e as Error)?.message || e}`, 'WARN')
  }
}

export function uninstallLegacyNsis(): void {
  try {
    if (process.platform !== 'win32') return

    const base = process.env.LOCALAPPDATA || os.tmpdir()
    const dir = path.join(base, 'PhraseVault')
    const doneFile = path.join(dir, 'nsis-cleanup.done')

    if (fs.existsSync(doneFile)) {
      return
    }

    _cleanupStartTime = Date.now()

    log('=== NSIS Legacy Cleanup ===')
    log(`Current PID ${process.pid}, execPath: ${process.execPath}`)

    let killResult: KillResult = { killed: 0, remainingLegacy: 0 }
    try {
      killResult = killLegacyProcesses()
    } catch (e) {
      log(`killLegacyProcesses crashed: ${(e as Error)?.message || e}`, 'WARN')
    }

    if (checkTimeout('process killing')) {
      writeDoneFlag(dir, doneFile, null)
      return
    }

    const regInfo = getLegacyRegistryInfo()

    if (checkTimeout('registry lookup')) {
      writeDoneFlag(dir, doneFile, regInfo)
      return
    }

    if (!regInfo) {
      log('No legacy NSIS registry entry found.')
      if (killResult.killed > 0) {
        log(`Killed ${killResult.killed} legacy process(es) via heuristics.`)
      }
      if (killResult.remainingLegacy > 0) {
        log(`Warning: ${killResult.remainingLegacy} legacy process(es) still running.`, 'WARN')
      }
      writeDoneFlag(dir, doneFile, null)
      return
    }

    log(`Legacy NSIS found: v${regInfo.displayVersion} at "${regInfo.installLocation}"`)

    try {
      removeLegacyAutostart()
    } catch (e) {
      log(`removeLegacyAutostart crashed: ${(e as Error)?.message || e}`, 'WARN')
    }

    if (checkTimeout('autostart removal')) {
      writeDoneFlag(dir, doneFile, regInfo)
      return
    }

    try {
      removeLegacyShortcuts()
    } catch (e) {
      log(`removeLegacyShortcuts crashed: ${(e as Error)?.message || e}`, 'WARN')
    }

    writeDoneFlag(dir, doneFile, regInfo)

    if (killResult.remainingLegacy > 0) {
      log(`Cleanup complete but ${killResult.remainingLegacy} legacy process(es) still running`, 'WARN')
    } else {
      log('Cleanup complete. Registry entry left for manual uninstall.')
    }
  } catch (e) {
    log(`Fatal error in cleanup: ${(e as Error)?.message || e}`, 'ERROR')
  }
}
