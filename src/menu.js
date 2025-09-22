import { app, dialog, shell } from 'electron';
import fs from 'fs';
import state from './state.js';
import path from 'path';
import i18n from './i18n.js';
import Winreg from 'winreg';

function updateRecentFilesMenu(mainWindow) {
    const config = state.getConfig();
    const recentFilesMenu = config.recentFiles.map(file => ({
        label: file,
        click: () => {
            state.setConfig({ dbPath: file });
            state.setConfig({ showOnStartup: true });
            state.addRecentFile(file);
            app.relaunch();
            app.exit();
        }
    }));
    return recentFilesMenu;
}

export function createTemplate(mainWindow, setTheme, setLanguage) {
    const template = [
        {
            label: i18n.t("File"),
            submenu: [
                {
                    label: i18n.t("New Database"),
                    click: () => {
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
                    },
                },
                {
                    label: i18n.t("Open Database"),
                    click: () => {
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
                    },
                },
                {
                    label: i18n.t("Recent Databases"),
                    submenu: updateRecentFilesMenu(mainWindow),
                },
                {
                    label: state.getConfig().autostart ? i18n.t("Disable Autostart") : i18n.t("Enable Autostart"),
                    click: () => {
                        const newAutostartSetting = !state.getConfig().autostart;
                        state.setConfig({ autostart: newAutostartSetting });
                        if (newAutostartSetting) {
                            const regKey = new Winreg({
                                hive: Winreg.HKCU,
                                key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                            });
                            regKey.set("PhraseVault", Winreg.REG_SZ, app.getPath("exe"), (err) => {
                                if (err) {
                                    console.error("Failed to set autostart:", err);
                                }
                            });
                        } else {
                            const regKey = new Winreg({
                                hive: Winreg.HKCU,
                                key: "\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                            });
                            regKey.remove("PhraseVault", (err) => {
                                if (err) {
                                    console.error("Failed to remove autostart:", err);
                                }
                            });
                        }
                        state.setConfig({ showOnStartup: true });
                        app.relaunch();
                        app.exit();
                    },
                },
                {
                    label: i18n.t("Quit"),
                    click: () => {
                        global.isQuitting = true;
                        app.quit();
                    },
                },
            ],
        },
        {
            label: i18n.t("View"),
            submenu: [
                {
                    label: i18n.t("Light Theme"),
                    click: () => {
                        setTheme("light");
                        state.setConfig({ showOnStartup: true });
                        app.relaunch();
                        app.exit();
                    },
                },
                {
                    label: i18n.t("Dark Theme"),
                    click: () => {
                        setTheme("dark");
                        state.setConfig({ showOnStartup: true });
                        app.relaunch();
                        app.exit();
                    },
                },
                {
                    label: i18n.t("System Preference"),
                    click: () => {
                        setTheme("system");
                        state.setConfig({ showOnStartup: true });
                        app.relaunch();
                        app.exit();
                    },
                },
            ],
        },
        {
            label: i18n.t("Language"),
            submenu: [
                { label: i18n.t("English"), click: () => setLanguage("en") },
                { label: i18n.t("Spanish"), click: () => setLanguage("es") },
                { label: i18n.t("Portuguese"), click: () => setLanguage("pt") },
                { label: i18n.t("French"), click: () => setLanguage("fr") },
                { label: i18n.t("German"), click: () => setLanguage("de") },
                { label: i18n.t("Italian"), click: () => setLanguage("it") },
            ],
        },
        {
            label: i18n.t("Purchase"),
            submenu: [
                { label: i18n.t("Buy License"), click: () => shell.openExternal("https://phrasevault.app/pricing") },
                {
                    label: i18n.t("I Have Already Bought"),
                    click: () => {
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
                    },
                },
            ],
        },
        {
            label: i18n.t("Help"),
            submenu: [
                { label: i18n.t("Documentation"), click: () => shell.openExternal("https://phrasevault.app/help") },
                { label: i18n.t("Report Issue"), click: () => shell.openExternal("https://github.com/ptmrio/phrasevault/issues") },
                { label: i18n.t("View License Agreement"), click: () => shell.openExternal("https://github.com/ptmrio/phrasevault/blob/main/LICENSE.md") },
                { label: i18n.t("about_credits"), click: () => shell.openExternal("https://phrasevault.app/about") },
                {
                    label: i18n.t("Show Phrase Database File"),
                    click: () => {
                        const dbPath = state.getConfig().dbPath;
                        // check if file exists
                        if (fs.existsSync(state.getConfig().dbPath)) {
                            shell.showItemInFolder(dbPath);
                        }
                        // if folder exists
                        else if (fs.existsSync(path.dirname(state.getConfig().dbPath))) {
                            shell.openPath(path.dirname(state.getConfig().dbPath));
                        }
                        // if file doesn't exist
                        else {
                            dialog.showMessageBox(mainWindow, {
                                type: "error",
                                title: i18n.t("Database error"),
                                message: i18n.t("Neither the database file nor the folder exists."),
                            });
                        }
                    },
                },
                { label: `Version ${app.getVersion()}`, enabled: false },
            ],
        },
    ];

    // remove purchase menu if already purchased and replace with thank you message
    if (state.getConfig().purchased) {
        template.splice(3, 1, { label: i18n.t('Purchased - Thank you'), enabled: false });
    }

    return template;
}
