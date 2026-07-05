# GridLock Development Guide

This is the human-facing quick-start for working on GridLock. It intentionally stays short and
points to the authoritative sources rather than duplicating them (duplicated docs drift and go stale).

**Source of truth for architecture and conventions:** the steering docs in `.kiro/steering/`.

- `project-overview.md` — stack, architecture, key directories, database
- `coding-standards.md` — language/module rules, naming, testing, git workflow, security
- `backend-guide.md` — backend entry point, handlers, stores, models, routes
- `frontend-guide.md` — frontend entry point, socket layer, components, contexts, hooks
- `socket-events.md` — socket event catalogue (load on demand)
- `deployment-ops.md` — deployment and ops runbook (load on demand)
- `push-policy.md` / `autonomy.md` — what agents may do unattended vs. what needs approval

For infrastructure and deploy specifics, see `INFRASTRUCTURE.md`.

---

## Stack (summary)

- **Frontend**: React 19 + Vite 7 + Tailwind CSS 3 + Socket.IO client
- **Backend**: Node.js + Express 5 + Socket.IO 4 + MongoDB (Mongoose 9) + optional Redis
- **State**: MongoDB for persistence; an in-memory `Map` holds *active* game state (single instance)
- **Auth**: Google OAuth 2.0 → JWT in httpOnly cookies (guest mode supported)
- **Deploy**: PM2 (backend), Cloudflare Pages via Wrangler (frontend), self-hosted CI on EC2

---

## Prerequisites

- Node.js (version per your environment), npm
- A MongoDB instance (local or remote) — set `MONGO_URI`
- Copy `.env.example` and fill in values. Redis is optional (falls back to in-memory).

Install dependencies per package (no workspace manager yet — install in each):

```bash
cd backend && npm install
cd ../frontend && npm install
npm install            # root — Playwright / husky tooling
```

---

## Running locally

```bash
# Backend (Express + Socket.IO on :5000) — no dev script; run the server directly
node backend/server.js

# Frontend (Vite dev server on :5173, proxies /api and /socket.io to :5000)
cd frontend && npm run dev
```

---

## Common commands

| Task | Command |
|------|---------|
| Frontend dev server | `cd frontend && npm run dev` |
| Frontend build | `cd frontend && npm run build` |
| Frontend lint | `cd frontend && npx eslint .` |
| Frontend unit tests | `cd frontend && npm run test` (Vitest) |
| Backend tests | `cd backend && npm test` (Jest, `--runInBand`) |
| E2E (local) | `npm run test:e2e:local` (from root) |
| Full local CI | `bash scripts/ci-test.sh` (add `--skip-e2e` for a quick pass) |
| Version bump (keep all 3 package.json in sync) | `bash scripts/bump-version.sh <version>` |

---

## Development workflow

1. **Branch from `develop`** (never from `main`). Name it `feature/…`, `fix/…`, or `chore/…`.
2. Make changes and keep them scoped. Follow `coding-standards.md`.
3. Verify before marking work done: `bash scripts/ci-test.sh` (backend tests + frontend lint + build + E2E).
   The pre-commit hook also lints staged frontend files and runs backend tests when backend files change.
4. Open a PR into `develop` using the PR template.
5. **Merging is gated.** The only merge path is `bash scripts/merge-gate.sh <PR_NUMBER>`, which enforces
   review cycles, local CI, version/CHANGELOG checks for release PRs, and the `phone-tested` label for
   touch/gesture changes. Do not call `gh pr merge` directly.

---

## Definition of done

- Code follows the standards in `.kiro/steering/coding-standards.md`
- `bash scripts/ci-test.sh` passes (tests, lint, build, E2E)
- No new console errors in browser or server; error and loading states handled
- Responsive on mobile (touch/gesture changes require real-device testing)
- Backend logs via the structured logger; no sensitive data logged
- Commit messages are clear; branch pushed for review (never straight to `develop`/`main`)

---

## Debugging

**Frontend**
- Browser console (F12); confirm the shared socket connects (components import the single socket instance)
- Network tab for failed `/api` requests or socket upgrade issues

**Backend**
- Check logs (PM2 in deployed environments: `pm2 logs gridlock-backend`)
- Game state lives in the in-memory store (`backend/stores/gameStore.js`); enable DEBUG logging to trace it
- Verify MongoDB connectivity via `/health/deep`

**Common issues**
- Socket disconnects → check the WebSocket proxy config in front of the backend
- State desync → the backend runs a single instance for in-memory game state (do not scale to a cluster without Redis)
- Build errors → clear caches and reinstall dependencies

---

## Notes

- Keep this guide short. When architecture changes, update the relevant steering doc in `.kiro/steering/`
  first — that is what both humans and the AI agent read as the source of truth.
- Track larger refactors as specs under `.kiro/specs/` (requirements → design → tasks).
