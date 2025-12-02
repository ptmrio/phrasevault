const { contextBridge, ipcRenderer } = require("electron");

const i18n = require("./i18n.js");

// Get initial language synchronously before exposing i18n
const initialLanguage = ipcRenderer.sendSync("get-language");
if (initialLanguage) {
    i18n.changeLanguage(initialLanguage);
}

const validChannels = [
    // Existing channels...
    "search-phrases",
    "add-phrase",
    "edit-phrase",
    "delete-phrase",
    "copy-to-clipboard",
    "increment-usage",
    "insert-text",
    "phrases-list",
    "phrase-added",
    "phrase-edited",
    "phrase-deleted",
    "usage-incremented",
    "insert-phrase-by-id",
    "focus-search",
    "get-theme",
    "set-theme",
    "toast-message",
    "save-success",
    "open-db-location-dialog",
    "change-language",
    "get-language",
    "database-status",
    "database-error",
    "handle-escape",
    "minimize-window",
    "show-purchase-reminder",
    "open-external-url",
    "mark-as-purchased",
    "get-settings",
    "init-settings",
    "set-language",
    "set-autostart",
    "new-database",
    "open-database",
    "open-recent-database",
    "get-recent-databases",
    "recent-databases",
    "show-database",
    "confirm-purchase",
    "quit-app",
    "read-markdown-file",
    "render-markdown",
    "markdown-content",
    "show-license-agreement",
    "accept-license",
    "decline-license",
];

contextBridge.exposeInMainWorld("electron", {
    send: (channel, data) => {
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    sendSync: (channel, data) => {
        if (validChannels.includes(channel)) {
            return ipcRenderer.sendSync(channel, data);
        }
    },
    removeAllListeners: (channel) => {
        if (validChannels.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        }
    },
});

contextBridge.exposeInMainWorld("i18n", {
    t: i18n.t.bind(i18n),
    changeLanguage: i18n.changeLanguage.bind(i18n),
});
