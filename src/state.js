const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let config = {
    theme: 'system',
    purchased: false,
    dbPath: path.join(app.getPath('userData'), 'phrasevault.sqlite'),
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

module.exports = {
    getConfig,
    setConfig,
    addRecentFile,
    getBalloonShown,
    setBalloonShown,
};
