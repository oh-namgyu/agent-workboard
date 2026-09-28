# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]
### Fixed
- Path globs: `**/` now also matches zero directories (`src/**/*.js` covers `src/a.js`, `**/*.test.js` covers a root-level `a.test.js`) — previously such edits were silently allowed.
- Path claims now cover everything beneath the claimed path (`src/api` and `src/api/` behave like `src/api/**`) without matching siblings such as `src/api-v2`.
- Probe paths are normalized before matching (`./`, `//`, `..`, backslashes), so `./src/api/x.js` no longer slips past a `src/api/**` claim.
- Claude Code hook: `NotebookEdit` calls are now gated by path claims (the hook read `file_path` only, not `notebook_path`).
- `POST /api/claims`: non-string `agent` / `resource` / `note` now return 400 instead of a 500; malformed JSON and unexpected errors return a JSON body instead of an HTML page with a stack trace.

### Added
- Behavioral test suite (5 → 38 tests): conflict edge cases, store lifecycle / stale / expiry, HTTP API validation, loopback-only default bind, hook behavior on conflict, `install-claude` idempotency. Tests use ephemeral ports and temp DBs.

## [v0.1.0] - 2026-06-19
### Added
- Initial public release.
