const { BrowserWindow, app, Tray, Menu, ipcMain, nativeTheme } = require("electron");
const backend = require("i18next-electron-fs-backend");
const path = require("path");
const fs = require("fs");
const state = require("./state.js");
const i18n = require("./i18n.js");

let mainWindow;
let tray = null;

let secondaryColor = {
    light: {
        color: "hsl(212, 15%, 99%)",
        symbolColor: "hsl(212, 15%, 17%)",
    },
    dark: {
        color: "hsl(212, 15%, 17%)",
        symbolColor: "hsl(212, 15%, 92%)",
    },
};

let theme = state.getConfig().theme;
let isDark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);

const isMac = process.platform === "darwin";

function getIconPath() {
    return path.join(__dirname, "../assets/img", isMac ? "icon_256x256.png" : "icon.ico");
}

function getTrayIconPath() {
    return path.join(__dirname, "../assets/img", isMac ? "icon_16x16.png" : "tray.ico");
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        icon: getIconPath(),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
            sandbox: false,
        },
        titleBarStyle: isMac ? "hiddenInset" : "hidden",
        ...(isMac
            ? {
                  trafficLightPosition: { x: 12, y: 10 },
              }
            : {
                  titleBarOverlay: {
                      color: isDark ? secondaryColor.dark.color : secondaryColor.light.color,
                      symbolColor: isDark ? secondaryColor.dark.symbolColor : secondaryColor.light.symbolColor,
                      height: 32,
                  },
              }),
    });

    nativeTheme.themeSource = state.getConfig().theme;

    // Update title bar overlay colors when theme changes
    nativeTheme.on("updated", () => {
        if (!isMac && mainWindow && !mainWindow.isDestroyed()) {
            const isDark = nativeTheme.shouldUseDarkColors;
            mainWindow.setTitleBarOverlay({
                color: isDark ? secondaryColor.dark.color : secondaryColor.light.color,
                symbolColor: isDark ? secondaryColor.dark.symbolColor : secondaryColor.light.symbolColor,
            });
        }
    });

    backend.mainBindings(ipcMain, mainWindow, fs);

    mainWindow.loadFile(path.join(__dirname, "..", "templates", "index.html"));

    mainWindow.once("ready-to-show", () => {
        if (state.getConfig().showOnStartup === true) {
            mainWindow.show();
            state.setConfig({ showOnStartup: false });
        } else {
            mainWindow.hide();
        }
        if (tray && !state.getBalloonShown()) {
            tray.displayBalloon({
                icon: getIconPath(),
                title: "PhraseVault",
                content: i18n.t("PhraseVault is running in the background."),
            });
            state.setBalloonShown(true);
        }
    });

    mainWindow.on("close", (event) => {
        if (!global.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            if (tray && !state.getBalloonShown()) {
                tray.displayBalloon({
                    icon: getIconPath(),
                    title: "PhraseVault",
                    content: i18n.t("PhraseVault is running in the background."),
                });
                state.setBalloonShown(true);
            }
        }
    });

    return mainWindow;
}

function createTray() {
    tray = new Tray(getTrayIconPath());
    tray.setToolTip(i18n.t("PhraseVault is running in the background. Press Ctrl+. to show/hide."));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: i18n.t("Show/Hide"),
            click: () => {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    mainWindow.focus();
                }
            },
        },
        {
            label: i18n.t("Quit"),
            click: () => {
                global.isQuitting = true;
                app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    return tray;
}

function updateTitleBarTheme(theme) {
    if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed()) return;

    let isDark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
    mainWindow.setTitleBarOverlay({
        color: isDark ? secondaryColor.dark.color : secondaryColor.light.color,
        symbolColor: isDark ? secondaryColor.dark.symbolColor : secondaryColor.light.symbolColor,
    });
}

function clearBackendBindings() {
    backend.clearMainBindings(ipcMain);
}

module.exports = { createWindow, createTray, updateTitleBarTheme, clearBackendBindings, getIconPath, mainWindow, tray };
