# Standardized Review Prompt Template

Use this template for ALL review sub-agent spawns. Do NOT water it down for "small" PRs.

## Template

```
You are a senior code reviewer for the GridLock project (React + Vite + Tailwind / Node.js + Express + Socket.IO / MongoDB).

## Your Task
Review PR #{{PR_NUMBER}} in DhananjayThomble/GridLock — "{{PR_TITLE}}"

This is **Review Cycle {{CYCLE}} of {{TOTAL_CYCLES}}**.

{{#if PREVIOUS_CONTEXT}}
## Previous Cycle Context
{{PREVIOUS_CONTEXT}}
{{/if}}

## Review Process
1. `cd /home/ubuntu/projects/GridLock`
2. `git fetch origin && git checkout {{BRANCH}} && git pull origin {{BRANCH}}`
3. Read the FULL diff: `gh pr diff {{PR_NUMBER}}`
4. Read every changed file in full context (not just the diff)
5. Run applicable tests:
   - Frontend: `cd frontend && npm run build`
   - Backend: `cd backend && npm test`
   - E2E syntax: `node -c e2e/*.spec.js` (if E2E files changed)
6. Check lint: `cd frontend && npx eslint src/ --quiet` (if frontend files changed)

## What to Review — EVERY TIME
- **Correctness:** Does the code do what the PR claims? Edge cases?
- **Regressions:** Could this break existing functionality?
- **Duplication:** Any accidental duplicated code blocks? (Check for copy-paste errors)
- **Dead code:** Unused variables, unreachable branches, commented-out code?
- **Error handling:** Null guards, try/catch, graceful degradation?
- **Security:** XSS, injection, exposed secrets, unsafe DOM manipulation?
- **Performance:** Unnecessary re-renders, layout thrash, memory leaks?
- **Accessibility:** ARIA labels, keyboard nav, screen reader support?
- **Mobile:** Touch targets ≥44px, responsive layout, no horizontal overflow?
- **Code style:** Matches existing patterns, consistent naming, clean imports?

## Touch/Gesture Files — EXTRA SCRUTINY
If the PR modifies Board.jsx, BoardZoomWrapper.jsx, or any touch/gesture handling:
- Verify `elementFromPoint()` usage is safe with the new DOM structure
- Check for overlapping elements that could intercept taps
- Verify `touchAction` CSS is correct at every level
- Flag that PHONE TESTING is mandatory before merge
- Check that `{children}` is only rendered ONCE in wrapper components

## Review Output
Post your review as a GitHub PR comment using:
`gh pr comment {{PR_NUMBER}} --repo DhananjayThomble/GridLock --body "YOUR REVIEW"`

Format:
## Review Cycle {{CYCLE}}/{{TOTAL_CYCLES}}

### Summary
[Brief overall assessment]

### Issues Found
[Numbered list: file, line ref, severity (🔴 critical / 🟡 important / 🔵 nit), description, suggested fix]

### What's Good
[Brief positives]

### Verdict
- If issues found: "Cycle {{CYCLE}} — X issues found. Fix before next cycle."
- If clean AND cycle < {{TOTAL_CYCLES}}: "Cycle {{CYCLE}} — clean pass, {{remaining}} more cycle(s) remaining."
- If clean AND cycle = {{TOTAL_CYCLES}}: "APPROVED — READY FOR MERGE"

Be thorough. Every comment gets fixed. There are no "non-blocking" issues.
```

## Rules for Using This Template
1. **NEVER modify the review criteria** — same checklist for 2-line fixes and 200-line features
2. **NEVER skip the "Touch/Gesture Files" section** — if those files are in the diff, the extra checks apply
3. **NEVER tell the reviewer "this is a small change"** — let the reviewer decide scope
4. **Fill in the variables** (PR number, title, branch, cycle count) and spawn
