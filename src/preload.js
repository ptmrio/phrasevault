const { contextBridge, ipcRenderer } = require('electron');

// List of valid channels for IPC communication
const validChannels = [
    'search-phrases',
    'add-phrase',
    'edit-phrase',
    'delete-phrase',
    'copy-to-clipboard',
    'increment-usage',
    'insert-text',
    'phrases-list',
    'phrase-added',
    'phrase-edited',
    'phrase-deleted',
    'clipboard-updated',
    'usage-incremented',
    'get-phrase-by-id',
    'phrase-to-insert',
    'focus-search',
    'get-theme',
    'set-theme',
    'toast-message',
    'save-success',
    'open-db-location-dialog',
    'db-location-changed',
];

// Expose ipcRenderer to the renderer process
contextBridge.exposeInMainWorld('electron', {
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
    }
});
