---
inclusion: always
---

# GridLock — Agent Autonomy & Permission Boundaries

This project is developed AI-first. The goal is to let the agent work with minimal human
interruption, reserving the human's attention for a small set of critical gates. This document is
the contract for what the agent may do unattended versus what requires explicit approval.

## Guiding principle

- Default to action for local, reversible changes.
- Stop and ask before anything that mutates shared/remote state, is destructive, or is hard to undo.
- When genuinely unsure, take the non-destructive path and ask.

## Green — do these unattended (no need to ask)

- Read and search any file in the repository.
- Create, edit, and delete files **within the current task's scope** (source, tests, docs, config).
- Run local, reversible verification: unit/integration tests, `eslint`, `vite build`,
  `bash scripts/ci-test.sh`, and read-only git (`status`, `diff`, `log`).
- Create and switch **local** branches; stage specific files and commit **locally**.
- Write code, add tests, refactor, and update `.kiro/steering/` and `.kiro/specs/`.
- Start local dev servers or background processes for testing — then clean them up.

## Yellow — proceed, but state clearly what you did

- Installing or changing dependencies (`npm install <pkg>`, editing `package.json`). Pin versions and
  flag any new or unfamiliar package.
- Modifying build config, git hooks, or lint/format configuration.
- Adding new environment variable **names** to `.env.example` (never real values).
- Large multi-file refactors or file moves that change import paths — verify the build afterward.

## Red — stop and get explicit approval first

- Any remote git mutation: `git push` (all variants), force-push, creating or merging PRs, deleting
  remote branches. See `push-policy.md` for the required review-first workflow.
- Running the merge gate (`scripts/merge-gate.sh`) or performing any merge.
- Deploying or restarting live services: `scripts/deploy-*.sh`, `scripts/ci-deploy.sh`,
  `scripts/deploy-beta.sh`, `wrangler deploy`, PM2 actions on servers.
- Rollbacks (`scripts/rollback.sh`) or anything that touches production.
- Reading or writing real secrets/credentials, or editing a real `.env` (editing `.env.example` is fine).
- Database migrations, schema-destructive changes, bulk updates/deletes, or dropping collections/indexes.
- Editing infrastructure that affects live resources (`ecosystem.config.js`, reverse-proxy, DNS, Cloudflare).
- Deleting files outside the current task's scope, or any recursive/bulk delete.
- Weakening auth/authorization, security middleware, rate limiting, or CORS.
- Changing git config, or skipping hooks with `--no-verify`.
- Sending repository code or data to third-party endpoints not already used by the project.

## After completing any coding task (always)

Follow `push-policy.md`:

1. Summarize every changed file and why it changed.
2. Give an unbiased review — what works, risks/edge cases, shortcuts or debt, and test status.
3. Wait for the user's decision (push / modify / discard). Never push or open a PR without approval.

## Verification expectation

Before declaring a task done, run `bash scripts/ci-test.sh` (or the relevant subset) and report the
result. If it cannot be run in the current environment, say so and explain why.
