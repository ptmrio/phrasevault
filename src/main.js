const { app, Menu, globalShortcut, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const { windowManager } = require('node-window-manager');
const { createWindow, createTray } = require('./window');
const path = require('path');
const fs = require('fs');
const state = require('./state');
const { exec } = require('child_process');

let previousWindow;
let mainWindow;
let tray;
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

function updateRecentFilesMenu() {
    const config = state.getConfig();
    const recentFilesMenu = config.recentFiles.map(file => ({
        label: file,
        click: () => {
            state.setConfig({ dbPath: file });
            mainWindow.webContents.send('db-location-changed', file);
            app.relaunch();
            app.exit();
        }
    }));
    return recentFilesMenu;
}

app.whenReady().then(() => {
    mainWindow = createWindow();
    tray = createTray();

    const config = state.getConfig();
    setTheme(config.theme);

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
        if (input.key === 'Escape') {
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
        }
    });

    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Database',
                    click: () => {
                        const options = {
                            title: 'Create New Database',
                            defaultPath: 'phrasevault.sqlite',
                            buttonLabel: 'Create',
                            filters: [
                                { name: 'SQLite Database', extensions: ['sqlite'] }
                            ]
                        };

                        dialog.showSaveDialog(mainWindow, options).then(result => {
                            if (!result.canceled && result.filePath) {
                                const newDbPath = result.filePath.endsWith('.sqlite') ? result.filePath : result.filePath + '.sqlite';
                                fs.writeFileSync(newDbPath, '');
                                state.setConfig({ dbPath: newDbPath });
                                state.addRecentFile(newDbPath);
                                mainWindow.webContents.send('db-location-changed', newDbPath);
                                app.relaunch();
                                app.exit();
                            }
                        }).catch(err => {
                            console.error('Failed to create new database:', err);
                        });
                    }
                },
                {
                    label: 'Open Database',
                    click: () => {
                        const options = {
                            title: 'Open Database',
                            buttonLabel: 'Open',
                            filters: [
                                { name: 'SQLite Database', extensions: ['sqlite'] }
                            ],
                            properties: ['openFile']
                        };

                        dialog.showOpenDialog(mainWindow, options).then(result => {
                            if (!result.canceled && result.filePaths.length > 0) {
                                const selectedPath = result.filePaths[0];
                                console.log('Selected Database Path:', selectedPath); // Debugging line
                                state.setConfig({ dbPath: selectedPath });
                                state.addRecentFile(selectedPath);
                                mainWindow.webContents.send('db-location-changed', selectedPath);
                                app.relaunch();
                                app.exit();
                            }
                        }).catch(err => {
                            console.error('Failed to open database:', err);
                        });
                    }
                },
                {
                    label: 'Recent Databases',
                    submenu: updateRecentFilesMenu()
                },
                {
                    label: 'Quit', click: () => {
                        global.isQuitting = true;
                        app.quit();
                    }
                },
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Light Theme', click: () => setTheme('light') },
                { label: 'Dark Theme', click: () => setTheme('dark') },
                { label: 'System Preference', click: () => setTheme('system') },
            ]
        },
        {
            label: 'Purchase',
            submenu: [
                { label: 'Free for Personal', click: () => require('electron').shell.openExternal('https://phrasevault.app/') },
                { label: 'Buy Commercial License', click: () => require('electron').shell.openExternal('https://phrasevault.app/') },
                {
                    label: 'I Have Already Bought', click: () => {
                        state.setConfig({ purchased: true });
                        app.relaunch();
                        app.exit();
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                { label: 'Documentation', click: () => require('electron').shell.openExternal('https://phrasevault.app/#faq') },
                { label: 'Report Issue', click: () => require('electron').shell.openExternal('https://github.com/ptmrio/phrasevault/issues') },
                { label: 'View License Agreement', click: () => require('electron').shell.openExternal('https://github.com/ptmrio/phrasevault/blob/main/LICENSE') },
                {
                    label: 'Show Phrase Database File', click: () => {
                        const dbPath = state.getConfig().dbPath || path.join(app.getPath('userData'), 'phrasevault.sqlite');
                        shell.showItemInFolder(dbPath);
                    }
                },
                { label: `Version ${app.getVersion()}`, enabled: false }
            ]
        }
    ];

    if (config.purchased) {
        template[2].submenu.unshift({ label: 'Purchased - Thank you', enabled: false });
    }

    const menu = Menu.buildFromTemplate(template);
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
                    }, 200);
                });
            }, 300);
        }, 100);
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
    });

    require('./database');
});
