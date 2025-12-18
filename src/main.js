const { app, Menu, globalShortcut, BrowserWindow, ipcMain, clipboard, screen, shell, dialog, nativeTheme } = require("electron");

// Handle Velopack lifecycle events FIRST - before any other code runs
const { VelopackApp } = require("velopack");

VelopackApp.build()
    .onFirstRun((version) => {
        const { uninstallLegacyNsis } = require("./nsis-cleanup.js");
        uninstallLegacyNsis();
    })
    .run();

const { windowManager } = require("node-window-manager");
const { platform } = require("os");
const { createWindow, createTray, updateTitleBarTheme, clearBackendBindings, getIconPath } = require("./window.js");
const path = require("path");
const fs = require("fs");
const state = require("./state.js");
const { initDatabase } = require("./database.js");
const { exec } = require("child_process");
const i18n = require("./i18n.js");
const { availableLanguages } = require("./i18n.js");
const EventEmitter = require("events");
const { marked } = require("marked");
const markedOptions = require("./_partial/_marked-options.js");
const robot = require("@hurdlegroup/robotjs");
const { log } = require("console");

if (process.platform === "win32") {
    app.setAppUserModelId("PhraseVault");
}

class DatabaseEvents extends EventEmitter {}
const databaseEvents = new DatabaseEvents();

let previousWindow;
let mainWindow;
let tray;

global.databaseEvents = databaseEvents;
global.isQuitting = false;

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

function setTheme(theme) {
    nativeTheme.themeSource = theme;
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("set-theme", theme);
    }
    state.setConfig({ theme });
    updateTitleBarTheme(theme);
}

function setLanguage(lng) {
    state.setConfig({ language: lng });
    state.setConfig({ showOnStartup: true });
    app.relaunch();
    app.exit();
}

function setAutoLaunch(enabled) {
    if (process.platform !== "win32" || !app.isPackaged) return;

    // Velopack keeps exe at stable location: {root}/current/PhraseVault.exe
    app.setLoginItemSettings({
        openAtLogin: enabled,
        enabled: enabled,
        path: process.execPath,
        args: ["--launched-at-login", "--hidden"],
    });
}

/**
 * Sync autostart setting: ensure the actual system login item matches config.
 * This handles migration from NSIS to Squirrel where the mechanism changed.
 */
function syncAutostart() {
    const config = state.getConfig();
    const actuallyEnabled = isAutoLaunchEnabled();

    // If config and system state don't match, sync system to match config
    if (config.autostart && !actuallyEnabled) {
        console.log("Syncing autostart: enabling login item to match config");
        setAutoLaunch(true);
    } else if (!config.autostart && actuallyEnabled) {
        console.log("Syncing autostart: disabling login item to match config");
        setAutoLaunch(false);
    }
}

function isAutoLaunchEnabled() {
    if (process.platform !== "win32" || !app.isPackaged) return false;

    return app.getLoginItemSettings({
        path: process.execPath,
        args: ["--launched-at-login", "--hidden"],
    }).openAtLogin;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on("second-instance", (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        const config = state.getConfig();
        let languageToUse = config.language;

        // Sync autostart on first run after NSIS->Squirrel migration
        syncAutostart();

        windowManager.requestAccessibility();

        if (!languageToUse || typeof languageToUse !== "string") {
            const { osLocaleSync } = require("os-locale");
            const systemLocale = osLocaleSync();
            const systemLanguage = systemLocale.split("-")[0].toLowerCase();

            if (availableLanguages.includes(systemLanguage)) {
                languageToUse = systemLanguage;
            } else {
                languageToUse = "en";
            }

            state.setConfig({ language: languageToUse });
        }

        i18n.changeLanguage(languageToUse);

        // Initialize database AFTER language is set so example phrases use correct translations
        initDatabase();

        mainWindow = createWindow();
        tray = createTray();

        mainWindow.webContents.on("did-finish-load", () => {
            setTheme(config.theme);
            mainWindow.webContents.send("change-language", languageToUse);

            // Show license agreement first if not accepted
            if (state.shouldShowLicenseAgreement()) {
                mainWindow.webContents.send("show-license-agreement");
            } else if (state.shouldShowPurchaseReminder()) {
                mainWindow.webContents.send("show-purchase-reminder");
            }
        });

        if (process?.env?.NODE_ENV?.trim() === "development") {
            console.log("Development mode enabled. Registering global shortcuts...");
            globalShortcut.register("CommandOrControl+Shift+I", () => {
                mainWindow.webContents.toggleDevTools();
            });
        }

        globalShortcut.register("CommandOrControl+.", () => {
            const previousWindowCandidate = windowManager.getActiveWindow();
            if (previousWindowCandidate && previousWindowCandidate.path) {
                const normalizedPath = path.normalize(previousWindowCandidate.path);
                const pathParts = normalizedPath.split(path.sep);
                const filename = pathParts[pathParts.length - 1].toLowerCase();

                const isPhraseVaultExecutable = filename === "phrasevault.exe";
                const isLocalElectronExecutable = normalizedPath.toLowerCase().includes(path.join("phrasevault-electron", "node_modules", "electron", "dist", "electron.exe"));

                if (!isPhraseVaultExecutable && !isLocalElectronExecutable) {
                    previousWindow = previousWindowCandidate;
                }
            }

            if (previousWindow) {
                const bounds = previousWindow.getBounds();
                const display = screen.getDisplayMatching(bounds);

                let { width, height } = mainWindow.getBounds();
                const maxWidth = display.bounds.width * 0.9;
                const maxHeight = display.bounds.height * 0.9;

                if (width > maxWidth) {
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    height = maxHeight;
                }

                const x = display.bounds.x + (display.bounds.width - width) / 2;
                const y = display.bounds.y + (display.bounds.height - height) / 2;

                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                }

                mainWindow.setBounds({ x, y, width, height });
            } else {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                }
                mainWindow.center();
            }
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("focus-search");
        });

        mainWindow.webContents.on("before-input-event", (event, input) => {
            if (input.key === "Escape" && input.type === "keyUp") {
                event.preventDefault();
                mainWindow.webContents.send("handle-escape");
            }
        });

        ipcMain.on("minimize-window", () => {
            mainWindow.hide();
            if (tray && !state.getBalloonShown()) {
                tray.displayBalloon({
                    icon: getIconPath(),
                    title: "PhraseVault",
                    content: i18n.t("PhraseVault is running in the background."),
                });
                state.setBalloonShown(true);
            }
            if (previousWindow) {
                previousWindow.bringToTop();
            }
        });

        // Minimal menu for keyboard shortcuts only (no visible menu bar)
        const minimalMenu = Menu.buildFromTemplate([
            {
                label: "Edit",
                submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
            },
        ]);
        Menu.setApplicationMenu(minimalMenu);

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
        });

        databaseEvents.on("insert-text", async (event, phrase) => {
            mainWindow.hide();
            if (previousWindow) {
                previousWindow.bringToTop();
            }

            let originalClipboardContent;
            let originalHtmlContent;
            try {
                originalClipboardContent = clipboard.readText();
                originalHtmlContent = clipboard.readHTML();
            } catch (error) {
                console.error("Failed to read clipboard content:", error);
                originalClipboardContent = "";
                originalHtmlContent = "";
            }

            try {
                if (phrase.type === "markdown" || phrase.type === "mdwysiwyg") {
                    marked.setOptions(markedOptions);
                    let htmlText = marked(phrase.expanded_text);

                    clipboard.write({
                        text: phrase.expanded_text,
                        html: htmlText,
                    });
                } else if (phrase.type === "html") {
                    clipboard.write({
                        text: phrase.expanded_text,
                        html: phrase.expanded_text,
                    });
                } else {
                    clipboard.writeText(phrase.expanded_text);
                }
            } catch (error) {
                console.error("Failed to write to clipboard:", error);
                return;
            }

            try {
                setTimeout(() => {
                    const pasteModifier = platform() === "darwin" ? ["command"] : ["control"];
                    robot.keyTap("v", pasteModifier);
                    ipcMain.emit("increment-usage", event, phrase.id);

                    setTimeout(() => {
                        try {
                            clipboard.write({
                                text: originalClipboardContent,
                                html: originalHtmlContent,
                            });
                        } catch (error) {
                            console.error("Failed to restore original clipboard content:", error);
                        }
                    }, 100);
                }, 100);
            } catch (error) {
                console.error("Failed to simulate paste command:", error);
            }
        });
    });

    databaseEvents.on("database-status", (statusData) => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send("database-status", statusData);
        }
    });

    databaseEvents.on("toast-message", (message) => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send("toast-message", message);
        }
    });

    // =============================================================================
    // Settings IPC Handlers
    // =============================================================================

    ipcMain.on("get-theme", (event) => {
        event.returnValue = state.getConfig().theme;
    });

    ipcMain.on("get-language", (event) => {
        event.returnValue = state.getConfig().language || "en";
    });

    ipcMain.on("set-theme", (event, theme) => {
        setTheme(theme);
    });

    ipcMain.on("copy-to-clipboard", (event, phrase) => {
        try {
            if (phrase.type === "markdown" || phrase.type === "mdwysiwyg") {
                marked.setOptions(markedOptions);
                const htmlText = marked(phrase.expanded_text);
                clipboard.write({
                    text: phrase.expanded_text,
                    html: htmlText,
                });
            } else if (phrase.type === "html") {
                clipboard.write({
                    text: phrase.expanded_text,
                    html: phrase.expanded_text,
                });
            } else {
                clipboard.writeText(phrase.expanded_text);
            }
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
        }
    });

    ipcMain.on("get-settings", (event) => {
        const config = state.getConfig();
        event.sender.send("init-settings", {
            theme: config.theme || "system",
            language: config.language || "en",
            autostart: config.autostart ?? true,
            purchased: config.purchased || false,
            version: app.getVersion(),
            platform: process.platform,
        });
    });

    ipcMain.on("set-language", (event, lng) => {
        setLanguage(lng);
    });

    ipcMain.on("set-autostart", (event, enabled) => {
        state.setConfig({ autostart: enabled });
        setAutoLaunch(enabled);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send("toast-message", {
                type: "success",
                message: enabled ? i18n.t("Autostart enabled") : i18n.t("Autostart disabled"),
            });
        }
    });

    ipcMain.on("new-database", () => {
        const options = {
            title: i18n.t("Create New Database"),
            defaultPath: "phrasevault.sqlite",
            buttonLabel: i18n.t("Create"),
            filters: [{ name: "SQLite Database", extensions: ["sqlite"] }],
        };

        dialog
            .showSaveDialog(mainWindow, options)
            .then((result) => {
                if (!result.canceled && result.filePath) {
                    const newDbPath = result.filePath.endsWith(".sqlite") ? result.filePath : result.filePath + ".sqlite";
                    fs.writeFileSync(newDbPath, "");
                    state.setConfig({ dbPath: newDbPath });
                    state.setConfig({ showOnStartup: true });
                    state.setConfig({ initializeTables: true });
                    state.addRecentFile(newDbPath);
                    app.relaunch();
                    app.exit();
                }
            })
            .catch((err) => {
                console.error("Failed to create new database:", err);
            });
    });

    ipcMain.on("open-database", () => {
        const options = {
            title: i18n.t("Open Database"),
            buttonLabel: i18n.t("Open"),
            filters: [{ name: "SQLite Database", extensions: ["sqlite"] }],
            properties: ["openFile"],
        };

        dialog
            .showOpenDialog(mainWindow, options)
            .then((result) => {
                if (!result.canceled && result.filePaths.length > 0) {
                    const selectedPath = result.filePaths[0];
                    state.setConfig({ dbPath: selectedPath });
                    state.setConfig({ showOnStartup: true });
                    state.addRecentFile(selectedPath);
                    app.relaunch();
                    app.exit();
                }
            })
            .catch((err) => {
                console.error("Failed to open database:", err);
            });
    });

    ipcMain.on("open-recent-database", (event, filePath) => {
        state.setConfig({ dbPath: filePath });
        state.setConfig({ showOnStartup: true });
        state.addRecentFile(filePath);
        app.relaunch();
        app.exit();
    });

    ipcMain.on("get-recent-databases", (event) => {
        const config = state.getConfig();
        event.sender.send("recent-databases", config.recentFiles || []);
    });

    ipcMain.on("show-database", () => {
        const dbPath = state.getConfig().dbPath;
        if (fs.existsSync(dbPath)) {
            shell.showItemInFolder(dbPath);
        } else if (fs.existsSync(path.dirname(dbPath))) {
            shell.openPath(path.dirname(dbPath));
        } else {
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send("toast-message", {
                    type: "danger",
                    message: i18n.t("Neither the database file nor the folder exists."),
                });
            }
        }
    });

    ipcMain.on("confirm-purchase", () => {
        const response = dialog.showMessageBoxSync(mainWindow, {
            type: "question",
            buttons: [i18n.t("I have purchased a license"), i18n.t("No")],
            cancelId: 1,
            noLink: true,
            title: i18n.t("Confirm Purchase"),
            message: i18n.t("Developing and maintaining PhraseVault takes time and effort. Please consider supporting the project by purchasing a license. We trust you to be honest. Thank you!"),
        });

        if (response === 0) {
            state.setConfig({ purchased: true });
            state.setConfig({ showOnStartup: true });
            app.relaunch();
            app.exit();
        } else {
            shell.openExternal("https://phrasevault.app/pricing");
        }
    });

    ipcMain.on("open-external-url", (event, url) => {
        shell.openExternal(url);
    });

    ipcMain.on("read-markdown-file", (event, filename) => {
        const markdownPath = path.join(__dirname, "..", "templates", "markdown", filename);
        try {
            if (fs.existsSync(markdownPath)) {
                const content = fs.readFileSync(markdownPath, "utf-8");
                marked.setOptions(markedOptions);
                const htmlContent = marked(content);
                event.sender.send("markdown-content", { success: true, html: htmlContent, filename });
            } else {
                event.sender.send("markdown-content", { success: false, error: "File not found" });
            }
        } catch (error) {
            console.error("Failed to read markdown file:", error);
            event.sender.send("markdown-content", { success: false, error: error.message });
        }
    });

    ipcMain.on("render-markdown", (event, content) => {
        try {
            marked.setOptions(markedOptions);
            const htmlContent = marked(content);
            event.sender.send("markdown-content", { success: true, html: htmlContent });
        } catch (error) {
            console.error("Failed to render markdown:", error);
            event.sender.send("markdown-content", { success: false, error: error.message });
        }
    });

    ipcMain.on("accept-license", () => {
        state.acceptLicenseAgreement();
        // Check if we should show purchase reminder after accepting license
        if (state.shouldShowPurchaseReminder() && mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send("show-purchase-reminder");
        }
    });

    ipcMain.on("decline-license", () => {
        app.quit();
    });

    ipcMain.on("mark-as-purchased", () => {
        state.markAsPurchased();
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send("toast-message", {
                type: "success",
                message: i18n.t("Purchase activated successfully. App will restart."),
            });
        }
        setTimeout(() => {
            state.setConfig({ showOnStartup: true });
            app.relaunch();
            app.exit();
        }, 1500);
    });

    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        } else {
            clearBackendBindings();
        }
    });
}
