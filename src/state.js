const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let config = {
    theme: "system",
    installDate: null,
    purchased: false,
    autostart: true,
    dbPath: path.join(app.getPath("userData"), "phrasevault.sqlite"),
    showOnStartup: true,
    firstRun: true,
    initializeTables: true,
    recentFiles: [],
};

let balloonShown = false;

const configPath = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
    if (fs.existsSync(configPath)) {
        const loadedConfig = JSON.parse(fs.readFileSync(configPath));
        config = { ...config, ...loadedConfig };

        // Set installDate if not present (for compatibility with older versions)
        if (!config.installDate) {
            config.installDate = new Date().toISOString();
            saveConfig();
        }
    } else {
        // First time - set install date
        config.installDate = new Date().toISOString();
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
        config.recentFiles = config.recentFiles.filter((file) => file !== filePath);
    }
    config.recentFiles.unshift(filePath);
    if (config.recentFiles.length > 10) {
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

function shouldShowPurchaseReminder() {
    // Already purchased
    if (config.purchased) {
        return false;
    }

    // No install date set
    if (!config.installDate) {
        return false;
    }

    const installDate = new Date(config.installDate);
    const now = new Date();
    const daysSinceInstall = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));

    // Trial period (14 days)
    if (daysSinceInstall < 14) {
        return false;
    }

    // Show once per app launch (no cooldown tracking)
    return true;
}

function markAsPurchased() {
    config.purchased = true;
    saveConfig();
}

loadConfig();

module.exports = {
    getConfig,
    setConfig,
    addRecentFile,
    getBalloonShown,
    setBalloonShown,
    shouldShowPurchaseReminder,
    markAsPurchased,
};
