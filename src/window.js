const { BrowserWindow, app, Tray, Menu } = require('electron');
const path = require('path');
const state = require('./state');

let mainWindow;
let tray = null;

// Create the main application window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        icon: path.join(__dirname, '../assets/img/tray_icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, '../templates/index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.hide();
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
function createTray() {
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

module.exports = { createWindow, createTray, mainWindow, tray };
