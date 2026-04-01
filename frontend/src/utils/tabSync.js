// frontend/src/utils/tabSync.js
// BroadcastChannel-based tab coordination for session conflict detection (defense-in-depth).
// Detects when the same user opens the same game in multiple tabs on the same browser.

const CHANNEL_NAME = 'gridlock-game-session';
let channel = null;
let currentGameId = null;
let currentUsername = null;
let onConflict = null;
let tabTimestamp = null;
let tabId = null; // Random nonce for deterministic tie-breaking

export function initTabSync(gameId, username, conflictCallback) {
    if (typeof BroadcastChannel === 'undefined') return;
    cleanup();

    currentGameId = gameId;
    currentUsername = username;
    onConflict = conflictCallback;
    channel = new BroadcastChannel(CHANNEL_NAME);

    tabId = Math.random().toString(36).slice(2);
    tabTimestamp = Date.now();
    channel.postMessage({ type: 'game_join', gameId, username, timestamp: tabTimestamp, tabId });

    channel.onmessage = (event) => {
        const { type, gameId: otherGameId, username: otherUsername, timestamp: otherTimestamp, tabId: otherTabId } = event.data;
        // Only conflict if SAME game AND SAME username
        if (type === 'game_join' && otherGameId === currentGameId && otherUsername === currentUsername) {
            // Newer tab wins — older tab yields
            // If timestamps equal, higher tabId wins (deterministic, no mutual yield)
            if (otherTimestamp > tabTimestamp || (otherTimestamp === tabTimestamp && otherTabId > tabId)) {
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
