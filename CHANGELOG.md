# Changelog

All notable changes to GridLock are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [2.3.1] — 2026-10-24

### Fixed
- Google sign-in now shows a clear message when it fails or is cancelled, instead of silently returning to the home page (#604, #605)
- Deploys now fail (and roll back, for production) when the backend's database is unreachable: the deploy health check uses `/health/deep`, which exercises MongoDB, instead of `/health`, which never touched the database (#603, #608)

### Changed
- The backend logs its MongoDB target (host, database, whether credentials and `authSource` are present) at startup, so a misconfigured connection string is obvious in the log (#603)

### Docs
- Documented MongoDB authentication and the per-environment database users in `INFRASTRUCTURE.md` (#607)

## [2.3.0] — 2026-10-24

Mobile, tablet and desktop QA release: phone-sized UI fixes, multiplayer reliability, and a real-server test suite for the multiplayer edge cases (#590-#599).

### Added
- Tap assist on the board: a tap near a line snaps to the nearest open line, with a press preview and a short shake/haptic on a miss. A tap in the middle of a box is ignored on purpose (#594)
- When the player on the move drops, play moves on to the next connected player after about 10 seconds; the dropped player keeps their seat and can rejoin (#598)
- An immediate "You're offline" notice and instant reconnect when the network returns (previously ~35s of a normal-looking board) (#595)
- One-tap rejoin from the lobby's "unfinished game" banner (#596)
- Landscape layout for phones: board on the left, game info on the right (#595)
- Multiplayer scenario tests that start the real server and drive it with real socket clients (2/3/4 players, drops, rejoin, bad joins, waiting room, spectators, ranked queue), plus phone-sized and desktop/tablet Playwright specs (#595, #596, #598, #600)

### Changed
- The Rules page keeps each step as one flowing paragraph and its contents list is no longer a floating panel (#594)
- Lobby secondary buttons meet 4.5:1 text contrast in dark mode; Create Game stays pinned on every screen size; one banner at a time; the phone name field opens, focuses and flags itself when a name is missing (#595, #600)
- Browser Back from a running game goes to the lobby (with the rejoin banner) instead of a stale waiting room (#595)
- On laptops (1280x720, 1366x768) the lobby fits without scrolling and a game never scrolls from 1280x720 up to 1920x1080 or on iPads (#600)

### Fixed
- In 3 and 4 player games every guest was labelled player 1 when a later player joined, so the wrong phone said "Your turn!" (#595)
- Server errors no longer push the board down under a player's thumb; already-drawn lines are no longer sent to the server (#594)
- A host's dropped connection (or switching apps to share the invite link) no longer destroys the waiting room at once: it is held for the reconnect window (#596)
- Refreshing the waiting room left a ghost room; the page now re-joins by itself (#596)
- "Leave Waiting Room" now frees the seat (the server had no handler for it), the host's screen drops a guest who left, and guests are told when the room closes (#596)
- The waiting room share link used a hardcoded gridlock.pro address, so beta shared links to production (#596)
- A 1-2 player leaderboard listed players twice on phones, and the Ranked tab repeated the top 3 (#596)
- Phone lobby: duplicate `id` for the name input, and the collapsed profile panel's controls were still focusable (#595)
- Active score card overlapped its neighbour; History filters and the tutorial link are 44px on tablets (#600)
- Five stale CPU e2e specs and the Settings "Your Stats" spec (they matched labels that no longer exist) (#595)

## [2.2.3] — 2026-10-23

### Security
- Resolved all remaining Dependabot dev-dependency advisories; backend and frontend `npm audit` both report zero vulnerabilities (`js-yaml`, `browserslist`, `form-data`, `@babel/*`, `follow-redirects`, `baseline-browser-mapping`, `ws`, `postcss-selector-parser`, and the `extract-zip`/`puppeteer` chain)

### Changed
- Updated backend runtime dependencies: `redis` to 6.3 and `google-auth-library` to 11.3
- Updated frontend dependencies: `react`/`react-dom` to 19.3, `socket.io-client` to 4.8.4, and dev tooling (`vitest` 5, `jsdom` 30, `globals` 17, Playwright, Testing Library, `wrangler`)

## [2.2.2] — 2026-10-23

### Security
- Upgraded `mongoose` to 9.11.3 to fix a prototype-pollution advisory in update casting via `__proto__`-prefixed dotted paths (#576)
- Resolved CodeQL code-scanning findings without changing behaviour: iterative HTML-tag stripping in input sanitization, NoSQL-injection guards on the daily, game-history and push routes, numeric coercion of the grid size reflected into replay OG tags, an explicit Content-Security-Policy via Helmet, and explicit auth-cookie security flags (#574)
- Hardened `sanitizeAvatar` to fall back to the default avatar when nested/malformed markup leaves residual angle brackets, and tightened the replay OG endpoint to reject malformed game IDs (#579)

### Added
- Regression tests covering the sanitization, NoSQL-injection and replay input-validation fixes (#579)

### Fixed
- Backend test suite runs reliably under Jest with mongoose 9.7+/mongodb driver 7.x by supplying the driver's `os` runtime adapter, and a provided `MONGO_URI` is reused instead of spawning a per-suite in-memory MongoDB (#574, #576)

## [2.2.1] — 2026-10-22

### Security
- Updated dependencies to patched versions across the root, backend and frontend lockfiles, clearing all critical and high findings in production backend dependencies (`engine.io`, `socket.io-parser`, `proxy-addr`, `joi`, `express-rate-limit` and others) and the critical finding in the frontend (#564)

### Added
- Sitemap generated at build time with a current `lastmod`, listing only public pages (#553)
- `noindex, nofollow` on private and dynamic routes such as game rooms, history, settings and profiles (#553)
- Dependabot configuration for npm and GitHub Actions updates (#538)

### Changed
- Prerendering covers the public pages only (`/`, `/how-to-play`, `/leaderboard`, `/daily`) (#553)
- `dotenv` updated to 18 (#547)
- `actions/checkout` and `actions/setup-node` updated to v7 (#565)
- Release documentation rewritten around merge-commit releases (`VERSIONING.md`)

## [2.2.0] — 2026-10-19

GridLock is now open source under the [MIT License](LICENSE).

### Added
- Open-source project files: `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` with private vulnerability reporting, and contributor-friendly issue and pull request templates (#532)
- Continuous integration for every pull request: backend tests against MongoDB, frontend lint and production build (#532)
- Automated deployment pipeline: builds and tests run in GitHub Actions, and deploys use a restricted, single-purpose SSH key (#533)
- `.nvmrc` pinning Node.js 22 and a backend `npm start` script (#532)
- 52 HTTP tests covering the leaderboard, push and ranked routes (#529)
- Backend coverage reporting with regression thresholds (`npm run test:coverage`) (#526)
- JSDoc type checking for the game logic and store modules (#527, #530)
- Component tests for WaitingRoom, RankedQueue, TournamentLobby, Profile and DailyChallenge (#515)

### Changed
- Sentry and PostHog are opt-in: no keys are bundled, and both stay off unless `VITE_SENTRY_DSN` or `VITE_POSTHOG_KEY` is set (#533)
- Rewrote the README for new users and contributors (#535)
- Local development defaults to `NODE_ENV=development` so Google sign-in works on `localhost` (#532)
- Deployment and development documentation consolidated and updated (#524, #533)

### Fixed
- `Lobby` import resolving to the wrong file on case-insensitive filesystems (Windows, macOS)
- Source map upload no longer fails a deploy when Sentry is not configured
- ESLint `no-undef` errors in frontend test files (#532)

### Removed
- Obsolete internal planning documents, backup files and GitHub Pages leftovers (#532)
- The legacy webhook deployer, replaced by the GitHub Actions pipeline (#533)

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
