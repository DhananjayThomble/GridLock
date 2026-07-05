# GridLock — Spec Backlog

A living queue of candidate work for AI-driven development. Each item is a candidate for a full spec
under `.kiro/specs/<name>/` (requirements → design → tasks). This is seeded from work already
identified in the repo and in recent reviews — not speculative product features. Keep it current:
add items as they surface, and move them to **Done** with a PR link when merged.

## How the agent should use this
1. Pick the highest-priority unblocked item.
2. If it has no spec yet, create one: `.kiro/specs/<name>/requirements.md` → `design.md` → `tasks.md`.
3. Execute per `.kiro/steering/autonomy.md` — local, reversible steps unattended; stop at the red-line
   gates (push, PR, merge, deploy, dependency changes) for approval.
4. Verify with the "Run Local CI" hook (`scripts/ci-test.sh --skip-e2e`) before declaring done.

## Ready (spec exists)
| Item | Intent | Spec |
|------|--------|------|
| Repo structure cleanup | Restructure the monorepo: remove stale files (incl. `frontend/before-test.js`), group components by feature, add `shared/` package + npm workspaces, Prettier, unified `.env.example`. | `.kiro/specs/repo-structure-cleanup/` (requirements + design + tasks) |

## Backlog (identified, needs a spec)
| Item | Intent | Size | Source |
|------|--------|------|--------|
| Editor-level type safety (no TypeScript) | Add `jsconfig.json` with `checkJs` + JSDoc type annotations on core modules (`backend/utils/gameLogic.js`, stores, frontend contexts) so the agent gets type feedback without introducing `.ts` files. | M | Tier 3 recommendation; `DEVELOPMENT.md` legacy TODO |
| Jest coverage thresholds | Add coverage thresholds to the backend Jest config (advisory first, then enforced) so under-tested changes are caught. | S | Tier 3 recommendation |
| MCP servers for structured access | Configure a MongoDB MCP (DB inspection) and the GitHub MCP (PR/review loop) in Kiro MCP config so the agent uses structured tools instead of shelling out. | M | Tier 4 recommendation |
| Harden remote-mutation guarding | Rely on server-side GitHub branch protection on `develop`/`main` as the true gate; document this in `autonomy.md` and optionally broaden the `no-auto-push` hook (the tool-name matcher misses `gh_rest_api`/shell paths). | S | Found during PR #524 flow |

## Done
| Item | PR |
|------|-----|
| Kiro hooks dedup + push-guard fix; backend-test hook made manual | #524 |
| Autonomy/permission-boundary steering + `kiroAgent.trustedCommands` allowlist | #524 |
| `DEVELOPMENT.md` refreshed to defer to steering | #524 |
| `repo-structure-cleanup` spec completed with `tasks.md` | #524 |
| First-class `reviewer` custom agent + "Run Local CI" hook + this backlog | (pending — current branch) |
