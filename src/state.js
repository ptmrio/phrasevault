import fs from 'fs';
import path from 'path';
import { app } from 'electron';

let config = {
    theme: 'system',
    purchased: false,
    dbPath: path.join(app.getPath('userData'), 'phrasevault.sqlite'),
    showOnStartup: true,
    recentFiles: []
};

let balloonShown = false;

const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
    if (fs.existsSync(configPath)) {
        const loadedConfig = JSON.parse(fs.readFileSync(configPath));
        config = { ...config, ...loadedConfig };
    } else {
        saveConfig();
    }
}

function saveConfig() {
    fs.writeFileSync(configPath, JSON.stringify(config));
}

function getConfig() {
    return config;
}

function setConfig(newConfig) {
    config = { ...config, ...newConfig };
    saveConfig();
}

function addRecentFile(filePath) {
    if (config.recentFiles.includes(filePath)) {
        config.recentFiles = config.recentFiles.filter(file => file !== filePath);
    }
    config.recentFiles.unshift(filePath);
    if (config.recentFiles.length > 5) {
        config.recentFiles.pop();
    }
    saveConfig();
}

function getBalloonShown() {
    return balloonShown;
}

function setBalloonShown(value) {
    balloonShown = value;
}

loadConfig();

export {
    getConfig,
    setConfig,
    addRecentFile,
    getBalloonShown,
    setBalloonShown,
};

export default {
    getConfig,
    setConfig,
    addRecentFile,
    getBalloonShown,
    setBalloonShown,
};
