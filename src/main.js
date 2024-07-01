
import { app, Menu, globalShortcut, BrowserWindow, ipcMain, clipboard } from 'electron';
import { windowManager } from 'node-window-manager';
import { createWindow, createTray } from './window.js';
import path from 'path';
import state from './state.js';
import db from './database.js';
import { exec } from 'child_process';
import { createTemplate } from './menu.js';
import i18n, { availableLanguages } from './i18n.js';
import EventEmitter from 'events';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseEvents extends EventEmitter {}
const databaseEvents = new DatabaseEvents();

let previousWindow;
let mainWindow;
let tray;

global.databaseEvents = databaseEvents;
global.isQuitting = false;

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});


function setTheme(theme) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('set-theme', theme);
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
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.whenReady().then(async () => {
    
        const config = state.getConfig();
        let languageToUse = config.language;
    
        if (!languageToUse || typeof languageToUse !== 'string') {
            const { osLocaleSync } = await import('os-locale');
            const systemLocale = osLocaleSync();
            const systemLanguage = systemLocale.split('-')[0].toLowerCase();

            if (availableLanguages.includes(systemLanguage)) {
                languageToUse = systemLanguage;
            } else {
                languageToUse = 'en';
            }

            state.setConfig({ language: languageToUse });
        }

        // Update the i18n language setting
        i18n.changeLanguage(languageToUse);

        mainWindow = createWindow();
        tray = createTray();

        // send change language to renderer
        mainWindow.webContents.on('did-finish-load', () => {
            setTheme(config.theme);
            mainWindow.webContents.send('change-language', config.language);
        });

        globalShortcut.register('CommandOrControl+Shift+I', () => {
            mainWindow.webContents.toggleDevTools();
        });

        globalShortcut.register('CommandOrControl+.', () => {
            previousWindow = windowManager.getActiveWindow();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('focus-search');
        });

        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'Escape' && input.type === 'keyUp') {
                event.preventDefault(); // todo: might not be necessary or be counterproductive
                mainWindow.webContents.send('handle-escape');
            }
        });

        ipcMain.on('minimize-window', () => {
            mainWindow.hide();
            if (tray && !state.getBalloonShown()) {
                tray.displayBalloon({
                    icon: path.join(__dirname, '../assets/img/tray_icon.png'),
                    title: 'PhraseVault',
                    content: 'PhraseVault is running in the background.',
                });
                state.setBalloonShown(true);
            }
            if (previousWindow) {
                previousWindow.bringToTop();
            }
        });

        const menu = Menu.buildFromTemplate(createTemplate(mainWindow, setTheme, setLanguage));
        Menu.setApplicationMenu(menu);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
        });

        ipcMain.on('insert-text', (event, text) => {
            mainWindow.hide();
            setTimeout(() => {
                if (previousWindow) {
                    previousWindow.bringToTop();
                }

                let originalClipboardContent;
                try {
                    originalClipboardContent = clipboard.readText();
                } catch (error) {
                    console.error('Failed to read clipboard content:', error);
                    originalClipboardContent = ''; // Set to an empty string if reading fails
                }

                try {
                    clipboard.writeText(text);
                } catch (error) {
                    console.error('Failed to write to clipboard:', error);
                    return; // Exit the function if writing to clipboard fails
                }

                setTimeout(() => {
                    exec('powershell.exe -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"', (error) => {
                        if (error) {
                            console.error('Failed to execute paste command:', error);
                        }

                        // Restore the original clipboard content
                        setTimeout(() => {
                            try {
                                clipboard.writeText(originalClipboardContent);
                            } catch (error) {
                                console.error('Failed to restore original clipboard content:', error);
                            }
                        }, 100);
                    });
                }, 10);
            }, 100);
        });

    });

    databaseEvents.on('database-status', (statusData) => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('database-status', statusData);
        }
    });

    ipcMain.on('get-theme', (event) => {
        event.returnValue = state.getConfig().theme;
    });

    ipcMain.on('set-theme', (event, theme) => {
        setTheme(theme);
    });

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
        else {
            backend.clearMainBindings(ipcMain);
        }
    });

}