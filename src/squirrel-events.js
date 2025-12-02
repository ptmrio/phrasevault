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
                output = execSync(
                    `reg query "${regPath}" /s /f "PhraseVault" /d`,
                    { encoding: "utf8", timeout: 5000, windowsHide: true }
                );
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
                    versionOutput = execSync(
                        `reg query "${currentKeyPath}" /v DisplayVersion`,
                        { encoding: "utf8", timeout: 2000, windowsHide: true }
                    );
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
                    const quietOutput = execSync(
                        `reg query "${currentKeyPath}" /v QuietUninstallString`,
                        { encoding: "utf8", timeout: 2000, windowsHide: true }
                    );
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
                        const uninstallOutput = execSync(
                            `reg query "${currentKeyPath}" /v UninstallString`,
                            { encoding: "utf8", timeout: 2000, windowsHide: true }
                        );
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
                    stdio: "ignore" // We ignore stdio to prevent buffer overflows, or use 'inherit'
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
