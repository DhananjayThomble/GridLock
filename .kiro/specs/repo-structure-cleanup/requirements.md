# Requirements Document

## Introduction

This feature restructures the GridLock monorepo to follow industry-standard project structure conventions. The restructuring addresses stale files, inconsistent test organization, flat component directories, missing shared constants, and absent formatting tooling. The goal is a clean, well-organized codebase that is easy to navigate, maintain, and onboard new contributors to.

## Glossary

- **Monorepo**: The single Git repository containing both the frontend and backend packages for GridLock.
- **Root**: The top-level directory of the Monorepo (`d:\DT\hobby_projects\GridLock\`).
- **Restructuring_Tool**: The set of scripts, file moves, and configuration changes that implement this cleanup.
- **Shared_Package**: A new `shared/` directory at the Root containing constants and types used by both frontend and backend.
- **Legacy_Test_Scripts**: The 6 ad-hoc test files (`test-4player-logic.js`, `test-5x5-grid.js`, `test-avatars.js`, `test-e2e-flow.js`, `test-game-flow.js`, `test-socket.js`) located in the `backend/` root directory.
- **Planning_Docs**: Project management markdown files (`4PLAYER_NEXT_STEPS.md`, `4PLAYER_SUMMARY.md`, `BETA_PROGRESS.md`, `PRODUCTION_CHECKLIST.md`, `VERSIONING.md`) located at the Root.
- **Component_Directory**: The `frontend/src/components/` directory containing React component files.
- **E2E_Tests**: End-to-end Playwright test specs located in the `e2e/` directory at Root.
- **Nightly_Tests**: Scheduled Playwright test specs in `tests/nightly/`.
- **Weekly_Tests**: Scheduled Playwright test specs in `tests/weekly/`.
- **Formatter**: Prettier code formatting tool configured via `.prettierrc`.

## Requirements

### Requirement 1: Remove Stale and Dead Files

**User Story:** As a developer, I want stale backup files and purposeless artifacts removed from the repository, so that the codebase contains only meaningful, active files.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Monorepo SHALL NOT contain the file `backend/server.js.backup`.
2. WHEN the restructuring is complete, THE Monorepo SHALL NOT contain the file `.gitkeep` at the Root.
3. WHEN the restructuring is complete, THE Monorepo SHALL NOT contain the file `frontend/before-test.js` at the frontend Root if it exists.
4. WHEN the restructuring is complete, THE Monorepo SHALL NOT contain the file `frontend/design-spec.json` at the frontend Root if it exists.

### Requirement 2: Relocate Planning Documents

**User Story:** As a developer, I want project management documents moved out of the repository root, so that the root directory contains only essential project configuration and documentation.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Monorepo SHALL contain a `docs/planning/` directory holding all Planning_Docs.
2. WHEN the restructuring is complete, THE Root SHALL NOT contain `4PLAYER_NEXT_STEPS.md`, `4PLAYER_SUMMARY.md`, `BETA_PROGRESS.md`, `PRODUCTION_CHECKLIST.md`, or `VERSIONING.md` as top-level files.
3. THE `docs/planning/` directory SHALL preserve the original content of each relocated Planning_Doc without modification.

### Requirement 3: Consolidate Backend Test Files

**User Story:** As a developer, I want all backend test files in a single organized directory, so that test discovery is predictable and the backend root stays clean.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Legacy_Test_Scripts SHALL reside in `backend/__tests__/legacy/` directory.
2. WHEN the restructuring is complete, THE `backend/` root directory SHALL NOT contain any files matching the pattern `test-*.js`.
3. THE `backend/package.json` `test:legacy` and `test:all` scripts SHALL be updated to reference the new file paths in `backend/__tests__/legacy/`.

### Requirement 4: Consolidate Test Directory Structure

**User Story:** As a developer, I want a single, clear test directory structure, so that there is no ambiguity about where tests live or which runner executes them.

#### Acceptance Criteria

1. THE Monorepo SHALL use the following test directory layout:
   - `backend/__tests__/` for all backend Jest tests
   - `frontend/src/tests/` for all frontend Vitest unit/component tests
   - `e2e/` at Root for primary Playwright E2E specs
   - `tests/nightly/` and `tests/weekly/` at Root for scheduled Playwright test suites
2. WHEN the restructuring is complete, THE `frontend/tests/` directory SHALL be removed or its contents relocated to the appropriate test directory.
3. THE Vitest configuration in `frontend/vite.config.js` SHALL exclude Playwright spec files from Vitest test discovery using an `exclude` pattern.

### Requirement 5: Organize Frontend Components by Feature

**User Story:** As a developer, I want frontend components grouped by feature domain, so that related files are co-located and the component directory is navigable.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Component_Directory SHALL contain feature subdirectories including: `game/`, `auth/`, `social/`, `tournament/`, `daily/`, and `shared/`.
2. THE `game/` subdirectory SHALL contain game-related components including `Board.jsx`, `GameController.jsx`, `ScoreBar.jsx`, `WaitingRoom.jsx`, `QuickPlay.jsx`, `RankedQueue.jsx`, `ReplayPage.jsx`, `PostGameStatsCard.jsx`, and `GameDemo.jsx`.
3. THE `auth/` subdirectory SHALL contain authentication-related components including `AuthAvatar.jsx`, `AuthNudge.jsx`, and `AuthSetup.jsx`.
4. THE `social/` subdirectory SHALL contain social feature components including `Profile.jsx`, `Leaderboard.jsx`, `GameHistory.jsx`, and `RecentOpponents.jsx`.
5. THE `tournament/` subdirectory SHALL contain tournament-related components including `TournamentLobby.jsx`, `Bracket.jsx`, and `ChallengePage.jsx`.
6. THE `daily/` subdirectory SHALL contain daily challenge components including `DailyChallenge.jsx`, `DailyLeaderboard.jsx`, and `DailyResult.jsx`.
7. THE `shared/` subdirectory SHALL contain cross-cutting components including `ErrorBoundary.jsx`, `ConnectionOverlay.jsx`, `BottomNav.jsx`, `ThemeToggle.jsx`, `ScrollToTop.jsx`, `SentryFallback.jsx`, `PageSeo.jsx`, `HeroBanner.jsx`, and `HowToPlay.jsx`.
8. THE `lobby/` subdirectory (already exists) SHALL contain lobby-related components including `Lobby.jsx` and `JoinGame.jsx`.
9. WHEN a component is moved to a subdirectory, ALL import paths referencing that component throughout the frontend codebase SHALL be updated to reflect the new location.

### Requirement 6: Create Shared Constants Package

**User Story:** As a developer, I want socket event names and other shared constants defined in a single location, so that frontend and backend stay in sync and string literal duplication is eliminated.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Monorepo SHALL contain a `shared/` directory at the Root with a `constants/` subdirectory.
2. THE `shared/constants/` directory SHALL contain a `socketEvents.js` file exporting all socket event name constants used by both frontend and backend.
3. THE `shared/constants/socketEvents.js` SHALL use CommonJS module syntax (`module.exports`) for backend compatibility, with a note on how frontend imports it.
4. WHEN a socket event name is referenced in backend handler code, THE handler SHALL import the constant from the Shared_Package instead of using a string literal.
5. WHEN a socket event name is referenced in frontend code, THE frontend code SHALL import the constant from the Shared_Package instead of using a string literal.
6. THE Shared_Package SHALL include a `package.json` with `"name": "@gridlock/shared"` for potential future workspace integration.

### Requirement 7: Unify Environment Variable Configuration

**User Story:** As a developer, I want a single authoritative `.env.example` file, so that environment setup is unambiguous and all required variables are documented in one place.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Root `.env.example` SHALL contain the complete superset of all environment variables needed by both frontend and backend, organized by section (Database, Redis, Server, Auth, Push, Monitoring, Frontend).
2. WHEN the restructuring is complete, THE `backend/.env.example` SHALL be removed, with a comment in the Root `.env.example` indicating that the backend reads from the Root `.env` file.
3. THE Root `.env.example` SHALL include inline comments documenting each variable's purpose, required/optional status, and example values.
4. THE `backend/server.js` dotenv configuration SHALL load from the Root `.env` file path (e.g., `path: '../.env'` or equivalent).

### Requirement 8: Relocate QA Screenshots Tool

**User Story:** As a developer, I want one-off tooling scripts in a dedicated directory, so that the root directory is not cluttered with utility scripts.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE `qa-screenshots/` directory SHALL be relocated to `scripts/qa-screenshots/`.
2. WHEN the restructuring is complete, THE Root SHALL NOT contain a `qa-screenshots/` directory.
3. THE `package.json` `visual-qa` script SHALL be updated to reference the new path.

### Requirement 9: Consolidate Playwright Configuration

**User Story:** As a developer, I want Playwright configurations clearly organized, so that it is obvious which config runs which test suite.

#### Acceptance Criteria

1. THE Root `playwright.config.js` SHALL serve as the primary E2E configuration targeting the `e2e/` directory.
2. THE `tests/playwright.nightly.config.js` SHALL target only `tests/nightly/` specs.
3. THE `tests/playwright.weekly.config.js` SHALL target only `tests/weekly/` specs.
4. IF a `frontend/playwright.config.js` exists, THE Restructuring_Tool SHALL remove it and consolidate its settings into the Root config or the appropriate scheduled config.
5. THE `package.json` E2E scripts SHALL clearly indicate which config each script uses.

### Requirement 10: Add Code Formatting Configuration

**User Story:** As a developer, I want consistent code formatting enforced across the monorepo, so that code style is uniform and formatting debates are eliminated.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE Root SHALL contain a `.prettierrc` configuration file with project-appropriate settings (single quotes, 2-space indent, trailing commas, 100 character print width).
2. WHEN the restructuring is complete, THE Root SHALL contain a `.prettierignore` file excluding `node_modules/`, `dist/`, `build/`, `coverage/`, `playwright-report/`, and `*.min.js`.
3. THE Root `package.json` SHALL include a `format` script that runs Prettier on the entire codebase.
4. THE Root `package.json` SHALL include a `format:check` script that verifies formatting without modifying files.
5. THE `.husky/pre-commit` hook SHALL include a Prettier formatting check on staged files.

### Requirement 11: Clean Up Root package.json

**User Story:** As a developer, I want the root `package.json` to contain only monorepo-level tooling dependencies, so that package scope is clear and dependencies are not misplaced.

#### Acceptance Criteria

1. THE Root `package.json` `devDependencies` SHALL contain only monorepo-level tooling: `@playwright/test`, `husky`, `prettier`, and any other root-level tools (linting, formatting).
2. WHEN the restructuring is complete, THE `@aws-sdk/client-bedrock-runtime`, `mongodb`, `pixelmatch`, and `pngjs` dependencies SHALL be relocated to the package that actually uses them (e.g., `scripts/` package.json or the relevant test directory).
3. THE Root `package.json` SHALL NOT contain application-level dependencies that belong in frontend or backend.

### Requirement 12: Relocate PM2 Configuration

**User Story:** As a developer, I want deployment configuration in a dedicated location, so that the root directory contains only essential project files.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE `ecosystem.config.js` file SHALL be relocated to `deploy/ecosystem.config.js`.
2. WHEN the restructuring is complete, THE Root SHALL NOT contain `ecosystem.config.js`.
3. THE deployment scripts and documentation SHALL be updated to reference the new path.

### Requirement 13: Enable npm Workspaces

**User Story:** As a developer, I want npm workspaces configured for the monorepo, so that cross-package dependencies are managed consistently and the shared package is linkable.

#### Acceptance Criteria

1. THE Root `package.json` SHALL include a `"workspaces"` field listing `["frontend", "backend", "shared"]`.
2. WHEN `npm install` is run from the Root, THE package manager SHALL install dependencies for all workspace packages and create appropriate symlinks.
3. THE `shared/` package SHALL be importable from both frontend and backend using the `@gridlock/shared` package name after workspace linking.

### Requirement 14: Update Documentation

**User Story:** As a developer, I want project documentation to reflect the new structure, so that onboarding is accurate and contributors can find files quickly.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE `DEVELOPMENT.md` SHALL be updated to reflect the new directory structure, test commands, and formatting workflow.
2. WHEN the restructuring is complete, THE `README.md` SHALL include an updated project structure tree showing the reorganized layout.
3. THE documentation SHALL describe how to use the Shared_Package for adding new constants.

### Requirement 15: Maintain Build and Test Integrity

**User Story:** As a developer, I want the restructuring to preserve all existing functionality, so that no tests break and no build pipelines fail due to the reorganization.

#### Acceptance Criteria

1. WHEN the restructuring is complete, THE command `cd backend && npm test` SHALL pass all existing Jest tests without modification to test logic.
2. WHEN the restructuring is complete, THE command `cd frontend && npm run build` SHALL produce a successful production build.
3. WHEN the restructuring is complete, THE command `cd frontend && npm run test` SHALL pass all existing Vitest tests without modification to test logic.
4. WHEN the restructuring is complete, THE command `cd frontend && npx eslint .` SHALL produce no new lint errors introduced by the restructuring.
5. IF any import path or file reference is changed, THE corresponding test or source file SHALL be updated to maintain correctness.
