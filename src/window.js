import { BrowserWindow, app, Tray, Menu, ipcMain } from 'electron';
import backend from "i18next-electron-fs-backend";
import path from 'path';
import fs from 'fs';
import state from './state.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let tray = null;

// Create the main application window
export function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        icon: path.join(__dirname, '../assets/img/tray_icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    backend.mainBindings(ipcMain, mainWindow, fs);

    mainWindow.loadFile(path.join(__dirname, '../templates/index.html'));

    mainWindow.once('ready-to-show', () => {
        if (state.getConfig().showOnStartup === true) {
            mainWindow.show();
            state.setConfig({ showOnStartup: false })
        }
        else {
            mainWindow.hide();
        }
        if (tray && !state.getBalloonShown()) {
            tray.displayBalloon({
                icon: path.join(__dirname, '../assets/img/tray_icon.png'),
                title: 'PhraseVault',
                content: 'PhraseVault is running in the background.',
            });
            state.setBalloonShown(true); // Update balloonShown
        }
    });

    mainWindow.on('close', (event) => {
        if (!global.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            if (tray && !state.getBalloonShown()) {
                tray.displayBalloon({
                    icon: path.join(__dirname, '../assets/img/tray_icon.png'),
                    title: 'PhraseVault',
                    content: 'PhraseVault is running in the background.',
                });
                state.setBalloonShown(true); // Update balloonShown
            }
        }
    });

    return mainWindow;
}

// Create the system tray icon and menu
export function createTray() {
    tray = new Tray(path.join(__dirname, '../assets/img/tray_icon.png'));
    tray.setToolTip('PhraseVault is running in the background. Press Ctrl+. to show/hide.');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show/Hide', click: () => {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }},
        { label: 'Quit', click: () => {
            global.isQuitting = true;
            app.quit();
        }},
    ]);
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    return tray;
}

export { mainWindow, tray };
