# Changelog

All notable changes to GridLock are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

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
