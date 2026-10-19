---
inclusion: fileMatch
fileMatchPattern: "backend/**"
---

# GridLock — Backend Context

## Entry Point

`backend/server.js` — Express + Socket.IO setup. Connects to MongoDB, optionally Redis, registers all routes and socket handlers.

## Socket.IO Handler Architecture

All socket event handlers are in `backend/controllers/handlers/`. The main dispatcher is `backend/controllers/socketHandlers.js` which wires each handler to the socket.

Handler files and their responsibilities:
- `gameHandler.js` — create_game, join_game, leave_game, game state management
- `moveHandler.js` — make_move, turn validation, score calculation, win detection
- `matchmakingHandler.js` — quick_play queue, auto-matching
- `rankedHandler.js` — ranked queue, ELO updates, placement games
- `tournamentHandler.js` — tournament creation, brackets, progression
- `challengeHandler.js` — challenge links, direct invites
- `chatHandler.js` — in-game chat with rate limiting
- `spectatorHandler.js` — spectator join/leave, read-only game view
- `disconnectHandler.js` — disconnect tracking, reconnection, forfeit timers
- `shared.js` — shared utilities used across handlers

## Game Logic

Core game logic lives in `backend/utils/gameLogic.js`. This is the single source of truth for:
- Valid move checking
- Score calculation (territory control)
- Win/draw detection
- Grid initialization (3x3 to 5x5)
- 2-4 player support

## Data Stores

- `backend/stores/gameStore.js` — In-memory Map of active games. Key = gameId, Value = full game state object.
- `backend/stores/disconnectStore.js` — Tracks disconnected players for reconnection window.
- `backend/stores/rematchStore.js` — Manages rematch requests between games.
- `backend/stores/redisClient.js` — Optional Redis client for multi-instance scaling.

## Models (MongoDB via Mongoose)

- `User` — Google OAuth profile, username, avatar, settings
- `Game` — Active/completed game records with full state
- `GameHistory` — Per-player game records (result, scores, ELO change, duration)
- `RankedProfile` — ELO rating, tier, placement games, win/loss/draw counts
- `DailyChallenge` / `DailyResult` — Daily puzzle mode
- `Leaderboard` — Cached leaderboard snapshots
- `PushSubscription` — Web push notification subscriptions

## REST API Routes

Located in `backend/routes/`:
- `/api/auth/*` — Google OAuth flow, session management, logout
- `/api/leaderboard` — Global rankings
- `/api/profile/:username` — Player profiles and stats
- `/api/game-history` — Past game records
- `/api/replay/:gameId` — Game replay data
- `/api/ranked/*` — Ranked stats and leaderboard
- `/api/daily/*` — Daily challenge data
- `/api/push/*` — Push notification subscription management
- `/health` — Health check (lightweight), `/health/deep` — comprehensive check

## Testing

Run backend tests: `cd backend && npm test`
- Uses Jest with `--runInBand` (sequential, required for shared in-memory MongoDB)
- `mongodb-memory-server` provides isolated test database
- 511+ tests across 35+ test files in `backend/__tests__/`
- Test patterns: unit tests for logic, integration tests for socket events, model tests for schemas
