/**
 * Spectator-specific handlers.
 * Note: Spectator join is handled in gameHandler (join_game with joinMode='spectator').
 * Spectator disconnect cleanup is handled in disconnectHandler.
 * This module exists for future spectator-specific events (chat, reactions, etc.).
 */

/**
 * Register spectator-specific socket events.
 * Currently no standalone spectator events — all spectator logic is in gameHandler and disconnectHandler.
 */
function register(io, socket, log, rateLimited, validate) {
    // Future: spectator_chat, spectator_reaction, etc.
}

module.exports = { register };
