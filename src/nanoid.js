/**
 * Simple short ID generator (no external dependencies)
 * Generates 7-character base36 lowercase IDs
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SHORT_ID_LENGTH = 7;

/**
 * Generate a random short ID
 * Uses crypto.getRandomValues for secure randomness
 * @returns {string} 7-character base36 ID
 */
function generateShortId() {
    let result = '';
    const randomValues = new Uint8Array(SHORT_ID_LENGTH);
    
    // Use crypto for secure randomness (available in Node.js and Electron)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(randomValues);
    } else {
        // Fallback for older environments
        const nodeCrypto = require('crypto');
        nodeCrypto.randomFillSync(randomValues);
    }
    
    for (let i = 0; i < SHORT_ID_LENGTH; i++) {
        result += ALPHABET[randomValues[i] % ALPHABET.length];
    }
    
    return result;
}

module.exports = { generateShortId, SHORT_ID_LENGTH };
