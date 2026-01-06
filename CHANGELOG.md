# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-06

### Added

- Initial release
- `SQLiteStore` class implementing boardgame.io's `StorageAPI.Async` interface
- SQLite database with WAL mode for better concurrent access
- Support for all standard storage operations:
  - `createMatch()` - Create new matches
  - `fetch()` - Retrieve match state, metadata, initialState, and logs
  - `setState()` - Update match state with stale write protection
  - `setMetadata()` - Update match metadata
  - `wipe()` - Delete matches
  - `listMatches()` - List matches with filtering by gameName, isGameover, updatedBefore/After
- Verbose logging option for debugging
- Full TypeScript support with type definitions
