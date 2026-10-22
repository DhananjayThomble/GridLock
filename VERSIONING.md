# Versioning

GridLock follows [Semantic Versioning (semver)](https://semver.org/).

## Version Format: MAJOR.MINOR.PATCH

- **MAJOR** — Breaking changes (API contracts change, data migrations required)
- **MINOR** — New features (backward compatible)
- **PATCH** — Bug fixes only

## Version Locations

Version MUST be consistent across:
- `package.json` (root)
- `frontend/package.json`
- `backend/package.json`
- `frontend/.env.production` (VITE_APP_VERSION)

Use `bash scripts/bump-version.sh <major|minor|patch|X.Y.Z>` to update all at once.

## Release Workflow

Branches: feature and fix branches merge into `develop` (**squash**). Releases go from `develop` to `main` with a **merge commit**. Never squash a release PR: it makes `main` and `develop` diverge, and the next release PR then conflicts.

1. **Develop**: all feature/fix PRs merge to `develop` (squash).
2. **Bump the version** in a small PR to `develop`: `bash scripts/bump-version.sh <patch|minor|major>`, add a `## [X.Y.Z]` section to `CHANGELOG.md`.
3. **Release PR**: open `develop` → `main`, titled `release: vX.Y.Z`. CI must be green.
4. **Merge with "Create a merge commit"** (not squash, not rebase). Pushing to `main` runs `.github/workflows/deploy.yml`.
5. **Tag and publish**: create a GitHub release `vX.Y.Z` targeting `main` (this creates the tag). Use the matching CHANGELOG section as the notes.
6. **Verify** the deploy in the Actions tab and on the live site.

No back-merge is needed after a merge-commit release. If `main` ever diverges anyway (for example after an accidental squash), run `bash scripts/sync-main-into-develop.sh`, merge the PR it prepares with a **merge commit**, and then open the release PR.

### Repository settings this relies on

- Ruleset for `main`: allowed merge methods include **Merge**. Squash can stay enabled for `develop`.
- Repository settings: "Allow merge commits" on, and "Automatically delete head branches" on.
- `develop` may also allow squash and merge.

## Enforcement

- `merge-gate.sh` validates version consistency for release PRs to main
- Pre-push hook warns on version mismatches
- `bump-version.sh` prevents downgrading versions
- `release.sh` runs all pre-flight checks before tagging

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 1.1.0 | 2026-03-21 | Sentry frontend, source maps, idle socket timeout |
| 1.0.0 | 2026-03-21 | Baseline (retroactive tag) |
