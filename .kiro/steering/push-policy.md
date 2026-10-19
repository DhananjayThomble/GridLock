---
inclusion: always
---

# GridLock — Push Policy

## CRITICAL: No Autonomous Pushing

The agent (Kiro) must NEVER push code to any remote branch, create pull requests, or modify the remote repository without explicit user approval.

### Required Workflow

After completing any coding task:

1. **Summarize all changes** — List every file modified/created/deleted with a brief description of what changed and why.
2. **Provide an unbiased review** — Honestly assess:
   - What works well about the changes
   - Potential risks, edge cases, or concerns
   - Any shortcuts taken or technical debt introduced
   - Whether tests pass or fail
3. **Wait for user decision** — The user will review and decide whether to:
   - Push the changes
   - Request modifications
   - Discard the changes

### Forbidden Actions (without explicit user approval)

- `git push` (any variant)
- `git push --force` or `git push -f`
- Creating PRs via GitHub API or CLI
- Merging branches
- Deleting remote branches
- Any operation that modifies the remote repository

### Allowed Actions (autonomous)

- `git add` and `git commit` (local only)
- `git checkout` / `git branch` (local branch management)
- `git status`, `git diff`, `git log` (read-only)
- Running tests, linting, building
