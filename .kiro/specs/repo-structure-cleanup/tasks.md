# Implementation Plan: Repo Structure Cleanup

This plan converts the design into a series of incremental, verifiable steps. Tasks are ordered
low-risk-first (additive tooling and file relocations) and defer the highest-risk change (frontend
component reorganization with import rewrites) until the shared package and workspaces are in place.
Every task ends in a buildable/testable state; the final task wires everything together and confirms
full build/test integrity.

- [ ] 1. Capture a green baseline
  - Run `cd backend && npm test`, `cd frontend && npm run test`, `cd frontend && npm run build`, and
    `cd frontend && npx eslint .` and record the passing state before any changes.
  - Create the working branch from `develop` (e.g. `chore/repo-structure-cleanup`).
  - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - _Demo: A recorded baseline showing all test/build/lint commands pass before restructuring begins._

- [ ] 2. Add Prettier tooling (additive, no file moves)
  - Create `.prettierrc` (single quotes, semi, trailing comma "all", tabWidth 2, printWidth 100,
    arrowParens "always", endOfLine "lf") and `.prettierignore` per the design.
  - Add `format` and `format:check` scripts to the root `package.json`; add `prettier` to root devDependencies.
  - Run `npm run format:check` to confirm the config loads (do not mass-reformat yet).
  - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - _Demo: `npm run format:check` runs and reports formatting status across the repo._

- [ ] 3. Remove stale and dead files
  - Delete `backend/server.js.backup`, root `.gitkeep`, and `frontend/before-test.js` /
    `frontend/design-spec.json` if present, using `git rm`.
  - Confirm build/test still pass (these files are unreferenced).
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Demo: Repo no longer contains the stale files; backend tests and frontend build still pass._

- [ ] 4. Relocate planning documents
  - Create `docs/planning/` and `git mv` the five planning docs into it with content unchanged.
  - Verify the root no longer contains the planning markdown files.
  - _Requirements: 2.1, 2.2, 2.3_
  - _Demo: `docs/planning/` holds all five docs; root listing is free of them._

- [ ] 5. Relocate QA screenshots tool and PM2 config
  - `git mv qa-screenshots/ scripts/qa-screenshots/` and `git mv ecosystem.config.js deploy/ecosystem.config.js`.
  - Update the root `package.json` `visual-qa` script and any deploy script references to the new paths.
  - _Requirements: 8.1, 8.2, 8.3, 12.1, 12.2, 12.3_
  - _Demo: `npm run visual-qa` resolves the tool at its new path; PM2 config lives under `deploy/`._

- [ ] 6. Consolidate backend legacy test scripts
  - Create `backend/__tests__/legacy/` and `git mv` the six `test-*.js` scripts into it.
  - Fix relative `require()` paths inside the moved scripts (one directory deeper).
  - Update `backend/package.json` `test:legacy` and `test:all` scripts to the new paths.
  - Run `npm run test:legacy` and `cd backend && npm test` to confirm both pass.
  - _Requirements: 3.1, 3.2, 3.3, 15.1_
  - _Demo: `backend/` root has no `test-*.js` files; `npm run test:legacy` and Jest both pass._

- [ ] 7. Consolidate frontend test structure and exclude Playwright specs from Vitest
  - Ensure frontend Vitest tests live under `frontend/src/tests/`; relocate any `frontend/tests/` contents and remove the empty dir.
  - Add `exclude: ['**/node_modules/**', '**/e2e/**', '**/*.spec.js']` to the `test` block in `frontend/vite.config.js`.
  - Run `cd frontend && npm run test` to confirm Vitest discovers only unit/component tests.
  - _Requirements: 4.1, 4.2, 4.3, 15.3_
  - _Demo: Vitest runs the frontend unit suite without picking up Playwright specs._

- [ ] 8. Consolidate Playwright configuration
  - Remove `frontend/playwright.config.js` and fold any needed settings into the root or scheduled configs.
  - Confirm root `playwright.config.js` targets `e2e/` and the nightly/weekly configs target their dirs; make each `package.json` E2E script name the config it uses.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - _Demo: A single primary Playwright config drives `e2e/`; scheduled configs are clearly scoped._

- [ ] 9. Create the shared constants package
  - Add `shared/package.json` (`@gridlock/shared`), `shared/constants/socketEvents.js` (CommonJS `EVENTS` map), and `shared/index.js`.
  - Add a unit test (or a small node script) asserting each `EVENTS` value matches the current wire string used by handlers.
  - _Requirements: 6.1, 6.2, 6.3, 6.6_
  - _Demo: `node -e "console.log(require('./shared').EVENTS.MAKE_MOVE)"` prints `make_move`._

- [ ] 10. Enable npm workspaces and link the shared package
  - Add `"workspaces": ["frontend", "backend", "shared"]` to the root `package.json`.
  - Run `npm install` from root and confirm `@gridlock/shared` is symlinked into `node_modules/`.
  - Verify backend can `require('@gridlock/shared')` and frontend can `import` from it in a throwaway check.
  - _Requirements: 13.1, 13.2, 13.3_
  - _Demo: A root `npm install` links the shared package; both packages resolve `@gridlock/shared`._

- [ ] 11. Adopt shared event constants in backend handlers
  - Replace socket event string literals in `backend/controllers/handlers/**` (and socket registration) with `EVENTS` imports from `@gridlock/shared`.
  - Keep the wire strings identical; run `cd backend && npm test` to prove no behavioral change.
  - _Requirements: 6.4, 15.1, 15.5_
  - _Demo: Backend handlers reference `EVENTS.*`; full Jest suite still passes._

- [ ] 12. Adopt shared event constants in the frontend socket layer
  - Replace event string literals in the frontend socket client (`utils/socket.js` and callers) with imports from `@gridlock/shared`.
  - Run `cd frontend && npm run test` and `npm run build` to confirm resolution and no regressions.
  - _Requirements: 6.5, 15.2, 15.3, 15.5_
  - _Demo: Frontend emits/listens using shared constants; build and unit tests pass._

- [ ] 13. Reorganize frontend components by feature (highest-risk step)
  - Create the feature subdirectories (`game/`, `auth/`, `social/`, `tournament/`, `daily/`, `shared/`, plus existing `lobby/`, `chat/`) and `git mv` each component per the design mapping.
  - Co-locate component tests into `{feature}/__tests__/`.
  - Update every import path (including `App.jsx` lazy-load paths and test imports) to the new locations.
  - Run `cd frontend && npm run build`, `npm run test`, and `npx eslint .` after the move to catch unresolved imports fast.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 15.2, 15.3, 15.4, 15.5_
  - _Demo: The component directory is grouped by domain and the frontend builds cleanly with all tests green._

- [ ] 14. Unify environment configuration
  - Expand the root `.env.example` to the full superset (sections: Server, Database, Redis, Auth, CORS, Push, Monitoring, Admin, Infra) with inline comments.
  - Update `backend/server.js` dotenv to load from the root `.env` via an absolute path, then remove `backend/.env.example`.
  - Start the backend locally to confirm it reads env from root and connects to MongoDB.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Demo: Backend boots reading a single root `.env`; there is one authoritative `.env.example`._

- [ ] 15. Clean up the root package.json dependency scope
  - Move `@aws-sdk/client-bedrock-runtime`, `mongodb`, `pixelmatch`, and `pngjs` to the package that uses them (e.g. `scripts/` or the relevant test dir).
  - Leave only monorepo tooling (`@playwright/test`, `husky`, `prettier`, etc.) in root devDependencies.
  - Run `npm install` from root and re-run the tools that use the moved deps to confirm they still work.
  - _Requirements: 11.1, 11.2, 11.3_
  - _Demo: Root `package.json` contains only tooling deps; scripts depending on the moved packages still run._

- [ ] 16. Wire Prettier and updated checks into the pre-commit hook
  - Update `.husky/pre-commit` to run the Prettier check on staged files, ESLint on staged frontend files, and backend Jest when backend files are staged (per the design script).
  - Test by staging a deliberately mis-formatted file and confirming the hook blocks the commit.
  - _Requirements: 10.5, 15.4_
  - _Demo: A commit with a formatting violation is rejected by the pre-commit hook._

- [ ] 17. Update documentation to reflect the new structure
  - Update `DEVELOPMENT.md` (directory layout, test commands, formatting workflow) and the `README.md` project-structure tree; document how to add constants to `@gridlock/shared`.
  - Cross-check every path mentioned in docs against the final tree.
  - _Requirements: 14.1, 14.2, 14.3_
  - _Demo: `DEVELOPMENT.md` and `README.md` accurately describe the reorganized repo._

- [ ] 18. Final integrity verification
  - Run the full suite end to end: `cd backend && npm test`, `cd frontend && npm run test`, `cd frontend && npm run build`, `cd frontend && npx eslint .`, root `npm run format:check`, and a sample E2E spec.
  - Confirm results match the Task 1 baseline (no new failures) and complete the manual dev-workflow smoke test (backend connects, frontend proxy works).
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - _Demo: A clean full-suite run proving the restructured repo builds, tests, lints, and formats with zero regressions._
