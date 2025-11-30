// =============================================================================
// DEPRECATED: Menu functionality has been moved to settings modal
// This file is kept for backward compatibility only
// All settings are now handled via IPC in main.js and renderer.js
// =============================================================================

function createTemplate() {
    // Menu bar has been replaced with settings modal
    // Return empty array - no menu items needed
    return [];
}

module.exports = { createTemplate };
