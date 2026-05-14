---
inclusion: always
---

# GridLock — Coding Standards

## Language & Module System

- **Backend**: CommonJS (`require` / `module.exports`). Do NOT use ES module syntax (`import`/`export`) in backend code.
- **Frontend**: ES Modules (`import` / `export`). All frontend files use `"type": "module"`.
- **No TypeScript** — the project is pure JavaScript (.js/.jsx). Do not introduce .ts/.tsx files.

## Naming Conventions

- `camelCase` for variables, functions, file names (backend)
- `PascalCase` for React components and their file names
- `UPPER_SNAKE_CASE` for constants
- Socket.IO events use `snake_case` (e.g., `create_game`, `make_move`, `game_update`)

## React Patterns

- Functional components with hooks only — no class components
- State management via React Context (AuthContext, ThemeContext, GridThemeContext, ToastContext) — no Redux or Zustand
- Use `useCallback` for event handlers passed as props, `useMemo` for expensive computations
- Lazy-load non-critical routes with `React.lazy()` + `Suspense`
- Tailwind CSS for styling — avoid inline styles unless values are dynamic
- Mobile-first responsive design

## Backend Patterns

- All game logic is server-authoritative — never trust client input
- Input validation with Joi schemas (see `backend/middleware/socketSchemas.js`)
- Structured logging via `backend/utils/logger.js` with levels: DEBUG, INFO, WARN, ERROR
- Error handling: try-catch in all handlers, emit `error` event to client on failure
- Socket.IO handlers are organized in `backend/controllers/handlers/` — one file per domain

## Testing

- **Backend tests**: Jest + mongodb-memory-server, run with `cd backend && npm test` (runs `jest --runInBand`)
- **Frontend tests**: Vitest + jsdom + @testing-library/react, run with `cd frontend && npm run test`
- **E2E tests**: Playwright, run with `npm run test:e2e:local` from root
- Test files live in `backend/__tests__/` and `frontend/src/tests/`
- When fixing a bug, check if a relevant test exists before modifying behavior

## Build & Lint

- **Frontend lint**: `cd frontend && npx eslint .` (ESLint 9 flat config)
- **Frontend build**: `cd frontend && npm run build` (Vite)
- **No backend linter configured** — follow existing code style
- Pre-commit hook runs ESLint on staged frontend files + backend Jest tests

## Git Workflow

- Branch from `develop`, never directly from `main`
- Branch naming: `feature/description`, `fix/description`, `chore/description`
- PR template requires: summary, related issue, phase, testing checklist
- Version must stay in sync across root, frontend, and backend package.json (use `bash scripts/bump-version.sh <version>`)
- All changes to `main` require @DhananjayThomble review (CODEOWNERS)

## Security

- JWT in httpOnly cookies — never expose tokens to JavaScript
- CSRF protection via `X-Requested-With` header check
- Rate limiting on all REST endpoints and socket events
- Sanitize all user input (see `backend/utils/sanitize.js`)
- Never log sensitive data (tokens, passwords, full cookies)
