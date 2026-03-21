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

1. **Develop** — all feature/fix branches merge to `develop`
2. **Version bump** — `bash scripts/bump-version.sh minor` on develop
3. **Beta tag** — `bash scripts/release.sh` tags `vX.Y.Z-beta` on develop
4. **Deploy beta** — `bash scripts/deploy-beta.sh` deploys to beta.gridlock.pro
5. **Verify beta** — manual + automated testing
6. **Release PR** — open `develop → main` PR with version in title
7. **Merge + tag** — after approval, merge and tag `vX.Y.Z` on main
8. **Deploy prod** — `bash scripts/deploy-backend.sh` + `bash scripts/deploy-frontend.sh`
9. **GitHub Release** — `gh release create vX.Y.Z --generate-notes`
10. **CHANGELOG.md** — update with release notes

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
