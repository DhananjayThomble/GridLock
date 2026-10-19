# Contributing to GridLock

Thanks for your interest in GridLock! Bug reports, fixes, tests, docs and new
features are all welcome. This guide gets you from clone to pull request.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug:** open an issue using the Bug template. Include steps to reproduce.
- **Suggest a feature:** open an issue using the Feature template before writing
  a large change, so we can agree on the approach first.
- **Pick up an issue:** look for issues labelled `good first issue` or
  `help wanted`, and leave a comment saying you're working on it.
- **Security issues:** please **don't** open a public issue. See [SECURITY.md](SECURITY.md).

## Local setup

### Prerequisites

- **Node.js 22** (see `.nvmrc`; run `nvm use` if you use nvm)
- **MongoDB**: a local instance is easiest:
  ```bash
  docker run -d --name gridlock-mongo -p 27017:27017 mongo:7
  ```
- Redis is **optional**. The backend falls back to in-memory stores without it.

### Install and run

```bash
git clone https://github.com/<your-username>/GridLock.git
cd GridLock

# Backend (Express + Socket.IO on http://localhost:5000)
cd backend
npm install
cp .env.example .env
npm start

# Frontend (Vite on http://localhost:5173, proxies /api and /socket.io to :5000)
cd ../frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173 and play as a guest. You don't need Google sign-in
credentials for gameplay. Fill in the `GOOGLE_*` values in `backend/.env` only
if you're working on login, profiles or other signed-in features.

To try multiplayer locally, open the game in two browser windows (or one normal
and one private window).

## Project layout

| Path | What lives there |
|------|------------------|
| `backend/server.js` | Express + Socket.IO entry point |
| `backend/controllers/handlers/` | Socket event handlers (game, moves, chat, matchmaking, ...) |
| `backend/utils/gameLogic.js` | Core Dots & Boxes rules |
| `backend/routes/`, `backend/models/` | REST API and Mongoose models |
| `backend/__tests__/` | Jest tests |
| `frontend/src/` | React app (components, contexts, hooks) |
| `e2e/` | Playwright end-to-end tests |

More detailed architecture notes are in [`.kiro/steering/`](.kiro/steering/)
(`project-overview.md`, `backend-guide.md`, `frontend-guide.md`,
`socket-events.md`, `coding-standards.md`).

## Making a change

1. **Fork** the repo and create a branch **from `develop`** (not `main`):
   ```bash
   git checkout develop
   git checkout -b fix/short-description   # or feature/..., chore/...
   ```
2. Keep the change focused. One fix or feature per pull request is easiest to review.
3. Add or update tests for behaviour you change.
4. Run the checks below.
5. Open a pull request **into `develop`** and fill in the PR template.

### Checks to run before opening a PR

```bash
cd backend && npm test          # Jest (needs MongoDB on localhost:27017)
cd ../frontend && npm run lint  # ESLint
cd ../frontend && npm run build # Production build
```

The same checks run automatically on every pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Playwright E2E tests
(`npm run test:e2e:local` from the repo root) are optional for most changes,
but appreciated for UI and gameplay changes.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) style:

```
fix(backend): prevent double move on rapid clicks
feat(frontend): add colour-blind friendly palette
docs: clarify local setup
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

### Code style

- Follow the patterns in the surrounding code; ESLint covers the frontend.
- The backend is **authoritative** for game state. Validate every client
  input on the server; never trust the client.
- Keep version numbers alone. Maintainers bump versions at release time.

## Review and merge

A maintainer will review your PR, usually within a few days. We may ask for
changes; that's a normal part of the process. Once approved, a maintainer
merges it into `develop`, and it ships to production with the next release.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
