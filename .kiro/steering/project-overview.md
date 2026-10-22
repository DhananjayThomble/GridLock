---
inclusion: always
---

# GridLock — Project Overview

GridLock is a real-time multiplayer territory control game. Players take turns claiming cells on a grid to maximize their score. The project supports 2-4 players, CPU opponents, ranked matchmaking, tournaments, daily challenges, and spectator mode.

## Architecture

- **Monorepo** with `frontend/` and `backend/` directories (no workspace manager — separate package.json in each)
- **Frontend**: React 19 + Vite 7 + Tailwind CSS 3 + Socket.IO Client
- **Backend**: Node.js + Express 5 + Socket.IO 4 + MongoDB (Mongoose 9) + optional Redis
- **Communication**: Socket.IO (primary, real-time game events) + REST API (auth, leaderboard, profile, history)
- **Auth**: Google OAuth 2.0 → JWT in httpOnly cookies, guest mode supported
- **State**: In-memory Map for active games (single-instance), MongoDB for persistence
- **Deployment**: PM2 (backend), Nginx (frontend), GitHub Actions (CI/CD)

## Key Directories

```
frontend/src/
  components/    — React components (Board, Lobby, Leaderboard, Profile, etc.)
  contexts/      — AuthContext, ThemeContext, GridThemeContext, ToastContext
  hooks/         — useGridSizes, usePwaInstall, useThemeColors
  utils/         — sounds, push, session stats, storage, tab sync
  themes/        — 5 grid themes with unlock conditions
  lib/           — Sentry, PostHog, logger

backend/
  controllers/handlers/  — Socket.IO event handlers (game, move, chat, tournament, etc.)
  models/                — Mongoose schemas (User, Game, GameHistory, RankedProfile, etc.)
  routes/                — REST endpoints (auth, leaderboard, profile, replay, etc.)
  middleware/            — auth, rateLimiter, idleTimeout, socketSchemas
  services/              — matchmaking, cpuPlayer, gameCleanup, leaderboardUpdate, push
  stores/                — gameStore (Map), disconnectStore, rematchStore, redisClient
  utils/                 — gameLogic, logger, sanitize, dailyHelpers
```

## Version

Current version: **2.1.0** (synced across root, frontend, and backend package.json)

## Database

MongoDB with collections: users, games, gamehistories, rankedprofiles, dailychallenges, dailyresults, leaderboards, pushsubscriptions. TTL indexes auto-delete old games (30d) and history (90d).
