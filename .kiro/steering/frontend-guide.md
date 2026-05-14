---
inclusion: fileMatch
fileMatchPattern: "frontend/**"
---

# GridLock — Frontend Context

## Entry Point

`frontend/src/main.jsx` → `App.jsx` — React Router v7 with lazy-loaded routes.

## Build & Dev

- **Dev server**: `cd frontend && npm run dev` (Vite on port 5173, proxies `/socket.io` and `/api` to `localhost:5000`)
- **Build**: `cd frontend && npm run build`
- **Lint**: `cd frontend && npx eslint .` (ESLint 9 flat config with react-hooks and react-refresh plugins)
- **Test**: `cd frontend && npm run test` (Vitest + jsdom)
- **Deploy**: Cloudflare Pages via Wrangler (`npm run deploy`)

## Socket.IO Connection

`frontend/src/socket.js` — Shared singleton socket instance. All components import from here. Never create additional socket connections.

Key socket events emitted by client:
- `create_game`, `join_game`, `leave_game`
- `make_move`
- `send_chat_message`
- `start_tournament`, `join_tournament`
- `join_ranked_queue`, `leave_ranked_queue`

Key socket events received by client:
- `game_started`, `game_update`, `game_over`
- `waiting_for_players`, `player_joined`, `player_left`
- `chat_message`, `chat_history`
- `tournament_update`, `tournament_started`
- `ranked_match_found`
- `error`

## Component Architecture

Large components (Board.jsx ~1500 lines, Lobby.jsx ~1500 lines) — these are the core game components. When modifying them, read the relevant section first rather than the entire file.

### Core Pages
- `Board.jsx` — Main game board, handles 2-4 players, spectators, tournaments, all game UI
- `Lobby.jsx` — Game creation, joining, CPU games, tournaments, ranked, quick play
- `Leaderboard.jsx` — Global rankings (lazy-loaded)
- `Profile.jsx` — Player stats and history (lazy-loaded)
- `Settings.jsx` — Theme, sound, notification preferences (lazy-loaded)
- `GameHistory.jsx` — Past games with replay links (lazy-loaded)
- `ReplayPage.jsx` — Game replay viewer (lazy-loaded)
- `HowToPlay.jsx` — Rules and strategy guide (lazy-loaded)
- `DailyChallenge.jsx` — Daily puzzle mode (lazy-loaded)

### Contexts (Global State)
- `AuthContext` — User auth state, login/logout, refreshUser. Fetches `/api/auth/me` on mount.
- `ThemeContext` — Dark/light mode toggle, persisted to localStorage.
- `GridThemeContext` — Visual grid themes (5 themes with unlock conditions based on games played).
- `ToastContext` — Toast notification system.

### Custom Hooks
- `useGridSizes()` — Responsive grid cell sizing based on viewport
- `usePwaInstall()` — PWA install prompt handling
- `useThemeColors()` — CSS variable caching for theme colors

## Styling

- Tailwind CSS 3 with custom config in `frontend/tailwind.config.js`
- Dark mode support via ThemeContext (class-based toggling)
- Custom animations: `bounce-in` keyframe
- Mobile-first: design for small screens, scale up with Tailwind breakpoints

## Third-Party Integrations

- **Sentry** (`frontend/src/lib/sentry.js`) — Error tracking, initialized in main.jsx
- **PostHog** (`frontend/src/lib/posthog.js`) — Product analytics
- **Canvas Confetti** — Win celebration effects
- **QRCode.react** — QR codes for challenge links

## Testing

- Vitest + jsdom + @testing-library/react
- Test setup in `frontend/src/tests/setup.js`
- Component tests in `frontend/src/tests/`
- Run: `cd frontend && npm run test`
