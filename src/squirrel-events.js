const { spawn, spawnSync, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Handle Squirrel.Windows lifecycle events
 * @returns {boolean} true if Squirrel event was handled (app should quit)
 */
function handleSquirrelEvents() {
    if (process.platform !== "win32") return false;

    logSquirrelEvent(`process.argv: ${JSON.stringify(process.argv)}`);

    const squirrelEvent = process.argv.find((arg) => arg.startsWith("--squirrel-"));
    if (!squirrelEvent) {
        return false;
    }

    logSquirrelEvent(`Squirrel event detected: ${squirrelEvent}`);

    // --squirrel-firstrun is NOT a lifecycle event - app should start normally
    if (squirrelEvent === "--squirrel-firstrun") {
        logSquirrelEvent("First run after install - continuing normal startup");
        return false;
    }

    const appFolder = path.dirname(process.execPath);
    const rootFolder = path.resolve(appFolder, "..");
    const updateExe = path.resolve(rootFolder, "Update.exe");
    const exeName = path.basename(process.execPath);

    logSquirrelEvent(`appFolder: ${appFolder}`);
    logSquirrelEvent(`updateExe: ${updateExe}`);
    logSquirrelEvent(`exeName: ${exeName}`);

    const spawnUpdate = (args) => {
        try {
            logSquirrelEvent(`Spawning Update.exe with args: ${JSON.stringify(args)}`);
            spawn(updateExe, args, { detached: true, stdio: "ignore" });
        } catch (e) {
            logSquirrelError(`spawn Update.exe failed: ${e.message}`);
        }
    };

    switch (squirrelEvent) {
        case "--squirrel-install":
            logSquirrelEvent("Handling --squirrel-install");
            uninstallLegacyNsis();
            spawnUpdate(["--createShortcut", exeName]);
            break;

        case "--squirrel-updated":
            logSquirrelEvent("Handling --squirrel-updated");
            spawnUpdate(["--createShortcut", exeName]);
            break;

        case "--squirrel-uninstall":
            logSquirrelEvent("Handling --squirrel-uninstall");
            spawnUpdate(["--removeShortcut", exeName]);
            break;

        case "--squirrel-obsolete":
            logSquirrelEvent("Handling --squirrel-obsolete");
            break;

        default:
            logSquirrelEvent(`Unknown squirrel event: ${squirrelEvent}`);
            return false;
    }

    setTimeout(() => process.exit(0), 1000);
    return true;
}

/**
 * Execute a reg query command with UTF-8 codepage to handle special characters
 * @param {string} command - The reg query command (without 'reg query' prefix)
 * @param {object} options - execSync options
 * @returns {string} Command output
 */
function execRegQuery(command, options = {}) {
    // Prefix with chcp 65001 to set UTF-8 codepage before running reg query
    // This fixes encoding issues with usernames containing special characters (ö, ü, etc.)
    const fullCommand = `cmd /c chcp 65001>nul && reg query ${command}`;
    return execSync(fullCommand, { encoding: "utf8", windowsHide: true, ...options });
}

/**
 * Extract executable path from an uninstall command string
 * @param {string} cmdLine - The uninstall command line
 * @returns {string|null} The extracted path or null
 */
function extractPathFromCmd(cmdLine) {
    if (!cmdLine) return null;

    // Handle quoted paths: "C:\path\to\uninstaller.exe" /args
    if (cmdLine.startsWith('"')) {
        const closeQuoteIdx = cmdLine.indexOf('"', 1);
        if (closeQuoteIdx > 0) {
            return cmdLine.substring(1, closeQuoteIdx);
        }
    }

    // Handle unquoted paths: C:\path\to\uninstaller.exe /args
    const spaceIdx = cmdLine.indexOf(" ");
    if (spaceIdx > 0) {
        return cmdLine.substring(0, spaceIdx);
    }

    return cmdLine;
}

/**
 * Attempt to repair a corrupted path by substituting the user profile portion
 * with the correctly-encoded os.homedir() value
 * @param {string} corruptedPath - Path that may have encoding issues
 * @returns {string} Repaired path or original if repair not possible
 */
function repairUserPath(corruptedPath) {
    if (!corruptedPath) return corruptedPath;

    const homeDir = os.homedir(); // Always correctly encoded

    // Match paths like C:\Users\SomeName\...
    const userPathMatch = corruptedPath.match(/^([A-Za-z]:\\Users\\)([^\\]+)(\\.*)?$/i);
    if (!userPathMatch) {
        return corruptedPath; // Not a user path, return as-is
    }

    const [, prefix, username, suffix] = userPathMatch;
    const repairedPath = homeDir + (suffix || "");

    logSquirrelEvent(`Path repair attempt: "${corruptedPath}" -> "${repairedPath}"`);

    return repairedPath;
}

/**
 * Repair a full command line by fixing the executable path
 * @param {string} cmdLine - Original command line
 * @returns {string} Repaired command line
 */
function repairCommandPath(cmdLine) {
    if (!cmdLine) return cmdLine;

    const originalPath = extractPathFromCmd(cmdLine);
    if (!originalPath) return cmdLine;

    // Check if original path exists - if so, no repair needed
    if (fs.existsSync(originalPath)) {
        logSquirrelEvent(`Path exists, no repair needed: ${originalPath}`);
        return cmdLine;
    }

    logSquirrelEvent(`Path not found: ${originalPath}`);

    // Attempt repair
    const repairedPath = repairUserPath(originalPath);
    if (repairedPath === originalPath) {
        return cmdLine; // No repair was possible
    }

    // Verify repaired path exists
    if (!fs.existsSync(repairedPath)) {
        logSquirrelEvent(`Repaired path also not found: ${repairedPath}`);
        return cmdLine; // Repair didn't help
    }

    logSquirrelEvent(`Path repair successful: ${repairedPath}`);

    // Replace the path in the command line
    if (cmdLine.startsWith('"')) {
        return cmdLine.replace(`"${originalPath}"`, `"${repairedPath}"`);
    } else {
        return cmdLine.replace(originalPath, repairedPath);
    }
}

/**
 * Synchronously query registry for PhraseVault NSIS installation
 */
function findNsisUninstallSync(maxVersion) {
    for (const hive of ["HKLM", "HKCU"]) {
        try {
            const regPath = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall`;
            logSquirrelEvent(`Searching registry: ${regPath}`);

            let output;
            try {
                // We search for "PhraseVault" within the Uninstall keys
                output = execRegQuery(`"${regPath}" /s /f "PhraseVault" /d`, { timeout: 5000 });
            } catch (execErr) {
                logSquirrelEvent(`No PhraseVault found in ${hive}: ${execErr.message}`);
                continue;
            }

            // 1. Collect ALL keys found first
            const lines = output.split(/\r?\n/);
            const foundKeys = [];

            for (const line of lines) {
                const trimmed = line.trim();
                // Regex to find lines starting with HKEY_
                if (trimmed.match(/^HKEY_(LOCAL_MACHINE|CURRENT_USER)\\/i)) {
                    foundKeys.push(trimmed);
                }
            }

            if (foundKeys.length === 0) {
                logSquirrelEvent(`No key path found in ${hive}`);
                continue;
            }

            logSquirrelEvent(`Found ${foundKeys.length} potential registry keys in ${hive}`);

            // 2. Iterate through EVERY key found to check versions
            for (const currentKeyPath of foundKeys) {
                logSquirrelEvent(`Checking key: ${currentKeyPath}`);

                // Get DisplayVersion
                let versionOutput;
                try {
                    versionOutput = execRegQuery(`"${currentKeyPath}" /v DisplayVersion`, { timeout: 2000 });
                } catch (e) {
                    logSquirrelEvent(`No DisplayVersion in ${currentKeyPath} - skipping`);
                    continue;
                }

                const versionMatch = versionOutput.match(/DisplayVersion\s+REG_SZ\s+(\S+)/i);
                if (!versionMatch) {
                    logSquirrelEvent(`Could not parse DisplayVersion from: ${versionOutput}`);
                    continue;
                }

                const installedVersion = versionMatch[1];
                logSquirrelEvent(`Found installed version: ${installedVersion}`);

                // Check if this specific key is the OLD version
                if (!isVersionLessThan(installedVersion, maxVersion)) {
                    logSquirrelEvent(`Version ${installedVersion} >= ${maxVersion}, skipping this key`);
                    continue;
                }

                logSquirrelEvent(`Version ${installedVersion} < ${maxVersion}, valid candidate for uninstall`);

                // 3. We found a target! Get the uninstall string.
                let uninstallCmd = null;
                let isQuiet = false;

                // Try QuietUninstallString first
                try {
                    const quietOutput = execRegQuery(`"${currentKeyPath}" /v QuietUninstallString`, { timeout: 2000 });
                    const quietMatch = quietOutput.match(/QuietUninstallString\s+REG_SZ\s+(.+)/i);
                    if (quietMatch) {
                        uninstallCmd = quietMatch[1].trim();
                        isQuiet = true;
                        logSquirrelEvent(`Found QuietUninstallString: ${uninstallCmd}`);
                    }
                } catch (e) {
                    // Ignore missing Quiet string
                }

                // Fallback to UninstallString
                if (!uninstallCmd) {
                    try {
                        const uninstallOutput = execRegQuery(`"${currentKeyPath}" /v UninstallString`, { timeout: 2000 });
                        const uninstallMatch = uninstallOutput.match(/UninstallString\s+REG_SZ\s+(.+)/i);
                        if (uninstallMatch) {
                            uninstallCmd = uninstallMatch[1].trim();
                            logSquirrelEvent(`Found UninstallString: ${uninstallCmd}`);
                        }
                    } catch (e) {
                        logSquirrelEvent(`No UninstallString in ${currentKeyPath}`);
                        continue;
                    }
                }

                if (uninstallCmd) {
                    // Return immediately upon finding the first valid old version
                    return { cmd: uninstallCmd, isQuiet: isQuiet };
                }
            } // End of key loop
        } catch (e) {
            logSquirrelError(`Error searching ${hive}: ${e.message}\n${e.stack}`);
        }
    }
    return null;
}

/**
 * Synchronously find and run NSIS uninstaller
 */
function uninstallLegacyNsis() {
    const nsisTransitionVersion = "2.2.2";
    logSquirrelEvent(`Looking for NSIS versions < ${nsisTransitionVersion}`);

    try {
        const uninstallInfo = findNsisUninstallSync(nsisTransitionVersion);
        if (uninstallInfo) {
            let cmdLine = uninstallInfo.cmd;

            // Attempt to repair path encoding issues before execution
            cmdLine = repairCommandPath(cmdLine);

            // Only add /S if not using QuietUninstallString
            if (!uninstallInfo.isQuiet) {
                // Check if command is quoted
                if (cmdLine.startsWith('"')) {
                    // Find the closing quote and append /S after it
                    const closeQuoteIdx = cmdLine.indexOf('"', 1);
                    if (closeQuoteIdx > 0) {
                        cmdLine = cmdLine + " /S";
                    }
                } else {
                    cmdLine = cmdLine + " /S";
                }
            }

            logSquirrelEvent(`Executing uninstall command: ${cmdLine}`);

            try {
                // execSync automatically handles the shell command string parsing
                // which resolves the quoting issues with cmd.exe
                execSync(cmdLine, {
                    timeout: 10000,
                    windowsHide: true,
                    stdio: "ignore", // We ignore stdio to prevent buffer overflows, or use 'inherit'
                });
                logSquirrelEvent("Legacy NSIS uninstall completed");
            } catch (err) {
                // execSync throws an error if exit code is not 0
                logSquirrelError(`Uninstall failed or cancelled: ${err.message}`);
                if (err.stderr) {
                    logSquirrelError(`Stderr: ${err.stderr.toString()}`);
                }
            }
        } else {
            logSquirrelEvent("No legacy NSIS installation found");
        }
    } catch (err) {
        logSquirrelError(`NSIS uninstall failed: ${err.message}\n${err.stack}`);
    }
}

function isVersionLessThan(versionA, versionB) {
    const partsA = versionA.split(".").map(Number);
    const partsB = versionB.split(".").map(Number);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const a = partsA[i] || 0;
        const b = partsB[i] || 0;
        if (a < b) return true;
        if (a > b) return false;
    }
    return false;
}

function logSquirrelEvent(message) {
    const logPath = path.join(os.tmpdir(), "phrasevault-squirrel.log");
    const entry = `${new Date().toISOString()} [INFO] ${message}\n`;
    try {
        fs.appendFileSync(logPath, entry);
    } catch (e) {}
}

function logSquirrelError(message) {
    const logPath = path.join(os.tmpdir(), "phrasevault-squirrel.log");
    const entry = `${new Date().toISOString()} [ERROR] ${message}\n`;
    try {
        fs.appendFileSync(logPath, entry);
    } catch (e) {}
}

module.exports = { handleSquirrelEvents };
