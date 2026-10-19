# Changelog

All notable changes to GridLock are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [2.2.0] — 2026-10-19

GridLock is now open source under the MIT License.

### Added
- MIT `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SECURITY.md` (#532)
- GitHub Actions CI on GitHub-hosted runners for pull requests: backend tests with MongoDB, frontend lint and build (#532)
- Contributor-friendly issue and PR templates; security reports routed to private advisories (#532)
- `.nvmrc` (Node 22) and backend `npm start` script (#532)
- HTTP tests for leaderboard, push and ranked routes — 52 new tests (#529)
- Jest coverage config with calibrated thresholds (`npm run test:coverage`) (#526)
- JSDoc type-safety for `gameLogic` and the store modules, checked via `jsconfig.json` (#527, #530)
- Component tests for WaitingRoom, RankedQueue, TournamentLobby, Profile and DailyChallenge (#515)
- Kiro IDE steering docs, hooks, reviewer agent and spec backlog (#515, #524, #525, #528)

### Changed
- `backend/.env.example` defaults to `NODE_ENV=development` so local sign-in works (#532)
- `DEVELOPMENT.md` rewritten to point at the steering docs (#524)
- Self-hosted CI runner retired; infrastructure docs updated (#532)

### Fixed
- 14 frontend ESLint `no-undef` errors in test files (#532)

### Removed
- Production server IP from docs and legacy test scripts (#532)
- Stale internal planning files and `server.js.backup` (#532)

## [2.1.0] — 2026-04-07

### Added
- Google OAuth — full login/signup with guest data migration (#468, #469)
- QR code sharing in WaitingRoom for easy in-person invites (#498)
- First-time onboarding flow with animated GameDemo (#455, #459)
- Challenge Links — shareable 'Play With Me' URLs (#456)
- Wordle-style share result card (#457)
- SEO meta tags + structured data (#458)
- GameDemo animated component showing realistic gameplay
- Daily challenge leaderboard with player count and personal result (#435)
- Grid Theme System — 5 themes with unlockable rewards (#439, #440)
- Visual QA pipeline — 210 automated UI checks (#443)
- Theme unlock progress indicators and push notification tooltip (#518)
- Search loading spinners, skeletons, and no-results states (#518)
- Auto-load recent games on History page for logged-in users (#518)
- TOC, back-to-top button, and scroll progress on Rules page (#518)
- 4-layer UI/UX design audit system
- Opponent move sound — distinct lower-pitch audio (#451)
- Developer credit footer + meta author tag
- Component test coverage for 11 critical components (#515)
- Comprehensive socket stability test suite (#496)
- Full game matrix tests — all player/grid/CPU permutations (#398)
- Nightly & weekly automated test suite for beta (#397)

### Fixed
- Socket stability wave 1-3: timer recovery, forfeit, lobby cleanup, transport upgrade, ping tuning, username collision, zombie game cleanup, Safari localStorage fallback (#492-#494)
- Multi-tab session conflict detection and handling (#478, #488)
- Page Lifecycle API handlers for robust socket reconnection (#476, #477, #486)
- Mobile responsiveness audit — Settings, HowToPlay, ConnectionOverlay fixes (#454)
- WCAG AA contrast compliance for dots, lines, and UI elements (#441, #509)
- 44px minimum tap targets across mobile views (#504, #507, #510)
- Bottom navigation breakpoint extended to 768px for mobile UX (#511)
- React hooks lint errors in Lobby.jsx (set-state-in-effect, exhaustive-deps)
- Validation UX v2 — floating toast, inline highlights, shake + scroll (#501, #502)
- Pre-fill username from auth context (#499)
- Grammar fixes: "Your turn" corrected, ellipsis normalized (#516)
- Pill-shaped toggle switches restored on Settings page
- Opaque dropdown/modal backgrounds — bg-secondary (#506)
- Safe-area-inset-top for mobile header notch/status bar
- All secrets moved to .env files, zero hardcoded credentials (#470)
- Service worker cache auto-bump on deploy (#447)
- path-to-regexp HIGH vulnerability patched (#461, #465)
- Sentry noise reduction from expected errors (#407-#410)
- Replace console.log with structured logger in socket.js (#514)

### Changed
- React.lazy code splitting + E2E tests for ranked, daily, chat (#400)
- Wave 3 socketHandlers.js decomposition + Lobby extraction (#401)
- Structured logging throughout backend
- CPU toggle made more prominent and discoverable (#434)
- 3-tier button hierarchy in lobby (#430)

### Infrastructure
- Merge-gate.sh with version validation for release PRs
- bump-version.sh for consistent version management
- Pre-push hooks with full lint + build + test pipeline
- Deploy scripts with service worker cache busting

## [1.4.1] — 2026-03-29

### Added
- Opponent move sound — distinct lower-pitch audio (400Hz) when opponent places a line without capturing

### Fixed
- Frontend deploy: NODE_ENV=development for npm ci (fixes vite not found in CI/CD)
- History page: grid size filter limited to 3-6 (was 2-10)
- ReplayPage: second TDZ bug (gameState useMemo used before declaration)
- ReplayPage: wrong API env var (VITE_API_URL → VITE_API_BASE_URL)

## [1.4.0] — 2026-03-28

### Added
- Grid Theme System — 5 visual themes (Clean, Classic, Minimal, Neon, Glass) with unlockable rewards (#439, #440)
- Visual QA pipeline with 210 automated UI checks (#443)
- Playwright grid square verification tests
- Production auto-deploy via gh-notify webhook
- Sentry Discord relay improved alert formatting

### Fixed
- ReplayPage crash — 3 stacked bugs: TDZ totalMoves, TDZ gameState, wrong env var VITE_API_URL
- Game history: CPU opponents now recorded, scores and results correct (#448)
- Service worker cache strategy: skipWaiting + clients.claim + purge all on deploy (#447)
- Grid layout: explicit square dimensions + flexGrow/flexShrink locked (#438)
- Grid dot spacing: 16px for 4×4+ grids, 24px for 3×3 (#442)
- WCAG AA contrast compliance across all themes (#441)
- Touch targets ≥44px on all interactive elements (#446)
- Accent color contrast fix (#446)
- Button order: Create Game as primary action (#433)

### Changed
- CPU toggle redesigned for better discoverability (#434)
- Test timeouts increased 100× to prevent false failures

## [1.3.0] — 2026-03-26

### Added
- Daily challenge leaderboard — top 10 fastest solvers per day with real-time updates (#277, #435)
- 3-tier button hierarchy system — primary/secondary/tertiary with consistent visual weight (#273, #430, #433)

### Changed
- CPU toggle redesigned — clearer on/off states with improved touch targets (#272, #434)
- Branch cleanup — reduced remote branches from 192 → 11
- Backend test suite expanded to 511 tests (up from 505)

### Fixed
- **Wave C mobile UX** — 7 fixes for mobile gameplay:
  - Timer/status bar overlap on small screens (#270)
  - Touch target sizing for grid cells (#271)
  - Landscape mode layout handling (#274)
  - Bottom sheet drag-to-dismiss gesture (#275)
  - Keyboard dismiss on game start (#276)
  - Score animation jank on low-end devices (#278)
  - Pull-to-refresh disabled during active games (#279)
- Grid overflow on mobile — square alignment and viewport calculation fixes (#431, #432)
- Chat FAB hidden in CPU games where no opponent exists

### Security
- Bumped socket.io-parser to patch unbounded binary attachments / potential DoS vulnerability (#424)
- Bumped picomatch to patch ReDoS vulnerability (#428)

## [1.2.1] — 2026-03-26

### Fixed
- Grid overflow on mobile viewports — increased reservedH (260→320) for proper vertical chrome accounting (#431)
- Safety clamp: scales grid box size down if total grid exceeds available viewport space (#431)
- Board container overflow guard (overflow:hidden + max-height) as defense-in-depth (#431)
- Chat FAB hidden in CPU games where no opponent exists to chat with (#431)

## [1.1.0] — 2026-03-21

### Added
- Sentry frontend integration — error boundaries, breadcrumbs, session replay (#382)
- Source map upload pipeline via sentry-cli (#383)
- Idle socket timeout — 5min lobby, 30min post-game (#391)

### Fixed
- Redis SCAN cursor type in getAllActiveGames (#386)
- Zombie game GC — MongoDB sweep for orphaned games (#388)

### Changed
- Deploy scripts now upload source maps to Sentry automatically
- Removed @sentry/vite-plugin (incompatible with self-hosted Sentry)

## [4.1] - 2026-03-20
### Added
- "Rejoin Game" banner on lobby — return to active games after navigating away
- Spectator mode on full games — "Watch Game" button on join page
- Ranked ELO profile display — tier badge, W/L/D record on ranked button
- `get_ranked_profile` backend handler for ranked stats

### Fixed
- Board sizing — grid now fills mobile viewport (dot/line ratio calculation)
- Board right-edge clipping on mobile
- GridLock branding on How-to-Play page (SEO-optimized dual branding)
- Join form hidden on permanent errors (Game not found)
- Room code letter-spacing tightened

## [4.0] - 2026-03-19
### Added
- Leave Game confirmation modal with full accessibility (a11y)
- Game continues after player disconnect — skip turns instead of ending as Draw
- Zombie game garbage collection — cleans abandoned games every 5 minutes
- Host Start button for all-human games (30s AFK auto-start)
- Host disconnect during room-full auto-starts game
- Join error handling — transient retry for "Game is full", permanent for "Game not found"
- Chat icon moved to bottom toolbar
- CPU bot naming expanded to 6 Greek names (Alpha through Zeta)

### Fixed
- "Leave Game" button now emits socket event — no more silent freeze for other players
- Disconnect timeout no longer kills entire game as "Draw"
- Player name truncation — CSS-only, consistent across layouts
- "vs CPU" spacing in game info badge

### Security
- Race condition guard on leave_game + disconnect double-fire
- Spectator cap (20 per game) to prevent abuse
- Timer cleanup in all disconnect/leave paths

## [3.9] - 2026-03-17
### Added
- Mobile lobby redesign — compact pills, unified profile card
- Leaderboard card layout for mobile
- GameHistory recording for all completed games
- White gap fix — body background matches theme color

## [3.8] - 2026-03-16
### Added
- Settings page redesign — iOS-style grouped sections
- Local CI/CD pipeline via gh-notify webhook
- Redis SCAN cursor fix for redis@5.x compatibility

### Security
- bcrypt password hashing (replaced plaintext storage)
- Rate limiter IPv6 normalization
- Socket middleware security hardening

## [3.7] - 2026-03-15
### Added
- How to Play page with SEO optimization
- Landing hero section for first-time visitors
- Technical SEO: meta tags, OG tags, structured data, sitemap, robots.txt
- Sentry + PostHog frontend SDKs
- Prometheus metrics + Grafana dashboards

## [3.6] - 2026-03-14
### Added
- Waiting room with real-time player slots and share invite
- PWA install prompt
- Mobile bottom navigation bar
- Tournament bracket system
- Daily challenge mode
- Quick Play matchmaking
- Ranked mode with ELO system
