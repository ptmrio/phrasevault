import { app, Menu, globalShortcut, BrowserWindow, ipcMain, clipboard, screen } from "electron";
import { windowManager } from "node-window-manager";
import { platform } from "os";
import { createWindow, createTray } from "./window.js";
import path from "path";
import state from "./state.js";
import db from "./database.js";
import { exec } from "child_process";
import { createTemplate } from "./menu.js";
import i18n, { availableLanguages } from "./i18n.js";
import EventEmitter from "events";
import { fileURLToPath } from "url";
import { marked } from "marked";
import markedOptions from "./_partial/_marked-options.js";
import robot from "robotjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("set-theme", theme);
    }
    state.setConfig({ theme });
}

function setLanguage(lng) {
    state.setConfig({ language: lng });
    state.setConfig({ showOnStartup: true });
    app.relaunch();
    app.exit();
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

        if (!languageToUse || typeof languageToUse !== "string") {
            const { osLocaleSync } = await import("os-locale");
            const systemLocale = osLocaleSync();
            const systemLanguage = systemLocale.split("-")[0].toLowerCase();

            if (availableLanguages.includes(systemLanguage)) {
                languageToUse = systemLanguage;
            } else {
                languageToUse = "en";
            }

            state.setConfig({ language: languageToUse });
        }

        // Update the i18n language setting
        i18n.changeLanguage(languageToUse);

        mainWindow = createWindow();
        tray = createTray();

        // send change language to renderer
        mainWindow.webContents.on("did-finish-load", () => {
            setTheme(config.theme);
            mainWindow.webContents.send("change-language", config.language);
        });

        if (process.env.NODE_ENV.trim() === "development") {
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
                    console.log("New previous window:");
                    previousWindow = previousWindowCandidate;
                }
                else {
                    console.log("Ignoring previous window as phrasevault or electron executable");
                }
            }

            if (previousWindow) {
                const bounds = previousWindow.getBounds();
                const display = screen.getDisplayMatching(bounds);

                let { width, height } = mainWindow.getBounds();
                const maxWidth = display.bounds.width * 0.9; // Use 90% of the display width
                const maxHeight = display.bounds.height * 0.9; // Use 90% of the display height

                // Adjust the size if necessary
                if (width > maxWidth) {
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    height = maxHeight;
                }

                const x = display.bounds.x + (display.bounds.width - width) / 2;
                const y = display.bounds.y + (display.bounds.height - height) / 2;

                // Ensure window is not maximized before setting bounds
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                }

                mainWindow.setBounds({ x, y, width, height });
            } else {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                }
                mainWindow.center(); // Center on the primary display if no previous window is found
            }
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("focus-search");
        });

        mainWindow.webContents.on("before-input-event", (event, input) => {
            if (input.key === "Escape" && input.type === "keyUp") {
                event.preventDefault(); // todo: might not be necessary or be counterproductive
                mainWindow.webContents.send("handle-escape");
            }
        });

        ipcMain.on("minimize-window", () => {
            mainWindow.hide();
            if (tray && !state.getBalloonShown()) {
                tray.displayBalloon({
                    icon: path.join(__dirname, "../assets/img/tray_icon.png"),
                    title: "PhraseVault",
                    content: "PhraseVault is running in the background.",
                });
                state.setBalloonShown(true);
            }
            if (previousWindow) {
                previousWindow.bringToTop();
            }
        });

        const menu = Menu.buildFromTemplate(createTemplate(mainWindow, setTheme, setLanguage));
        Menu.setApplicationMenu(menu);

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
                    }, 50);
                }, 50);
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

    ipcMain.on("get-theme", (event) => {
        event.returnValue = state.getConfig().theme;
    });

    ipcMain.on("set-theme", (event, theme) => {
        setTheme(theme);
    });

    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        } else {
            backend.clearMainBindings(ipcMain);
        }
    });
}
