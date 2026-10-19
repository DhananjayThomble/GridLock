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
| Tests for 0%-coverage backend routes | Add tests for `routes/leaderboard.js`, `routes/push.js`, `routes/ranked.js` (0% covered per the #526 run) and ratchet the Jest coverage thresholds up. | M | Coverage run in #526 |
| Expand type-safety coverage | Annotate more modules (`stores/*`, remaining `utils/*`, frontend contexts) with JSDoc + `//@ts-check` and grow the jsconfig `include`. | M | Follow-up to #527 |
| MCP servers for structured access | Configure a MongoDB MCP (DB inspection) and the GitHub MCP (PR/review loop) in Kiro MCP config so the agent uses structured tools instead of shelling out. | M | Tier 4 recommendation |

## Done
| Item | PR |
|------|-----|
| Kiro hooks dedup + push-guard fix; backend-test hook made manual | #524 |
| Autonomy/permission-boundary steering + `kiroAgent.trustedCommands` allowlist | #524 |
| `DEVELOPMENT.md` refreshed to defer to steering | #524 |
| `repo-structure-cleanup` spec completed with `tasks.md` | #524 |
| First-class `reviewer` custom agent + "Run Local CI" hook + spec backlog | #525 |
| Backend Jest coverage config + calibrated thresholds | #526 |
| Type-safety foundation (jsconfig + JSDoc on `gameLogic.js`) | #527 |
| Harden remote-mutation guarding — documented server-side branch protection as the real gate | (this branch) |
