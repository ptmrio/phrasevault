const WinReg = require("winreg");

/**
 * Promisified helper to get registry subkeys
 */
function getRegistryKeys(regKey) {
    return new Promise((resolve, reject) => {
        regKey.keys((err, items) => {
            if (err) reject(err);
            else resolve(items || []);
        });
    });
}

/**
 * Promisified helper to get a registry value
 */
function getRegistryValue(regKey, name) {
    return new Promise((resolve, reject) => {
        regKey.get(name, (err, item) => {
            if (err)
                resolve(null); // Value doesn't exist
            else resolve(item);
        });
    });
}

/**
 * Checks a single registry hive for old NSIS installations
 * @param {string} hive - WinReg.HKLM or WinReg.HKCU
 * @param {string} nsisTransitionVersion - Version threshold
 * @returns {Promise<{uninstallString: string, version: string, hive: string} | null>}
 */
async function findOldInstallInHive(hive, nsisTransitionVersion) {
    const uninstallKey = new WinReg({
        hive: hive,
        key: "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    });

    try {
        const subkeys = await getRegistryKeys(uninstallKey);

        for (const subkey of subkeys) {
            try {
                const displayNameVal = await getRegistryValue(subkey, "DisplayName");
                if (!displayNameVal || !displayNameVal.value.startsWith("PhraseVault")) {
                    continue;
                }

                const displayVersionVal = await getRegistryValue(subkey, "DisplayVersion");
                if (!displayVersionVal?.value) {
                    continue;
                }

                const installedVersion = displayVersionVal.value;

                if (isVersionLessThan(installedVersion, nsisTransitionVersion)) {
                    const uninstallCmd = await getRegistryValue(subkey, "UninstallString");
                    if (uninstallCmd?.value) {
                        return {
                            uninstallString: uninstallCmd.value,
                            version: installedVersion,
                            hive: hive === WinReg.HKLM ? "HKLM" : "HKCU",
                        };
                    }
                }
            } catch (err) {
                // Ignore individual subkey errors
            }
        }
    } catch (err) {
        console.error(`Error scanning ${hive} registry:`, err);
    }

    return null;
}

/**
 * Checks for an old NSIS installation of PhraseVault and notifies renderer to show prompt.
 * @param {BrowserWindow} mainWindow - The main application window
 */
async function checkAndPromptForOldVersionUninstall(mainWindow) {
    const nsisTransitionVersion = "2.2.2";

    // Check both per-machine (HKLM) and per-user (HKCU) installations
    const hivesToCheck = [WinReg.HKLM, WinReg.HKCU];
    let oldInstall = null;

    for (const hive of hivesToCheck) {
        oldInstall = await findOldInstallInHive(hive, nsisTransitionVersion);
        console.log("NSIS check in hive", hive, "result:", oldInstall);
        if (oldInstall) break;
    }

    if (!oldInstall) {
        return;
    }

    // Send to renderer to show modal
    mainWindow.webContents.send("show-nsis-uninstall-prompt", {
        version: oldInstall.version,
        uninstallString: oldInstall.uninstallString,
    });
}

module.exports = { checkAndPromptForOldVersionUninstall };

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
