// frontend/src/utils/tabSync.js
// BroadcastChannel-based tab coordination for session conflict detection (defense-in-depth).
// Detects when the same user opens the same game in multiple tabs on the same browser.

const CHANNEL_NAME = 'gridlock-game-session';
let channel = null;
let currentGameId = null;
let currentUsername = null;
let onConflict = null;
let tabTimestamp = null;

export function initTabSync(gameId, username, conflictCallback) {
    if (typeof BroadcastChannel === 'undefined') return;
    cleanup();

    currentGameId = gameId;
    currentUsername = username;
    onConflict = conflictCallback;
    channel = new BroadcastChannel(CHANNEL_NAME);

    tabTimestamp = Date.now();
    channel.postMessage({ type: 'game_join', gameId, username, timestamp: tabTimestamp });

    channel.onmessage = (event) => {
        const { type, gameId: otherGameId, username: otherUsername, timestamp: otherTimestamp } = event.data;
        // Only conflict if SAME game AND SAME username
        if (type === 'game_join' && otherGameId === currentGameId && otherUsername === currentUsername) {
            // Newer tab wins — older tab yields
            // If timestamps equal (unlikely), higher random breaks tie
            if (otherTimestamp >= tabTimestamp) {
                if (onConflict) onConflict('Another tab opened this game');
            }
        }
    };
}

export function cleanup() {
    if (channel) { channel.close(); channel = null; }
    currentGameId = null;
    currentUsername = null;
    onConflict = null;
}
