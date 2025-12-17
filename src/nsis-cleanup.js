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

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const APP_EXE = "PhraseVault.exe";
const RUN_VALUE = "PhraseVault";
const SHORTCUT_NAME = "PhraseVault.lnk";
const LEGACY_MAX_VERSION = "2.2.1";

const LOG_PATH = path.join(os.tmpdir(), "phrasevault-nsis-cleanup.log");

// Overall cleanup timeout (30 seconds max)
const CLEANUP_TIMEOUT_MS = 30000;
let _cleanupStartTime = null;

function isCleanupTimedOut() {
    if (!_cleanupStartTime) return false;
    return Date.now() - _cleanupStartTime > CLEANUP_TIMEOUT_MS;
}

function checkTimeout(operation) {
    if (isCleanupTimedOut()) {
        log(`Cleanup timeout exceeded during ${operation}, aborting`, "WARN");
        return true;
    }
    return false;
}

function log(message, level = "INFO") {
    try {
        fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} [${level}] ${message}\n`);
    } catch {}
}

function psEncode(script) {
    return Buffer.from(String(script), "utf16le").toString("base64");
}

function runPS(script, timeoutMs = 10000) {
    try {
        return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", psEncode(script)], { encoding: "utf8", windowsHide: true, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
        log(`PowerShell failed: ${e?.message || e}`, "WARN");
        return "";
    }
}

function runExe(file, args, timeoutMs = 5000) {
    try {
        return execFileSync(file, args, {
            encoding: "utf8",
            windowsHide: true,
            timeout: timeoutMs,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (e) {
        // best-effort: ignore
        return "";
    }
}

function normalizeVersion(v) {
    if (!v) return null;
    const m = String(v).trim().match(/\d+/g);
    if (!m) return null;
    // keep up to 4 components (major.minor.patch.build)
    const parts = m.slice(0, 4).map((x) => Number(x));
    if (parts.some((n) => !Number.isFinite(n))) return null;
    return parts;
}

function compareVersions(a, b) {
    const A = normalizeVersion(a);
    const B = normalizeVersion(b);
    if (!A || !B) return null;

    const len = Math.max(A.length, B.length);
    for (let i = 0; i < len; i++) {
        const av = A[i] ?? 0;
        const bv = B[i] ?? 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
    }
    return 0;
}

function isVersionLessThanOrEqual(a, b) {
    const c = compareVersions(a, b);
    return c === null ? false : c <= 0;
}

/**
 * Check if path is under the VELOPACK install location specifically.
 * Velopack installs to: %LOCALAPPDATA%\PhraseVault\
 * Squirrel installed to: %LOCALAPPDATA%\Programs\PhraseVault\ (this is LEGACY)
 * NSIS installed to: Program Files\PhraseVault\ (this is LEGACY)
 *
 * We only want to exclude Velopack paths, not Squirrel paths!
 */
function isUnderVelopackPath(p) {
    const lap = (process.env.LOCALAPPDATA || "").toLowerCase();
    if (!lap) return false;

    const pLower = String(p || "").toLowerCase();
    // Velopack path: %LOCALAPPDATA%\PhraseVault\ (NOT Programs!)
    const velopackPath = path.join(lap, "phrasevault").toLowerCase();

    return pLower.startsWith(velopackPath + "\\") || pLower.startsWith(velopackPath + "/");
}

function isLikelyProgramFilesPath(p) {
    const s = String(p || "").toLowerCase();
    return s.includes("\\program files\\") || s.includes("\\program files (x86)\\");
}

/**
 * Check if path is a Squirrel.Windows install location
 * Squirrel installs to: %LOCALAPPDATA%\Programs\PhraseVault\
 */
function isSquirrelPath(p) {
    const lap = (process.env.LOCALAPPDATA || "").toLowerCase();
    if (!lap) return false;

    const pLower = String(p || "").toLowerCase();
    const squirrelPath = path.join(lap, "programs", "phrasevault").toLowerCase();

    return pLower.startsWith(squirrelPath + "\\") || pLower.startsWith(squirrelPath + "/");
}

function extractExeFromCommandLine(cmdLine) {
    if (!cmdLine) return "";
    const s = String(cmdLine).trim();
    if (!s) return "";

    if (s.startsWith('"')) {
        const end = s.indexOf('"', 1);
        return end > 1 ? s.slice(1, end) : "";
    }

    // unquoted: take first token
    const idx = s.indexOf(" ");
    return idx === -1 ? s : s.slice(0, idx);
}

// Module-level cache for registry lookup
let _legacyRegistryInfo = null;
let _legacyRegistryChecked = false;

/**
 * Query registry for legacy NSIS PhraseVault installation.
 * Searches all Uninstall keys by Publisher and DisplayName pattern.
 * Returns { installLocation, displayVersion, regPath } or null if not found.
 */
function findLegacyNsisRegistryEntry() {
    // Search all subkeys under Uninstall and filter by Publisher/DisplayName
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
`;

    const result = runPS(script, 8000).trim();

    if (!result) {
        log("No legacy registry entry found via Publisher/DisplayName search");
        return null;
    }

    try {
        const entry = JSON.parse(result);

        if (!entry.DisplayName) {
            return null;
        }

        log(`Found registry entry: "${entry.DisplayName}" v${entry.DisplayVersion} at ${entry.RegPath}`);

        // Must be legacy version
        if (!entry.DisplayVersion || !isVersionLessThanOrEqual(entry.DisplayVersion, LEGACY_MAX_VERSION)) {
            log(`Registry version ${entry.DisplayVersion} > ${LEGACY_MAX_VERSION}, not legacy`);
            return null;
        }

        // Must have InstallLocation
        if (!entry.InstallLocation) {
            log(`No InstallLocation in registry entry`);
            return null;
        }

        // Verify InstallLocation or exe exists on disk
        const exePath = path.join(entry.InstallLocation, APP_EXE);
        if (!fs.existsSync(entry.InstallLocation) && !fs.existsSync(exePath)) {
            log(`InstallLocation not found on disk: ${entry.InstallLocation}`);
            return null;
        }

        return {
            installLocation: entry.InstallLocation,
            displayVersion: entry.DisplayVersion,
            regPath: entry.RegPath,
        };
    } catch (e) {
        log(`Failed to parse registry JSON: ${e?.message}`, "WARN");
        return null;
    }
}

/**
 * Get cached legacy registry info (queries once per run)
 */
function getLegacyRegistryInfo() {
    if (!_legacyRegistryChecked) {
        _legacyRegistryInfo = findLegacyNsisRegistryEntry();
        _legacyRegistryChecked = true;
    }
    return _legacyRegistryInfo;
}

/**
 * Check if exePath is under the given install location
 */
function isUnderInstallLocation(exePath, installLocation) {
    if (!exePath || !installLocation) return false;

    const exeNorm = path.normalize(exePath).toLowerCase();
    // Remove trailing slashes to avoid double-separator issues
    const locNorm = path
        .normalize(installLocation)
        .toLowerCase()
        .replace(/[\\/]+$/, "");

    return exeNorm.startsWith(locNorm + path.sep);
}

const versionCache = new Map(); // lowerExePath -> versionStr|"" (empty means unknown)

function getFileProductVersion(exePath) {
    const key = String(exePath || "").toLowerCase();
    if (!key) return "";
    if (versionCache.has(key)) return versionCache.get(key);

    const out = runPS(
        `
$ErrorActionPreference='SilentlyContinue'
$p='${String(exePath).replace(/'/g, "''")}'
if (Test-Path -LiteralPath $p) {
  try { (Get-Item -LiteralPath $p).VersionInfo.ProductVersion } catch { '' }
} else { '' }
`,
        2500
    ).trim();

    versionCache.set(key, out);
    return out;
}

/**
 * Decide if an exePath is a legacy install and safe to act on.
 *
 * Priority:
 *   1. If registry InstallLocation known -> only match processes under that path
 *   2. Fallback to heuristic (Program Files / Squirrel paths) if registry unavailable
 *
 * Hard excludes:
 *   - Current exe path (never kill ourselves)
 *   - Anything under Velopack path (%LOCALAPPDATA%\PhraseVault\)
 */
function isLegacyExePath(exePath) {
    if (!exePath) {
        log(`[DEBUG] isLegacyExePath: empty path -> false`);
        return false;
    }

    const exe = String(exePath);
    const exeLower = exe.toLowerCase();
    const currentExeLower = String(process.execPath || "").toLowerCase();

    log(`[DEBUG] isLegacyExePath: checking "${exe}"`);
    log(`[DEBUG]   Current exe: "${process.execPath}"`);

    // 1. Never kill ourselves
    if (exeLower === currentExeLower) {
        log(`[DEBUG]   -> false (is current exe)`);
        return false;
    }

    // 2. Never touch Velopack installation
    if (isUnderVelopackPath(exe)) {
        log(`[DEBUG]   -> false (under Velopack path)`);
        return false;
    }

    // 3. If we have registry info, use InstallLocation as authoritative source
    const regInfo = getLegacyRegistryInfo();
    if (regInfo?.installLocation) {
        const isUnder = isUnderInstallLocation(exe, regInfo.installLocation);
        log(`[DEBUG]   Registry InstallLocation: "${regInfo.installLocation}"`);
        log(`[DEBUG]   -> ${isUnder} (under registry InstallLocation)`);
        return isUnder;
    }

    // 4. Fallback: heuristic based on known legacy locations (Squirrel or Program Files)
    const isSquirrel = isSquirrelPath(exe);
    const isProgramFiles = isLikelyProgramFilesPath(exe);
    log(`[DEBUG]   No registry info, using heuristics`);
    log(`[DEBUG]   isSquirrelPath: ${isSquirrel}, isProgramFilesPath: ${isProgramFiles}`);

    if (!isSquirrel && !isProgramFiles) {
        log(`[DEBUG]   -> false (not a known legacy location)`);
        return false;
    }

    // 5. Check version from file - if readable and <= 2.2.1, it's legacy
    const ver = getFileProductVersion(exe);
    log(`[DEBUG]   ProductVersion: "${ver || "(none)"}"`);

    if (ver) {
        const isOld = isVersionLessThanOrEqual(ver, LEGACY_MAX_VERSION);
        log(`[DEBUG]   Version check: ${ver} <= ${LEGACY_MAX_VERSION} ? ${isOld}`);
        return isOld;
    }

    // 6. Version unknown but in legacy location -> treat as legacy (conservative)
    log(`[DEBUG]   -> true (legacy location, version unknown)`);
    return true;
}

function getPhraseVaultProcesses() {
    log("[DEBUG] getPhraseVaultProcesses() called");
    const script = `
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='${APP_EXE}'" |
  Select-Object ProcessId, ExecutablePath, CommandLine |
  ConvertTo-Json -Compress
`;
    log(`[DEBUG] Running PowerShell to find processes...`);
    const json = runPS(script, 5000).trim();

    log(`[DEBUG] PowerShell raw output: ${json ? json.substring(0, 500) : "(empty)"}`);

    if (!json) {
        log("[DEBUG] No JSON returned from PowerShell");
        return [];
    }
    try {
        const parsed = JSON.parse(json);
        const result = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
        log(`[DEBUG] Parsed ${result.length} process(es)`);
        for (const p of result) {
            log(`[DEBUG]   PID=${p?.ProcessId}, ExePath=${p?.ExecutablePath || "(none)"}, CmdLine=${(p?.CommandLine || "(none)").substring(0, 100)}`);
        }
        return result;
    } catch (e) {
        log(`[DEBUG] JSON parse error: ${e?.message}`, "WARN");
        return [];
    }
}

function sleepSync(ms) {
    try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch {}
}

/**
 * Native check if PID is running using process.kill(pid, 0)
 * Signal 0 just checks existence/permissions - much faster than PowerShell
 */
function isPidRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // ESRCH = no such process, EPERM = exists but no permission
        if (e.code === "EPERM") {
            log(`[DEBUG] isPidRunning(${pid}): EPERM - process exists but access denied`, "WARN");
            return true; // It exists, we just can't signal it
        }
        return false; // ESRCH or other = not running
    }
}

/**
 * Native Node.js kill combined with taskkill fallback.
 * Much more reliable and faster than PowerShell.
 */
function forceKillPid(pid) {
    log(`[DEBUG] forceKillPid(${pid}) called`);

    // Check if running first
    const wasRunning = isPidRunning(pid);
    log(`[DEBUG]   isPidRunning before kill: ${wasRunning}`);

    if (!wasRunning) {
        log(`[DEBUG]   PID ${pid} not running, nothing to kill`);
        return true;
    }

    // 1) Try native process.kill (instant, no shell spawn)
    try {
        log(`[DEBUG]   Attempting process.kill(${pid}, "SIGKILL")...`);
        process.kill(pid, "SIGKILL");
        log(`[DEBUG]   process.kill succeeded (no throw)`);
    } catch (e) {
        log(`[DEBUG]   process.kill threw: ${e.code || e.message}`, "WARN");
    }

    // Quick check
    sleepSync(100);
    if (!isPidRunning(pid)) {
        log(`[DEBUG]   PID ${pid} dead after process.kill`);
        return true;
    }
    log(`[DEBUG]   PID ${pid} still running after process.kill`);

    // 2) Fallback to taskkill /F /T (kills tree)
    try {
        log(`[DEBUG]   Falling back to: taskkill /F /T /PID ${pid}`);
        const result = execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
            encoding: "utf8",
            windowsHide: true,
            timeout: 3000,
            stdio: ["ignore", "pipe", "pipe"],
        });
        log(`[DEBUG]   taskkill output: ${(result || "").trim()}`);
    } catch (e) {
        log(`[DEBUG]   taskkill threw: ${e.code || e.message}`, "WARN");
        if (e.stderr) log(`[DEBUG]   taskkill stderr: ${e.stderr}`);
    }

    // 3) Wait up to 2 seconds for OS to release handles
    log(`[DEBUG]   Waiting for PID ${pid} to die...`);
    for (let i = 0; i < 10; i++) {
        if (!isPidRunning(pid)) {
            log(`[DEBUG]   PID ${pid} dead after ${(i + 1) * 200}ms`);
            return true;
        }
        sleepSync(200);
    }

    const stillRunning = isPidRunning(pid);
    log(`[DEBUG]   PID ${pid} final status: ${stillRunning ? "STILL RUNNING" : "dead"}`);
    return !stillRunning;
}

/**
 * Gets legacy processes (filtered for version/path criteria)
 */
function getLegacyProcesses() {
    log("[DEBUG] getLegacyProcesses() called");
    const procs = getPhraseVaultProcesses();
    log(`[DEBUG] Total PhraseVault processes found: ${procs.length}`);

    const legacy = procs.filter((p) => {
        const pid = Number(p?.ProcessId);
        log(`[DEBUG] Checking PID ${pid}...`);

        if (!pid) {
            log(`[DEBUG]   -> Skipped: no PID`);
            return false;
        }
        if (pid === process.pid) {
            log(`[DEBUG]   -> Skipped: is current process (${process.pid})`);
            return false;
        }

        let exePath = (p?.ExecutablePath || "").trim();
        log(`[DEBUG]   ExecutablePath: ${exePath || "(empty)"}`);

        if (!exePath) {
            exePath = extractExeFromCommandLine(p?.CommandLine || "");
            log(`[DEBUG]   Extracted from CommandLine: ${exePath || "(empty)"}`);
        }

        if (!exePath) {
            log(`[DEBUG]   -> Skipped: no path found`);
            return false;
        }

        const isLegacy = isLegacyExePath(exePath);
        log(`[DEBUG]   isLegacyExePath=${isLegacy}`);

        return isLegacy;
    });

    log(`[DEBUG] Legacy processes after filtering: ${legacy.length}`);
    return legacy;
}

/**
 * Kill legacy processes with retry loop.
 * Returns { killed, remainingLegacy }
 */
function killLegacyProcesses() {
    const maxAttempts = 3;
    let totalKilled = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (checkTimeout("kill attempt " + attempt)) {
            break;
        }

        try {
            const legacyProcs = getLegacyProcesses();

            if (legacyProcs.length === 0) {
                log(attempt === 1 ? "No legacy processes found" : "All legacy processes verified dead");
                return { killed: totalKilled, remainingLegacy: 0 };
            }

            log(`Found ${legacyProcs.length} legacy process(es) (attempt ${attempt}/${maxAttempts})`);

            for (const p of legacyProcs) {
                if (checkTimeout("killing PID")) break;

                const pid = Number(p.ProcessId);
                let exePath = (p?.ExecutablePath || "").trim();
                if (!exePath) exePath = extractExeFromCommandLine(p?.CommandLine || "");

                log(`Killing legacy PID ${pid}: ${exePath}`);
                if (forceKillPid(pid)) {
                    totalKilled++;
                }
            }

            // Wait for OS to clean up
            sleepSync(500);
        } catch (e) {
            log(`killLegacyProcesses attempt ${attempt} failed: ${e?.message || e}`, "WARN");
        }
    }

    // Final check
    const remaining = getLegacyProcesses();
    log(`killLegacyProcesses: killed=${totalKilled}, remainingLegacy=${remaining.length}`);
    return { killed: totalKilled, remainingLegacy: remaining.length };
}

function readRunValue(runKey) {
    const val = runPS(
        `
$ErrorActionPreference='SilentlyContinue'
try {
  (Get-ItemProperty -Path '${runKey.replace(/'/g, "''")}' -Name '${RUN_VALUE}' -ErrorAction SilentlyContinue).'${RUN_VALUE}'
} catch { '' }
`,
        2000
    ).trim();
    return val || "";
}

function removeLegacyAutostart() {
    const keys = ["HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"];

    for (const key of keys) {
        try {
            const cmdLine = readRunValue(key);
            if (!cmdLine) continue;

            const exePath = extractExeFromCommandLine(cmdLine);
            if (!exePath) continue;

            if (!isLegacyExePath(exePath)) {
                log(`Keeping autostart (${key}) target not legacy: ${exePath}`);
                continue;
            }

            // Best-effort delete (HKLM may fail without admin; that's fine)
            log(`Removing legacy autostart from ${key}: ${cmdLine}`);
            runExe("reg", ["delete", key.replace("HKCU:\\", "HKCU\\").replace("HKLM:\\", "HKLM\\"), "/v", RUN_VALUE, "/f"], 2000);
        } catch (e) {
            log(`removeLegacyAutostart failed (${key}): ${e?.message || e}`, "WARN");
        }
    }
}

function getKnownFolders() {
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
    ).trim();

    try {
        const obj = json ? JSON.parse(json) : {};
        return {
            Desktop: obj.Desktop || path.join(os.homedir(), "Desktop"),
            Programs: obj.Programs || path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
            CommonDesktop: obj.CommonDesktop || path.join("C:", "Users", "Public", "Desktop"),
            CommonPrograms: obj.CommonPrograms || path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
        };
    } catch {
        return {
            Desktop: path.join(os.homedir(), "Desktop"),
            Programs: path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
            CommonDesktop: path.join("C:", "Users", "Public", "Desktop"),
            CommonPrograms: path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
        };
    }
}

function readShortcutTarget(lnkPath) {
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
    ).trim();
    return out || "";
}

function removeLegacyShortcuts() {
    const f = getKnownFolders();

    const candidates = [
        path.join(f.Desktop, SHORTCUT_NAME),
        path.join(f.Programs, SHORTCUT_NAME),
        path.join(f.CommonDesktop, SHORTCUT_NAME),
        path.join(f.CommonPrograms, SHORTCUT_NAME),

        // common "foldered" start menu layout (safe because we still version-gate)
        path.join(f.Programs, "PhraseVault", SHORTCUT_NAME),
        path.join(f.CommonPrograms, "PhraseVault", SHORTCUT_NAME),
    ];

    for (const lnk of candidates) {
        try {
            if (!lnk || !fs.existsSync(lnk)) continue;

            const target = readShortcutTarget(lnk);
            if (!target) {
                // If we can't read it, do nothing (safe)
                log(`Shortcut target unreadable, keeping: ${lnk}`, "WARN");
                continue;
            }

            if (!isLegacyExePath(target)) {
                log(`Keeping shortcut (not legacy): ${lnk} -> ${target}`);
                continue;
            }

            log(`Removing legacy shortcut: ${lnk} -> ${target}`);
            try {
                fs.unlinkSync(lnk);
            } catch (e) {
                log(`Failed to delete shortcut ${lnk}: ${e?.message || e}`, "WARN");
            }
        } catch (e) {
            log(`removeLegacyShortcuts failed (${lnk}): ${e?.message || e}`, "WARN");
        }
    }
}

/**
 * Write the done flag with metadata for diagnostics
 */
function writeDoneFlag(dir, doneFile, regInfo) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            doneFile,
            JSON.stringify({
                timestamp: new Date().toISOString(),
                cleanedVersion: regInfo?.displayVersion || "unknown",
                installLocation: regInfo?.installLocation || "unknown",
            })
        );
        log(`Done flag written: ${doneFile}`);
    } catch (e) {
        log(`Failed to write done flag: ${e?.message || e}`, "WARN");
    }
}

function uninstallLegacyNsis() {
    try {
        if (process.platform !== "win32") return;

        const base = process.env.LOCALAPPDATA || os.tmpdir();
        const dir = path.join(base, "PhraseVault");
        const doneFile = path.join(dir, "nsis-cleanup.done");

        // 1. Fast exit if already done
        if (fs.existsSync(doneFile)) {
            return;
        }

        // Start timeout tracking
        _cleanupStartTime = Date.now();

        log("=== NSIS Legacy Cleanup ===");
        log(`Current PID ${process.pid}, execPath: ${process.execPath}`);

        // 2. Kill legacy processes FIRST (Critical for DB lock)
        // Do this even if registry is missing - a broken uninstall might have
        // removed keys but left the process running (zombie scenario).
        // isLegacyExePath() will use heuristics (Program Files, Squirrel paths)
        // when registry info is unavailable.
        let killResult = { killed: 0, remainingLegacy: 0 };
        try {
            killResult = killLegacyProcesses();
        } catch (e) {
            log(`killLegacyProcesses crashed: ${e?.message || e}`, "WARN");
        }

        if (checkTimeout("process killing")) {
            writeDoneFlag(dir, doneFile, null);
            return;
        }

        // 3. Check registry for legacy NSIS installation info
        const regInfo = getLegacyRegistryInfo();

        if (checkTimeout("registry lookup")) {
            writeDoneFlag(dir, doneFile, regInfo);
            return;
        }

        if (!regInfo) {
            log("No legacy NSIS registry entry found.");
            if (killResult.killed > 0) {
                log(`Killed ${killResult.killed} legacy process(es) via heuristics.`);
            }
            if (killResult.remainingLegacy > 0) {
                log(`Warning: ${killResult.remainingLegacy} legacy process(es) still running.`, "WARN");
            }
            writeDoneFlag(dir, doneFile, null);
            return;
        }

        log(`Legacy NSIS found: v${regInfo.displayVersion} at "${regInfo.installLocation}"`);

        // 4. Remove shortcuts & registry autostart (best effort, silent)
        try {
            removeLegacyAutostart();
        } catch (e) {
            log(`removeLegacyAutostart crashed: ${e?.message || e}`, "WARN");
        }

        if (checkTimeout("autostart removal")) {
            writeDoneFlag(dir, doneFile, regInfo);
            return;
        }

        try {
            removeLegacyShortcuts();
        } catch (e) {
            log(`removeLegacyShortcuts crashed: ${e?.message || e}`, "WARN");
        }

        // 5. Finalize - leave registry entry for manual uninstall via Settings > Apps
        writeDoneFlag(dir, doneFile, regInfo);

        if (killResult.remainingLegacy > 0) {
            log(`Cleanup complete but ${killResult.remainingLegacy} legacy process(es) still running`, "WARN");
        } else {
            log("Cleanup complete. Registry entry left for manual uninstall.");
        }
    } catch (e) {
        log(`Fatal error in cleanup: ${e?.message || e}`, "ERROR");
    }
}

module.exports = { uninstallLegacyNsis };
