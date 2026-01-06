# bgio-sqlite Implementation Plan

SQLite storage adapter for [boardgame.io](https://boardgame.io/) - file-based persistence without external database servers.

## Overview

This package provides a `SQLiteStore` class that implements boardgame.io's `StorageAPI.Async` interface using `better-sqlite3` for reliable, file-based game state persistence. It solves the corruption issues inherent in the default FlatFile adapter (node-persist based).

## Package Structure

```
bgio-sqlite/
├── src/
│   ├── index.ts          # Re-exports SQLiteStore
│   └── sqlite.ts         # Main SQLiteStore class
├── test/
│   └── sqlite.test.ts    # Jest test suite
├── lib/                  # Build output (gitignored)
├── package.json
├── tsconfig.json
├── jest.config.js
├── README.md
├── LICENSE               # MIT
├── CHANGELOG.md
└── .gitignore
```

## Dependencies

### package.json

```json
{
  "name": "bgio-sqlite",
  "version": "0.1.0",
  "description": "SQLite storage adapter for boardgame.io",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib/**/*"],
  "scripts": {
    "build": "tsc",
    "prepare": "npm run build",
    "test": "jest",
    "test:cov": "jest --coverage",
    "clean": "rm -rf lib"
  },
  "keywords": ["boardgame.io", "sqlite", "storage", "database", "bgio"],
  "author": "",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/bgio-sqlite.git"
  },
  "peerDependencies": {
    "boardgame.io": ">=0.40.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/jest": "^29.5.12",
    "@types/node": "^22.0.0",
    "boardgame.io": "^0.50.2",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5.4.0"
  }
}
```

## Database Schema

Single SQLite file with two tables:

```sql
-- Main matches table
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  gameName TEXT NOT NULL,
  state TEXT,           -- JSON stringified State
  initialState TEXT,    -- JSON stringified initial State
  metadata TEXT,        -- JSON stringified Server.MatchData
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Separate log table for efficient appends
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matchId TEXT NOT NULL,
  logEntry TEXT NOT NULL,  -- JSON stringified LogEntry
  FOREIGN KEY (matchId) REFERENCES matches(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_matches_gameName ON matches(gameName);
CREATE INDEX IF NOT EXISTS idx_matches_updatedAt ON matches(updatedAt);
CREATE INDEX IF NOT EXISTS idx_logs_matchId ON logs(matchId);
```

## SQLiteStore Implementation

### Constructor Options

```typescript
interface SQLiteStoreOptions {
  /** Path to SQLite database file */
  filename: string;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}
```

### Class Structure

```typescript
import Database from 'better-sqlite3';
import { Async } from 'boardgame.io/internal';
import type { LogEntry, Server, State, StorageAPI } from 'boardgame.io';

export class SQLiteStore extends Async {
  private db: Database.Database | null = null;
  private filename: string;
  private verbose: boolean;

  constructor(options: SQLiteStoreOptions) {
    super();
    this.filename = options.filename;
    this.verbose = options.verbose ?? false;
  }

  async connect(): Promise<void> {
    // Open database, enable WAL mode, create tables
  }

  async createMatch(id: string, opts: StorageAPI.CreateMatchOpts): Promise<void> {
    // INSERT into matches table
  }

  async fetch<O extends StorageAPI.FetchOpts>(
    matchID: string,
    opts: O
  ): Promise<StorageAPI.FetchResult<O>> {
    // SELECT with conditional fields based on opts
  }

  async setState(id: string, state: State, deltalog?: LogEntry[]): Promise<void> {
    // UPDATE state, check _stateID for stale writes, append deltalog
  }

  async setMetadata(id: string, metadata: Server.MatchData): Promise<void> {
    // UPDATE metadata column
  }

  async wipe(id: string): Promise<void> {
    // DELETE from matches and logs (CASCADE)
  }

  async listMatches(opts?: StorageAPI.ListMatchesOpts): Promise<string[]> {
    // SELECT with filters: gameName, isGameover, updatedBefore, updatedAfter
  }
}
```

### Key Implementation Details

1. **WAL Mode**: Enable via `PRAGMA journal_mode=WAL` in `connect()` for better concurrent read/write performance

2. **Stale State Protection**: In `setState()`, verify `_stateID` matches before updating:
   ```typescript
   const existing = this.db.prepare('SELECT state FROM matches WHERE id = ?').get(id);
   if (existing) {
     const existingState = JSON.parse(existing.state);
     if (existingState._stateID >= state._stateID) {
       return; // Skip stale update
     }
   }
   ```

3. **Deltalog Appending**: Insert each log entry as separate row in `logs` table for efficient appends

4. **JSON Serialization**: Use `JSON.stringify()` / `JSON.parse()` for state, metadata, initialState, logEntry columns

5. **Prepared Statements**: Use better-sqlite3's prepared statement caching for performance

## Testing Plan

### Test Cases

1. **connect()**: Creates database file, tables exist, WAL mode enabled
2. **createMatch()**: Creates match, can fetch all fields back
3. **setState()**: Updates state, appends to log
4. **setState() stale protection**: Ignores updates with older stateID
5. **setMetadata()**: Updates metadata, doesn't affect state
6. **fetch() partial**: Returns only requested fields
7. **fetch() missing match**: Returns empty/undefined fields
8. **wipe()**: Removes match and associated logs
9. **listMatches()**: Returns all match IDs
10. **listMatches() with gameName filter**: Only returns matching games
11. **listMatches() with isGameover filter**: Filters by gameover status
12. **listMatches() with updatedBefore/After**: Time-based filtering

### jest.config.js

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
};
```

## README.md Template

```markdown
# bgio-sqlite

SQLite storage adapter for [boardgame.io](https://boardgame.io/).

Provides reliable, file-based game state persistence using SQLite via better-sqlite3.
No external database server required.

## Installation

```bash
npm install bgio-sqlite
```

## Usage

```javascript
const { Server } = require('boardgame.io/server');
const { SQLiteStore } = require('bgio-sqlite');
const { MyGame } = require('./game');

const server = Server({
  games: [MyGame],
  db: new SQLiteStore({
    filename: './data/games.db',
    verbose: false,
  }),
});

server.run(8000);
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `filename` | `string` | (required) | Path to SQLite database file |
| `verbose` | `boolean` | `false` | Enable debug logging |

## Database Location

The database file is created at the specified `filename` path. Ensure the directory exists
and the process has write permissions.

For production deployments, consider placing the database on persistent storage.

## License

MIT
```

## Publishing Checklist

1. [ ] Update `package.json` with your npm username/author info
2. [ ] Update repository URL in `package.json`
3. [ ] Create GitHub repository
4. [ ] `git init && git add . && git commit -m "Initial commit"`
5. [ ] `git remote add origin https://github.com/YOUR_USERNAME/bgio-sqlite.git`
6. [ ] `git push -u origin main`
7. [ ] `npm login` (if not already logged in)
8. [ ] `npm publish` (runs `prepare` script which builds)
9. [ ] Create GitHub release with changelog

## Integration with BrassB

After publishing, update BrassB:

1. Install the package:
   ```bash
   npm install bgio-sqlite
   ```

2. Update `server/server.cjs`:
   ```javascript
   // Replace:
   const { Server, Origins, FlatFile } = require('boardgame.io/server');
   // With:
   const { Server, Origins } = require('boardgame.io/server');
   const { SQLiteStore } = require('bgio-sqlite');

   // Replace FlatFile usage:
   db: new SQLiteStore({
     filename: path.join(__dirname, '../data/games.db'),
   }),
   ```

3. Remove FlatFile-specific code:
   - `getFileHash()` function
   - `findPlayersFromUserMatches()` function  
   - `tryRecoverMetadata()` function
   - `validateGameFiles()` function
   - Direct file reading in `/auth/current-players` endpoint (will need rewrite)

4. Create data migration script to move existing FlatFile data to SQLite (optional, or start fresh)
