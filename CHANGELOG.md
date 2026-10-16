# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Changed
- **Breaking:** Node.js 22 or later is required (`engines.node` is now `>=22`, was `>=20`). `better-sqlite3` 13 supports Node 22+ only; on Node 20 it crashes with SIGSEGV.
- `better-sqlite3` 11 → 13 (bundled SQLite 3.49.2 → 3.53.4). v13 is built on N-API and ships its prebuilt binaries inside the npm package (Linux glibc and musl, macOS, Windows; x64 and arm64), so nothing is downloaded or compiled at install time, and `prebuild-install` plus 33 other install-time packages are gone from the dependency tree. No API changes were needed. npm still runs an empty `node-gyp rebuild` for it on lockfile installs ([npm/cli#9837](https://github.com/npm/cli/issues/9837)), which needs Python and `make`; where those are missing, install with `--ignore-scripts` (see README).
- Docker image installs with `npm ci --omit=dev --ignore-scripts`, so it builds on slim base images that have no Python or `make`.

### CI

- Build and smoke the Docker image on every push, so a base-image bump that breaks the native `better-sqlite3` build (e.g. `node:26-slim`) fails CI instead of merging silently.
- Test matrix is Node 22 and 24 (was 20 and 22).

### Fixed
- Path globs: `**/` now also matches zero directories (`src/**/*.js` covers `src/a.js`, `**/*.test.js` covers a root-level `a.test.js`) — previously such edits were silently allowed.
- Path claims now cover everything beneath the claimed path (`src/api` and `src/api/` behave like `src/api/**`) without matching siblings such as `src/api-v2`.
- Probe paths are normalized before matching (`./`, `//`, `..`, backslashes), so `./src/api/x.js` no longer slips past a `src/api/**` claim.
- Claude Code hook: `NotebookEdit` calls are now gated by path claims (the hook read `file_path` only, not `notebook_path`).
- `POST /api/claims`: non-string `agent` / `resource` / `note` now return 400 instead of a 500; malformed JSON and unexpected errors return a JSON body instead of an HTML page with a stack trace.
- Path claims no longer silently coexist when they overlap: claiming `src/api/**` while another agent holds `src/**` (or `src/api` vs `src/api/users.js`) now returns 409. Overlap is decided conservatively from each glob's static prefix plus a segment-by-segment walk; siblings such as `src/api` vs `src/api-v2` stay independent. Applies to the HTTP API and therefore the CLI.
- `workboard serve --port 0` now binds an ephemeral port and prints the actual port (previously fell back to 5054); an invalid `--port` value is rejected instead of silently using the default.
- Claude Code hook: a project file whose name starts with `..` (e.g. `..foo`) is now path-checked; only real parent traversal (`..` or `../…`) is skipped.

### Added
- Behavioral test suite (5 → 45 tests): conflict edge cases, store lifecycle / stale / expiry, HTTP API validation, loopback-only default bind, hook behavior on conflict, `install-claude` idempotency. Tests use ephemeral ports and temp DBs.

## [v0.1.0] - 2026-06-19
### Added
- Initial public release.
